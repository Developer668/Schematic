import type { AuthEnv } from "@schematic/session";

function localEnv(name: string) {
  // `process` is available in Vinext's Node preview but not in the deployed
  // Worker. Keep the local fallback without making the Site runtime depend on
  // a Node global.
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

function partsProviderEnv(source: Record<string, unknown>) {
  const selected = Object.entries(source).filter(([key, value]) => key.startsWith("PARTS_") && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"));
  const tokenNames = new Set<string>();
  const endpoints = source.PARTS_PROVIDER_ENDPOINTS;
  if (typeof endpoints === "string") {
    try {
      const parsed = JSON.parse(endpoints);
      if (Array.isArray(parsed)) for (const entry of parsed) if (entry && typeof entry === "object" && typeof entry.tokenEnv === "string") tokenNames.add(entry.tokenEnv.trim());
    } catch {
      // The provider route will return its structured no-provider handoff.
    }
  }
  for (const [key, value] of Object.entries(source)) if (key.startsWith("PARTS_PROVIDER_") && key.endsWith("_TOKEN_ENV") && typeof value === "string") tokenNames.add(value.trim());
  for (const name of tokenNames) {
    const value = source[name];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") selected.push([name, value]);
  }
  return Object.fromEntries(selected);
}

function brightDataEnv(source: Record<string, unknown>) {
  // Bright Data stays server-only. Forward the bounded SERP/quota settings so
  // a hosted Site with BRIGHTDATA_API_KEY bound in its environment reaches the
  // live shopping provider. BRIGHTDATA_SERP_ENABLED=false remains an explicit
  // kill switch. Without these bindings, partsSearch uses public discovery.
  const selected = Object.entries(source).filter(([key, value]) =>
    key.startsWith("BRIGHTDATA_") && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"));
  return Object.fromEntries(selected);
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
      // Local process values are a development fallback only. Deployed Worker
      // bindings must win when both exist, otherwise a stale/blank build-time
      // value can shadow the secret configured in the ChatGPT Site environment.
      ...partsProviderEnv(typeof process !== "undefined" ? process.env as Record<string, unknown> : {}),
      ...partsProviderEnv(workerEnv as unknown as Record<string, unknown>),
      ...brightDataEnv(typeof process !== "undefined" ? process.env as Record<string, unknown> : {}),
      ...brightDataEnv(workerEnv as unknown as Record<string, unknown>),
    } as Awaited<ReturnType<typeof siteAuthEnv>>;
  } catch {
    return {
      SCHEMATIC_AUTH_MODE: "chatgpt-sites",
      SCHEMATIC_TRUST_PLATFORM_HEADERS: localEnv("SCHEMATIC_TRUST_PLATFORM_HEADERS") ?? "true",
      SCHEMATIC_SESSION_SECRET: localEnv("SCHEMATIC_SESSION_SECRET"),
      SCHEMATIC_SESSION_TTL_SECONDS: localEnv("SCHEMATIC_SESSION_TTL_SECONDS"),
      ...partsProviderEnv(typeof process !== "undefined" ? process.env as Record<string, unknown> : {}),
      ...brightDataEnv(typeof process !== "undefined" ? process.env as Record<string, unknown> : {}),
    } as Awaited<ReturnType<typeof siteAuthEnv>>;
  }
}
