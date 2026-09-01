import type { ComponentInstance } from "@schematic/hardware-graph";
import { sha256 } from "./canonicalize";
import type {
  BehaviorDefinitionLike,
  BehaviorDefinitionLookup,
  BehaviorProfile,
  BehaviorRegistry,
  CatalogBehaviorBinding,
  ComponentBehaviorCapabilityReport,
  ComponentActionCapability,
  ComponentEventCapability,
} from "./contracts";
import { buzzerProfile } from "./profiles/buzzer";
import { catalogOnlyProfile } from "./profiles/catalog-only";
import { digitalIndicatorProfile } from "./profiles/digital-indicator";
import { momentaryInputProfile } from "./profiles/momentary-input";
import { motorProfile } from "./profiles/motor";
import { numericSensorProfile } from "./profiles/numeric-sensor";
import { relayProfile } from "./profiles/relay";
import { rotaryActuatorProfile } from "./profiles/rotary-actuator";
import { textDisplayProfile } from "./profiles/text-display";
import { validatePayloadSchema } from "./schemas";

export const DEFAULT_BEHAVIOR_PROFILES: readonly BehaviorProfile[] = [
  catalogOnlyProfile,
  momentaryInputProfile,
  digitalIndicatorProfile,
  textDisplayProfile,
  buzzerProfile,
  relayProfile,
  rotaryActuatorProfile,
  motorProfile,
  numericSensorProfile,
];

export function profileKey(profileId: string, version: number): string {
  return `${profileId}:v${version}`;
}

export function parseProfileReference(profileId: string, version?: number): { id: string; version: number } {
  const match = /^(.*):v(\d+)$/.exec(profileId);
  if (match) return { id: match[1], version: version ?? Number(match[2]) };
  return { id: profileId, version: version ?? 1 };
}

function cloneFrozenProfileData<T>(value: T, ancestors = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new Error("Behavior profile metadata must not contain cycles.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => cloneFrozenProfileData(item, ancestors))) as T;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("Behavior profile metadata must contain plain data only.");
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      Object.defineProperty(clone, key, { value: cloneFrozenProfileData(item, ancestors), enumerable: true, configurable: false, writable: false });
    }
    return Object.freeze(clone) as T;
  } finally {
    ancestors.delete(value);
  }
}

function snapshotProfile<State>(profile: BehaviorProfile<State>): BehaviorProfile<State> {
  const manifest = cloneFrozenProfileData(profile.manifest);
  const parseState = profile.parseState;
  const initialState = profile.initialState;
  const reduce = profile.reduce;
  const projectVisual = profile.projectVisual;
  return Object.freeze({
    manifest,
    parseState(value: unknown) { return parseState(value); },
    initialState(instance: ComponentInstance) { return initialState(instance); },
    reduce(state: State, action: Parameters<BehaviorProfile<State>["reduce"]>[1], context: Parameters<BehaviorProfile<State>["reduce"]>[2]) { return reduce(state, action, context); },
    projectVisual(state: State) { return projectVisual(state); },
  });
}

export function createBehaviorRegistry(profiles: readonly BehaviorProfile[] = DEFAULT_BEHAVIOR_PROFILES): BehaviorRegistry {
  const normalized = profiles.map((profile) => snapshotProfile(profile)).sort((left, right) => left.manifest.id.localeCompare(right.manifest.id) || left.manifest.version - right.manifest.version);
  const seen = new Set<string>();
  for (const profile of normalized) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile.manifest.id) || !Number.isSafeInteger(profile.manifest.version) || profile.manifest.version < 1) throw new Error(`Invalid behavior profile identity ${profile.manifest.id}:v${profile.manifest.version}.`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(profile.manifest.implementationId)) throw new Error(`Invalid behavior profile implementation identity for ${profile.manifest.id}:v${profile.manifest.version}.`);
    const key = profileKey(profile.manifest.id, profile.manifest.version);
    if (seen.has(key)) throw new Error(`Duplicate behavior profile ${key}.`);
    seen.add(key);
    validateDescriptors(profile.manifest.id, profile.manifest.actions, "action");
    validateDescriptors(profile.manifest.id, profile.manifest.events, "event");
  }
  const hash = sha256(registryHashInput(normalized));
  const byKey = new Map(normalized.map((profile) => [profileKey(profile.manifest.id, profile.manifest.version), profile] as const));
  return {
    profiles: Object.freeze(normalized),
    hash,
    get(profileId: string, version?: number) {
      const reference = parseProfileReference(profileId, version);
      return byKey.get(profileKey(reference.id, reference.version));
    },
  };
}

export const defaultBehaviorRegistry = createBehaviorRegistry();

export function lookupDefinition(lookup: BehaviorDefinitionLookup, definitionId: string): BehaviorDefinitionLike | undefined {
  if (typeof lookup === "function") return lookup(definitionId);
  if (typeof (lookup as ReadonlyMap<string, BehaviorDefinitionLike>).get === "function") return (lookup as ReadonlyMap<string, BehaviorDefinitionLike>).get(definitionId);
  return (lookup as Readonly<Record<string, BehaviorDefinitionLike | undefined>>)[definitionId];
}

export function bindingForDefinition(definition: BehaviorDefinitionLike | undefined): CatalogBehaviorBinding {
  const binding = definition?.behaviorBinding ?? definition?.behavior;
  if (!binding || typeof binding.profileId !== "string" || !Number.isSafeInteger(binding.profileVersion) || binding.profileVersion < 1) return { profileId: "catalog-only", profileVersion: 1 };
  const reference = parseProfileReference(binding.profileId, binding.profileVersion);
  return { profileId: reference.id, profileVersion: reference.version, ...(binding.variant === undefined ? {} : { variant: binding.variant }) };
}

export interface ResolvedProfile {
  binding: CatalogBehaviorBinding;
  profile: BehaviorProfile | undefined;
  definitionKnown: boolean;
}

export function resolveProfile(
  definitionLookup: BehaviorDefinitionLookup,
  registry: BehaviorRegistry,
  definitionId: string,
): ResolvedProfile {
  const definition = lookupDefinition(definitionLookup, definitionId);
  const definitionKnown = definition !== undefined;
  const binding = bindingForDefinition(definition);
  return { binding, profile: registry.get(binding.profileId, binding.profileVersion), definitionKnown };
}

export function capabilitiesForComponent(
  component: Pick<ComponentInstance, "id" | "definitionId">,
  definitionLookup: BehaviorDefinitionLookup,
  registry: BehaviorRegistry,
): ComponentBehaviorCapabilityReport {
  const resolved = resolveProfile(definitionLookup, registry, component.definitionId);
  const limitations: string[] = [];
  if (!resolved.definitionKnown) limitations.push(`Definition ${component.definitionId} is not present in the catalog.`);
  if (!resolved.profile) limitations.push(`Behavior profile ${profileKey(resolved.binding.profileId, resolved.binding.profileVersion)} is not installed.`);
  if (resolved.profile?.manifest.id === "catalog-only") limitations.push("Visual behavior controls are not mapped for this exact catalog part yet.");
  const actions: ComponentActionCapability[] = resolved.profile?.manifest.actions.map((descriptor) => ({ actionId: descriptor.id, descriptor, availability: { status: "available" } })) ?? [];
  const events: ComponentEventCapability[] = resolved.profile?.manifest.events.map((descriptor) => ({ eventId: descriptor.id, descriptor, availability: { status: "available" } })) ?? [];
  return { componentId: component.id, definitionId: component.definitionId, profile: resolved.binding, actions, events, limitations };
}

export function registryDescriptorHash(registry: BehaviorRegistry): string {
  return sha256(registryHashInput(registry.profiles));
}

function registryHashInput(profiles: readonly BehaviorProfile[]) {
  return [...profiles].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id) || left.manifest.version - right.manifest.version).map((profile) => ({
    id: profile.manifest.id,
    version: profile.manifest.version,
    implementationId: profile.manifest.implementationId,
    actions: [...profile.manifest.actions].sort((left, right) => left.id.localeCompare(right.id)),
    events: [...profile.manifest.events].sort((left, right) => left.id.localeCompare(right.id)),
  }));
}

function validateDescriptors(profileId: string, descriptors: readonly { id: string; payloadSchema: Parameters<typeof validatePayloadSchema>[0] }[], kind: "action" | "event") {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(descriptor.id)) throw new Error(`Invalid ${kind} id ${descriptor.id} in behavior profile ${profileId}.`);
    if (ids.has(descriptor.id)) throw new Error(`Duplicate ${kind} ${descriptor.id} in behavior profile ${profileId}.`);
    ids.add(descriptor.id);
    const errors = validatePayloadSchema(descriptor.payloadSchema, `${profileId}.${descriptor.id}`);
    if (errors.length) throw new Error(`Invalid ${kind} schema ${descriptor.id} in behavior profile ${profileId}: ${errors.map((error) => error.message).join("; ")}`);
  }
}
