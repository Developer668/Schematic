/**
 * Keyless public part discovery.
 *
 * These feeds are intentionally treated as discovery data, never as offers.
 * A WebMCP agent must resolve the candidate to Schematic's canonical catalog
 * and publish a fresh HTTPS retailer offer before the UI or cart accepts it.
 */

export type PublicSourceId = "jlcsearch" | "adafruit";

export type PublicPartCandidate = {
  id: string;
  source: PublicSourceId;
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
};

export type PublicSourceAttempt = {
  source: PublicSourceId | "request";
  status: "success" | "empty" | "error" | "timeout" | "rate_limited" | "circuit_open" | "skipped";
  durationMs: number;
  resultCount: number;
  cache?: "fresh" | "stale";
  retryAfterSeconds?: number;
  message?: string;
};

export type PublicPartsSearch = {
  candidates: PublicPartCandidate[];
  sourceOrder: string[];
  attempts: PublicSourceAttempt[];
  cacheHit: boolean;
  staleCache: boolean;
  rateLimited: boolean;
  retryAfterSeconds?: number;
  message: string;
};

type Env = Record<string, unknown>;
type CacheEntry = {
  candidates: PublicPartCandidate[];
  expiresAt: number;
  staleUntil: number;
};
type Bucket = {
  windowStart: number;
  count: number;
  burstStart: number;
  burstCount: number;
};
type Circuit = {
  failures: number;
  openUntil: number;
};

const JLC_ENDPOINT = "https://jlcsearch.tscircuit.com/api/search";
const ADAFRUIT_ENDPOINT = "https://www.adafruit.com/api/product";
const MAX_CANDIDATES = 24;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_LIMIT = 12;
const REQUEST_WINDOW_MS = 60_000;
const REQUEST_BURST_LIMIT = 4;
const REQUEST_BURST_MS = 1_000;
const SOURCE_LIMITS: Record<PublicSourceId, { limit: number; windowMs: number; cooldownMs: number }> = {
  jlcsearch: { limit: 30, windowMs: 60_000, cooldownMs: 250 },
  adafruit: { limit: 5, windowMs: 60_000, cooldownMs: 1_000 },
};
const FRESH_CACHE_MS = 15 * 60_000;
const STALE_CACHE_MS = 24 * 60 * 60_000;
const CIRCUIT_COOLDOWN_MS = 60_000;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<{ candidates: PublicPartCandidate[]; stale: boolean }>>();
const buckets = new Map<string, Bucket>();
const lastSourceCall = new Map<PublicSourceId, number>();
const circuits = new Map<PublicSourceId, Circuit>();

function envString(env: Env, key: string) {
  const value = env[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).trim() : "";
}

function enabled(env: Env) {
  const value = envString(env, "PARTS_PUBLIC_SOURCES_ENABLED");
  return value === "" || !["0", "false", "off", "no"].includes(value.toLowerCase());
}

function text(value: unknown, max = 240) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function items(value: unknown) {
  if (Array.isArray(value)) return value;
  const root = record(value);
  if (!root) return [];
  for (const key of ["components", "parts", "results", "items", "products", "data"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return [];
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const digits = value.replace(/[^0-9.+-]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function priceValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function urlFor(host: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && (url.hostname === host || url.hostname.endsWith(`.${host}`)) && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function adafruitProductId(query: string) {
  const direct = query.trim().match(/^(?:adafruit[-\s]*)?(\d{2,7})$/i);
  if (direct) return direct[1];
  try {
    const url = new URL(query.trim());
    if (url.hostname === "adafruit.com" || url.hostname.endsWith(".adafruit.com")) {
      const match = url.pathname.match(/\/products?\/(\d+)/i);
      if (match) return match[1];
    }
  } catch {
    // Not a URL; the exact-product-number check simply does not apply.
  }
  return "";
}

function normalizeJlc(payload: unknown): PublicPartCandidate[] {
  return items(payload).slice(0, MAX_CANDIDATES).flatMap((entry): PublicPartCandidate[] => {
    const item = record(entry);
    if (!item) return [];
    const rawSourcePartId = item.lcsc ?? item.lcsc_id ?? item.id ?? item.part_id;
    const sourcePartId = (typeof rawSourcePartId === "string" || typeof rawSourcePartId === "number") ? String(rawSourcePartId).trim().slice(0, 80) : "";
    const partNumber = text(item.mfr ?? item.mpn ?? item.manufacturer_part_number ?? item.manufacturerPartNumber, 120);
    if (!partNumber) return [];
    const packageName = text(item.package ?? item.package_name, 100);
    const description = text(item.description, 300);
    const verificationUrl = `https://www.lcsc.com/search?q=${encodeURIComponent(partNumber)}`;
    return [{
      id: `jlcsearch:${sourcePartId || partNumber}`,
      source: "jlcsearch",
      sourcePartId: sourcePartId || partNumber,
      title: text(item.title ?? item.name) || [partNumber, packageName].filter(Boolean).join(" · "),
      ...(packageName ? { package: packageName } : {}),
      ...(description ? { description } : {}),
      partNumber,
      stock: numberValue(item.stock ?? item.quantity ?? item.qty),
      price: priceValue(item.price ?? item.unit_price ?? item.unitPrice),
      currency: "USD",
      verificationUrl,
      verificationRequired: true,
    }];
  });
}

function normalizeAdafruit(payload: unknown, productId: string): PublicPartCandidate[] {
  const item = record(payload);
  if (!item) return [];
  const productUrl = urlFor("adafruit.com", item.product_url ?? item.productUrl ?? item.url) || `https://www.adafruit.com/product/${productId}`;
  const title = text(item.product_name ?? item.name ?? item.title);
  const partNumber = text(item.product_mpn ?? item.mpn ?? item.manufacturer_part_number) || `ADA-${productId}`;
  if (!title || !productUrl) return [];
  const rawStock = item.product_stock ?? item.stock ?? item.qty;
  const availability = typeof rawStock === "string" ? text(rawStock, 80) : undefined;
  return [{
    id: `adafruit:${productId}`,
    source: "adafruit",
    sourcePartId: productId,
    title,
    ...(text(item.product_brand ?? item.brand) ? { manufacturer: text(item.product_brand ?? item.brand, 120) } : {}),
    partNumber,
    ...(text(item.product_description ?? item.description, 300) ? { description: text(item.product_description ?? item.description, 300) } : {}),
    stock: numberValue(rawStock),
    ...(availability ? { availability } : {}),
    price: priceValue(item.product_price ?? item.price),
    currency: "USD",
    verificationUrl: productUrl,
    verificationRequired: true,
  }];
}

async function fetchJson(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error("public source response was too large");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try { return JSON.parse(body) as unknown; } catch { throw new Error("public source returned non-JSON data"); }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error("public source request timed out");
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function consume(key: string, limit: number, windowMs: number, burstLimit = Number.MAX_SAFE_INTEGER, burstMs = 0) {
  const now = Date.now();
  const current = buckets.get(key);
  const bucket: Bucket = current && now - current.windowStart < windowMs
    ? current
    : { windowStart: now, count: 0, burstStart: now, burstCount: 0 };
  if (burstMs > 0 && now - bucket.burstStart >= burstMs) {
    bucket.burstStart = now;
    bucket.burstCount = 0;
  }
  const retryWindow = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1_000));
  if (bucket.count >= limit || (burstMs > 0 && bucket.burstCount >= burstLimit)) {
    buckets.set(key, bucket);
    prune();
    return { allowed: false, retryAfterSeconds: retryWindow };
  }
  bucket.count += 1;
  if (burstMs > 0) bucket.burstCount += 1;
  buckets.set(key, bucket);
  prune();
  return { allowed: true, retryAfterSeconds: 0 };
}

function circuitOpen(source: PublicSourceId) {
  const state = circuits.get(source);
  return Boolean(state && state.openUntil > Date.now());
}

function recordSourceSuccess(source: PublicSourceId) {
  circuits.delete(source);
}

function recordSourceFailure(source: PublicSourceId) {
  const current = circuits.get(source) ?? { failures: 0, openUntil: 0 };
  current.failures += 1;
  if (current.failures >= 3) current.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  circuits.set(source, current);
}

function prune() {
  while (cache.size > 128) {
    const first = cache.keys().next().value;
    if (!first) break;
    cache.delete(first);
  }
  while (buckets.size > 256) {
    const first = buckets.keys().next().value;
    if (!first) break;
    buckets.delete(first);
  }
}

function cached(source: PublicSourceId, key: string) {
  const entry = cache.get(`${source}:${key}`);
  if (!entry) return undefined;
  const now = Date.now();
  if (entry.expiresAt > now) return { candidates: entry.candidates, stale: false as const };
  if (entry.staleUntil > now) return { candidates: entry.candidates, stale: true as const };
  cache.delete(`${source}:${key}`);
  return undefined;
}

async function sourceLookup(source: PublicSourceId, query: string, key: string) {
  const existing = inFlight.get(`${source}:${key}`);
  if (existing) return existing;
  const work = (async () => {
    const fresh = cached(source, key);
    if (fresh && !fresh.stale) return fresh;
    const url = source === "jlcsearch"
      ? `${JLC_ENDPOINT}?q=${encodeURIComponent(query)}&limit=${MAX_CANDIDATES}&full=true`
      : `${ADAFRUIT_ENDPOINT}/${encodeURIComponent(key)}`;
    try {
      const payload = await fetchJson(url, 8_000);
      const candidates = source === "jlcsearch" ? normalizeJlc(payload) : normalizeAdafruit(payload, key);
      const entry: CacheEntry = { candidates, expiresAt: Date.now() + FRESH_CACHE_MS, staleUntil: Date.now() + STALE_CACHE_MS };
      cache.set(`${source}:${key}`, entry);
      prune();
      recordSourceSuccess(source);
      return { candidates, stale: false };
    } catch (error) {
      const stale = cached(source, key);
      if (stale) return stale;
      recordSourceFailure(source);
      throw error;
    }
  })();
  inFlight.set(`${source}:${key}`, work);
  try { return await work; } finally { inFlight.delete(`${source}:${key}`); }
}

export function publicSourceOrder(query: string) {
  return adafruitProductId(query) ? ["adafruit", "jlcsearch", "web-search"] : ["jlcsearch", "adafruit", "web-search"];
}

export function publicSourcesEnabled(env: Env) {
  return enabled(env);
}

export async function searchPublicParts(query: string, identityKey: string) : Promise<PublicPartsSearch> {
  const order = publicSourceOrder(query);
  const requestBucket = consume(`request:${identityKey || "shared"}`, REQUEST_LIMIT, REQUEST_WINDOW_MS, REQUEST_BURST_LIMIT, REQUEST_BURST_MS);
  if (!requestBucket.allowed) {
    return {
      candidates: [],
      sourceOrder: order,
      attempts: [{ source: "request", status: "rate_limited", durationMs: 0, resultCount: 0, retryAfterSeconds: requestBucket.retryAfterSeconds, message: "Search request limit reached; use the agent handoff or retry later." }],
      cacheHit: false,
      staleCache: false,
      rateLimited: true,
      retryAfterSeconds: requestBucket.retryAfterSeconds,
      message: "Search request limit reached; the agent handoff is ready and public lookup can be retried later.",
    };
  }

  const attempts: PublicSourceAttempt[] = [];
  let sawRateLimit = false;
  let retryAfterSeconds: number | undefined;
  let cacheHit = false;
  let staleCache = false;
  for (const source of order) {
    if (source === "web-search") break;
    const sourceId = source as PublicSourceId;
    const productId = sourceId === "adafruit" ? adafruitProductId(query) : "";
    if (sourceId === "adafruit" && !productId) {
      attempts.push({ source: sourceId, status: "skipped", durationMs: 0, resultCount: 0, message: "Adafruit's no-key endpoint resolves an exact product number or URL; the agent can search its public catalog for free-form queries." });
      continue;
    }
    const key = sourceId === "adafruit" ? productId : query.toLowerCase();
    const cachedBeforeLookup = cached(sourceId, key);
    if (cachedBeforeLookup && !cachedBeforeLookup.stale) {
      cacheHit = true;
      attempts.push({ source: sourceId, status: cachedBeforeLookup.candidates.length ? "success" : "empty", durationMs: 0, resultCount: cachedBeforeLookup.candidates.length, cache: "fresh", message: "Served from the bounded public-source cache." });
      if (cachedBeforeLookup.candidates.length) return { candidates: cachedBeforeLookup.candidates.slice(0, MAX_CANDIDATES), sourceOrder: order, attempts, cacheHit, staleCache, rateLimited: sawRateLimit, message: "Public candidates returned from cache; verify every identity and offer with the agent before publication." };
      continue;
    }
    if (circuitOpen(sourceId)) {
      if (cachedBeforeLookup?.stale) {
        cacheHit = true;
        staleCache = true;
        attempts.push({ source: sourceId, status: "success", durationMs: 0, resultCount: cachedBeforeLookup.candidates.length, cache: "stale", message: "Using a bounded stale cache while the public source recovers." });
        if (cachedBeforeLookup.candidates.length) return { candidates: cachedBeforeLookup.candidates.slice(0, MAX_CANDIDATES), sourceOrder: order, attempts, cacheHit, staleCache, rateLimited: sawRateLimit, message: "Public candidates returned from a bounded stale cache; verify every identity and offer with the agent." };
      } else {
        attempts.push({ source: sourceId, status: "circuit_open", durationMs: 0, resultCount: 0, message: "Temporarily paused after repeated upstream failures." });
      }
      continue;
    }
    const sourceLimit = SOURCE_LIMITS[sourceId];
    const sourceRate = consume(`source:${sourceId}`, sourceLimit.limit, sourceLimit.windowMs);
    if (!sourceRate.allowed) {
      sawRateLimit = true;
      if (cachedBeforeLookup?.stale) {
        cacheHit = true;
        staleCache = true;
        retryAfterSeconds ??= sourceRate.retryAfterSeconds;
        attempts.push({ source: sourceId, status: "success", durationMs: 0, resultCount: cachedBeforeLookup.candidates.length, cache: "stale", retryAfterSeconds: sourceRate.retryAfterSeconds, message: "Using a bounded stale cache while the public source quota recovers." });
        if (cachedBeforeLookup.candidates.length) return { candidates: cachedBeforeLookup.candidates.slice(0, MAX_CANDIDATES), sourceOrder: order, attempts, cacheHit, staleCache, rateLimited: true, retryAfterSeconds, message: "Public candidates returned from a bounded stale cache; verify every identity and offer with the agent." };
      }
      retryAfterSeconds ??= sourceRate.retryAfterSeconds;
      attempts.push({ source: sourceId, status: "rate_limited", durationMs: 0, resultCount: 0, retryAfterSeconds: sourceRate.retryAfterSeconds, message: "Public source quota reached; continuing with the next fallback." });
      continue;
    }
    const lastCall = lastSourceCall.get(sourceId) ?? 0;
    const spacing = Date.now() - lastCall;
    if (spacing < sourceLimit.cooldownMs) await new Promise((resolve) => setTimeout(resolve, sourceLimit.cooldownMs - spacing));
    lastSourceCall.set(sourceId, Date.now());
    const startedAt = Date.now();
    try {
      const result = await sourceLookup(sourceId, query, key);
      cacheHit ||= Boolean(cachedBeforeLookup);
      staleCache ||= result.stale;
      const attempt: PublicSourceAttempt = { source: sourceId, status: result.candidates.length ? "success" : "empty", durationMs: Date.now() - startedAt, resultCount: result.candidates.length, ...(result.stale ? { cache: "stale" as const } : { cache: "fresh" as const }), ...(result.stale ? { message: "Using a bounded stale cache while the public source recovers." } : {}) };
      attempts.push(attempt);
      if (result.candidates.length) {
        return { candidates: result.candidates.slice(0, MAX_CANDIDATES), sourceOrder: order, attempts, cacheHit, staleCache, rateLimited: sawRateLimit, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}), message: result.stale ? "Public candidates returned from a bounded stale cache; verify every identity and offer with the agent." : "Public candidates returned; verify every identity and offer with the agent before publication." };
      }
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "TimeoutError";
      attempts.push({ source: sourceId, status: isTimeout ? "timeout" : "error", durationMs: Date.now() - startedAt, resultCount: 0, message: error instanceof Error ? error.message.slice(0, 120) : "Public source unavailable" });
    }
  }
  return {
    candidates: [],
    sourceOrder: order,
    attempts,
    cacheHit,
    staleCache,
    rateLimited: sawRateLimit,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    message: sawRateLimit ? "Public lookup was rate-limited; continue with the agent handoff and retry later." : "Public sources were unavailable or did not support this query; continue with the agent handoff.",
  };
}
