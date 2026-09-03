import { identityFromFirebaseIdToken, issueSessionToken, platformIdentity, responseForSession, verifySessionToken, type AuthEnv } from "../../_auth";
import { corsHeaders } from "../_runtime";

type Context = { request: Request; env: AuthEnv };

export const onRequestGet = async ({ request, env }: Context) => {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const [scheme, token] = authorization.split(" ", 2);
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return Response.json({ authenticated: false, error: "Invalid or expired Schematic session" }, { status: 401, headers: corsHeaders(request) });
    }
    const identity = await verifySessionToken(token, env);
    if (!identity) return Response.json({ authenticated: false, error: "Invalid or expired Schematic session" }, { status: 401, headers: corsHeaders(request) });
    return Response.json(responseForSession(identity, token, env), { headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
  }

  const identity = await platformIdentity(request, env);
  const token = identity ? await issueSessionToken(identity, env) : null;
  return Response.json(responseForSession(identity, token, env), { headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
};

async function readJsonBody(request: Request, limitBytes = 8 * 1024) {
  try {
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).byteLength > limitBytes) return null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const onRequestPost = async ({ request, env }: Context) => {
  const body = await readJsonBody(request);
  const firebaseIdToken = typeof body?.firebaseIdToken === "string" ? body.firebaseIdToken : "";
  if (!firebaseIdToken) {
    return Response.json({ authenticated: false, error: "A Firebase ID token is required." }, { status: 400, headers: corsHeaders(request) });
  }
  if (!String(env.FIREBASE_PROJECT_ID ?? "").trim()) {
    return Response.json({ authenticated: false, error: "Firebase sign-in is not configured on this deployment." }, { status: 503, headers: corsHeaders(request) });
  }
  const identity = await identityFromFirebaseIdToken(firebaseIdToken, env);
  if (!identity) {
    return Response.json({ authenticated: false, error: "The Firebase sign-in could not be verified." }, { status: 401, headers: corsHeaders(request) });
  }
  const token = await issueSessionToken(identity, env);
  return Response.json(responseForSession(identity, token, env), { headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
};

export const onRequestOptions = ({ request }: Context) => new Response(null, { status: 204, headers: corsHeaders(request) });
