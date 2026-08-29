import { describe, expect, it } from "vitest";
import { issueSessionToken, verifySessionToken, type AuthEnv } from "../../../functions/_auth.ts";

const identity = { subject: "auth-test-user", environment: "chatgpt-sites" as const };

describe("hosted session secret policy", () => {
  it("fails closed for a short production secret", async () => {
    const env: AuthEnv = {
      SCHEMATIC_AUTH_MODE: "chatgpt-sites",
      SCHEMATIC_DEPLOYMENT_ENV: "production",
      SCHEMATIC_SESSION_SECRET: "too-short",
    };

    expect(await issueSessionToken(identity, env)).toBeNull();
  });

  it("issues and verifies tokens with a strong production secret", async () => {
    const env: AuthEnv = {
      SCHEMATIC_AUTH_MODE: "chatgpt-sites",
      SCHEMATIC_DEPLOYMENT_ENV: "production",
      SCHEMATIC_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    };

    const token = await issueSessionToken(identity, env);
    expect(token).toEqual(expect.any(String));
    const verified = await verifySessionToken(token, env);
    expect(verified?.subject).toBe("auth-test-user");
  });
});
