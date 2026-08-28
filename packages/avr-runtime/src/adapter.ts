import { sha256Hex } from "./hash";
import { imageToProgram, parseIntelHex } from "./intelHex";
import type {
  ArduinoPinState,
  Avr8jsAdapter,
  AvrCpu,
  Avr8jsModule,
  AvrPort,
  AvrRunOptions,
  AvrRunResult,
  DigitalLevel,
  DigitalOutputEvent,
  IntelHexArtifactLike,
} from "./types";

export const AVR_UNO_FQBN = "arduino:avr:uno";
export const AVR_NANO_FQBN = "arduino:avr:nano";
export const ATMEGA328P_FLASH_BYTES = 32 * 1024;
export const ATMEGA328P_SRAM_BYTES = 8192;

const PIN_LOW = 0;
const PIN_HIGH = 1;
const PIN_INPUT = 2;
const PIN_PULL_UP = 3;

export class AvrRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvrRuntimeError";
  }
}

function assertArduinoPin(pin: number): void {
  if (!Number.isInteger(pin) || pin < 0 || pin > 19) throw new AvrRuntimeError(`Arduino pin ${pin} is outside the Uno/Nano GPIO map`);
}

function portForPin(pin: number, ports: { portB: AvrPort; portC: AvrPort; portD: AvrPort }): { port: AvrPort; bit: number } {
  if (pin <= 7) return { port: ports.portD, bit: pin };
  if (pin <= 13) return { port: ports.portB, bit: pin - 8 };
  return { port: ports.portC, bit: pin - 14 };
}

function publicState(value: number): ArduinoPinState {
  if (value === PIN_LOW) return 0;
  if (value === PIN_HIGH) return 1;
  if (value === PIN_PULL_UP) return "pull-up";
  return "input";
}

export interface UnoAvr8jsAdapterOptions {
  module: Avr8jsModule;
  flashBytes?: number;
  sramBytes?: number;
}

export class UnoAvr8jsAdapter implements Avr8jsAdapter {
  private readonly module: Avr8jsModule;
  private readonly flashBytes: number;
  private readonly sramBytes: number;
  private program: Uint16Array | null = null;
  private cpu: AvrCpu | null = null;
  private ports: { portB: AvrPort; portC: AvrPort; portD: AvrPort } | null = null;
  private loadedArtifactSha256: string | null = null;
  private readonly listeners = new Set<(event: DigitalOutputEvent) => void>();
  private readonly lastOutputs = new Map<number, DigitalLevel>();
  private readonly portListeners = new Map<AvrPort, (value: number, oldValue: number) => void>();

  constructor(options: UnoAvr8jsAdapterOptions) {
    this.module = options.module;
    this.flashBytes = options.flashBytes ?? ATMEGA328P_FLASH_BYTES;
    this.sramBytes = options.sramBytes ?? ATMEGA328P_SRAM_BYTES;
    if (this.flashBytes % 2 !== 0 || this.flashBytes <= 0) throw new AvrRuntimeError("flashBytes must be a positive even number");
  }

  async loadArtifact(artifact: IntelHexArtifactLike): Promise<void> {
    if (artifact.format !== "intel-hex") throw new AvrRuntimeError("only Intel HEX artifacts are accepted by the AVR adapter");
    const exactBytes = artifact.bytes ? new Uint8Array(artifact.bytes) : new TextEncoder().encode(artifact.text);
    const actualHash = await sha256Hex(exactBytes);
    if (actualHash !== artifact.sha256) throw new AvrRuntimeError(`artifact hash mismatch: expected ${artifact.sha256}, got ${actualHash}`);

    const textBytes = new TextEncoder().encode(artifact.text);
    if (textBytes.byteLength !== exactBytes.byteLength || textBytes.some((value, index) => value !== exactBytes[index])) {
      throw new AvrRuntimeError("artifact bytes do not match the exact Intel HEX text");
    }
    const image = parseIntelHex(artifact.text, this.flashBytes);
    this.program = imageToProgram(image, this.flashBytes);
    this.loadedArtifactSha256 = artifact.sha256;
    this.installCpu();
  }

  step(): void {
    if (!this.cpu) throw new AvrRuntimeError("load an Intel HEX artifact before stepping the AVR");
    this.module.avrInstruction(this.cpu);
    this.cpu.tick?.();
  }

  run(instructions: number, options: AvrRunOptions = {}): AvrRunResult {
    if (!Number.isSafeInteger(instructions) || instructions < 0) throw new AvrRuntimeError("instruction count must be a non-negative integer");
    if (!this.cpu) throw new AvrRuntimeError("load an Intel HEX artifact before running the AVR");
    let executedInstructions = 0;
    while (executedInstructions < instructions) {
      if (options.signal?.aborted) return { executedInstructions, cancelled: true };
      this.step();
      executedInstructions += 1;
    }
    return { executedInstructions, cancelled: false };
  }

  reset(): void {
    if (!this.program) throw new AvrRuntimeError("load an Intel HEX artifact before resetting the AVR");
    this.installCpu();
  }

  setDigitalInput(pin: number, value: DigitalLevel): void {
    assertArduinoPin(pin);
    const ports = this.requirePorts();
    const mapped = portForPin(pin, ports);
    mapped.port.setPin(mapped.bit, value === 1);
  }

  readDigital(pin: number): ArduinoPinState {
    assertArduinoPin(pin);
    const ports = this.requirePorts();
    const mapped = portForPin(pin, ports);
    return publicState(mapped.port.pinState(mapped.bit));
  }

  onDigitalOutput(listener: (event: DigitalOutputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getLoadedArtifactSha256(): string | null {
    return this.loadedArtifactSha256;
  }

  getCpuCycles(): number {
    return this.cpu?.cycles ?? 0;
  }

  private requirePorts(): { portB: AvrPort; portC: AvrPort; portD: AvrPort } {
    if (!this.ports) throw new AvrRuntimeError("load an Intel HEX artifact before accessing AVR pins");
    return this.ports;
  }

  private installCpu(): void {
    if (!this.program) throw new AvrRuntimeError("cannot initialize the AVR without a program");
    this.detachPortListeners();
    const cpu = new this.module.CPU(new Uint16Array(this.program), this.sramBytes);
    const ports = {
      portB: new this.module.AVRIOPort(cpu, this.module.portBConfig),
      portC: new this.module.AVRIOPort(cpu, this.module.portCConfig),
      portD: new this.module.AVRIOPort(cpu, this.module.portDConfig),
    };
    this.cpu = cpu;
    this.ports = ports;
    this.lastOutputs.clear();
    this.attachPortListener(ports.portD, 0);
    this.attachPortListener(ports.portB, 8);
    this.attachPortListener(ports.portC, 14);
  }

  private attachPortListener(port: AvrPort, pinOffset: number): void {
    const listener = () => {
      for (let bit = 0; bit < 8; bit += 1) {
        const pin = pinOffset + bit;
        if (pin > 19) break;
        const state = publicState(port.pinState(bit));
        if (state !== 0 && state !== 1) continue;
        const previous = this.lastOutputs.get(pin);
        this.lastOutputs.set(pin, state);
        if (previous === state) continue;
        const event: DigitalOutputEvent = { pin, value: state };
        for (const callback of this.listeners) callback(event);
      }
    };
    port.addListener(listener);
    this.portListeners.set(port, listener);
  }

  private detachPortListeners(): void {
    for (const [port, listener] of this.portListeners) port.removeListener(listener);
    this.portListeners.clear();
  }
}
