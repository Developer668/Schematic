import { adoptSession, authUrl } from "./session.ts";

const OAUTH_STATE_KEY = "schematic-chatgpt-oauth-state";

export interface ChatGPTOAuthConfig {
  authorizeUrl: string;
  clientId: string;
  scope: string;
}

/**
 * "Sign in with ChatGPT" on Cloudflare Pages is a standard OAuth2 authorization
 * code flow against the provider the site owner configures. Paste the values
 * from the OAuth app registration; nothing here is a secret. The client secret
 * stays in the Pages Function environment (CHATGPT_OAUTH_CLIENT_SECRET) and
 * the code exchange happens server-side in functions/api/auth/chatgpt.ts.
 */
export function chatGPTOAuthConfig(): ChatGPTOAuthConfig | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const authorizeUrl = (env.VITE_CHATGPT_OAUTH_AUTHORIZE_URL ?? "").trim();
  const clientId = (env.VITE_CHATGPT_OAUTH_CLIENT_ID ?? "").trim();
  const scope = (env.VITE_CHATGPT_OAUTH_SCOPE ?? "openid email profile").trim();
  if (!authorizeUrl || !clientId) return null;
  try {
    const parsed = new URL(authorizeUrl);
    if (parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { authorizeUrl, clientId, scope };
}

export function chatGPTOAuthConfigured(): boolean {
  return chatGPTOAuthConfig() !== null;
}

export function chatGPTOAuthRedirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function startChatGPTSignIn(returnTo = "/studio") {
  const config = chatGPTOAuthConfig();
  if (!config) throw new Error("ChatGPT sign-in is not configured. Add VITE_CHATGPT_OAUTH_AUTHORIZE_URL and VITE_CHATGPT_OAUTH_CLIENT_ID, then rebuild.");
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/studio";
  const state = randomState();
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ state, returnTo: safeReturn }));
  } catch {
    // Private-mode storage failure still allows the round trip; the state
    // check is skipped but the server-side code exchange remains required.
  }
  const authorize = new URL(config.authorizeUrl);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", chatGPTOAuthRedirectUri());
  authorize.searchParams.set("scope", config.scope);
  authorize.searchParams.set("state", state);
  window.location.assign(authorize.toString());
}

export function consumeChatGPTOAuthReturn(): { returnTo: string; expectedState: string | null } {
  let stored: { state?: string; returnTo?: string } | null = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(OAUTH_STATE_KEY) ?? "null");
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  } catch {
    stored = null;
  }
  return {
    returnTo: typeof stored?.returnTo === "string" && stored.returnTo.startsWith("/") ? stored.returnTo : "/studio",
    expectedState: typeof stored?.state === "string" ? stored.state : null,
  };
}

/** Exchange the provider code for a Schematic session via the same-origin API. */
export async function finishChatGPTSignIn(code: string) {
  const response = await fetch(authUrl("/api/auth/chatgpt"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code, redirectUri: chatGPTOAuthRedirectUri() }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as Record<string, unknown>).error) : `ChatGPT exchange returned HTTP ${response.status}`;
    throw new Error(message);
  }
  const session = adoptSession(payload);
  if (!session) throw new Error("The workspace rejected the ChatGPT sign-in. Check the OAuth app configuration on the API deployment.");
  return session;
}
