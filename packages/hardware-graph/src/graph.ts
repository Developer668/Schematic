import type { HardwareProject, ComponentInstance, Connection, FirmwareTarget } from "./types";
import { HardwareProjectSchema } from "./schemas";

export function createEmptyProject(name = "Untitled"): HardwareProject {
  const now = new Date().toISOString();
  return {
    id: `proj-${Date.now()}`,
    name,
    components: [],
    connections: [],
    firmwareTargets: [],
    simulation: { mode: "interactive", engines: { renode: { enabled: true, fidelity: "fast" }, ngspice: { enabled: true, fidelity: "fast" }, wasmtime: { enabled: true, fidelity: "fast" } } },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function addComponent(project: HardwareProject, instance: ComponentInstance): HardwareProject {
  if (project.components.some((c) => c.id === instance.id)) throw new Error(`Component ${instance.id} already exists`);
  return { ...project, components: [...project.components, instance], updatedAt: new Date().toISOString() };
}

export function removeComponent(project: HardwareProject, componentId: string): HardwareProject {
  return {
    ...project,
    components: project.components.filter((c) => c.id !== componentId),
    connections: project.connections.filter((e) => e.source.componentId !== componentId && e.target.componentId !== componentId),
    firmwareTargets: project.firmwareTargets.filter((f) => f.componentId !== componentId),
    updatedAt: new Date().toISOString(),
  };
}

export function connectPorts(project: HardwareProject, conn: Connection): HardwareProject {
  if (project.connections.some((c) => c.id === conn.id)) throw new Error(`Connection ${conn.id} exists`);
  return { ...project, connections: [...project.connections, conn], updatedAt: new Date().toISOString() };
}

export function disconnectPorts(project: HardwareProject, connectionId: string): HardwareProject {
  return { ...project, connections: project.connections.filter((c) => c.id !== connectionId), updatedAt: new Date().toISOString() };
}

export function updateFirmware(project: HardwareProject, target: FirmwareTarget): HardwareProject {
  const idx = project.firmwareTargets.findIndex((f) => f.id === target.id);
  const next = idx >= 0 ? project.firmwareTargets.map((f, i) => (i === idx ? target : f)) : [...project.firmwareTargets, target];
  return { ...project, firmwareTargets: next, updatedAt: new Date().toISOString() };
}

export function validateProjectShape(project: unknown) {
  return HardwareProjectSchema.safeParse(project);
}

export function cloneProject(project: HardwareProject): HardwareProject {
  return JSON.parse(JSON.stringify(project));
}
