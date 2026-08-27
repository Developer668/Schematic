import { create } from "zustand";
import type { RuntimeResult } from "../simulation/runtime.ts";

interface SimulationState {
  running: boolean;
  timeNs: bigint;
  serialOutput: string;
  pinStates: Record<string, boolean | number>;
  engineStatus: Record<string, { enabled: boolean; status: string }>;
  lastRun: RuntimeResult | null;
  start: () => void;
  stop: () => void;
  setPin: (portId: string, value: boolean | number) => void;
  setTime: (timeNs: bigint) => void;
  appendSerial: (chunk: string) => void;
  setLastRun: (lastRun: RuntimeResult | null) => void;
  reset: () => void;
}

type SimulationSnapshot = Pick<SimulationState, "running" | "timeNs" | "serialOutput" | "pinStates" | "engineStatus" | "lastRun">;

const simulationChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-simulation-sync") : null;

function snapshot(state: SimulationState): SimulationSnapshot {
  return { running: state.running, timeNs: state.timeNs, serialOutput: state.serialOutput, pinStates: state.pinStates, engineStatus: state.engineStatus, lastRun: state.lastRun };
}

function publishSimulation(state: SimulationState) {
  simulationChannel?.postMessage({ type: "simulation:update", state: snapshot(state) });
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  running: false,
  timeNs: 0n,
  serialOutput: "",
  pinStates: {},
  engineStatus: {
    renode: { enabled: true, status: "ready" },
    ngspice: { enabled: true, status: "ready" },
    wasmtime: { enabled: true, status: "ready" },
    qemu: { enabled: false, status: "architecture_ready" },
    verilator: { enabled: false, status: "architecture_ready" },
  },
  lastRun: null,
  start() {
    set({ running: true });
    publishSimulation(get());
  },
  stop() {
    set({ running: false });
    publishSimulation(get());
  },
  setPin(portId, value) {
    set((s) => ({ pinStates: { ...s.pinStates, [portId]: value } }));
    publishSimulation(get());
  },
  setTime(timeNs) {
    set({ timeNs });
    publishSimulation(get());
  },
  appendSerial(chunk) {
    set((s) => ({ serialOutput: s.serialOutput + chunk }));
    publishSimulation(get());
  },
  setLastRun(lastRun) {
    set({ lastRun });
    publishSimulation(get());
  },
  reset() {
    set({ running: false, timeNs: 0n, serialOutput: "", pinStates: {}, lastRun: null });
    publishSimulation(get());
  },
}));

simulationChannel?.addEventListener("message", (event) => {
  if (event.data?.type !== "simulation:update" || !event.data.state) return;
  useSimulationStore.setState(event.data.state as SimulationSnapshot);
});
