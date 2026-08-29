import { create } from "zustand";
import { getCurrentUserId } from "../auth/session.ts";
import { getCatalogComponent } from "../data/catalog.ts";

export interface PartOffer {
  id: string;
  retailer: string;
  title: string;
  price: number | null;
  currency: string;
  url: string;
  availability?: string;
  fetchedAt: string;
  provider: string;
}

export interface AgentProvenance {
  source: "webmcp-agent";
  provider: string;
  agentId: string;
  publishedAt: string;
}

export interface AlternativePart {
  catalogId: string;
  title: string;
  reason: string;
  resultId?: string;
}

export interface ShoppingResult {
  id: string;
  catalogId: string;
  title: string;
  manufacturer?: string;
  partNumber: string;
  requestedQuantity: number;
  exactMatch: boolean;
  matchNote?: string;
  offers: PartOffer[];
  alternatives: AlternativePart[];
  updatedAt: string;
  provenance: AgentProvenance;
}

/**
 * A public-feed candidate is useful context for the browsing agent, but it is
 * deliberately not a ShoppingResult. It has no canonical Schematic identity
 * or verified retailer offer and therefore can never be added to the cart.
 */
export interface ShoppingDiscoveryCandidate {
  id: string;
  source: "jlcsearch" | "adafruit";
  sourcePartId: string;
  title: string;
  manufacturer?: string;
  partNumber: string;
  package?: string;
  description?: string;
  stock: number | null;
  availability?: string;
  price: number | null;
  currency: string | null;
  verificationUrl: string;
  verificationRequired: true;
}

export interface ShoppingDiscoveryAttempt {
  source: "jlcsearch" | "adafruit" | "request";
  status: "success" | "empty" | "error" | "timeout" | "rate_limited" | "circuit_open" | "skipped";
  durationMs: number;
  resultCount: number;
  cache?: "fresh" | "stale";
  retryAfterSeconds?: number;
  message?: string;
}

export interface ShoppingDiscovery {
  candidates: ShoppingDiscoveryCandidate[];
  sourceOrder: string[];
  attempts: ShoppingDiscoveryAttempt[];
  cacheHit: boolean;
  staleCache: boolean;
  rateLimited: boolean;
  retryAfterSeconds?: number;
  message: string;
}

export interface AgentPublication {
  authenticated: true;
  agentId: string;
  provider: string;
  publishedAt: string;
}

export type ShoppingRequestStatus = "idle" | "staged" | "searching" | "agent-required" | "ready" | "partial" | "rate-limited" | "failed";

/**
 * Stable handoff contract for an agent that can browse suppliers but cannot
 * publish into the page in the same turn. Keeping this JSON-shaped and free
 * of provider secrets lets another model resume the lookup safely.
 */
export interface ShoppingHandoff {
  schemaVersion: "schematic.parts.lookup.v1";
  requestId: string;
  requestType: "exact_parts_lookup";
  query: string;
  quantity: number;
  requiredCatalogIds: string[];
  providerFallbackOrder: string[];
  returnTool: "shopping.search";
  returnFormat: "json";
  constraints: {
    exactMatch: true;
    maxOffersPerListing: 3;
    maxListingAgeHours: 24;
    requireHttpsRetailerUrl: true;
    requireRecentTimestamp: true;
    noInventedCatalogIds: true;
  };
  listingFields: string[];
  offerFields: string[];
  publicationFields: string[];
  requestedAt: string;
}

export interface CartLine {
  resultId: string;
  quantity: number;
  selectedOfferId?: string;
}

export interface ShoppingState {
  query: string;
  results: ShoppingResult[];
  cart: CartLine[];
  budget: number | null;
  lastSearchAt: number | null;
  publicationError: string | null;
  requestStatus: ShoppingRequestStatus;
  handoff: ShoppingHandoff | null;
  discovery: ShoppingDiscovery | null;
  undoStack: CartLine[][];
  setQuery: (query: string) => void;
  setRequestStatus: (requestStatus: ShoppingRequestStatus) => void;
  setHandoff: (handoff: ShoppingHandoff | null) => void;
  setDiscovery: (discovery: ShoppingDiscovery | null) => void;
  setResults: (results: ShoppingResult[]) => void;
  publishAgentResults: (results: unknown, publication: AgentPublication) => { accepted: boolean; rejected: number; message?: string };
  addToCart: (resultId: string, quantity?: number) => void;
  removeFromCart: (resultId: string) => void;
  setQuantity: (resultId: string, quantity: number) => void;
  setOffer: (resultId: string, offerId: string) => void;
  chooseAlternative: (resultId: string, catalogId: string) => boolean;
  setBudget: (budget: number | null) => void;
  resetCart: (requiredCatalogIds?: string[]) => void;
  undoCart: () => void;
  clearResults: () => void;
  getQuote: () => { total: number; budget: number | null; overBudget: boolean; missingPrices: string[]; lines: { resultId: string; title: string; quantity: number; unitPrice: number | null; subtotal: number | null; offer?: PartOffer }[] };
}

const ANONYMOUS_STORAGE_KEY = "schematic-shopping";
const shoppingChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-shopping-sync") : null;
type PersistedShopping = Pick<ShoppingState, "query" | "results" | "cart" | "budget" | "lastSearchAt">;

// Retailer prices and availability are untrusted agent-reported data. Keep a
// narrow acceptance window so a replayed or clock-skewed publication cannot
// masquerade as a current offer in the workspace.
const MAX_OFFER_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_TIMESTAMP_FUTURE_SKEW_MS = 5 * 60 * 1000;

function validTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = Date.parse(value);
  const now = Date.now();
  return Number.isFinite(parsed)
    && parsed <= now + MAX_TIMESTAMP_FUTURE_SKEW_MS
    && parsed >= now - MAX_OFFER_AGE_MS;
}

function validUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    // Do not allow cleartext links or embedded credentials from an
    // untrusted agent publication. The retailer domain remains agent-owned
    // and is shown as a link only after this transport-level check.
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

function validCurrency(value: unknown) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function validListing(value: unknown): value is ShoppingResult {
  if (!value || typeof value !== "object") return false;
  const result = value as ShoppingResult;
  if (!result.id || !result.title || !getCatalogComponent(result.catalogId) || !result.partNumber || result.exactMatch !== true || !validTimestamp(result.updatedAt)) return false;
  if (!result.provenance || result.provenance.source !== "webmcp-agent" || !result.provenance.agentId || !result.provenance.provider || !validTimestamp(result.provenance.publishedAt)) return false;
  if (!Number.isInteger(result.requestedQuantity) || result.requestedQuantity < 1 || !Array.isArray(result.offers) || result.offers.length === 0) return false;
  const retailers = new Set<string>();
  return result.offers.every((offer) => {
    if (!offer || typeof offer !== "object") return false;
    const candidate = offer as Partial<PartOffer>;
    if (typeof candidate.retailer !== "string" || typeof candidate.title !== "string" || typeof candidate.provider !== "string") return false;
    const retailer = candidate.retailer.trim().toLowerCase();
    const validPrice = candidate.price === null || (typeof candidate.price === "number" && Number.isFinite(candidate.price) && candidate.price >= 0);
    if (retailers.has(retailer)) return false;
    retailers.add(retailer);
    return Boolean(candidate.id && candidate.retailer && candidate.title && candidate.provider === result.provenance.provider && validPrice && validCurrency(candidate.currency) && validUrl(candidate.url) && validTimestamp(candidate.fetchedAt));
  });
}

function validPublication(value: AgentPublication) {
  return Boolean(getCurrentUserId()) && value?.authenticated === true && Boolean(value.agentId?.trim()) && Boolean(value.provider?.trim()) && validTimestamp(value.publishedAt);
}

function storageKey() {
  const userId = getCurrentUserId();
  return userId && userId !== "local-development" ? ANONYMOUS_STORAGE_KEY + ":" + userId : ANONYMOUS_STORAGE_KEY;
}

function makeRequestId() {
  const randomUuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10);
  return `parts-${Date.now()}-${randomUuid}`;
}

export function createShoppingHandoff(query: string, quantity = 1, requiredCatalogIds: string[] = []): ShoppingHandoff {
  return {
    schemaVersion: "schematic.parts.lookup.v1",
    requestId: makeRequestId(),
    requestType: "exact_parts_lookup",
    query: query.trim(),
    quantity: safeQuantity(quantity),
    requiredCatalogIds: [...new Set(requiredCatalogIds.map(String).map((id) => id.trim()).filter(Boolean))],
    providerFallbackOrder: ["jlcsearch", "adafruit", "web-search"],
    returnTool: "shopping.search",
    returnFormat: "json",
    constraints: {
      exactMatch: true,
      maxOffersPerListing: 3,
      maxListingAgeHours: 24,
      requireHttpsRetailerUrl: true,
      requireRecentTimestamp: true,
      noInventedCatalogIds: true,
    },
    listingFields: ["id", "catalogId", "title", "manufacturer", "partNumber", "requestedQuantity", "exactMatch", "matchNote", "offers", "alternatives", "updatedAt"],
    offerFields: ["id", "retailer", "title", "price", "currency", "url", "availability", "fetchedAt", "provider"],
    publicationFields: ["provider", "publishedAt"],
    requestedAt: new Date().toISOString(),
  };
}

function roomId() {
  return getCurrentUserId();
}

function readState(): PersistedShopping {
  const fallback: PersistedShopping = { query: "", results: [], cart: [], budget: null, lastSearchAt: null };
  try {
    const raw = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(storageKey()) ?? "null") : null;
    const results = raw && typeof raw === "object" && Array.isArray(raw.results) ? raw.results.filter(validListing) : [];
    const cart = raw && typeof raw === "object" && Array.isArray(raw.cart)
      ? raw.cart.filter((line: CartLine) => results.some((result: ShoppingResult) => result.id === line.resultId))
      : [];
    return raw && typeof raw === "object" ? { ...fallback, ...raw, results, cart } : fallback;
  } catch { return fallback; }
}

function snapshot(state: ShoppingState): PersistedShopping { return { query: state.query, results: state.results, cart: state.cart, budget: state.budget, lastSearchAt: state.lastSearchAt }; }
function persist(state: ShoppingState, broadcast = true) {
  const next = snapshot(state);
  try { if (typeof localStorage !== "undefined") localStorage.setItem(storageKey(), JSON.stringify(next)); } catch {}
  if (broadcast) shoppingChannel?.postMessage({ type: "shopping:update", state: { ...next, _room: roomId() } });
}
function remember(cart: CartLine[]) { return [...cart.map((line) => ({ ...line }))]; }
function safeQuantity(value: number, fallback = 1) {
  return Number.isFinite(value) ? Math.min(999, Math.max(1, Math.round(value))) : fallback;
}
function cheapest(result: ShoppingResult) {
  return result.offers.reduce<PartOffer | undefined>((best, offer) => {
    if (offer.price === null || !Number.isFinite(offer.price)) return best;
    return !best || best.price === null || offer.price < best.price ? offer : best;
  }, undefined);
}

const initial = readState();
export const useShoppingStore = create<ShoppingState>((set, get) => ({
  ...initial,
  publicationError: null,
  requestStatus: "idle",
  handoff: null,
  discovery: null,
  undoStack: [],
  setQuery(query) { set({ query }); persist(get()); },
  setRequestStatus(requestStatus) { set({ requestStatus }); },
  setHandoff(handoff) { set({ handoff, requestStatus: handoff ? "staged" : "idle" }); },
  setDiscovery(discovery) {
    set({ discovery, requestStatus: discovery?.rateLimited && discovery.candidates.length === 0 ? "rate-limited" : discovery ? "agent-required" : "idle" });
  },
  setResults() {
    set({ results: [], cart: [], lastSearchAt: null, requestStatus: "failed", discovery: null, publicationError: "Parts shopping needs a connected, authenticated WebMCP agent before listings can be shown. The lookup request is ready to hand off." });
    persist(get());
  },
  publishAgentResults(rawResults, publication) {
    const results = Array.isArray(rawResults) ? rawResults : [];
    if (!validPublication(publication)) {
      set({ results: [], cart: [], lastSearchAt: null, requestStatus: "failed", publicationError: "Listing publication rejected: the WebMCP agent authentication or provider provenance is missing or invalid." });
      persist(get());
      return { accepted: false, rejected: results.length, message: get().publicationError ?? undefined };
    }
    const publishedAt = publication.publishedAt;
    const normalized = results.filter((result): result is ShoppingResult => {
      if (!validListing(result) || !result.provenance) return false;
      return result.provenance.agentId === publication.agentId && result.provenance.provider === publication.provider && result.provenance.publishedAt === publishedAt;
    });
    const rejected = results.length - normalized.length;
    if (normalized.length === 0) {
      const message = "Listing publication rejected: every listing needs a canonical catalogId, exactMatch=true, part number, an HTTPS retailer URL, a recent timestamp, currency, and provider provenance.";
      set({ results: [], cart: [], lastSearchAt: null, requestStatus: "failed", publicationError: message });
      persist(get());
      return { accepted: false, rejected, message };
    }
    set({ results: normalized, cart: [], lastSearchAt: Date.now(), requestStatus: rejected ? "partial" : "ready", handoff: null, discovery: null, publicationError: rejected ? `${rejected} malformed listing${rejected === 1 ? " was" : "s were"} rejected; showing only authenticated agent-sourced exact listings.` : null });
    persist(get());
    return { accepted: true, rejected };
  },
  addToCart(resultId, quantity = 1) {
    set((state) => {
      if (!state.results.some((result) => result.id === resultId && result.exactMatch)) return state;
      const exists = state.cart.find((line) => line.resultId === resultId);
      const amount = safeQuantity(quantity);
      const cart = exists ? state.cart.map((line) => line.resultId === resultId ? { ...line, quantity: safeQuantity(line.quantity + amount) } : line) : [...state.cart, { resultId, quantity: amount }];
      const next = { cart, undoStack: [...state.undoStack.slice(-19), remember(state.cart)] };
      persist({ ...state, ...next });
      return next;
    });
  },
  removeFromCart(resultId) {
    set((state) => {
      const next = { cart: state.cart.filter((line) => line.resultId !== resultId), undoStack: [...state.undoStack.slice(-19), remember(state.cart)] };
      persist({ ...state, ...next });
      return next;
    });
  },
  setQuantity(resultId, quantity) {
    set((state) => {
      const next = { cart: quantity <= 0 || !Number.isFinite(quantity) ? state.cart.filter((line) => line.resultId !== resultId) : state.cart.map((line) => line.resultId === resultId ? { ...line, quantity: safeQuantity(quantity) } : line), undoStack: [...state.undoStack.slice(-19), remember(state.cart)] };
      persist({ ...state, ...next });
      return next;
    });
  },
  setOffer(resultId, offerId) {
    set((state) => {
      const result = state.results.find((item) => item.id === resultId);
      if (!result?.offers.some((offer) => offer.id === offerId)) return state;
      const next = { cart: state.cart.map((line) => line.resultId === resultId ? { ...line, selectedOfferId: offerId } : line), undoStack: [...state.undoStack.slice(-19), remember(state.cart)] };
      persist({ ...state, ...next });
      return next;
    });
  },
  chooseAlternative(resultId, catalogId) {
    const state = get();
    const current = state.results.find((result) => result.id === resultId);
    const alternative = current?.alternatives.find((item) => item.catalogId === catalogId);
    const replacement = state.results.find((result) => result.catalogId === catalogId && result.exactMatch && (alternative?.resultId ? result.id === alternative.resultId : true));
    if (!alternative || !replacement) return false;
    set((currentState) => {
      const next = { cart: currentState.cart.map((line) => line.resultId === resultId ? { ...line, resultId: replacement.id, selectedOfferId: undefined } : line), undoStack: [...currentState.undoStack.slice(-19), remember(currentState.cart)] };
      persist({ ...currentState, ...next });
      return next;
    });
    return true;
  },
  setBudget(budget) {
    const next = budget === null || !Number.isFinite(budget) ? null : Math.max(0, Number(budget));
    set({ budget: next });
    persist(get());
  },
  resetCart(requiredCatalogIds) {
    set((state) => {
      const counts = new Map<string, number>();
      for (const catalogId of requiredCatalogIds ?? []) counts.set(catalogId, (counts.get(catalogId) ?? 0) + 1);
      const cart = [...counts.entries()].map(([catalogId, quantity]) => ({ result: state.results.find((item) => item.catalogId === catalogId && item.exactMatch), quantity })).filter((item): item is { result: ShoppingResult; quantity: number } => Boolean(item.result)).map(({ result, quantity }) => ({ resultId: result.id, quantity }));
      const next = { cart, undoStack: [...state.undoStack.slice(-19), remember(state.cart)] };
      persist({ ...state, ...next });
      return next;
    });
  },
  undoCart() {
    set((state) => {
      const previous = state.undoStack[state.undoStack.length - 1];
      if (!previous) return state;
      const next = { cart: previous, undoStack: state.undoStack.slice(0, -1) };
      persist({ ...state, ...next });
      return next;
    });
  },
  clearResults() {
    set({ results: [], cart: [], lastSearchAt: null, requestStatus: "idle", handoff: null, discovery: null, publicationError: null, undoStack: [] });
    persist(get());
  },
  getQuote() {
    const state = get();
    const lines = state.cart.map((line) => {
      const result = state.results.find((item) => item.id === line.resultId);
      const offer = result ? result.offers.find((item) => item.id === line.selectedOfferId) ?? cheapest(result) : undefined;
      const unitPrice = offer?.price ?? null;
      return { resultId: line.resultId, title: result?.title ?? "Missing listing", quantity: line.quantity, unitPrice, subtotal: unitPrice === null ? null : unitPrice * line.quantity, offer };
    });
    const total = lines.reduce((sum, line) => sum + (line.subtotal ?? 0), 0);
    return { total, budget: state.budget, overBudget: state.budget !== null && total > state.budget, missingPrices: lines.filter((line) => line.unitPrice === null).map((line) => line.title), lines };
  },
}));

shoppingChannel?.addEventListener("message", (event) => {
  if (event.data?.type !== "shopping:update" || !event.data.state) return;
  if ((event.data.state._room ?? null) !== roomId()) return;
  const { _room: _ignoredRoom, ...state } = event.data.state;
  useShoppingStore.setState(state);
});

export function reloadShoppingForCurrentUser() {
  const next = readState();
  useShoppingStore.setState({ ...next, requestStatus: "idle", handoff: null, discovery: null, publicationError: null, undoStack: [] });
  shoppingChannel?.postMessage({ type: "shopping:update", state: { ...next, _room: roomId() } });
}

if (typeof window !== "undefined") {
  window.addEventListener("schematic-session", () => reloadShoppingForCurrentUser());
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey() || !event.newValue) return;
    try {
      const next = JSON.parse(event.newValue) as PersistedShopping;
      if (next && typeof next === "object") useShoppingStore.setState({ ...next, requestStatus: "idle", handoff: null, discovery: null, publicationError: null, undoStack: [] });
    } catch {}
  });
}
