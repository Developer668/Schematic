# Demo Script — Under 3 Minutes

> Judging equally on WebMCP leverage / execution / impact / creativity. Don't showcase AR glasses as main demo — build simple→surprising.

## Setup (0:00)

Open Schematic in Chrome 146+ with `chrome://flags/#enable-webmcp-testing` enabled.
Show header: Schematic AGPL-3.0, 10 components in library, 18 WebMCP tools, Run button.

## Demo 1 — Temperature Warning (0:00–0:45, 15s build)

Voice: “Build me an ESP32 temperature warning with OLED and buzzer.”

Agent (WebMCP visible in DevTools `await document.modelContext.getTools()` → `component.search`):
- Visibly: ESP32-S3, BMP280, SSD1306, buzzer appear, wires auto-route (power━━, i2c═).
- `validation.check` → warning: missing pull-ups → agent adds 2× resistor → green.
- `firmware.write` (Arduino sketch shown in Monaco) → `firmware.compile` → log.
- `simulation.run` → `simulation.set_input(bmp280, temperature, 32)` → `read_serial` → “Temp 32C — Buzzer ON”.

**Key line:** “No screenshots — structured `hardware.add_component` / `connect_ports` / `run_simulation`.”

## Demo 2 — TI Import (0:45–1:30, 30s)

Voice: “Replace sensor with this TI DRV8871 I just imported.”

Steps:
- Click Import → choose `drv8871.lib` → Analyze → table shows ✓ SPICE ✕ validated → Add to catalog.
- Agent: `component.inspect(drv8871)` → VIN 6.5-30V, `component.remove(bmp280)` → `component.add(drv8871)` → `connection.connect`.
- `validation.check` → error: voltage mismatch (DRV needs higher VIN) + motor load → agent `component.add` level shifter logic, rewire.
- Re-run `validation.check` → ✓, then `simulation.run` (ngspice H-bridge shows current).

## Demo 3 — Smart Desk Assistant (1:30–2:30, 60s)

Voice: “Build a smart desk: Pi + display + PIR + ESP32 sensor + LEDs.”

Agent builds multi-board (Pi 5 + ESP32-S3):
- Pi (QEMU stub → “Linux service”) ↔ ESP32 via UART bridge (`Pi TX → ESP32 GPIO4`).
- Canvas shows two boards + peripherals.
- `firmware.write` for both boards (Py + Arduino) → `simulation.run` → show `simulation.get_state` pins.
- `set_sensor_input(pir, motion, true)` → Pi serial: “Presence detected — MQTT sent.”

Note: Pi runs simulated Linux service; emphasis is inter-board communication via typed bridges (UART → generic Bridge).

## Wow Moment — “Fix my hardware” (2:30–2:55, 25s)

Manually break it: change OLED to 5V-only variant, delete pull-up resistors, swap SDA/SCL.

Voice: “Fix my hardware.”

Agent chain: `validate_design` → 3 errors listed → `explain_error(VOLTAGE_MISMATCH)` → `disconnect_ports` → `connect_ports` (cross-correct) → `add_component(resistor)` ×2 → `add_component(level-shifter)` → `validate` → green → `run_simulation` → fixed.

## Close (2:55–3:00)

Tagline: “An agent-native workbench — humans visually design, any WebMCP agent can understand the graph, wire, program, simulate, and repair — without vision clicking. Built on Velxio + Renode + ngspice + Wasmtime, AGPL-3.0, architecture ready for QEMU/Verilator/Gazebo/RF.”

Footer: live URL, repo, license, Engine Support page (✓ vs ○, no faking).
