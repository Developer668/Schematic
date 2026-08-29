import { beforeEach, describe, expect, it } from "vitest";
import { useShoppingStore, type AgentPublication, type ShoppingResult } from "../store/useShoppingStore.ts";

const publication: AgentPublication = {
  authenticated: true,
  agentId: "chatgpt-webmcp-agent",
  provider: "Digi-Key",
  publishedAt: new Date().toISOString(),
};

function listing(overrides: Partial<ShoppingResult> = {}): ShoppingResult {
  return {
    id: "listing-esp32",
    catalogId: "esp32-s3",
    title: "ESP32-S3 DevKit",
    manufacturer: "Espressif",
    partNumber: "ESP32-S3-DevKitC-1",
    requestedQuantity: 1,
    exactMatch: true,
    offers: [{
      id: "offer-esp32",
      retailer: "Digi-Key",
      title: "ESP32-S3 DevKit",
      price: 8.5,
      currency: "USD",
      url: "https://www.digikey.com/en/products/detail/espressif-systems/ESP32-S3-DEVKITC-1/",
      fetchedAt: publication.publishedAt,
      provider: publication.provider,
    }],
    alternatives: [],
    updatedAt: publication.publishedAt,
    provenance: { source: "webmcp-agent", provider: publication.provider, agentId: publication.agentId, publishedAt: publication.publishedAt },
    ...overrides,
  };
}

function resetStore() {
  useShoppingStore.setState({ query: "", results: [], cart: [], budget: null, lastSearchAt: null, publicationError: null, undoStack: [] });
}

describe("WebMCP-only shopping publication", () => {
  beforeEach(resetStore);

  it("shows no listings without an agent publication", () => {
    useShoppingStore.getState().setResults([listing()]);
    expect(useShoppingStore.getState().results).toHaveLength(0);
    expect(useShoppingStore.getState().publicationError).toMatch(/authenticated WebMCP agent/i);
  });

  it("accepts a valid authenticated agent publication", () => {
    const result = useShoppingStore.getState().publishAgentResults([listing()], publication);
    expect(result).toEqual({ accepted: true, rejected: 0 });
    expect(useShoppingStore.getState().results[0].catalogId).toBe("esp32-s3");
  });

  it("visibly rejects incomplete exact-match or provenance data", () => {
    const invalid = listing({ exactMatch: false, provenance: { source: "webmcp-agent", provider: "", agentId: "", publishedAt: "not-a-date" } });
    const result = useShoppingStore.getState().publishAgentResults([invalid], publication);
    expect(result.accepted).toBe(false);
    expect(result.rejected).toBe(1);
    expect(useShoppingStore.getState().results).toHaveLength(0);
    expect(useShoppingStore.getState().publicationError).toMatch(/canonical catalogId/i);
  });

  it("keeps cheapest totals, budget, and cart quantity functional", () => {
    const first = listing();
    const second = listing({ id: "listing-led", catalogId: "led", title: "LED", partNumber: "LED-5MM", offers: [{ ...first.offers[0], id: "offer-led", price: 1.25 }] });
    useShoppingStore.getState().publishAgentResults([first, second], publication);
    useShoppingStore.getState().addToCart(first.id, 2);
    useShoppingStore.getState().addToCart(second.id, 3);
    useShoppingStore.getState().setBudget(25);
    const quote = useShoppingStore.getState().getQuote();
    expect(quote.total).toBe(20.75);
    expect(quote.overBudget).toBe(false);
    useShoppingStore.getState().setQuantity(first.id, 4);
    expect(useShoppingStore.getState().getQuote().overBudget).toBe(true);
    useShoppingStore.getState().undoCart();
    expect(useShoppingStore.getState().getQuote().total).toBe(20.75);
  });

  it("supports authenticated alternatives only when the alternative was also published", () => {
    const primary = listing({ alternatives: [{ catalogId: "led", title: "LED", reason: "Lower cost", resultId: "listing-led" }] });
    const alternative = listing({ id: "listing-led", catalogId: "led", title: "LED", partNumber: "LED-5MM", offers: [{ ...listing().offers[0], id: "offer-led", price: 1.25 }] });
    useShoppingStore.getState().publishAgentResults([primary, alternative], publication);
    useShoppingStore.getState().addToCart(primary.id);
    expect(useShoppingStore.getState().chooseAlternative(primary.id, "led")).toBe(true);
    expect(useShoppingStore.getState().cart[0].resultId).toBe("listing-led");
  });

  it("fails closed for duplicate retailers and invalid prices", () => {
    const duplicateRetailers = listing({
      offers: [
        listing().offers[0],
        { ...listing().offers[0], id: "offer-esp32-duplicate", retailer: "digi-key", price: 9 },
      ],
    });
    const invalidPrice = listing({
      id: "listing-invalid-price",
      offers: [{ ...listing().offers[0], id: "offer-invalid-price", price: -0.01 }],
    });

    const result = useShoppingStore.getState().publishAgentResults([duplicateRetailers, invalidPrice], publication);
    expect(result.accepted).toBe(false);
    expect(result.rejected).toBe(2);
    expect(useShoppingStore.getState().results).toHaveLength(0);
  });

  it("rejects cleartext retailer URLs and stale or future publications", () => {
    const now = Date.now();
    const staleAt = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const stale = listing({
      updatedAt: staleAt,
      offers: [{ ...listing().offers[0], fetchedAt: staleAt }],
      provenance: { ...listing().provenance, publishedAt: staleAt },
    });
    expect(useShoppingStore.getState().publishAgentResults([stale], { ...publication, publishedAt: staleAt }).accepted).toBe(false);

    const futureAt = new Date(now + 60 * 60 * 1000).toISOString();
    const future = listing({
      updatedAt: futureAt,
      offers: [{ ...listing().offers[0], fetchedAt: futureAt }],
      provenance: { ...listing().provenance, publishedAt: futureAt },
    });
    expect(useShoppingStore.getState().publishAgentResults([future], { ...publication, publishedAt: futureAt }).accepted).toBe(false);

    const cleartext = listing({ offers: [{ ...listing().offers[0], url: "http://retailer.example/part" }] });
    expect(useShoppingStore.getState().publishAgentResults([cleartext], publication).accepted).toBe(false);
  });
});
