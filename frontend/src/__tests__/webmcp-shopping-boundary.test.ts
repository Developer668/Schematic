import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => {
  const state: { session: any } = { session: null };
  return {
    state,
    getAuthSession: vi.fn(async () => state.session),
  };
});

vi.mock("../auth/session.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/session.ts")>();
  return { ...actual, getAuthSession: auth.getAuthSession, waitForAuth: auth.getAuthSession };
});

import { useProjectStore } from "../store/useProjectStore.ts";
import { useShoppingStore } from "../store/useShoppingStore.ts";
import { invokeWebMCPTool, getRegisteredToolNames, unregisterWebMCPTools, WEBMCP_TOOL_COUNT } from "../webmcp/tools.ts";

const publicationTime = () => new Date().toISOString();

function signedIn() {
  return {
    authenticated: true,
    subject: "shopping-test-agent",
    userId: "shopping-test-agent",
    environment: "chatgpt-sites",
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  const publishedAt = publicationTime();
  return {
    id: "listing-esp32-s3",
    catalogId: "esp32-s3",
    title: "ESP32-S3 DevKit",
    partNumber: "ESP32-S3-DevKitC-1",
    requestedQuantity: 2,
    exactMatch: true,
    updatedAt: publishedAt,
    offers: [{
      id: "offer-esp32-s3",
      retailer: "Digi-Key",
      title: "ESP32-S3 DevKitC-1",
      price: 8.5,
      currency: "USD",
      url: "https://www.digikey.com/en/products/detail/espressif-systems/ESP32-S3-DEVKITC-1/",
      fetchedAt: publishedAt,
      provider: "Digi-Key",
    }],
    alternatives: [],
    provenance: { source: "webmcp-agent", provider: "Digi-Key", agentId: "caller-asserted", publishedAt },
    ...overrides,
  };
}

function publication(publishedAt = publicationTime()) {
  return { authenticated: true, agentId: "caller-asserted", provider: "Digi-Key", publishedAt };
}

function publicDiscoveryResponse() {
  return {
    code: "PUBLIC_CANDIDATES",
    source: "public-source-discovery",
    candidates: [{
      id: "jlcsearch:123456",
      source: "jlcsearch",
      sourcePartId: "123456",
      title: "ESP32-S3-WROOM-1",
      manufacturer: "Espressif",
      partNumber: "ESP32-S3-WROOM-1",
      package: "SMD",
      description: "Public discovery candidate",
      stock: 1200,
      price: 3.25,
      currency: "USD",
      verificationUrl: "https://www.lcsc.com/product-detail/esp32.html",
      verificationRequired: true,
    }],
    results: [],
    attempts: [{ source: "jlcsearch", status: "success", durationMs: 12, resultCount: 1 }],
    sourceOrder: ["jlcsearch", "adafruit", "web-search"],
    cacheHit: false,
    staleCache: false,
    rateLimited: false,
    message: "Public candidates returned.",
  };
}

describe("WebMCP shopping trust boundary", () => {
  beforeEach(() => {
    auth.state.session = signedIn();
    useProjectStore.getState().clear();
    useShoppingStore.getState().clearResults();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/parts/search")) return new Response(JSON.stringify(publicDiscoveryResponse()), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ authenticated: true, subject: "shopping-test-agent", environment: "chatgpt-sites" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  afterEach(() => {
    unregisterWebMCPTools();
    useShoppingStore.getState().clearResults();
    auth.state.session = null;
    vi.unstubAllGlobals();
  });

  it("keeps the registry at exactly 42 tools and preserves instance-port wiring", async () => {
    expect(WEBMCP_TOOL_COUNT).toBe(42);
    expect(getRegisteredToolNames()).toHaveLength(42);
    const board: any = await invokeWebMCPTool("component.add", { componentId: "esp32-devkit-v1" });
    const led: any = await invokeWebMCPTool("component.add", { componentId: "led" });
    const ports: any = await invokeWebMCPTool("component.list_ports", { componentId: board.data.instanceId });
    expect(ports.isError).not.toBe(true);
    expect(ports.data.some((port: any) => port.id === "GPIO19")).toBe(true);

    const connected: any = await invokeWebMCPTool("connection.connect", {
      sourceComponentId: board.data.instanceId,
      sourcePortId: "GPIO19",
      targetComponentId: led.data.instanceId,
      targetPortId: "IN",
    });
    expect(connected.isError).not.toBe(true);
    expect(connected.data.resolved.source.componentId).toBe(board.data.instanceId);
    expect(useProjectStore.getState().project.connections).toHaveLength(1);
  });

  it("returns strict JSON discovery and leaves public candidates out of listings and cart", async () => {
    const result: any = await invokeWebMCPTool("shopping.search", { query: "ESP32-S3", quantity: 2 });

    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("AGENT_PUBLICATION_REQUIRED");
    expect(result.data.discovery.candidates).toHaveLength(1);
    expect(result.data.handoff.schemaVersion).toBe("schematic.parts.lookup.v1");
    expect(result.data.handoff.returnTool).toBe("shopping.search");
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    expect(result.data.results).toEqual([]);
    expect(useShoppingStore.getState().results).toEqual([]);
    expect(useShoppingStore.getState().cart).toEqual([]);

    const state: any = await invokeWebMCPTool("shopping.get_state");
    expect(state.data.pendingRequest).toMatchObject({ query: "ESP32-S3", quantity: 2 });
    expect(state.data.handoff.schemaVersion).toBe("schematic.parts.lookup.v1");
    expect(state.data.discovery.candidates[0].verificationRequired).toBe(true);
    expect(state.data.results).toEqual([]);
  });

  it("publishes only the second-call exact listing after trusted auth", async () => {
    const first: any = await invokeWebMCPTool("shopping.search", { query: "ESP32-S3", quantity: 2 });
    const publishedAt = publicationTime();
    const second: any = await invokeWebMCPTool("shopping.search", {
      query: first.data.handoff.query,
      quantity: first.data.handoff.quantity,
      listings: [listing({ updatedAt: publishedAt, offers: [{ ...listing().offers[0], fetchedAt: publishedAt }] })],
      publication: publication(publishedAt),
    });

    expect(second.isError).not.toBe(true);
    expect(second.data.accepted).toBe(true);
    expect(second.data.results).toHaveLength(1);
    expect(second.data.results[0].provenance.agentId).toBe("webmcp:chatgpt-sites:shopping-test-agent");
    expect(second.data.discovery).toBeNull();
    expect(second.data.handoff).toBeNull();

    const state: any = await invokeWebMCPTool("shopping.get_state");
    expect(state.data.results).toHaveLength(1);
    expect(state.data.pendingRequest).toBeNull();
    expect(state.data.discovery).toBeNull();
    expect(state.data.cart).toEqual([]);
  });

  it("rejects self-asserted publication without trusted WebMCP auth", async () => {
    auth.state.session = null;
    const result: any = await invokeWebMCPTool("shopping.search", {
      query: "ESP32-S3",
      listings: [listing()],
      publication: publication(),
      __trustedAuth: { authenticated: true, subject: "spoofed-caller", environment: "chatgpt-sites" },
    });

    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("AUTH_REQUIRED");
    expect(result.data.results).toEqual([]);
    expect(useShoppingStore.getState().results).toEqual([]);
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it("returns stable codes for canonical, strict-shape, secure-URL, and stale failures", async () => {
    const canonical: any = await invokeWebMCPTool("shopping.search", {
      query: "ESP32-S3",
      listings: [listing({ catalogId: "invented-part-id" })],
      publication: publication(),
    });
    expect(canonical.isError).toBe(true);
    expect(canonical.data.code).toBe("NON_CANONICAL_CATALOG_ID");
    expect(canonical.data.rejected[0].code).toBe("NON_CANONICAL_CATALOG_ID");

    const strict: any = await invokeWebMCPTool("shopping.search", {
      query: "ESP32-S3",
      listings: [listing({ offers: [{ ...listing().offers[0], price: "8.50" }] })],
      publication: publication(),
    });
    expect(strict.isError).toBe(true);
    expect(strict.data.code).toBe("MALFORMED_LISTING");
    expect(() => JSON.parse(strict.content[0].text)).not.toThrow();

    const insecure: any = await invokeWebMCPTool("shopping.search", {
      query: "ESP32-S3",
      listings: [listing({ offers: [{ ...listing().offers[0], url: "http://retailer.example/esp32" }] })],
      publication: publication(),
    });
    expect(insecure.isError).toBe(true);
    expect(insecure.data.code).toBe("NON_HTTPS_OFFER");

    const staleAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const stale: any = await invokeWebMCPTool("shopping.search", {
      query: "ESP32-S3",
      listings: [listing({ updatedAt: staleAt, offers: [{ ...listing().offers[0], fetchedAt: staleAt }] })],
      publication: publication(staleAt),
    });
    expect(stale.isError).toBe(true);
    expect(stale.data.code).toBe("STALE_PUBLICATION");
    expect(useShoppingStore.getState().results).toEqual([]);
  });
});
