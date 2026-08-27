import { create } from "zustand";

interface SimulationState {
  running: boolean;
  timeNs: bigint;
  serialOutput: string;
  pinStates: Record<string, boolean | number>;
  engineStatus: Record<string, { enabled: boolean; status: string }>;
  start: () => void;
  stop: () => void;
  setPin: (portId: string, value: boolean | number) => void;
  setTime: (timeNs: bigint) => void;
  appendSerial: (chunk: string) => void;
  reset: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
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
  start() {
    set({ running: true });
  },
  stop() {
    set({ running: false });
  },
  setPin(portId, value) {
    set((s) => ({ pinStates: { ...s.pinStates, [portId]: value } }));
  },
  setTime(timeNs) {
    set({ timeNs });
  },
  appendSerial(chunk) {
    set((s) => ({ serialOutput: s.serialOutput + chunk }));
  },
  reset() {
    set({ running: false, timeNs: 0n, serialOutput: "", pinStates: {} });
  },
}));
