import { useEffect, useState } from "react";

export type AuthEnvironment = "local" | "cloudflare-access" | "chatgpt-sites" | "unknown";

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
let sessionRequest: Promise<AuthSession | null> | null = null;
let cachedSessionExpiresAt = 0;
const SESSION_REFRESH_SKEW_MS = 30_000;

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
    environment: ["local", "cloudflare-access", "chatgpt-sites", "unknown"].includes(environment) ? environment : "unknown",
    ...(data.token ? { token: String(data.token) } : {}),
    ...(typeof data.expiresIn === "number" ? { expiresIn: data.expiresIn } : {}),
  };
}

function announceSession() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EVENT));
}

export async function getAuthSession(force = false): Promise<AuthSession | null> {
  const sessionFresh = !cachedSession?.token || !cachedSessionExpiresAt || cachedSessionExpiresAt - Date.now() > SESSION_REFRESH_SKEW_MS;
  if (!force && cachedSession !== undefined && sessionFresh) return cachedSession;
  if (!force && sessionRequest) return sessionRequest;

  sessionRequest = (async () => {
    try {
      const response = await fetch(authUrl("/api/auth/session"), { credentials: "include", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Session endpoint returned HTTP ${response.status}`);
      const session = normalizeSession(payload);
      cachedSession = session ?? localDevelopmentSession();
      cachedSessionExpiresAt = session?.token && session.expiresIn ? Date.now() + session.expiresIn * 1000 : 0;
    } catch {
      // The local session is a development-only convenience. Production never
      // turns a failed auth request into an authenticated browser identity.
      cachedSession = localDevelopmentSession();
      cachedSessionExpiresAt = 0;
    }
    announceSession();
    return cachedSession ?? null;
  })();

  try {
    return await sessionRequest;
  } finally {
    sessionRequest = null;
  }
}

export function initAuth() {
  void getAuthSession();
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

export async function getAuthHeaders(force = false): Promise<Record<string, string>> {
  const session = await getAuthSession(force);
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

export function getCurrentUserId(): string | null {
  return cachedSession?.subject ?? localDevelopmentSession()?.subject ?? null;
}

export function getAuthMode(): AuthEnvironment {
  const configured = String(import.meta.env.VITE_AUTH_MODE ?? "").trim().toLowerCase();
  if (configured === "chatgpt-sites") return "chatgpt-sites";
  if (configured === "cloudflare-access") return "cloudflare-access";
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
  cachedSession = null;
  sessionRequest = null;
  cachedSessionExpiresAt = 0;
  announceSession();
  if (typeof window !== "undefined") window.location.assign(authLogoutUrl());
}
