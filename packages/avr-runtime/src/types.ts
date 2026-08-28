export type DigitalLevel = 0 | 1;

export type ArduinoPinState = DigitalLevel | "input" | "pull-up";

export interface AvrCpu {
  cycles: number;
  pc?: number;
  tick?: () => void;
}

export type AvrGpioListener = (value: number, oldValue: number) => void;

export interface AvrPort {
  addListener(listener: AvrGpioListener): void;
  removeListener(listener: AvrGpioListener): void;
  pinState(index: number): number;
  setPin(index: number, value: boolean): void;
}

/** Structural subset of avr8js needed by the Uno CPU/GPIO adapter. */
export interface Avr8jsModule {
  CPU: new (program: Uint16Array, sramBytes?: number) => AvrCpu;
  avrInstruction(cpu: AvrCpu): void;
  AVRIOPort: new (cpu: AvrCpu, config: unknown) => AvrPort;
  portBConfig: unknown;
  portCConfig: unknown;
  portDConfig: unknown;
}

export interface IntelHexArtifactLike {
  format: "intel-hex";
  text: string;
  /** Exact UTF-8 file bytes. Optional for callers that only persisted text. */
  bytes?: Uint8Array;
  sha256: string;
  targetFqbn?: string;
}

export interface AvrRunOptions {
  signal?: AbortSignal;
}

export interface AvrRunResult {
  executedInstructions: number;
  cancelled: boolean;
}

export interface DigitalOutputEvent {
  pin: number;
  value: DigitalLevel;
}

export interface Avr8jsAdapter {
  loadArtifact(artifact: IntelHexArtifactLike): Promise<void>;
  step(): void;
  run(instructions: number, options?: AvrRunOptions): AvrRunResult;
  reset(): void;
  setDigitalInput(pin: number, value: DigitalLevel): void;
  readDigital(pin: number): ArduinoPinState;
  onDigitalOutput(listener: (event: DigitalOutputEvent) => void): () => void;
  getLoadedArtifactSha256(): string | null;
  getCpuCycles(): number;
}
