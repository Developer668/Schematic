import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PROJECTS_PER_WORKSPACE,
  MAX_WORKSPACE_SERIALIZED_BYTES,
  WorkspaceCapacityError,
  getWorkspaceRecoveryError,
  normalizeStoredWorkspace,
  reloadForCurrentUser,
  useProjectStore,
  type HardwareGraph,
} from "../store/useProjectStore.ts";
import { invokeWebMCPTool, unregisterWebMCPTools } from "../webmcp/tools.ts";

function resetWorkspace() {
  let state = useProjectStore.getState();
  for (const project of state.projects.slice(1)) state.deleteProject(project.id);
  state = useProjectStore.getState();
  state.switchProject(state.projects[0]?.id ?? state.activeProjectId);
  state.clear();
}

function emptyProject(name: string, id: string): HardwareGraph {
  return {
    id,
    name,
    components: [],
    connections: [],
    firmwareTargets: [],
    version: 1 as const,
  };
}

describe("workspace capacity boundaries", () => {
  beforeEach(() => {
    resetWorkspace();
  });

  afterEach(() => {
    unregisterWebMCPTools();
    resetWorkspace();
  });

  it("keeps a direct create atomic at the project-count limit", () => {
    const store = useProjectStore.getState();
    while (useProjectStore.getState().projects.length < MAX_PROJECTS_PER_WORKSPACE) store.createProject();
    const before = useProjectStore.getState();

    expect(() => useProjectStore.getState().createProject("one too many")).toThrow(WorkspaceCapacityError);
    expect(useProjectStore.getState().projects).toHaveLength(MAX_PROJECTS_PER_WORKSPACE);
    expect(useProjectStore.getState().activeProjectId).toBe(before.activeProjectId);
    expect(useProjectStore.getState().project).toEqual(before.project);
  });

  it("rejects an oversized hydration payload before exposing it", () => {
    const projects = Array.from({ length: MAX_PROJECTS_PER_WORKSPACE }, (_, index) => emptyProject(`project-${index}`, `project-${index}`));
    projects[0].description = "x".repeat(MAX_WORKSPACE_SERIALIZED_BYTES);

    expect(() => normalizeStoredWorkspace(projects, projects[0].id)).toThrow(WorkspaceCapacityError);
  });

  it("hydrates an older oversized room intact and exits recovery through confirmed project pruning", () => {
    const projects = Array.from({ length: MAX_PROJECTS_PER_WORKSPACE + 1 }, (_, index) => emptyProject(`recovery-${index}`, `recovery-${index}`));
    localStorage.setItem("schematic-projects:local-development", JSON.stringify({ version: 1, activeProjectId: projects[0].id, projects }));

    reloadForCurrentUser();
    expect(useProjectStore.getState().projects).toHaveLength(MAX_PROJECTS_PER_WORKSPACE + 1);
    expect(getWorkspaceRecoveryError()).toContain("Workspace recovery required");
    const finalProject = projects[projects.length - 1];
    expect(finalProject).toBeTruthy();
    if (!finalProject) return;
    expect(useProjectStore.getState().switchProject(finalProject.id)).toBe(true);
    expect(useProjectStore.getState().project.id).toBe(finalProject.id);

    expect(useProjectStore.getState().deleteProject(finalProject.id)).toBe(true);
    expect(useProjectStore.getState().projects).toHaveLength(MAX_PROJECTS_PER_WORKSPACE);
    expect(getWorkspaceRecoveryError()).toBeNull();
  });

  it("returns structured capacity errors for project WebMCP mutations", async () => {
    while (useProjectStore.getState().projects.length < MAX_PROJECTS_PER_WORKSPACE) useProjectStore.getState().createProject();
    const before = useProjectStore.getState();

    const createResult = await invokeWebMCPTool("project.create", { name: "blocked" });
    expect(createResult.isError).toBe(true);
    expect(createResult.data).toMatchObject({ code: "WORKSPACE_CAPACITY", unchanged: true, maxProjects: MAX_PROJECTS_PER_WORKSPACE });

    const duplicateResult = await invokeWebMCPTool("project.duplicate", { projectId: before.activeProjectId });
    expect(duplicateResult.isError).toBe(true);
    expect(duplicateResult.data).toMatchObject({ code: "WORKSPACE_CAPACITY", unchanged: true });

    const blueprintResult = await invokeWebMCPTool("project.apply_blueprint", { blueprintId: "meta-glasses" });
    expect(blueprintResult.isError).toBe(true);
    expect(blueprintResult.data).toMatchObject({ code: "WORKSPACE_CAPACITY", unchanged: true });
    expect(useProjectStore.getState().projects).toHaveLength(MAX_PROJECTS_PER_WORKSPACE);
    expect(useProjectStore.getState().activeProjectId).toBe(before.activeProjectId);
  });
});
