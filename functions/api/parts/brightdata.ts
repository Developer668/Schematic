import { readBoundedResponseText } from "./bounded-response";

type Env = Record<string, unknown>;
type Candidate = Record<string, unknown>;

export type BrightDataSearch = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

type CacheEntry = { expiresAt: number; result: BrightDataSearch };
type Bucket = { startedAt: number; count: number };

const MAX_QUERY_LENGTH = 240;
const MAX_RESULTS = 16;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 96;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<BrightDataSearch>>();
const userHourly = new Map<string, Bucket>();
const userDaily = new Map<string, Bucket>();
let globalDaily: Bucket | undefined;
let blockedUntil = 0;

function envString(env: Env, key: string) {
  const value = env[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).trim() : "";
}

function truthy(value: string) {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function boundedInt(value: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function text(value: unknown, max = 240) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function safeHttps(value: unknown) {
  const candidate = text(value, 2_000);
  if (!candidate || candidate.startsWith("data:")) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if ((url.hostname === "google.com" || url.hostname.endsWith(".google.com")) && url.pathname === "/url") {
      return safeHttps(url.searchParams.get("q") ?? url.searchParams.get("url"));
    }
    return url.toString();
  } catch { return ""; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function first(item: Record<string, unknown>, keys: string[], max = 240) {
  for (const key of keys) {
    const value = text(item[key], max);
    if (value) return value;
  }
  return "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const nested = record(value);
  if (nested) for (const key of ["value", "amount", "price", "extracted_value"]) {
    const parsed = numberValue(nested[key]);
    if (parsed !== null) return parsed;
  }
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function fnv(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 4; index += 1) {
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!/^[\[{\"]/.test(trimmed)) return current;
      try { current = JSON.parse(trimmed); continue; } catch { return current; }
    }
    if (Array.isArray(current) && current.length === 1) { current = current[0]; continue; }
    const item = record(current);
    if (item && typeof (item.body ?? item.content ?? item.response) === "string") {
      try { current = JSON.parse(String(item.body ?? item.content ?? item.response)); continue; } catch { return current; }
    }
    return current;
  }
  return current;
}

function shoppingItems(value: unknown): Record<string, unknown>[] {
  const current = unwrap(value);
  if (Array.isArray(current)) return current.filter((item): item is Record<string, unknown> => Boolean(record(item)));
  const item = record(current);
  if (!item) return [];
  const found: Record<string, unknown>[] = [];
  for (const key of ["shopping", "shopping_results", "shoppingResults", "top_pla", "pla", "products", "product_results", "productResults", "items", "results"]) {
    if (Array.isArray(item[key])) found.push(...item[key].filter((entry): entry is Record<string, unknown> => Boolean(record(entry))));
  }
  if (found.length) return found;
  for (const key of ["body", "content", "response", "data", "result"]) {
    const nested = shoppingItems(item[key]);
    if (nested.length) return nested;
  }
  return [];
}

function currency(item: Record<string, unknown>, price: unknown, fallback: string) {
  const explicit = first(item, ["currency", "currency_code", "currencyCode"], 3).toUpperCase();
  if (/^[A-Z]{3}$/.test(explicit)) return explicit;
  const raw = text(price, 80);
  if (raw.includes("€")) return "EUR";
  if (raw.includes("£")) return "GBP";
  if (raw.includes("C$") || raw.includes("CA$")) return "CAD";
  if (raw.includes("A$") || raw.includes("AU$")) return "AUD";
  if (raw.includes("¥")) return "JPY";
  return /^[A-Z]{3}$/.test(fallback) ? fallback : "USD";
}

function candidate(item: Record<string, unknown>, query: string, rank: number, fallbackCurrency: string): Candidate | null {
  const title = first(item, ["title", "name", "product_title", "productTitle"]);
  if (!title) return null;
  const retailer = first(item, ["shop", "retailer", "seller", "store", "source"], 160) || "Google Shopping";
  let verificationUrl = "";
  for (const key of ["link", "url", "product_link", "productLink", "product_url", "productUrl", "merchant_link", "href"]) {
    verificationUrl = safeHttps(item[key]);
    if (verificationUrl) break;
  }
  if (!verificationUrl) verificationUrl = `https://www.google.com/search?q=${encodeURIComponent(`${title} ${retailer}`)}&tbm=shop`;
  const rawPrice = item.extracted_price ?? item.price;
  const sourcePartId = first(item, ["product_id", "productId", "id", "sku"], 120) || fnv(`${title}|${retailer}|${verificationUrl}|${rank}`);
  const partNumber = first(item, ["part_number", "partNumber", "mpn", "manufacturer_part_number", "manufacturerPartNumber", "model", "sku"], 120) || (/[0-9]/.test(query) ? query : "");
  const imageUrl = ["image_url", "imageUrl", "thumbnail", "thumbnail_url", "image"].map((key) => safeHttps(item[key])).find(Boolean) ?? "";
  const availability = first(item, ["availability", "stock_status", "stockStatus"], 120);
  const shipping = first(item, ["shipping", "delivery", "delivery_info", "deliveryInfo"], 180);
  const description = first(item, ["description", "snippet", "subtitle"], 420);
  const price = numberValue(rawPrice);
  const rating = numberValue(item.rating);
  const reviews = numberValue(item.reviews_cnt ?? item.reviews ?? item.review_count);
  return {
    id: `brightdata:${fnv(`${sourcePartId}|${verificationUrl}`)}`,
    source: "brightdata-serp", sourcePartId, title, partNumber,
    ...(first(item, ["manufacturer", "brand", "maker"], 160) ? { manufacturer: first(item, ["manufacturer", "brand", "maker"], 160) } : {}),
    ...(description ? { description } : {}), stock: numberValue(item.stock), ...(availability ? { availability } : {}), price,
    currency: price === null ? null : currency(item, rawPrice, fallbackCurrency), verificationUrl, verificationRequired: true, retailer,
    ...(shipping ? { shipping } : {}), ...(imageUrl ? { imageUrl } : {}), ...(rating !== null && rating <= 5 ? { rating } : {}),
    ...(reviews !== null ? { reviewCount: Math.round(reviews) } : {}), rank,
  };
}

function response(query: string, quantity: number, status: "success" | "empty" | "error" | "timeout" | "rate_limited" | "circuit_open", durationMs: number, candidates: Candidate[], message: string, statusCode = 200, retryAfterSeconds?: number): BrightDataSearch {
  const rateLimited = status === "rate_limited" || status === "circuit_open";
  return {
    status: statusCode,
    ...(retryAfterSeconds ? { headers: { "Retry-After": String(retryAfterSeconds) } } : {}),
    body: {
      code: candidates.length ? "LIVE_SHOPPING_RESULTS" : rateLimited ? "BRIGHTDATA_RATE_LIMITED" : status === "empty" ? "BRIGHTDATA_NO_RESULTS" : "BRIGHTDATA_UNAVAILABLE",
      query, quantity, source: "brightdata-serp", liveOffers: candidates.length > 0, cartEligible: false, candidates, sourceOrder: ["brightdata-serp"],
      attempts: [{ source: "brightdata-serp", status, durationMs, resultCount: candidates.length, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }],
      cacheHit: false, staleCache: false, rateLimited, ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      publication: { required: true, returnTool: "shopping.search", reason: "Live web results must be checked against the exact component and checkout page before becoming a canonical cart record." }, message,
    },
  };
}

function available(bucket: Bucket | undefined, limit: number, windowMs: number) {
  const now = Date.now();
  const current = bucket && now - bucket.startedAt < windowMs ? bucket : { startedAt: now, count: 0 };
  if (current.count >= limit) return { allowed: false, bucket: current, retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1_000)) };
  return { allowed: true, bucket: current, retryAfterSeconds: 0 };
}

function prune() {
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  while (userHourly.size > 512) userHourly.delete(userHourly.keys().next().value as string);
  while (userDaily.size > 512) userDaily.delete(userDaily.keys().next().value as string);
}

function forQuantity(result: BrightDataSearch, quantity: number): BrightDataSearch {
  return { ...result, body: { ...result.body, quantity } };
}

export function brightDataEnabled(env: Env) {
  return truthy(envString(env, "BRIGHTDATA_SERP_ENABLED")) && Boolean(envString(env, "BRIGHTDATA_API_KEY"));
}

/** Test-only state reset. Production code never calls this. */
export function resetBrightDataStateForTests() {
  cache.clear();
  inFlight.clear();
  userHourly.clear();
  userDaily.clear();
  globalDaily = undefined;
  blockedUntil = 0;
}

export async function searchBrightData(queryInput: string, quantity: number, subject: string, env: Env): Promise<BrightDataSearch> {
  const query = text(queryInput, MAX_QUERY_LENGTH);
  if (!query) return response(query, quantity, "error", 0, [], "Enter a part number, board, sensor, module, tool, or manufacturer.", 400);
  const zone = envString(env, "BRIGHTDATA_SERP_ZONE") || "serp_api1";
  const country = (envString(env, "BRIGHTDATA_SERP_COUNTRY") || "us").toLowerCase();
  const language = (envString(env, "BRIGHTDATA_SERP_LANGUAGE") || "en").toLowerCase();
  const fallbackCurrency = (envString(env, "BRIGHTDATA_SERP_CURRENCY") || "USD").toUpperCase();
  const key = `${query.toLowerCase()}\0${zone}\0${country}\0${language}\0${fallbackCurrency}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...forQuantity(cached.result, quantity), body: { ...cached.result.body, quantity, cacheHit: true } };
  if (cached) cache.delete(key);
  const pending = inFlight.get(key);
  if (pending) return pending.then((result) => forQuantity(result, quantity));
  const now = Date.now();
  if (blockedUntil > now) return response(query, quantity, "circuit_open", 0, [], "Shopping search is temporarily paused to protect the provider quota.", 429, Math.ceil((blockedUntil - now) / 1_000));
  const hourly = available(userHourly.get(subject), boundedInt(envString(env, "BRIGHTDATA_MAX_REQUESTS_PER_HOUR"), 10, 1, 100), 60 * 60_000);
  const daily = available(userDaily.get(subject), boundedInt(envString(env, "BRIGHTDATA_MAX_REQUESTS_PER_DAY"), 40, 1, 500), 24 * 60 * 60_000);
  const global = available(globalDaily, boundedInt(envString(env, "BRIGHTDATA_MAX_GLOBAL_REQUESTS_PER_DAY"), 200, 1, 2_000), 24 * 60 * 60_000);
  if (!hourly.allowed || !daily.allowed || !global.allowed) {
    const retry = Math.max(hourly.retryAfterSeconds, daily.retryAfterSeconds, global.retryAfterSeconds);
    return response(query, quantity, "rate_limited", 0, [], "Shopping search limit reached. Cached searches remain available; try again later.", 429, retry);
  }
  hourly.bucket.count += 1;
  daily.bucket.count += 1;
  global.bucket.count += 1;
  userHourly.set(subject, hourly.bucket);
  userDaily.set(subject, daily.bucket);
  globalDaily = global.bucket;
  const work = (async () => {
    const started = Date.now();
    const controller = new AbortController();
    const timeoutMs = boundedInt(envString(env, "BRIGHTDATA_SERP_TIMEOUT_SECONDS"), 20, 5, 30) * 1_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const target = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=shop&gl=${encodeURIComponent(country)}&hl=${encodeURIComponent(language)}&brd_json=json`;
      const endpoint = "https://api.brightdata.com/request";
      const send = (format: "json" | "raw") => fetch(endpoint, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${envString(env, "BRIGHTDATA_API_KEY")}` }, body: JSON.stringify({ zone, url: target, format, method: "GET", country }), signal: controller.signal });
      let upstream = await send("json");
      if (upstream.status === 400 || upstream.status === 422) { await upstream.arrayBuffer(); upstream = await send("raw"); }
      const duration = Date.now() - started;
      if (upstream.status === 429) {
        const retry = boundedInt(upstream.headers.get("retry-after") ?? "", 60, 1, 3_600);
        blockedUntil = Date.now() + retry * 1_000;
        return response(query, quantity, "rate_limited", duration, [], "Bright Data is rate limiting shopping searches. Try again later.", 429, retry);
      }
      if (upstream.status === 401 || upstream.status === 403) { blockedUntil = Date.now() + 5 * 60_000; return response(query, quantity, "error", duration, [], "Shopping search is temporarily unavailable.", 503); }
      if (!upstream.ok) return response(query, quantity, "error", duration, [], "Shopping search provider is temporarily unavailable.", upstream.status >= 500 ? 503 : 502);
      const raw = await readBoundedResponseText(upstream, MAX_RESPONSE_BYTES);
      let payload: unknown;
      try { payload = JSON.parse(raw); } catch { return response(query, quantity, "error", duration, [], "Shopping provider returned an invalid response.", 502); }
      const seen = new Set<string>();
      const candidates = shoppingItems(payload).flatMap((item, index) => {
        const value = candidate(item, query, index + 1, fallbackCurrency);
        if (!value) return [];
        const identity = `${String(value.title).toLowerCase()}|${String(value.retailer).toLowerCase()}|${String(value.verificationUrl)}`;
        if (seen.has(identity)) return [];
        seen.add(identity);
        return [value];
      }).slice(0, MAX_RESULTS);
      const result = response(query, quantity, candidates.length ? "success" : "empty", duration, candidates, candidates.length ? `Found ${candidates.length} current shopping result${candidates.length === 1 ? "" : "s"}. Confirm seller, model, stock, shipping, and checkout total.` : "No matching shopping listings were found. Try an exact manufacturer part number or board name.");
      const ttlSeconds = boundedInt(envString(env, candidates.length ? "BRIGHTDATA_SERP_CACHE_TTL_SECONDS" : "BRIGHTDATA_SERP_EMPTY_CACHE_TTL_SECONDS"), candidates.length ? 900 : 300, 60, 3_600);
      cache.set(key, { expiresAt: Date.now() + ttlSeconds * 1_000, result });
      prune();
      return result;
    } catch (error) {
      const duration = Date.now() - started;
      const timedOut = error instanceof Error && error.name === "AbortError";
      return response(query, quantity, timedOut ? "timeout" : "error", duration, [], timedOut ? "Shopping search timed out. Try again later." : "Shopping search is temporarily unavailable.", timedOut ? 504 : 503);
    } finally { clearTimeout(timeout); }
  })();
  inFlight.set(key, work);
  try { return await work; } finally { inFlight.delete(key); }
}
