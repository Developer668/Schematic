# Judge demo — under 3 minutes

This script uses the supported ChatGPT Site path only. Open the authenticated
[live Site](https://schematic-hardware-workspace.decipherer71.chatgpt.site)
inside the ChatGPT in-app browser. Ask ChatGPT to use the Site's **native
WebMCP** surface; do not use visual clicking as the agent interface. If the
in-app browser does not expose native `modelContext`, say that the host
capability is unavailable and do not present a compatibility shim as native
discovery.

## 0:00–0:20 — Discover the contract

Prompt: “Inspect the Schematic Site's native WebMCP tools and report the tool
count. Read the current project graph.”

The agent calls `project.get_graph` and reports **42 tools**. Point out that
the tool activity panel and the visible graph are driven by the same store
actions.

## 0:20–0:55 — Build a real graph

Prompt: “Find an ESP32 DevKit, a pushbutton, and an LED. Add one of each to
this project, inspect their ports, and connect the button to GPIO18 and the LED
to GPIO19.”

Expected tool sequence:

1. `component.search` for `ESP32`, `pushbutton`, and `LED`.
2. `component.add` for `esp32-devkit-v1`, `pushbutton`, and `led` (omit
   coordinates for collision-aware placement, or provide finite pairs).
3. `component.list_ports` for the three instance IDs.
4. `connection.connect` for board `GPIO18 → button A` and board `GPIO19 → LED
IN`.
5. `validation.check` to show the typed validation result; continue only when
   there are no blocking errors.

Read the returned instance IDs and endpoints aloud; the point is that the
agent is manipulating a structured hardware graph, not guessing canvas
coordinates.

## 0:55–1:30 — Write the exact portable firmware

Prompt: “Write this exact button-to-LED sketch for the ESP32 board, then check
the firmware.”

Use one `main.ino` file with this source:

```cpp
constexpr int BUTTON_PIN = 18;
constexpr int LED_PIN = 19;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(LED_PIN, pressed);
  delay(10);
}
```

Call `firmware.write`, then `firmware.check`. Explain that this exact grammar
is intentionally recognized to select a fixed precompiled portable C/WASM
implementation. The matched sketch is not compiled into or executed by WASM;
this is not a general C/C++ compiler.

## 1:30–2:00 — Prove pressed and released behavior

1. Call `simulation.set_input` with the button instance ID, key `pressed`, and
   value `true`.
2. Call `simulation.run` with `durationMs: 50`.
3. Show the result's `executionEngine: "c-wasm"`, `contract: "button-led"`,
   `abiVersion: 2`, 64-character `artifactSha256`, resolved board pins, and
   LED output `true`.
4. Set `pressed` to `false` and run again. Show the same ABI/hash metadata and
   LED output `false`.

The important claim is exact execution of the fixed C/WASM semantic contract
with deterministic virtual I/O, not execution of arbitrary matched source, a
screenshot, or a simulated compiler log.

## 2:00–2:25 — Show an honest unsupported result

Prompt: “Try this unsupported sketch and report the boundary; do not invent a
binary.” Replace the board source temporarily with a sketch that calls an
unsupported API, for example:

```cpp
void setup() { Wire.foo(); }
void loop() {}
```

Call `firmware.write` and `simulation.run`. Show the structured
`unsupported-api`/unsupported-API result and its `unsupportedApis` entry. Say:
“The Site reports the unsupported contract explicitly. It does not pretend to
compile or run an arbitrary sketch.”

## 2:25–2:55 — Restore and persist

Restore the exact button→LED source with `firmware.write`, then call
`project.save` and `project.get_graph`. Reload the Site or switch away and back;
call `project.list`/`project.get_graph` to show the project name, three
components, two connections, and firmware target remain in the browser-local
verified-user room.

## 2:55–3:00 — Close with precise scope

“Schematic gives a ChatGPT agent a structured hardware graph and 42 native
WebMCP operations. This release proves the exact button→LED C/WASM contract,
uses a bounded TypeScript interpreter for other supported behavior, persists
the project locally, and reports unsupported work explicitly. The Site API is
same-origin and Site compilation is preflight-only.”
