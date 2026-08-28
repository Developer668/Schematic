import { create } from "zustand";
import type { RuntimeResult } from "../simulation/runtime.ts";
import { getCurrentUserId } from "../auth/session.ts";

interface SimulationState {
  running: boolean;
  timeNs: bigint;
  serialOutput: string;
  pinStates: Record<string, boolean | number>;
  engineStatus: Record<string, { enabled: boolean; status: string }>;
  lastRun: RuntimeResult | null;
  remoteSessionId: string | null;
  start: () => void;
  stop: () => void;
  setPin: (portId: string, value: boolean | number) => void;
  setTime: (timeNs: bigint) => void;
  appendSerial: (chunk: string) => void;
  setLastRun: (lastRun: RuntimeResult | null) => void;
  setRemoteSessionId: (sessionId: string | null) => void;
  reset: () => void;
}

type SimulationSnapshot = Pick<SimulationState, "running" | "timeNs" | "serialOutput" | "pinStates" | "engineStatus" | "lastRun" | "remoteSessionId">;

const simulationChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-simulation-sync") : null;

function snapshot(state: SimulationState): SimulationSnapshot {
  return { running: state.running, timeNs: state.timeNs, serialOutput: state.serialOutput, pinStates: state.pinStates, engineStatus: state.engineStatus, lastRun: state.lastRun, remoteSessionId: state.remoteSessionId };
}

function publishSimulation(state: SimulationState) {
  simulationChannel?.postMessage({ type: "simulation:update", room: getCurrentUserId(), state: snapshot(state) });
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  running: false,
  timeNs: 0n,
  serialOutput: "",
  pinStates: {},
  engineStatus: {
    behavioral: { enabled: true, status: "available" },
    renode: { enabled: false, status: "unsupported" },
    ngspice: { enabled: false, status: "unsupported" },
    wasmtime: { enabled: false, status: "unsupported" },
    qemu: { enabled: false, status: "unsupported" },
    verilator: { enabled: false, status: "unsupported" },
  },
  lastRun: null,
  remoteSessionId: null,
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
  setRemoteSessionId(remoteSessionId) {
    set({ remoteSessionId });
    publishSimulation(get());
  },
  reset() {
    set({ running: false, timeNs: 0n, serialOutput: "", pinStates: {}, lastRun: null, remoteSessionId: null });
    publishSimulation(get());
  },
}));

simulationChannel?.addEventListener("message", (event) => {
  if (event.data?.type !== "simulation:update" || !event.data.state) return;
  if ((event.data.room ?? null) !== getCurrentUserId()) return;
  useSimulationStore.setState({ ...(event.data.state as SimulationSnapshot), remoteSessionId: event.data.state.remoteSessionId ?? null });
});
