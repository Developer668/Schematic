import type { ModelFamily, SimulationSupport } from "./modelContract.ts";

/**
 * The small, portable adapter surface understood by protocolRuntime.
 *
 * This is intentionally a registry, not a simulator. An adapter names the
 * deterministic behavior the browser runtime can execute and makes the
 * unsupported boundary inspectable by the catalog and tests.
 */
export type CapabilityAdapterId =
  | "unsupported"
  | "mcu-gpio"
  | "digital-input"
  | "digital-output"
  | "pwm-actuator"
  | "adc-source"
  | "i2c-register"
  | "i2c-register-transport"
  | "i2c-display-text"
  | "i2c-display-transport"
  | "spi-transport"
  | "uart-transport";

export interface CapabilityRegistryEntry {
  adapterId: CapabilityAdapterId;
  family: ModelFamily;
  support: SimulationSupport;
  operations: readonly string[];
  reason: string;
}

const ADAPTERS: Record<CapabilityAdapterId, Omit<CapabilityRegistryEntry, "adapterId">> = {
  unsupported: {
    family: "metadata-only",
    support: "validation",
    operations: [],
    reason: "Catalog metadata and wiring validation are available; no deterministic device adapter is assigned.",
  },
  "mcu-gpio": {
    family: "mcu",
    support: "behavioral",
    operations: ["gpio", "adc", "pwm", "i2c", "spi", "uart", "serial", "delay"],
    reason: "Portable firmware calls are evaluated against the connected virtual nets.",
  },
  "digital-input": {
    family: "digital-input",
    support: "behavioral",
    operations: ["gpio-input"],
    reason: "A deterministic digital input follows its injected signal.",
  },
  "digital-output": {
    family: "digital-output",
    support: "behavioral",
    operations: ["gpio-output"],
    reason: "A digital output records the value driven onto its connected net.",
  },
  "pwm-actuator": {
    family: "pwm-actuator",
    support: "behavioral",
    operations: ["pwm", "actuator-state"],
    reason: "PWM duty is mapped deterministically to actuator state.",
  },
  "adc-source": {
    family: "adc-source",
    support: "behavioral",
    operations: ["adc", "analog-input"],
    reason: "An injected or configured analog value is returned through ADC reads.",
  },
  "i2c-register": {
    family: "i2c-register",
    support: "behavioral",
    operations: ["i2c", "register-read", "register-write"],
    reason: "The model exposes a deterministic byte-register device on its declared address.",
  },
  "i2c-register-transport": {
    family: "i2c-register",
    support: "validation",
    operations: ["i2c", "transport-trace"],
    reason: "I²C wiring and transactions are traced; this exact device has no verified register behavior.",
  },
  "i2c-display-text": {
    family: "i2c-display",
    support: "behavioral",
    operations: ["i2c", "display-text"],
    reason: "Printable I²C payload bytes are captured as display text; pixels and controller timing are not simulated.",
  },
  "i2c-display-transport": {
    family: "i2c-display",
    support: "validation",
    operations: ["i2c", "transport-trace"],
    reason: "I²C wiring and transactions are traced; this display has no verified text or pixel behavior.",
  },
  "spi-transport": {
    family: "spi-device",
    support: "validation",
    operations: ["spi", "transport-trace"],
    reason: "SPI wiring and transfers are traced; this device has no verified response model.",
  },
  "uart-transport": {
    family: "uart-device",
    support: "validation",
    operations: ["uart", "serial", "transport-trace"],
    reason: "UART bytes are traced; this device has no verified protocol model.",
  },
};

const EXACT_ADAPTERS: Record<string, CapabilityAdapterId> = {
  ds3231: "i2c-register",
  "ds3231-2": "i2c-register",
  "ds3231-3": "i2c-register",
  ssd1306: "i2c-display-text",
  "ssd1306-i2c-4pin": "i2c-display-text",
  "ssd1306-128x32": "i2c-display-text",
  "ssd1306-0-96-blue": "i2c-display-text",
};

export function capabilityAdapterId(family: ModelFamily, support: SimulationSupport, definitionId: string): CapabilityAdapterId {
  const exact = EXACT_ADAPTERS[definitionId.toLowerCase()];
  if (exact) return exact;
  if (family === "i2c-register") return support === "behavioral" || support === "engine-backed" ? "i2c-register" : "i2c-register-transport";
  if (family === "i2c-display") return support === "behavioral" || support === "engine-backed" ? "i2c-display-text" : "i2c-display-transport";
  if (family === "spi-device") return "spi-transport";
  if (family === "uart-device") return "uart-transport";
  if (support !== "behavioral" && support !== "engine-backed") return "unsupported";
  if (family === "mcu") return "mcu-gpio";
  if (family === "digital-input") return "digital-input";
  if (family === "digital-output") return "digital-output";
  if (family === "pwm-actuator") return "pwm-actuator";
  if (family === "adc-source") return "adc-source";
  return "unsupported";
}

export function capabilityRegistryEntry(adapterId: CapabilityAdapterId): CapabilityRegistryEntry {
  return { adapterId, ...ADAPTERS[adapterId] };
}

export function capabilityRegistryEntries(): CapabilityRegistryEntry[] {
  return (Object.keys(ADAPTERS) as CapabilityAdapterId[]).map(capabilityRegistryEntry);
}

export interface CatalogModelLike {
  id: string;
  model: { adapterId: CapabilityAdapterId; support: SimulationSupport; family: ModelFamily };
}

/** Returns auditable counts without coupling the registry to catalog storage. */
export function catalogCapabilityCoverage(definitions: CatalogModelLike[]) {
  const coverage: Record<CapabilityAdapterId, number> = {
    unsupported: 0,
    "mcu-gpio": 0,
    "digital-input": 0,
    "digital-output": 0,
    "pwm-actuator": 0,
    "adc-source": 0,
    "i2c-register": 0,
    "i2c-register-transport": 0,
    "i2c-display-text": 0,
    "i2c-display-transport": 0,
    "spi-transport": 0,
    "uart-transport": 0,
  };
  for (const definition of definitions) coverage[definition.model.adapterId] += 1;
  return coverage;
}
