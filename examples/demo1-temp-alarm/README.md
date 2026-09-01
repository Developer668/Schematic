# Demo 1 — ESP32 Temperature Warning (15s)

> **Historical runtime demo — superseded 2026-08-31.** [ADR-001](../../docs/ADR-001-BEHAVIOR-PLAN-PREVIEW.md) defines the current product path. The compiler/simulation commands below are retained only as historical context and are not available on the canonical ChatGPT Site. Use a typed Behavior Plan and `behavior.preview`/`behavior.invoke` for scripted outcomes; keep generated source as an editable external-use artifact.

**Prompt:** “Build me an ESP32 temperature warning system with an OLED and buzzer.”

Agent does (via WebMCP, no screenshots):

1. `component.search("ESP32")` → ESP32-S3
2. `component.search("BMP280")` → temperature sensor
3. `component.search("SSD1306")` → OLED
4. `component.search("buzzer")` → active buzzer
5. `component.add` ×4 (visible wires self-connecting)
6. `connection.connect` 3V3→VCC, GND→GND, SDA→SDA, SCL→SCL, GPIO18→IN
7. `validation.check` → warns missing pull-ups → agent `component.add(resistor)` ×2 → re-validate → ✓
8. `firmware.write` → `firmware.compile` → `simulation.run`
9. `simulation.set_input(bmp280, temperature, 32)` → `read_serial` → “Temp 32C — Buzzer ON”

Human watches components appear and wires connect themselves, then simulation runs.
