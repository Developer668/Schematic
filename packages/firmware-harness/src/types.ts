export type DigitalLevel = 0 | 1;

export type HarnessCapability =
  | "deterministic-virtual-io"
  | "browser-contract"
  | "compiled-c-wasm"
  | "native-board-export";

export interface ButtonLedConfig {
  buttonPin: number;
  ledPin: number;
  activeLow?: boolean;
}

export interface IoEvent {
  tick: number;
  pin: number;
  value: DigitalLevel;
}

export interface HarnessSnapshot {
  tick: number;
  pins: Readonly<Record<number, DigitalLevel>>;
  events: readonly IoEvent[];
}

export interface BrowserHarness {
  readonly capabilities: readonly HarnessCapability[];
  readonly supportedFirmware: "button-led-contract";
  setDigitalInput(pin: number, value: DigitalLevel): void;
  step(): HarnessSnapshot;
  readDigital(pin: number): DigitalLevel;
  reset(): void;
  snapshot(): HarnessSnapshot;
}

export interface FirmwareCapabilityReport {
  supported: boolean;
  mode: "browser-contract" | "native-build" | "unsupported";
  reason: string;
}

export interface Esp32ExportManifest {
  schemaVersion: 1;
  board: {
    name: "ESP32 Dev Module";
    fqbn: "esp32:esp32:esp32";
    framework: "arduino";
  };
  firmware: {
    entrypoint: "src/main.cpp";
    contract: "button-led-contract";
    pins: ButtonLedConfig;
  };
  dependencies: {
    manager: "arduino-library-manager";
    libraries: readonly [];
  };
  licenses: {
    application: "AGPL-3.0-only";
    thirdParty: readonly [];
  };
}
