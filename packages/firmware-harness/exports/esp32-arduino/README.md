# ESP32 Arduino export

This is a bounded, reproducible export of the `button-led-contract`. It
contains the portable C core and a small Arduino board adapter, so the core
logic is shared with the native contract test. The browser implementation
executes the same portable core through the verified C-to-WASM button-led
adapter; other firmware and device-specific libraries remain outside this
bounded contract.

- Arduino CLI target: `esp32:esp32:esp32`
- PlatformIO target: `espressif32 / esp32dev`
- Button: GPIO4 with `INPUT_PULLUP`; pressed is `LOW`
- LED: GPIO2; on while the button is pressed
- Shared core: `src/firmware_harness.c` with `include/firmware_harness.h`

The export is source-only by design: the target device compiler and ESP32 core must be installed on the machine
that will flash the board. A caller must run its own compiler detection and must not present a board binary when
`arduino-cli` or the board core is unavailable. The browser’s compiled C/WASM artifact is a separate, verified
build step and is not an ESP32 firmware binary.

The browser artifact and metadata are checked-in release inputs so a clean site deployment does not need Clang,
LLD, or Docker. Run `pnpm --filter @schematic/firmware-harness build:wasm:required` after changing the portable
C sources; the site builds run `verify:wasm`, which checks the artifact hash, source hash, ABI, exports, and recorded
compiler/linker versions without rebuilding it.
