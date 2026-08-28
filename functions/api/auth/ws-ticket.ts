import { issueSessionToken, platformIdentity, verifySessionToken, type AuthEnv } from "../../_auth";
import { corsHeaders } from "../_runtime";

type Context = { request: Request; env: AuthEnv };

function bearer(request: Request) {
  const [scheme, token] = (request.headers.get("authorization") ?? "").split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export const onRequestOptions = ({ request }: Context) => new Response(null, { status: 204, headers: corsHeaders(request) });

export const onRequestPost = async ({ request, env }: Context) => {
  const token = bearer(request);
  const identity = token ? await verifySessionToken(token, env) : await platformIdentity(request, env);
  if (!identity) return Response.json({ error: "Sign in to use this Schematic workspace" }, { status: 401, headers: corsHeaders(request) });
  const ticket = await issueSessionToken(identity, env, { audience: "schematic-ws", ttlSeconds: 60 });
  if (!ticket) return Response.json({ error: "The hosted session boundary is not configured" }, { status: 503, headers: corsHeaders(request) });
  return Response.json({ ticket, expiresIn: 60 }, { headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
};
