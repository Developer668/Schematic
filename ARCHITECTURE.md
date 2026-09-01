# Schematic architecture — ChatGPT Site release path

Schematic's primary release is the authenticated ChatGPT Site:

`ChatGPT in-app browser → chatgpt-site wrapper → shared React frontend/store → 42 WebMCP tools → browser runtime and same-origin Site API`

The canonical live Site is [schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site). Production acceptance is performed in the ChatGPT in-app browser that will judge the submission.

## Canonical request and execution path

```text
ChatGPT in-app browser
        │  verified ChatGPT identity; native WebMCP host
        ▼
chatgpt-site/app/[[...path]]/SchematicClient.tsx
        │  dynamic client-only import
        ▼
frontend/src/App.tsx
        │
        ├── shared React UI and Zustand stores
        │     project graph · selection · workspace · validation
        │     simulation · shopping · browser-local persistence
        │
        ├── frontend/src/webmcp/tools.ts
        │     42 semantic tools; the same store actions as the UI
        │
        └── simulation.run
              ├── exact button→LED recognizer
              │     packages/firmware-harness/generated/button-led.wasm
              │     portable C core · C/WASM ABI v2 · verified SHA-256
              │
              └── bounded TypeScript behavioral interpreter
                    graph/topology checks · protocol/device adapters

Same-origin Site API (/api)
        │
        ▼
chatgpt-site/app/api/[[...path]]/route.ts
        │  imports functions/api/_runtime.ts directly
        ▼
catalog · validation · behavioral HTTP simulation · compile preflight
```

The wrapper owns the Site route and identity boundary; it does not fork the
workbench. The React application, graph model, stores, tool callbacks, and
browser runtime are shared with the standalone frontend. The API route is also
same-origin: it imports the tested runtime functions from
`functions/api/_runtime.ts` instead of forwarding requests to another service.

## Boundaries and data flow

1. The Site protects `/studio`, `/parts`, and `/settings` with the ChatGPT
   identity boundary. `/api/auth/session` exchanges that verified identity for
   a short-lived Schematic session signed with the server-only
   `SCHEMATIC_SESSION_SECRET`.
2. `SchematicClient` loads the shared `frontend/src/App.tsx`. The app hydrates
   the active project from the browser-local project repository (IndexedDB,
   with localStorage compatibility migration), scoped to the verified user
   room. It broadcasts changes to same-origin tabs; this is not cloud backup or
   cross-device synchronization.
3. Human UI actions and WebMCP callbacks call the same Zustand store methods.
   `frontend/src/webmcp/tools.ts` registers exactly 42 tools when the host
   exposes the native `document.modelContext`/`navigator.modelContext` API.
   Compatibility shims exist for local tests and constrained browsers; they are
   not evidence of native WebMCP discovery by a judge.
4. A tool result is structured (`content`, optional `data`, and `isError`) and
   is reflected in the WebMCP activity panel. Mutating tools change the active
   browser-local room; read-only tools report state without changing the graph.
5. `simulation.run` validates the graph and chooses the narrowest honest
   execution path:
   - A source/graph pair that matches the exact button→LED grammar selects the
     checked-in fixed C/WASM implementation. The matched source itself is not
     compiled into or executed by WASM. The harness resolves the actual board
     pins and connected button/LED endpoints, uses ABI version 2, and returns
     the artifact SHA-256.
   - Other supported source shapes use the bounded TypeScript interpreter and
     explicit protocol/device adapters. Results identify unsupported APIs and
     model limits; a generic pin map is not silently promoted to a device
     model.
   - A source or device outside those contracts returns an explicit
     unsupported/unavailable result. The Site never claims arbitrary C/C++,
     MCU-library, analog, RF, or binary execution.
6. When a tool needs the API, the client calls the Site's same-origin `/api`
   route. The route reuses `_runtime.ts` for catalog lookup, validation, HTTP
   behavioral simulation, session checks, and compile preflight. The Site does
   not launch a compiler subprocess, native simulator, or raw WebSocket.

## Capability matrix

| Surface                                           | ChatGPT Site status                   | Boundary / truthful interpretation                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Site wrapper and shared app                       | Production wired                      | The Site route dynamically loads the shared React app; there is one graph/store implementation.                                                                                                              |
| Hardware graph, catalog, typed wiring, validation | Production wired                      | Components can be searched, placed, inspected, connected, saved, and validated. Device execution still depends on the model contract.                                                                        |
| Native WebMCP                                     | Integrated, host-dependent            | `tools.ts` exposes 42 native registrations when the in-app browser supplies `modelContext`; local compatibility shims are test aids, not a native-agent acceptance result.                                   |
| Button→LED C/WASM harness                         | Production wired, deliberately narrow | Exact recognized source only; portable C core through C/WASM ABI v2, deterministic virtual I/O, artifact hash, pressed/released evidence.                                                                    |
| TypeScript behavioral interpreter                 | Production wired                      | Bounded Arduino-like execution and graph-aware protocol/device adapters; supports only the APIs and model contracts reported in the result.                                                                  |
| Same-origin Site API                              | Production wired                      | `chatgpt-site/app/api/.../route.ts` imports `functions/api/_runtime.ts`; health, catalog, validation, behavioral HTTP simulation, and compile preflight are available.                                       |
| Firmware compilation on the Site                  | Preflight only                        | `firmware.compile` checks source/target and reports that a binary compiler is unavailable. It must not be presented as an arbitrary binary compiler.                                                         |
| Project persistence                               | Production wired                      | Browser-local IndexedDB repository, localStorage migration, verified-user room keying, and same-origin tab synchronization.                                                                                  |
| Parts sourcing                                    | Keyless discovery, agent-published   | The first `shopping.search` call returns untrusted no-key JLCSearch/LCSC or exact-product Adafruit candidates and a strict `schematic.parts.lookup.v1` handoff; the second call publishes only after trusted WebMCP auth and canonical listing validation. Candidates never become cart listings, and the surface has no purchase, checkout, or silent retailer navigation. |
| Native external engines                           | Not production wired                  | Site engine status reports native simulator/compiler gaps explicitly; no native process is launched by the Site.                                                                                             |
| Raw WebSocket transport                           | Not available on the Site             | Use the browser runtime or the same-origin HTTP simulation routes.                                                                                                                                           |

## Reference and dormant paths

These paths remain useful for development, lineage, experiments, or future
work. They are not the ChatGPT Site production execution path:

| Path / component                                                                | Status            | What the label means                                                                                                                      |
| ------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/` standalone Vite app                                                 | Reference/local   | A separately runnable Vite frontend and its local API proxy; useful for development and regression tests, not the canonical Site wrapper. |
| `backend/app/` Python/FastAPI service                                           | Reference/local   | Optional local API and orchestration service. It is not called by the deployed ChatGPT Site.                                              |
| `backend/app/engines/renode.py`, `ngspice.py`, `wasmtime.py`                    | Dormant/reference | Adapter sketches and local experiments; no Site subprocess or native engine is wired into production.                                     |
| `vendor/velxio-simulation/` and `backend/app/velxio_reference/`                 | Reference/lineage | Vendored/reference material for the original hardware-workbench direction; not imported by the canonical Site runtime.                    |
| `packages/avr-runtime/` and `packages/browser-toolchain/`                       | Dormant/reference | Historical toolchain/runtime scaffolds; they are not part of the approved Behavior Preview roadmap and do not make Site compilation available. |
| `backend/worker.py` (Cloudflare worker entrypoint) and `backend/wrangler.jsonc` | Reference/dormant | A separate worker entrypoint/configuration, not wired to the ChatGPT Site release path.                                                   |
| QEMU, Verilator, FMI, Gazebo, RF, and full SPICE plans                          | Future/reference  | Architectural targets only. They are not capabilities of the current Site and must not be shown as live demo features.                    |

## Contract details

### Shared graph and stores

`frontend/src/store/useProjectStore.ts` owns the canonical `HardwareGraph`:
component instances, typed connections, firmware targets, and simulation
metadata. Selection, workspace panels, validation, shopping, and simulation
state live in adjacent stores. React Flow renders the graph; it is not the
source of truth. The project-storage package persists the workspace locally and
keeps user rooms separate.

### WebMCP registration

`frontend/src/webmcp/tools.ts` is the single tool registry and exports
`WEBMCP_TOOL_COUNT = tools.length`. Each native registration carries the tool
name, description, input schema, annotations, and an execution callback that
delegates to the shared stores. The current implementation follows the WebMCP
draft dated 26 August 2026. The browser testing flag documentation is for
Chrome v149+; the judge target here is the ChatGPT in-app browser, whose native
producer availability must be checked at acceptance time.

### Browser simulation

The portable harness is intentionally an exact contract, not a general
compiler. It recognizes one safe `setup`/`loop` shape that reads a connected
button and writes a connected LED, then selects a fixed precompiled
implementation. The matched source bytes are not passed to WASM, and optional
recognized delay syntax does not define the module's step timing. The generated
module is a 400-byte, hash-verified artifact with ABI v2. The same portable C
core has a source-only ESP32 Arduino export, but that export is not an ESP32
binary and does not make physical-device testing part of the Site.

The TypeScript runtime is the bounded fallback. It performs topology checks
even when firmware execution is unavailable, caps requested run duration, and
reports code/model coverage through `executionEngine`, `unsupportedApis`,
`targetIssues`, protocol traces, and validation summaries.

### Site API

`chatgpt-site/app/api/[[...path]]/route.ts` maps same-origin requests to the
shared functions in `functions/api/_runtime.ts`. The route provides health,
catalog search/inspection, import analysis, behavioral simulation state/run/
stop, parts-provider rejection, and compile preflight. API sessions are
short-lived bearer tokens issued after the Site verifies ChatGPT identity. A
missing or weak server secret is a release failure, not a reason to fall back
to anonymous access.

## Release truth

The repository's initial commit is dated 25 August 2026. Git history shows a
substantial WebMCP extension after that date: `00d9956` added the hardware
WebMCP studio on 26 August, `de54b96` fixed the WebMCP testing environment on
26 August, `7d2c587` completed the hardware workflow and `7d3f702` verified it
on 27 August, and `6e59adf`/`67b6783` bound the Site and authenticated
workspace runtime on 28 August. This history describes what landed; it does
not imply that dormant engines or a native Site MCP server are production
features.

See [README.md](README.md) for local checks and
[docs/CHATGPT_SITE_RUNBOOK.md](docs/CHATGPT_SITE_RUNBOOK.md) for publication and
acceptance gates. The implementation-grade roadmap for replacing the default
runtime outcome flow with typed Behavior Plans, deterministic visual actions,
and independently editable/exportable code is
[docs/TYPESCRIPT_WEB_SIMULATION_HANDOFF.md](docs/TYPESCRIPT_WEB_SIMULATION_HANDOFF.md).

## License

Schematic is AGPL-3.0-only. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for
third-party notices.
