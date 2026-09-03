import { issueSessionToken, responseForSession, verifyOidcIdToken, type AuthEnv } from "../../_auth";
import { corsHeaders } from "../_runtime";

type Context = { request: Request; env: AuthEnv };

function oauthEnv(env: AuthEnv) {
  return {
    tokenUrl: String(env.CHATGPT_OAUTH_TOKEN_URL ?? "").trim(),
    clientId: String(env.CHATGPT_OAUTH_CLIENT_ID ?? "").trim(),
    clientSecret: String(env.CHATGPT_OAUTH_CLIENT_SECRET ?? ""),
    redirectUri: String(env.CHATGPT_OAUTH_REDIRECT_URI ?? "").trim(),
    jwksUrl: String(env.CHATGPT_OAUTH_JWKS_URL ?? "").trim(),
    issuer: String(env.CHATGPT_OAUTH_ISSUER ?? "").trim(),
    audience: String(env.CHATGPT_OAUTH_AUDIENCE ?? "").trim() || String(env.CHATGPT_OAUTH_CLIENT_ID ?? "").trim(),
  };
}

/**
 * Server-side ChatGPT OAuth code exchange for Cloudflare Pages.
 *
 * The browser only ever sees the one-time code; the client secret stays in
 * the Function environment and the returned id_token is verified against the
 * provider JWKS before a short-lived Schematic session is issued. Every
 * missing-config or verification failure is fail-closed: no session is issued.
 */
export const onRequestPost = async ({ request, env }: Context) => {
  let body: Record<string, unknown> | null = null;
  try {
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).byteLength > 8 * 1024) {
      return Response.json({ authenticated: false, error: "Invalid sign-in request." }, { status: 400, headers: corsHeaders(request) });
    }
    const parsed = JSON.parse(text) as unknown;
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return Response.json({ authenticated: false, error: "Invalid sign-in request." }, { status: 400, headers: corsHeaders(request) });
  }
  const code = typeof body?.code === "string" ? body.code : "";
  const redirectUri = typeof body?.redirectUri === "string" ? body.redirectUri : "";
  if (!code || !redirectUri) {
    return Response.json({ authenticated: false, error: "An authorization code and redirect URI are required." }, { status: 400, headers: corsHeaders(request) });
  }

  const oauth = oauthEnv(env);
  if (!oauth.tokenUrl || !oauth.clientId || !oauth.clientSecret || !oauth.redirectUri || !oauth.jwksUrl || !oauth.issuer || !oauth.audience) {
    return Response.json({ authenticated: false, error: "ChatGPT sign-in is not configured on this deployment." }, { status: 503, headers: corsHeaders(request) });
  }
  if (redirectUri !== oauth.redirectUri) {
    return Response.json({ authenticated: false, error: "The redirect URI does not match the deployed configuration." }, { status: 400, headers: corsHeaders(request) });
  }

  let tokens: { id_token?: unknown };
  try {
    const exchange = await fetch(oauth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: oauth.redirectUri, client_id: oauth.clientId, client_secret: oauth.clientSecret }),
    });
    if (!exchange.ok) {
      return Response.json({ authenticated: false, error: "The sign-in provider rejected the authorization code." }, { status: 401, headers: corsHeaders(request) });
    }
    tokens = (await exchange.json()) as { id_token?: unknown };
  } catch {
    return Response.json({ authenticated: false, error: "The sign-in provider could not be reached." }, { status: 502, headers: corsHeaders(request) });
  }
  if (typeof tokens.id_token !== "string" || !tokens.id_token) {
    return Response.json({ authenticated: false, error: "The sign-in provider did not return an identity token." }, { status: 502, headers: corsHeaders(request) });
  }
  const verified = await verifyOidcIdToken(tokens.id_token, { jwksUrl: oauth.jwksUrl, issuer: oauth.issuer, audience: oauth.audience });
  if (!verified) {
    return Response.json({ authenticated: false, error: "The ChatGPT sign-in could not be verified." }, { status: 401, headers: corsHeaders(request) });
  }
  const identity = { subject: `chatgpt:${verified.subject}`.slice(0, 200), ...(verified.email ? { email: verified.email } : {}), ...(verified.fullName ? { fullName: verified.fullName } : {}), environment: "chatgpt-oauth" as const };
  const token = await issueSessionToken(identity, env);
  return Response.json(responseForSession(identity, token, env), { headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
};

export const onRequestOptions = ({ request }: Context) => new Response(null, { status: 204, headers: corsHeaders(request) });
