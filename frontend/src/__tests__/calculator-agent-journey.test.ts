import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => {
  const state: { session: any } = { session: null };
  return {
    state,
    getAuthSession: vi.fn(async () => state.session),
  };
});

vi.mock("../auth/session.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/session.ts")>();
  return { ...actual, getAuthSession: auth.getAuthSession, waitForAuth: auth.getAuthSession };
});

import { invokeWebMCPTool, WEBMCP_TOOL_COUNT } from "../webmcp/tools.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useBehaviorPreviewStore } from "../behavior/useBehaviorPreviewStore.ts";

function signedIn() {
  return { authenticated: true, subject: "calculator-journey", userId: "calculator-journey", environment: "chatgpt-sites" };
}

beforeEach(() => {
  auth.state.session = signedIn();
  useProjectStore.getState().clear();
  useBehaviorPreviewStore.getState().resetPreview();
});

afterEach(() => {
  useBehaviorPreviewStore.getState().resetPreview();
  auth.state.session = null;
  localStorage.clear();
});

describe("reviewed calculator agent journey", () => {
  it("proposes, previews, applies, calculates 7 + 5 = 12, repairs by undo, and exposes a compact state-aware surface", async () => {
    expect(useProjectStore.getState().project.components).toHaveLength(0);

    const proposed: any = await invokeWebMCPTool("design.propose", { goal: "Build a basic calculator" });
    expect(proposed.isError).not.toBe(true);
    expect(proposed.data).toMatchObject({ kind: "calculator", approvalRequired: true, nextTool: "design.preview" });
    expect(useProjectStore.getState().project.components).toHaveLength(0);

    const previewed: any = await invokeWebMCPTool("design.preview", { proposalId: proposed.data.proposalId });
    expect(previewed.isError).not.toBe(true);
    expect(previewed.data.mutatesProject).toBe(false);
    expect(previewed.data.validation.valid).toBe(true);
    expect(previewed.data.components).toHaveLength(3);
    expect(previewed.data.wiring).toHaveLength(12);
    expect(useProjectStore.getState().project.components).toHaveLength(0);

    const applied: any = await invokeWebMCPTool("design.apply", {
      proposalId: proposed.data.proposalId,
      confirmProposalId: proposed.data.proposalId,
    });
    expect(applied.isError).not.toBe(true);
    expect(applied.data.validation.valid).toBe(true);
    expect(applied.data.connectionIds).toHaveLength(12);
    expect(applied.data.behaviorPlanId).toBe("calculator-interaction-v1");
    expect(applied.data.buildArtifacts).toMatchObject({ boardCount: 1, sourceCreated: 1, sourceChecked: 1, starterSourceCount: 1 });
    expect(useProjectStore.getState().project.components.map((component) => component.definitionId).sort()).toEqual(["arduino-uno", "lcd1602-i2c", "membrane-keypad"].sort());
    expect(useProjectStore.getState().project.connections).toHaveLength(12);

    const started: any = await invokeWebMCPTool("behavior.preview", { planId: "calculator-interaction-v1", durationMs: 1_000 });
    expect(started.isError).not.toBe(true);
    const keypadId = applied.data.instances.keypad;
    const displayId = applied.data.instances.display;

    for (const key of ["7", "+", "5", "="]) {
      const pressed: any = await invokeWebMCPTool("behavior.press_key", { componentId: keypadId, key });
      expect(pressed.isError).not.toBe(true);
      expect(pressed.data.status).toBe("accepted");
    }

    const behavior: any = await invokeWebMCPTool("behavior.get_state", { detail: "full" });
    expect(behavior.isError).not.toBe(true);
    expect(behavior.data.snapshot.components[displayId].primitives[0]).toMatchObject({ kind: "text-display", lines: ["12"] });
    expect(behavior.data.snapshot.components[keypadId].primitives[0]).toMatchObject({ kind: "keypad", lastKey: "=" });
    expect(behavior.data.snapshot.events.filter((event: any) => event.eventId === "keypad.keyPressed" && event.outcome === "accepted")).toHaveLength(4);
    expect(behavior.data.snapshot.events.filter((event: any) => event.eventId === "keypad.displayChanged" && event.outcome === "accepted")).toHaveLength(4);

    const compact: any = await invokeWebMCPTool("workspace.get_state");
    expect(compact.isError).not.toBe(true);
    expect(compact.content[0].text.length).toBeLessThan(1_500);
    expect(compact.data.project).toMatchObject({ componentCount: 3, connectionCount: 12 });

    const surface: any = await invokeWebMCPTool("workspace.get_tool_surface");
    expect(surface.isError).not.toBe(true);
    expect(surface.data.fullToolCount).toBe(WEBMCP_TOOL_COUNT);
    expect(surface.data.recommendedTools.length).toBeLessThan(WEBMCP_TOOL_COUNT);
    expect(surface.data.recommendedTools).toContain("behavior.press_key");

    const verify: any = await invokeWebMCPTool("design.verify", { durationMs: 100 });
    expect(verify.isError).not.toBe(true);
    expect(verify.data.calculatorInteractive).toBe(true);
    expect(verify.data.behavior).toBe("ready");
    // The generated board scaffold is intentionally not mistaken for finished
    // project firmware. Interactivity is proven by Behavior Preview separately.
    expect(verify.data.source).toBe("starter-source-present");
    expect(verify.data.claims.sourceCompiled).toBe(false);
    expect(verify.data.claims.physicalHardwareVerified).toBe(false);

    const connectionId = useProjectStore.getState().project.connections[0].id;
    const broken: any = await invokeWebMCPTool("connection.disconnect", { connectionId, confirmConnectionId: connectionId });
    expect(broken.isError).not.toBe(true);
    expect(useProjectStore.getState().project.connections).toHaveLength(11);

    const repaired: any = await invokeWebMCPTool("design.undo");
    expect(repaired.isError).not.toBe(true);
    expect(useProjectStore.getState().project.connections).toHaveLength(12);

    const rebroken: any = await invokeWebMCPTool("design.redo");
    expect(rebroken.isError).not.toBe(true);
    expect(useProjectStore.getState().project.connections).toHaveLength(11);

    const repairedAgain: any = await invokeWebMCPTool("design.undo");
    expect(repairedAgain.isError).not.toBe(true);
    expect(useProjectStore.getState().project.connections).toHaveLength(12);

    const activity: any = await invokeWebMCPTool("workspace.get_activity", { limit: 6, offset: 0 });
    expect(activity.isError).not.toBe(true);
    expect(activity.data.activities.length).toBeLessThanOrEqual(6);
  });

  it("requires approval and can discard without mutating the project", async () => {
    const proposed: any = await invokeWebMCPTool("design.propose", { goal: "Make something that can do math" });
    expect(proposed.isError).not.toBe(true);

    const denied: any = await invokeWebMCPTool("design.apply", { proposalId: proposed.data.proposalId, confirmProposalId: "different" });
    expect(denied.isError).toBe(true);
    expect(denied.data.code).toBe("APPROVAL_REQUIRED");
    expect(useProjectStore.getState().project.components).toHaveLength(0);

    const discarded: any = await invokeWebMCPTool("design.discard", { proposalId: proposed.data.proposalId });
    expect(discarded.isError).not.toBe(true);
    expect(discarded.data.projectUnchanged).toBe(true);
    expect(useProjectStore.getState().project.components).toHaveLength(0);
  });
});
