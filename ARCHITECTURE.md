# Schematic Architecture — Agent-Native Hardware Workbench

> Implements `HardwareWebMCP.md`. Three reusable layers: universal component format → per-engine adapter → typed connection.

## Diagram

```
                    BROWSER (React + TS + Vite)
  ┌─────────────────────────────────────────────────────────┐
  │  Component Library   Hardware Canvas  Inspector+Validate │
  │                          │                               │
  │                    @xyflow/react                         │
  │                          │                               │
  │  Monaco Workspace   Hardware Graph   Console/Serial       │
  │                          │                               │
  │                     Zustand Stores                        │
  │                          │                               │
  │                    WebMCP Tools (18)                      │
  └──────────────────────────┬───────────────────────────────┘
                             │  HTTP + WebSocket
  ┌──────────────────────────┴───────────────────────────────┐
  │                Python FastAPI Orchestrator                │
  │  Registry  Validator  Importer  Scheduler  Session         │
  │      ┌─────────┬──────────┬─────────┬───────┐             │
  │      ▼         ▼          ▼         ▼       ▼             │
  │   Renode   ngspice   Wasmtime   QEMU*   Verilator*        │
  │   firmware electrical sandbox   Linux    HDL              │
  │   (* = stub, architecture ready)                         │
  └───────────────────────────────────────────────────────────┘
```

## Layer 1 — Universal Hardware Graph (TS owns canonical state)

`packages/hardware-graph/src/types.ts`:
- `HardwareProject`, `ComponentInstance`, `ComponentDefinition`, `HardwarePort`, `Connection`, `FirmwareTarget`, `SimulationConfig`.
- `PortDomain` union (power, gpio, adc, pwm, i2c, spi, uart, usb, can, pcie, rf, mechanical…).
- Zod schemas in `schemas.ts` + `graph.ts` helpers (`createEmptyProject`, `addComponent`, `connectPorts`, `validateProjectShape`).
- React Flow only renders; translation `project ↔ nodes/edges` is pure function.

## Layer 2 — Typed Ports & Validation

`packages/validation/src/index.ts`:
- `validateProject(project, lookup)` checks 15+ rules: wrong voltage, missing ground, output→output, I2C collision, missing pull-ups, TX→TX, SPI CS, power insufficiency, USB host-host, PCIe EP-EP, RF impedance, physical collision, thermal.
- Returns `ValidationResult { valid, issues[] }` with `autoFix` hints. UI shows exactly what's modeled (never blanket “fully supported”).
- Bridge: `frontend/src/simulation/bridges.ts` provides generic bridges (GPIO, I2C generic `{protocol,address,operation,register,length,time_ns}`, SPI, UART, CAN, USB, RF…) — any sensor can respond.

## Layer 3 — Universal Component Format (.hwpkg)

`packages/component-format`:
- `.hwpkg` = ZIP: `manifest.json/yaml + symbol.svg + footprint + geometry.step/.glb + electrical.lib + io.ibs + behavior.wasm + renode.cs/.py + verilog.v + fmu + license.json`.
- `manifest.ts` defines `FILE_TYPE_MAP` (doc table) and `HwpkgManifestSchema`.
- `package.ts` packs/unpacks ZIP via JSZip; `importer.ts` implements 10-step pipeline (search→download→identify→license→extract→match→choose engine→generate→test→add).
- L1 auto-import (resistor, cap…), L2 generic templates (`templates/i2c-register-sensor.yaml` — no code), L3 custom WASM/Renode C# (sandboxed via Wasmtime).

## Simulation: One Adapter per Engine

`frontend/src/simulation/SimulationEngine.ts` + `backend/app/simulation/engine.py`:
```ts
interface SimulationEngine { initialize(model:CompiledSubgraph):Promise<void>; advanceTo(timeNs:bigint):Promise<void>; writePort(portId,value):Promise<void>; readPort(portId):Promise<PortValue>; snapshot():Promise<Uint8Array>; restore(s):Promise<void>; shutdown():Promise<void> }
```
Adapters in `backend/app/engines/`:
- **Renode** — generates `.repl`, `Python.PythonPeripheral`, talks via Monitor telnet, handles `.repl`/`C#`/`Python` models.
- **ngspice** — shared-library callbacks (preferred) + `ngspice-wasm` fallback; Union-Find netlist via frontend `NetlistBuilder` pattern.
- **Wasmtime** — `Config(wasm_component_model=True, epoch_interruption=True)`, 20s/40MB limits, community WASM.
- **Stubs** (`base.py` StubEngine) for QEMU (QMP), Verilator (`verilator --cc`), FMI (FMPy), Gazebo, scikit-rf, GNU Radio, openEMS/Meep (offline→reduced model pattern: high-fidelity solver → S-params/pattern → fast lookup).

Orchestrator `backend/app/simulation/orchestrator.py` partitions graph, deterministic event queue, advances all engines to same `time_ns`, handles snapshots, crash isolation (each engine = worker process; future: gRPC/local-socket).

## Backend (Python + FastAPI)

`backend/app/main.py`: `CORSMiddleware` (5173-5175 + Tauri), `lifespan`, routers `/api/compile`, `/api/simulation` (REST + WebSocket `/ws`), `/api/components` (search, ports, import analyze), `/api/health`, `/api/engines`.
- Workers: `workers/` subprocesses (Renode dotnet, ngspice shared lib, wasmtime) — not merged source trees → crash isolation + license separation.

## Frontend (React + Vite, no Next.js)

- **Vite**: `vite.config.ts` mirrors Velxio (`preserveSymlinks`, `proxy /api → 127.0.0.1:8001`, `manualChunks`, `assetsInclude *.wasm`).
- **Stores**: Zustand `useProjectStore` (graph CRUD, `addComponent`, `connectPorts`→validate), `useSimulationStore` (engine status, serial), `useSelectionStore`, `useComponentCatalogStore`.
- **Canvas**: `@xyflow/react` `HardwareCanvas.tsx` + `HardwareNode.tsx` (custom node per component, handles per port, edge style per domain: power━, gpio─, i2c═, uart dashed).
- **Web Components rule**: any wireable board must be `class X extends HTMLElement` with `get pinInfo()` — prevents (0,0) wire bug (Velxio CLAUDE.md §6a).
- **Monaco**: `MonacoWorkspace.tsx` (multi-file, compile toolbar → `/api/compile`).
- **Validation**: `ValidationPanel.tsx` (run check, explain_error, auto-fix).
- **Import**: `ImportDialog.tsx` (10-step pipeline UI).

## WebMCP (Centerpiece)

`frontend/src/webmcp/tools.ts` — 18 tools via `document.modelContext.registerTool({name,description,inputSchema,execute,annotations},{signal})` (WebMCP draft 2026-08-19, SecureContext, Permissions-Policy `allow="tools"`).
- Tools: `project.get_graph/clear`, `component.search/inspect/add/remove/list_ports`, `connection.connect/disconnect/get_connections`, `firmware.write/compile`, `simulation.run/stop/get_state/set_input`, `validation.check/explain_error`, `design.auto_layout`.
- Each `execute` reuses same Zustand function human UI uses → agent and human share logic. Fallback `window.__schematicTools` when flag off.
- `getTools()` discovery + `executeTool()` mediation, AbortSignal cleanup, `ontoolchange`.

## Fidelity & Offline Models

Per doc § Do not run every engine at full fidelity continuously:
- Offline solver (openEMS/Meep) → generate `radiation pattern / S-params / coupling / FOV map` → fast runtime lookup (scikit-rf/GNU Radio) during interactive sim. `services/reduce_model.py` caches.

## Data & Persistence

- SQLite `schematic.db` + `data/hwpkg/` filestore.
- `.vlx` (Velxio pattern) `frontend/src/utils/vllxFile.ts`: `{format:"schematic-project",version:1,exportedAt,project,pinStates}` → Blob download. Backend also serves JSON.

## Build Order

1. **First usable (this repo)**: Velxio canvas + Renode + ngspice + importer + Wasmtime → Arduino/ESP32/RP2040/STM32, sensors/motors/displays/power/multi-MCU/custom import.
2. **Second**: QEMU + Verilator + FMI/OpenModelica → Linux SBCs, FPGA, batteries/thermal.
3. **Third**: Gazebo + Open CASCADE → arms/cameras/LiDAR/enclosures.
4. **Final**: scikit-rf + GNU Radio + openEMS + Meep + HIL → radar/AR/phased arrays.

## License

AGPL-3.0 (Velxio-derived portions remain AGPL per license). See `LICENSE` + `NOTICE` for Renode MIT, Wasmtime Apache-2.0, QEMU GPL-2.0, Verilator LGPL, etc. Workers run isolated → separation preserved.
