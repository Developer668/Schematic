import { create } from "zustand";

/**
 * Local, ephemeral canvas focus shared by Problems and the graph surface.
 * Connection focus is deliberately not persisted or broadcast: it is only a
 * view concern and must never become project or account-room data.
 */
interface GraphFocusState {
  activeConnectionId: string | null;
  setActiveConnection: (connectionId: string | null) => void;
  clear: () => void;
}

const MAX_CONNECTION_ID_LENGTH = 200;

export const useGraphFocusStore = create<GraphFocusState>((set) => ({
  activeConnectionId: null,
  setActiveConnection(connectionId) {
    const bounded = typeof connectionId === "string"
      && connectionId.trim().length > 0
      && connectionId.length <= MAX_CONNECTION_ID_LENGTH
      ? connectionId
      : null;
    set({ activeConnectionId: bounded });
  },
  clear() { set({ activeConnectionId: null }); },
}));
