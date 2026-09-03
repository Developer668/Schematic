import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: "shopping-cache-user" as string | null }));

vi.mock("../auth/session.ts", () => ({
  apiUrl: (path: string) => path,
  getAuthHeaders: async () => ({}),
  getCurrentUserId: () => auth.userId,
}));

const { requestPartsSearch } = await import("../shopping/partsSearchClient.ts");

function envelope() {
  return {
    code: "PUBLIC_CANDIDATES",
    source: "public-source-discovery",
    candidates: [{ id: "jlcsearch:1", source: "jlcsearch", sourcePartId: "1", title: "BMP280", partNumber: "BMP280", price: 4, currency: "USD", stock: 4, verificationUrl: "https://www.lcsc.com/search?q=BMP280", verificationRequired: true }],
    sourceOrder: ["jlcsearch"],
    attempts: [{ source: "jlcsearch", status: "success", durationMs: 10, resultCount: 1 }],
    rateLimited: false,
    message: "Public candidates returned.",
  };
}

function request(query: string) {
  return { requestId: `parts-${query}`, query, quantity: 1, requiredCatalogIds: [], requestedAt: "2026-09-03T00:00:00.000Z" };
}

describe("persistent parts lookup cache", () => {
  beforeEach(() => {
    auth.userId = "shopping-cache-user";
    localStorage.clear();
  });

  it("remembers a lookup across coordinators and does not request the provider again", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(envelope()), { status: 200 }));
    const first = await requestPartsSearch(request("deleted-component"), { fetchImpl, now: () => now, getAuthHeaders: async () => ({}) });
    expect(first.discovery?.candidates).toHaveLength(1);

    now += 1_000;
    const second = await requestPartsSearch(request("deleted-component"), { fetchImpl, now: () => now, getAuthHeaders: async () => ({}) });
    expect(second.discovery?.cacheHit).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes only after the 24-hour freshness window", async () => {
    let now = 2_000_000;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(envelope()), { status: 200 }));
    await requestPartsSearch(request("new-component"), { fetchImpl, now: () => now, getAuthHeaders: async () => ({}) });
    now += 24 * 60 * 60 * 1000 + 1;
    const refreshed = await requestPartsSearch({ ...request("new-component"), requestId: "parts-new-component-refresh" }, { fetchImpl, now: () => now, getAuthHeaders: async () => ({}) });
    expect(refreshed.discovery?.cacheHit).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
