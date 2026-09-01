import { afterEach, describe, expect, it, vi } from "vitest";
import { issueSessionToken, type AuthEnv } from "../../../functions/_auth.ts";
import { partsSearch } from "../../../functions/api/parts/search.ts";

const authEnv: AuthEnv = {
  SCHEMATIC_AUTH_MODE: "chatgpt-sites",
  SCHEMATIC_DEPLOYMENT_ENV: "production",
  SCHEMATIC_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

async function requestFor(query: string, subject = `public-parts-${query}`) {
  const token = await issueSessionToken({ subject, environment: "chatgpt-sites" }, authEnv);
  return new Request(`https://schematic.example/api/parts/search?query=${encodeURIComponent(query)}&quantity=2`, { headers: { Authorization: `Bearer ${token}` } });
}

describe("keyless public parts discovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes JLCSearch candidates without promoting them to offers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toMatch(/^https:\/\/jlcsearch\.tscircuit\.com\/api\/search\?/);
      return new Response(JSON.stringify({ components: [{ lcsc: 123456, mfr: "ESP32-S3-WROOM-1", package: "SMD", stock: 1200, price: 3.25 }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await partsSearch(await requestFor("ESP32-S3-PUBLIC-A"), authEnv);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.code).toBe("PUBLIC_CANDIDATES");
    expect(body.source).toBe("public-source-discovery");
    expect(body.results).toEqual([]);
    expect(body.candidates[0]).toMatchObject({ source: "jlcsearch", sourcePartId: "123456", partNumber: "ESP32-S3-WROOM-1", verificationRequired: true, price: 3.25, stock: 1200 });
    expect(body.candidates[0].verificationUrl).toMatch(/^https:\/\/www\.lcsc\.com\//);
    expect(body.publication.required).toBe(true);
  });

  it("uses the no-key Adafruit product endpoint for an exact product number", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://www.adafruit.com/api/product/5020");
      return new Response(JSON.stringify({ product_name: "Adafruit ESP32-S3 Feather", product_mpn: "ADA-5020", product_price: "$24.95", product_stock: 7, product_url: "https://www.adafruit.com/product/5020" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await partsSearch(await requestFor("Adafruit 5020"), authEnv);
    const body = await response.json() as any;
    expect(body.code).toBe("PUBLIC_CANDIDATES");
    expect(body.candidates[0]).toMatchObject({ source: "adafruit", sourcePartId: "5020", partNumber: "ADA-5020", price: 24.95, stock: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the agent handoff when a public source is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream unavailable", { status: 503 })));
    const response = await partsSearch(await requestFor("public-unavailable-c"), authEnv);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.code).toBe("PUBLIC_SOURCE_DEGRADED");
    expect(body.source).toBe("agent-handoff");
    expect(body.handoff).toMatchObject({ schemaVersion: "schematic.parts.lookup.v1", returnTool: "shopping.search", returnFormat: "json", discoveryMode: "public-no-key" });
    expect(body.handoff.nextAction).toMatch(/browsing-agent/i);
  });

  it("rejects an oversized public response even when Content-Length lies low", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(512 * 1024 + 1), { status: 200, headers: { "content-length": "1" } })));
    const response = await partsSearch(await requestFor("oversized-public-response"), authEnv);
    const body = await response.json() as any;
    expect(body.results).toEqual([]);
    expect(body.code).toBe("PUBLIC_SOURCE_DEGRADED");
    expect(body.attempts[0]).toMatchObject({ source: "jlcsearch", status: "error" });
    expect(body.attempts[0].message).toContain("524288-byte limit");
  });

  it("returns a safe handoff after the per-room burst limit", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ components: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const subject = "public-parts-burst-limit";
    const requests = await Promise.all(Array.from({ length: 5 }, () => requestFor("burst-limit-query", subject)));
    const responses = await Promise.all(requests.map((request) => partsSearch(request, authEnv)));
    const bodies = await Promise.all(responses.map(async (response) => ({ response, body: await response.json() as any })));
    const limited = bodies.find(({ body }) => body.code === "PUBLIC_SOURCE_RATE_LIMITED");
    expect(limited).toBeTruthy();
    expect(limited?.response.status).toBe(200);
    expect(limited?.body.handoff.schemaVersion).toBe("schematic.parts.lookup.v1");
    expect(limited?.body.providerFallback.rateLimited).toBe(true);
  });
});
