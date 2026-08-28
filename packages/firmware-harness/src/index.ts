import { DeterministicButtonLedHarness } from "./virtual-io";
import type { BrowserHarness, ButtonLedConfig } from "./types";

export * from "./export";
export * from "./types";
export * from "./wasm";
export { DeterministicButtonLedHarness } from "./virtual-io";

export function createBrowserHarness(config?: ButtonLedConfig): BrowserHarness {
  const harness = new DeterministicButtonLedHarness(config);
  return Object.assign(harness, {
    // This browser object is a bounded TypeScript contract mirror. The C ABI
    // is exercised by the native harness and the exported board project; a
    // compiled C/WASM artifact is not claimed here.
    capabilities: ["deterministic-virtual-io", "browser-contract"] as const,
    supportedFirmware: "button-led-contract" as const,
  });
}
