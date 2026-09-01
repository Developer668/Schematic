import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createEmptyProject, type HardwareProject } from "@schematic/hardware-graph";
import {
  BEHAVIOR_LIMITS,
  canonicalize,
  createBehaviorRegistry,
  createBehaviorPreviewSession,
  createBehaviorSystem,
  defaultBehaviorRegistry,
  digitalIndicatorProfile,
  buzzerProfile,
  catalogOnlyProfile,
  motorProfile,
  numericSensorProfile,
  relayProfile,
  registryDescriptorHash,
  rotaryActuatorProfile,
  textDisplayProfile,
  momentaryInputProfile,
  payloadSchema,
  parseBehaviorPlan,
  measureJsonValue,
  projectBehaviorFingerprint,
  validatePayload,
  sha256,
  sha256Text,
  type BehaviorPlanV1,
  type BehaviorProfile,
  type ComponentActionRequestV1,
  type ComponentEventRequest,
  type DeterministicActionContext,
  type JsonValue,
  type ResolvedComponentAction,
} from "../src";

function project(): HardwareProject {
  const result = createEmptyProject("behavior tests");
  result.id = "behavior-project";
  result.components = [
    { id: "button-1", definitionId: "button", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
    { id: "led-1", definitionId: "led", position: { x: 100, y: 0 }, rotation: 0, properties: {} },
    { id: "display-1", definitionId: "display", position: { x: 200, y: 0 }, rotation: 0, properties: {} },
    { id: "sensor-1", definitionId: "sensor", position: { x: 300, y: 0 }, rotation: 0, properties: { unit: "°C" } },
  ];
  return result;
}

const definitions = {
  button: { behaviorBinding: { profileId: "momentary-input", profileVersion: 1 } },
  led: { behaviorBinding: { profileId: "digital-indicator", profileVersion: 1 } },
  display: { behaviorBinding: { profileId: "text-display", profileVersion: 1 } },
  sensor: { behaviorBinding: { profileId: "numeric-sensor", profileVersion: 1 } },
};

const system = createBehaviorSystem({ definitions });

function action(componentId: string, definitionId: string, actionId: ComponentActionRequestV1["actionId"], value: JsonValue): ComponentActionRequestV1 {
  return { componentId, definitionId, actionId, payload: { kind: "literal", value } };
}

function buttonLedPlan(overrides: Partial<BehaviorPlanV1> = {}): BehaviorPlanV1 {
  return {
    schemaVersion: 1,
    id: "button-led",
    projectId: "behavior-project",
    name: "Button LED",
    revision: 1,
    rules: [{
      id: "press-led",
      enabled: true,
      when: { type: "component.event", componentId: "button-1", definitionId: "button", eventId: "button.pressed" },
      then: [action("led-1", "led", "indicator.set", { on: true })],
    }],
    ...overrides,
  };
}

describe("@schematic/behavior public boundary", () => {
  it("canonicalizes object order and computes stable hashes", () => {
    expect(canonicalize({ z: 1, a: { y: false, x: 2 } })).toBe(canonicalize({ a: { x: 2, y: false }, z: 1 }));
    expect(sha256({ a: 1, b: 2 })).toBe(sha256({ b: 2, a: 1 }));
    expect(() => canonicalize({ value: Number.NaN })).toThrow();
  });

  it("hashes source text with the same replacement semantics as UTF-8 exports", () => {
    const sourceWithUnpairedSurrogates = `before\ud800middle\udc00after`;
    const exportedBytes = new TextEncoder().encode(sourceWithUnpairedSurrogates);
    const exportedHash = createHash("sha256").update(exportedBytes).digest("hex");
    expect(sha256Text(sourceWithUnpairedSurrogates)).toBe(exportedHash);
    expect(sha256Text("\ud800")).toBe(sha256Text("\ufffd"));
  });

  it("fingerprints behavior semantics without coupling preview to canvas layout", () => {
    const original = project();
    const moved = structuredClone(original);
    moved.components[0].position = { x: 999, y: 321 };
    moved.components[0].rotation = 90;
    moved.components[0].label = "Moved button";
    expect(projectBehaviorFingerprint(moved)).toBe(projectBehaviorFingerprint(original));

    moved.components[0].properties = { mode: "toggle" };
    expect(projectBehaviorFingerprint(moved)).not.toBe(projectBehaviorFingerprint(original));
  });

  it("pins the checked-in default registry identity", () => {
    expect(defaultBehaviorRegistry.hash).toBe("2ce29d215f510c2ff4f2fa9aa2e411da0cb5303e04a26850d97abfee69a63c53");
  });

  it("snapshots profile behavior and metadata under the registry hash", () => {
    const mutableProfile: BehaviorProfile<{ value: number }> = {
      manifest: {
        id: "mutable-test",
        version: 1,
        implementationId: "mutable-test:v1:original",
        actions: [{
          id: "mutable.set",
          label: "Set original",
          description: "Original descriptor",
          payloadSchema: payloadSchema("mutable.set", { type: "object", additionalProperties: false }),
          control: { kind: "trigger" },
        }],
        events: [],
      },
      parseState: (value) => typeof value === "object" && value !== null && "value" in value ? { value: Number((value as { value: unknown }).value) } : { value: 0 },
      initialState: () => ({ value: 0 }),
      reduce: () => [{ state: { value: 1 } }],
      projectVisual: (state) => ({ primitives: [], accessibleSummary: `Value ${state.value}` }),
    };
    const registry = createBehaviorRegistry([mutableProfile]);
    const hash = registry.hash;
    const snapshot = registry.get("mutable-test", 1)! as BehaviorProfile<{ value: number }>;

    (mutableProfile as { reduce: BehaviorProfile<{ value: number }>["reduce"] }).reduce = () => [{ state: { value: 999 } }];
    (mutableProfile.manifest.actions[0] as { label: string }).label = "Mutated label";

    const transitions = snapshot.reduce(
      { value: 0 },
      { componentId: "mutable-1", definitionId: "mutable-test", profileId: "mutable-test", profileVersion: 1, actionId: "mutable.set", payload: {} },
      { componentId: "mutable-1", definitionId: "mutable-test", logicalTimeMs: 0, sequence: 0 },
    );
    expect(transitions[0].state).toEqual({ value: 1 });
    expect(snapshot.manifest.actions[0].label).toBe("Set original");
    expect(registry.hash).toBe(hash);
    expect(registryDescriptorHash(registry)).toBe(hash);
  });

  it("rejects a catalog binding that changes after plan preparation", async () => {
    const mutableDefinitions: Record<string, { behaviorBinding: { profileId: string; profileVersion: number } }> = structuredClone(definitions);
    const mutableSystem = createBehaviorSystem({ definitions: mutableDefinitions });
    const preparation = await mutableSystem.prepare(project(), buttonLedPlan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;

    mutableDefinitions.led.behaviorBinding = { profileId: "catalog-only", profileVersion: 1 };
    expect(() => mutableSystem.open(project(), preparation.prepared)).toThrow("STALE_DEFINITION_BINDING");
  });

  it("normalizes indicator colors to a safe fixed hex form", () => {
    expect(digitalIndicatorProfile.parseState({ on: true, color: "url(//attacker.invalid/pixel)", intensity: 1 }).color).toBe("#3b82f6");
    expect(digitalIndicatorProfile.parseState({ on: true, color: "#AABBCC", intensity: 1 }).color).toBe("#aabbcc");
  });

  it("conforms every registered profile action to its schema and pure projection boundary", () => {
    const fixtures: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {
      "momentary-input": { "button.setPressed": { pressed: true } },
      "digital-indicator": { "indicator.set": { on: true, color: "#ff0000", intensity: 0.5 }, "indicator.setBrightness": { intensity: 0.5 } },
      "text-display": { "display.showText": { text: "Hello", x: 2, y: 3 }, "display.clear": {} },
      buzzer: { "buzzer.start": { frequencyHz: 440, durationMs: 100 }, "buzzer.stop": {} },
      relay: { "relay.set": { on: true } },
      "rotary-actuator": { "servo.setAngle": { degrees: 90 } },
      motor: { "motor.setSpeed": { rpm: 500, direction: "forward" }, "motor.stop": {} },
      "numeric-sensor": { "sensor.setReading": { value: 21, unit: "°C" } },
    };
    const profiles = [catalogOnlyProfile, momentaryInputProfile, digitalIndicatorProfile, textDisplayProfile, buzzerProfile, relayProfile, rotaryActuatorProfile, motorProfile, numericSensorProfile] as readonly BehaviorProfile[];
    let actionCount = 0;
    for (const profile of profiles) {
      const instance = { id: `${profile.manifest.id}-fixture`, definitionId: profile.manifest.id, position: { x: 0, y: 0 }, rotation: 0 as const, properties: {} };
      const initial = profile.initialState(instance);
      const projection = profile.projectVisual(initial);
      expect(projection.accessibleSummary.length).toBeGreaterThan(0);
      expect(projection.accessibleSummary.length).toBeLessThanOrEqual(4096);
      expect(projection.accessibleSummary).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(Array.isArray(projection.primitives)).toBe(true);
      for (const descriptor of profile.manifest.actions) {
        actionCount += 1;
        const validPayload = fixtures[profile.manifest.id]?.[descriptor.id];
        expect(validPayload).toBeDefined();
        if (validPayload === undefined) continue;
        expect(validatePayload(descriptor.payloadSchema, validPayload).valid).toBe(true);
        const before = JSON.parse(JSON.stringify(initial));
        const action: ResolvedComponentAction = { componentId: instance.id, definitionId: instance.definitionId, profileId: profile.manifest.id, profileVersion: 1, actionId: descriptor.id as ResolvedComponentAction["actionId"], payload: validPayload };
        const context: DeterministicActionContext = { componentId: instance.id, definitionId: instance.definitionId, logicalTimeMs: 0, sequence: 0 };
        const transitions = profile.reduce(initial, action, context);
        expect(transitions.length).toBeGreaterThan(0);
        expect(initial).toEqual(before);
        expect(profile.projectVisual(profile.parseState(transitions[0].state)).accessibleSummary.length).toBeGreaterThan(0);
        const invalidPayload = descriptor.payloadSchema.schema && typeof descriptor.payloadSchema.schema === "object" && !Array.isArray(descriptor.payloadSchema.schema) && (descriptor.payloadSchema.schema as { type?: unknown }).type === "object"
          ? { unexpected: true }
          : null;
        const invalid = validatePayload(descriptor.payloadSchema, invalidPayload);
        expect(invalid.valid).toBe(false);
        expect(invalid.diagnostics.length).toBeGreaterThan(0);
      }
    }
    expect(actionCount).toBeGreaterThan(0);
    expect(actionCount).toBe(defaultBehaviorRegistry.profiles.reduce((count, profile) => count + profile.manifest.actions.length, 0));
  });

  it("rejects malformed versions, duplicate IDs, and executable plan values", () => {
    const malformed = parseBehaviorPlan({ ...buttonLedPlan(), schemaVersion: 2 });
    expect(malformed.plan).toBeUndefined();
    expect(malformed.diagnostics.map((item) => item.code)).toContain("UNSUPPORTED_PLAN_VERSION");

    const duplicate = parseBehaviorPlan({ ...buttonLedPlan(), rules: [buttonLedPlan().rules[0], buttonLedPlan().rules[0]] });
    expect(duplicate.diagnostics.map((item) => item.code)).toContain("DUPLICATE_RULE_ID");

    const executable = parseBehaviorPlan({ ...buttonLedPlan(), intent: (() => "bad") as unknown as string });
    expect(executable.diagnostics.map((item) => item.code)).toContain("PLAN_RESOURCE_LIMIT_EXCEEDED");
  });

  it("rejects deeply nested or excessively large JSON before recursive plan parsing", () => {
    let nested: Record<string, unknown> = { value: true };
    for (let index = 0; index < BEHAVIOR_LIMITS.maxJsonDepth + 2; index += 1) nested = { child: nested };
    const deep = parseBehaviorPlan({
      ...buttonLedPlan(),
      rules: [{ ...buttonLedPlan().rules[0], when: { ...buttonLedPlan().rules[0].when, payload: nested } }],
    });
    expect(deep.plan).toBeUndefined();
    expect(deep.diagnostics.map((item) => item.code)).toContain("PLAN_RESOURCE_LIMIT_EXCEEDED");

    const oversized = parseBehaviorPlan({ ...buttonLedPlan(), cues: Array.from({ length: BEHAVIOR_LIMITS.maxJsonNodes + 1 }, () => null) });
    expect(oversized.plan).toBeUndefined();
    expect(oversized.diagnostics.map((item) => item.code)).toContain("PLAN_RESOURCE_LIMIT_EXCEEDED");
  });

  it("enforces separate aggregate plan and dispatch JSON budgets", async () => {
    const largeText = "x".repeat(BEHAVIOR_LIMITS.maxJsonStringLength);
    const oversizedPlan = buttonLedPlan({
      rules: [{
        ...buttonLedPlan().rules[0],
        then: Array.from({ length: BEHAVIOR_LIMITS.maxActionsPerRule }, () => action("display-1", "display", "display.showText", { text: largeText })),
      }],
    });
    const planResult = parseBehaviorPlan(oversizedPlan);
    expect(planResult.plan).toBeUndefined();
    expect(planResult.diagnostics.map((item) => item.code)).toContain("PLAN_RESOURCE_LIMIT_EXCEEDED");

    const preparation = await system.prepare(project(), buttonLedPlan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const dispatchResult = system.open(project(), preparation.prepared).dispatch(project(), {
      componentId: "button-1",
      definitionId: "button",
      eventId: "button.pressed",
      payload: { first: largeText, second: largeText },
    });
    expect(dispatchResult.status).toBe("rejected");
    expect(dispatchResult.diagnostics.map((item) => item.code)).toContain("INVALID_DISPATCH_REQUEST");
  });

  it("rejects many large object keys before aggregate punctuation can grow unbounded", async () => {
    const manyLargeKeys = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`${"k".repeat(240)}-${index}`, true]),
    );
    const oversizedPlan = buttonLedPlan({
      rules: [{
        ...buttonLedPlan().rules[0],
        then: [action("display-1", "display", "display.showText", manyLargeKeys)],
      }],
    });
    const planResult = parseBehaviorPlan(oversizedPlan);
    expect(planResult.plan).toBeUndefined();
    expect(planResult.diagnostics.map((item) => item.code)).toContain("PLAN_RESOURCE_LIMIT_EXCEEDED");

    const preparation = await system.prepare(project(), buttonLedPlan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const dispatchResult = system.open(project(), preparation.prepared).dispatch(project(), {
      componentId: "button-1",
      definitionId: "button",
      eventId: "button.pressed",
      payload: manyLargeKeys,
    });
    expect(dispatchResult.status).toBe("rejected");
    expect(dispatchResult.diagnostics.map((item) => item.code)).toContain("INVALID_DISPATCH_REQUEST");
  });

  it("prepares an exact button-to-LED plan and applies typed actions only", async () => {
    const preparation = await system.prepare(project(), buttonLedPlan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const session = system.open(project(), preparation.prepared);
    const initial = session.snapshot();
    expect(initial.sourceCodeExecution).toBe("none");
    expect(initial.components["led-1"].primitives[0]).toMatchObject({ kind: "indicator", on: false });
    const result = session.dispatch(project(), { componentId: "button-1", definitionId: "button", eventId: "button.pressed", payload: { pressed: true } });
    expect(result.status).toBe("accepted");
    expect(result.snapshot.components["led-1"].primitives[0]).toMatchObject({ kind: "indicator", on: true });
    expect(result.snapshot.claims.sourceCodeExecuted).toBe(false);
    expect(result.snapshot.sessionLog.some((entry) => entry.kind === "component-event" && entry.outcome === "accepted")).toBe(true);
  });

  it("updates a momentary input and emits its declared pressed/released events", async () => {
    const preparation = await system.prepare(project(), buttonLedPlan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const session = system.open(project(), preparation.prepared);
    const pressed = session.dispatch(project(), action("button-1", "button", "button.setPressed", { pressed: true }));
    expect(pressed.status).toBe("accepted");
    expect(pressed.snapshot.components["button-1"].primitives[0]).toMatchObject({ kind: "button", pressed: true });
    expect(pressed.snapshot.components["led-1"].primitives[0]).toMatchObject({ kind: "indicator", on: true });
    const released = session.dispatch(project(), action("button-1", "button", "button.setPressed", { pressed: false }));
    expect(released.status).toBe("accepted");
    expect(released.snapshot.components["button-1"].primitives[0]).toMatchObject({ kind: "button", pressed: false });
    expect(released.snapshot.events.some((event) => event.eventId === "button.released" && event.outcome === "accepted")).toBe(true);
  });

  it("blocks unsupported actions by default and only skips them explicitly", async () => {
    const plan = buttonLedPlan({ rules: [{ ...buttonLedPlan().rules[0], then: [action("led-1", "led", "indicator.nope" as ComponentActionRequestV1["actionId"], { on: true })] }] });
    const blocked = await system.prepare(project(), plan);
    expect(blocked.status).toBe("blocked");
    const partial = await system.prepare(project(), plan, { onUnsupported: "skip" });
    expect(partial.status).toBe("partial");
    if (partial.status === "partial") expect(partial.prepared.normalizedRules[0].then).toHaveLength(0);
  });

  it("rejects stale definitions, invalid payload ranges, and trigger payloads outside rule context", async () => {
    const stale = await system.prepare(project(), buttonLedPlan({ rules: [{ ...buttonLedPlan().rules[0], when: { type: "component.event", componentId: "button-1", definitionId: "other-button", eventId: "button.pressed" } }] }));
    expect(stale.status).toBe("blocked");
    expect(stale.diagnostics.map((item) => item.code)).toContain("DEFINITION_MISMATCH");

    const tooLong = buttonLedPlan({ rules: [{ ...buttonLedPlan().rules[0], then: [action("display-1", "display", "display.showText", { text: "x".repeat(BEHAVIOR_LIMITS.maxDisplayTextLength + 1) })] }] });
    const invalidPayload = await system.prepare(project(), tooLong);
    expect(invalidPayload.status).toBe("blocked");
    expect(invalidPayload.diagnostics.map((item) => item.code)).toContain("PAYLOAD_TOO_LONG");

    const triggerCue = buttonLedPlan({ cues: [{ id: "bad-cue", atMs: 10, order: 0, action: { ...action("led-1", "led", "indicator.set", { on: true }), payload: { kind: "trigger-payload", select: "$.value" } } }] });
    const invalidContext = await system.prepare(project(), triggerCue);
    expect(invalidContext.status).toBe("blocked");
    expect(invalidContext.diagnostics.map((item) => item.code)).toContain("TRIGGER_PAYLOAD_CONTEXT");
  });

  it("forwards only bounded trigger payload selectors and validates the destination schema", async () => {
    const plan = buttonLedPlan({ rules: [{
      id: "sensor-to-display",
      enabled: true,
      when: { type: "component.event", componentId: "sensor-1", definitionId: "sensor", eventId: "sensor.changed" },
      then: [{ componentId: "display-1", definitionId: "display", actionId: "display.showText", payload: { kind: "trigger-payload", select: "$.value" } }],
    }] });
    const preparation = await system.prepare(project(), plan);
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const session = system.open(project(), preparation.prepared);
    const result = session.dispatch(project(), { componentId: "sensor-1", definitionId: "sensor", eventId: "sensor.changed", payload: { value: 21, unit: "°C" } });
    // The source event itself is recorded as accepted, while the caller-visible
    // dispatch is rejected because its rule could not complete safely.
    expect(result.status).toBe("rejected");
    expect(result.diagnostics.map((item) => item.code)).toContain("PAYLOAD_TYPE_MISMATCH");
    expect(result.snapshot.components["display-1"].primitives[0]).toMatchObject({ kind: "text-display", lines: [] });
  });

  it("is deterministic across sessions, preserves same-time order, and seeks/reset exactly", async () => {
    const plan = buttonLedPlan({
      cues: [
        { id: "display-first", atMs: 100, order: 0, action: action("display-1", "display", "display.showText", { text: "first" }) },
        { id: "display-second", atMs: 100, order: 1, action: action("display-1", "display", "display.showText", { text: "second" }) },
      ],
    });
    const preparation = await system.prepare(project(), plan);
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const first = system.open(project(), preparation.prepared);
    const second = system.open(project(), preparation.prepared);
    const direct = first.seek(project(), 100);
    const sequential = second.seek(project(), 20);
    const final = second.seek(project(), 100);
    expect(direct.snapshotSha256).toBe(final.snapshotSha256);
    expect(direct.components["display-1"].primitives[0]).toMatchObject({ kind: "text-display", lines: ["second"] });
    expect(sequential.logicalTimeMs).toBe(20);
    const reset = first.reset(project());
    const fresh = system.open(project(), preparation.prepared).snapshot();
    expect(reset.snapshotSha256).toBe(fresh.snapshotSha256);
  });

  it("replays external history when seeking forward after a rewind", async () => {
    const plan = buttonLedPlan({
      cues: [{ id: "display-after-input", atMs: 100, order: 0, action: action("display-1", "display", "display.showText", { text: "after input" }) }],
    });
    const preparation = await system.prepare(project(), plan);
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;

    const pressed: ComponentEventRequest = {
      componentId: "button-1",
      definitionId: "button",
      eventId: "button.pressed",
      payload: { pressed: true },
    };

    const direct = system.open(project(), preparation.prepared);
    direct.seek(project(), 50);
    expect(direct.dispatch(project(), pressed).status).toBe("accepted");
    const directFinal = direct.seek(project(), 200);

    const rewindThenForward = system.open(project(), preparation.prepared);
    rewindThenForward.seek(project(), 50);
    expect(rewindThenForward.dispatch(project(), pressed).status).toBe("accepted");
    rewindThenForward.seek(project(), 200);
    const rewound = rewindThenForward.seek(project(), 25);
    expect(rewound.components["led-1"].primitives[0]).toMatchObject({ kind: "indicator", on: false });
    const replayed = rewindThenForward.seek(project(), 200);

    expect(replayed.snapshotSha256).toBe(directFinal.snapshotSha256);
    expect(replayed.components).toEqual(directFinal.components);
    expect(replayed.inputs).toEqual(directFinal.inputs);
    expect(replayed.sessionLog).toEqual(directFinal.sessionLog);
    expect(replayed.events).toEqual(directFinal.events);
  });

  it("does not apply zero-time schedule items twice after a backward seek", async () => {
    const plan = buttonLedPlan({
      cues: [{ id: "at-zero", atMs: 0, order: 0, action: action("display-1", "display", "display.showText", { text: "once" }) }],
    });
    const preparation = await system.prepare(project(), plan);
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const session = system.open(project(), preparation.prepared);
    session.seek(project(), 100);
    const rewound = session.seek(project(), 0);
    expect(rewound.events.filter((event) => event.actionId === "display.showText" && event.outcome === "accepted")).toHaveLength(1);
    expect(rewound.components["display-1"].primitives[0]).toMatchObject({ kind: "text-display", lines: ["once"] });
  });

  it("keeps retained external history bounded across repeated rewinds", async () => {
    const preparation = await system.prepare(project(), buttonLedPlan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const session = createBehaviorPreviewSession(project(), preparation.prepared, definitions, defaultBehaviorRegistry, { maxRetainedHistory: 2 });
    const request = action("led-1", "led", "indicator.set", { on: true });

    expect(session.dispatch(project(), request).status).toBe("accepted");
    session.seek(project(), 1);
    session.seek(project(), 0);
    expect(session.dispatch(project(), request).status).toBe("accepted");
    session.seek(project(), 1);
    session.seek(project(), 0);

    const rejected = session.dispatch(project(), request);
    expect(rejected.status).toBe("rejected");
    expect(rejected.diagnostics.map((issue) => issue.code)).toContain("EVENT_LIMIT_EXCEEDED");
  });

  it("keeps retained history bytes bounded for the entire session lifetime", async () => {
    const preparation = await system.prepare(project(), buttonLedPlan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const request = action("display-1", "display", "display.showText", { text: "history payload" });
    const requestBytes = measureJsonValue(request)?.utf8Bytes;
    expect(requestBytes).toBeDefined();
    if (requestBytes === undefined) return;
    const session = createBehaviorPreviewSession(project(), preparation.prepared, definitions, defaultBehaviorRegistry, {
      maxRetainedHistory: 100,
      maxRetainedHistoryBytes: requestBytes,
    });

    expect(session.dispatch(project(), request).status).toBe("accepted");
    session.seek(project(), 1);
    session.seek(project(), 0);
    expect(session.dispatch(project(), request).diagnostics.map((issue) => issue.code)).toContain("HISTORY_SIZE_LIMIT_EXCEEDED");
    session.reset(project());
    expect(session.dispatch(project(), request).diagnostics.map((issue) => issue.code)).toContain("HISTORY_SIZE_LIMIT_EXCEEDED");
  });

  it("does not retain full requests after history limits are reached", async () => {
    const preparation = await system.prepare(project(), buttonLedPlan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const acceptedRequest = action("led-1", "led", "indicator.set", { on: true });
    const acceptedBytes = measureJsonValue(acceptedRequest)?.utf8Bytes;
    expect(acceptedBytes).toBeDefined();
    if (acceptedBytes === undefined) return;
    const oversizedRequest = action("display-1", "display", "display.showText", {
      text: "x".repeat(BEHAVIOR_LIMITS.maxJsonStringLength),
    });
    const session = createBehaviorPreviewSession(project(), preparation.prepared, definitions, defaultBehaviorRegistry, {
      maxRetainedHistory: 1,
      maxRetainedHistoryBytes: acceptedBytes,
      maxSessionLogBytes: 512,
      maxSessionLogLifetimeBytes: 1_024,
    });

    expect(session.dispatch(project(), acceptedRequest).status).toBe("accepted");
    for (let index = 0; index < 100; index += 1) {
      const result = session.dispatch(project(), oversizedRequest);
      expect(result.diagnostics.map((issue) => issue.code)).toContain("EVENT_LIMIT_EXCEEDED");
    }
    const bounded = session.snapshot();
    expect(measureJsonValue(bounded.sessionLog)?.utf8Bytes).toBeLessThanOrEqual(512);
    expect(bounded.sessionLog.some((entry) => entry.requestRedacted)).toBe(true);
    expect(JSON.stringify(bounded.sessionLog)).not.toContain("x".repeat(1_000));

    session.reset(project());
    for (let index = 0; index < 100; index += 1) session.dispatch(project(), oversizedRequest);
    expect(measureJsonValue(session.snapshot().sessionLog)?.utf8Bytes).toBeLessThanOrEqual(512);
  });

  it("preserves a __proto__ component through prepare, open, and snapshot", async () => {
    const protoProject = project();
    protoProject.components = [{ ...protoProject.components.find((component) => component.definitionId === "led")!, id: "__proto__" }];
    const protoPlan: BehaviorPlanV1 = {
      schemaVersion: 1,
      id: "proto-plan",
      projectId: protoProject.id,
      name: "Prototype component",
      revision: 1,
      rules: [{
        id: "turn-on",
        enabled: true,
        when: { type: "preview.started" },
        then: [action("__proto__", "led", "indicator.set", { on: true })],
      }],
    };
    const preparation = await system.prepare(protoProject, protoPlan);
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    expect(Object.prototype.hasOwnProperty.call(preparation.prepared.componentProfiles, "__proto__")).toBe(true);
    expect(preparation.prepared.componentProfiles["__proto__"]).toMatchObject({ profileId: "digital-indicator", profileVersion: 1 });
    const snapshot = system.open(protoProject, preparation.prepared).snapshot();
    expect(Object.prototype.hasOwnProperty.call(snapshot.components, "__proto__")).toBe(true);
    expect(snapshot.components["__proto__"].primitives[0]).toMatchObject({ kind: "indicator", on: true });
  });

  it("dispatches events emitted by scheduled cue actions", async () => {
    const plan = buttonLedPlan({
      cues: [{ id: "press-button", atMs: 100, order: 0, action: action("button-1", "button", "button.setPressed", { pressed: true }) }],
    });
    const preparation = await system.prepare(project(), plan);
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const session = system.open(project(), preparation.prepared);
    const snapshot = session.seek(project(), 100);
    expect(snapshot.components["button-1"].primitives[0]).toMatchObject({ kind: "button", pressed: true });
    expect(snapshot.components["led-1"].primitives[0]).toMatchObject({ kind: "indicator", on: true });
    expect(snapshot.events.some((event) => event.eventId === "button.pressed" && event.outcome === "accepted")).toBe(true);
  });

  it("contains malformed profile emissions without crashing the session", async () => {
    const malformedProfile: BehaviorProfile<{ value: number }> = {
      manifest: {
        id: "malformed-emitter",
        version: 1,
        implementationId: "malformed-emitter:v1:test",
        actions: [{
          id: "malformed.set",
          label: "Set",
          description: "test",
          payloadSchema: payloadSchema("test/malformed-emitter/v1", { type: "object", properties: {}, additionalProperties: false }),
          control: { kind: "trigger" },
        }],
        events: [],
      },
      parseState: (value) => value && typeof value === "object" && "value" in value && typeof value.value === "number" ? { value: value.value } : { value: 0 },
      initialState: () => ({ value: 0 }),
      reduce: () => [{ state: { value: 1 }, emittedEvents: { eventId: "not-an-array" } as unknown as readonly ComponentEventRequest[] }],
      projectVisual: (state) => ({ primitives: [{ kind: "numeric-readout", key: "value", value: state.value }], accessibleSummary: `Value ${state.value}.` }),
    };
    const malformedProject = project();
    malformedProject.components = [{ id: "malformed-1", definitionId: "malformed-emitter", position: { x: 0, y: 0 }, rotation: 0, properties: {} }];
    const malformedSystem = createBehaviorSystem({
      definitions: { "malformed-emitter": { behaviorBinding: { profileId: "malformed-emitter", profileVersion: 1 } } },
      registry: createBehaviorRegistry([malformedProfile]),
    });
    const preparation = await malformedSystem.prepare(malformedProject, { schemaVersion: 1, id: "malformed-plan", projectId: malformedProject.id, name: "Malformed emitter", revision: 1, rules: [] });
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;

    const outcome = malformedSystem.open(malformedProject, preparation.prepared).dispatch(malformedProject, action("malformed-1", "malformed-emitter", "malformed.set", {}));
    expect(outcome.status).toBe("rejected");
    expect(outcome.diagnostics.map((issue) => issue.code)).toContain("INVALID_EMITTED_EVENT");
    expect(outcome.snapshot.components["malformed-1"].primitives[0]).toMatchObject({ kind: "numeric-readout", value: 1 });
  });

  it("blocks ambiguous or unknown project component identities during preparation", async () => {
    const duplicateProject = project();
    duplicateProject.components.push({ ...duplicateProject.components[0] });
    const duplicate = await system.prepare(duplicateProject, buttonLedPlan());
    expect(duplicate.status).toBe("blocked");
    expect(duplicate.diagnostics.map((item) => item.code)).toContain("DUPLICATE_COMPONENT_ID");

    const unknownProject = project();
    unknownProject.components.push({ id: "unknown-1", definitionId: "not-in-catalog", position: { x: 0, y: 0 }, rotation: 0, properties: {} });
    const unknown = await system.prepare(unknownProject, buttonLedPlan());
    expect(unknown.status).toBe("blocked");
    expect(unknown.diagnostics.map((item) => item.code)).toContain("UNKNOWN_COMPONENT_DEFINITION");
  });

  it("applies elapsed rules and rejects stale project state", async () => {
    const plan = buttonLedPlan({ rules: [{ id: "turn-on", enabled: true, when: { type: "time.elapsed", afterMs: 250 }, then: [action("led-1", "led", "indicator.set", { on: true })] }] });
    const preparation = await system.prepare(project(), plan);
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const session = system.open(project(), preparation.prepared);
    expect(session.seek(project(), 249).components["led-1"].primitives[0]).toMatchObject({ on: false });
    expect(session.seek(project(), 250).components["led-1"].primitives[0]).toMatchObject({ on: true });
    const changed = project();
    changed.components[0] = { ...changed.components[0], definitionId: "other" };
    const staleResult = session.dispatch(changed, { componentId: "button-1", definitionId: "button", eventId: "button.pressed", payload: { pressed: true } });
    expect(staleResult.status).toBe("rejected");
    expect(staleResult.diagnostics[0].code).toBe("STALE_PROJECT");
  });

  it("bounds event chains and session history", async () => {
    const loopSchema = payloadSchema("test/loop/v1", { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false });
    const loop: BehaviorProfile<{ value: number }> = {
      manifest: {
        id: "loop",
        version: 1,
        implementationId: "loop:v1:test",
        actions: [{ id: "loop.step", label: "Step", description: "test", payloadSchema: loopSchema, control: { kind: "trigger" } }],
        events: [{ id: "loop.tick", label: "Tick", description: "test", payloadSchema: loopSchema, control: { kind: "trigger", label: "Tick" } }],
      },
      parseState: (value) => ({ value: value && typeof value === "object" && "value" in value && typeof value.value === "number" ? value.value : 0 }),
      initialState: () => ({ value: 0 }),
      reduce: (state, action) => [{ state: { value: state.value + 1 }, emittedEvents: [{ componentId: "loop-1", definitionId: "loop", eventId: "loop.tick", payload: { value: state.value + 1 } }] }],
      projectVisual: (state) => ({ primitives: [{ kind: "numeric-readout", key: "loop", value: state.value }], accessibleSummary: `Loop value ${state.value}.` }),
    };
    const loopProject = project();
    loopProject.components = [{ id: "loop-1", definitionId: "loop", position: { x: 0, y: 0 }, rotation: 0, properties: {} }];
    const loopSystem = createBehaviorSystem({ definitions: { loop: { behaviorBinding: { profileId: "loop", profileVersion: 1 } } }, registry: createBehaviorRegistry([loop]) });
    // The plan can only be prepared when the custom registry is paired with a
    // catalog-only profile or the exact custom profile; this profile is exact.
    const loopPlan: BehaviorPlanV1 = { schemaVersion: 1, id: "loop-plan", projectId: loopProject.id, name: "Loop", revision: 1, rules: [{ id: "loop-rule", enabled: true, when: { type: "component.event", componentId: "loop-1", definitionId: "loop", eventId: "loop.tick" }, then: [action("loop-1", "loop", "loop.step", { value: 1 })] }] };
    const preparation = await loopSystem.prepare(loopProject, loopPlan);
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const outcome = loopSystem.open(loopProject, preparation.prepared).dispatch(loopProject, { componentId: "loop-1", definitionId: "loop", actionId: "loop.step", payload: { kind: "literal", value: { value: 1 } } });
    expect(outcome.status).toBe("rejected");
    expect(outcome.diagnostics.map((item) => item.code)).toContain("EVENT_CHAIN_LIMIT_EXCEEDED");

    const burstSchema = payloadSchema("test/burst/v1", { type: "object", properties: {}, additionalProperties: false });
    const burst: BehaviorProfile<{ count: number }> = {
      manifest: {
        id: "burst",
        version: 1,
        implementationId: "burst:v1:test",
        actions: [{ id: "burst.start", label: "Start", description: "test", payloadSchema: burstSchema, control: { kind: "trigger" } }],
        events: [{ id: "burst.tick", label: "Tick", description: "test", payloadSchema: burstSchema, control: { kind: "trigger", label: "Tick" } }],
      },
      parseState: (value) => ({ count: value && typeof value === "object" && "count" in value && typeof value.count === "number" ? value.count : 0 }),
      initialState: () => ({ count: 0 }),
      reduce: (state) => [{
        state: { count: state.count + 1 },
        emittedEvents: Array.from({ length: BEHAVIOR_LIMITS.maxDispatchedEvents + 1 }, (): ComponentEventRequest => ({ componentId: "burst-1", definitionId: "burst", eventId: "burst.tick", payload: {} })),
      }],
      projectVisual: (state) => ({ primitives: [{ kind: "numeric-readout", key: "burst", value: state.count }], accessibleSummary: `Burst count ${state.count}.` }),
    };
    const burstProject = project();
    burstProject.components = [{ id: "burst-1", definitionId: "burst", position: { x: 0, y: 0 }, rotation: 0, properties: {} }];
    const burstSystem = createBehaviorSystem({ definitions: { burst: { behaviorBinding: { profileId: "burst", profileVersion: 1 } } }, registry: createBehaviorRegistry([burst]) });
    const burstPreparation = await burstSystem.prepare(burstProject, { schemaVersion: 1, id: "burst-plan", projectId: burstProject.id, name: "Burst", revision: 1, rules: [] });
    expect(burstPreparation.status).toBe("ready");
    if (burstPreparation.status !== "ready") return;
    const burstOutcome = burstSystem.open(burstProject, burstPreparation.prepared).dispatch(burstProject, { componentId: "burst-1", definitionId: "burst", actionId: "burst.start", payload: { kind: "literal", value: {} } });
    expect(burstOutcome.status).toBe("rejected");
    expect(burstOutcome.diagnostics.map((item) => item.code)).toContain("EVENT_LIMIT_EXCEEDED");

    expect(BEHAVIOR_LIMITS.maxDispatchedEvents).toBe(10_000);
    expect(BEHAVIOR_LIMITS.maxTimelineItems).toBe(500);
  });
});
