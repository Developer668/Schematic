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

export interface AgentPublication {
  authenticated: true;
  agentId: string;
  provider: string;
  publishedAt: string;
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
  undoStack: CartLine[][];
  setQuery: (query: string) => void;
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

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
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
  undoStack: [],
  setQuery(query) { set({ query }); persist(get()); },
  setResults() {
    set({ results: [], cart: [], lastSearchAt: null, publicationError: "Parts shopping requires a connected, authenticated WebMCP agent. Unpublished or fallback listings were blocked." });
    persist(get());
  },
  publishAgentResults(rawResults, publication) {
    const results = Array.isArray(rawResults) ? rawResults : [];
    if (!validPublication(publication)) {
      set({ results: [], cart: [], lastSearchAt: null, publicationError: "Listing publication rejected: the WebMCP agent authentication or provider provenance is missing or invalid." });
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
      const message = "Listing publication rejected: every listing needs a canonical catalogId, exactMatch=true, part number, valid retailer URL, timestamp, currency, and provider provenance.";
      set({ results: [], cart: [], lastSearchAt: null, publicationError: message });
      persist(get());
      return { accepted: false, rejected, message };
    }
    set({ results: normalized, cart: [], lastSearchAt: Date.now(), publicationError: rejected ? `${rejected} malformed listing${rejected === 1 ? " was" : "s were"} rejected; showing only authenticated exact listings.` : null });
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
    set({ results: [], lastSearchAt: null });
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
  useShoppingStore.setState({ ...next, undoStack: [] });
  shoppingChannel?.postMessage({ type: "shopping:update", state: { ...next, _room: roomId() } });
}

if (typeof window !== "undefined") {
  window.addEventListener("schematic-session", () => reloadShoppingForCurrentUser());
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey() || !event.newValue) return;
    try {
      const next = JSON.parse(event.newValue) as PersistedShopping;
      if (next && typeof next === "object") useShoppingStore.setState({ ...next, undoStack: [] });
    } catch {}
  });
}
