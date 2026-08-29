import { describe, expect, it } from "vitest";
import { issueSessionToken, type AuthEnv } from "../../../functions/_auth.ts";
import { runSimulation } from "../../../functions/api/_runtime.ts";

const env: AuthEnv = {
  SCHEMATIC_AUTH_MODE: "chatgpt-sites",
  SCHEMATIC_DEPLOYMENT_ENV: "production",
  SCHEMATIC_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

const project = {
  id: "api-runtime-test",
  name: "API runtime test",
  components: [],
  connections: [],
  firmwareTargets: [],
};

function simulationRequest(token: string, sessionId: string) {
  return new Request("https://schematic.example/api/simulation/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ project, session_id: sessionId }),
  });
}

describe("hosted simulation API isolation", () => {
  it("rejects another user's attempt to reuse a simulation session", async () => {
    const ownerToken = await issueSessionToken({ subject: "simulation-owner", environment: "chatgpt-sites" }, env);
    const otherToken = await issueSessionToken({ subject: "simulation-other", environment: "chatgpt-sites" }, env);
    expect(ownerToken).toEqual(expect.any(String));
    expect(otherToken).toEqual(expect.any(String));

    const sessionId = `collision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const first = await runSimulation(simulationRequest(ownerToken!, sessionId), env);
    expect(first.status).toBe(200);

    const collision = await runSimulation(simulationRequest(otherToken!, sessionId), env);
    expect(collision.status).toBe(403);
    await expect(collision.json()).resolves.toMatchObject({ error: expect.stringContaining("owned by another room") });
  });
});
