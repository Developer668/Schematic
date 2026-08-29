import { describe, expect, it, vi } from "vitest";
import { ProjectRepository } from "@schematic/project-storage";

const authGate = vi.hoisted(() => {
  let resolveGate: (value: null) => void = () => undefined;
  const promise = new Promise<null>((resolve) => { resolveGate = resolve; });
  return {
    initAuth: vi.fn(() => promise),
    getCurrentUserId: vi.fn(() => null),
    resolve: (value: null) => resolveGate(value),
  };
});

vi.mock("../auth/session.ts", () => ({
  initAuth: authGate.initAuth,
  getCurrentUserId: authGate.getCurrentUserId,
}));

import { getProjectPersistenceStatus, startProjectPersistence } from "../store/projectPersistence.ts";

describe("project persistence lifecycle", () => {
  it("does not start hydration after its mount is disposed while auth is pending", async () => {
    const loadWorkspace = vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockResolvedValue({ ok: true, value: null } as never);
    const stop = startProjectPersistence();
    expect(authGate.initAuth).toHaveBeenCalledTimes(1);

    stop();
    authGate.resolve(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(getProjectPersistenceStatus().hydrated).toBe(false);
    vi.restoreAllMocks();
  });
});
