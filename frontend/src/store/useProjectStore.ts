import { create } from "zustand";
import { catalog } from "../data/catalog.ts";

export interface HardwareGraph {
  id: string;
  name: string;
  components: { id: string; definitionId: string; position: { x: number; y: number }; rotation: number; properties: Record<string, unknown> }[];
  connections: { id: string; source: { componentId: string; portId: string }; target: { componentId: string; portId: string }; domain: string }[];
  firmwareTargets: { id: string; componentId: string; files: { name: string; content: string }[] }[];
}

interface ProjectState {
  project: HardwareGraph;
  setProjectName: (name: string) => void;
  addComponent: (definitionId: string, pos?: { x: number; y: number }) => { id: string };
  moveComponent: (id: string, position: { x: number; y: number }) => void;
  removeComponent: (id: string) => void;
  connectPorts: (source: { componentId: string; portId: string }, target: { componentId: string; portId: string }) => { id: string };
  disconnectPorts: (connectionId: string) => void;
  getGraph: () => HardwareGraph;
  clear: () => void;
  loadProject: (graph: HardwareGraph) => void;
  updateComponentProps: (id: string, props: Record<string, unknown>) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: {
    id: `proj-${Date.now()}`,
    name: "Untitled",
    components: [],
    connections: [],
    firmwareTargets: [],
  },

  setProjectName(name) {
    set((s) => ({ project: { ...s.project, name } }));
  },

  addComponent(definitionId, pos) {
    const id = `${definitionId}-${Math.random().toString(36).slice(2, 8)}`;
    const position = pos ?? { x: 100 + Math.random() * 400, y: 100 + Math.random() * 300 };
    set((s) => ({
      project: { ...s.project, components: [...s.project.components, { id, definitionId, position, rotation: 0, properties: {} }] },
    }));
    return { id };
  },

  moveComponent(id, position) {
    set((s) => ({
      project: {
        ...s.project,
        components: s.project.components.map((component) =>
          component.id === id ? { ...component, position } : component,
        ),
      },
    }));
  },

  removeComponent(id) {
    set((s) => ({
      project: {
        ...s.project,
        components: s.project.components.filter((c) => c.id !== id),
        connections: s.project.connections.filter((c) => c.source.componentId !== id && c.target.componentId !== id),
      },
    }));
  },

  connectPorts(source, target) {
    const defSrc = catalog.find((c) => c.id === source.componentId) ?? null;
    const defTgt = catalog.find((c) => c.id === target.componentId) ?? null;
    // Resolve domain from catalog ports
    let domain = "gpio";
    const findDomain = (compId: string, portId: string) => {
      const inst = get().project.components.find((x) => x.id === compId);
      const defId = inst?.definitionId ?? compId;
      const def = catalog.find((c) => c.id === defId);
      const port = def?.ports.find((p) => p.id === portId);
      return port?.domain ?? null;
    };
    const sd = findDomain(source.componentId, source.portId);
    const td = findDomain(target.componentId, target.portId);
    domain = sd ?? td ?? "gpio";
    void defSrc; void defTgt;

    const id = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const conn = { id, source, target, domain };
    set((s) => ({ project: { ...s.project, connections: [...s.project.connections, conn] } }));
    return { id };
  },

  disconnectPorts(connectionId) {
    set((s) => ({ project: { ...s.project, connections: s.project.connections.filter((c) => c.id !== connectionId) } }));
  },

  getGraph() {
    return get().project;
  },

  clear() {
    set({
      project: { id: `proj-${Date.now()}`, name: "Untitled", components: [], connections: [], firmwareTargets: [] },
    });
  },

  loadProject(graph) {
    set({ project: graph });
  },

  updateComponentProps(id, props) {
    set((s) => ({
      project: {
        ...s.project,
        components: s.project.components.map((c) => (c.id === id ? { ...c, properties: { ...c.properties, ...props } } : c)),
      },
    }));
  },
}));
