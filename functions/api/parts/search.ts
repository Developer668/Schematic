import { jsonResponse, optionsResponse, requireApiIdentity } from "../_runtime";
import { publicSourcesEnabled, searchPublicParts, type PublicPartCandidate, type PublicSourceAttempt } from "./public";

type ProviderConfig = {
  id: string;
  label: string;
  endpoint: string;
  method: "GET" | "POST";
  tokenEnv?: string;
  tokenHeader?: string;
  timeoutMs: number;
};

type ProviderOffer = {
  id: string;
  retailer: string;
  title: string;
  price: number | null;
  currency: string;
  url: string;
  availability?: string;
  fetchedAt: string;
  provider: string;
};

type ProviderCandidate = {
  id: string;
  catalogId: string;
  title: string;
  manufacturer?: string;
  partNumber: string;
  requestedQuantity: number;
  exactMatch: boolean;
  matchNote?: string;
  offers: ProviderOffer[];
  alternatives: Array<{ catalogId: string; title: string; reason: string }>;
  updatedAt: string;
  provider: string;
};

type ProviderAttempt = {
  provider: string;
  label: string;
  status: "success" | "empty" | "error" | "timeout" | "skipped";
  durationMs: number;
  resultCount: number;
  message?: string;
};

type PartsSearchBody = {
  code: "OK" | "PUBLIC_CANDIDATES" | "PUBLIC_SOURCE_DEGRADED" | "PUBLIC_SOURCE_RATE_LIMITED" | "PARTS_PROVIDER_DEGRADED" | "PARTS_PROVIDER_NOT_CONFIGURED";
  query: string;
  quantity: number;
  source: "public-source-discovery" | "provider-fallback-chain" | "agent-handoff";
  liveOffers: false;
  results: ProviderCandidate[];
  candidates?: PublicPartCandidate[];
  providerOrder: string[];
  attempts: Array<ProviderAttempt | PublicSourceAttempt>;
  providerFallback: {
    attempted: boolean;
    providersTried: string[];
    cacheHit?: boolean;
    staleCache?: boolean;
    rateLimited?: boolean;
  };
  handoff: Record<string, unknown>;
  publication: {
    required: true;
    returnTool: "shopping.search";
    reason: string;
  };
  message: string;
};

type PartsEnv = Record<string, unknown>;
type Context = { request: Request; env: PartsEnv };

const DEFAULT_PUBLIC_SOURCE_ORDER = ["jlcsearch", "adafruit", "web-search"];
const DEFAULT_PROVIDER_ORDER = ["mouser", "digikey", "element14", "adafruit"];
const MAX_QUERY_LENGTH = 240;
const MAX_RESULTS = 24;
const providerCache = new Map<string, { expiresAt: number; body: PartsSearchBody; status: number }>();

function envString(env: PartsEnv, key: string) {
  const value = env[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).trim() : "";
}

function slug(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function validHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function configuredProvider(value: unknown): ProviderConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const id = String(item.id ?? "").trim().toLowerCase();
  const endpoint = String(item.endpoint ?? item.url ?? "").trim();
  if (!id || !validHttpsUrl(endpoint)) return undefined;
  const method = String(item.method ?? "POST").toUpperCase() === "GET" ? "GET" : "POST";
  const timeoutMs = Math.max(1_000, Math.min(Number(item.timeoutMs ?? 7_000) || 7_000, 15_000));
  return {
    id,
    label: String(item.label ?? id).trim() || id,
    endpoint,
    method,
    ...(item.tokenEnv ? { tokenEnv: String(item.tokenEnv).trim() } : {}),
    ...(item.tokenHeader ? { tokenHeader: String(item.tokenHeader).trim() } : {}),
    timeoutMs,
  };
}

function providerConfigs(env: PartsEnv) {
  const byId = new Map<string, ProviderConfig>();
  const raw = envString(env, "PARTS_PROVIDER_ENDPOINTS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) for (const entry of parsed) {
        const provider = configuredProvider(entry);
        if (provider) byId.set(provider.id, provider);
      }
    } catch {
      // Invalid deployment configuration is treated as no configured provider;
      // the response still carries the safe agent handoff contract.
    }
  }

  const order = (envString(env, "PARTS_PROVIDER_ORDER") || DEFAULT_PROVIDER_ORDER.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const id of order) {
    if (byId.has(id)) continue;
    const prefix = `PARTS_PROVIDER_${slug(id)}`;
    const endpoint = envString(env, `${prefix}_URL`);
    if (!validHttpsUrl(endpoint)) continue;
    byId.set(id, {
      id,
      label: envString(env, `${prefix}_LABEL`) || id,
      endpoint,
      method: envString(env, `${prefix}_METHOD`).toUpperCase() === "GET" ? "GET" : "POST",
      ...(envString(env, `${prefix}_TOKEN_ENV`) ? { tokenEnv: envString(env, `${prefix}_TOKEN_ENV`) } : {}),
      ...(envString(env, `${prefix}_TOKEN_HEADER`) ? { tokenHeader: envString(env, `${prefix}_TOKEN_HEADER`) } : {}),
      timeoutMs: Math.max(1_000, Math.min(Number(envString(env, `${prefix}_TIMEOUT_MS`) || 7_000) || 7_000, 15_000)),
    });
  }

  return [...byId.values()].sort((left, right) => {
    const leftIndex = order.indexOf(left.id);
    const rightIndex = order.indexOf(right.id);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function responseItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["results", "listings", "parts", "items", "data", "products"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function safePrice(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeCurrency(value: unknown) {
  const currency = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "";
}

function safeProviderUrl(value: unknown) {
  return validHttpsUrl(value) ? String(value).trim() : "";
}

function normalizeCandidates(payload: unknown, provider: ProviderConfig, quantity: number) {
  const now = new Date().toISOString();
  return responseItems(payload).slice(0, MAX_RESULTS).flatMap((entry): ProviderCandidate[] => {
    const item = asRecord(entry);
    if (!item) return [];
    // Provider adapters must supply Schematic's canonical catalogId. This
    // route deliberately refuses to infer one from a title or part number.
    const catalogId = String(item.catalogId ?? item.componentId ?? item.schematicCatalogId ?? "").trim();
    const title = String(item.title ?? item.name ?? "").trim();
    const partNumber = String(item.partNumber ?? item.mpn ?? item.manufacturerPartNumber ?? "").trim();
    if (!catalogId || !title || !partNumber) return [];
    const rawOffers = Array.isArray(item.offers) ? item.offers : item.url ? [item] : [];
    const offers = rawOffers.slice(0, 3).flatMap((rawOffer, index): ProviderOffer[] => {
      const offer = asRecord(rawOffer);
      if (!offer) return [];
      const url = safeProviderUrl(offer.url ?? offer.productUrl ?? offer.link);
      const currency = safeCurrency(offer.currency ?? offer.currencyCode);
      if (!url || !currency) return [];
      const retailer = String(offer.retailer ?? offer.source ?? provider.label).trim();
      if (!retailer) return [];
      return [{
        id: String(offer.id ?? `${provider.id}-${catalogId}-${index}`).trim(),
        retailer,
        title: String(offer.title ?? title).trim(),
        price: safePrice(offer.price ?? offer.unitPrice),
        currency,
        url,
        ...(offer.availability ? { availability: String(offer.availability).trim() } : {}),
        fetchedAt: now,
        provider: String(offer.provider ?? provider.label).trim() || provider.label,
      }];
    });
    if (!offers.length) return [];
    const alternatives = (Array.isArray(item.alternatives) ? item.alternatives : []).slice(0, 3).flatMap((value): Array<{ catalogId: string; title: string; reason: string }> => {
      const alternative = asRecord(value);
      const alternativeId = String(alternative?.catalogId ?? alternative?.id ?? "").trim();
      if (!alternativeId) return [];
      return [{ catalogId: alternativeId, title: String(alternative?.title ?? alternative?.name ?? "Alternative part").trim(), reason: String(alternative?.reason ?? "Verify electrical limits and footprint before substituting.").trim() }];
    });
    return [{
      id: String(item.id ?? `${provider.id}:${catalogId}:${partNumber}`).trim(),
      catalogId,
      title,
      ...(item.manufacturer ? { manufacturer: String(item.manufacturer).trim() } : {}),
      partNumber,
      requestedQuantity: quantity,
      exactMatch: item.exactMatch === true,
      ...(item.matchNote ? { matchNote: String(item.matchNote).trim() } : {}),
      offers,
      alternatives,
      updatedAt: now,
      provider: provider.label,
    }];
  });
}

async function callProvider(provider: ProviderConfig, query: string, quantity: number, env: PartsEnv) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
  try {
    const headers = new Headers({ Accept: "application/json" });
    let endpoint = provider.endpoint;
    const init: RequestInit = { method: provider.method, headers, signal: controller.signal };
    if (provider.tokenEnv) {
      const token = envString(env, provider.tokenEnv);
      if (!token) return { status: "skipped" as const, candidates: [] as ProviderCandidate[], message: `Missing ${provider.tokenEnv}` };
      headers.set(provider.tokenHeader || "Authorization", provider.tokenHeader ? token : `Bearer ${token}`);
    }
    if (provider.method === "GET") {
      const url = new URL(endpoint);
      url.searchParams.set("query", query);
      url.searchParams.set("quantity", String(quantity));
      url.searchParams.set("limit", String(MAX_RESULTS));
      endpoint = url.toString();
    } else {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify({ query, quantity, limit: MAX_RESULTS });
    }
    const response = await fetch(endpoint, init);
    const bodyText = await response.text();
    if (!response.ok) return { status: "error" as const, candidates: [] as ProviderCandidate[], message: `HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 160)}` : ""}` };
    let body: unknown;
    try { body = JSON.parse(bodyText); } catch { return { status: "error" as const, candidates: [] as ProviderCandidate[], message: "Provider returned non-JSON data" }; }
    const candidates = normalizeCandidates(body, provider, quantity);
    return { status: candidates.length ? "success" as const : "empty" as const, candidates };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "timeout" as const, candidates: [] as ProviderCandidate[], message: `Timed out after ${provider.timeoutMs}ms` };
    return { status: "error" as const, candidates: [] as ProviderCandidate[], message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function handoff(query: string, quantity: number, providerOrder: string[]) {
  return {
    schemaVersion: "schematic.parts.lookup.v1",
    requestType: "exact_parts_lookup",
    query,
    quantity,
    providerFallbackOrder: providerOrder,
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
    returnShape: {
      listings: [{ id: "provider-listing-id", catalogId: "canonical-schematic-catalog-id", title: "", partNumber: "", requestedQuantity: quantity, exactMatch: true, offers: [{ id: "offer-id", retailer: "", title: "", price: null, currency: "USD", url: "https://…", fetchedAt: "2026-01-01T00:00:00.000Z", provider: "" }], alternatives: [], updatedAt: "2026-01-01T00:00:00.000Z" }],
      publication: { provider: "provider-name", publishedAt: "2026-01-01T00:00:00.000Z" },
    },
  } satisfies Record<string, unknown>;
}

function cacheKey(query: string, quantity: number, providers: ProviderConfig[]) {
  return `${query.toLowerCase()}|${quantity}|${providers.map((provider) => `${provider.id}:${provider.endpoint}`).join(",")}`;
}

export async function partsSearch(request: Request, envInput: PartsEnv) {
  const env = envInput ?? {};
  const identity = await requireApiIdentity({ request, env: env as Parameters<typeof requireApiIdentity>[0]["env"] });
  if (!identity) return jsonResponse(request, { error: "Sign in to use this Schematic workspace" }, 401);
  const searchParams = new URL(request.url).searchParams;
  const query = (searchParams.get("query") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const quantityValue = Number(searchParams.get("quantity") ?? 1);
  const quantity = Math.max(1, Math.min(999, Number.isFinite(quantityValue) ? Math.round(quantityValue) : 1));
  if (!query) return jsonResponse(request, { code: "INVALID_QUERY", message: "query is required", query, quantity }, 400);

  // Public no-key discovery is the default. Paid/keyed adapters remain an
  // explicit server-only escape hatch for a later release and are never
  // reached just because an old environment variable is present.
  if (publicSourcesEnabled(env)) {
    const publicResult = await searchPublicParts(query, identity.subject);
    const publicOrder = publicResult.sourceOrder.length ? publicResult.sourceOrder : DEFAULT_PUBLIC_SOURCE_ORDER;
    const baseHandoff = handoff(query, quantity, publicOrder);
    const hasCandidates = publicResult.candidates.length > 0;
    const body: PartsSearchBody = {
      code: hasCandidates ? "PUBLIC_CANDIDATES" : publicResult.rateLimited ? "PUBLIC_SOURCE_RATE_LIMITED" : "PUBLIC_SOURCE_DEGRADED",
      query,
      quantity,
      source: hasCandidates ? "public-source-discovery" : "agent-handoff",
      liveOffers: false,
      results: [],
      ...(hasCandidates ? { candidates: publicResult.candidates } : {}),
      providerOrder: publicOrder,
      attempts: publicResult.attempts,
      providerFallback: {
        attempted: true,
        providersTried: publicResult.attempts.filter((attempt) => attempt.source !== "request").map((attempt) => attempt.source),
        cacheHit: publicResult.cacheHit,
        staleCache: publicResult.staleCache,
        rateLimited: publicResult.rateLimited,
      },
      handoff: {
        ...baseHandoff,
        discoveryMode: "public-no-key",
        ...(hasCandidates ? { publicCandidates: publicResult.candidates, nextAction: "Verify each candidate against a canonical Schematic catalog component and live HTTPS retailer page before publishing." } : { nextAction: "Use the browsing-agent fallback to search public retailer pages, then publish strict listings through shopping.search." }),
        publicSourceAttempts: publicResult.attempts,
      },
      publication: { required: true, returnTool: "shopping.search", reason: "Public results are discovery candidates only; an authenticated WebMCP agent must verify exact catalog identity, current retailer URL, timestamp, currency, and offer before publication." },
      message: publicResult.message,
    };
    const headers: Record<string, string> = publicResult.retryAfterSeconds
      ? { "Retry-After": String(publicResult.retryAfterSeconds) }
      : { "Cache-Control": "private, max-age=30" };
    return jsonResponse(request, body, 200, headers);
  }

  const paidProvidersEnabled = ["1", "true", "yes", "on"].includes(envString(env, "PARTS_PAID_PROVIDERS_ENABLED").toLowerCase());
  const providers = paidProvidersEnabled ? providerConfigs(env) : [];
  const providerOrder = providers.map((provider) => provider.id);
  const baseHandoff = handoff(query, quantity, providerOrder.length ? providerOrder : DEFAULT_PROVIDER_ORDER);
  if (!providers.length) {
    const body: PartsSearchBody = {
      code: "PARTS_PROVIDER_NOT_CONFIGURED",
      query,
      quantity,
      source: "agent-handoff",
      liveOffers: false,
      results: [],
      providerOrder: DEFAULT_PROVIDER_ORDER,
      attempts: [],
      providerFallback: { attempted: false, providersTried: [] },
      handoff: baseHandoff,
      publication: { required: true, returnTool: "shopping.search", reason: "Configure at least one server-side provider adapter or let a browsing agent complete this handoff." },
      message: "No server-side parts provider is configured. Return the handoff JSON to a browsing agent, then publish verified listings through shopping.search.",
    };
    return jsonResponse(request, body, 503);
  }

  const key = cacheKey(query, quantity, providers);
  const cached = providerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return jsonResponse(request, { ...cached.body, providerFallback: { ...cached.body.providerFallback, cacheHit: true } }, cached.status, { "Cache-Control": "private, max-age=30" });
  }
  if (cached) providerCache.delete(key);

  const maxAttempts = Math.max(1, Math.min(Number(envString(env, "PARTS_PROVIDER_MAX_ATTEMPTS") || providers.length) || providers.length, providers.length));
  const attempts: ProviderAttempt[] = [];
  const results: ProviderCandidate[] = [];
  for (const provider of providers.slice(0, maxAttempts)) {
    const startedAt = Date.now();
    const result = await callProvider(provider, query, quantity, env);
    attempts.push({ provider: provider.id, label: provider.label, status: result.status, durationMs: Date.now() - startedAt, resultCount: result.candidates.length, ...(result.message ? { message: result.message } : {}) });
    if (result.candidates.length) {
      results.push(...result.candidates);
      break;
    }
  }
  const body: PartsSearchBody = {
    code: results.length ? "OK" : "PARTS_PROVIDER_DEGRADED",
    query,
    quantity,
    source: results.length ? "provider-fallback-chain" : "agent-handoff",
    liveOffers: false,
    results,
    providerOrder,
    attempts,
    providerFallback: { attempted: true, providersTried: attempts.map((attempt) => attempt.provider) },
    handoff: { ...baseHandoff, providerResults: results.length ? "Verify these candidates and publish with shopping.search." : "Use another browsing agent to complete the request." },
    publication: { required: true, returnTool: "shopping.search", reason: "Provider candidates are not trusted listings until an authenticated WebMCP agent verifies and publishes them." },
    message: results.length ? "Provider candidates returned; verify exact identity and publish through shopping.search." : "All configured provider attempts were empty or unavailable; continue with the agent handoff JSON.",
  };
  const status = results.length ? 200 : 503;
  const ttlSeconds = Math.max(10, Math.min(Number(envString(env, "PARTS_PROVIDER_CACHE_TTL_SECONDS") || 45) || 45, 600));
  providerCache.set(key, { body, status, expiresAt: Date.now() + ttlSeconds * 1_000 });
  while (providerCache.size > 64) {
    const oldest = providerCache.keys().next().value;
    if (!oldest) break;
    providerCache.delete(oldest);
  }
  return jsonResponse(request, body, status, { "Cache-Control": "private, max-age=30" });
}

export const onRequestOptions = ({ request }: Context) => optionsResponse(request);
export const onRequestGet = ({ request, env }: Context) => partsSearch(request, env);
