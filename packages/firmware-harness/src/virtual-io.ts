import type { ButtonLedConfig, DigitalLevel, HarnessSnapshot, IoEvent } from "./types";

const DEFAULT_CONFIG: Required<ButtonLedConfig> = {
  buttonPin: 4,
  ledPin: 2,
  activeLow: true,
};

function validateConfig(config: ButtonLedConfig): Required<ButtonLedConfig> {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  if (!Number.isInteger(resolved.buttonPin) || !Number.isInteger(resolved.ledPin)) {
    throw new Error("Button and LED pins must be integers.");
  }
  if (resolved.buttonPin < 0 || resolved.ledPin < 0 || resolved.buttonPin === resolved.ledPin) {
    throw new Error("Button and LED pins must be distinct non-negative pins.");
  }
  return resolved;
}

export class DeterministicButtonLedHarness {
  private readonly config: Required<ButtonLedConfig>;
  private readonly pins = new Map<number, DigitalLevel>();
  private events: IoEvent[] = [];
  private tick = 0;

  constructor(config: ButtonLedConfig = DEFAULT_CONFIG) {
    this.config = validateConfig(config);
    this.reset();
  }

  setDigitalInput(pin: number, value: DigitalLevel): void {
    if (pin !== this.config.buttonPin) {
      throw new Error(`Pin ${pin} is not a configured digital input.`);
    }
    this.pins.set(pin, value);
  }

  step(): HarnessSnapshot {
    const button = this.pins.get(this.config.buttonPin) ?? (this.config.activeLow ? 1 : 0);
    const pressed = this.config.activeLow ? button === 0 : button === 1;
    const led: DigitalLevel = pressed ? 1 : 0;
    if (this.pins.get(this.config.ledPin) !== led) {
      this.pins.set(this.config.ledPin, led);
      this.events.push({ tick: this.tick, pin: this.config.ledPin, value: led });
    }
    this.tick += 1;
    return this.snapshot();
  }

  readDigital(pin: number): DigitalLevel {
    return this.pins.get(pin) ?? 0;
  }

  reset(): void {
    this.pins.clear();
    this.events = [];
    this.tick = 0;
    this.pins.set(this.config.buttonPin, this.config.activeLow ? 1 : 0);
    this.pins.set(this.config.ledPin, 0);
  }

  snapshot(): HarnessSnapshot {
    return {
      tick: this.tick,
      pins: Object.freeze(Object.fromEntries(this.pins)),
      events: Object.freeze(this.events.map((event) => ({ ...event }))),
    };
  }
}
