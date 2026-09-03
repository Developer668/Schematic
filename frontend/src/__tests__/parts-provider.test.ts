import { afterEach, describe, expect, it, vi } from "vitest";
import { issueSessionToken, type AuthEnv } from "../../../functions/_auth.ts";
import { partsSearch } from "../../../functions/api/parts/search.ts";
import { resetBrightDataStateForTests } from "../../../functions/api/parts/brightdata.ts";

const authEnv: AuthEnv = {
  SCHEMATIC_AUTH_MODE: "chatgpt-sites",
  SCHEMATIC_DEPLOYMENT_ENV: "production",
  SCHEMATIC_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

async function requestFor(query: string, subject = "parts-test") {
  const token = await issueSessionToken({ subject, environment: "chatgpt-sites" }, authEnv);
  return new Request(`https://schematic.example/api/parts/search?query=${encodeURIComponent(query)}&quantity=2`, { headers: { Authorization: `Bearer ${token}` } });
}

describe("server-side parts provider fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetBrightDataStateForTests();
  });

  it("falls through an unavailable adapter and normalizes the first usable result", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("first-adapter")) return new Response("upstream unavailable", { status: 503 });
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ query: "ESP32-S3", quantity: 2, limit: 24 });
      return new Response(JSON.stringify({ results: [{
        id: "adapter-result-1",
        catalogId: "esp32-s3",
        title: "ESP32-S3 DevKitC-1",
        manufacturer: "Espressif",
        partNumber: "ESP32-S3-DevKitC-1",
        exactMatch: true,
        offers: [{ id: "offer-1", retailer: "Digi-Key", title: "ESP32-S3 DevKitC-1", price: 8.5, currency: "USD", url: "https://supplier.example/esp32-s3", provider: "Digi-Key" }],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      ...authEnv,
      PARTS_PUBLIC_SOURCES_ENABLED: "false",
      PARTS_PAID_PROVIDERS_ENABLED: "true",
      PARTS_PROVIDER_ORDER: "first,second",
      PARTS_PROVIDER_ENDPOINTS: JSON.stringify([
        { id: "first", label: "First adapter", endpoint: "https://first-adapter.example/search" },
        { id: "second", label: "Second adapter", endpoint: "https://second-adapter.example/search" },
      ]),
    };

    const response = await partsSearch(await requestFor("ESP32-S3"), env);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.source).toBe("provider-fallback-chain");
    expect(body.attempts.map((attempt: any) => attempt.provider)).toEqual(["first", "second"]);
    expect(body.results[0]).toMatchObject({ catalogId: "esp32-s3", requestedQuantity: 2, exactMatch: true });
    expect(body.results[0].offers[0].url).toMatch(/^https:\/\//);
    expect(body.publication).toMatchObject({ required: true, returnTool: "shopping.search" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a stable handoff when no provider is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await partsSearch(await requestFor("missing-provider"), { ...authEnv, PARTS_PUBLIC_SOURCES_ENABLED: "false" });
    const body = await response.json() as any;
    expect(response.status).toBe(503);
    expect(body.code).toBe("PARTS_PROVIDER_NOT_CONFIGURED");
    expect(body.providerFallback).toMatchObject({ attempted: false, providersTried: [] });
    expect(body.handoff).toMatchObject({ schemaVersion: "schematic.parts.lookup.v1", returnTool: "shopping.search", returnFormat: "json" });
    expect(body.handoff.returnShape.listings).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops reading an oversized chunked provider response without Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(512 * 1024 + 1), { status: 200 })));
    const response = await partsSearch(await requestFor("oversized-provider-response"), {
      ...authEnv,
      PARTS_PUBLIC_SOURCES_ENABLED: "false",
      PARTS_PAID_PROVIDERS_ENABLED: "true",
      PARTS_PROVIDER_ORDER: "oversized",
      PARTS_PROVIDER_ENDPOINTS: JSON.stringify([{ id: "oversized", endpoint: "https://oversized-provider.example/search" }]),
    });
    const body = await response.json() as any;
    expect(body.results).toEqual([]);
    expect(body.attempts[0]).toMatchObject({ provider: "oversized", status: "error" });
    expect(body.attempts[0].message).toContain("524288-byte limit");
  });

  it("shares an in-flight Bright Data lookup and reuses its fresh result without another paid call", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ shopping_results: [{
      title: "BMP280 pressure sensor", product_id: "bmp280-1", current_price: { value: "$8.95" }, shop: "Example Electronics", link: "https://supplier.example/bmp280",
      thumbnail: { url: "https://images.example/bmp280.jpg" },
    }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      ...authEnv,
      BRIGHTDATA_SERP_ENABLED: "true",
      BRIGHTDATA_API_KEY: "test-only-key",
      BRIGHTDATA_MAX_REQUESTS_PER_HOUR: "2",
      BRIGHTDATA_MAX_REQUESTS_PER_DAY: "2",
      BRIGHTDATA_MAX_GLOBAL_REQUESTS_PER_DAY: "2",
    };
    const [first, second] = await Promise.all([
      partsSearch(await requestFor("BMP280"), env),
      partsSearch(await requestFor("BMP280"), env),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await first.json() as any).candidates[0]).toMatchObject({ source: "brightdata-serp", verificationRequired: true, price: 8.95, imageUrl: "https://images.example/bmp280.jpg" });
    expect((await second.json() as any).candidates[0]).toMatchObject({ source: "brightdata-serp" });
    const cached = await partsSearch(await requestFor("BMP280"), env);
    expect((await cached.json() as any).cacheHit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call Bright Data after a per-user spending limit is reached", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ shopping_results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { ...authEnv, BRIGHTDATA_SERP_ENABLED: "true", BRIGHTDATA_API_KEY: "test-only-key", BRIGHTDATA_MAX_REQUESTS_PER_HOUR: "1", BRIGHTDATA_MAX_REQUESTS_PER_DAY: "1", BRIGHTDATA_MAX_GLOBAL_REQUESTS_PER_DAY: "200" };
    const first = await partsSearch(await requestFor("quota-one", "quota-user"), env);
    expect(first.status).toBe(200);
    const limited = await partsSearch(await requestFor("quota-two", "quota-user"), env);
    expect(limited.status).toBe(429);
    expect((await limited.json() as any).code).toBe("BRIGHTDATA_RATE_LIMITED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
