import { issueSessionToken, platformIdentity, responseForSession, verifySessionToken, type AuthEnv } from "../../_auth";
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

export const onRequestOptions = ({ request }: Context) => new Response(null, { status: 204, headers: corsHeaders(request) });
