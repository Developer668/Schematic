import { issueSessionToken, responseForSession, verifySessionToken, type SessionIdentity } from "@schematic/session";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { siteAuthEnv } from "../../site-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authEnv = await siteAuthEnv();
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const [scheme, token] = authorization.split(" ", 2);
    const identity = scheme?.toLowerCase() === "bearer" ? await verifySessionToken(token ?? null, authEnv) : null;
    if (!identity) return Response.json({ authenticated: false, error: "Invalid or expired Schematic session" }, { status: 401 });
    return Response.json(responseForSession(identity, token ?? null, authEnv), { headers: { "Cache-Control": "no-store" } });
  }

  const user = await getChatGPTUser();
  const identity: SessionIdentity | null = user
    ? { subject: user.userId, email: user.email, fullName: user.fullName ?? user.displayName, environment: "chatgpt-sites" }
    : null;
  const token = identity ? await issueSessionToken(identity, authEnv) : null;
  return Response.json(responseForSession(identity, token, { ...authEnv, SCHEMATIC_AUTH_MODE: "chatgpt-sites" }), { headers: { "Cache-Control": "no-store" } });
}
