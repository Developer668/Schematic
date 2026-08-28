export type SessionIdentity = {
  subject: string;
  email?: string;
  fullName?: string;
  environment: "cloudflare-access" | "chatgpt-sites";
};

export type AuthEnv = {
  SCHEMATIC_AUTH_MODE?: string;
  SCHEMATIC_TRUST_PLATFORM_HEADERS?: string | boolean;
  SCHEMATIC_PLATFORM_INGRESS_SECRET?: string;
  SCHEMATIC_SESSION_SECRET?: string;
  SCHEMATIC_SESSION_TTL_SECONDS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUDIENCE?: string;
};

type JwtPayload = Record<string, unknown>;

const ISSUER = "schematic";
let accessCertificateCache: { url: string; expiresAt: number; keys: JsonWebKey[] } | null = null;

function encode(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string) {
  const padding = (4 - (value.length % 4)) % 4;
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padding));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function jsonSegment(value: Record<string, unknown>) {
  return encode(new TextEncoder().encode(JSON.stringify(value)));
}

function mode(env: AuthEnv) {
  return String(env.SCHEMATIC_AUTH_MODE ?? "cloudflare-access").trim().toLowerCase();
}

function enabled(value: string | boolean | undefined) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

async function hmacKey(env: AuthEnv) {
  const secret = String(env.SCHEMATIC_SESSION_SECRET ?? "");
  if (!secret) return null;
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueSessionToken(identity: SessionIdentity, env: AuthEnv, options: { audience?: string; ttlSeconds?: number } = {}) {
  const key = await hmacKey(env);
  if (!key) return null;
  const ttl = Math.max(15, Math.min(Number(options.ttlSeconds ?? env.SCHEMATIC_SESSION_TTL_SECONDS ?? 3600) || 3600, 86_400));
  const now = Math.floor(Date.now() / 1000);
  const header = jsonSegment({ alg: "HS256", typ: "JWT" });
  const payload = jsonSegment({ iss: ISSUER, aud: options.audience ?? "schematic-api", sub: identity.subject, iat: now, exp: now + ttl, env: identity.environment, ...(identity.email ? { email: identity.email } : {}), ...(identity.fullName ? { name: identity.fullName } : {}) });
  const message = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return `${message}.${encode(signature)}`;
}

export async function verifySessionToken(token: string | null, env: AuthEnv, expectedAudience = "schematic-api"): Promise<SessionIdentity | null> {
  if (!token) return null;
  try {
    const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
    if (!headerSegment || !payloadSegment || !signatureSegment) return null;
    const header = JSON.parse(new TextDecoder().decode(decode(headerSegment))) as JwtPayload;
    const payload = JSON.parse(new TextDecoder().decode(decode(payloadSegment))) as JwtPayload;
    if (header.alg !== "HS256" || payload.iss !== ISSUER || payload.aud !== expectedAudience) return null;
    const key = await hmacKey(env);
    if (!key || !(await crypto.subtle.verify("HMAC", key, decode(signatureSegment), new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)))) return null;
    const now = Math.floor(Date.now() / 1000);
    const subject = String(payload.sub ?? "").trim();
    if (!subject || Number(payload.exp ?? 0) <= now || Number(payload.iat ?? 0) > now + 60) return null;
    return { subject: subject.slice(0, 200), email: payload.email ? String(payload.email).slice(0, 320) : undefined, fullName: payload.name ? String(payload.name).slice(0, 320) : undefined, environment: payload.env === "chatgpt-sites" ? "chatgpt-sites" : "cloudflare-access" };
  } catch {
    return null;
  }
}

async function identityFromChatGPT(request: Request, env: AuthEnv): Promise<SessionIdentity | null> {
  const ingressSecret = String(env.SCHEMATIC_PLATFORM_INGRESS_SECRET ?? "");
  const presentedSecret = request.headers.get("x-schematic-platform-secret") ?? "";
  // A public Pages origin must not trust provider-shaped headers by default.
  // The ChatGPT Site route issues a signed bearer token itself, so this direct
  // header path is only for an explicitly private platform ingress exchange.
  if (!ingressSecret || !presentedSecret) return null;
  const [expectedHash, presentedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(ingressSecret)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(presentedSecret)),
  ]);
  if (!timingSafeEqual(new Uint8Array(expectedHash), new Uint8Array(presentedHash))) return null;
  const subject = request.headers.get("oai-authenticated-user-id")?.trim();
  if (!subject) return null;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const fullName = encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
    ? safeDecode(encodedName)
    : undefined;
  return { subject: subject.slice(0, 200), email: request.headers.get("oai-authenticated-user-email")?.trim().slice(0, 320) || undefined, fullName: fullName?.slice(0, 320), environment: "chatgpt-sites" };
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function safeDecode(value: string) {
  try { return decodeURIComponent(value); } catch { return undefined; }
}

async function accessKeys(env: AuthEnv) {
  const configured = String(env.CF_ACCESS_TEAM_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!configured) return [];
  const url = `https://${configured}/cdn-cgi/access/certs`;
  if (accessCertificateCache && accessCertificateCache.url === url && accessCertificateCache.expiresAt > Date.now()) return accessCertificateCache.keys;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return [];
  const body = await response.json() as { keys?: JsonWebKey[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  accessCertificateCache = { url, keys, expiresAt: Date.now() + 10 * 60 * 1000 };
  return keys;
}

async function identityFromAccess(request: Request, env: AuthEnv): Promise<SessionIdentity | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || mode(env) !== "cloudflare-access") return null;
  try {
    const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
    const header = JSON.parse(new TextDecoder().decode(decode(headerSegment))) as JwtPayload;
    const payload = JSON.parse(new TextDecoder().decode(decode(payloadSegment))) as JwtPayload;
    const key = (await accessKeys(env)).find((candidate) => (candidate as JsonWebKey & { kid?: string }).kid === header.kid);
    if (header.alg !== "RS256" || !key) return null;
    const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, decode(signatureSegment), new TextEncoder().encode(`${headerSegment}.${payloadSegment}`));
    const domain = String(env.CF_ACCESS_TEAM_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const issuer = String(payload.iss ?? "").replace(/\/+$/, "");
    const expectedAudience = String(env.CF_ACCESS_AUDIENCE ?? "").trim();
    const audiences = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud ?? "")];
    const now = Math.floor(Date.now() / 1000);
    const subject = String(payload.sub ?? payload.email ?? "").trim();
    // Access is a provider boundary, not merely a signed blob. Missing team
    // domain or audience configuration must reject every assertion so an
    // accidentally incomplete deployment cannot accept a token for another
    // Access application.
    if (!domain || !expectedAudience || !valid || !subject || issuer !== `https://${domain}` || !audiences.includes(expectedAudience) || Number(payload.exp ?? 0) <= now || Number(payload.iat ?? 0) > now + 60) return null;
    return { subject: subject.slice(0, 200), email: payload.email ? String(payload.email).slice(0, 320) : undefined, fullName: payload.name ? String(payload.name).slice(0, 320) : undefined, environment: "cloudflare-access" };
  } catch {
    return null;
  }
}

export async function platformIdentity(request: Request, env: AuthEnv) {
  if (mode(env) === "chatgpt-sites") return enabled(env.SCHEMATIC_TRUST_PLATFORM_HEADERS) ? identityFromChatGPT(request, env) : null;
  return identityFromAccess(request, env);
}

export function responseForSession(identity: SessionIdentity | null, token: string | null, env: AuthEnv) {
  // A provider identity without an API session is not an authenticated
  // application session. Reporting it as authenticated would leave the UI
  // signed in while every protected API call is rejected.
  const authenticated = Boolean(identity && token);
  return {
    authenticated,
    subject: authenticated ? identity?.subject ?? null : null,
    email: authenticated ? identity?.email ?? null : null,
    fullName: authenticated ? identity?.fullName ?? null : null,
    environment: identity?.environment ?? mode(env),
    token,
    ...(token ? { expiresIn: Math.max(60, Math.min(Number(env.SCHEMATIC_SESSION_TTL_SECONDS ?? 3600) || 3600, 86_400)) } : {}),
  };
}
