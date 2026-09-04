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
export type ShoppingDiscoverySource = "jlcsearch" | "adafruit" | "brightdata-serp";

export interface ShoppingDiscoveryCandidate {
  id: string;
  source: ShoppingDiscoverySource;
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
  retailer?: string;
  shipping?: string;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  rank?: number;
  catalogId?: string;
  matchNote?: string;
}

export interface ShoppingDiscoveryAttempt {
  source: ShoppingDiscoverySource | "request";
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
type PersistedShopping = Pick<ShoppingState, "query" | "results" | "cart" | "budget" | "lastSearchAt" | "handoff" | "discovery">;

// Retailer prices and availability are untrusted agent-reported data. Keep a
// narrow acceptance window so a replayed or clock-skewed publication cannot
// masquerade as a current offer in the workspace.
const MAX_OFFER_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_TIMESTAMP_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_SHOPPING_QUERY_LENGTH = 240;
const MAX_SHOPPING_RESULTS = 24;
const MAX_SHOPPING_OFFERS = 3;
const MAX_SHOPPING_ALTERNATIVES = 3;
const MAX_SHOPPING_PERSISTED_BYTES = 256 * 1024;

function boundedString(value: unknown, max: number, required = true): value is string {
  if (typeof value !== "string" || value.length > max) return false;
  return required ? value.trim().length > 0 : true;
}

function jsonBytes(value: unknown) {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; }
}

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
    // Do not allow cleartext links, embedded credentials, or Google search
    // result fallbacks to masquerade as a direct retailer offer.
    const googleSearchFallback = (url.hostname === "google.com" || url.hostname.endsWith(".google.com"))
      && (url.pathname === "/search" || url.pathname === "/url");
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !googleSearchFallback;
  } catch { return false; }
}

function validCurrency(value: unknown) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function validListing(value: unknown): value is ShoppingResult {
  if (!value || typeof value !== "object") return false;
  const result = value as ShoppingResult;
  if (!boundedString(result.id, 160) || !boundedString(result.title, 240) || !boundedString(result.catalogId, 120) || !getCatalogComponent(result.catalogId) || !boundedString(result.partNumber, 160) || result.exactMatch !== true || !validTimestamp(result.updatedAt)) return false;
  if (result.manufacturer !== undefined && !boundedString(result.manufacturer, 160, false)) return false;
  if (result.matchNote !== undefined && !boundedString(result.matchNote, 500, false)) return false;
  if (!result.provenance || result.provenance.source !== "webmcp-agent" || !boundedString(result.provenance.agentId, 240) || !boundedString(result.provenance.provider, 120) || !validTimestamp(result.provenance.publishedAt)) return false;
  if (!Number.isInteger(result.requestedQuantity) || result.requestedQuantity < 1 || result.requestedQuantity > 999 || !Array.isArray(result.offers) || result.offers.length === 0 || result.offers.length > MAX_SHOPPING_OFFERS) return false;
  if (!Array.isArray(result.alternatives) || result.alternatives.length > MAX_SHOPPING_ALTERNATIVES || !result.alternatives.every((alternative) => alternative
    && boundedString(alternative.catalogId, 120)
    && Boolean(getCatalogComponent(alternative.catalogId))
    && boundedString(alternative.title, 240)
    && boundedString(alternative.reason, 500)
    && (alternative.resultId === undefined || boundedString(alternative.resultId, 160)))) return false;
  const retailers = new Set<string>();
  return result.offers.every((offer) => {
    if (!offer || typeof offer !== "object") return false;
    const candidate = offer as Partial<PartOffer>;
    if (!boundedString(candidate.id, 160) || !boundedString(candidate.retailer, 160) || !boundedString(candidate.title, 240) || !boundedString(candidate.provider, 120)) return false;
    if (candidate.availability !== undefined && !boundedString(candidate.availability, 160, false)) return false;
    if (!boundedString(candidate.url, 2_000)) return false;
    const retailer = candidate.retailer.trim().toLowerCase();
    const validPrice = candidate.price === null || (typeof candidate.price === "number" && Number.isFinite(candidate.price) && candidate.price >= 0);
    if (retailers.has(retailer)) return false;
    retailers.add(retailer);
    return Boolean(candidate.id && candidate.retailer && candidate.title && candidate.provider === result.provenance.provider && validPrice && validCurrency(candidate.currency) && validUrl(candidate.url) && validTimestamp(candidate.fetchedAt));
  });
}

function cloneListing(result: ShoppingResult): ShoppingResult {
  return {
    id: result.id,
    catalogId: result.catalogId,
    title: result.title,
    ...(result.manufacturer !== undefined ? { manufacturer: result.manufacturer } : {}),
    partNumber: result.partNumber,
    requestedQuantity: result.requestedQuantity,
    exactMatch: true,
    ...(result.matchNote !== undefined ? { matchNote: result.matchNote } : {}),
    offers: result.offers.map((offer) => ({ ...offer })),
    alternatives: result.alternatives.map((alternative) => ({ ...alternative })),
    updatedAt: result.updatedAt,
    provenance: { ...result.provenance },
  };
}

function validPublication(value: AgentPublication) {
  return Boolean(getCurrentUserId()) && value?.authenticated === true && boundedString(value.agentId, 240) && boundedString(value.provider, 120) && validTimestamp(value.publishedAt);
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
    query: query.trim().slice(0, MAX_SHOPPING_QUERY_LENGTH),
    quantity: safeQuantity(quantity),
    requiredCatalogIds: [...new Set(requiredCatalogIds.slice(0, 500).map(String).map((id) => id.trim().slice(0, 120)).filter(Boolean))],
    providerFallbackOrder: ["brightdata-serp"],
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

function normalizePersistedState(raw: unknown): PersistedShopping {
  const fallback: PersistedShopping = { query: "", results: [], cart: [], budget: null, lastSearchAt: null, handoff: null, discovery: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || jsonBytes(raw) > MAX_SHOPPING_PERSISTED_BYTES) return fallback;
  const value = raw as Record<string, unknown>;
  const query = boundedString(value.query, MAX_SHOPPING_QUERY_LENGTH, false) ? value.query : "";
  const results = Array.isArray(value.results) ? value.results.slice(0, MAX_SHOPPING_RESULTS).filter(validListing).map(cloneListing) : [];
  const resultIds = new Set(results.map((result) => result.id));
  const cart = Array.isArray(value.cart) ? value.cart.slice(0, 100).flatMap((entry): CartLine[] => {
    if (!entry || typeof entry !== "object") return [];
    const line = entry as Record<string, unknown>;
    if (!boundedString(line.resultId, 160) || !resultIds.has(line.resultId) || !Number.isInteger(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 999) return [];
    if (line.selectedOfferId !== undefined && !boundedString(line.selectedOfferId, 160)) return [];
    return [{ resultId: line.resultId, quantity: Number(line.quantity), ...(line.selectedOfferId ? { selectedOfferId: line.selectedOfferId } : {}) }];
  }) : [];
  const budget = value.budget === null || (typeof value.budget === "number" && Number.isFinite(value.budget) && value.budget >= 0) ? value.budget : null;
  const lastSearchAt = value.lastSearchAt === null || (typeof value.lastSearchAt === "number" && Number.isFinite(value.lastSearchAt) && value.lastSearchAt >= 0) ? value.lastSearchAt : null;
  // Handoffs/discovery are ephemeral requests. They are deliberately rebuilt
  // from bounded tool/server inputs rather than trusted from storage or BC.
  return { query, results, cart, budget, lastSearchAt, handoff: null, discovery: null };
}

function readState(): PersistedShopping {
  try {
    const raw = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(storageKey()) ?? "null") : null;
    return normalizePersistedState(raw);
  } catch { return { query: "", results: [], cart: [], budget: null, lastSearchAt: null, handoff: null, discovery: null }; }
}

function snapshot(state: ShoppingState): PersistedShopping { return { query: state.query, results: state.results, cart: state.cart, budget: state.budget, lastSearchAt: state.lastSearchAt, handoff: state.handoff, discovery: state.discovery }; }
function persist(state: ShoppingState, broadcast = true) {
  // Storage and cross-tab messages are both untrusted re-entry points. Run
  // our own outbound snapshot through the same bounded decoder so an
  // accidental oversized in-memory value can never become durable or fan
  // out to another tab. Handoffs and discovery candidates are intentionally
  // ephemeral and are re-created by the active request.
  const next = normalizePersistedState(snapshot(state));
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
  setQuery(query) {
    if (!boundedString(query, MAX_SHOPPING_QUERY_LENGTH, false)) return;
    set({ query });
    persist(get());
  },
  setRequestStatus(requestStatus) { set({ requestStatus }); },
  setHandoff(handoff) { set({ handoff, requestStatus: handoff ? "staged" : "idle" }); persist(get()); },
  setDiscovery(discovery) {
    set({ discovery, requestStatus: discovery?.rateLimited && discovery.candidates.length === 0 ? "rate-limited" : discovery ? "agent-required" : "idle" });
    persist(get());
  },
  setResults() {
    // A discovery/publication attempt is not a destructive replacement. Keep
    // the last accepted listings and cart usable while the next handoff is
    // pending or rejected; only a successful publication replaces results.
    set({ requestStatus: "failed", discovery: null, publicationError: "Live shopping discovery is available through Bright Data, but showing listings still requires a connected, authenticated WebMCP agent. Canonical cart publication still requires a reviewed catalog identity." });
    persist(get());
  },
  publishAgentResults(rawResults, publication) {
    const results = Array.isArray(rawResults) && rawResults.length <= MAX_SHOPPING_RESULTS && jsonBytes(rawResults) <= 128 * 1024 ? rawResults : [];
    if (!validPublication(publication)) {
      set({ requestStatus: "failed", publicationError: "Listing publication rejected: the WebMCP agent authentication or provider provenance is missing or invalid." });
      persist(get());
      return { accepted: false, rejected: results.length, message: get().publicationError ?? undefined };
    }
    const publishedAt = publication.publishedAt;
    const normalized = results.filter((result): result is ShoppingResult => {
      if (!validListing(result) || !result.provenance) return false;
      return result.provenance.agentId === publication.agentId && result.provenance.provider === publication.provider && result.provenance.publishedAt === publishedAt;
    }).map(cloneListing);
    const rejected = results.length - normalized.length;
    if (normalized.length === 0) {
      const message = "Listing publication rejected: every listing needs a canonical catalogId, exactMatch=true, part number, an HTTPS retailer URL, a recent timestamp, currency, and provider provenance.";
      set({ requestStatus: "failed", publicationError: message });
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
  const next = normalizePersistedState(state);
  useShoppingStore.setState({ ...next, requestStatus: "idle", publicationError: null, undoStack: [] });
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
      const next = normalizePersistedState(JSON.parse(event.newValue));
      useShoppingStore.setState({ ...next, requestStatus: "idle", publicationError: null, undoStack: [] });
    } catch {}
  });
}
