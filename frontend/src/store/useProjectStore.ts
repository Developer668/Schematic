import { create } from "zustand";
import { defaultProperties, componentPort, getCatalogComponent, isBoardDefinition, orientConnectionEndpoints, resolveFirmwareBinding, boardTargetFor } from "../data/hardware.ts";
import { useSelectionStore } from "./useSelectionStore.ts";
import { useSimulationStore } from "./useSimulationStore.ts";
import { useValidationStore } from "./useValidationStore.ts";

export interface HardwareGraph {
  id: string;
  name: string;
  description?: string;
  components: { id: string; definitionId: string; position: { x: number; y: number }; rotation: number; properties: Record<string, unknown>; label?: string }[];
  connections: { id: string; source: { componentId: string; portId: string }; target: { componentId: string; portId: string }; domain: string }[];
  firmwareTargets: { id: string; componentId: string; definitionId?: string; language?: string; boardFqbn?: string; files: { name: string; content: string }[]; compiledArtifact?: { success: boolean; log: string; hexB64?: string; elfB64?: string; binB64?: string } }[];
  simulation?: { mode: "interactive" | "batch"; durationMs?: number; engines: Record<string, { enabled: boolean; fidelity: "fast" | "high" }> };
  createdAt?: string;
  updatedAt?: string;
  version?: 1;
}

interface ProjectState {
  project: HardwareGraph;
  projects: HardwareGraph[];
  activeProjectId: string;
  setProjectName: (name: string) => void;
  renameProject: (projectId: string, name: string) => string | null;
  addComponent: (definitionId: string, pos?: { x: number; y: number }) => { id: string };
  moveComponent: (id: string, position: { x: number; y: number }) => void;
  removeComponent: (id: string) => void;
  connectPorts: (source: { componentId: string; portId: string }, target: { componentId: string; portId: string }) => { id: string; domain: string; source: { componentId: string; portId: string }; target: { componentId: string; portId: string } };
  disconnectPorts: (connectionId: string) => void;
  getGraph: () => HardwareGraph;
  clear: () => void;
  loadProject: (graph: HardwareGraph) => void;
  updateComponentProps: (id: string, props: Record<string, unknown>) => void;
  updateFirmware: (componentId: string, files: { name: string; content: string }[], metadata?: { language?: string; boardFqbn?: string }) => void;
  saveProject: () => { projectId: string; savedAt: string };
  createProject: (name?: string) => string;
  duplicateProject: (projectId?: string, name?: string) => string | null;
  switchProject: (projectId: string) => boolean;
  deleteProject: (projectId?: string) => boolean;
  listProjects: () => HardwareGraph[];
}

import { getCurrentUserId } from "../auth/supertokens.ts";

function storageKey() {
  const uid = getCurrentUserId();
  return uid ? `schematic-projects:${uid}` : "schematic-projects";
}
function legacyKey() {
  const uid = getCurrentUserId();
  return uid ? `schematic-project:${uid}` : "schematic-project";
}
const PROJECTS_STORAGE_KEY = "schematic-projects";
const LEGACY_PROJECT_STORAGE_KEY = "schematic-project";
const projectChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-project-sync") : null;

// Per-user room: projects are stored on device keyed by userId (localStorage)
// so WebMCP mutates only your room, never global. See supertokens-core.

type StoredProjects = { version: 1; activeProjectId: string; projects: HardwareGraph[] };

function makeId(prefix: string) {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${uuid}`;
}

function now() { return new Date().toISOString(); }

function uniqueProjectName(name: string, projects: HardwareGraph[], excludeId?: string) {
  const base = name.trim().slice(0, 120) || "Untitled";
  const used = new Set(projects.filter((project) => project.id !== excludeId).map((project) => project.name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (used.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

function defaultSimulation() {
  return {
    mode: "interactive" as const,
    engines: {
      renode: { enabled: true, fidelity: "fast" as const },
      ngspice: { enabled: true, fidelity: "fast" as const },
      wasmtime: { enabled: true, fidelity: "fast" as const },
    },
  };
}

export function normalizeProject(stored: unknown, fallbackId?: string): HardwareGraph {
  const value = stored && typeof stored === "object" ? stored as Record<string, any> : {};
  const timestamp = now();
  return {
    ...value,
    id: typeof value.id === "string" && value.id ? value.id : fallbackId ?? makeId("proj"),
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 120) : "Untitled",
    description: typeof value.description === "string" ? value.description : undefined,
    components: Array.isArray(value.components) ? value.components.map((component: any) => ({
      ...component,
      id: String(component?.id ?? makeId("component")),
      definitionId: String(component?.definitionId ?? "unknown"),
      position: { x: Number(component?.position?.x ?? 100), y: Number(component?.position?.y ?? 100) },
      rotation: [0, 90, 180, 270].includes(component?.rotation) ? component.rotation : 0,
      properties: { ...defaultProperties(String(component?.definitionId ?? "unknown")), ...(component?.properties && typeof component.properties === "object" && !Array.isArray(component.properties) ? component.properties : {}) },
    })) : [],
    connections: Array.isArray(value.connections) ? value.connections.map((connection: any) => ({
      ...connection,
      id: String(connection?.id ?? makeId("conn")),
      source: { componentId: String(connection?.source?.componentId ?? ""), portId: String(connection?.source?.portId ?? "") },
      target: { componentId: String(connection?.target?.componentId ?? ""), portId: String(connection?.target?.portId ?? "") },
      domain: String(connection?.domain ?? "gpio"),
    })) : [],
    firmwareTargets: Array.isArray(value.firmwareTargets) ? value.firmwareTargets.map((target: any) => ({
      ...target,
      id: String(target?.id ?? makeId("fw")),
      componentId: String(target?.componentId ?? ""),
      definitionId: typeof target?.definitionId === "string" ? target.definitionId : undefined,
      language: typeof target?.language === "string" ? target.language : "arduino",
      boardFqbn: typeof target?.boardFqbn === "string" ? target.boardFqbn : undefined,
      files: Array.isArray(target?.files) ? target.files.map((file: any) => ({ name: String(file?.name ?? "sketch.ino"), content: String(file?.content ?? "") })) : [],
    })) : [],
    simulation: value.simulation && typeof value.simulation === "object"
      ? { ...defaultSimulation(), ...value.simulation, engines: { ...defaultSimulation().engines, ...(value.simulation.engines ?? {}) } }
      : defaultSimulation(),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : timestamp,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : timestamp,
    version: 1,
  };
}

function emptyProject(name = "Untitled"): HardwareGraph {
  const timestamp = now();
  return { id: makeId("proj"), name, components: [], connections: [], firmwareTargets: [], simulation: defaultSimulation(), createdAt: timestamp, updatedAt: timestamp, version: 1 };
}

function readStoredState(): StoredProjects {
  try {
    if (typeof localStorage === "undefined") return { version: 1, activeProjectId: "", projects: [emptyProject()] };
    // Try per-user key first, then fallback to global, then legacy
    const tryKeys = [storageKey(), PROJECTS_STORAGE_KEY, legacyKey(), LEGACY_PROJECT_STORAGE_KEY];
    for (const key of tryKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const stored = JSON.parse(raw);
      if (stored && Array.isArray(stored.projects) && stored.projects.length > 0) {
        const projects = stored.projects.map((project: unknown) => normalizeProject(project));
        const activeProjectId = projects.some((project: HardwareGraph) => project.id === stored.activeProjectId) ? stored.activeProjectId : projects[0].id;
        // If we loaded from a fallback global key but we have a user, migrate to per-user key
        if (key !== storageKey()) {
          try { localStorage.setItem(storageKey(), JSON.stringify({ version: 1, activeProjectId, projects })); } catch {}
        }
        return { version: 1, activeProjectId, projects };
      }
      if (stored && typeof stored === "object" && !Array.isArray(stored.projects)) {
        // Legacy single project shape
        const project = normalizeProject(stored);
        try { localStorage.setItem(storageKey(), JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })); } catch {}
        return { version: 1, activeProjectId: project.id, projects: [project] };
      }
    }
    // Also try legacy singletons
    for (const key of [legacyKey(), LEGACY_PROJECT_STORAGE_KEY]) {
      const legacy = JSON.parse(localStorage.getItem(key) ?? "null");
      if (legacy && typeof legacy === "object") {
        const project = normalizeProject(legacy);
        try { localStorage.setItem(storageKey(), JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })); } catch {}
        return { version: 1, activeProjectId: project.id, projects: [project] };
      }
    }
  } catch {}
  const project = emptyProject();
  return { version: 1, activeProjectId: project.id, projects: [project] };
}

function persistState(projects: HardwareGraph[], activeProjectId: string, broadcast = true) {
  const state: StoredProjects = { version: 1, activeProjectId, projects };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {}
  if (broadcast) projectChannel?.postMessage({ type: "projects:update", state: { ...state, _room: getCurrentUserId() } });
}

export function reloadForCurrentUser() {
  const next = readStoredState();
  const proj = next.projects.find((p) => p.id === next.activeProjectId) ?? next.projects[0];
  useProjectStore.setState({ projects: next.projects, activeProjectId: next.activeProjectId, project: proj });
  // Also notify other tabs with the room
  projectChannel?.postMessage({ type: "projects:update", state: { ...next, _room: getCurrentUserId() } });
}

function resetProjectRuntime() {
  useSelectionStore.getState().clear();
  useSimulationStore.getState().reset();
  useValidationStore.getState().clear();
}

const initialState = readStoredState();
const initialProject = initialState.projects.find((project) => project.id === initialState.activeProjectId) ?? initialState.projects[0];

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: initialProject,
  projects: initialState.projects,
  activeProjectId: initialProject.id,

  setProjectName(name) {
    get().renameProject(get().activeProjectId, name);
  },

  renameProject(projectId, name) {
    const current = get().projects.find((item) => item.id === projectId);
    if (!current) return null;
    const nextName = uniqueProjectName(name, get().projects, projectId);
    set((state) => {
      const renamed = { ...current, name: nextName, updatedAt: now() };
      const projects = state.projects.map((item) => item.id === projectId ? renamed : item);
      persistState(projects, state.activeProjectId);
      return { project: state.activeProjectId === projectId ? renamed : state.project, projects };
    });
    return nextName;
  },

  addComponent(definitionId, pos) {
    if (!getCatalogComponent(definitionId)) throw new Error(`Unknown component definition ${definitionId}`);
    const id = `${definitionId}-${Math.random().toString(36).slice(2, 8)}`;
    const position = pos ?? { x: 100 + Math.random() * 400, y: 100 + Math.random() * 300 };
    set((state) => {
      const project = { ...state.project, components: [...state.project.components, { id, definitionId, position, rotation: 0, properties: defaultProperties(definitionId) }], updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
    return { id };
  },

  moveComponent(id, position) {
    set((state) => {
      const project = { ...state.project, components: state.project.components.map((component) => component.id === id ? { ...component, position } : component), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  removeComponent(id) {
    set((state) => {
      const project = {
        ...state.project,
        components: state.project.components.filter((component) => component.id !== id),
        connections: state.project.connections.filter((connection) => connection.source.componentId !== id && connection.target.componentId !== id),
        firmwareTargets: state.project.firmwareTargets.filter((target) => target.componentId !== id),
        updatedAt: now(),
      };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  connectPorts(source, target) {
    const current = get().project;
    const sourcePort = componentPort(current, source.componentId, source.portId);
    const targetPort = componentPort(current, target.componentId, target.portId);
    if (!sourcePort || !targetPort) throw new Error("Both connection endpoints must reference existing component ports");
    if (source.componentId === target.componentId) throw new Error("A component cannot be wired to itself");
    const oriented = orientConnectionEndpoints(source, sourcePort, target, targetPort);
    const orientedSourcePort = componentPort(current, oriented.source.componentId, oriented.source.portId)!;
    const orientedTargetPort = componentPort(current, oriented.target.componentId, oriented.target.portId)!;
    const compatiblePower = ["power", "power_output"].includes(orientedSourcePort.domain) && ["power", "power_output"].includes(orientedTargetPort.domain);
    if (orientedSourcePort.domain !== orientedTargetPort.domain && !compatiblePower) throw new Error(`Incompatible domains: ${orientedSourcePort.domain} → ${orientedTargetPort.domain}`);
    const duplicate = current.connections.some((connection) => (
      (connection.source.componentId === oriented.source.componentId && connection.source.portId === oriented.source.portId && connection.target.componentId === oriented.target.componentId && connection.target.portId === oriented.target.portId) ||
      (connection.source.componentId === oriented.target.componentId && connection.source.portId === oriented.target.portId && connection.target.componentId === oriented.source.componentId && connection.target.portId === oriented.source.portId)
    ));
    if (duplicate) throw new Error("Those ports are already connected");
    const id = makeId("conn");
    const domain = compatiblePower ? "power" : orientedSourcePort.domain;
    set((state) => {
      const project = { ...state.project, connections: [...state.project.connections, { id, source: oriented.source, target: oriented.target, domain }], updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
    return { id, domain, source: oriented.source, target: oriented.target };
  },

  disconnectPorts(connectionId) {
    set((state) => {
      const project = { ...state.project, connections: state.project.connections.filter((connection) => connection.id !== connectionId), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  getGraph() { return get().project; },

  clear() {
    set((state) => {
      const project = { ...emptyProject(state.project.name), id: state.project.id, createdAt: state.project.createdAt, updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
    resetProjectRuntime();
  },

  loadProject(graph) {
    set((state) => {
      const name = uniqueProjectName(graph.name || state.project.name, state.projects, state.activeProjectId);
      const project = normalizeProject({ ...graph, id: state.project.id, name });
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  updateComponentProps(id, props) {
    set((state) => {
      const project = { ...state.project, components: state.project.components.map((component) => component.id === id ? { ...component, properties: { ...component.properties, ...props } } : component), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  updateFirmware(componentId, files, metadata = {}) {
    const binding = resolveFirmwareBinding(get().project, componentId);
    if (!binding.component) throw new Error(`Unknown component ${componentId}`);
    if (!isBoardDefinition(binding.definition)) throw new Error(`${componentId} is not a programmable board`);
    if (metadata.boardFqbn && binding.targetConfig && metadata.boardFqbn !== binding.targetConfig.fqbn) {
      throw new Error(`${componentId} maps to ${binding.targetConfig.fqbn}; refusing firmware for ${metadata.boardFqbn}`);
    }
    set((state) => {
      const existing = state.project.firmwareTargets.find((target) => target.componentId === componentId);
      const targetConfig = boardTargetFor(binding.definition?.id);
      const target = {
        id: existing?.id ?? makeId(`fw-${componentId}`),
        componentId,
        definitionId: binding.component!.definitionId,
        language: metadata.language ?? existing?.language ?? targetConfig?.language ?? "arduino",
        boardFqbn: metadata.boardFqbn ?? targetConfig?.fqbn ?? existing?.boardFqbn,
        files,
      };
      const firmwareTargets = existing
        ? state.project.firmwareTargets.map((item) => item.componentId === componentId ? target : item)
        : [...state.project.firmwareTargets, target];
      const project = { ...state.project, firmwareTargets, updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  saveProject() {
    const state = get();
    const savedAt = now();
    persistState(state.projects, state.activeProjectId);
    return { projectId: state.activeProjectId, savedAt };
  },

  createProject(name = "Untitled") {
    let createdProjectId = "";
    set((state) => {
      const project = emptyProject(uniqueProjectName(name, state.projects));
      createdProjectId = project.id;
      const projects = [...state.projects, project];
      persistState(projects, project.id);
      return { project, projects, activeProjectId: project.id };
    });
    resetProjectRuntime();
    return createdProjectId;
  },

  duplicateProject(projectId = get().activeProjectId, name) {
    const source = get().projects.find((item) => item.id === projectId);
    if (!source) return null;
    let duplicatedProjectId = "";
    set((state) => {
      const requestedName = name?.trim() && name.trim().toLowerCase() !== source.name.trim().toLowerCase() ? name : `${source.name} copy`;
      const project = normalizeProject({ ...JSON.parse(JSON.stringify(source)), id: makeId("proj"), name: uniqueProjectName(requestedName, state.projects), createdAt: now(), updatedAt: now() });
      duplicatedProjectId = project.id;
      const projects = [...state.projects, project];
      persistState(projects, project.id);
      return { project, projects, activeProjectId: project.id };
    });
    resetProjectRuntime();
    return duplicatedProjectId;
  },

  switchProject(projectId) {
    const next = get().projects.find((item) => item.id === projectId);
    if (!next) return false;
    set((state) => {
      persistState(state.projects, next.id);
      return { project: next, activeProjectId: next.id };
    });
    resetProjectRuntime();
    return true;
  },

  deleteProject(projectId = get().activeProjectId) {
    const state = get();
    if (state.projects.length <= 1 || !state.projects.some((project) => project.id === projectId)) return false;
    const projects = state.projects.filter((project) => project.id !== projectId);
    const activeProjectId = state.activeProjectId === projectId ? projects[0].id : state.activeProjectId;
    const project = projects.find((item) => item.id === activeProjectId) ?? projects[0];
    set({ projects, activeProjectId, project });
    persistState(projects, activeProjectId);
    resetProjectRuntime();
    return true;
  },

  listProjects() { return get().projects; },
}));

function applyRemoteState(value: unknown) {
  if (!value || typeof value !== "object") return;
  const stored = value as any;
  // Only apply if it matches our current room (user)
  const incomingRoom = stored._room ?? null;
  const currentRoom = getCurrentUserId();
  if (incomingRoom !== currentRoom) return;
  if (!Array.isArray(stored.projects) || stored.projects.length === 0) return;
  const projects = stored.projects.map((project: unknown) => normalizeProject(project));
  const activeProjectId = projects.some((project: HardwareGraph) => project.id === stored.activeProjectId) ? stored.activeProjectId! : projects[0].id;
  const previous = useProjectStore.getState().activeProjectId;
  const project = projects.find((item: HardwareGraph) => item.id === activeProjectId) ?? projects[0];
  useProjectStore.setState({ projects, activeProjectId, project });
  if (previous !== activeProjectId) resetProjectRuntime();
}

projectChannel?.addEventListener("message", (event) => {
  if (event.data?.type === "projects:update") applyRemoteState(event.data.state);
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.newValue) return;
    if (event.key !== storageKey() && event.key !== PROJECTS_STORAGE_KEY) return;
    try { applyRemoteState(JSON.parse(event.newValue)); } catch {}
  });
  // When user signs in/out, reload to their room (stored on device, per-user key)
  window.addEventListener("st-mock-login" as any, () => reloadForCurrentUser());
  window.addEventListener("supertokens-session" as any, () => reloadForCurrentUser());
}
