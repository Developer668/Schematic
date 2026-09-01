import { apiUrl, getAuthHeaders } from "../auth/session.ts";
import type { ShoppingDiscovery, ShoppingDiscoveryAttempt, ShoppingDiscoveryCandidate } from "../store/useShoppingStore.ts";

export const PARTS_SEARCH_PATH = "/api/parts/search";
export const PARTS_SEARCH_MAX_QUERY_LENGTH = 240;
export const PARTS_SEARCH_MAX_QUANTITY = 999;

const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 32;

export type PartsSearchStatus = "agent-required" | "rate-limited" | "failed" | "cancelled";

export interface PartsSearchInput {
  query: string;
  quantity?: number;
  requiredCatalogIds?: string[];
  requestId?: string;
  requestedAt?: string;
}

export interface PartsSearchRequest {
  requestId: string;
  query: string;
  quantity: number;
  requiredCatalogIds: string[];
  requestedAt: string;
}

export interface PartsSearchPayload {
  code?: string;
  query?: string;
  quantity?: number;
  source?: string;
  candidates?: unknown[];
  attempts?: unknown[];
  providerOrder?: unknown[];
  providerFallback?: Record<string, unknown>;
  handoff?: unknown;
  publication?: unknown;
  message?: string;
  retryAfterSeconds?: number;
  [key: string]: unknown;
}

export interface PartsSearchOutcome {
  request: PartsSearchRequest;
  requestId: string;
  status: PartsSearchStatus;
  discovery: ShoppingDiscovery | null;
  payload?: PartsSearchPayload;
  httpStatus?: number;
  error?: string;
  retryAfterMs?: number;
}

export interface PartsSearchClientOptions {
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  getAuthHeaders?: (force?: boolean, signal?: AbortSignal) => Promise<Record<string, string>>;
  now?: () => number;
  requestIdFactory?: () => string;
  cacheTtlMs?: number;
  path?: string;
}

export interface PartsSearchSubmitOptions {
  signal?: AbortSignal;
  force?: boolean;
}

export interface PartsSearchCoordinator {
  submit(input: PartsSearchInput, options?: PartsSearchSubmitOptions): Promise<PartsSearchOutcome>;
  cancel(requestId?: string): boolean;
  getActiveRequest(): PartsSearchRequest | null;
  clearCache(): void;
}

type RecordValue = Record<string, unknown>;
type RunningSearch = {
  key: string;
  request: PartsSearchRequest;
  controller: AbortController;
  promise: Promise<PartsSearchOutcome>;
};

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function text(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function finiteNumber(value: unknown, fallback: number | null = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number | null = null) {
  const number = finiteNumber(value, fallback);
  return number !== null && number >= 0 ? number : fallback;
}

function safeQuantity(value: unknown, fallback = 1) {
  const number = finiteNumber(value);
  return number === null ? fallback : Math.min(PARTS_SEARCH_MAX_QUANTITY, Math.max(1, Math.round(number)));
}

function requestId() {
  const uuid = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2, 10);
  return `parts-${Date.now()}-${uuid}`;
}

export function normalizePartsSearchRequest(input: PartsSearchInput, options: { now?: () => number; requestIdFactory?: () => string } = {}): PartsSearchRequest | null {
  const source = asRecord(input) ?? {};
  const query = text(source.query, PARTS_SEARCH_MAX_QUERY_LENGTH);
  if (!query) return null;
  const now = options.now ?? Date.now;
  const requestedAtValue = text(source.requestedAt);
  const requestedAt = requestedAtValue && Number.isFinite(Date.parse(requestedAtValue)) ? requestedAtValue : new Date(now()).toISOString();
  const ids = Array.isArray(source.requiredCatalogIds) ? source.requiredCatalogIds : [];
  const requiredCatalogIds = [...new Set(ids.map((value) => text(value, 120)).filter(Boolean))];
  const requestIdFactory = options.requestIdFactory ?? requestId;
  return {
    requestId: text(source.requestId, 160) || requestIdFactory(),
    query,
    quantity: safeQuantity(source.quantity),
    requiredCatalogIds,
    requestedAt,
  };
}

function normalizeCandidate(value: unknown): ShoppingDiscoveryCandidate | null {
  const item = asRecord(value);
  if (!item || (item.source !== "jlcsearch" && item.source !== "adafruit")) return null;
  const id = text(item.id, 160);
  const sourcePartId = text(item.sourcePartId, 80);
  const title = text(item.title, 240);
  const partNumber = text(item.partNumber, 120);
  const verificationUrl = text(item.verificationUrl, 500);
  if (!id || !sourcePartId || !title || !partNumber || item.verificationRequired !== true) return null;
  try {
    const url = new URL(verificationUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
  } catch {
    return null;
  }
  const price = item.price === null ? null : nonNegativeNumber(item.price);
  const stock = item.stock === null ? null : nonNegativeNumber(item.stock);
  const rawCurrency = item.currency === null ? null : text(item.currency, 3).toUpperCase();
  if ((item.price !== null && price === null) || (item.stock !== null && stock === null) || (rawCurrency !== null && !/^[A-Z]{3}$/.test(rawCurrency))) return null;
  return {
    id,
    source: item.source,
    sourcePartId,
    title,
    ...(text(item.manufacturer, 120) ? { manufacturer: text(item.manufacturer, 120) } : {}),
    partNumber,
    ...(text(item.package, 100) ? { package: text(item.package, 100) } : {}),
    ...(text(item.description, 300) ? { description: text(item.description, 300) } : {}),
    stock,
    ...(text(item.availability, 80) ? { availability: text(item.availability, 80) } : {}),
    price,
    currency: rawCurrency,
    verificationUrl,
    verificationRequired: true,
  };
}

function normalizeAttempt(value: unknown): ShoppingDiscoveryAttempt | null {
  const item = asRecord(value);
  if (!item || !["jlcsearch", "adafruit", "request"].includes(String(item.source))) return null;
  const allowedStatuses = ["success", "empty", "error", "timeout", "rate_limited", "circuit_open", "skipped"];
  if (!allowedStatuses.includes(String(item.status))) return null;
  const durationMs = nonNegativeNumber(item.durationMs, 0) ?? 0;
  const resultCount = Math.min(24, Math.round(nonNegativeNumber(item.resultCount, 0) ?? 0));
  const retryAfterSeconds = nonNegativeNumber(item.retryAfterSeconds);
  return {
    source: String(item.source) as ShoppingDiscoveryAttempt["source"],
    status: String(item.status) as ShoppingDiscoveryAttempt["status"],
    durationMs,
    resultCount,
    ...(item.cache === "fresh" || item.cache === "stale" ? { cache: item.cache } : {}),
    ...(retryAfterSeconds !== null ? { retryAfterSeconds: Math.max(1, Math.round(retryAfterSeconds)) } : {}),
    ...(text(item.message, 180) ? { message: text(item.message, 180) } : {}),
  };
}

export function normalizeShoppingDiscovery(value: unknown): ShoppingDiscovery | null {
  const item = asRecord(value);
  if (!item) return null;
  const candidates = (Array.isArray(item.candidates) ? item.candidates : []).slice(0, 24).map(normalizeCandidate).filter((candidate): candidate is ShoppingDiscoveryCandidate => Boolean(candidate));
  const attempts = (Array.isArray(item.attempts) ? item.attempts : []).slice(0, 8).map(normalizeAttempt).filter((attempt): attempt is ShoppingDiscoveryAttempt => Boolean(attempt));
  const sourceOrder = (Array.isArray(item.sourceOrder) ? item.sourceOrder : ["jlcsearch", "adafruit", "web-search"]).map((source) => text(source, 40)).filter(Boolean).slice(0, 8);
  const retryAfterSeconds = nonNegativeNumber(item.retryAfterSeconds);
  const hasDiscoveryEnvelope = candidates.length > 0 || attempts.length > 0 || typeof item.code === "string" || typeof item.source === "string" || Boolean(item.handoff);
  if (!hasDiscoveryEnvelope) return null;
  return {
    candidates,
    sourceOrder,
    attempts,
    cacheHit: item.cacheHit === true,
    staleCache: item.staleCache === true,
    rateLimited: item.rateLimited === true || item.code === "PUBLIC_SOURCE_RATE_LIMITED",
    ...(retryAfterSeconds !== null ? { retryAfterSeconds: Math.max(1, Math.round(retryAfterSeconds)) } : {}),
    message: text(item.message, 240) || "Public candidates are ready for agent verification.",
  };
}

function cancelled(request: PartsSearchRequest): PartsSearchOutcome {
  return { request, requestId: request.requestId, status: "cancelled", discovery: null, error: "Parts search was cancelled." };
}

function withRequestIdentity(outcome: PartsSearchOutcome, request: PartsSearchRequest): PartsSearchOutcome {
  return { ...outcome, request, requestId: request.requestId };
}

function shareSearchOutcome(
  outcomePromise: Promise<PartsSearchOutcome>,
  request: PartsSearchRequest,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return Promise.resolve(cancelled(request));
  if (!signal) return outcomePromise.then((outcome) => withRequestIdentity(outcome, request));
  return new Promise<PartsSearchOutcome>((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(cancelled(request));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void outcomePromise.then(
      (outcome) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(withRequestIdentity(outcome, request));
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve({
          request,
          requestId: request.requestId,
          status: "failed",
          discovery: null,
          error: error instanceof Error ? error.message : "Parts search failed.",
        });
      },
    );
    if (signal.aborted) onAbort();
  });
}

function requestUrl(path: string, request: PartsSearchRequest) {
  const base = apiUrl(path);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}query=${encodeURIComponent(request.query)}&quantity=${request.quantity}`;
}

async function readJson(response: Response): Promise<{ value: unknown; error?: string }> {
  try {
    const body = await response.text();
    if (!body.trim()) return { value: null, error: "Parts search returned an empty response." };
    try { return { value: JSON.parse(body) }; } catch { return { value: null, error: "Parts search returned non-JSON content." }; }
  } catch {
    return { value: null, error: "Parts search response could not be read." };
  }
}

function retryAfterMs(response: Response, payload: PartsSearchPayload | null, now: () => number) {
  const payloadSeconds = nonNegativeNumber(payload?.retryAfterSeconds);
  if (payloadSeconds !== null) return Math.max(0, payloadSeconds * 1_000);
  const header = response.headers?.get("retry-after")?.trim();
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now()) : undefined;
}

function responseOk(response: Response) {
  return typeof response.ok === "boolean" ? response.ok : response.status >= 200 && response.status < 300;
}

export async function requestPartsSearch(request: PartsSearchRequest, options: PartsSearchClientOptions = {}, signal?: AbortSignal): Promise<PartsSearchOutcome> {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const auth = options.getAuthHeaders ?? ((force?: boolean, authSignal?: AbortSignal) => getAuthHeaders(force, authSignal));
  const path = options.path ?? PARTS_SEARCH_PATH;
  if (signal?.aborted) return cancelled(request);
  try {
    const send = async (force: boolean) => {
      const headers = new Headers({ Accept: "application/json" });
      for (const [key, value] of Object.entries(await auth(force, signal))) headers.set(key, value);
      return fetchImpl(requestUrl(path, request), { method: "GET", credentials: "include", headers, signal });
    };
    let response = await send(false);
    if (response.status === 401 && !signal?.aborted) response = await send(true);
    if (signal?.aborted) return cancelled(request);
    const parsed = await readJson(response);
    if (signal?.aborted) return cancelled(request);
    if (parsed.error) return { request, requestId: request.requestId, status: response.status === 429 ? "rate-limited" : "failed", discovery: null, httpStatus: response.status, error: parsed.error, ...(response.status === 429 ? { retryAfterMs: retryAfterMs(response, null, now) } : {}) };
    const payload = asRecord(parsed.value) as PartsSearchPayload | null;
    const discovery = normalizeShoppingDiscovery(payload);
    const message = text(payload?.message, 240);
    if (response.status === 429) return { request, requestId: request.requestId, status: "rate-limited", discovery, payload: payload ?? undefined, httpStatus: response.status, error: message || "Parts search is temporarily rate limited.", retryAfterMs: retryAfterMs(response, payload, now) };
    if (response.status === 401 || response.status === 403) return { request, requestId: request.requestId, status: "agent-required", discovery, payload: payload ?? undefined, httpStatus: response.status, error: message || "Sign in to use the parts search." };
    if (!responseOk(response)) return { request, requestId: request.requestId, status: "failed", discovery, payload: payload ?? undefined, httpStatus: response.status, error: message || `Parts search returned HTTP ${response.status}.` };
    if (discovery) return { request, requestId: request.requestId, status: discovery.rateLimited ? "rate-limited" : "agent-required", discovery, payload: payload ?? undefined, httpStatus: response.status, ...(message ? { error: message } : {}), ...(discovery.rateLimited ? { retryAfterMs: retryAfterMs(response, payload, now) } : {}) };
    return { request, requestId: request.requestId, status: "failed", discovery: null, payload: payload ?? undefined, httpStatus: response.status, error: "Parts search returned no discovery envelope." };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return cancelled(request);
    return { request, requestId: request.requestId, status: "failed", discovery: null, error: error instanceof Error ? error.message : "Parts search failed." };
  }
}

function searchKey(request: PartsSearchRequest) {
  return `${request.query.toLowerCase()}\u0000${request.quantity}\u0000${[...request.requiredCatalogIds].sort().join(",")}`;
}

export function createPartsSearchCoordinator(options: PartsSearchClientOptions = {}): PartsSearchCoordinator {
  const now = options.now ?? Date.now;
  const requestIdFactory = options.requestIdFactory ?? requestId;
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const cache = new Map<string, { expiresAt: number; outcome: PartsSearchOutcome }>();
  const inFlight = new Map<string, RunningSearch>();
  let active: RunningSearch | null = null;

  const clearCache = () => cache.clear();
  const cancel = (requestIdValue?: string) => {
    if (!active || (requestIdValue && active.request.requestId !== requestIdValue)) return false;
    const running = active;
    active = null;
    inFlight.delete(running.key);
    running.controller.abort();
    return true;
  };

  const submit = (input: PartsSearchInput, submitOptions: PartsSearchSubmitOptions = {}) => {
    const request = normalizePartsSearchRequest(input, { now, requestIdFactory });
    if (!request) {
      const invalid: PartsSearchRequest = { requestId: requestIdFactory(), query: "", quantity: 1, requiredCatalogIds: [], requestedAt: new Date(now()).toISOString() };
      return Promise.resolve<PartsSearchOutcome>({ request: invalid, requestId: invalid.requestId, status: "failed", discovery: null, error: "Enter an exact part, board, or manufacturer before searching." });
    }
    if (submitOptions.signal?.aborted) return Promise.resolve(cancelled(request));
    const key = searchKey(request);
    const existing = !submitOptions.force ? inFlight.get(key) : undefined;
    if (existing && !existing.controller.signal.aborted) {
      active = existing;
      // Provider work is shared, but each caller owns its handoff identity and
      // may stop waiting without aborting another caller's request.
      return shareSearchOutcome(existing.promise, request, submitOptions.signal);
    }
    if (!submitOptions.force) {
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        if (submitOptions.signal?.aborted) return Promise.resolve(cancelled(request));
        // A cache hit reuses provider data, but the request envelope belongs to
        // this handoff. Keep the current request id/timestamp for cancellation,
        // persistence, and stale-result guards in the UI.
        return Promise.resolve(withRequestIdentity(cached.outcome, request));
      }
      if (cached) cache.delete(key);
    }
    if (active && (active.key !== key || submitOptions.force)) {
      const previous = active;
      active = null;
      inFlight.delete(previous.key);
      previous.controller.abort();
    }
    const controller = new AbortController();
    const running = { key, request, controller } as RunningSearch;
    if (submitOptions.signal) {
      if (submitOptions.signal.aborted) controller.abort();
      else submitOptions.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    running.promise = requestPartsSearch(request, options, controller.signal)
      .then((outcome) => {
        if (active !== running || controller.signal.aborted) return cancelled(request);
        if (cacheTtlMs > 0 && (outcome.status === "agent-required" || outcome.status === "rate-limited")) {
          cache.set(key, { expiresAt: now() + cacheTtlMs, outcome });
          while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
        }
        return outcome;
      })
      .catch((error) => controller.signal.aborted ? cancelled(request) : ({ request, requestId: request.requestId, status: "failed" as const, discovery: null, error: error instanceof Error ? error.message : "Parts search failed." }))
      .finally(() => {
        if (inFlight.get(key) === running) inFlight.delete(key);
        if (active === running) active = null;
      });
    inFlight.set(key, running);
    active = running;
    return running.promise;
  };

  return { submit, cancel, getActiveRequest: () => active?.request ?? null, clearCache };
}
