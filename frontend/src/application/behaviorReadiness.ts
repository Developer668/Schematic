import { createBehaviorSystem, type PlanPreparation } from "@schematic/behavior";
import type { HardwareProject } from "@schematic/hardware-graph";
import { getCatalogComponent } from "../data/catalog.ts";
import type { HardwareGraph } from "../store/useProjectStore.ts";

function definitionsLookup(definitionId: string) {
  const definition = getCatalogComponent(definitionId);
  return definition ? { id: definition.id, behavior: definition.behavior } : undefined;
}

function toBehaviorProject(project: HardwareGraph): HardwareProject {
  return {
    ...project,
    components: project.components.map((component) => ({
      ...component,
      rotation: component.rotation === 90 || component.rotation === 180 || component.rotation === 270
        ? component.rotation
        : 0,
    })),
    connections: project.connections.map((connection) => ({
      ...connection,
      domain: connection.domain as HardwareProject["connections"][number]["domain"],
    })),
    firmwareTargets: project.firmwareTargets.map((target) => ({
      ...target,
      definitionId: target.definitionId ?? "unknown",
      language: (target.language ?? "arduino") as HardwareProject["firmwareTargets"][number]["language"],
      boardFqbn: target.boardFqbn ?? "",
    })),
    simulation: project.simulation ?? { mode: "interactive", engines: {} },
    createdAt: project.createdAt ?? new Date(0).toISOString(),
    updatedAt: project.updatedAt ?? new Date(0).toISOString(),
    version: 1,
  };
}

/**
 * Prepare a saved Behavior Plan against the exact current graph/catalog
 * without opening or mutating an Outcome session. This is shared by starter
 * synchronization and project verification so both use the same checked-in
 * behavior registry and exact capability rules as behavior.preview.
 */
export async function prepareBehaviorPlanReadiness(
  project: HardwareGraph,
  plan: unknown,
  policy: "block" | "skip" = "block",
): Promise<PlanPreparation> {
  const system = createBehaviorSystem({ definitions: definitionsLookup });
  return system.prepare(toBehaviorProject(project), plan, { onUnsupported: policy });
}
