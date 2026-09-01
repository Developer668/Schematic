<div align="center">
  <img src="frontend/public/schematic-logo.png" width="118" alt="Schematic logo" />

# Schematic

**An agent-native workspace for designing hardware behavior and preparing editable firmware code.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-f97316.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![WebMCP](https://img.shields.io/badge/WebMCP-45_tools-8b5cf6.svg)](frontend/src/webmcp/tools.ts)

</div>

Schematic helps a person or an agent assemble a typed hardware graph, describe
the intended behavior, see that behavior in the canvas, and keep ordinary
Arduino/C/C++/Python source in an editable Code panel. The source is an
artifact for later use in an SDK, IDE, compiler, or physical hardware workflow;
it is not the input to the browser preview.

## Product boundary

The Behavior Plan is the source of truth for the in-app outcome:

```text
user intent
    ├── graph tools ────────> hardware project
    ├── behavior.plan.write -> validated Behavior Plan
    │                              │
    │                              v
    │                     typed profiles/actions/events
    │                              │
    │                              v
    │                     deterministic visual preview
    │
    └── code.write ----------> editable source files -> external handoff
```

Preview applies checked-in, typed component actions to visual reducers. It can
show an LED turning on, text appearing on a display, a relay changing state, a
servo moving, a motor changing speed, or a sensor reading changing. It does
not parse or execute the source shown in Code.

Every preview result carries the same honest boundary:

> This scripted preview shows the requested outcome. No source code ran, and
> wiring, electrical behavior, and physical hardware were not verified.

Schematic currently does not compile, interpret, emulate, upload, flash, or
physically test source. Those actions belong to the user's chosen external
toolchain or connected-hardware workflow.

## What is implemented

- A React/Zustand hardware graph with catalog search, typed ports, wiring,
  project switching, validation, browser-local persistence, and `.vlx` import/
  export.
- The `@schematic/behavior` package with versioned data-only plans, exact
  catalog profile bindings, bounded payload schemas, deterministic reducers,
  visual projections, logical time, replayable session logs, diagnostics, and
  SHA-256 provenance hashes.
- Profiles for buttons, LEDs/indicators, text displays, buzzers, relays,
  servos, motors, and numeric sensors. A catalog item without an exact profile
  remains explicitly unsupported rather than receiving guessed behavior.
- A Code panel backed by durable multi-file documents. Code can be generated,
  edited, copied, downloaded, and exported without being treated as verified
  firmware.
- Exactly 45 WebMCP tools in
  [`frontend/src/webmcp/tools.ts`](frontend/src/webmcp/tools.ts): 5 behavior
  tools and 3 code tools, plus graph, workspace, component, connection,
  validation, shopping, layout, and `firmware.write`/`firmware.read`
  compatibility aliases. `firmware.compile` and every `simulation.*` tool are
  absent from the default registration.
- A same-origin Site API limited to health, catalog, import analysis, parts
  discovery, and identity helpers. The retired compile and simulation API paths
  are not canonical ChatGPT Site routes and return 404 there. Repository-root
  compatibility handlers are excluded from the Site package and are not
  product capabilities.

## Behavior and code are intentionally independent

`behavior.plan.write` validates a plan against the active graph and the exact
profile registry. Every write requires `expectedRevision`: `null` is
create-only and the exact current integer revision is required to replace an
existing plan; omission and stale revisions are rejected. `behavior.preview`
prepares a plan and opens an ephemeral
session; `behavior.invoke` dispatches only typed events/actions; and
`behavior.get_state` returns the current snapshot, hashes, diagnostics, and
claims. The session is recreated on reload and invalidated on graph, plan, or
project changes. It is never persisted as executable state.

`code.write`, Monaco edits, and `firmware.write` save source documents with:

- a normalized file list and content SHA-256;
- language, board/FQBN metadata, dependencies, origin, and revision;
- mandatory optimistic exact-hash conflict protection (`expectedContentSha256:
  null` is create-only; an exact hash returned by `code.read`/`firmware.read`
  is required to replace an existing document; omitting it is rejected);
- an optional link to a plan/project hash, marked `stale` when either side
  changes; and
- export history plus `inAppVerification: "not-performed"`.

An export from `code.export` includes every file hash, source/project hashes,
target metadata, dependencies, graph diagnostics, preview-link provenance, and
machine-readable false claims for build, execution, upload, and physical test.

## WebMCP surface

The complete inventory and schemas are in
[`docs/webmcp/tools.md`](docs/webmcp/tools.md). The important authoring loop is:

1. Build or inspect the graph with project/component/connection tools.
2. Call `behavior.get_capabilities` to discover exact actions and events.
3. Call `behavior.plan.write` with a data-only Behavior Plan.
4. Call `behavior.preview`, then `behavior.invoke` for typed events/actions.
5. Call `code.write` to place ordinary source in Code, or edit it manually.
6. Call `code.read` and `code.export` when handing the project to an external
   SDK, IDE, compiler, or hardware workflow.

All eight authoring tools are thin adapters over the shared application command
layer in [`frontend/src/application/behaviorCommands.ts`](frontend/src/application/behaviorCommands.ts).
The human UI and WebMCP therefore use the same validation, reducers, hashes,
staleness rules, persistence, and structured errors. Models never receive an
arbitrary JavaScript function bridge.

## Local development

Requirements: Node.js 22.13+, pnpm 9+, and a browser for the UI. Python is
needed only for the optional standalone reference API.

```bash
pnpm install --frozen-lockfile
npm ci --prefix chatgpt-site
pnpm --filter @schematic/frontend dev
```

The standalone frontend is normally at `http://localhost:3000`. The hosted
Site wrapper can be run with:

```bash
pnpm --dir chatgpt-site dev
```

The Site's same-origin API does not require a second server. The optional
standalone reference service is:

```bash
pnpm dev:backend
```

Never use development authentication or an empty/weak
`SCHEMATIC_SESSION_SECRET` in a hosted deployment.

## Checks

Focused behavior checks:

```bash
pnpm --filter @schematic/frontend typecheck
pnpm --filter @schematic/frontend test -- --run
pnpm run verify:behavior-preview
```

Site checks:

```bash
npm --prefix chatgpt-site run lint
npm --prefix chatgpt-site run typecheck
npm --prefix chatgpt-site run test
npm --prefix chatgpt-site run build
```

`pnpm run verify` is the repository-wide release gate. It may build or test
dormant/reference workspaces included by the monorepo; that does not make those
packages part of the Site product path. The release gate must additionally
confirm that the initial Site bundle does not import legacy compiler/runtime
modules and that `/api/compile` and `/api/simulation/*` return 404 on the
canonical ChatGPT Site route.

## Persistence, limits, and migration

Projects are stored locally in IndexedDB with localStorage compatibility and
verified-user room keying. This is device-local persistence, not cloud backup or
cross-device synchronization. Preview sessions, timers, reducers, and active
snapshots are ephemeral; plans and code documents are durable JSON data.

Current safety limits include 100 plans/project, 200 rules/plan, 20 actions/rule,
2,000 cues/plan, 100 code documents/project, 128 files/document, 1 MiB/file,
256 dependencies/document, 50 export-history entries, and a 10 MiB `.vlx`
import limit. A local workspace may contain at most 50 projects and its
serialized room snapshot is capped at 8 MiB. If an existing room is over either
workspace limit, hydration enters recovery: the original stored room is left
untouched, every preserved project remains visible and can be selected/exported,
and ordinary edits are blocked. The only recovery mutations are confirmed
project `clear` or `delete` operations that strictly reduce project count or
serialized size; once the room fits, normal authoring resumes. If the room is
beyond the bounded recovery window, make a manual backup before attempting
repair. The behavior runtime also bounds logical preview duration to ten
minutes and validates bounded profile payloads.

Editable source has separate aggregate limits. A single source file is capped
at 1 MiB, but the canonical code documents in one project may contain at most
512 KiB total across all files/documents. The legacy `firmwareTargets` source
mirror is checked with the canonical documents against a 1 MiB serialized
source-container envelope; this is a compatibility/import boundary, not a
compiler or build limit. Source that exceeds a limit is rejected before a
project mutation is persisted.

Destructive model mutations require explicit identity confirmation. Project
delete/clear repeat the exact `projectId`, component removal repeats the exact
`instanceId`, connection removal repeats the exact `connectionId`, and replacing
an active project with a blueprint requires `replace: true` plus the exact
active project id. Blueprint application otherwise creates a new project and
keeps the existing project intact.

The importer accepts legacy firmware source containers and materializes editable
code documents once. Legacy simulation configuration, compiled artifacts,
unknown fields, and unsupported plan versions are retained only under inert
`legacyBehaviorData` quarantine for round-tripping. They are not active preview
inputs, status claims, or executable data. Imported plans and source are
untrusted data: import validates IDs, payloads, paths, sizes, and hashes, and
records `origin: "imported"` plus stale/linked provenance where applicable.
Source code is never loaded as a reducer, callback, or script.

## ChatGPT Site release

- Canonical Site URL:
  [schematic-hardware-workbench.decipherer71951502.chatgpt.site](https://schematic-hardware-workbench.decipherer71951502.chatgpt.site)
- Sites project ID: `appgprj_6a9216cfb16881919e467839d41b29b8`
- Hosting configuration: [`chatgpt-site/.openai/hosting.json`](chatgpt-site/.openai/hosting.json)
- Release procedure: [`docs/CHATGPT_SITE_RUNBOOK.md`](docs/CHATGPT_SITE_RUNBOOK.md)

The repository records the canonical project binding. Repository-wide release
gates passed on 2026-09-01; publication still has to be tied to the exact
release commit and checked in the ChatGPT in-app browser for native WebMCP
discovery, health/auth behavior, persistence, and the button→LED preview.
Those live checks are deployment evidence, not claims that source compiles or
hardware works. See the implementation audit and Site runbook for the exact
release record.

## Further reading

- [Architecture](ARCHITECTURE.md)
- [Behavior Preview and Editable Code Handoff](docs/TYPESCRIPT_WEB_SIMULATION_HANDOFF.md)
- [WebMCP tool schemas](docs/webmcp/tools.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [ChatGPT Site runbook](docs/CHATGPT_SITE_RUNBOOK.md)
- [Site capability probes](chatgpt-site/SITES_CAPABILITY.md)

## License

Schematic is licensed under [AGPL-3.0](LICENSE). Third-party components retain
their original licenses; see [NOTICE](NOTICE).
