import { create } from "zustand";

export interface PartOffer {
  id: string;
  retailer: string;
  title: string;
  price: number | null;
  currency: string;
  url: string;
  availability?: string;
  fetchedAt: string;
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
  partNumber?: string;
  requestedQuantity: number;
  exactMatch: boolean;
  matchNote?: string;
  offers: PartOffer[];
  alternatives: AlternativePart[];
  updatedAt: string;
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
  undoStack: CartLine[][];
  setQuery: (query: string) => void;
  setResults: (results: ShoppingResult[]) => void;
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

const STORAGE_KEY = "schematic-shopping";
const shoppingChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-shopping-sync") : null;
type PersistedShopping = Pick<ShoppingState, "query" | "results" | "cart" | "budget" | "lastSearchAt">;

function readState(): PersistedShopping {
  const fallback: PersistedShopping = { query: "", results: [], cart: [], budget: null, lastSearchAt: null };
  try {
    const raw = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") : null;
    return raw && typeof raw === "object" ? { ...fallback, ...raw, results: Array.isArray(raw.results) ? raw.results : [], cart: Array.isArray(raw.cart) ? raw.cart : [] } : fallback;
  } catch { return fallback; }
}

function snapshot(state: ShoppingState): PersistedShopping { return { query: state.query, results: state.results, cart: state.cart, budget: state.budget, lastSearchAt: state.lastSearchAt }; }
function persist(state: ShoppingState, broadcast = true) {
  const next = snapshot(state);
  try { if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  if (broadcast) shoppingChannel?.postMessage({ type: "shopping:update", state: next });
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
  undoStack: [],
  setQuery(query) { set({ query }); persist(get()); },
  setResults(results) { set({ results, lastSearchAt: Date.now() }); persist(get()); },
  addToCart(resultId, quantity = 1) {
    set((state) => {
      if (!state.results.some((result) => result.id === resultId)) return state;
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
    const replacement = state.results.find((result) => result.catalogId === catalogId && (alternative?.resultId ? result.id === alternative.resultId : true));
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
      const cart = [...counts.entries()].map(([catalogId, quantity]) => ({ result: state.results.find((item) => item.catalogId === catalogId), quantity })).filter((item): item is { result: ShoppingResult; quantity: number } => Boolean(item.result)).map(({ result, quantity }) => ({ resultId: result.id, quantity }));
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
  if (event.data?.type === "shopping:update" && event.data.state) useShoppingStore.setState(event.data.state);
});
