import { describe, expect, it, vi } from "vitest";
import { createPartsSearchCoordinator, requestPartsSearch } from "../shopping/partsSearchClient.ts";

function publicEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    code: "PUBLIC_CANDIDATES",
    source: "public-source-discovery",
    candidates: [{ id: "jlcsearch:123", source: "jlcsearch", sourcePartId: "123", title: "ESP32-S3 module", partNumber: "ESP32-S3-WROOM-1", stock: 42, price: 3.25, currency: "USD", verificationUrl: "https://www.lcsc.com/search?q=ESP32-S3-WROOM-1", verificationRequired: true }],
    sourceOrder: ["jlcsearch", "adafruit", "web-search"],
    attempts: [{ source: "jlcsearch", status: "success", durationMs: 12, resultCount: 1 }],
    rateLimited: false,
    message: "Public candidates returned.",
    ...overrides,
  };
}

describe("parts search client", () => {
  it("normalizes public candidates without treating them as verified offers", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(publicEnvelope()), { status: 200, headers: { "content-type": "application/json" } }));
    const outcome = await requestPartsSearch({ requestId: "parts-test-1", query: "ESP32-S3", quantity: 2, requiredCatalogIds: [], requestedAt: new Date().toISOString() }, { fetchImpl, getAuthHeaders: async () => ({}) });

    expect(outcome.status).toBe("agent-required");
    expect(outcome.discovery?.candidates[0]).toMatchObject({ source: "jlcsearch", partNumber: "ESP32-S3-WROOM-1", verificationRequired: true });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("query=ESP32-S3"), expect.objectContaining({ credentials: "include" }));
  });

  it("refreshes authentication once after an expired session response", async () => {
    const auth = vi.fn(async (force = false) => ({ Authorization: `Bearer ${force ? "fresh" : "stale"}` }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(publicEnvelope()), { status: 200 }));
    const outcome = await requestPartsSearch({ requestId: "parts-test-2", query: "ESP32", quantity: 1, requiredCatalogIds: [], requestedAt: new Date().toISOString() }, { fetchImpl, getAuthHeaders: auth });

    expect(outcome.status).toBe("agent-required");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(auth.mock.calls.map(([force]) => force)).toEqual([false, true]);
  });

  it("cancels the previous request and ignores a late response", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => String(input).includes("FIRST")
      ? new Promise<Response>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve(new Response(JSON.stringify(publicEnvelope()), { status: 200 })));
    const coordinator = createPartsSearchCoordinator({ fetchImpl, getAuthHeaders: async () => ({}) });
    const first = coordinator.submit({ query: "FIRST" });
    await Promise.resolve();
    const second = coordinator.submit({ query: "SECOND" });
    const secondOutcome = await second;
    resolveFirst?.(new Response(JSON.stringify(publicEnvelope()), { status: 200 }));
    const firstOutcome = await first;

    expect(secondOutcome.status).toBe("agent-required");
    expect(firstOutcome.status).toBe("cancelled");
  });
});
