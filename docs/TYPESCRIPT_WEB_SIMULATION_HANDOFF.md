# Behavior Preview and Editable Code Handoff

Status: implementation handoff
Audience: agents and engineers extending Schematic's TypeScript web workspace
Product direction approved: 2026-08-31
Repository truth last checked: 2026-08-31

This path is intentionally retained for continuity with earlier agent handoffs.
The former compiler/emulator roadmap in this file is superseded in full by the
behavior-preview and code-authoring direction below.

## 1. Decision summary

Schematic is an agent-native hardware design and code-authoring workspace. Its
browser preview should show the outcome a person asked for: a light turns on, a
display shows text, a motor moves, or a sensor value changes. It should do that
by applying typed, validated component actions to visual component models.

The browser preview must not compile, interpret, emulate, upload, or otherwise
execute the Arduino/C/C++/Python shown in the Code panel.

Generated code remains valuable. An agent can write ordinary source into the
Code panel, a person can edit it over many turns, and the files can later be
copied, downloaded, opened in an existing SDK/toolchain, or moved to physical
hardware for real testing. Schematic does not need an in-browser compiler or MCU
emulator to deliver that workflow.

The product has three distinct surfaces:

| Surface | Purpose | What actually runs in Schematic |
| --- | --- | --- |
| Behavior preview | Demonstrate the requested LED, display, actuator, and sensor outcome | Typed component actions and pure visual reducers |
| Editable code | Hold normal agent- or human-authored source for later iteration and export | Nothing; the source is displayed and saved as editable project files |
| External hardware/SDK handoff | Let the user test, build, upload, and refine elsewhere | Nothing inside Schematic; the external environment owns those operations |

The required product sentence is:

> This scripted preview shows the requested outcome. No source code ran, and
> wiring, electrical behavior, and physical hardware were not verified.

That distinction is a contract, not a temporary disclaimer.

## 2. Non-negotiable product boundaries

Future agents must preserve all of the following:

1. A prepared Behavior Plan plus its ordered, hashed session input/invocation
   log is the complete source of truth for the browser preview.
2. Code is an independently editable document, not preview input.
3. A model may request only registered, typed component actions. It may not name
   arbitrary JavaScript functions or mutate React/Zustand state directly.
4. Every action is validated against the exact component instance, definition,
   behavior profile, action schema, and current project fingerprint.
5. Unknown components and unsupported actions fail explicitly. They never become
   silent no-ops and never receive guessed behavior.
6. Preview output proves only what the declared Behavior Plan projects. It does
   not prove source correctness, compilation, wiring correctness, timing, power,
   electrical safety, or physical-device behavior.
7. Whole-project graph validation and Behavior Plan validation are separate
   results. Neither should be relabeled as code verification.
8. Manual code edits never change the preview automatically.
9. Behavior Plan changes never overwrite manually edited source automatically.
10. No compiler, binary artifact, MCU emulator, upload/flashing path, native
    engine, or remote execution service is required by this roadmap.
11. Existing compiler/AVR scaffolds may remain as dormant repository history, but
    agents must not integrate or expand them under this plan.
12. Existing SDKs and physical toolchains are export destinations, not hidden
    runtime dependencies of the Site.

## 3. Current repository truth

The repository does not yet implement the target architecture. An implementing
agent must migrate from these current facts rather than assuming the new types
already exist.

### 3.1 Current canonical project state

`frontend/src/store/useProjectStore.ts` owns the active frontend-local
`HardwareGraph`. It includes:

- component instances and their positions/properties;
- typed connections;
- firmware targets and source files;
- an optional legacy `compiledArtifact` field;
- legacy simulation configuration.

The separate `@schematic/hardware-graph` package is stricter but is not yet the
only graph contract. The Behavior System should depend on the canonical package
DTOs and use one explicit frontend adapter until the store migration is complete.
Do not create a third graph model.

### 3.2 Current code panel

`frontend/src/components/editor/MonacoWorkspace.tsx` already:

- shows Arduino/C++ or other board source;
- saves edits through `updateFirmware`;
- supports copying code;
- uses Monaco syntax services;
- invokes a `firmware.compile` preflight path from a button labeled “Check source.”

The new direction keeps Monaco and source persistence but removes compilation
from the recommended product flow. Monaco highlighting or editor diagnostics are
editor assistance only. They must not become a “compiled,” “verified,” or
“hardware ready” badge.

### 3.3 Current runtime and visual state

The current “Run” flow routes through `simulation.run`. It can select a fixed
precompiled 400-byte button-to-LED C/WASM fixture or a bounded TypeScript
Arduino-like interpreter. The Site API exposes a related behavioral runtime and
compile preflight. These are truthful but narrow historical capabilities.

`useSimulationStore` currently mixes:

- run/stop state;
- simulated nanoseconds;
- loose `pinStates` keys;
- engine availability;
- serial text;
- remote session state;
- the most recent runtime result.

`HardwareNode.tsx` infers several visual effects by searching those loose keys
and contains component-specific display/actuator branches. This is the main
visual seam to replace.

### 3.4 Current component capability metadata

`modelContract.ts` and `capabilityRegistry.ts` describe simulation-oriented
families and adapters. Much of the assignment is inferred from catalog IDs,
categories, ports, or text. The new behavior preview needs a separate explicit
profile binding. Simulation support and preview-action support are different
questions and must not share one overloaded badge.

### 3.5 Existing tool seams worth reusing

The current WebMCP surface already has useful low-level operations:

- `project.get_graph` and graph mutation tools;
- `firmware.write` and `firmware.read`;
- component and connection inspection;
- project validation;
- browser-local persistence and board selection.

Use these seams where their semantics remain accurate. Add preview-oriented tools
through shared application commands; do not implement separate rules inside
`webmcp/tools.ts`.

## 4. Target product semantics

### 4.1 Behavior Plan

A Behavior Plan is a finite, versioned declaration of interactive rules and
optional timed cues. It references exact component instance IDs and exact
registered events/actions.

Examples:

- when `button-1` emits `button.pressed`, set `led-1` on;
- when preview starts, show “Ready” on `display-1`;
- 500 ms after preview starts, set `servo-1` to 90 degrees;
- when `sensor-1` input changes, update a numeric readout.

It contains data only. Imported plans cannot contain callbacks, JavaScript,
source expressions, URLs, templates, or executable plugins.

### 4.2 Behavior preview

The preview is a deterministic projection of the plan:

- component events enter the Behavior System;
- matching rules emit validated component actions;
- pure profile reducers calculate component state;
- profile projectors return generic visual primitives;
- the canvas renders those primitives over static component artwork;
- a bounded logical timeline records what occurred.

The preview is conceptual by default. It may show the requested outcome even
when graph validation reports missing power or questionable wiring, but it must
show those graph diagnostics beside the preview. Missing target components,
unknown actions, invalid payloads, or stale profile bindings are plan errors and
must block the affected action.

### 4.3 Editable code

Code is a durable project document associated with a programmable board. It may
be:

- written by an agent through a tool call;
- typed or edited by a person in Monaco;
- imported from another project;
- copied or downloaded;
- exported with the project;
- passed to an external SDK, IDE, compiler, or hardware workflow later.

The Behavior System does not generate, parse, interpret, lint semantically,
compile, or execute this source. Agents remain free to write ordinary, nuanced
code rather than code constrained by a small built-in template generator.

When an agent writes a Behavior Plan and source in the same workflow, Schematic
may record that the code revision was authored alongside a specific plan hash.
That is provenance, not verification.

### 4.4 Code/preview relationship

Do not use one status ladder that implies increasing verification. Track
orthogonal facts instead:

| Dimension | Values | Meaning |
| --- | --- | --- |
| Origin | `ai-generated`, `human-authored`, `imported`, `mixed` | Who or what last established the document |
| Preview relation | `linked`, `stale`, `unlinked` | Whether this exact code revision was authored alongside the current plan revision |
| Edit state | `draft`, `saved` | Whether the current editor revision reached durable project state |
| Export state | `never-exported`, `exported` | Whether this exact revision was copied/downloaded as a handoff |
| In-app verification | always `not-performed` | Schematic did not compile, upload, run, or physically test it |

“Linked” does not mean the code caused the preview. The UI copy must say:

> Linked to this Behavior Plan revision. The preview follows the plan, not this
> source code.

Any manual source edit changes the code hash and makes the preview relation
`stale`. Any plan edit changes the plan hash and makes linked code stale. Neither
side is overwritten.

### 4.5 External handoff

Schematic’s responsibility ends at producing portable project data and source
files. External destinations may include Arduino IDE, PlatformIO, vendor SDKs,
command-line toolchains, a hardware lab, or future integrations. The core app
does not need to know which one the user chooses.

Every export must include a machine-readable handoff manifest with the exact
board definition/FQBN when known, language, filenames and hashes, declared
dependencies, Behavior Plan/source provenance, graph diagnostics, and a
plain-language plus machine-readable statement that the source was not built or
tested in Schematic.

## 5. Target topology and dependency direction

```text
Human or agent intent
        │
        ├── graph tools ───────────────► canonical hardware project
        │                                      │
        ├── behavior.plan.write ───────► versioned Behavior Plan
        │                                      │
        │                                      ▼
        │                           @schematic/behavior
        │                         inspect · prepare · session
        │                                      │
        │                        typed actions + snapshots
        │                                      │
        │                                      ▼
        │                           preview store/timeline
        │                                      │
        │                                      ▼
        │                       generic visual overlay on canvas
        │
        └── code.write ────────────────► editable code documents
                                               │
                                               ├── Monaco editing
                                               ├── copy/download
                                               └── external SDK/hardware handoff
```

Source code never feeds back into `@schematic/behavior`.

Required package direction:

```text
@schematic/hardware-graph
        ▲
        │
@schematic/behavior
        ▲
        │
frontend application commands
        ▲
        ├── Zustand adapters
        ├── React UI
        └── WebMCP tools
```

`@schematic/behavior` must not import React, Zustand, React Flow, Monaco, WebMCP,
DOM APIs, network clients, compiler packages, MCU runtimes, or Site APIs.

Dependency category: in-process. Schema parsing, capability resolution, plan
normalization, event dispatch, deterministic reduction, visual projection,
hashing inputs, and diagnostics belong behind one deep module boundary. Saved
plan persistence is local-substitutable and should use the existing project
repository rather than a new remote service.

## 6. Core TypeScript contracts

The signatures below are architectural contracts. Agents may refine names, but
must preserve the semantics and separation.

### 6.1 JSON-safe values

```ts
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type BehaviorActionId = `${string}.${string}`;
export type BehaviorEventId = `${string}.${string}`;
```

No `bigint`, `Map`, function, class instance, or binary value crosses a stored
plan or WebMCP wire boundary.

### 6.2 Behavior Plan v1

```ts
export interface BehaviorPlanV1 {
  schemaVersion: 1;
  id: string;
  projectId: string;
  name: string;
  intent?: string;
  revision: number;
  rules: readonly BehaviorRuleV1[];
  cues?: readonly BehaviorCueV1[];
}

export interface BehaviorRuleV1 {
  id: string;
  enabled: boolean;
  when: BehaviorTriggerV1;
  then: readonly ComponentActionRequestV1[];
}

export type BehaviorTriggerV1 =
  | { type: "preview.started" }
  | {
      type: "component.event";
      componentId: string;
      definitionId: string;
      eventId: BehaviorEventId;
      payload?: JsonValue;
    }
  | {
      type: "input.changed";
      componentId: string;
      definitionId: string;
      inputId: string;
    }
  | {
      type: "time.elapsed";
      afterMs: number;
    };

export interface BehaviorCueV1 {
  id: string;
  atMs: number;
  order: number;
  action: ComponentActionRequestV1;
}

export interface ComponentActionRequestV1 {
  componentId: string;
  definitionId: string;
  actionId: BehaviorActionId;
  payload: BehaviorPayloadV1;
}

export type BehaviorPayloadV1 =
  | { kind: "literal"; value: JsonValue }
  | {
      kind: "trigger-payload";
      select: "$" | "$.value";
      fallback?: JsonValue;
    };

export interface ComponentEventRequest {
  componentId: string;
  definitionId: string;
  eventId: BehaviorEventId;
  payload: JsonValue;
}

export interface InputChangeRequest {
  componentId: string;
  definitionId: string;
  inputId: string;
  value: JsonValue;
}
```

V1 has no arbitrary conditions, loops, recursion, source expressions, or
unbounded repeating timers. Add new versioned trigger/action forms only with
limits and boundary fixtures. `trigger-payload` is a bounded data binding, not
an expression language: it may forward only the full triggering payload or its
top-level `value`. It is valid only inside a `component.event` or
`input.changed` rule. Reject it in `preview.started`, `time.elapsed`, standalone
cues, and direct action dispatch—even when a fallback exists—because those
contexts have no trigger payload. The resolved value is validated against the
destination action schema before reduction. This is sufficient for
`sensor.changed` or an input update to forward a typed reading into a
numeric-readout action without hidden arbitrary dataflow.

### 6.3 Exact component behavior bindings

Catalog definitions must explicitly opt into a checked-in behavior profile:

```ts
export interface CatalogBehaviorBinding {
  profileId: string;
  profileVersion: number;
  variant?: string;
}

export interface BehaviorActionDescriptor {
  id: BehaviorActionId;
  label: string;
  description: string;
  payloadSchema: BehaviorPayloadSchemaV1;
  control:
    | { kind: "trigger" }
    | { kind: "toggle" }
    | { kind: "number"; min: number; max: number; step: number; unit?: string }
    | { kind: "text"; maxLength: number }
    | {
        kind: "select";
        options: readonly { value: JsonValue; label: string }[];
      };
}

export interface BehaviorEventDescriptor {
  id: BehaviorEventId;
  label: string;
  description: string;
  payloadSchema: BehaviorPayloadSchemaV1;
  control: { kind: "trigger"; label: string };
}

export interface BehaviorPayloadSchemaV1 {
  schemaId: string;
  dialect: "https://json-schema.org/draft/2020-12/schema";
  schema: JsonValue;
}

export type CapabilityAvailability =
  | { status: "available" }
  | {
      status: "disabled";
      code: "PRECONDITION_FAILED" | "STALE_PROJECT";
      reason: string;
      recovery?: string;
    }
  | {
      status: "unsupported";
      code: "ACTION_NOT_DECLARED" | "EVENT_NOT_DECLARED" | "PROFILE_NOT_INSTALLED";
      reason: string;
      recovery?: string;
      alternatives?: readonly string[];
    };

export interface ComponentActionCapability {
  actionId: BehaviorActionId;
  descriptor?: BehaviorActionDescriptor;
  availability: CapabilityAvailability;
}

export interface ComponentEventCapability {
  eventId: BehaviorEventId;
  descriptor?: BehaviorEventDescriptor;
  availability: CapabilityAvailability;
}

export interface ComponentBehaviorCapabilityReport {
  componentId: string;
  definitionId: string;
  profile?: CatalogBehaviorBinding;
  actions: readonly ComponentActionCapability[];
  events: readonly ComponentEventCapability[];
  limitations: readonly string[];
}
```

Unknown definitions resolve to `catalog-only:v1`. Do not infer preview support
from a title, tag, category, port, manufacturer, or fuzzy model name.
Unknown action/event requests also remain in preparation diagnostics or the
timeline with `unsupported` availability; they are not discarded merely because
there is no descriptor.

All profile payload schemas use one shared JSON Schema Draft 2020-12 validator
and a deliberately bounded keyword subset: `type`, `properties`, `required`,
`additionalProperties` as a boolean, `items`, `enum`, `const`, `minimum`,
`maximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, and `maxItems`.
Reject all other keywords, remote references, custom formats, and dynamic schema
loading. Canonical schema IDs and canonicalized schema JSON participate in the
registry hash. UI controls, plan preparation, direct invocation, and WebMCP must
call this same validator rather than reimplementing payload checks.

### 6.4 Trusted profile implementation

```ts
export interface BehaviorProfile<State> {
  manifest: {
    id: string;
    version: number;
    actions: readonly BehaviorActionDescriptor[];
    events: readonly BehaviorEventDescriptor[];
  };

  parseState(value: unknown): State;
  initialState(instance: ComponentInstance): State;

  reduce(
    state: State,
    action: ResolvedComponentAction,
    context: DeterministicActionContext,
  ): readonly StateTransition<State>[];

  projectVisual(state: State): ComponentVisualProjection;
}
```

Profiles are trusted checked-in TypeScript. Imported plans reference profile and
action IDs only; they never import reducers or renderer code.

### 6.5 Generic visual primitives

```ts
export type VisualPrimitive =
  | {
      kind: "indicator";
      key: string;
      on: boolean;
      color: string;
      intensity: number;
    }
  | { kind: "button"; key: string; pressed: boolean }
  | { kind: "switch"; key: string; position: string }
  | {
      kind: "text-display";
      key: string;
      lines: readonly string[];
    }
  | {
      kind: "numeric-readout";
      key: string;
      value: number;
      unit?: string;
    }
  | { kind: "rotation"; key: string; degrees: number }
  | {
      kind: "activity";
      key: string;
      state: "idle" | "active" | "warning";
    };

export interface ComponentVisualProjection {
  primitives: readonly VisualPrimitive[];
  accessibleSummary: string;
}
```

`ComponentArtwork` remains the static base. A generic
`ComponentVisualOverlay` renders these primitives. Truly specialized displays
may use explicitly registered renderer extensions; never scatter new
definition-ID conditionals through `HardwareNode`.

### 6.6 Plan preparation

```ts
export type PlanPreparation =
  | {
      status: "ready";
      prepared: PreparedBehaviorPlan;
      diagnostics: readonly BehaviorDiagnostic[];
    }
  | {
      status: "partial";
      prepared: PreparedBehaviorPlan;
      rejected: readonly RejectedBehaviorItem[];
      diagnostics: readonly BehaviorDiagnostic[];
    }
  | {
      status: "blocked";
      rejected: readonly RejectedBehaviorItem[];
      diagnostics: readonly BehaviorDiagnostic[];
    };

export interface PreparedBehaviorPlan {
  schemaVersion: 1;
  plan: BehaviorPlanV1;
  planSha256: string;
  projectSha256: string;
  registrySha256: string;
  profileVersions: Readonly<Record<string, number>>;
  normalizedRules: readonly ResolvedBehaviorRule[];
  normalizedCues: readonly ResolvedBehaviorCue[];
}
```

Default preparation policy is to block unsupported items. An explicit
`onUnsupported: "skip"` policy may produce `partial`; it must list every skipped
item and the preview must remain visibly partial.

### 6.7 Preview session and results

```ts
export interface BehaviorSystem {
  inspect(project: HardwareProject): ProjectBehaviorReport;

  prepare(
    project: HardwareProject,
    plan: unknown,
    policy?: { onUnsupported: "block" | "skip" },
  ): Promise<PlanPreparation>;

  open(
    project: HardwareProject,
    prepared: PreparedBehaviorPlan,
  ): BehaviorPreviewSession;
}

export interface BehaviorPreviewSession {
  dispatch(
    currentProject: HardwareProject,
    request: ComponentEventRequest | InputChangeRequest | ComponentActionRequestV1,
  ): ActionOutcome;
  seek(currentProject: HardwareProject, timeMs: number): BehaviorSnapshot;
  reset(currentProject: HardwareProject): BehaviorSnapshot;
  snapshot(): BehaviorSnapshot;
  dispose(): void;
}

export interface BehaviorSnapshot {
  source: "behavior-preview";
  execution: "typed-actions-only";
  sourceCodeExecution: "none";
  logicalTimeMs: number;
  sequence: number;
  components: Readonly<Record<string, ComponentVisualProjection>>;
  inputs: Readonly<Record<string, JsonValue>>;
  sessionLog: readonly BehaviorSessionLogEntry[];
  sessionLogSha256: string;
  events: readonly BehaviorTimelineEvent[];
  diagnostics: readonly BehaviorDiagnostic[];
  snapshotSha256: string;
}

export interface BehaviorSessionLogEntry {
  sequence: number;
  logicalTimeMs: number;
  kind: "component-event" | "input-change" | "direct-action";
  request: ComponentEventRequest | InputChangeRequest | ComponentActionRequestV1;
  outcome: "accepted" | "rejected";
  diagnosticCodes: readonly string[];
}
```

Playback controls belong to a frontend adapter. They call `seek` based on
logical time. `requestAnimationFrame` may render snapshots but may not decide
state; dropped frames must not change results. `open` recomputes the current
project and registry hashes before creating a session. Every state-changing
session method receives the current project again and rejects/disposes the
session if its fingerprint changed; the registry is immutable for one
`BehaviorSystem` instance and its hash is checked against the prepared plan.
Every accepted or rejected dispatch is appended to the ordered bounded session
log before a new snapshot is exposed.
Thus direct `behavior.invoke` calls remain reproducible without silently
mutating the durable plan: preview truth is the prepared plan plus this exact
session log.

### 6.8 Code documents

```ts
export interface CodeDocument {
  schemaVersion: 1;
  id: string;
  projectId: string;
  targetComponentId: string;
  targetDefinitionId: string;
  boardFqbn?: string;
  language: "arduino" | "micropython" | "espidf" | "c" | "cpp" | "python";
  files: readonly CodeFile[];
  dependencies: readonly CodeDependency[];
  revision: number;
  contentSha256: string;
  exportHistory: readonly CodeExportRecord[];
  origin: "ai-generated" | "human-authored" | "imported" | "mixed";
  previewLink:
    | { status: "unlinked" }
    | {
        status: "linked";
        behaviorPlanId: string;
        behaviorPlanSha256: string;
        projectSha256: string;
        linkedContentSha256: string;
      }
    | {
        status: "stale";
        behaviorPlanId: string;
        behaviorPlanSha256: string;
        projectSha256: string;
        linkedContentSha256: string;
        changed: readonly ("code" | "plan" | "project")[];
      };
  inAppVerification: "not-performed";
  updatedAt: string;
}

export interface CodeFile {
  name: string;
  content: string;
}

export interface CodeDependency {
  ecosystem: "arduino-library" | "platformio" | "python-package" | "vendor-sdk" | "other";
  name: string;
  version?: string;
  sourceUrl?: string;
}

export interface CodeExportRecord {
  contentSha256: string;
  exportedAt: string;
  format: "source-files" | "handoff-manifest" | "project-bundle";
}

export interface ExternalCodeHandoffV1 {
  schemaVersion: 1;
  projectId: string;
  projectSha256: string;
  target: {
    componentId: string;
    definitionId: string;
    boardFqbn?: string;
  };
  language: CodeDocument["language"];
  files: readonly {
    name: string;
    content: string;
    sha256: string;
  }[];
  sourceSha256: string;
  dependencies: readonly CodeDependency[];
  previewLink: CodeDocument["previewLink"];
  graphDiagnostics: readonly GraphDiagnosticWire[];
  claims: {
    builtInSchematic: false;
    compiledInSchematic: false;
    executedInSchematic: false;
    uploadedBySchematic: false;
    physicallyTestedBySchematic: false;
  };
  exportedAt: string;
}

export interface GraphDiagnosticWire {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  componentIds?: readonly string[];
  connectionIds?: readonly string[];
}
```

Do not retain `compiledArtifact` in the next canonical project schema. A
backward-compatible importer may preserve it as ignored legacy metadata during
migration, but it must not affect badges, preview, export claims, or status.

## 7. Initial profile and action vocabulary

Ship a deliberately small, useful profile set before expanding catalog
coverage:

| Profile | Events | Actions | Visual result |
| --- | --- | --- | --- |
| `momentary-input:v1` | `button.pressed`, `button.released` | `button.setPressed` for direct demonstrations | Pressed/released overlay |
| `digital-indicator:v1` | none | `indicator.set`, `indicator.setBrightness` | On/off/color/intensity overlay |
| `text-display:v1` | none | `display.showText`, `display.clear` | Bounded text lines |
| `buzzer:v1` | none | `buzzer.start`, `buzzer.stop` | Active/frequency state; audio optional and user-gated |
| `relay:v1` | none | `relay.set` | Open/closed state |
| `rotary-actuator:v1` | none | `servo.setAngle` | Bounded rotation |
| `motor:v1` | none | `motor.setSpeed`, `motor.stop` | Direction/speed/activity state |
| `numeric-sensor:v1` | `sensor.changed` | `sensor.setReading` for injected preview input | Numeric value and unit |

Every profile needs:

- exact payload bounds;
- initial state;
- pure reducer fixtures;
- generic visual projection;
- accessible summary;
- unsupported-action behavior;
- version and migration policy;
- explicit catalog definition bindings.

Preview actions intentionally do not propagate automatically across wires.
Authors express the desired causality in rules. The graph remains valuable for
design context and diagnostics, but the preview does not pretend to solve
electrical behavior.

## 8. Validation model

Report four independent layers:

1. **Graph validation**: structural ports, connection domains, required project
   references, and existing wiring checks.
2. **Behavior Plan validation**: schema, exact instances/definitions, registered
   events/actions, payloads, limits, conflicting writers, and staleness.
3. **Preview result**: typed actions projected, rejected, skipped, and final
   visual state.
4. **Code-document state**: saved files, origin, hashes, preview link, and export
   history.

None of these is compilation or physical verification.

Blocking plan errors include:

- component instance does not exist;
- current definition differs from the plan target;
- behavior profile is absent or at the wrong version;
- event/action ID is not declared;
- payload fails its exact schema;
- non-finite or out-of-range time/value;
- plan exceeds rule/action/event budgets;
- conflicting same-rule writes with no explicit order;
- project/profile fingerprint changed after preparation.

Graph electrical issues may be warnings in a conceptual preview, but must remain
visible. The UI should never turn a successful conceptual preview into a green
claim that the hardware will work.

## 9. Determinism and conflict rules

The same project, registry, plan, inputs, and logical time must produce the same
snapshot hash.

Required rules:

- canonical stored order is rule ID and explicit action order;
- cues sort by `(atMs, order, cue.id)`;
- event dispatch increments a monotonic sequence;
- reducers cannot call `Date`, `Math.random`, DOM APIs, timers, storage, or
  network APIs;
- seeded examples use an injected deterministic generator only;
- timestamps are non-negative bounded integers;
- simultaneous writes to one state field are either rejected during preparation
  or resolved by an explicit documented order;
- event chains have depth and total-event budgets;
- direct seek and sequential playback yield identical snapshots;
- reset always returns the exact initial snapshot;
- reduced-motion changes interpolation only, never logical state.

## 10. Code-panel lifecycle

### 10.1 Common agent workflow

The preferred model/agent sequence is:

1. Read the graph and exact behavior capabilities.
2. Create or update a Behavior Plan from user intent.
3. Preview the plan and resolve unsupported actions or missing bindings.
4. Write normal source files to the chosen board’s code document.
5. Record an optional link between the exact source hash and exact plan hash.
6. Select the board and open the Code panel.
7. Let the human and later agents edit the code without restriction.
8. Copy/download/export the code for external testing when requested.

No step calls a compiler, simulator, emulator, or uploader.

### 10.2 Model code responses in the side panel

Do not rely on scraping fenced code from a chat response. A model should call a
typed `code.write` tool (initially this can adapt the existing `firmware.write`)
with exact files. The shared application command then persists the files,
selects the target board, and opens Monaco.

The model may still explain the code normally in chat. The authoritative editor
content is the tool payload stored in the project.

### 10.3 Overwrite safety

Writing code must use optimistic concurrency:

```ts
export interface WriteCodeRequest {
  targetComponentId: string;
  files: readonly CodeFile[];
  language: CodeDocument["language"];
  dependencies: readonly CodeDependency[];
  expectedContentSha256: string | null;
  origin: CodeDocument["origin"];
  linkToBehaviorPlan?: {
    planId: string;
    planSha256: string;
    projectSha256: string;
  };
}
```

- `expectedContentSha256: null` means create only if empty.
- An exact hash allows replacement of the revision the caller actually read.
- A mismatch returns `source-conflict` without changing files.
- A destructive replacement tool requires explicit overwrite intent and an
  exact expected hash.
- Plan regeneration may offer a new draft but cannot overwrite existing code.

### 10.4 UI badges and copy

Recommended badges:

- `AI draft`
- `Human edited`
- `Imported`
- `Linked to preview plan`
- `Preview link stale`
- `Not tested in Schematic`
- `Exported`

Persistent Code-panel notice:

> Editable source for external use. Schematic has not compiled, uploaded, run,
> or physically tested this code. Behavior Preview follows the Behavior Plan.

Remove `Compiled` and `Uploaded` from the in-app lifecycle. External workflows
may report their own results in a future integration, but that is a separate
provenance domain and not part of this roadmap.

## 11. UI and interaction handoff

### 11.1 Studio top bar

- Rename `Run` to `Preview behavior`.
- Rename `Stop` to `Pause preview` when playback is active.
- Provide `Reset preview`.
- Show a persistent `Scripted outcome · no code ran · wiring and hardware not
  verified` badge while a preview session is present.
- Show plan errors separately from graph issues.
- Use the same two-axis warning in preview empty, ready, partial, and completed
  result states so no attractive visual state becomes an implicit hardware claim.

### 11.2 Canvas

- `HardwareNode` consumes `visualStates[componentId]` or the generic projected
  primitives, not suffix matches over loose `pinStates`.
- Add one `ComponentVisualOverlay` for generic primitives.
- Render preview state over static `ComponentArtwork`.
- Interactive components dispatch registered events through the Behavior
  System. A button click cannot directly toggle an unrelated LED.
- Unsupported actions remain visible in Inspector with their exact reason.

### 11.3 Inspector

Generate an `Events and actions` section from profile descriptors:

- event buttons for interactive inputs;
- typed controls for registered actions;
- payload ranges/options from descriptors;
- disabled/unsupported explanations;
- an option to invoke once for preview;
- an explicit option to add the invocation as a plan cue or rule action.

One-off invocation uses the same validator and reducer as plan playback. It is
never an arbitrary component method call.

All event/action controls must be keyboard operable and have visible labels.
Disabled or unsupported controls must expose their reason and recovery as
adjacent readable text or through `aria-describedby`; a disabled control or
hover-only tooltip cannot be the sole explanation. Use one throttled polite live
region for accepted/rejected action boundaries. Do not announce every animation
frame or repeat each component's visual summary on every timeline tick.

### 11.4 Timeline and results

The bottom dock should evolve from engine/pin debugging to:

- logical preview time;
- play/pause/seek/reset;
- component events;
- accepted and rejected actions;
- current accessible component summaries;
- plan and project hashes;
- graph warnings;
- the statement `Source code execution: none`.

### 11.5 Code panel

Move the active right-panel tab from component-local state into
`useWorkspaceStore` so an agent tool can reliably open Code after writing files.

Replace the compile/preflight button with appropriate authoring actions:

- Copy
- Download files
- View revision/link status
- Revert only through explicit version/history UI if implemented

Do not add a fake “Validate” button that performs the old regex preflight under
a new name.

## 12. WebMCP and application command design

WebMCP callbacks must be thin adapters over shared application commands.

### 12.1 Recommended tools

`behavior.get_capabilities`

- read-only;
- returns exact events/actions for project components;
- separates preview support from graph/simulation metadata;
- includes payload schema and limitations.

`behavior.plan.write`

- creates or updates a versioned plan with an expected revision;
- validates schema and project references;
- does not start playback or write code.

`behavior.preview`

- prepares the selected plan and returns the initial/scenario snapshots;
- may open a local preview session;
- always reports `sourceCodeExecution: "none"`;
- never reads code content as behavior input.

`behavior.invoke`

- validates and applies one registered action or event to the current preview;
- optional `record` data may be returned to help the caller add a cue;
- does not mutate the durable plan unless the caller separately writes it.

`behavior.get_state`

- read-only snapshot and diagnostics;
- contains project/plan/registry hashes and logical time.

`code.write`

- writes normal editable files with exact-hash conflict protection;
- may link the written revision to a plan hash;
- selects the target board and opens Code;
- response always says it was not compiled, uploaded, run, or tested.

`code.read`

- reads exact file content and status dimensions;
- read-only.

`code.export`

- always creates/returns an `ExternalCodeHandoffV1` manifest alongside the local
  source download/package;
- records the exact exported revision hash and manifest format;
- does not send the source to a third party without separate user authority.

### 12.2 Compatibility aliases

During migration:

- `firmware.write` may adapt to `code.write`;
- `firmware.read` may adapt to `code.read`;
- `simulation.run` may return a deprecation result pointing to
  `behavior.preview`, or remain behind an explicitly labeled legacy flag;
- `firmware.compile` must be removed from the recommended workflow and later
  from native registration;
- `/api/compile` and `/api/simulation/*` are not needed for the target preview
  path.

Do not silently change an old tool’s meaning while claiming protocol
compatibility. Version or deprecate it clearly.

### 12.3 Result truth

Every preview result includes machine-readable claims:

```ts
export interface PreviewClaims {
  basis: "declared-behavior-plan";
  componentActionsValidated: boolean;
  sourceCodeRead: false;
  sourceCodeExecuted: false;
  sourceCodeCompiled: false;
  hardwareUploaded: false;
  electricalBehaviorSimulated: false;
  physicalWiringVerified: false;
  physicalBehaviorVerified: false;
}
```

## 13. Persistence and project schema

Durable canonical project data:

- hardware graph;
- Behavior Plans;
- editable code documents;
- plan/code provenance links;
- graph and plan diagnostics that are safe to recompute;
- timestamps and schema versions.

Ephemeral/recomputable data:

- prepared plans;
- registry resolution caches;
- preview sessions;
- current logical cursor;
- projected snapshots;
- action/event timelines;
- selection and open panels.

Do not persist active timers or reducer closures. A page reload prepares the
saved plan again and begins from an initial snapshot unless a future explicit
bookmark format is added.

Project import/export must:

- validate Behavior Plans as untrusted JSON;
- bound rule/cue/file counts and text sizes;
- reject duplicate IDs and dangling component references;
- preserve unknown future plan versions as unsupported data only when safe;
- never load executable behavior code from an imported project;
- mark code/plan links stale if canonical hashes no longer match;
- ignore or quarantine legacy compiled artifacts.

## 14. Security and resource budgets

### 14.1 Trust boundaries

- Model-authored and imported plans are untrusted data.
- Profile reducer and visual projector code is trusted checked-in application
  code.
- Code documents are untrusted text and are never evaluated by Schematic.
- Behavior action payloads are parsed against runtime schemas before reducers.
- Text displayed on virtual screens is rendered as text, never HTML.
- Source comments derived from intent text must be escaped if an agent chooses
  to include them.
- Preview tools cannot navigate, fetch URLs, open sockets, or call external
  SDKs.

### 14.2 Initial hard limits

Choose explicit constants and test boundary values. Recommended starting limits:

- 100 plans per project;
- 200 rules per plan;
- 20 actions per rule;
- 2,000 cues per plan;
- 60,000 ms preview duration by default;
- 10-minute absolute logical duration ceiling;
- 10,000 total dispatched events per session;
- 32 event-chain depth;
- 4,096 characters per display-text payload;
- 1 MiB per code file and 10 MiB total project import, consistent with current
  project-file protections;
- 500 retained timeline items before bounded summarization;
- bounded project-scoped prepared-plan cache with LRU eviction.

Large values must fail with structured diagnostics before playback.

### 14.3 Performance rules

- Initial Studio load must not import legacy compiler/emulator packages.
- Profile metadata may load eagerly if small; specialized renderers load lazily.
- Preview reduction is synchronous and bounded for ordinary actions.
- Long plan preparation may move to a worker only after measurement; do not add
  worker complexity speculatively.
- Seek may use deterministic checkpoints for large cue lists.
- Canvas components should subscribe only to their own projected state.
- Timeline rendering must virtualize or summarize large histories.
- Project switching disposes the current preview session.

## 15. Migration roadmap

This sequence replaces the former compiler/AVR phases. Complete each vertical
slice before adding broader catalog support.

### Phase 0: lock truth and vocabulary

Deliverables:

- adopt this decision record;
- update product copy from simulation/run/compile to preview/code/export where
  the new path is active;
- document current legacy runtime separately from the target architecture;
- define a feature flag or compatibility boundary for migration;
- ensure no new work depends on `browser-toolchain` or `avr-runtime`.

Acceptance:

- every new preview surface says code execution is absent;
- current production claims remain accurate during transition;
- dormant compiler/emulator packages do not enter the Site bundle;
- agents have one canonical handoff document.

### Phase 1: deep Behavior System contracts

Deliverables:

- create `packages/behavior/` (published name `@schematic/behavior`);
- add plan schemas, canonical serialization/hashing, diagnostics, limits, exact
  profile registry, preparation, sessions, and snapshots;
- add a frontend graph adapter without introducing another graph DTO;
- implement `catalog-only:v1`, `momentary-input:v1`, and
  `digital-indicator:v1`.

Acceptance:

- button press/release can deterministically drive an LED plan rule;
- unknown actions fail explicitly;
- identical inputs produce identical snapshot hashes;
- direct seek equals sequential playback;
- package imports no frontend/browser/runtime/compiler code;
- boundary tests exercise only public interfaces.

### Phase 2: generic visual projection

Deliverables:

- add the minimal shared preview application command and
  `useBehaviorPreviewStore` state needed by canvas consumers;
- create `ComponentVisualOverlay`;
- migrate LED/button state away from loose `pinStates` suffix matching;
- add `text-display:v1`, `buzzer:v1`, `relay:v1`,
  `rotary-actuator:v1`, `motor:v1`, and `numeric-sensor:v1`;
- expose accessible summaries and reduced-motion behavior;
- add profile support separately from existing simulation labels.

Acceptance:

- LED, button, display, buzzer, relay, servo, motor, and sensor outcomes render
  from generic primitives;
- no profile gains support through fuzzy inference;
- unsupported controls remain visible with a reason;
- component-specific canvas branches are reduced rather than multiplied;
- accessible summaries match visual snapshots.

### Phase 3: preview store, timeline, and persistence

Deliverables:

- finish replacing or migrating `useSimulationStore` to the preview-oriented
  store introduced in Phase 2;
- persist Behavior Plans and their project/profile revisions;
- implement playback, pause, seek, reset, input/event dispatch, and staleness;
- update Behavior Plan import/export validation and migrations;
- move the right-panel tab into `useWorkspaceStore`.

Acceptance:

- reload preserves plans and code but recreates preview state safely;
- project switching cannot leak sessions or snapshots;
- graph/profile changes invalidate prepared plans;
- no active timer is persisted;
- preview history is bounded;
- old projects import without trusting legacy artifacts.

### Phase 4: code-document lifecycle

Deliverables:

- add code-document hashes, origin, revision, preview relation, and export state;
- adapt `updateFirmware`/existing storage without losing user source;
- persist code-document provenance and add its project import/export migration;
- remove compile controls from Monaco’s primary workflow;
- add copy/download and exact-hash overwrite protection;
- mark links stale on plan, project, or code changes;
- keep Monaco source fully editable.

Acceptance:

- agent-written code appears immediately in the selected board’s Code panel;
- manual edits never change preview output;
- plan edits never overwrite source;
- stale links are visible and machine-readable;
- conflicting writes fail without data loss;
- every code surface says it was not tested in Schematic.

### Phase 5: shared commands and WebMCP migration

Deliverables:

- add the recommended behavior/code tools as thin adapters;
- make human UI and WebMCP use the same commands;
- deprecate simulation/compile tools with structured replacements;
- update agent instructions and demo flows;
- add tool cancellation and project-switch isolation.

Acceptance:

- a model can build a graph, write a plan, preview outcomes, write normal code,
  and open Code without compiler/runtime calls;
- a direct component action is schema-checked and deterministic;
- UI and tool results have matching hashes/diagnostics;
- tools cannot overwrite newer human code;
- no preview tool reads source as execution input.

### Phase 6: retire legacy default execution

Deliverables:

- make Behavior Preview the only default top-bar outcome workflow;
- remove legacy runtime-specific UI/store fields after compatibility review;
- remove native registration of misleading compile/run operations;
- decide separately whether to delete or archive legacy runtime/WASM tests and
  packages;
- keep graph validation and project/code history intact.

Acceptance:

- ordinary users and agents cannot confuse preview with firmware execution;
- the initial bundle has no legacy engine/compiler path;
- code export remains intact;
- release documentation contains no compiler/emulator implementation promise;
- legacy removal does not reduce graph validation coverage.

### Phase 7: measured profile and SDK handoff expansion

Deliverables:

- add profiles only from observed user demand;
- provide a profile authoring guide and conformance fixtures;
- improve code/project export formats for existing SDK workflows;
- optionally expose user-selected external handoff adapters in a future RFC.

Acceptance:

- each new action has bounds, reducer tests, projection tests, and accessibility;
- catalog coverage reports explicit supported/unsupported counts;
- external handoff is user initiated and never implies an in-app build;
- no third-party SDK is called without separate authorization and security review.

## 16. Test strategy

Follow the architecture rule: test the deep boundary and remove obsolete shallow
tests after migration rather than stacking duplicate suites forever.

### 16.1 Package boundary tests

- malformed and unknown plan versions fail closed;
- duplicate rule/cue IDs are rejected;
- missing, stale, or mismatched component definitions are rejected;
- unknown profile/event/action IDs return structured unsupported diagnostics;
- invalid payloads never reach reducers;
- unsupported items block by default and skip only under explicit policy;
- exact profile version and registry hashes are pinned;
- object/map ordering does not change canonical hashes;
- same-time actions follow explicit order;
- event cycles stop at the budget with a diagnostic;
- same plan/input/time produces byte-identical snapshots;
- direct seek and sequential playback agree;
- reset is exact;
- profile reducers are pure under test instrumentation;
- display text and accessible summaries are escaped/bounded;
- imported plans cannot inject callbacks or renderer code.

### 16.2 Code lifecycle tests

- create-if-empty succeeds and is idempotent;
- wrong expected source hash returns conflict;
- manual editing changes content hash and marks a link stale;
- plan/project changes mark links stale without changing code;
- code edits have no effect on preview snapshots;
- plan edits do not overwrite code;
- agent/human/import origin transitions are correct;
- export records the exact exported revision;
- results always report `inAppVerification: "not-performed"`;
- project switching isolates documents and links;
- multi-board statuses do not leak.

### 16.3 UI and accessibility tests

- top bar says `Preview behavior`, not a generic `Run`;
- persistent preview disclaimer is visible;
- generic visual primitives render expected state;
- interactive controls dispatch registered events only;
- unsupported controls show exact reasons;
- live regions announce preview changes without excessive chatter;
- reduced-motion preserves logical results;
- Code notice remains visible and code is editable;
- tool-written source selects the board and opens Code;
- overwrite conflicts preserve the editor contents.

### 16.4 UI/WebMCP parity tests

For shared fixtures, assert:

- identical preparation diagnostics;
- identical plan/project/registry hashes;
- identical action outcomes;
- identical snapshot hashes;
- identical staleness behavior;
- identical source-conflict behavior;
- identical truthful claims.

### 16.5 Tests to retire after migration

After the new path fully replaces the default workflow, review and remove tests
whose only purpose is the old source interpreter, portable execution selector,
remote simulation fallback, compile preflight UI, engine-status store, or loose
pin-state rendering. Do not delete them before the relevant production path is
actually retired.

Retain graph validation, persistence, import/export, auth isolation, catalog,
WebMCP registration, and general workspace coverage.

## 17. Release and CI gates

A release containing the new preview path must fail unless:

1. all existing workspace and Site verification passes;
2. behavior schemas and canonical hashes have golden fixtures;
3. every enabled catalog profile resolves exactly;
4. every registered action has payload, reducer, projection, and accessibility
   tests;
5. unsupported-action behavior is tested;
6. determinism and seek/playback parity pass;
7. code/plan staleness and overwrite protection pass;
8. UI and WebMCP parity pass;
9. no preview result claims source execution/compilation/upload;
10. the initial Site bundle does not import compiler/emulator assets;
11. product-copy scans reject forbidden success phrases;
12. import/export round trips preserve plans/code without executable data;
13. the behavior package has no forbidden frontend/network dependencies.

Suggested forbidden product phrases in the preview path:

- `code executed successfully`;
- `compiled successfully`;
- `verified firmware`;
- `hardware tested`;
- `uploaded`;
- `cycle accurate`;
- `electrically accurate`;
- `the code caused this output`.

## 18. Risk register

| Risk | Consequence | Required mitigation |
| --- | --- | --- |
| Preview is mistaken for code execution | Users trust untested source | Persistent disclaimer plus machine-readable claims |
| Code and plan drift | Preview and editor tell different stories | Independent hashes and visible stale relation; never overwrite |
| Model invents an action | False or unsafe visual state | Exact registry/schema validation and explicit unsupported result |
| Fuzzy catalog inference grants support | Wrong device behavior | Explicit profile binding by exact definition ID/version |
| Direct tool mutates UI/store | Nondeterminism and bypassed checks | All actions pass through the deep Behavior System |
| Event rules loop forever | Frozen browser | Event depth/count/duration budgets |
| Browser frame rate changes results | Non-reproducible preview | Logical time and pure seekable snapshots |
| Graph warnings disappear behind a pretty preview | False hardware confidence | Separate persistent graph diagnostics |
| Generated code overwrites human work | Data loss | Expected-hash concurrency and destructive overwrite confirmation |
| Plan regeneration overwrites edited code | Lost iteration | No automatic regeneration writes |
| Imported plan executes code | Security failure | Data-only schemas and checked-in reducers only |
| Hundreds of profiles become unmaintainable | Quality collapse | Shared profiles, exact bindings, measured expansion |
| Specialized visuals create conditionals everywhere | Brittle canvas | Generic primitives and controlled renderer extensions |
| Legacy compile/runtime remains prominent | Product direction stays confusing | Deprecation, feature boundary, eventual removal |
| External SDK handoff leaks source | Privacy/security issue | User-initiated export and separate integration authorization |

## 19. Definition of done

The new direction is complete when:

- a human or agent can describe component behavior as a versioned plan;
- plans reference exact registered events/actions and fail closed;
- button, LED, display, buzzer, relay, servo, motor, and sensor profiles work
  through generic visual primitives;
- a preview is deterministic, seekable, resettable, and bounded;
- the canvas clearly labels it as scripted behavior rather than firmware
  execution;
- graph diagnostics remain independently visible;
- agents can write normal multi-file source to the Code panel;
- people can edit source over many turns without plan-driven overwrites;
- plan/code links become stale honestly;
- code can be copied/downloaded/exported for external use;
- no required workflow compiles, emulates, uploads, or interprets source;
- UI and WebMCP share one application-command layer;
- unsupported components/actions produce structured results;
- persistence/import/export and project switching are safe;
- all release gates pass from a clean checkout.

This does not mean the generated code is correct or the physical device works.
Those remain external testing outcomes.

## 20. First-agent implementation checklist

The next implementation agent should:

1. Read this document, `README.md`, `ARCHITECTURE.md`, and
   `docs/CHATGPT_SITE_RUNBOOK.md`.
2. Run `pnpm run verify` before changing behavior.
3. Inventory all current `simulation.run`, `firmware.compile`,
   `useSimulationStore`, and `pinStates` call sites.
4. Write an ADR confirming that source code is not preview input.
5. Create `@schematic/behavior` with its public boundary tests first.
6. Add exact behavior-profile bindings without changing current simulation
   support metadata.
7. Deliver the button-to-LED Behavior Plan vertical slice.
8. Add generic visual primitives and accessible projection.
9. Move right-panel tab state into `useWorkspaceStore`.
10. Add durable Behavior Plans and code provenance with schema migration.
11. Implement exact-hash code writes before exposing agent code tools.
12. Add shared application commands before WebMCP callbacks.
13. Rename UI only as the new path becomes functional; do not break current
    truth during partial migration.
14. Expand to display, buzzer, relay, servo, motor, and sensor profiles.
15. Deprecate legacy tools with explicit structured replacements.
16. Remove old production paths/tests only after parity and migration gates pass.
17. Re-run the full release gate and update this handoff with actual landed state.

Do not begin by integrating AVR8js, browser compilers, Arduino CLI, native
simulators, remote execution, Web Serial upload, or third-party SDK calls.

## 21. File map

### Existing files to understand

| Concern | Current location |
| --- | --- |
| Frontend project graph/source | `frontend/src/store/useProjectStore.ts` |
| Project persistence | `frontend/src/store/projectPersistence.ts`, `packages/project-storage/` |
| Current preview/runtime state | `frontend/src/store/useSimulationStore.ts` |
| Current runtime | `frontend/src/simulation/runtime.ts` |
| Current capability inference | `frontend/src/simulation/modelContract.ts`, `capabilityRegistry.ts` |
| Current visual component state | `frontend/src/components/canvas/HardwareNode.tsx` |
| Static artwork | `frontend/src/components/ComponentArtwork.tsx` |
| Code editor | `frontend/src/components/editor/MonacoWorkspace.tsx` |
| Studio run controls | `frontend/src/pages/StudioPage.tsx` |
| Right-panel local tab state | `frontend/src/components/layout/RightPanel.tsx` |
| Shared workspace UI state | `frontend/src/store/useWorkspaceStore.ts` |
| WebMCP tools | `frontend/src/webmcp/tools.ts` |
| Graph validation | `packages/validation/`, `frontend/src/store/useValidationStore.ts` |
| Import/export validation | `frontend/src/utils/vllxFile.ts` |
| Dormant paths not to integrate | `packages/browser-toolchain/`, `packages/avr-runtime/` |

### Proposed files

```text
packages/behavior/
  src/contracts.ts
  src/schemas.ts
  src/canonicalize.ts
  src/registry.ts
  src/prepare.ts
  src/session.ts
  src/diagnostics.ts
  src/profiles/
    catalog-only.ts
    momentary-input.ts
    digital-indicator.ts
    text-display.ts
    buzzer.ts
    relay.ts
    rotary-actuator.ts
    motor.ts
    numeric-sensor.ts
  src/index.ts
  src/index.test.ts

frontend/src/behavior/
  graphAdapter.ts
  behaviorSystem.ts
  applicationCommands.ts

frontend/src/store/
  useBehaviorPreviewStore.ts

frontend/src/components/behavior/
  BehaviorPreviewControls.tsx
  BehaviorTimeline.tsx
  BehaviorPlanSummary.tsx
  ComponentVisualOverlay.tsx

frontend/src/code/
  codeDocumentCommands.ts
  codeDocumentStatus.ts
```

File names are recommendations, not a license to create shallow pass-through
modules. Keep normalization, resolution, validation, reduction, projection, and
hashing inside the deep behavior package.

## 22. Required product language

Use:

- `Behavior Preview`;
- `Scripted preview`;
- `Expected outcome`;
- `Typed component actions`;
- `Plan checked`;
- `Preview partially available`;
- `Action unavailable in preview`;
- `Editable code`;
- `AI draft`;
- `Human edited`;
- `Linked to preview plan`;
- `Preview link stale`;
- `Not tested in Schematic`;
- `Copy/download for external testing`.

Avoid:

- `Run firmware`;
- `Compiled`;
- `Uploaded`;
- `Verified code`;
- `Simulation passed`;
- `Hardware works`;
- `Code produced this outcome`;
- `Exact MCU behavior`;
- `Electrical simulation`;
- `SDK tested`.

Recommended results:

- “Behavior Plan checked. This preview shows the requested outcome; no source
  code ran.”
- “Editable source added to Code. It has not been compiled, uploaded, run, or
  physically tested by Schematic.”
- “This action is unavailable for the selected component profile. No visual
  state was changed.”
- “The project changed after this plan was prepared. Prepare the preview again.”
- “The code or plan changed after they were linked. The preview still follows
  the Behavior Plan, not the source.”

## 23. Legacy disposition

| Legacy concern | Target disposition |
| --- | --- |
| Fixed C/WASM button/LED harness | Keep only as historical/regression evidence until default runtime retirement; not target architecture |
| TypeScript source interpreter | Remove from the default preview path after Behavior Plan parity |
| Protocol runtime | Preserve only if another explicit product surface still owns it; do not couple it to Behavior Preview |
| `useSimulationStore` engine/remote fields | Replace with preview status, logical cursor, snapshots, inputs, diagnostics, and timeline |
| Loose `pinStates` visual lookup | Replace with typed component visual projections |
| `simulation.run/stop/get_state` | Deprecate in favor of behavior tools |
| `firmware.compile` and `/api/compile` | Remove from recommended workflow and later registration/routes |
| `compiledArtifact` project field | Ignore/quarantine on migration; exclude from new canonical schema |
| `browser-toolchain` and `avr-runtime` | Leave dormant or archive in a separate cleanup decision; do not integrate |
| Native/remote engines | Out of scope |
| Web Serial/flashing | Out of scope |
| External SDK calls | Future separate RFC with explicit user authority |

Do not delete working legacy code impulsively. Introduce the new path, migrate
callers and data, prove release parity, then remove obsolete paths in focused
commits.

## 24. Operational release caveat

GitHub push and ChatGPT Site deployment are separate operations. The repository
currently persists a Sites project ID in `chatgpt-site/.openai/hosting.json`.
If the selected ChatGPT workspace cannot access that opaque ID, do not replace
it or create a duplicate Site silently. Switch to the owning workspace or obtain
explicit authorization for a new binding. See `docs/CHATGPT_SITE_RUNBOOK.md`.

This hosting caveat does not change the Behavior Preview architecture.

## 25. Final recommendation

Build the smallest complete authoring loop first:

```text
exact graph
  -> button/LED Behavior Plan
  -> validated typed actions
  -> deterministic visual preview
  -> normal agent-written editable code in Monaco
  -> copy/download for external hardware or SDK testing
```

Then add display, buzzer, relay, servo, motor, and sensor profiles through the
same registry and generic visual primitives.

Do not spend the next implementation cycle building a compiler or MCU emulator.
The product value is helping people and agents design the system, understand the
intended outcome, and iteratively prepare code for the environment where it will
actually be built and tested.
