/** One adapter per simulation engine (per HardwareWebMCP.md). Each adapter once, not per-device. */
export type PortValue =
  | { type: "digital"; value: boolean }
  | { type: "analog"; value: number }
  | { type: "bus"; value: { protocol: string; address?: number; operation?: string; register?: number; length?: number; data?: number[] } }
  | { type: "pwm"; duty: number };

export interface CompiledSubgraph {
  engine: string;
  components: { id: string; definitionId: string; properties: Record<string, unknown> }[];
  connections: { id: string; source: { componentId: string; portId: string }; target: { componentId: string; portId: string } }[];
}

export interface SimulationEngine {
  readonly name: string;
  initialize(model: CompiledSubgraph): Promise<void>;
  advanceTo(timeNs: bigint): Promise<void>;
  writePort(portId: string, value: PortValue): Promise<void>;
  readPort(portId: string): Promise<PortValue>;
  snapshot(): Promise<Uint8Array>;
  restore(snapshot: Uint8Array): Promise<void>;
  shutdown(): Promise<void>;
}

// ── Stub base for future engines (QEMU, Verilator, FMI, Gazebo, etc.) ──
export class StubEngine implements SimulationEngine {
  constructor(public readonly name: string, public readonly purpose: string) {}
  async initialize(_model: CompiledSubgraph): Promise<void> {}
  async advanceTo(_timeNs: bigint): Promise<void> {}
  async writePort(_portId: string, _value: PortValue): Promise<void> {}
  async readPort(_portId: string): Promise<PortValue> { return { type: "digital", value: false }; }
  async snapshot(): Promise<Uint8Array> { return new Uint8Array(); }
  async restore(_snapshot: Uint8Array): Promise<void> {}
  async shutdown(): Promise<void> {}
}
