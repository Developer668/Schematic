import type { ButtonLedConfig, Esp32ExportManifest, FirmwareCapabilityReport } from "./types";

export const ESP32_BUTTON_LED: ButtonLedConfig = {
  buttonPin: 4,
  ledPin: 2,
  activeLow: true,
};

export function getEsp32ExportManifest(
  pins: ButtonLedConfig = ESP32_BUTTON_LED,
): Esp32ExportManifest {
  return {
    schemaVersion: 1,
    board: { name: "ESP32 Dev Module", fqbn: "esp32:esp32:esp32", framework: "arduino" },
    firmware: { entrypoint: "src/main.cpp", contract: "button-led-contract", pins },
    dependencies: { manager: "arduino-library-manager", libraries: [] },
    licenses: { application: "AGPL-3.0-only", thirdParty: [] },
  };
}

export function detectFirmwareCapability(options: {
  browserContract?: boolean;
  nativeToolchain?: "available" | "unavailable";
} = {}): FirmwareCapabilityReport {
  if (options.browserContract === true) {
    return {
      supported: true,
      mode: "browser-contract",
      reason: "A bounded TypeScript browser contract is available for API consumers; compiled C/WASM execution is not claimed by this generic capability report. The browser site separately ships a verified C/WASM button-led target.",
    };
  }
  if (options.nativeToolchain === "available") {
    return {
      supported: true,
      mode: "native-build",
      reason: "A native toolchain is available; compile output must still be validated for the target board.",
    };
  }
  return {
    supported: false,
    mode: "unsupported",
    reason: "No supported compiler was detected. No firmware artifact is claimed or fabricated.",
  };
}
