/**
 * Universal Hardware Graph — canonical state owned by TypeScript.
 * Per HardwareWebMCP.md: do not let Renode/Velxio define canonical state.
 * Every simulator is an adapter consuming this graph.
 */

// ─── Port domain & direction ─────────────────────────────────────
export type PortDomain =
  | "power"
  | "power_output"
  | "ground"
  | "gpio"
  | "adc"
  | "pwm"
  | "i2c"
  | "spi"
  | "uart"
  | "usb"
  | "ethernet"
  | "can"
  | "pcie"
  | "csi"
  | "hdmi"
  | "displayport"
  | "rf"
  | "mechanical"
  | "optical";

export type PortDirection = "input" | "output" | "bidirectional" | "power";

export interface ElectricalConstraints {
  minVoltage?: number;
  nominalVoltage?: number;
  maxVoltage?: number;
  maxCurrentA?: number;
  requiresPullup?: boolean;
  requiresPulldown?: boolean;
}

export interface ProtocolMeta {
  role?: "controller" | "target" | "host" | "device" | "endpoint" | "root_complex";
  version?: string;
  address?: number; // I2C 7-bit, SPI CS, etc.
  lanes?: number;
  bandwidthMbps?: number;
}

export interface RfMeta {
  impedanceOhm?: number;
  freqMinHz?: number;
  freqMaxHz?: number;
}

export interface HardwarePort {
  id: string;
  name: string;
  domain: PortDomain;
  direction: PortDirection;
  electrical?: ElectricalConstraints;
  protocol?: ProtocolMeta;
  rf?: RfMeta;
  description?: string;
}

// ─── Component definition & instance ─────────────────────────────
export type ModelFidelity =
  | "visual"
  | "spice"
  | "ibis"
  | "rf_sparam"
  | "firmware"
  | "renode"
  | "qemu"
  | "verilog"
  | "fmu"
  | "step"
  | "wasm_behavioral"
  | "python_behavioral"
  | "gazebo"
  | "unknown";

export interface ModelReference {
  engine: string; // renode | ngspice | qemu | verilator | wasmtime | fmi | gazebo | scikit-rf ...
  file: string; // path inside .hwpkg
  fidelity: ModelFidelity;
  verified: boolean;
}

export interface ComponentDefinition {
  id: string; // e.g. "raspberry-pi-5", "bmp280", "ti-drv8871"
  title: string;
  manufacturer?: string;
  partNumber?: string;
  category: "board" | "sensor" | "actuator" | "display" | "power" | "logic" | "communication" | "mechanical" | "rf" | "custom";
  description?: string;
  ports: HardwarePort[];
  models: Record<string, ModelReference>;
  electrical?: { nominalVoltage?: number; maxVoltage?: number; maxCurrentA?: number; powerMw?: number };
  physical?: { widthMm?: number; heightMm?: number; depthMm?: number; weightG?: number };
  datasheetUrl?: string;
  license?: string;
  version?: string;
}

export interface ComponentInstance {
  id: string; // unique in project, e.g. "esp32-1", "bmp280-1"
  definitionId: string;
  position: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  properties: Record<string, unknown>;
  firmwareGroupId?: string; // for boards
  label?: string;
}

// ─── Connections ─────────────────────────────────────────────────
export interface ConnectionEndpoint {
  componentId: string;
  portId: string;
}

export interface Connection {
  id: string;
  source: ConnectionEndpoint;
  target: ConnectionEndpoint;
  domain: PortDomain;
  waypoints?: { x: number; y: number }[];
  color?: string;
  autoRouted?: boolean;
}

// ─── Firmware ────────────────────────────────────────────────────
export type FirmwareLanguage = "arduino" | "micropython" | "espidf" | "c" | "python" | "wasm";

export interface FirmwareFile {
  name: string;
  content: string;
}

export interface FirmwareTarget {
  id: string;
  componentId: string; // board instance
  language: FirmwareLanguage;
  boardFqbn?: string; // arduino:avr:uno etc.
  files: FirmwareFile[];
  compiledArtifact?: { hexB64?: string; elfB64?: string; binB64?: string; success: boolean; log: string };
}

// ─── Simulation config ───────────────────────────────────────────
export interface SimulationConfig {
  mode: "interactive" | "batch";
  durationMs?: number;
  engines: Record<string, { enabled: boolean; fidelity: "fast" | "high" }>;
}

// ─── Project ─────────────────────────────────────────────────────
export interface HardwareProject {
  id: string;
  name: string;
  description?: string;
  components: ComponentInstance[];
  connections: Connection[];
  firmwareTargets: FirmwareTarget[];
  simulation: SimulationConfig;
  createdAt: string;
  updatedAt: string;
  version: 1;
}

export interface ValidationIssue {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  affectedConnections?: string[];
  affectedComponents?: string[];
  autoFix?: { description: string; action: string; params?: Record<string, unknown> };
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
