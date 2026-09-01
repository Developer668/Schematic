import { create } from "zustand";
import { catalog, searchCatalog, type CatalogComponent } from "../data/catalog.ts";

interface CatalogState {
  query: string;
  category: string | null;
  domain: string | null;
  results: CatalogComponent[];
  setQuery: (q: string) => void;
  search: (q: string) => void;
  setCategory: (c: string | null) => void;
  setDomain: (d: string | null) => void;
}

export const useComponentCatalogStore = create<CatalogState>((set, get) => ({
  query: "",
  category: null,
  domain: null,
  results: catalog,
  setQuery(q) {
    set({ query: q });
  },
  search(q) {
    const { category, domain } = get();
    set({ query: q, results: searchCatalog(q, { category: category ?? undefined, domain: domain ?? undefined }) });
  },
  setCategory(c) {
    const { query, domain } = get();
    set({ category: c, results: searchCatalog(query, { category: c ?? undefined, domain: domain ?? undefined }) });
  },
  setDomain(d) {
    const { query, category } = get();
    set({ domain: d, results: searchCatalog(query, { category: category ?? undefined, domain: d ?? undefined }) });
  },
}));
