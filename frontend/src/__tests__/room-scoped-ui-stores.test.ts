import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authHarness = vi.hoisted(() => ({ userId: "user-a" as string | null }));

vi.mock("../auth/session.ts", () => ({
  getCurrentUserId: () => authHarness.userId,
}));

class FakeBroadcastChannel {
  static instances = new Map<string, FakeBroadcastChannel>();
  readonly messages: unknown[] = [];
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.set(name, this);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== "message" || typeof listener !== "function") return;
    this.listeners.add(listener as (event: MessageEvent) => void);
  }

  emit(data: unknown) {
    for (const listener of this.listeners) listener({ data } as MessageEvent);
  }

  close() {}
}

describe("room-scoped ephemeral UI stores", () => {
  beforeEach(() => {
    vi.resetModules();
    authHarness.userId = "user-a";
    FakeBroadcastChannel.instances.clear();
    localStorage.clear();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redacts tool payloads, clears on session change, and rejects foreign activity", async () => {
    const { useWebMCPStore } = await import("../store/useWebMCPStore.ts");
    useWebMCPStore.getState().beginTool("code.write", {
      targetComponentId: "board-1",
      files: [{ name: "secret.ino", content: "private-source" }],
      plan: { rules: [{ private: "behavior-secret" }] },
    });

    const activity = useWebMCPStore.getState().activities[0];
    expect(activity.roomId).toBe("user-a");
    expect(activity.args.files).toBe("[redacted from activity log]");
    expect(activity.args.plan).toBe("[redacted from activity log]");
    expect(JSON.stringify(activity)).not.toContain("private-source");

    authHarness.userId = "user-b";
    window.dispatchEvent(new Event("schematic-session"));
    expect(useWebMCPStore.getState().activities).toEqual([]);

    const channel = FakeBroadcastChannel.instances.get("schematic-webmcp-sync");
    channel?.emit({ type: "activity:add", roomId: "user-a", activity });
    expect(useWebMCPStore.getState().activities).toEqual([]);
  });

  it("rejects foreign selection and validation messages and resets both on session change", async () => {
    const [{ useSelectionStore }, { useValidationStore }] = await Promise.all([
      import("../store/useSelectionStore.ts"),
      import("../store/useValidationStore.ts"),
    ]);

    useSelectionStore.getState().setActive("component-a");
    useValidationStore.getState().setResult({
      valid: false,
      issues: [{ code: "PRIVATE", severity: "error", message: "private detail" }],
    });

    authHarness.userId = "user-b";
    window.dispatchEvent(new Event("schematic-session"));
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    expect(useValidationStore.getState().issues).toEqual([]);

    FakeBroadcastChannel.instances.get("schematic-selection-sync")?.emit({
      type: "selection:update",
      roomId: "user-a",
      state: { selectedIds: ["colliding-id"], activeComponentId: "colliding-id" },
    });
    FakeBroadcastChannel.instances.get("schematic-validation-sync")?.emit({
      type: "validation:update",
      roomId: "user-a",
      state: { issues: [{ code: "FOREIGN", severity: "error", message: "foreign detail" }], codeIssues: [], valid: false, checkedAt: 1, compile: { status: "idle" } },
    });

    expect(useSelectionStore.getState().activeComponentId).toBeNull();
    expect(useValidationStore.getState().issues).toEqual([]);

    FakeBroadcastChannel.instances.get("schematic-validation-sync")?.emit({
      type: "validation:update",
      roomId: "user-b",
      state: {
        issues: Array.from({ length: 250 }, (_, index) => ({ id: `issue-${index}`, severity: "error", code: "BOUNDED", message: `m-${index}` })),
        codeIssues: [],
        valid: false,
        checkedAt: 1,
        compile: { status: "error", log: "x".repeat(40_000) },
      },
    });
    expect(useValidationStore.getState().issues).toHaveLength(200);
    expect(useValidationStore.getState().compile.log).toBeUndefined();
  });

  it("bounds same-room shopping state from broadcast and storage ingestion", async () => {
    const { useShoppingStore } = await import("../store/useShoppingStore.ts");
    useShoppingStore.getState().setQuery("safe query");

    const oversized = {
      query: "x".repeat(300_000),
      results: [],
      cart: [],
      budget: null,
      lastSearchAt: null,
      handoff: null,
      discovery: null,
    };
    FakeBroadcastChannel.instances.get("schematic-shopping-sync")?.emit({
      type: "shopping:update",
      state: { ...oversized, _room: "user-a" },
    });
    expect(useShoppingStore.getState().query).toBe("");
    expect(useShoppingStore.getState().results).toEqual([]);

    useShoppingStore.getState().setQuery("safe again");
    window.dispatchEvent(new StorageEvent("storage", {
      key: "schematic-shopping:user-a",
      newValue: JSON.stringify(oversized),
    }));
    expect(useShoppingStore.getState().query).toBe("");
    expect(useShoppingStore.getState().results).toEqual([]);
  });

  it("normalizes same-room workspace and selection messages before Zustand ingestion", async () => {
    const { useWorkspaceStore } = await import("../store/useWorkspaceStore.ts");
    const { useSelectionStore } = await import("../store/useSelectionStore.ts");
    useWorkspaceStore.getState().setBottomPanel("terminal");

    FakeBroadcastChannel.instances.get("schematic-workspace-sync")?.emit({
      type: "workspace:update",
      state: {
        bottomPanel: "not-a-panel",
        bottomHeight: 999_999,
        setBottomPanel: "attacker-overwrite",
        unexpected: "ignored",
      },
    });
    expect(useWorkspaceStore.getState().bottomPanel).toBe("terminal");
    expect(useWorkspaceStore.getState().bottomHeight).toBe(360);
    expect(typeof useWorkspaceStore.getState().setBottomPanel).toBe("function");

    FakeBroadcastChannel.instances.get("schematic-selection-sync")?.emit({
      type: "selection:update",
      roomId: "user-a",
      state: { selectedIds: ["ok", "x".repeat(201), ...Array.from({ length: 300 }, (_, index) => `item-${index}`)], activeComponentId: "x".repeat(201) },
    });
    expect(useSelectionStore.getState().selectedIds).not.toContain("x".repeat(201));
    expect(useSelectionStore.getState().selectedIds.length).toBeLessThanOrEqual(200);
    expect(useSelectionStore.getState().activeComponentId).toBeNull();
  });
});
