import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFirmware, preflightSource } from "../application/firmwareCommands.ts";
import { writeCode } from "../application/behaviorCommands.ts";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { getAuthSession } from "../auth/session.ts";

function graph(): HardwareGraph {
  const timestamp = new Date(0).toISOString();
  return {
    id: "firmware-check-project",
    name: "firmware-check-project",
    components: [{ id: "board-1", definitionId: "arduino-uno", position: { x: 0, y: 0 }, rotation: 0, properties: {} }],
    connections: [],
    firmwareTargets: [],
    behaviorPlans: [],
    codeDocuments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  };
}

function setGraph(next = graph()) {
  useProjectStore.setState({ project: next, projects: [next], activeProjectId: next.id });
}

beforeEach(async () => {
  localStorage.clear();
  await getAuthSession();
  setGraph();
});

afterEach(() => {
  setGraph();
  localStorage.clear();
});

describe("bounded Browser Check", () => {
  it("executes supported Arduino statements without claiming compilation or physical verification", async () => {
    const source = `
      const int LED = 13;
      void setup() { pinMode(LED, OUTPUT); Serial.begin(115200); }
      void loop() { digitalWrite(LED, HIGH); Serial.println("ok"); delay(10); digitalWrite(LED, LOW); delay(10); }
    `;
    const written = await writeCode({ targetComponentId: "board-1", files: [{ name: "sketch.ino", content: source }], language: "arduino", expectedContentSha256: null, origin: "ai-generated" });
    expect(written.ok).toBe(true);

    const result = await checkFirmware({ componentId: "board-1", durationMs: 40 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(["browser-executed", "browser-executed-with-warnings"]).toContain(result.data.status);
    expect(result.data.runtime.codeExecution.status).toBe("executed");
    expect(result.data.runtime.events.length).toBeGreaterThan(0);
    expect(result.data.runtime.serialOutput).toContain("ok");
    expect(result.data.claims).toMatchObject({ sourceCodeExecutedInBrowser: true, sourceCodeCompiled: false, electricalBehaviorSimulated: false, uploadedToHardware: false, physicalHardwareVerified: false });
    expect(result.data.compilation.status).toBe("not-performed");
  });

  it("fails closed on malformed source before execution", async () => {
    const malformed = "void setup() {\nvoid loop() {}\n";
    const written = await writeCode({ targetComponentId: "board-1", files: [{ name: "sketch.ino", content: malformed }], language: "arduino", expectedContentSha256: null, origin: "ai-generated" });
    expect(written.ok).toBe(true);
    const result = await checkFirmware({ componentId: "board-1", durationMs: 20 });
    expect(result).toMatchObject({ ok: false, error: { code: "FIRMWARE_PREFLIGHT_FAILED" } });
    if (result.ok) return;
    expect(result.data?.preflight).toMatchObject({ status: "failed" });
  });

  it("rejects mismatched firmware target metadata without turning graph validation into a firmware verdict", async () => {
    const source = "void setup() {}\nvoid loop() { delay(10); }\n";
    const written = await writeCode({ targetComponentId: "board-1", files: [{ name: "sketch.ino", content: source }], language: "arduino", expectedContentSha256: null, origin: "ai-generated" });
    expect(written.ok).toBe(true);
    const current = useProjectStore.getState().project;
    const mismatched = {
      ...current,
      firmwareTargets: current.firmwareTargets.map((target) => ({ ...target, boardFqbn: "wrong:board:target" })),
    };
    useProjectStore.setState({ project: mismatched, projects: [mismatched], activeProjectId: mismatched.id });

    const result = await checkFirmware({ componentId: "board-1", durationMs: 20 });
    expect(result).toMatchObject({ ok: false, error: { code: "FIRMWARE_TARGET_BINDING_INVALID" } });
  });

  it("reports unsupported calls as partial instead of pretending they ran", async () => {
    const source = "void setup() {}\nvoid loop() { mysteryHardwareApi(42); delay(10); }\n";
    const written = await writeCode({ targetComponentId: "board-1", files: [{ name: "sketch.ino", content: source }], language: "arduino", expectedContentSha256: null, origin: "ai-generated" });
    expect(written.ok).toBe(true);
    const result = await checkFirmware({ componentId: "board-1", durationMs: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("browser-partial");
    expect(result.data.runtime.unsupportedApis).toContain("mysteryHardwareApi");
    expect(result.data.runtime.note).toContain("unsupported constructs");
    expect(result.data.claims.sourceCodeCompiled).toBe(false);
  });

  it("keeps non-Arduino languages editable while making browser execution unavailability explicit", () => {
    const report = preflightSource([{ name: "main.py", content: "print('hello')" }], "python");
    expect(report.status).toBe("passed");
    expect(report.supportedForBrowserExecution).toBe(false);
    expect(report.warnings.map((warning) => warning.code)).toContain("BROWSER_LANGUAGE_UNSUPPORTED");
  });
});
