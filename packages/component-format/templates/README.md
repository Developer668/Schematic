# Level 2 Generic Behavioral Templates

Per `HardwareWebMCP.md` § Three levels of adding a new component — Level 2 is **configure a generic template** with only metadata/YAML.

Each file here defines a template that the importer can instantiate without writing C++/C#/Rust:

- `i2c-register-sensor.yaml` — any I2C sensor exposing registers (temperature, pressure, IMU, etc.)
- `gpio-switch.yaml` — button/switch
- `spi-sensor.yaml` (future), `uart-module.yaml`, `display-i2c.yaml`, `eeprom.yaml`, `motor-driver.yaml`, etc.

At import time:
1. User selects template.
2. Fills `address`, `registers` etc. via Inspector.
3. System generates a Wasmtime component (or Renode Python peripheral) from the template — no manual coding.
4. Package `.hwpkg` is produced with `behavior.wasm` + `manifest.yaml`.

Level 3 (custom code) is for proprietary sensors, radar frontends, new MCU peripherals — see `docs/CUSTOM_BEHAVIOR.md`.
