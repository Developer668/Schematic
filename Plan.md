# Schematic — HardwareWebMCP Master Plan (40 Steps)

> Generated 2026-08-26. Implements `HardwareWebMCP.md` end-to-end. No toy demo — production, typed, isolated workers, agent-native.
> Architecture = 3 reusable layers (universal component format + per-engine adapter + typed connection) → every project is a graph, not hardcoded `if Pi → do_this()`.

## Evidence Base (research completed)

- **Velxio v3.0** (AGPL-3.0, React+Vite+Monaco+avr8js/rp2040js, 150+ parts, QEMU for ESP32/STM32/Pi Linux): canvas, PinManager, SignalRouter, SimulatorCanvas, useSimulatorStore, NetlistBuilder→ngspice-wasm, MCP `app/mcp/server.py` (compile_project etc), .vlx persistence, `frontend/vite.config.ts: manualChunks`, docs/wiki/MCP.md.
- **Renode** (MIT, src/Emulator, .repl human-readable platform, Python peripherals `request.Value/IsRead/IsWrite`, C# IPeripheral + Register Framework, PeakRDL-renode scaffold, `platforms/cpus/*.repl`, HDL co-sim via Verilator). Installed via `renode-master/`.
- **Wasmtime** (Apache-2.0, Bytecode Alliance, `wasmtime-py` + `wasmtime.component`, sandbox, epoch interruption, 40 MB limit pattern from componentize-py sandbox example, `Config().wasm_component_model=True`).
- **QEMU** (GPL-2.0, `hw/`, `qapi/` QMP, docs note supported boards cover fraction of ecosystem — need existence check before claiming support).
- **Verilator** (LGPL-3.0, converts .v/.sv → C++/SystemC, co-sim with Renode `VerilatedModel` integration layer).
- **WebMCP draft 2026-08-19** (W3C CG, `document.modelContext.registerTool({name,description,inputSchema,execute,annotations},{signal,exposedTo})`, `getTools()`, `executeTool()`, `ontoolchange`, SecureContext+Permissions-Policy `allow="tools"`, no `unregisterTool()` → use AbortSignal. Spec: webmachinelearning.github.io/webmcp, Chrome ai/docs AI on Chrome).
- **Hackathon** webmcp.devpost.com: requires live URL + public repo + license + WebMCP impl + <3m demo, judged equally on WebMCP leverage/execution/impact/creativity, pre-existing projects judged only on WebMCP extension.

License decision: **AGPL-3.0** for Schematic derivative (Velxio is AGPL, Apache→AGPL allowed, AGPL→Apache not). Keep each dependency's own LICENSE/NOTICE. Replace `D:\Schematic\LICENSE`.

Stack choice per HardwareWebMCP.md § "stack I would choose": `pnpm monorepo | TS+React+Vite+@xyflow/react+Zustand+Monaco+Zod+JSON Schema | Python3.12+FastAPI+WebSockets+Pydantic v2 | Renode+ngspice+Velxio concepts | SQLite+files | Wasmtime`.

---

## Phase 0 — Repo & Legal (Plans 1–3)

### 01. Replace LICENSE (Apache → AGPL-3.0)
- `LICENSE:1` currently Apache-2.0 (201 lines). Overwrite with canonical GNU AGPL v3 text (https://www.gnu.org/licenses/agpl-3.0.txt), preserve copyright: `Copyright (c) 2026 Schematic contributors (Velxio-derived portions © davidmonterocrespo24)`.
- Add `NOTICE` file enumerating Renode (MIT), QEMU (GPL-2.0), Verilator (LGPL), Wasmtime (Apache-2.0), avr8js etc.
- Add `LICENSES/` REUSE.toml if needed.

### 02. Scaffold pnpm monorepo
```
D:\Schematic/
  pnpm-workspace.yaml  (packages: ["packages/*","frontend","backend"])
  package.json         (private:true, engines node>=18, packageManager pnpm@9)
  .nvmrc, .editorconfig, .gitignore
  frontend/            → Vite SPA (no Next.js)
  backend/             → FastAPI
  packages/
    hardware-graph/    → universal types + Zod + JSON Schema
    validation/        → typed connection validator
    component-format/  → .hwpkg manifest, importer registry
  docs/
  Plan.md (this file)
  HardwareWebMCP.md (spec)
```
- Verify with `pnpm -v && python --version`.

### 03. Create Plan.md + ARCHITECTURE.md + CONTRIBUTING
- This file. Add `ARCHITECTURE.md` mirroring HardwareWebMCP.md § Architecture I would actually build (diagram Browser→FastAPI→workers).

## Phase 1 — Universal Graph & Typed Ports (Plans 4–8, Layer 1 & 3)

### 04. hardware-graph types (TS owns canonical state)
File `packages/hardware-graph/src/types.ts` (+ `schemas.ts` with Zod):
```ts
interface HardwareProject { id:string; name:string; components:ComponentInstance[]; connections:Connection[]; firmwareTargets:FirmwareTarget[]; simulation:SimulationConfig; createdAt, updatedAt }
interface ComponentInstance { id:string; definitionId:string; position:{x,y}; rotation:0|90|180|270; properties:Record<string,unknown>; firmwareGroupId?:string }
interface ComponentDefinition { id:string; manufacturer?:string; partNumber?:string; title:string; category:string; ports:HardwarePort[]; models:{behavioral?,spice?,renode?,firmware?,geometry?,rf?}; electrical?, physical?, docs? }
interface HardwarePort { id:string; name:string; domain:PortDomain; direction:"input"|"output"|"bidirectional"|"power"; electrical?:{minVoltage,maxVoltage,nominal,maxCurrent,requiresPullup?}; protocol?:{role,version,lanes,bandwidth,address?}; rf?:{impedance,freqMin,freqMax} }
type PortDomain="power"|"gpio"|"adc"|"pwm"|"i2c"|"spi"|"uart"|"usb"|"ethernet"|"can"|"pcie"|"csi"|"hdmi"|"displayport"|"rf"|"mechanical"
interface Connection { id:string; source:{componentId,portId}; target:{componentId,portId}; domain:PortDomain; metadata?:{wireColor,waypoints} }
interface FirmwareTarget { id:string; componentId:string; language:"arduino"|"micropython"|"espidf"|"c"; files:{name,content}[] }
```
- Do NOT use React Flow nodes as DB (per HardwareWebMCP.md). Store separately, derive React Flow nodes/edges.
- Tests: graph CRUD, Zod parse.

### 05. Typed port system + domain bridges interfaces
`packages/hardware-graph/src/ports.ts`:
- `PORT_DOMAIN_META` map each domain→ allowed directions, validation rules, edge style (power━━, gpio──, i2c══, usb━╋━).
- Bridges are generic, not per-device: `GpioBridge, AdcBridge, PwmBridge, I2cBridge {protocol:"i2c",controller,address,operation,register,length,time_ns}, SpiBridge, UartBridge, CanBridge, UsbBridge, EthernetBridge, PcieBridge, MechanicalBridge, RfBridge, OpticalBridge`.

### 06. Connection validator (universal, satisfies HardwareWebMCP.md § central connection)
`packages/validation/src/index.ts`:
```ts
function validateConnection(src:Port,tgt:Port, ctx:ProjectContext): ValidationResult
```
Checks: wrong voltage, missing ground, output→output, i2c addr collision (scan all i2c targets), missing pull-ups, tx→tx, spi CS collision, insufficient power, usb host-host, pcie ep-ep, rf impedance mismatch, camera bw, battery peakCurrent, driver missing, physical collision, thermal. Return `{valid:boolean; severity:"error"|"warning"; code; message; autoFix?:{addComponent?,insertPullup?,levelShifter?}}`.
- Ported from Velxio `circuit/verifier` + expanded for typed ports.
- 20+ rule unit tests.

### 07. Component package format (.hwpkg)
`packages/component-format/src/manifest.ts`:
- `.hwpkg` = ZIP containing `manifest.yaml`, `symbol.svg/kicad_sym`, `footprint.kicad_mod`, `geometry.step/.glb`, `electrical.lib/.subckt`, `io.ibs`, `behavior.wasm`, `renode.cs/.py`, `model.fmu`, `verilog.v`, `datasheet.pdf`, `license.json`, `metadata.json`.
- Minimal package: `manifest.yaml+symbol.svg+spice`. MCU package: `+CMSIS/SVD+Renode+STEP`. Radar: `+S-param+GNU Radio`.
- `license.json` records per-file provenance. CI fails if proprietary encrypted PSpice without fallback.
- `zod` schema for manifest.yaml.

### 08. Component registry + starter catalog
`backend/app/components/registry.py` + `frontend/src/data/catalog.ts`:
- SQLite `components.db` (components, ports, models, tags) + `data/hwpkg/` filestore.
- Component metadata is vendored at `vendor/velxio-components-metadata.json` and normalized by `frontend/src/data/catalog.ts` (150+ parts).
- Expose `GET /api/components?search=TI DRV&domain=i2c`.
- Frontend `useComponentCatalogStore` (Zustand, search+filter).

## Phase 2 — Frontend Shell (Plans 9–16)

### 09. Vite scaffold (no Next.js per doc)
`frontend/` created via `pnpm create vite@latest --template react-ts`, add `vite.config.ts` copying Velxio's `preserveSymlinks`, `proxy /api → 127.0.0.1:8001`, `assetsInclude *.wasm`, `manualChunks` (spice-wasm,mcu-emulators,wokwi-elements,react-vendor). Scripts: `dev`,`build`,`build:docker` (no tsc), `lint`,`test`.

### 10. Design system (Tailwind+Radix)
- `tailwind.config.ts`, `postcss.config.js`, `src/index.css` (Velxio tokens).
- Radix primitives for dialogs, dropdowns, toast.

### 11. Zustand stores (own graph, not React Flow)
`frontend/src/store/`:
- `useProjectStore` (hardware graph CRUD, `addComponent`, `connectPorts`→validate, undo snapshot).
- `useSimulationStore` (engine states, serial, oscilloscope).
- `useSelectionStore` (selectedIds, inspector open).
- `useComponentCatalogStore` (search, import queue).
- Pattern from Velxio `useSimulatorStore.ts:1` (boards, wires, components) but generalized.

### 12. React Flow canvas (@xyflow/react)
`frontend/src/components/canvas/HardwareCanvas.tsx`:
- Each `ComponentInstance` → custom `HardwareNode` (`<div>` with handles per `HardwarePort`). Handles = `Handle type="source|target" id="${portId}" position` (top/bottom/left/right per port metadata).
- Edges = `HardwareEdge` styled by `domain` (power solid thick, i2c double, uart dashed, etc. per HardwareWebMCP.md).
- Pan/zoom/minimap/controls, drag, selection, `onConnect`→`connectPorts`.
- Do not make React Flow DB: translate `project.connections↔edges` both ways.

### 13. Inspector + properties + picker
`frontend/src/components/inspector/Inspector.tsx` + `ComponentPickerModal.tsx` (copy Velxio pattern: live preview, search, category filters):
- Right panel: selected component's ports table, electrical props, firmware target files, voltage warnings, model coverage (✓ visual ✓ SPICE ✕ validated… per doc).
- Left palette: searchable component library (categories: boards, sensors, motors, displays…).

### 14. Monaco Editor (multi-file workspace)
`frontend/src/components/editor/MonacoWorkspace.tsx`:
- Reuse Velxio `useEditorStore` idea: `fileGroups: Record<groupId, WorkspaceFile[]>`, `FileExplorer` + `FileTabs` + `CodeEditor` (`key={activeFileId}` for undo).
- Compile toolbar: `Compile/Run/Stop/Reset`, console output (same as Velxio `EditorToolbar.tsx`).
- Languages: `cpp` (arduino), `python` (micropython), `c` (esp-idf).

### 15. Web Components rule (pinInfo)
Any board/component needing wires must be Web Component with `get pinInfo():{name,x,y}[]` (Hard rule from Velxio CLAUDE.md §6a). Wrapper `.tsx` thin. Verify wire endpoints not at (0,0) corner.

### 16. Layout (Hardware Studio chrome)
`frontend/src/pages/StudioPage.tsx`:
```
┌─ Header (project name, Save .vlx, Run) ─┐
├─ Left: Components │ Center: Canvas │ Right: Inspector ┤
├─ Bottom: Editor / Serial / Oscilloscope / Errors ──────┤
└────────────────────────────────────────────────────────┘
```
Copy Velxio `EditorPage.tsx` resizable panels.

## Phase 3 — Simulation Core (Plans 17–22, Layer 2)

### 17. SimulationEngine interface (one adapter per engine)
`frontend/src/simulation/SimulationEngine.ts` + `backend/app/simulation/engine.py`:
```ts
interface SimulationEngine { initialize(model:CompiledSubgraph):Promise<void>; advanceTo(timeNs:bigint):Promise<void>; writePort(portId:string,value:PortValue):Promise<void>; readPort(portId:string):Promise<PortValue>; snapshot():Promise<Uint8Array>; restore(s:Uint8Array):Promise<void>; shutdown():Promise<void>; }
type PortValue = {digital?:boolean; analog?:number; bus?:{protocol,address,op,register,length,data}} 
```
One adapter per engine, not per-device.

### 18. Engine adapters (8+ adapters, 4 real now)
`backend/app/engines/`:
- `renode.py` (RenodeAdapter): generate `.repl` platform, spawn Renode `py` worker via `wasmtime`? Actually Renode is C# dotnet; use subprocess `renode --disable-xwt --port 21234`, connect via Monitor telnet `mach create / include @platform.repl / sysbus LoadELF @firmware.elf / start`. Implement 4 handlers: initialize (write repl), advanceTo (runFor), writePort (set GPIO), readPort, snapshot. Reference: `renode-master/src/Emulator/...` + docs `platform_description_format.html`.
- `ngspice.py` (NgspiceAdapter): use `PySpice` or ngspice shared-lib via `ctypes`+callbacks (instead of per-circuit command), plus `ngspice-wasm` lazy chunk for browser fallback (Velxio `SpiceEngine.lazy.ts`). Callback: simulation data, param change, stop/resume. See Velxio `NetlistBuilder.ts` Union-Find.
- `wasmtime.py` (WasmAdapter): `wasmtime.Store`, `Config(wasm_component_model=True)`, `wasmtime.Linker`, sandbox limits (20s epoch, 40 MB), implement `I2CDevice` interfaces via WIT. Reference `wasmtime-main/docs/component` + sandbox example.
- Stubs returning `status:"architecture_ready", supported:false` for: `qemu.py` (QEMU QMP `{"execute":"query-machines"}`; Linux SBC later per doc Third release), `verilator.py` (`verilator --cc top.v && make`), `fmi.py` (FMPy `loadFMU`), `gazebo.py`, `openems.py`, `gnuradio.py`, `meep.py`. Each has `engine.json` metadata for UI "Engine Support" page (✓ vs ○).

### 19. Protocol bridges (reusable per interface)
`simulation/bridges/` (TS + py pair):
- `gpio.ts/py`, `adc.ts`, `pwm.ts`, `i2c.ts` (generic `{protocol:"i2c",controller:"mcu.i2c1",address:0x48,op:"read",register:0x00,length:1,time_ns}` → any sensor responds), `spi.ts`, `uart.ts`, `can.ts`, `usb.ts`, `ethernet.ts`, `pcie.ts`, `mechanical.ts`, `rf.ts`, `optical.ts`.
- Velxio `I2CBusManager` / `SignalRouter` pattern: central bus routes transactions; bridges don't know if device is IMU vs EEPROM.

### 20. High-fidelity offline vs fast runtime model
Per doc § Do not run every engine full fidelity continuously:
- Offline solver (openEMS/Meep) → generate reduced model (S-params, antenna pattern, FOV map) → runtime uses lookup table + `scikit-rf`/`GNU Radio` fast path.
- Implement `backend/app/services/reduce_model.py` (calls offline worker, caches result, serves runtime model).

### 21. Simulation orchestrator & scheduler
`backend/app/simulation/orchestrator.py` (Python now, Rust later per doc):
- Owns `HardwareProject` graph, partitions into `CompiledSubgraph` per engine by `domain`, builds inter-engine edge list, deterministic event queue (`heap` by time_ns), routes `writePort` across bridges.
- Scheduler: `advanceTo` all engines to same time, handle clock domains (Renode 16 MHz, ngspice continuous).
- Crash isolation: each engine is worker process (see next plan), orchestrator restarts failed worker, no single executable merges source trees (per doc § architecture I would actually build → Protobuf/gRPC or local socket).
- Expose `POST /api/simulation/schedule` internal.

### 22. Worker process isolation
`backend/app/simulation/session.py` + `workers/`:
- Spawn `python -m app.workers.renode_worker --port 0` (or dotnet Renode), `ngspice_worker`, `wasm_worker`. Protocol: JSON lines over stdio or gRPC (use `websockets` lib already in requirements). Each worker runs `initialize/advance/write/read/snapshot/restore/shutdown` loop.
- Logs to `logs/<session>.log`. On Windows force `WindowsProactorEventLoopPolicy` (same as Velxio `main.py:14`).

## Phase 4 — Backend & Real-time (Plans 23–26)

### 23. FastAPI backend scaffold
Copy Velxio `backend/app/main.py` pattern: `lifespan`, `CORSMiddleware` (allow localhost:5173-5175 + `tauri://localhost`), `docs_url="/api/docs"`. Routers: `compile`, `components`, `importer`, `simulation`, `projects`.
- `requirements.txt`: `fastapi==0.115.0 uvicorn[standard] websockets>=12 pydantic>=2 pydantic-settings mcp>=1,<2 httpx wasmtime>=20 zstandard PyYAML python-multipart` + later `scikit-rf`/`gnuradio`.

### 24. Compilation pipeline (firmware)
Reuse Velxio `app/services/arduino_cli.py` + `espidf_compiler.py`: `POST /api/compile {files[], board_fqbn}` → arduino-cli → `.hex/.bin/.elf` base64. Also `compile_chip` WASM, `compile_rom`. Needed for MCU simulation.

### 25. WebSocket live channel
`GET /api/simulation/ws` (FastAPI `WebSocket`): client subscribes to projectId, server streams `{type:"pin",pin,state,time_ns}`, `{type:"serial",data}`, `{type:"electrical",net,value}`, `{type:"validation",result}`, `{type:"simulation_state",engineStates}`. Client sends `{op:"set_sensor_input",componentId,key,value}` (e.g. motion=true, temperature=42). Use Velxio's `SignalRouter`/`pin traces`.

### 26. Persistence (.hwpkg, .vlx, SQLite)
- `packages/component-format`: ZIP create/extract.
- `frontend/src/utils/vlxFile.ts` (reuse Velxio): `{format:"velxio-project",version:1,exportedAt,boards,fileGroups,components,wires}` → `Blob download .vlx`.
- Backend `app/database/session.py` (SQLite via `aiosqlite` + SQLAlchemy), tables: `projects`, `components`, `hwpkg_files`.
- `.hwpkg` import = unzip + manifest validation + file type detection (see next).

## Phase 5 — Importer & Behavioral Templates (Plans 27–29)

### 27. Online component importer (pipeline 1→10 per doc)
`backend/app/components/importer.py` + `frontend/src/components/import/ImportDialog.tsx`:
Steps from doc § How "Add component online" should work:
1 search manufacturer libs → 2 download (allow URL upload) → 3 identify format (magic + extension: `.lib/.cir/.sp/.subckt/.model→ngspice`, `.ibs→IBIS`, `.s1p/.s2p→scikit-rf`, `.v/.sv→Verilator`, `.elf/.hex/.bin/.uf2→Renode/QEMU`, `.svd→Renode scaffold`, `.pack→CMSIS-Pack importer` (unzip+pdsc), `.fmu→FMPy`, `.mo→OpenModelica`, `.urdf/.sdf→Gazebo`, `.step/.stp/.iges→OpenCascade`, `.glb/.gltf→renderer`, `PDF→metadata`) →4 license scan →5 extract pins/voltage/current/protocol →6 match symbol pins to model pins (KiCad symbol `kicad_sym` parser) →7 choose engine →8 generate `.hwpkg` →9 run auto tests (validate + simulate minimal circuit) →10 add to catalog. UI shows ✓/✕ per fidelity level, never "fully supported" blanket.

### 28. Level 1 auto import + Level 2 generic templates
- L1: parser maps model→package with no coding (Resistor, cap, diode, op-amp SPICE, RF filter touchstone, STEP mech, existing FMU/Verilog/Renode).
- L2: `behavior: {template:"i2c-register-sensor", address:0x48, registers:[{address:0x00,name:temperature,type:int16,source:"environment.temperature",scale:0.0078125}]}` without C++. Templates cover I2C/SPI sensors, GPIO switches, UART, displays, EEPROM, ADC/DAC, motor drivers, encoders… Implemented as YAML → generated WASM or Renode Python peripheral. File `packages/component-format/templates/i2c-register-sensor.yaml`.

### 29. Level 3 custom code + sandbox
- L3 sources: `behavior.wasm`, Renode Python, Renode C# (compiled via `using` in repl), Verilog, Modelica, GNU Radio block.
- WASM executed in Wasmtime sandbox (20s timeout, 40 MB mem, no file net). UI: `Create custom component → Write WASM (AssemblyScript/Rust) → Compile → Test`.

## Phase 6 — WebMCP Surface (Plans 30–32, centerpiece)

### 30. WebMCP tool registry (15–20 semantic tools, not 100 tiny)
`frontend/src/webmcp/tools.ts` registers on app mount via feature detect:
```ts
const mc = (document as any).modelContext || (navigator as any).modelContext;
if (mc?.registerTool) { await mc.registerTool({name,description,inputSchema,execute,annotations},{signal}) }
```
Tools (per HardwareWebMCP.md § WebMCP part):
- `project.get_graph` / `project.clear`
- `component.search / inspect / import / add / remove`
- `connection.connect / disconnect / get_connections / list_component_ports`
- `component.configure / set_sensor_input / set_power_supply`
- `firmware.write / compile / flash_virtual_device`
- `simulation.run / stop / pause / reset / set_input / get_state / read_pin / read_bus / read_serial / read_oscilloscope`
- `validation.check / explain_error / analyze_power / find_connection_errors`
- `design.auto_layout`
- Each `execute` reuses same Zustand function human UI uses (`hardwareStore.addComponent` same). Return `{content:[{type:"text",text:"..."}]}` or structured. Add `annotations:{readOnlyHint:true}` where appropriate.
- `ontoolchange` listener + `examples/webmcp-smoke.html` for test in Chrome `chrome://flags/#enable-webmcp-testing` (Chromium ≥146).

### 31. Agent-native workflow validation
Manual script `docs/webmcp/agent-walkthrough.md`: single goal → agent does autonomous chain:
```
search_components("ESP32")→ESP32-S3 / search("PIR")→HC-SR501 / add_component×3 / list_ports / connect_ports 3V3→VCC etc / validate_design → warning (no GND) → add GND wire / validate → pass / write_firmware("...") / compile / run_simulation / set_sensor_input(motion:true) / read_serial → "Motion detected. MQTT alert sent." / get_simulation_state
```
No vision click. Test with Chrome AI assistant.

### 32. Multi-domain connection demos (domain bridges)
Implement MCU→motor bridge chain from doc § How the simulation domains connect:
- `Renode MCU --PWM--> ngspice H-bridge --V/I--> OpenModelica motor --torque--> Gazebo wheel → encoder→Renode`.
- `Gazebo world → Virtual camera → CSI/USB → QEMU Linux`.
- `openEMS antenna → GNU Radio DSP → Renode MCU`.
These are data flows through bridges; stubs simulate via mock values until full engines wired.

## Phase 7 — Validation, Repair & Demos (Plans 33–35)

### 33. Validator UI + auto-fix
`frontend/src/components/validation/ValidationPanel.tsx`:
- `validate_design()` lists errors grouped by severity, click `explain_error` → tooltip "SDA requires pullup, no pullup found on net n3". `Fix my hardware` button → agent calls `disconnect/connect/add_component(level_shifter)` → rerun validation.
- Auto-insert logic for level-shifter when voltage domains differ (3.3↔5V).

### 34. Three killer demos (per doc § killer demo)
- **Demo 1 (15s)**: prompt "Build me an ESP32 temp warning with OLED+buzzer" → agent constructs, wires visible, sim runs.
- **Demo 2 (30s)**: "Replace sensor with imported TI DRVxxxx" → importer pipeline, voltage notice, inserts level shifter, rewires, revalidates.
- **Demo 3 (60s)**: "Smart desk assistant: Pi + display + mic/speaker + ESP32 sensor controller + presence sensor + LEDs" → multi-board, Pi simulates Linux service (QEMU stub) + ESP32 firmware, communicate via UART.
- **Wow moment**: break OLED 3.3→5V, remove pullup, swap SDA/SCL → "Fix my hardware" → agent repairs via validate/get_errors/disconnect/connect.

### 35. Artifacts for hackathon submission
- `examples/demo1-vlx/` etc., plus `docs/DEMO_SCRIPT.md` (3 min video storyboard, no AR glasses/phased radar as main demo).

## Phase 8 — Quality, Deploy & Submission (Plans 36–40)

### 36. Tests (Vitest + pytest)
- Frontend: `frontend/src/__tests__/hardware-graph.test.ts`, `validation.test.ts`, `importer.test.ts`, `webmcp-tools.test.ts` (mock modelContext), `canvas.test.tsx` (pinInfo ≠ (0,0)).
- Backend: `backend/tests/test_orchestrator.py`, `test_renode_adapter.py` (mock repl generation + parse), `test_importer.py` (magic detection), `test_wasm_sandbox.py` (timeout).
- Run: `pnpm -r test`, `pytest -q`.

### 37. Build & lint
- `pnpm -r build` (Vite `build:docker` + tsc where needed), `pnpm -r lint` (eslint+prettier), `npm run generate:metadata`-like for component catalog.
- Velxio pattern: Docker build skips `tsc -b`, CI runs `tsc` separately.

### 38. Docker & live URL
- `Dockerfile.standalone` multi-stage (node build frontend → python backend → nginx serve). Copy `LICENSE` (AGPL). Publish to GHCR `ghcr.io/Developer668/schematic:master`. Need live URL for judging — deploy via `fly.io`/`render` or `velxio-prod` overlay pattern. Document `FRONTEND_URL`.

### 39. Docs: README, ARCHITECTURE, WebMCP guide, Engine Support page
- `README.md`: replace Velxio intro with Schematic mission (agent-native workbench where human+AI compose/wire/program/validate/simulate heterogeneous hardware via WebMCP), architecture diagram, `pnpm dev` quickstart, board support table, license table (AGPL).
- `ARCHITECTURE.md` elaborates universal graph + adapters + bridges + offline→runtime model.
- `docs/webmcp/tools.md` lists each tool's schema.
- Engine Support page in UI (like HardwareWebMCP.md § What I would combine table: ✓ firmware/electrical/WASM / ○ robotics/FMI/RF… do not fake).

### 40. Submission checklist & Retrospective
Check: public repo + AGPL visible + live URL responds + WebMCP `getTools()` shows 18 tools + demo video <3m + code builds from clone + tests pass + judges can test in Chrome with #enable-webmcp-testing + no hardcoded device pairs + reuse layers respected. Retrospective doc `docs/RETROSPECTIVE.md`.

---

## Build Order per HardwareWebMCP.md § correct build order

1. **First usable (this sprint)**: Velxio canvas + Renode + ngspice + KiCad/SPICE/STEP/CMSIS importer + Wasmtime → Arduino/ESP32/RP2040/STM32, keyboards/mice functional, alarms/displays/sensors/motors/power/multi-MCU/custom import.
2. **Second release**: QEMU + Verilator + FMI/OMSimulator/OpenModelica → Linux SBCs, FPGA, batteries/thermal/detailed motors.
3. **Third**: Gazebo + Open CASCADE → arms, cameras, LiDAR, placement, collisions.
4. **Final**: scikit-rf + GNU Radio + openEMS + Meep + HIL → radar, antennas, phased arrays, wireless, optics, AR glasses.

## Non-Goals / Guardrails
- No Next.js, no Electron (WebMCP needs browser). Tauri wrap later.
- No per-device hardcode. One universal format + one adapter per engine + one typed connection.
- No claim "fully supported" — show fidelity checklist per component.
- React Flow only renders; TS graph owns state.
- Python orchestrator now; Rust later (scheduler, Wasm runtime, ngspice bindings) when heavy simulations justify it.
- Keep Velxio `third-party/` reference-only pattern unless adding new component metadata (then `scripts/generate-component-metadata.ts`).

## Success Criteria
- `document.modelContext.getTools()` → 18 tools, each reuses same function human UI uses.
- Agent can autonomously build motion alarm via WebMCP without screenshots.
- `validate_design` catches TX-TX, missing pullup, voltage mismatch, I2C collision before simulation.
- Importer turns TI SPICE `.lib` → .hwpkg → appears on canvas with ✓ SPICE, ✕ transistor-silicon.
- `pnpm install && pnpm -r build` clean, `pytest -q` green, live URL green, demo <3m.
