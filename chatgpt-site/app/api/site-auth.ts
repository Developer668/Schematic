import type { AuthEnv } from "@schematic/session";

function localEnv(name: string) {
  // `process` is available in Vinext's Node preview but not in the deployed
  // Worker. Keep the local fallback without making the Site runtime depend on
  // a Node global.
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

/**
 * Resolve the one ChatGPT Site auth boundary for server routes.
 *
 * The deployed Worker exposes bindings through `cloudflare:workers`; the
 * fallback exists only for the local Vinext server. Browser code receives the
 * resulting short-lived application session from /api/auth/session, so no
 * second user-facing login is introduced.
 */
export async function siteAuthEnv(): Promise<AuthEnv> {
  try {
    const workers = await import("cloudflare:workers");
    const workerEnv = workers.env as unknown as AuthEnv;
    // Vinext's local Worker shim resolves `cloudflare:workers` too, but its
    // env object is empty. Merge process.env so the production server can run
    // the same authenticated route smoke tests without Docker or a second
    // auth service.
    return {
      SCHEMATIC_AUTH_MODE: workerEnv.SCHEMATIC_AUTH_MODE ?? localEnv("SCHEMATIC_AUTH_MODE") ?? "chatgpt-sites",
      SCHEMATIC_TRUST_PLATFORM_HEADERS: workerEnv.SCHEMATIC_TRUST_PLATFORM_HEADERS ?? localEnv("SCHEMATIC_TRUST_PLATFORM_HEADERS") ?? "true",
      SCHEMATIC_PLATFORM_INGRESS_SECRET: workerEnv.SCHEMATIC_PLATFORM_INGRESS_SECRET ?? localEnv("SCHEMATIC_PLATFORM_INGRESS_SECRET"),
      SCHEMATIC_SESSION_SECRET: workerEnv.SCHEMATIC_SESSION_SECRET ?? localEnv("SCHEMATIC_SESSION_SECRET"),
      SCHEMATIC_SESSION_TTL_SECONDS: workerEnv.SCHEMATIC_SESSION_TTL_SECONDS ?? localEnv("SCHEMATIC_SESSION_TTL_SECONDS"),
    };
  } catch {
    return {
      SCHEMATIC_AUTH_MODE: "chatgpt-sites",
      SCHEMATIC_TRUST_PLATFORM_HEADERS: localEnv("SCHEMATIC_TRUST_PLATFORM_HEADERS") ?? "true",
      SCHEMATIC_SESSION_SECRET: localEnv("SCHEMATIC_SESSION_SECRET"),
      SCHEMATIC_SESSION_TTL_SECONDS: localEnv("SCHEMATIC_SESSION_TTL_SECONDS"),
    };
  }
}
