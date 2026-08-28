import type { HardwarePort } from "@schematic/hardware-graph";
import { capabilityAdapterId, type CapabilityAdapterId } from "./capabilityRegistry.ts";

/**
 * The support contract shown to people and agents before a part is used.
 *
 * A catalog entry can always be placed, but only entries with a behavioral or
 * engine-backed contract may participate in an executable simulation.  Keeping
 * this separate from the engine implementation lets the catalog describe
 * honest coverage without pretending that a generic pin map is a device
 * model.
 */
export type SimulationSupport = "visual" | "validation" | "behavioral" | "engine-backed";

export type ModelFamily =
  | "mcu"
  | "digital-input"
  | "digital-output"
  | "pwm-actuator"
  | "adc-source"
  | "i2c-register"
  | "i2c-display"
  | "spi-device"
  | "uart-device"
  | "logic"
  | "passive-electrical"
  | "metadata-only";

export interface ComponentModelContract {
  version: 1;
  family: ModelFamily;
  support: SimulationSupport;
  capabilities: string[];
  verified: boolean;
  source: "family-template" | "catalog-model" | "vendor-reference" | "none";
  modelId: string;
  adapterId: CapabilityAdapterId;
  reason?: string;
}

export interface ModelDescriptor {
  id: string;
  title: string;
  category: string;
  description?: string;
  tags?: string[];
  ports: HardwarePort[];
  models?: Record<string, { fidelity?: string; verified?: boolean }>;
}

const MODEL_VERSION = 1 as const;

function textOf(definition: ModelDescriptor) {
  return [definition.id, definition.title, definition.description, ...(definition.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
}

function hasPort(definition: ModelDescriptor, domain: string) {
  return definition.ports.some((port) => port.domain === domain);
}

const BEHAVIORAL_MCU_IDS = new Set([
  "arduino-uno",
  "arduino-uno-r3",
  "arduino-nano",
  "esp32-devkit-v1",
  "raspberry-pi-pico",
  "raspberry-pi-pico-w",
]);

const BEHAVIORAL_DIGITAL_INPUT_IDS = new Set([
  "pushbutton",
  "pushbutton-6mm",
  "slide-switch",
  "tilt-switch",
  "pir-motion-sensor",
  "hc-sr501-pir",
  "am312-pir",
]);

const BEHAVIORAL_DIGITAL_OUTPUT_IDS = new Set([
  "led",
  "led-10mm-red",
  "ws2812b-1-led",
  "buzzer",
  "active-buzzer",
]);

const BEHAVIORAL_PWM_ACTUATOR_IDS = new Set([
  "servo",
  "servo-9g-sg90",
  "servo-ds3218",
  "servo-jx6221",
  "servo-mg90s",
  "mg996r-servo",
]);

const BEHAVIORAL_ADC_SOURCE_IDS = new Set([
  "potentiometer",
  "slide-potentiometer",
  "tmp36-temp",
  "lm35-temp",
  "lm35-2",
  "photoresistor-sensor",
  "sharp-gp2y0a02-distance",
  "sharp-gp2y0a02-150",
  "uv-sensor-guva-s12sd",
]);

const BEHAVIORAL_I2C_DISPLAY_IDS = new Set([
  "ssd1306",
  "ssd1306-i2c-4pin",
  "ssd1306-128x32",
  "ssd1306-0-96-blue",
]);

function isDs3231(definition: ModelDescriptor) {
  return /^ds3231(?:-\d+)?$/i.test(definition.id) || definition.tags?.some((tag) => /^ds3231$/i.test(tag)) === true;
}

function contract(
  family: ModelFamily,
  support: SimulationSupport,
  capabilities: string[],
  definition: ModelDescriptor,
  source: ComponentModelContract["source"] = "family-template",
  reason?: string,
  modelId = `${family}:v${MODEL_VERSION}`,
  verified = Boolean(Object.values(definition.models ?? {}).find(Boolean)?.verified),
): ComponentModelContract {
  return {
    version: MODEL_VERSION,
    family,
    support,
    capabilities: [...new Set(capabilities)],
    verified,
    source,
    modelId,
    adapterId: capabilityAdapterId(family, support, definition.id),
    reason,
  };
}

/**
 * Infer a reusable, explicit model family for a catalog definition.
 *
 * This is deliberately conservative: names can select a family template for
 * common hardware, but an unknown part remains validation-only instead of
 * silently becoming an executable GPIO device.
 */
export function inferModelContract(definition: ModelDescriptor): ComponentModelContract {
  const text = textOf(definition);
  const capabilities = definition.ports.map((port) => port.domain);

  if (definition.category === "board") {
    return BEHAVIORAL_MCU_IDS.has(definition.id)
      ? contract("mcu", "behavioral", ["firmware", "gpio", "serial", ...capabilities], definition)
      : contract("mcu", "validation", ["typed-ports", ...capabilities], definition, "none", "The board has no verified browser firmware model yet.");
  }

  if (BEHAVIORAL_DIGITAL_INPUT_IDS.has(definition.id) && hasPort(definition, "gpio")) {
    return contract("digital-input", "behavioral", ["digital-input", "gpio"], definition);
  }

  if (BEHAVIORAL_PWM_ACTUATOR_IDS.has(definition.id) && hasPort(definition, "pwm")) {
    return contract("pwm-actuator", "behavioral", ["gpio", "pwm", "actuator-state"], definition);
  }

  if (BEHAVIORAL_DIGITAL_OUTPUT_IDS.has(definition.id) && hasPort(definition, "gpio")) {
    return contract("digital-output", "behavioral", ["gpio", "actuator-state"], definition);
  }

  if (definition.category === "display" || /(oled|lcd|epaper|e-paper|tft|matrix|ht16k33|tm1637)/.test(text)) {
    if (hasPort(definition, "i2c")) {
      return BEHAVIORAL_I2C_DISPLAY_IDS.has(definition.id)
        ? contract("i2c-display", "behavioral", ["i2c", "display-state", "display-text"], definition, "catalog-model", "Deterministic printable-text capture over I²C; pixels and controller timing are not emulated.", "i2c-display-text:v1", false)
        : contract("i2c-display", "validation", ["i2c", "display-state"], definition, "none", "A device-specific display protocol model has not been assigned yet.");
    }
    if (hasPort(definition, "spi")) return contract("spi-device", "validation", ["spi", "display-state"], definition, "none", "A device-specific display protocol model has not been assigned yet.");
  }

  if (hasPort(definition, "i2c")) {
    return isDs3231(definition)
      ? contract("i2c-register", "behavioral", ["i2c", "register-read", "rtc"], definition, "catalog-model", "Deterministic DS3231 clock and register-read model; power, ground, and control-register writes are validated but not emulated.", "ds3231-register-read:v1", false)
      : contract("i2c-register", "validation", ["i2c", "register-read", "register-write"], definition, "none", "I²C wiring is validated, but this exact device has no executable register model yet.");
  }

  if (hasPort(definition, "spi")) {
    return contract("spi-device", "validation", ["spi", "register-read", "register-write"], definition, "none", "SPI wiring is validated, but this exact device has no executable protocol model yet.");
  }

  if (hasPort(definition, "uart")) {
    return contract("uart-device", "validation", ["uart", "serial"], definition, "none", "UART wiring is validated, but this exact device has no executable protocol model yet.");
  }

  if (BEHAVIORAL_ADC_SOURCE_IDS.has(definition.id) && hasPort(definition, "adc")) {
    return contract("adc-source", "behavioral", ["adc", "analog-input"], definition);
  }

  if (definition.category === "logic" || /(logic|74hc|74ls|mux|shift|opamp|comparator)/.test(text)) {
    return contract("logic", "validation", ["logic"], definition, "none", "A device-specific logic model has not been assigned yet.");
  }

  if (definition.category === "passive" || definition.category === "power" || definition.category === "analog") {
    return contract("passive-electrical", "validation", ["electrical-validation"], definition, "none", "Electrical validation metadata is available; an executable SPICE model is not assigned.");
  }

  return contract("metadata-only", "validation", ["typed-ports"], definition, "none", "This part has catalog metadata but no executable behavioral model yet.");
}
