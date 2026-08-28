import { issueSessionToken, responseForSession, verifySessionToken, type AuthEnv, type SessionIdentity } from "@schematic/session";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

async function siteAuthEnv(): Promise<AuthEnv> {
  // Vinext exposes Cloudflare bindings through this module in the deployed
  // Worker. The Node production server used for local smoke tests does not,
  // so keep a process.env fallback without adding a second auth mechanism.
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as AuthEnv;
  } catch {
    return {
      SCHEMATIC_AUTH_MODE: "chatgpt-sites",
      SCHEMATIC_SESSION_SECRET: process.env.SCHEMATIC_SESSION_SECRET,
      SCHEMATIC_SESSION_TTL_SECONDS: process.env.SCHEMATIC_SESSION_TTL_SECONDS,
    };
  }
}

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
