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

  it("keeps the current handoff identity when serving a cached discovery", async () => {
    let now = 1_000;
    let id = 0;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(publicEnvelope()), { status: 200 }));
    const coordinator = createPartsSearchCoordinator({
      fetchImpl,
      now: () => now,
      requestIdFactory: () => `parts-cache-${++id}`,
    });

    const first = await coordinator.submit({ query: "ESP32-S3", requestedAt: "2026-08-31T00:00:00.000Z" });
    now += 1_000;
    const second = await coordinator.submit({ query: "ESP32-S3", requestedAt: "2026-08-31T00:00:01.000Z" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.requestId).toBe("parts-cache-1");
    expect(second.requestId).toBe("parts-cache-2");
    expect(second.request.requestedAt).toBe("2026-08-31T00:00:01.000Z");
    expect(second.discovery).toEqual(first.discovery);
  });

  it("keeps deduped handoffs distinct and lets a caller cancel its wait", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const coordinator = createPartsSearchCoordinator({ fetchImpl, getAuthHeaders: async () => ({}) });
    const first = coordinator.submit({ requestId: "parts-inflight-first", query: "ESP32", quantity: 1 });
    const secondController = new AbortController();
    const second = coordinator.submit(
      { requestId: "parts-inflight-second", query: "ESP32", quantity: 1 },
      { signal: secondController.signal },
    );

    secondController.abort();
    const secondOutcome = await second;
    resolveFetch?.(new Response(JSON.stringify(publicEnvelope()), { status: 200 }));
    const firstOutcome = await first;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(secondOutcome).toMatchObject({ requestId: "parts-inflight-second", status: "cancelled" });
    expect(firstOutcome).toMatchObject({ requestId: "parts-inflight-first", status: "agent-required" });
  });

  it("surfaces a rate limit with a retry delay", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Please retry shortly", retryAfterSeconds: 3 }), { status: 429, headers: { "retry-after": "3" } }));
    const outcome = await requestPartsSearch({ requestId: "parts-rate-limit", query: "ESP32", quantity: 1, requiredCatalogIds: [], requestedAt: new Date().toISOString() }, { fetchImpl });

    expect(outcome.status).toBe("rate-limited");
    expect(outcome.error).toBe("Please retry shortly");
    expect(outcome.retryAfterMs).toBe(3_000);
  });

  it("turns an upstream failure into a recoverable failed outcome", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Supplier unavailable" }), { status: 503 }));
    const outcome = await requestPartsSearch({ requestId: "parts-failed", query: "ESP32", quantity: 1, requiredCatalogIds: [], requestedAt: new Date().toISOString() }, { fetchImpl });

    expect(outcome.status).toBe("failed");
    expect(outcome.httpStatus).toBe(503);
    expect(outcome.error).toBe("Supplier unavailable");
  });
});
