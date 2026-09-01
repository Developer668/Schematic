import { capabilitiesForComponent, defaultBehaviorRegistry } from "@schematic/behavior";
import type { ComponentBehaviorCapabilityReport } from "@schematic/behavior";
import { getCatalogComponent } from "../data/catalog.ts";

/**
 * Adapt the rich frontend catalog to the package's deliberately tiny lookup
 * contract. The package reads only the exact `behavior` opt-in; it does not
 * infer support from category, tags, ports, or model names.
 */
export function capabilitiesForCatalogComponent(component: { id: string; definitionId: string }): ComponentBehaviorCapabilityReport {
  return capabilitiesForComponent(
    component,
    (definitionId) => {
      const definition = getCatalogComponent(definitionId);
      return definition ? { id: definition.id, behavior: definition.behavior } : undefined;
    },
    defaultBehaviorRegistry,
  );
}
