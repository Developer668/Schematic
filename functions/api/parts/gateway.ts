/**
 * Boundary between public parts-source adapters and transport policy.
 *
 * The gateway request deliberately carries cache and rate-limit metadata. A
 * deployment can provide the shared limiter/cache implementation without
 * making an adapter aware of its storage or coordination details. The direct
 * implementation is only a safe fetch seam for local use and tests; it does
 * not pretend to be a distributed limiter or cache.
 */

export type PartsSourceId = "jlcsearch" | "adafruit";

export type PartsSourceRateLimit = {
  maxRequests: number;
  windowMs: number;
};

export type PartsGatewayRequest = {
  source: PartsSourceId;
  url: string;
  allowedHosts: readonly string[];
  init: RequestInit;
  cacheKey: string;
  cacheTtlSeconds: number;
  timeoutMs: number;
  rateLimit?: PartsSourceRateLimit;
};

export type PartsGatewayResponse = {
  response: Response;
  cacheHit?: boolean;
};

/**
 * Implement this interface with the shared parts limiter/cache module. The
 * adapter only submits fixed-source requests and consumes a Response; it
 * never receives provider credentials or arbitrary caller URLs.
 */
export interface PartsSourceGateway {
  fetch(input: PartsGatewayRequest): Promise<PartsGatewayResponse>;
}

export type PartsFetch = typeof fetch;

function normalizedHost(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function isPrivateLiteralHost(hostname: string) {
  const host = normalizedHost(hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "ip6-localhost" || host === "ip6-loopback") return true;
  if (host.startsWith("[") && host.endsWith("]")) return true;
  if (!/^\d+(?:\.\d+){3}$/.test(host)) return host.includes(":");
  const octets = host.split(".").map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 198 && (second === 18 || second === 19));
}

export function isAllowedPartsUrl(value: unknown, allowedHosts: readonly string[]) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    const host = normalizedHost(url.hostname);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && !isPrivateLiteralHost(url.hostname)
      && allowedHosts.some((allowed) => normalizedHost(allowed) === host);
  } catch {
    return false;
  }
}

function safeRequestHeaders(input: HeadersInit | undefined) {
  const requested = new Headers(input);
  const headers = new Headers({ Accept: "application/json" });
  // Public adapters are intentionally no-account. Keep the direct seam from
  // forwarding credentials even if a caller accidentally supplies them.
  for (const name of ["accept-language", "user-agent"]) {
    const value = requested.get(name);
    if (value) headers.set(name, value.slice(0, 120));
  }
  return headers;
}

async function directFetch(fetchImpl: PartsFetch, input: PartsGatewayRequest) {
  if (!isAllowedPartsUrl(input.url, input.allowedHosts)) throw new Error("Parts gateway rejected a non-public source URL");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const upstreamSignal = input.init.signal;
  const abort = () => controller.abort();
  upstreamSignal?.addEventListener("abort", abort, { once: true });
  const init: RequestInit = {
    method: "GET",
    headers: safeRequestHeaders(input.init.headers),
    credentials: "omit",
    signal: controller.signal,
  };
  try {
    return await fetchImpl(input.url, init);
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abort);
  }
}

export function createDirectPartsSourceGateway(fetchImpl: PartsFetch = globalThis.fetch): PartsSourceGateway {
  return {
    async fetch(input) {
      if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this runtime");
      return { response: await directFetch(fetchImpl, input) };
    },
  };
}
