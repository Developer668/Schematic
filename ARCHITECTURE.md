# Schematic architecture — Behavior Preview release path

Status: current implementation handoff (repository checked 2026-09-01)
Release-candidate repository gates passed and the current-account Site revision
is published; the formal Sol turn hit its usage limit before sign-off, so live
native-WebMCP/browser acceptance remains a separately recorded check.

Schematic's canonical release is the authenticated ChatGPT Site:

```text
ChatGPT in-app browser
  -> chatgpt-site wrapper
  -> shared React frontend and Zustand stores
  -> application commands
  -> typed Behavior System and visual canvas
```

Canonical Site URL:
[schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site)

Sites project ID: `appgprj_6a913ce4a58881918a47ea49fa0ca505`

The repository records that binding. Publication is tied to the pushed release
commit and Site version in `docs/CHATGPT_SITE_PROGRESS.md`; a local build alone
is never treated as publication or hardware verification.

## The source of truth

The product has one behavioral source of truth: a versioned, data-only
Behavior Plan associated with the active hardware graph. The plan names exact
component instances, profile-defined events, profile-defined actions, and
bounded payloads.

```text
user intent
    |
    +--> graph tools ------------------> HardwareGraph
    |                                      |
    +--> behavior.plan.write ------------> BehaviorPlanV1
                                           |
                                           v
                                  @schematic/behavior
                              inspect -> prepare -> session
                                           |
                                           v
                              visual projections and timeline
                                           |
                                           v
                                  canvas visual overlays

user/agent code response ----------------> CodeDocument
                                           |
                                           +--> Monaco / copy / download
                                           +--> external SDK or hardware handoff
```

The preview follows the plan and checked-in profiles. It never reads source
files as executable input. Code and preview may be linked by hashes for
provenance, but a link does not mean that code caused the preview.

## What actually runs

The in-app preview runs only trusted, checked-in TypeScript profile reducers and
visual projectors from `packages/behavior`. Those reducers consume validated
typed action requests and return generic visual primitives such as indicator,
button, text-display, numeric-readout, rotation, and activity state.

The preview is a deterministic conceptual outcome. It is not firmware
execution, electrical simulation, an MCU emulator, a compiler, an uploader, or
a physical hardware test. Preview claims are machine-readable as:

```text
basis: declared-behavior-plan
sourceCodeRead: false
sourceCodeExecuted: false
sourceCodeCompiled: false
hardwareUploaded: false
electricalBehaviorSimulated: false
physicalWiringVerified: false
physicalBehaviorVerified: false
```

The honest UI sentence is:

> This scripted preview shows the requested outcome. No source code ran, and
> wiring, electrical behavior, and physical hardware were not verified.

Build, upload, and physical test happen later in the user's selected external
SDK/toolchain or hardware workflow. They are outside this Site.

## Runtime and dependency topology

```text
chatgpt-site/app/[[...path]]/SchematicClient.tsx
        |
        v
frontend/src/App.tsx
        |
        +--> frontend/src/store/useProjectStore.ts
        |       HardwareGraph, BehaviorPlan records, CodeDocument records
        |
        +--> frontend/src/application/behaviorCommands.ts
        |       shared plan/code commands and exact-hash writes
        |
        +--> packages/behavior/
        |       schemas, registry, prepare, profiles, deterministic sessions
        |
        +--> frontend/src/behavior/useBehaviorPreviewStore.ts
        |       ephemeral UI status, snapshot, diagnostics, timeline cursor
        |
        +--> frontend/src/webmcp/behaviorTools.ts
        |       5 behavior + 3 code adapters
        |
        +--> frontend/src/webmcp/tools.ts
                45 total registered tools
```

`@schematic/behavior` is framework- and transport-free. It must not import
React, Zustand, React Flow, Monaco, WebMCP, DOM APIs, network clients,
compiler packages, MCU runtimes, or Site APIs. The application command layer is
the only place that adapts the frontend graph/store and persistence boundary to
the package.

The Site API at
`chatgpt-site/app/api/[[...path]]/route.ts` is deliberately narrow. It exposes
same-origin health, catalog search/inspection, component import analysis,
parts discovery, and identity helpers. Behavior Preview and source authoring
stay in the local typed application layer. `/api/compile` and
`/api/simulation/*` are retired from the Site route and must return 404.

## State ownership

### Durable project state

`frontend/src/store/useProjectStore.ts` owns the active `HardwareGraph` and the
project collection. Current durable authoring fields are:

- `behaviorPlans`: normalized `BehaviorPlanRecord[]`;
- `codeDocuments`: normalized, multi-file `CodeDocumentRecord[]`; and
- `legacyBehaviorData`: JSON-only quarantine for unsupported or legacy values.

Legacy `firmwareTargets` remain as a compatibility mirror for existing source
consumers, but new behavior preview does not read their source. Compiled
artifacts are removed from active targets and retained only under quarantine
when imported. Legacy simulation configuration is similarly quarantined, not
used to drive preview state.

`frontend/src/store/projectPersistence.ts` persists projects in the existing
browser-local repository. The verified-user room key prevents an authenticated
room from inheriting another user's data. IndexedDB/localStorage and same-origin
tab synchronization are device-local storage mechanisms; they are not cloud
backup or cross-device sync.

### Ephemeral preview state

`frontend/src/behavior/useBehaviorPreviewStore.ts` contains only UI/session
state: status, current snapshot, diagnostics, selected component, duration,
announcement, and request generation. Timers, reducers, session objects, and
active snapshots are not persisted or exported. Graph, plan, and project changes
dispose the active session; code-only edits do not alter the preview snapshot.

### Code documents

`frontend/src/store/behaviorPersistence.ts` normalizes data-only code records.
Each record has a project/target identity, language, optional board FQBN,
source files, declared dependencies, revision, content SHA-256, origin,
preview-link relation, export history, and the fixed
`inAppVerification: "not-performed"` value.

`frontend/src/application/behaviorCommands.ts` owns `code.write`, `code.read`,
and `code.export` behavior. Every `code.write`/`firmware.write` request must
include `expectedContentSha256`: `null` creates only when no document exists,
while an exact hash returned by `code.read`/`firmware.read` authorizes replacing
that revision. Missing, undefined, or mismatched hashes fail with a structured
error without overwriting newer source. A manual edit changes the content hash
and marks an old plan link stale. Plan or graph changes also mark links stale.
No command regenerates or silently overwrites code.

## Behavior System boundary

The public package in `packages/behavior/src` has these layers:

1. `contracts.ts` defines JSON-safe plans, requests, diagnostics, snapshots,
   claims, code metadata, and handoff manifests.
2. `schemas.ts` validates bounded Behavior Plan and payload data.
3. `canonicalize.ts` provides stable canonical JSON and SHA-256 hashes.
4. `registry.ts` resolves exact catalog bindings to exact profile versions.
5. `prepare.ts` validates a plan against the graph, registry, and profile
   action/event schemas. Unsupported items block by default or are reported as
   partial only when an explicit skip policy is selected.
6. `session.ts` applies ordered events/actions through pure profile reducers,
   tracks logical time and a bounded session log, and produces deterministic
   snapshot hashes.
7. `profiles/` contains trusted, checked-in implementations. Imported plans
   can name IDs but cannot provide reducers, JavaScript, callbacks, URLs,
   templates, or executable plugins.

Current exact catalog bindings cover:

| Catalog identity | Profile | Representative actions/events |
| --- | --- | --- |
| `pushbutton` | `momentary-input:v1` | `button.pressed`, `button.released`, `button.setPressed` |
| `led` | `digital-indicator:v1` | `indicator.set`, `indicator.setBrightness` |
| `lcd1602` | `text-display:v1` | `display.showText`, `display.clear` |
| `buzzer` | `buzzer:v1` | `buzzer.start`, `buzzer.stop` |
| `relay` | `relay:v1` | `relay.set` |
| `servo` | `rotary-actuator:v1` | `servo.setAngle` |
| `stepper-motor` | `motor:v1` | `motor.setSpeed`, `motor.stop` |
| `ntc-temperature-sensor` | `numeric-sensor:v1` | `sensor.setReading`, `sensor.changed` |

Catalog support is opt-in by exact definition ID and profile version. Unknown
or unsupported components/actions return structured diagnostics and do not
silently mutate the canvas.

## Application commands and WebMCP

`frontend/src/application/behaviorCommands.ts` is the shared command seam for
human controls and model tools. `frontend/src/webmcp/behaviorTools.ts` adapts
the commands to the WebMCP result envelope; it does not own reducers or parse
source. Every result includes structured errors where applicable, hashes or
metadata needed for provenance, and a notice that distinguishes expected
visual outcome from source/hardware verification.

The default registry in `frontend/src/webmcp/tools.ts` contains exactly 45
tools. The eight authoring tools are:

| Tool | Role |
| --- | --- |
| `behavior.get_capabilities` | Report exact profile actions/events and limitations. |
| `behavior.plan.write` | Validate and persist a Behavior Plan with revision/hash conflict checks. |
| `behavior.preview` | Prepare a saved plan and open a bounded ephemeral preview session. |
| `behavior.invoke` | Dispatch one typed event/input/action through the active session. |
| `behavior.get_state` | Read status, hashes, snapshot, diagnostics, and honest claims. |
| `code.write` | Create or replace editable source with exact-hash protection. |
| `code.read` | Read source and metadata without executing it. |
| `code.export` | Produce source hashes and an external handoff manifest. |

The other 37 tools cover project, workspace, components, connections,
validation, shopping, layout, and two compatibility aliases (`firmware.write`
and `firmware.read`) plus the non-build `firmware.check` diagnostic. There is
no `firmware.compile` or `simulation.*` registration. See
[`docs/webmcp/tools.md`](docs/webmcp/tools.md) for exact schemas and
annotations.

## Hashes and provenance

Hashes are identity and concurrency metadata, not correctness proofs:

- `planSha256` hashes canonical Behavior Plan data;
- `projectSha256` hashes behavior-relevant graph identity: project id/version,
  sorted component instance ids/definition ids/properties (and firmware-group
  identity when present), plus sorted connection endpoints/domains. Source
  files, code metadata, labels, positions, rotations, and timestamps are
  intentionally excluded. Moving nodes or running auto-layout therefore does
  not change the semantic preview fingerprint; changing component identity,
  definition, properties, or wiring does;
- `registrySha256` identifies the checked-in profile registry;
- `contentSha256` hashes normalized code file names and contents;
- each exported file receives a `sha256`; and
- `sessionLogSha256`/`snapshotSha256` identify deterministic preview history and
  visible state. The ordered session log is replay input, not a durable
  executable program.

The external handoff manifest in `ExternalCodeHandoffV1` carries these values,
target/FQBN metadata, dependencies, graph diagnostics, preview-link relation,
export timestamp, and explicit false claims for build, execution, upload, and
physical testing. Import/export retains this provenance: imported plans and
source remain data-only, legacy artifacts are quarantined, and links are marked
stale when their exact plan/project/content hashes no longer match. A hash
proves which data was handled; it does not prove the source compiles or the
hardware works.

## Limits and safety

The current persistence and preview caps are intentionally finite:

| Resource | Limit |
| --- | ---: |
| Behavior Plans per project | 100 |
| Rules per plan | 200 |
| Actions per rule | 20 |
| Cues per plan | 2,000 |
| Code documents per project | 100 |
| Files per code document | 128 |
| Source bytes per file | 1 MiB |
| Dependencies per document | 256 |
| Export history entries | 50 |
| Projects per local workspace | 50 |
| Serialized local workspace | 8 MiB |
| Canonical editable source per project | 512 KiB aggregate |
| Mirrored source-container envelope per project | 1 MiB serialized |
| `.vlx` import size | 10 MiB |
| Logical preview duration | 600,000 ms |

Payload schemas reject unsupported keywords, remote references, dynamic schema
loading, non-JSON values, unsafe relative filenames, and unbounded values.
Event/action dispatch is validated against the active instance, definition,
profile, action/event ID, and current project fingerprint before reduction.

Workspace hydration rejects an over-limit room without overwriting it. The
application records a recovery error, keeps every project in the bounded
recovery window visible/selectable/exportable, and blocks ordinary writes.
Only confirmed project `clear` or `delete` operations are allowed while in
recovery, and only when they strictly reduce project count or serialized size;
normal authoring resumes once the room fits. Create, duplicate, and import
operations are also atomic with respect to the 50-project and 8 MiB limits.
Destructive WebMCP operations require exact repeated identity fields:
`confirmProjectId`, `confirmInstanceId`, or `confirmConnectionId`; blueprint
replacement additionally requires `replace: true` and the exact active project
id. The default blueprint path creates a separate project.

## Legacy and external boundaries

The repository may still contain historical runtime, compiler, AVR, protocol,
or API files. Their presence is not a product capability. They are quarantined
or dormant until a separately authorized hardware-boundary project exists. The
default Site entry closure must not import firmware harnesses, browser
toolchains, AVR runtime, source interpreters, or remote simulation handlers.

Do not add a direct `eval`, dynamic import of user code, JavaScript function
name, WebSocket runtime, compiler subprocess, Web Serial uploader, or hidden SDK
call to the Behavior Preview path. External testing remains user initiated.

## Release and verification

Run from the repository root:

```bash
pnpm --filter @schematic/frontend typecheck
pnpm --filter @schematic/frontend test -- --run
pnpm run verify:behavior-preview
npm --prefix chatgpt-site run verify
```

The static behavior release gate checks package dependency boundaries, active
Site import closure, required profile bindings, 45-tool registration, active
client/server import boundaries and forbidden endpoint references, truthful
claims, and bundle asset boundaries. It does not make live HTTP 404 checks. A local pass is not proof that the hosted Site has been
published or that the ChatGPT host exposes native WebMCP.

Before release, the release agent must check the canonical Site URL in the
ChatGPT in-app browser, confirm native discovery of 45 tools, verify `/api/health`
and `/api/docs`, confirm retired compile/simulation paths return 404, reload a
project to test local persistence, and run a button→LED Behavior Plan. Record
the deployed revision and publication result separately.

## Related documents

- [Behavior Preview and Editable Code Handoff](docs/TYPESCRIPT_WEB_SIMULATION_HANDOFF.md)
- [WebMCP schemas](docs/webmcp/tools.md)
- [ChatGPT Site runbook](docs/CHATGPT_SITE_RUNBOOK.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Site capability probes](chatgpt-site/SITES_CAPABILITY.md)
