import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareStarterPlan, STARTER_PLAN_ID } from "../behavior/starterPlan.ts";
import { useBehaviorPreviewStore } from "../behavior/useBehaviorPreviewStore.ts";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";

function graph(): HardwareGraph {
  const timestamp = new Date(0).toISOString();
  return {
    id: "starter-plan-project",
    name: "Starter plan project",
    components: [{ id: "led-1", definitionId: "led", position: { x: 0, y: 0 }, rotation: 0, properties: {} }],
    connections: [],
    firmwareTargets: [],
    behaviorPlans: [],
    codeDocuments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  };
}

beforeEach(() => {
  const project = graph();
  useProjectStore.setState({ project, projects: [project], activeProjectId: project.id });
  void useBehaviorPreviewStore.getState().resetPreview();
});

afterEach(() => {
  void useBehaviorPreviewStore.getState().resetPreview();
});

describe("starter Behavior Plan preparation", () => {
  it("saves a ready starter plan without starting Outcome preview", async () => {
    const readiness = await prepareStarterPlan();

    expect(readiness).toMatchObject({
      ready: true,
      status: "ready",
      planId: STARTER_PLAN_ID,
      previewStarted: false,
    });
    expect(readiness.revision).toBe(1);
    expect(useProjectStore.getState().getBehaviorPlan(STARTER_PLAN_ID)?.rules).toHaveLength(1);
    expect(useBehaviorPreviewStore.getState().snapshot).toBeNull();
    expect(useBehaviorPreviewStore.getState().status).toBe("idle");
  });
});
