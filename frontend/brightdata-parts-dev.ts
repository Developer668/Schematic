import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_RESULTS = 16;
const cache = new Map<string, { expiresAt: number; payload: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

function parseEnvFile(filePath: string) {
  const values: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function boundedText(value: unknown, limit = 240) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
}

function firstText(item: Record<string, unknown>, keys: string[], limit = 240) {
  for (const key of keys) {
    const value = boundedText(item[key], limit);
    if (value) return value;
  }
  return "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "amount", "price", "extracted_value"]) {
      const parsed = numberValue(record[key]);
      if (parsed !== null) return parsed;
    }
  }
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeHttpsUrl(value: unknown) {
  const candidate = boundedText(value, 2_000);
  if (!candidate || candidate.startsWith("data:")) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (url.hostname.endsWith("google.com") && url.pathname === "/url") {
      const redirected = url.searchParams.get("q") || url.searchParams.get("url");
      if (redirected) return safeHttpsUrl(redirected);
    }
    return url.toString();
  } catch {
    return "";
  }
}

function unwrapPayload(input: unknown): unknown {
  let value = input;
  for (let index = 0; index < 4; index += 1) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith('"')) return value;
      try { value = JSON.parse(trimmed); } catch { return value; }
      continue;
    }
    if (Array.isArray(value) && value.length === 1) {
      value = value[0];
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const nested = record.body ?? record.content ?? record.response;
      if (typeof nested === "string") {
        try { value = JSON.parse(nested); continue; } catch { /* use outer record */ }
      }
    }
    return value;
  }
  return value;
}

function shoppingItems(input: unknown): Record<string, unknown>[] {
  const value = unwrapPayload(input);
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const collected: Record<string, unknown>[] = [];
  for (const key of ["shopping", "shopping_results", "shoppingResults", "top_pla", "pla", "products", "product_results", "productResults", "items", "results"]) {
    const items = record[key];
    if (Array.isArray(items)) collected.push(...items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)));
  }
  if (collected.length) return collected;
  for (const key of ["body", "content", "response", "data", "result"]) {
    const nested = shoppingItems(record[key]);
    if (nested.length) return nested;
  }
  return [];
}

function currencyFor(item: Record<string, unknown>, rawPrice: unknown, fallback: string) {
  const explicit = firstText(item, ["currency", "currency_code", "currencyCode"], 3).toUpperCase();
  if (/^[A-Z]{3}$/.test(explicit)) return explicit;
  const price = boundedText(rawPrice, 80);
  if (price.includes("€")) return "EUR";
  if (price.includes("£")) return "GBP";
  if (price.includes("C$") || price.includes("CA$")) return "CAD";
  if (price.includes("A$") || price.includes("AU$")) return "AUD";
  if (price.includes("¥")) return "JPY";
  return /^[A-Z]{3}$/.test(fallback) ? fallback : "USD";
}

function normalizeShoppingItem(item: Record<string, unknown>, query: string, rank: number, currency: string) {
  const title = firstText(item, ["title", "name", "product_title", "productTitle"]);
  if (!title) return null;
  const retailer = firstText(item, ["shop", "retailer", "seller", "store", "source"], 160) || "Retailer listing";
  let verificationUrl = "";
  for (const key of ["link", "url", "product_link", "productLink", "product_url", "productUrl", "merchant_link", "href"]) {
    verificationUrl = safeHttpsUrl(item[key]);
    if (verificationUrl) break;
  }
  if (!verificationUrl) verificationUrl = `https://www.google.com/search?q=${encodeURIComponent(`${title} ${retailer}`)}&tbm=shop`;
  const rawPrice = item.extracted_price ?? item.price;
  const price = numberValue(rawPrice);
  const sourcePartId = firstText(item, ["product_id", "productId", "id", "sku"], 120)
    || createHash("sha256").update(`${title}|${retailer}|${verificationUrl}|${rank}`).digest("hex").slice(0, 20);
  const explicitPart = firstText(item, ["part_number", "partNumber", "mpn", "manufacturer_part_number", "manufacturerPartNumber", "model", "sku"], 120);
  const partNumber = explicitPart || (/[0-9]/.test(query) && query.length <= 120 ? query : "");
  let imageUrl = "";
  for (const key of ["image_url", "imageUrl", "thumbnail", "thumbnail_url", "shop_logo", "image"]) {
    imageUrl = safeHttpsUrl(item[key]);
    if (imageUrl) break;
  }
  const rating = numberValue(item.rating);
  const reviewCount = numberValue(item.reviews_cnt ?? item.reviews ?? item.review_count);
  const shipping = firstText(item, ["shipping", "delivery", "delivery_info", "deliveryInfo"], 180);
  const availability = firstText(item, ["availability", "stock_status", "stockStatus"], 120);
  const description = firstText(item, ["description", "snippet", "subtitle"], 420);
  const id = createHash("sha256").update(`brightdata|${sourcePartId}|${verificationUrl}`).digest("hex").slice(0, 24);
  return {
    id: `brightdata:${id}`,
    source: "brightdata-serp",
    sourcePartId,
    title,
    partNumber,
    ...(firstText(item, ["manufacturer", "brand", "maker"], 160) ? { manufacturer: firstText(item, ["manufacturer", "brand", "maker"], 160) } : {}),
    ...(description ? { description } : {}),
    stock: numberValue(item.stock),
    ...(availability ? { availability } : {}),
    price,
    currency: price === null ? null : currencyFor(item, rawPrice, currency),
    verificationUrl,
    verificationRequired: true,
    retailer,
    ...(shipping ? { shipping } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(rating !== null && rating <= 5 ? { rating } : {}),
    ...(reviewCount !== null ? { reviewCount: Math.round(reviewCount) } : {}),
    rank,
  };
}

async function boundedJson(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error("Bright Data response exceeded the local safety limit.");
  if (!response.body) return JSON.parse(await response.text());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("Bright Data response exceeded the local safety limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function localRequest(req: IncomingMessage) {
  const remote = req.socket.remoteAddress || "";
  const host = (req.headers.host || "").split(":")[0].toLowerCase();
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)
    && ["localhost", "127.0.0.1", "[::1]"].includes(host);
}

function sendJson(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(body);
}

async function liveSearch(query: string, quantity: number, config: Record<string, string>) {
  const endpoint = config.BRIGHTDATA_SERP_ENDPOINT || "https://api.brightdata.com/request";
  const zone = config.BRIGHTDATA_SERP_ZONE || "serp_api1";
  const country = (config.BRIGHTDATA_SERP_COUNTRY || "us").toLowerCase();
  const language = (config.BRIGHTDATA_SERP_LANGUAGE || "en").toLowerCase();
  const currency = (config.BRIGHTDATA_SERP_CURRENCY || "USD").toUpperCase();
  const target = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=shop&gl=${encodeURIComponent(country)}&hl=${encodeURIComponent(language)}&brd_json=json`;
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const send = (payload: Record<string, unknown>) => fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.BRIGHTDATA_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let response = await send({ zone, url: target, format: "json", method: "GET", country });
    if (response.status === 400 || response.status === 422) {
      await response.arrayBuffer();
      response = await send({ zone, url: target, format: "raw", method: "GET", country });
    }
    const durationMs = Math.round(performance.now() - started);
    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("retry-after") || 30) || 30;
      return { status: 429, payload: { code: "BRIGHTDATA_RATE_LIMITED", query, quantity, source: "brightdata-serp", candidates: [], sourceOrder: ["brightdata-serp"], attempts: [{ source: "brightdata-serp", status: "rate_limited", durationMs, resultCount: 0 }], rateLimited: true, retryAfterSeconds, message: "Bright Data is rate limiting shopping searches. Wait briefly, then retry." }, headers: { "Retry-After": String(retryAfterSeconds) } };
    }
    if (!response.ok) {
      return { status: response.status === 401 || response.status === 403 ? 503 : 502, payload: { code: "BRIGHTDATA_UPSTREAM_ERROR", query, quantity, source: "brightdata-serp", candidates: [], sourceOrder: ["brightdata-serp"], attempts: [{ source: "brightdata-serp", status: "error", durationMs, resultCount: 0 }], rateLimited: false, message: response.status === 401 || response.status === 403 ? "Bright Data rejected the server credential or SERP zone configuration." : `Bright Data returned HTTP ${response.status}.` } };
    }
    const parsed = await boundedJson(response);
    const seen = new Set<string>();
    const candidates = shoppingItems(parsed).flatMap((item, index) => {
      const candidate = normalizeShoppingItem(item, query, index + 1, currency);
      if (!candidate) return [];
      const identity = `${candidate.title.toLowerCase()}|${candidate.retailer.toLowerCase()}|${candidate.verificationUrl}`;
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [candidate];
    }).slice(0, MAX_RESULTS);
    return {
      status: 200,
      payload: {
        code: candidates.length ? "LIVE_SHOPPING_RESULTS" : "BRIGHTDATA_NO_RESULTS",
        query,
        quantity,
        source: "brightdata-serp",
        liveOffers: true,
        cartEligible: false,
        candidates,
        sourceOrder: ["brightdata-serp"],
        attempts: [{ source: "brightdata-serp", status: candidates.length ? "success" : "empty", durationMs, resultCount: candidates.length }],
        cacheHit: false,
        staleCache: false,
        rateLimited: false,
        publication: { required: true, returnTool: "shopping.search", reason: "Live web results must be checked against the exact component and checkout page before becoming a canonical cart record." },
        message: candidates.length
          ? `Found ${candidates.length} current supplier listing${candidates.length === 1 ? "" : "s"}. Confirm the exact model, seller, stock, shipping, and checkout total.`
          : "No supplier listings matched. Try an exact manufacturer part number or board name.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function brightDataPartsDevPlugin(frontendRoot: string): Plugin {
  const config = parseEnvFile(path.resolve(frontendRoot, "../backend/.env"));
  return {
    name: "schematic-brightdata-parts-dev",
    configureServer(server) {
      // Pre-transform the complete Parts and landing paths after each
      // dev-server restart so syntax/import regressions are reported even
      // when no browser tab is currently connected.
      queueMicrotask(() => {
        void Promise.all([
          "/src/pages/PartsPage.tsx",
          "/src/pages/LandingPage.tsx",
          "/src/components/shopping/ShoppingWorkspace.tsx",
          "/src/shopping/partsSearchClient.ts",
          "/src/store/useShoppingStore.ts",
          "/src/workspace-v2.css",
          "/src/landing-v2.css",
        ].map((moduleId) => server.transformRequest(moduleId))).catch((error: unknown) => {
          server.config.logger.error(`[parts-preflight] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        });
      });

      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url || "/", "http://localhost");
        if (requestUrl.pathname !== "/api/parts/search") return next();
        if (req.method !== "GET") return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED", message: "Use GET for parts search." }, { Allow: "GET" });
        if (!localRequest(req)) return sendJson(res, 403, { code: "LOCAL_ONLY", message: "The local Bright Data development route is available only from this computer." });
        const requestId = boundedText(req.headers["x-schematic-request-id"], 200);
        const fetchSite = boundedText(req.headers["sec-fetch-site"], 40).toLowerCase();
        if (!requestId.startsWith("parts-") || (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite))) {
          return sendJson(res, 400, { code: "INVALID_REQUEST_CONTEXT", message: "Use Schematic's Parts search interface to run this request." });
        }
        const query = (requestUrl.searchParams.get("query") || "").replace(/\s+/g, " ").trim().slice(0, 240);
        const quantity = Math.max(1, Math.min(999, Math.round(Number(requestUrl.searchParams.get("quantity") || 1) || 1)));
        if (!query) return sendJson(res, 400, { code: "INVALID_QUERY", message: "Enter a part number, board, sensor, module, tool, or manufacturer.", query, quantity });
        if (!config.BRIGHTDATA_API_KEY) return sendJson(res, 503, { code: "PARTS_PROVIDER_NOT_CONFIGURED", message: "The server-only Bright Data key is not configured.", candidates: [] });
        const key = `${query.toLowerCase()}\0${quantity}\0${config.BRIGHTDATA_SERP_ZONE || "serp_api1"}`;
        const cached = cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
          const payload = cached.payload && typeof cached.payload === "object" ? { ...(cached.payload as Record<string, unknown>), cacheHit: true } : cached.payload;
          return sendJson(res, 200, payload);
        }
        if (cached) cache.delete(key);
        let pending = inFlight.get(key);
        if (!pending) {
          pending = liveSearch(query, quantity, config).then((result) => {
            if (result.status === 200) {
              cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload: result.payload });
              while (cache.size > 64) cache.delete(cache.keys().next().value as string);
            }
            return result;
          }).finally(() => inFlight.delete(key));
          inFlight.set(key, pending);
        }
        try {
          const result = await pending as Awaited<ReturnType<typeof liveSearch>>;
          const payload = result.payload && typeof result.payload === "object"
            ? result.payload as Record<string, unknown>
            : {};
          const candidateCount = Array.isArray(payload.candidates) ? payload.candidates.length : 0;
          server.config.logger.info(`[parts-search] status=${result.status} code=${boundedText(payload.code, 80)} candidates=${candidateCount} query=${JSON.stringify(query)}`);
          return sendJson(res, result.status, result.payload, result.headers ?? {});
        } catch (error) {
          const message = error instanceof Error && error.name === "AbortError"
            ? "Bright Data did not finish the shopping search in time."
            : error instanceof Error ? error.message : "Bright Data could not complete the shopping search.";
          return sendJson(res, 503, { code: "BRIGHTDATA_UNAVAILABLE", query, quantity, source: "brightdata-serp", candidates: [], sourceOrder: ["brightdata-serp"], attempts: [{ source: "brightdata-serp", status: "error", durationMs: 0, resultCount: 0, message }], rateLimited: false, message });
        }
      });
    },
  };
}
