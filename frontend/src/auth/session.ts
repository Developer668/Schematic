import { useEffect, useState } from "react";

export type AuthEnvironment = "local" | "cloudflare-access" | "chatgpt-sites" | "firebase" | "chatgpt-oauth" | "unknown";

export interface AuthSession {
  authenticated: true;
  subject: string;
  userId: string;
  email?: string;
  fullName?: string;
  environment: AuthEnvironment;
  token?: string;
  expiresIn?: number;
}

const SESSION_EVENT = "schematic-session";
let cachedSession: AuthSession | null | undefined;
type SessionRequest = {
  id: number;
  epoch: number;
  promise: Promise<AuthSession | null>;
};

let sessionRequest: SessionRequest | null = null;
let authReadyPromise: Promise<AuthSession | null> | null = null;
let cachedSessionExpiresAt = 0;
const SESSION_REFRESH_SKEW_MS = 30_000;
let requestSequence = 0;
let latestRequestId = 0;
let sessionEpoch = 0;

function isLocalHost() {
  return typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function configuredBackend() {
  const value = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim();
  if (value) return value.replace(/\/+$/, "");
  // Vite preview does not consistently inherit the dev proxy. Keep local
  // verification working without adding a second auth setup or Docker.
  if (isLocalHost() && window.location.port === "4173") return `${window.location.protocol}//${window.location.hostname}:8001`;
  return "";
}

function configuredAuth() {
  const value = (import.meta.env.VITE_AUTH_URL as string | undefined)?.trim();
  if (value) return value.replace(/\/+$/, "");
  // The session issuer belongs to the current hosting boundary. In a local
  // preview the API is still the explicitly started FastAPI process; on
  // Pages/Sites it is the same-origin Function/route that can see the
  // platform's identity headers. It must not silently follow an arbitrary
  // remote API origin.
  if (isLocalHost() && window.location.port === "4173") return `${window.location.protocol}//${window.location.hostname}:8001`;
  return "";
}

export function apiUrl(path: string) {
  const base = configuredBackend();
  return base ? `${base}${path.startsWith("/") ? path : `/${path}`}` : path;
}

export function authUrl(path: string) {
  const base = configuredAuth();
  return base ? `${base}${path.startsWith("/") ? path : `/${path}`}` : path;
}

function localDevelopmentSession(): AuthSession | null {
  if (!isLocalHost()) return null;
  return {
    authenticated: true,
    subject: "local-development",
    userId: "local-development",
    email: "local@localhost",
    fullName: "Local development",
    environment: "local",
  };
}

function normalizeSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const authenticated = data.authenticated === true;
  const subject = String(data.subject ?? data.userId ?? "").trim();
  if (!authenticated || !subject) return null;
  const environment = String(data.environment ?? "unknown") as AuthEnvironment;
  return {
    authenticated: true,
    subject,
    userId: subject,
    ...(data.email ? { email: String(data.email) } : {}),
    ...(data.fullName ? { fullName: String(data.fullName) } : {}),
    environment: ["local", "cloudflare-access", "chatgpt-sites", "firebase", "chatgpt-oauth", "unknown"].includes(environment) ? environment : "unknown",
    ...(data.token ? { token: String(data.token) } : {}),
    ...(typeof data.expiresIn === "number" ? { expiresIn: data.expiresIn } : {}),
  };
}

function announceSession() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EVENT));
}

function authAbortError() {
  return new DOMException("The auth session request was aborted", "AbortError");
}

/**
 * A caller may stop waiting for auth, but it must not stop the shared refresh.
 * In particular, passing a caller's signal to fetch would let one cancelled
 * WebMCP/UI request poison every other consumer of the cached session.
 */
function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(authAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(authAbortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function startSessionRequest(): SessionRequest {
  const requestId = ++requestSequence;
  const epoch = sessionEpoch;
  latestRequestId = requestId;

  const promise = (async () => {
    let resolvedSession: AuthSession | null;
    let resolvedExpiresAt = 0;
    try {
      // Deliberately do not pass a caller AbortSignal here. This request is
      // shared by all consumers and must finish so it can safely update the
      // cache even when its first waiter has gone away.
      const response = await fetch(authUrl("/api/auth/session"), { credentials: "include", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Session endpoint returned HTTP ${response.status}`);
      const session = normalizeSession(payload);
      resolvedSession = session ?? localDevelopmentSession();
      resolvedExpiresAt = session?.token && session.expiresIn ? Date.now() + session.expiresIn * 1000 : 0;
    } catch {
      // The local session is a development-only convenience. Production never
      // turns a failed auth request into an authenticated browser identity.
      resolvedSession = localDevelopmentSession();
      resolvedExpiresAt = 0;
    }

    // A force refresh can overtake an older request. Only the newest response
    // in the current auth epoch may mutate the shared cache or notify hooks.
    // An epoch change (signOut) also makes an in-flight response unusable.
    if (requestId === latestRequestId && epoch === sessionEpoch) {
      cachedSession = resolvedSession;
      cachedSessionExpiresAt = resolvedExpiresAt;
      announceSession();
      return cachedSession ?? null;
    }

    if (epoch !== sessionEpoch) return cachedSession ?? null;
    // A caller waiting on an overtaken request must observe the winning
    // refresh, never an identity that was deliberately refused cache access.
    const newerRequest = sessionRequest;
    if (newerRequest && newerRequest.id > requestId) return newerRequest.promise;
    return cachedSession ?? null;
  })();

  const request: SessionRequest = { id: requestId, epoch, promise };
  sessionRequest = request;
  // Keep cleanup tied to this request, not whichever newer force refresh is
  // currently in the shared slot. The rejection handler also prevents an
  // unhandled cleanup promise if a future implementation lets this reject.
  void promise.then(
    () => {
      if (sessionRequest?.id === requestId) sessionRequest = null;
    },
    () => {
      if (sessionRequest?.id === requestId) sessionRequest = null;
    },
  );
  return request;
}

export async function getAuthSession(force = false, signal?: AbortSignal): Promise<AuthSession | null> {
  if (signal?.aborted) throw authAbortError();
  const sessionFresh = !cachedSession?.token || !cachedSessionExpiresAt || cachedSessionExpiresAt - Date.now() > SESSION_REFRESH_SKEW_MS;
  if (!force && cachedSession !== undefined && sessionFresh) return cachedSession;
  const request = !force && sessionRequest ? sessionRequest : startSessionRequest();
  return raceWithAbort(request.promise, signal);
}

export function initAuth() {
  if (!authReadyPromise) authReadyPromise = getAuthSession();
  return authReadyPromise;
}

/**
 * Adopt a session payload issued by the same-origin API (Firebase or ChatGPT
 * OAuth code exchange). The payload is normalized through the same decoder as
 * every other session source, in-flight shared refreshes are invalidated so a
 * stale response cannot overwrite the fresh sign-in, and listeners rehydrate.
 */
export function adoptSession(value: unknown): AuthSession | null {
  const session = normalizeSession(value);
  if (!session) return null;
  latestRequestId = ++requestSequence;
  cachedSession = session;
  cachedSessionExpiresAt = session.token && session.expiresIn ? Date.now() + session.expiresIn * 1000 : 0;
  announceSession();
  return session;
}

/** Shared startup gate for auth-aware hydration and native tool registration. */
export function waitForAuth(): Promise<AuthSession | null> {
  return initAuth();
}

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(() => cachedSession ?? localDevelopmentSession());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const sync = () => {
      if (active) setSession(cachedSession ?? localDevelopmentSession());
    };
    void getAuthSession().then((value) => {
      if (!active) return;
      setSession(value);
      setLoading(false);
    });
    window.addEventListener(SESSION_EVENT, sync);
    return () => {
      active = false;
      window.removeEventListener(SESSION_EVENT, sync);
    };
  }, []);

  return { session, loading, isAuthenticated: Boolean(session) };
}

export async function getAuthHeaders(force = false, signal?: AbortSignal): Promise<Record<string, string>> {
  const session = await getAuthSession(force, signal);
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

export function getCurrentUserId(): string | null {
  return cachedSession?.subject ?? localDevelopmentSession()?.subject ?? null;
}

export function getAuthMode(): AuthEnvironment {
  const configured = String(import.meta.env.VITE_AUTH_MODE ?? "").trim().toLowerCase();
  if (configured === "chatgpt-sites") return "chatgpt-sites";
  if (configured === "cloudflare-access") return "cloudflare-access";
  if (configured === "firebase") return "firebase";
  if (configured === "chatgpt-oauth") return "chatgpt-oauth";
  if (cachedSession?.environment) return cachedSession.environment;
  if (typeof window !== "undefined" && (/\.chatgpt\.site$/i.test(window.location.hostname) || /\.chatgpt\.com$/i.test(window.location.hostname) || /\.openai\.com$/i.test(window.location.hostname))) return "chatgpt-sites";
  if (!isLocalHost()) return "cloudflare-access";
  return "unknown";
}

export function authLoginUrl(returnTo = "/studio") {
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/studio";
  if (getAuthMode() === "chatgpt-sites") return `/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturn)}`;
  if (getAuthMode() === "cloudflare-access") return `/cdn-cgi/access/login?redirect_url=${encodeURIComponent(safeReturn)}`;
  return safeReturn;
}

export function authLogoutUrl(returnTo = "/") {
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  if (getAuthMode() === "chatgpt-sites") return `/signout-with-chatgpt?return_to=${encodeURIComponent(safeReturn)}`;
  if (getAuthMode() === "cloudflare-access") return `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(safeReturn)}`;
  return safeReturn;
}

export function signOut() {
  // Invalidate any shared request that is still in flight. Its eventual
  // response may finish for its original caller, but cannot restore auth into
  // the cache after the user has explicitly signed out.
  sessionEpoch += 1;
  latestRequestId = ++requestSequence;
  cachedSession = null;
  sessionRequest = null;
  authReadyPromise = null;
  cachedSessionExpiresAt = 0;
  announceSession();
  if (typeof window !== "undefined") window.location.assign(authLogoutUrl());
}
