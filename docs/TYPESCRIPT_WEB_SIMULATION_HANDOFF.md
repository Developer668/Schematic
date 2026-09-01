# TypeScript Web Simulation Handoff

Status: implementation handoff
Audience: agents and engineers extending Schematic's browser simulation
Last verified against repository: 2026-08-31
Primary objective: one TypeScript codebase that can compile supported firmware,
simulate supported hardware in the browser, and expose the same honest results to
the UI, WebMCP tools, and Site API.

This document records the repository facts, constraints, architectural decisions,
and acceptance gates needed to continue the work without rediscovering the system.
It is intentionally candid. A component being drawable, validatable, or present in
the catalog does not mean that it has executable behavior.

## 1. Executive truth

Schematic is already a useful hardware workspace, but it is not yet a general
microcontroller or circuit simulator.

The production ChatGPT Site currently has two execution paths:

1. A verified, precompiled C/WASM implementation of one fixed button-to-LED
   semantic contract, selected by a conservative source/graph recognizer.
2. A bounded TypeScript interpreter for a deliberately small Arduino-like subset.

The Site's HTTP simulation route invokes the same TypeScript interpreter on the
server. Calling it `remote` describes transport and isolation, not higher fidelity.
The Site's `firmware.compile` operation is preflight only and does not produce a
binary. The dormant compiler and AVR packages are architectural groundwork, not
production features.

The correct next vertical slice is:

`Arduino source -> browser AVR toolchain worker -> provenance-bound Intel HEX -> AVR8js Uno runtime -> graph-compiled GPIO nets -> explicit button and LED models -> deterministic events -> UI/WebMCP result`

Do not start by promising every board or every catalog part. Finish and verify that
vertical slice first, then extend one target and one device model at a time.

## 2. Capability truth table

| Claim | Current truth | Safe wording |
| --- | --- | --- |
| Hardware graph editing | Production | Components, typed ports, connections, and project files can be edited in the browser. |
| Graph validation | Production, bounded | Schematic detects supported structural, power-domain, and protocol metadata problems. |
| Arbitrary Arduino/C++ compilation | Not available | Compilation is preflight-only except for checked-in verified artifacts. |
| Exact button-to-LED C contract | Production, narrow | A recognizer can select one fixed precompiled C/WASM implementation; the matched sketch itself is not compiled or executed as WASM. |
| Arduino-like behavioral execution | Production, bounded | Supported statements and APIs run through a deterministic TypeScript interpreter. |
| Remote simulation | Same interpreter over HTTP | Remote execution provides transport/isolation, not a second physics or MCU engine. |
| AVR instruction execution | Dormant scaffold | The repository contains an unconnected AVR8js adapter; production does not import it. |
| ESP32 CPU emulation | Not available | ESP32-family targets may use bounded behavioral interpretation only. |
| I2C devices | Partial | DS3231 reads and SSD1306 text capture have explicit behavioral models; most devices are trace/validation only. |
| SPI devices | Trace-level | Transactions are recorded; device responses and timing are not modeled. |
| UART | Minimal | Serial output and a scalar RX byte are modeled without baud, framing, buffering, or timing. |
| Analog/electrical physics | Not available | Voltage metadata is validated; there is no nodal, SPICE, current, thermal, RF, or signal-integrity solver. |
| Catalog coverage | Mostly visual/validation | Placement in the catalog is not evidence of simulation support. |

Phase 0 must make every user-visible capability response return machine-readable
fidelity, engine, verification evidence, and unsupported-feature fields. The
current `RuntimeResult` has engine and unsupported data but does not yet carry
explicit fidelity or verification fields. Never infer a stronger claim from a
successful HTTP status.

## 3. Current production topology

The canonical production path is:

```text
ChatGPT in-app browser
  -> chatgpt-site Vinext wrapper
  -> shared React frontend
  -> Zustand project stores
  -> active frontend-local project graph and firmware workspace
  -> 42 WebMCP tool callbacks and human UI actions
  -> browser runtime or same-origin Site API
```

Important boundaries:

- `chatgpt-site/` is the production Site wrapper.
- `frontend/` contains the shared application, stores, WebMCP registry, current
  behavioral runtime, and presentation.
- `functions/api/_runtime.ts` supplies the same-origin Site API implementation.
- `packages/hardware-graph/` owns the stricter intended canonical graph contracts,
  but production frontend state still uses a separate loose `HardwareGraph` shape
  and the Site API performs its own normalization.
- `packages/browser-toolchain/` contains a dormant browser compiler abstraction.
- `packages/avr-runtime/` contains a dormant structural AVR8js adapter.
- `packages/firmware-harness/` owns the checked-in exact C/WASM harness.
- `backend/` and vendored Velxio/Renode material are reference paths, not the Site
  runtime.

The React Flow canvas is a view of the graph. It must never become the source of
truth. Human UI commands and WebMCP commands must continue to call the same store
actions and therefore mutate the same active frontend state. Unifying that state
with the shared `HardwareProject` contract is a prerequisite of the target
architecture, not a completed production boundary.

## 4. Current simulation engines

### 4.1 Exact portable C/WASM harness

Relevant files:

- `frontend/src/simulation/portableHarness.ts`
- `packages/firmware-harness/generated/button-led.wasm`
- `packages/firmware-harness/`

Properties:

- The artifact is checked in, hash-verified, 400 bytes, and uses ABI v2.
- It implements one fixed button-input to LED-output semantic contract whose C
  source lives in `packages/firmware-harness/firmware/src/button_led.c`.
- A narrow source and graph recognizer decides whether that fixed implementation
  applies.
- Pressed and released runs resolve actual component/board endpoints.
- The user's source bytes are never passed to the WASM module. Matching source is
  eligibility input, not code compiled or interpreted by this path.
- An optional recognized `delay(n)` affects eligibility only; execution step count
  is derived from requested duration, so this path does not preserve matched
  source-level timing.
- This is not an on-demand compiler and does not generalize to arbitrary source.
- The source-only ESP32 Arduino export is not an ESP32 binary or emulator.

Preserve this path as a golden conformance fixture even after the AVR path lands.
It is valuable because it proves that deterministic virtual I/O can cross the
graph/runtime boundary with a verified artifact.

### 4.2 TypeScript behavioral interpreter

Relevant files:

- `frontend/src/simulation/runtime.ts`
- `frontend/src/simulation/protocolRuntime.ts`
- `frontend/src/simulation/modelContract.ts`
- `frontend/src/simulation/capabilityRegistry.ts`

The interpreter is intentionally fail-closed. It recognizes a small source subset,
executes supported operations, and reports unknown APIs rather than pretending they
worked.

Supported or partially supported behavior includes:

- `setup()` and `loop()` extraction;
- simple numeric and boolean variables;
- simple `#define` and constant values;
- assignments, comparisons, basic arithmetic, ternaries, and bounded safe math;
- `if`/`else` control flow;
- `pinMode` as a no-op; GPIO reads/writes; ADC reads; PWM writes; `delay`; and only
  the three-argument `tone(pin, frequency, duration)` form;
- the finite `Wire`, `SPI`, and `Serial` method set declared by
  `SUPPORTED_PROTOCOL_APIS`; `Wire.begin` and `Serial.begin` are accepted no-ops;
- graph-aware input/output resolution;
- explicit protocol traces, validation summaries, unsupported APIs, and target
  issues.

The following are not a supported language/runtime surface:

- `for`, `while`, `do`, or `switch` execution;
- arbitrary functions beyond `setup` and `loop`;
- classes, structs, templates, pointers, arrays, callbacks, or lambdas;
- a real preprocessor, header/include system, libraries, linking, or type checking;
- interrupts, tasks, RTOS behavior, concurrency, timers, or peripheral registers;
- dynamic allocation or faithful C/C++ integer/overflow semantics.

Implementation limits and heuristics that future work must not hide:

- Parsing is based on bounded string/regular-expression logic, not a C++ AST.
- Expression recursion is capped at 12 levels.
- Statement execution is capped at 20,000 per firmware target, and loop iterations
  have a separate 20,000 maximum.
- Requested duration is capped at 86,400,000 ms.
- A loop generally needs cursor advancement such as `delay`; a no-delay loop can
  execute once and stop instead of behaving like an MCU's infinite main loop.
- Active-low button semantics can be inferred from names such as `pressed` or
  `button`.
- ADC and sensor conversions use deterministic heuristics, not electrical models.
- Controller voltage may be inferred from controller IDs.
- PWM duty can map to a generic 0-180 actuator angle.
- Every run rebuilds state synchronously. There is no persistent live scheduler.
- Multiple firmware targets execute sequentially into shared result structures;
  they are not concurrent processors.

These limitations are acceptable for the current `behavioral` fidelity label. They
are not acceptable under `engine-backed`, `compiled`, `cycle-accurate`, or
`electrical` labels.

### 4.3 Protocol behavior

Current protocol behavior is useful but narrow:

- GPIO: graph-resolved digital inputs and outputs.
- ADC: deterministic source heuristics; no impedance, noise, or sampling circuit.
- PWM: duty-level behavior; no timer/channel fidelity.
- I2C: address/transaction traces, a behavioral DS3231 read model, and SSD1306 text
  capture.
- DS3231 writes: warned about or ignored; register-complete RTC behavior is absent.
- SSD1306: printable payload capture, not command decoding, pixels, bus timing, or
  controller state.
- SPI: trace and validation; reads return a neutral value without device response
  models.
- Serial/UART: basic output and one scalar RX value; no baud, frames, queues,
  overrun, or clocked transport.

Power and connectivity are inferred from topology, port metadata, and naming. The
runtime does not solve Kirchhoff's laws and does not model pull-up resistance,
contention over time, current draw, regulator behavior, brownout, heat, RF, or
mechanics.

### 4.4 Same-origin HTTP runtime

Relevant files:

- `chatgpt-site/app/api/[[...path]]/route.ts`
- `functions/api/_runtime.ts`

The route imports the frontend interpreter and invokes `runFirmwareRuntime`.
Therefore:

- browser and HTTP results should remain contract-compatible;
- direct HTTP execution never selects the portable C/WASM harness; WebMCP selects
  that harness locally first when its exact recognizer matches;
- `runtime: "remote"` means the operation crossed the Site API boundary;
- it must not be described as more accurate than the browser path;
- API sessions are held in a module-global in-memory map capped at 128 entries;
- sessions are not durable, globally coordinated, or a persistent simulation
  process and can reset or be evicted per Worker instance;
- raw WebSocket simulation is not available on the Site.

### 4.5 Compile preflight

`functions/api/_runtime.ts` checks the target binding/profile, source-size limits,
balanced delimiters, and the presence of an `.ino` file. It does not check or
compile `setup()`/`loop()` entrypoints. The separate validator emits regex-based
entrypoint warnings, which are not compiler diagnostics. The API response truthfully
reports that no binary compiler is configured.

Do not turn that result into a synthetic artifact, success toast, or `compiled`
state. A compile operation is successful only when an approved toolchain returns a
valid artifact whose bytes and provenance are verified.

## 5. Capability models and catalog coverage

The model contract uses four support levels:

```ts
type SimulationSupport =
  | "visual"
  | "validation"
  | "behavioral"
  | "engine-backed";
```

Interpret them literally:

- `visual`: drawable only;
- `validation`: graph/metadata rules only;
- `behavioral`: explicit deterministic high-level model, possibly heuristic;
- `engine-backed`: execution by a declared compiled/CPU/device engine with tested
  fidelity bounds.

The current registry grants behavioral support to a small explicit set, including
common Uno/Nano, ESP32 DevKit, and Pico-family boards; button/switch/PIR inputs;
several LEDs; a generic buzzer; servo-like PWM actuators; selected ADC sources;
DS3231; and SSD1306 variants. For boards, `behavioral` means the source interpreter
can handle supported code. It does not mean that the board CPU is emulated.

Most catalog entries are visual or validation-only. Current behavioral support is
mostly granted by conservative exact definition-ID allowlists, while category,
text, tags, and ports can classify non-executable families. Two current exceptions
matter: generic GPIO execution propagates values across connected nets without
requiring a device adapter, and the portable harness recognizes button/LED roles
with definition/title patterns. Requiring an explicit tested adapter/model ID for
every executable catalog device is a target-architecture rule, not current truth.
Catalog search results should show support state throughout the migration.

Known contract risk: simulation contract shapes exist in both
`packages/hardware-graph/src/types.ts` and frontend simulation code, with the
frontend carrying adapter data that can drift from the package definition. The
shared contracts package described below must eliminate that duplication.

## 6. What graph validation does and does not prove

Current validation covers supported structural rules such as:

- missing definitions and ports;
- incompatible port domains;
- output-to-output and input-to-input conflicts;
- nominal/max voltage metadata;
- project-wide presence of at least one connected ground net and one connected
  power net, not per-component power correctness;
- I2C address collisions and pull-up metadata;
- UART TX-to-TX conflicts;
- USB host-to-host and PCIe endpoint-to-endpoint conflicts;
- RF impedance metadata.

Firmware validation is currently brace/entrypoint-level, not C++ compilation.

A valid graph does not prove:

- that a circuit is physically safe;
- that voltage propagates correctly through regulators and rails;
- that current budgets, resistor values, or pull-ups are adequate;
- that analog behavior converges;
- that a library exists or firmware compiles;
- that timing, interrupts, or peripherals behave like real silicon.

Keep three distinct concepts in contracts and UI:

1. `graphValidation`: structural and metadata diagnostics.
2. `firmwareCompilation`: compiler diagnostics and artifact production.
3. `simulationExecution`: runtime/device events with declared fidelity.

Never collapse them into a single green `valid` or `supported` indicator.

Today validation does not gate execution: Studio validates and then still runs, and
WebMCP attaches validation data without blocking the runtime. A runtime result can
therefore say `status: "completed"` while `validation.valid` is false. Result v2
must preserve these as separate dimensions rather than treating runtime completion
as graph approval.

## 7. Dormant foundations

### 7.1 Browser toolchain package

`packages/browser-toolchain/` already provides useful seams:

- `BrowserCompiler` and `CompilerManager` abstractions;
- worker messages and progress;
- cancellation and timeouts;
- target pinning;
- source and artifact SHA-256;
- Intel HEX validation;
- manifests, licensing metadata, and verified asset loading;
- artifact provenance.

It is not imported by the production frontend or Site runtime.

An assessed candidate, `@horang-corp/avr-gcc-wasm@0.2.0`, is not installed or
approved. The feasibility notes estimate roughly 55 MB unpacked and identify
GPLv3 compiler/binutils obligations. Before checking in, downloading, caching, or
shipping compiler assets, an owner must approve:

- toolchain and core versions;
- exact upstream source and checksums;
- license and source-offer obligations;
- NOTICE updates;
- asset size, cold-start, memory, and caching budgets;
- reproducibility and supply-chain policy.

Do not silently fetch mutable compiler binaries from a CDN.

### 7.2 AVR runtime package

`packages/avr-runtime/` defines and unit-tests the artifact, pin, stepping,
cancellation, and event boundary of an Uno CPU/GPIO adapter against fake structural
CPU and port implementations. The fake instruction callback increments cycles; it
does not establish real AVR instruction or GPIO conformance.

It is not connected to production, and `avr8js` is not currently an installed
runtime dependency. Real AVR behavior remains unverified until an exact AVR8js
version is pinned and tested. The current artifact-like input also accepts an
optional target FQBN without rejecting a mismatched target, so target-provenance
enforcement is unfinished. The intended adapter surface covers CPU/GPIO only;
timers, interrupts, UART, ADC, PWM timer channels, and I2C/SPI peripheral hooks are
not a finished engine. Its synchronous run loop checks cancellation once per
instruction; hard budgets and termination require the future Worker orchestrator.

Treat this package as a tested starting boundary, not a completed emulator.

### 7.3 Architecture islands

`frontend/src/simulation/SimulationEngine.ts` and `bridges.ts` express helpful
adapter ideas but are mostly separate from the interpreter that actually runs.
The migration should consolidate them behind one runtime contract rather than add a
third parallel abstraction.

## 8. Root causes preventing one coherent web simulator

The main problems are architectural, not a missing `simulate()` function:

1. Graph, firmware, capability, artifact, and runtime contracts are spread across
   packages and frontend-local definitions.
2. The active interpreter and dormant compiled path do not share a single runtime
   lifecycle.
3. There is no graph compiler that turns connections into stable nets, board pin
   bindings, bus instances, and device model instances.
4. There is no deterministic discrete-event scheduler shared by CPUs and devices.
5. Exact ID allowlists are conservative, but generic-net GPIO and fuzzy portable
   harness role recognition bypass a universal versioned device-model gate.
6. Compilation artifacts are not connected end-to-end to project source identity,
   target identity, emulator loading, and stale-artifact rejection.
7. Worker isolation is designed but not production-wired, so large compile/runtime
   work would block the UI if added naively.
8. Server normalization drops fields that are not needed by the current interpreter,
   increasing schema-drift risk for a future artifact-backed path.
9. The UI, API, and WebMCP vocabulary can overstate preflight, validation, or
   behavioral success.
10. Most parts lack executable device models, and no electrical solver exists.

## 9. Target TypeScript architecture

Keep the monorepo and implement the following dependency direction. Arrows below
mean “imports/depends on”:

```text
@schematic/hardware-graph                    (canonical graph foundation)
@schematic/simulation-contracts
  -> @schematic/hardware-graph
@schematic/graph-compiler
  -> @schematic/hardware-graph
  -> @schematic/simulation-contracts
@schematic/device-models
  -> @schematic/simulation-contracts
@schematic/runtime-core
  -> graph-compiler + device-models + simulation-contracts
@schematic/avr-runtime
  -> runtime-core + simulation-contracts
@schematic/behavioral-runtime
  -> runtime-core + simulation-contracts
frontend worker clients
  -> the runtime/compiler packages above
frontend stores + WebMCP + Site API adapters
  -> worker clients + simulation-contracts
React presentation
  -> frontend stores only
```

No package below the UI layer may import React, Zustand, React Flow, DOM nodes, or
WebMCP host globals. Runtime-core should use platform-neutral TypeScript plus
explicit injected clock/worker/storage adapters. The browser should be the primary
execution environment; optional remote engines implement the same contracts.

### 9.1 Shared contracts package

Create `packages/simulation-contracts/` and make it the only owner of:

- runtime IDs and versions;
- runtime-facing compiled artifact references and provenance evidence;
- graph compilation output contracts;
- capabilities and fidelity claims;
- runtime commands, events, results, snapshots, and diagnostics;
- device adapter identities and versions;
- deterministic seeds and time units;
- worker request/response envelopes.

Keep durable project, firmware-target, and compiled-artifact cache fields in
`@schematic/hardware-graph` unless an explicit project-schema migration moves them.
`@schematic/simulation-contracts` imports the foundational `HardwareProject` type;
the graph package must not import simulation contracts back.

Suggested baseline:

```ts
export type SimulationFidelity =
  | "validation"
  | "behavioral"
  | "instruction"
  | "electrical";

export interface VerificationEvidence {
  basis: "fixture" | "cross-engine" | "reference-emulator" | "physical-capture";
  fixtureIds: readonly string[];
  verifierVersion: string;
  artifactSha256?: string;
  toolchainManifestSha256?: string;
  releaseId?: string;
  verifiedAt?: string;
}

export interface EngineDescriptor {
  id: string;
  version: string;
  fidelity: SimulationFidelity;
  targetIds: readonly string[];
  limitations: readonly string[];
  verification: readonly VerificationEvidence[];
}

export interface FirmwareArtifactRef {
  format: "intel-hex" | "wasm-module";
  artifactSha256: string;
  sourceSha256: string;
  targetDefinitionId: string;
  fqbn: string;
  compilerId: string;
  compilerVersion: string;
  coreVersion: string;
  libraryLockSha256: string;
}

export interface SimulationRequest {
  schemaVersion: 2;
  graph: HardwareProject;
  firmware: readonly FirmwareTargetInput[];
  durationNs: bigint;
  seed: string;
  requestedEngine?: string;
  allowFallback: boolean;
}

export interface SimulationRequestWire
  extends Omit<SimulationRequest, "durationNs"> {
  durationNs: string;
}

export interface RunProvenance {
  artifactSha256?: string;
  inputGraphSha256: string;
  // Required only for engines that consume a canonical compiled graph.
  // Phase 0 behavioral runs do not invent this value from their ephemeral DSU.
  compiledGraphSha256?: string;
  deviceModels: readonly { adapterId: string; version: string }[];
  seed: string;
  requestSha256: string;
}

export interface SimulationResultBase {
  schemaVersion: 2;
  runId: string;
  requestedEngine?: string;
  selectedEngine?: EngineDescriptor;
  fallback?: { permitted: boolean; reason: string };
  simulatedUntilNs: bigint;
  graphDiagnostics: readonly SimulationDiagnostic[];
  compilerDiagnostics: readonly SimulationDiagnostic[];
  runtimeDiagnostics: readonly SimulationDiagnostic[];
  unsupported: readonly UnsupportedCapability[];
}

export interface SimulationCompletedResult extends SimulationResultBase {
  status: "completed" | "partial";
  selectedEngine: EngineDescriptor;
  provenance: RunProvenance;
  events: readonly RuntimeEvent[];
  finalSnapshot: SimulationSnapshot;
}

export interface SimulationStoppedResult extends SimulationResultBase {
  status: "invalid" | "failed" | "cancelled";
  events?: readonly RuntimeEvent[];
  lastSnapshot?: SimulationSnapshot;
}

export type SimulationResult =
  | SimulationCompletedResult
  | SimulationStoppedResult;

export type JsonWire<T> =
  T extends bigint ? string
    : T extends Uint8Array ? string
      : T extends readonly (infer U)[] ? readonly JsonWire<U>[]
        : T extends object ? { [K in keyof T]: JsonWire<T[K]> }
          : T;

export type SimulationResultWire = JsonWire<SimulationResult>;
export type SimulationSnapshotWire = JsonWire<SimulationSnapshot>;
export type RuntimeCommandWire = JsonWire<RuntimeCommand>;
export type RuntimeAckWire = JsonWire<RuntimeAck>;
export type CapabilityRequestWire = JsonWire<CapabilityRequest>;
export type CapabilityResponseWire = JsonWire<CapabilityResponse>;
export type CompileRequestWire = JsonWire<CompileRequest>;
export type CompileResultWire = JsonWire<CompileResult>;
export type SimulationRunHandleWire = JsonWire<SimulationRunHandle>;
```

Use separate domain models and wire DTOs. JSON transport cannot serialize `bigint`
or `Map`; Worker/API envelopes encode nanoseconds as canonical decimal strings and
use schema-validated sorted arrays/records. `Uint8Array` fields use an explicitly
named base64 encoding in the wire schema. Explicit, tested codecs convert every
request, result, snapshot, event, command, acknowledgement, capability response,
compile response, and artifact payload to/from internal `bigint`, bytes, and
derived indexes. Conditional aliases above show intent; runtime schemas/codecs are
still mandatory because TypeScript types do not validate input. Never hash raw
`Map` iteration or an unvalidated JSON object.

### 9.2 Deterministic graph compiler

Create `packages/graph-compiler/` with a pure function:

```ts
export interface CompiledGraph {
  graphSha256: string;
  components: ReadonlyMap<string, CompiledComponent>;
  nets: ReadonlyMap<string, CompiledNet>;
  boardBindings: readonly BoardBinding[];
  buses: readonly CompiledBus[];
  devices: readonly DeviceInstanceSpec[];
  diagnostics: readonly SimulationDiagnostic[];
}

export function compileHardwareGraph(
  graph: HardwareProject,
  registry: DeviceModelManifest,
): CompiledGraph;
```

`CompiledGraph` above is an internal domain structure. Define a separate
`CompiledGraphWire` using sorted arrays/records for canonical hashing, persistence,
workers, and APIs; build `ReadonlyMap` indexes only after decoding and validation.

Requirements:

- stable ordering independent of object insertion order;
- stable IDs derived from canonical graph content where appropriate;
- union-find or equivalent net construction;
- explicit board-pin-to-net bindings;
- separate digital, analog, power, I2C, SPI, UART, USB, PCIe, and RF domains;
- validation diagnostics without mutating the input graph;
- no title/tag heuristics for executable adapters;
- graph hash included in snapshots and run identity, not ordinary compiler-artifact
  identity;
- golden fixtures for every supported topology.

### 9.3 Toolchain worker

Compilation must run in a dedicated Web Worker with an explicit state machine:

```text
idle -> loading-assets -> preparing -> compiling -> linking -> validating
     -> completed | failed | cancelled | timed-out
```

Required controls:

- approved immutable manifest and SHA-256 for every fetched asset;
- origin allowlist and no arbitrary compiler URLs;
- size and memory ceilings;
- cancellation and hard timeout;
- progress events that do not imply success;
- source tree canonicalization before hashing;
- exact FQBN, core, compiler, and library lock in provenance;
- Intel HEX parse/shape/flash-size validation;
- cache by the full provenance key, never source hash alone;
- stale artifact rejection when source, target, compiler, core, libraries, or other
  actual build inputs change;
- worker crash recovery without corrupting project state.

The UI may persist artifacts, but artifacts are caches. Source plus target/toolchain
identity remains canonical. Bind a simulation run—not the compiler artifact—to the
artifact SHA, compiled-graph SHA, device-model versions, and deterministic seed.
Only invalidate compilation for a graph edit when graph-derived data is an explicit
build input included in provenance.

### 9.4 MCU runtime contract

Use one adapter per engine/target family, not one adapter per component:

```ts
export interface McuRuntime {
  readonly descriptor: EngineDescriptor;
  load(input: {
    artifact: FirmwareArtifactRef;
    bytes: Uint8Array;
    board: BoardBinding;
  }): Promise<void>;
  reset(seed: string): void;
  runUntil(deadlineNs: bigint, scheduler: EventScheduler): RuntimeSlice;
  setDigitalInput(pin: string, value: 0 | 1, atNs: bigint): void;
  setAnalogInput(pin: string, microvolts: bigint, atNs: bigint): void;
  snapshot(): McuSnapshot;
  dispose(): void;
}
```

For Uno v1, support only what is demonstrably wired:

- ATmega328P instruction stepping;
- Uno digital pins mapped to AVR ports B/C/D;
- reset and deterministic cycle count;
- external digital input injection;
- digital output change events;
- bounded cancellation and worker termination.

Do not label timers, interrupts, UART, ADC, PWM, I2C, or SPI as supported until
their AVR peripheral hooks and conformance tests exist.

### 9.5 Discrete-event scheduler

Runtime-core needs a deterministic scheduler shared by MCUs and device models:

```ts
export interface ScheduledEvent {
  timeNs: bigint;
  priority: number;
  sequence: bigint;
  sourceId: string;
  kind: string;
  payload: unknown;
}

export interface EventScheduler {
  readonly nowNs: bigint;
  schedule(event: Omit<ScheduledEvent, "sequence">): bigint;
  cancel(sequence: bigint): boolean;
  runUntil(deadlineNs: bigint, budget: ExecutionBudget): SchedulerResult;
}
```

Ordering must be `(timeNs, priority, sequence)` with a monotonic sequence as the
final tie-breaker. Never use wall-clock time or JavaScript timer ordering to define
simulation results. Wall time is only for cancellation, progress, and performance
budgets.

Guardrails:

- maximum queued events;
- maximum events per simulated interval;
- maximum instructions per slice;
- cancellation checks;
- zero-time feedback-loop detection;
- deterministic seeded randomness only;
- snapshot size limits;
- explicit `budget-exceeded` diagnostics.

### 9.6 Device model registry

Every executable model must be explicit and versioned:

```ts
export interface DeviceModel<TState = unknown> {
  readonly manifest: DeviceModelEntry;
  create(context: DeviceContext): DeviceInstance<TState>;
}

export interface DeviceModelEntry {
  adapterId: string;
  version: string;
  definitionIds: readonly string[];
  fidelity: "behavioral" | "instruction" | "electrical";
  requiredPorts: readonly PortRequirement[];
  supportedOperations: readonly string[];
  limitations: readonly string[];
  fixtureIds: readonly string[];
}
```

Rules:

- A catalog definition is executable only when listed in a tested manifest.
- Aliases are explicit definition IDs, not fuzzy title matches.
- Model versions are included in result provenance and snapshots.
- Device state is serializable and deterministic.
- Unsupported register/command behavior yields a diagnostic, not a guessed result.
- Bus ownership and addressing are compiled from the graph.
- Each model ships golden test vectors and at least one end-to-end graph fixture.

Initial device sequence:

1. pushbutton;
2. single digital LED;
3. UART console after AVR UART support;
4. DS3231 register model after AVR I2C support;
5. SSD1306 command/framebuffer model after AVR I2C support;
6. PWM servo after AVR timer/PWM support.

### 9.7 Behavioral compatibility adapter

Do not delete the current interpreter. Wrap it behind the same runtime result
contract as `@schematic/behavioral-runtime`.

It should remain the bounded fallback when:

- no compiler is installed/approved;
- the target family has no instruction engine;
- the user explicitly chooses fast behavioral execution.

Its result must preserve `behavioral` fidelity and surface every unsupported API.
It must not consume a compiled artifact or inherit verification evidence merely
because another engine exists in the repository.

Model the fixed C/WASM harness as a separate `portable-contract` engine. Current
WebMCP orchestration selects it before the interpreter when the exact recognizer
matches and fails closed if its verified artifact cannot load; do not silently
downgrade that selected path to the interpreter.

### 9.8 Runtime orchestrator

The orchestrator selects an engine by an explicit capability intersection:

```text
requested target
  intersect compiler target support
  intersect available artifact provenance
  intersect MCU runtime support
  intersect graph/device model support
  intersect requested features
```

If the intersection is empty, return an actionable unsupported matrix. Do not
silently downgrade from instruction execution to behavioral execution unless the
request explicitly permits fallback. If fallback is permitted, record both the
requested and selected engine plus the downgrade reason.

### 9.9 UI, WebMCP, and Site API

All surfaces consume the same command/result contracts:

- React displays capabilities and diagnostics but does not calculate runtime truth.
- Zustand stores run references, progress, and snapshots but does not become the
  engine.
- WebMCP tools invoke the same actions as the UI and return structured fidelity and
  unsupported data.
- The Site API validates auth/ownership and delegates to the same orchestrator or
  an implementation of its remote backend contract.
- A remote backend never becomes the canonical project store.

Suggested backend boundary:

```ts
export interface SimulationBackend {
  capabilities(request: CapabilityRequestWire): Promise<CapabilityResponseWire>;
  compile(request: CompileRequestWire): Promise<CompileResultWire>;
  start(request: SimulationRequestWire): Promise<SimulationRunHandleWire>;
  command(runId: string, command: RuntimeCommandWire): Promise<RuntimeAckWire>;
  snapshot(runId: string): Promise<SimulationSnapshotWire>;
  stop(runId: string): Promise<void>;
}
```

This is the transport boundary. Decode immediately into domain types inside the
browser worker or server, and encode on return. Implement
`BrowserSimulationBackend` first. A future remote backend must pass the same wire
schema, codec, and semantic contract suites.

## 10. Canonical state and persistence

Canonical durable state:

- project metadata;
- the shared `HardwareProject` after Phase 0 migration (today the active frontend
  still uses its local `HardwareGraph` shape);
- firmware source files;
- explicit target bindings;
- user-selected engine/fidelity preferences;
- lockfile-like compiler/core/library selections where approved.

Derived or cache state:

- compiled graph;
- compiler artifacts;
- runtime instances;
- event streams;
- snapshots;
- visualization state;
- server session IDs.

Project import/export should version canonical data. If artifacts are exported,
mark them optional caches and verify every hash/provenance field before reuse. Never
trust imported verification claims; derive structured evidence from checked hashes,
fixtures, verifier versions, and release/toolchain identity.

Server normalization currently narrows project data for the behavioral API. Replace
ad hoc double casts with a versioned boundary parser. Legacy normalization belongs
only at import/API boundaries; internal code should use the canonical type.

## 11. Security, supply-chain, and licensing constraints

Browser compilers and emulators process untrusted source and graphs. Apply:

- dedicated workers and termination on budget breach;
- no `eval`, `Function`, or shell execution in the browser runtime;
- immutable asset URLs plus checksums;
- content-length and streamed-size limits;
- bounded source, graph, artifact, trace, and snapshot sizes;
- authenticated ownership checks for every remote run/session;
- per-owner quotas and TTL eviction rather than one cross-tenant global cap;
- no secrets in `VITE_*`, project exports, WebMCP payloads, or compiler manifests;
- CSP-compatible worker and WASM loading;
- explicit license review and NOTICE/source-offer updates before shipping GCC assets.

Do not treat a Web Worker as a security sandbox. It protects UI responsiveness and
limits accidental state access; hostile compiler binaries or dependencies still
require supply-chain controls.

## 12. Performance budgets

Set measurable budgets before adding large assets:

- initial Studio route must not preload compiler/emulator assets;
- compiler and MCU engine load only after user intent or an agent tool request;
- compile and runtime workers must never block the main thread;
- progress heartbeat at least every few seconds during long compile work;
- hard compile timeout and memory ceiling;
- bounded event/trace retention with summarized overflow;
- reusable immutable compiler assets in browser cache;
- cache invalidation by manifest hash;
- dispose workers and runtime instances on project switch or stop.

The catalog and WebMCP modules are already substantial. Do not add toolchains to the
main frontend chunk.

## 13. Migration plan

### Phase 0: contracts and truthful claims

Deliverables:

- create `@schematic/simulation-contracts`;
- move/deduplicate capability and artifact contracts;
- introduce result v2 with fidelity, engine, verification, limitations, and
  unsupported fields;
- wrap the behavioral interpreter without changing behavior;
- add an architecture decision record for browser-first execution;
- update UI/WebMCP vocabulary so preflight, validation, behavior, and compilation
  cannot be confused.

Acceptance:

- existing behavioral fixtures are byte-for-byte or semantically stable;
- every completed result hashes the canonical input graph; behavioral results omit
  `compiledGraphSha256` until a canonical graph compiler exists;
- browser and Site HTTP results pass one contract suite;
- no production code claims binary compilation;
- no package imports frontend/UI code from a lower layer.

### Phase 1: approve and wire the Uno compiler

Deliverables:

- owner-approved AVR compiler/core assets, checksums, licenses, and NOTICE changes;
- browser toolchain worker connected to `CompilerManager`;
- exact Arduino Uno FQBN only;
- compile progress, cancellation, timeout, diagnostics, and cache;
- artifact provenance persisted as a derived cache;
- stale artifact rejection.

Acceptance:

- Blink and button/LED sketches compile from user source in a clean browser;
- identical inputs produce identical artifact hashes under the pinned toolchain;
- malformed source returns real compiler diagnostics;
- no toolchain bytes load on landing or ordinary graph editing;
- forced worker crash/cancel/timeout leaves project source intact.

### Phase 2: Uno CPU plus GPIO vertical slice

Deliverables:

- install/pin AVR8js after dependency review;
- load only verified Intel HEX;
- graph compiler for Uno digital pins and simple nets;
- canonical compiled-graph hashing, required in instruction-engine provenance;
- deterministic scheduler;
- button input and LED output device models;
- runtime worker and orchestrator;
- UI/WebMCP selection of `instruction` fidelity.

Acceptance:

- a user-authored compiled, explicitly delay-free button-to-LED sketch changes the
  graph LED state;
- pressed/released static GPIO results match the exact portable harness fixture;
- pin mapping is tested for all Uno digital pins;
- two identical runs yield identical events and snapshot hashes;
- unsupported peripherals are listed explicitly;
- cancellation and budgets terminate infinite firmware safely.

Do not use Arduino `delay()` as a Phase 2 acceptance requirement. Real `delay()`
depends on Timer0/interrupt progress, which belongs to Phase 3 unless minimal Timer0
support is deliberately moved forward with its own conformance tests.

### Phase 3: clocks, timers, interrupts, UART

Deliverables:

- calibrated AVR cycle-to-simulated-time mapping;
- timer/interrupt peripheral setup;
- UART TX/RX queues and console device;
- delay/timing tests;
- snapshot/restore of new state.

Acceptance:

- timer and interrupt fixtures match documented AVR8js/reference behavior;
- UART ordering and baud-limited timing are deterministic;
- overflow/unsupported configurations produce diagnostics;
- no claim extends beyond configured peripherals.

### Phase 4: I2C devices

Deliverables:

- AVR I2C/TWI hooks;
- bus arbitration/address lifecycle appropriate to declared fidelity;
- register-complete bounded DS3231 model;
- SSD1306 command parser and framebuffer model;
- migration of behavioral fixtures to shared device tests.

Acceptance:

- known sketches read/write supported DS3231 registers;
- known SSD1306 sketch produces a stable framebuffer snapshot;
- unknown commands/registers are traceable and fail honestly;
- address collision diagnostics remain consistent with graph validation.

### Phase 5: expand deliberately

Add devices only through explicit manifests and fixtures. Add another MCU family only
after toolchain, emulator, peripheral, licensing, size, and conformance decisions are
documented. ESP32 CPU emulation is not a small extension of the AVR work; keep the
behavioral path until a credible engine exists.

### Phase 6: optional specialized remote engines

Analog/SPICE, RF, thermal, mechanical, Renode, or hardware-in-the-loop backends may
be remote implementations. They must receive canonical graph/source inputs and
return the shared result contract. They do not own or mutate canonical project state.

## 14. Test strategy

### Unit tests

- canonical serialization and hashes;
- graph net construction and stable ordering;
- scheduler ordering, cancellation, zero-time loops, and budgets;
- compiler manifest/hash validation;
- Intel HEX validation and target size;
- artifact staleness;
- pin mappings;
- each device register/command/state transition;
- capability intersection and fallback policy.

### Golden fixtures

Version fixtures with:

- graph;
- source;
- toolchain lock/provenance;
- expected compile diagnostics/hash when legally reproducible;
- input event sequence;
- expected runtime events;
- expected final snapshot hash;
- declared engine/fidelity/limitations.

Keep the exact C/WASM button-to-LED fixture as a cross-engine oracle.

### Contract tests

Run identical suites against:

- behavioral backend;
- browser compiled/AVR backend;
- Site HTTP backend;
- any future remote backend.

Contract tests must verify error shapes and unsupported reporting, not just success.

### End-to-end tests

- edit firmware -> compile -> run -> graph state changes;
- source edit invalidates artifact;
- target/board change invalidates artifact;
- project switch disposes run;
- reload restores source but not a falsely live runtime;
- WebMCP and UI produce equivalent commands/results;
- large/infinite input is bounded;
- offline cached approved toolchain behavior is understood and tested.

### Reference validation

For instruction/peripheral features, compare stable fixtures with at least one of:

- documented AVR8js behavior;
- a pinned native AVR toolchain/emulator in CI;
- physical Uno capture for externally visible pin/timing behavior.

Record tolerance and sampling rules. Do not call a model `verified` because it passes
its own implementation's tests.

## 15. Release and CI gates

The current root release gate is `pnpm run verify` plus `git diff --check`. Expand it
with simulation-specific jobs:

1. contract/type boundary checks;
2. compiler manifest and asset checksum verification;
3. deterministic compile fixture hashes;
4. runtime golden fixtures;
5. worker cancellation/budget tests;
6. Site/browser contract parity;
7. bundle-route checks proving toolchain chunks are lazy;
8. dependency/license and NOTICE checks;
9. clean-checkout build with no network beyond declared package/assets policy.

Do not use `--passWithNoTests` as evidence that a simulation package is verified.

## 16. Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Compiler asset licensing is incomplete | Cannot legally ship | Owner approval, pinned source, NOTICE/source obligations before integration |
| Toolchain adds tens of MB | Slow cold start and memory pressure | Lazy worker chunks, immutable cache, strict budgets, Uno-only first |
| JS/WASM worker hangs | Frozen or exhausted browser | Timeouts, cancellation, instruction/event budgets, worker termination |
| Artifact/source drift | Wrong firmware executes | Full provenance key and stale rejection |
| Contract duplication | Browser/API disagree | One shared contracts package and cross-backend tests |
| Fuzzy model inference overclaims support | Incorrect simulation result | Explicit manifest IDs only |
| AVR peripheral gaps are marketed as MCU fidelity | Misleading product behavior | Feature-level capability manifest and limitations in every result |
| Event order differs by browser | Nondeterministic tests/results | Bigint simulated time and stable sequence tie-breaker |
| Trace/snapshot growth | Memory exhaustion | Retention caps, summaries, streaming, backpressure |
| Module-global remote sessions evict other users | Cross-tenant availability issue | Owner quotas, TTL, durable coordination if persistence is required |
| Catalog scale is mistaken for model coverage | User expectation failure | Visible support badges and exact counts from generated manifest |
| ESP32 scope swallows delivery | Vertical slice never completes | AVR Uno first; behavioral ESP32 remains explicitly bounded |

## 17. Non-goals for the first compiled release

The first release must not claim or attempt:

- all Arduino boards;
- ESP32 or RP2040 CPU emulation;
- arbitrary third-party Arduino libraries;
- analog/SPICE accuracy;
- RF, thermal, mechanical, or power-integrity simulation;
- cycle-accurate behavior for unconfigured AVR peripherals;
- multi-MCU concurrency before the scheduler and arbitration tests exist;
- remote persistent simulations;
- source compatibility with all C++ accepted by desktop Arduino IDE releases.

A narrow verified engine is better than a wide unverifiable one.

## 18. Definition of done for “one web codebase”

The objective is met for a target/device set only when:

- the graph, firmware, compiler, engine, and device contracts come from shared
  TypeScript packages;
- the target appears in an explicit generated capability manifest;
- source compiles in a worker using pinned approved assets;
- the artifact is hash- and provenance-bound to the exact source/target/toolchain;
- the graph compiler maps board pins and devices without UI heuristics;
- the MCU and device models run under the deterministic scheduler;
- UI, WebMCP, browser backend, and Site API use the same result contract;
- unsupported features are explicit;
- golden, contract, worker-failure, and end-to-end tests pass;
- bundle and memory budgets pass;
- user-facing wording matches the measured fidelity;
- the release is reproducible from a clean checkout.

This definition is per supported target/device set. It does not require pretending
that the entire catalog is executable.

## 19. First-agent implementation checklist

An agent beginning implementation should do this in order:

1. Read this document, `ARCHITECTURE.md`, `README.md`, both feasibility documents,
   and the Site runbook.
2. Run the existing root verification gate before editing.
3. Confirm no other task owns overlapping simulation files.
4. Create an ADR for shared contracts and browser-first engine selection.
5. Implement Phase 0 without changing behavioral outputs.
6. Add contract tests that run against browser and Site HTTP paths.
7. Stop and obtain owner approval before adding compiler assets or new licensing
   obligations.
8. Integrate the Uno compiler through the existing worker/toolchain seams.
9. Integrate AVR8js only after pinning and reviewing it.
10. Finish the button/LED compiled vertical slice before adding peripherals.
11. Update capability counts and user-facing limitations from generated data.
12. Run the full gate, inspect production bundle splits, and update this handoff with
    any new facts before commit/deployment.

Do not rewrite the application, replace the canonical graph with React Flow state,
or create a separate simulator-specific project format.

## 20. File map for the next agent

| Area | Primary files |
| --- | --- |
| Architecture/release truth | `README.md`, `ARCHITECTURE.md`, `docs/CHATGPT_SITE_RUNBOOK.md` |
| Behavioral runtime | `frontend/src/simulation/runtime.ts` |
| Protocol models | `frontend/src/simulation/protocolRuntime.ts` |
| Capability claims | `frontend/src/simulation/modelContract.ts`, `frontend/src/simulation/capabilityRegistry.ts` |
| Exact WASM harness | `frontend/src/simulation/portableHarness.ts`, `packages/firmware-harness/` |
| Dormant toolchain | `packages/browser-toolchain/`, `packages/browser-toolchain/FEASIBILITY.md` |
| Dormant AVR engine | `packages/avr-runtime/`, `packages/avr-runtime/FEASIBILITY.md` |
| Canonical graph intent | `packages/hardware-graph/src/types.ts` |
| Frontend project state | `frontend/src/store/useProjectStore.ts`, `frontend/src/store/projectPersistence.ts` |
| Runtime orchestration today | `frontend/src/store/useSimulationStore.ts` |
| WebMCP surface | `frontend/src/webmcp/tools.ts` |
| Site API | `chatgpt-site/app/api/[[...path]]/route.ts`, `functions/api/_runtime.ts` |
| Validation | `packages/validation/src/index.ts` |
| Runtime tests | `frontend/src/__tests__/runtime.test.ts`, capability/protocol/WebMCP tests, `frontend/src/__tests__/api-runtime.test.ts` |

Use `rg` to confirm imports before declaring a package production-wired. The mere
presence of code, tests, or a feasibility report is not evidence that the Site
loads it.

## 21. Required language in product surfaces

Preferred terms:

- `graph validation passed`;
- `compile preflight passed; compiler unavailable`;
- `behavioral simulation completed`;
- `instruction simulation completed with AVR Uno engine`;
- `unsupported by selected engine`;
- `verified fixture` or `verified artifact`, with the verification basis shown.

Avoid unless demonstrably true:

- `compiled successfully` for preflight;
- `real-time` for synchronous batch execution;
- `remote engine` as a fidelity claim;
- `fully simulated`;
- `electrically valid`;
- `cycle accurate`;
- `supports this part` when only its category was inferred;
- `saved to cloud` for browser-local persistence.

## 22. Known operational release caveat

At the time of this handoff, `chatgpt-site/.openai/hosting.json` contains a persisted
Sites project ID. The canonical public URL still returned HTTP 200 on 2026-08-31,
but the Sites connector in the active workspace returned `project not found` for
that persisted ID. A reachable public deployment and permission to publish it are
separate facts. This binding must be retrieved successfully in the active ChatGPT
workspace before publishing. The connector error is not permission to silently
replace the ID or create a duplicate Site. Confirm the owning workspace or
explicitly authorize a new binding, then push the exact commit used for the build
before saving/deploying a Site version.

GitHub push and ChatGPT Site deployment are separate release actions. A GitHub push
does not automatically prove that a new Site version is live.

## 23. Final recommendation

Make the system honest, deterministic, and narrow before making it broad. Preserve
the current behavioral runtime as a fast fallback, centralize all claims and
contracts, then deliver a complete Uno compiled button/LED path. Once that path is
reproducible and observable from source edit through UI/WebMCP result, extend the
scheduler, peripherals, and device registry in measured increments.

That sequence turns the existing architectural groundwork into a single coherent
TypeScript web simulation platform without discarding the working product or
claiming fidelity the repository does not yet provide.
