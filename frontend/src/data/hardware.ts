import type {
  ConnectionEndpoint,
  HardwarePort,
  PortDirection,
} from "@schematic/hardware-graph";
import { getCatalogComponent, type CatalogComponent } from "./catalog.ts";

export { getCatalogComponent } from "./catalog.ts";

/** The small structural slice shared by graph helpers and the local project store. */
export interface HardwareProjectRef {
  components: HardwareComponentRef[];
  firmwareTargets: FirmwareTargetRef[];
}

export interface HardwareComponentRef {
  id: string;
  definitionId: string;
}

export interface FirmwareTargetRef {
  id: string;
  componentId: string;
  definitionId?: string;
  language?: string;
  boardFqbn?: string;
  files: { name: string; content: string }[];
}

export interface BoardTarget {
  language: string;
  editorLanguage: string;
  fileName: string;
  fqbn: string;
}

interface ProjectIndex {
  componentsById: Map<string, HardwareComponentRef>;
  definitionsByComponentId: Map<string, CatalogComponent | undefined>;
  firmwareByComponentId: Map<string, FirmwareTargetRef>;
}

const projectIndexes = new WeakMap<object, ProjectIndex>();

function indexProject(project: HardwareProjectRef) {
  const cached = projectIndexes.get(project);
  if (cached) return cached;
  const index: ProjectIndex = {
    componentsById: new Map(project.components.map((component) => [component.id, component] as const)),
    definitionsByComponentId: new Map(project.components.map((component) => [component.id, getCatalogComponent(component.definitionId)] as const)),
    firmwareByComponentId: new Map(project.firmwareTargets.map((target) => [target.componentId, target] as const)),
  };
  projectIndexes.set(project, index);
  return index;
}

/**
 * Exact compiler identities. There is deliberately no "otherwise UNO" fallback:
 * compiling for the wrong board is worse than asking for a missing toolchain.
 */
const BOARD_TARGETS: Record<string, BoardTarget> = {
  "arduino-uno": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:avr:uno" },
  "arduino-uno-r3": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:avr:uno" },
  "arduino-nano": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:avr:nano" },
  "arduino-nano-every": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:megaavr:nona4809" },
  "arduino-mega": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:avr:mega" },
  "arduino-pro-mini": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:avr:pro:cpu=16MHzatmega328" },
  "arduino-leonardo": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:avr:leonardo" },
  "arduino-due": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:sam:arduino_due_x" },
  "arduino-mkr-zero": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:samd:mkrzero" },
  "arduino-nano-33-ble": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:mbed_nano:nano33ble" },
  "arduino-nano-33-iot": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:samd:nano_33_iot" },
  "arduino-giga-r1": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:mbed_giga:giga" },
  "arduino-portenta-h7": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "arduino:mbed_portenta:envie_m7" },
  "esp32": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32" },
  "esp32-devkit-v1": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32" },
  "esp32-s3": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32s3" },
  "esp32-s3-devkitc-1": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32s3" },
  "esp32-c3-devkit": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32c3" },
  "esp32-c3-mini": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32c3" },
  "esp32-s2-devkit": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32s2" },
  "esp32-c6-devkit": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32c6" },
  "esp32-c5-devkit": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32c5" },
  "esp32-cam": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32" },
  "esp32-pico-v3": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32" },
  "esp32-ethernet-kit": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32" },
  "esp32-wroom-32u": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp32:esp32:esp32" },
  "esp8266-nodemcu": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "esp8266:esp8266:nodemcuv2" },
  "raspberry-pi-pico": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "rp2040:rp2040:rpipico" },
  "raspberry-pi-pico-w": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "rp2040:rp2040:rpipicow" },
  "raspberry-pi-pico-2": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "rp2040:rp2040:rpipico2" },
  "rp2040-zero": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "rp2040:rp2040:rpipico" },
  "teensy-4-1": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "teensy:avr:teensy41" },
  "teensy-3-2": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "teensy:avr:teensy31" },
  "adafruit-feather-m4": { language: "arduino", editorLanguage: "cpp", fileName: "sketch.ino", fqbn: "adafruit:samd:adafruit_feather_m4" },
};

export function boardTargetFor(definitionId: string | undefined) {
  return definitionId ? BOARD_TARGETS[definitionId] : undefined;
}

export function componentDefinition(project: HardwareProjectRef, componentId: string) {
  return indexProject(project).definitionsByComponentId.get(componentId);
}

export function componentPorts(project: HardwareProjectRef, componentId: string): HardwarePort[] {
  return componentDefinition(project, componentId)?.ports ?? [];
}

export function componentPort(project: HardwareProjectRef, componentId: string, portId: string) {
  return componentPorts(project, componentId).find((port) => port.id === portId);
}

export function signalPort(project: HardwareProjectRef, componentId: string, requestedKey: string) {
  const ports = componentPorts(project, componentId);
  return ports.find((port) => port.id.toLowerCase() === requestedKey.toLowerCase())
    ?? ports.find((port) => ["A", "OUT", "P1", "IN"].includes(port.id) && !["power", "ground"].includes(port.domain));
}

export function isBoardDefinition(definition: CatalogComponent | string | undefined) {
  const component = typeof definition === "string" ? getCatalogComponent(definition) : definition;
  return component?.category === "board";
}

export function defaultProperties(definitionId: string) {
  const values = getCatalogComponent(definitionId)?.defaultValues;
  return values ? { ...values } : {};
}

export function firmwareTargetFor(project: HardwareProjectRef, componentId: string) {
  return indexProject(project).firmwareByComponentId.get(componentId);
}

export function resolveFirmwareBinding(project: HardwareProjectRef, componentId: string) {
  const index = indexProject(project);
  const component = index.componentsById.get(componentId);
  const definition = index.definitionsByComponentId.get(componentId);
  const target = firmwareTargetFor(project, componentId);
  const targetConfig = boardTargetFor(definition?.id);
  return {
    component,
    definition,
    target,
    targetConfig,
    // A missing binding is not a match. The UI keeps legacy targets optional
    // so it can explain how to repair them; canonical graph validation and
    // runtime execution require both values to be present.
    definitionMatchesTarget: !target || (Boolean(target.definitionId) && target.definitionId === component?.definitionId),
    fqbnMatchesDefinition: !target || (Boolean(target.boardFqbn) && (!targetConfig || target.boardFqbn === targetConfig.fqbn)),
  };
}

function canDrive(direction: PortDirection) {
  return direction === "output" || direction === "bidirectional" || direction === "power";
}

function canReceive(direction: PortDirection) {
  return direction === "input" || direction === "bidirectional" || direction === "power";
}

export function orientConnectionEndpoints(
  source: ConnectionEndpoint,
  sourcePort: HardwarePort,
  target: ConnectionEndpoint,
  targetPort: HardwarePort,
) {
  if (canDrive(sourcePort.direction) && canReceive(targetPort.direction)) return { source, target };
  if (canDrive(targetPort.direction) && canReceive(sourcePort.direction)) return { source: target, target: source };
  throw new Error("A connection needs one driving port and one receiving port; two input or two output ports cannot be wired together");
}

export function resolveBoardPin(
  project: HardwareProjectRef,
  boardId: string,
  expression: string,
  constants: Map<string, number | boolean>,
): ConnectionEndpoint | null {
  const ports = componentPorts(project, boardId);
  const pinExpression = expression.trim().replace(/^\(+|\)+$/g, "");
  const directPort = ports.find((candidate) => candidate.id.toLowerCase() === pinExpression.toLowerCase());
  if (directPort) return { componentId: boardId, portId: directPort.id };
  const constantValue = constants.get(pinExpression);
  const numeric = typeof constantValue === "number"
    ? String(constantValue)
    : /^\d+$/.test(pinExpression)
      ? pinExpression
      : pinExpression.match(/(?:GPIO|PIN|IO|D|A|P)[_ ]?(\d+)/i)?.[1];
  if (!numeric) return null;
  const names = new Set([`GPIO${numeric}`, `D${numeric}`, `A${numeric}`, `IO${numeric}`, `P${numeric}`].map((name) => name.toLowerCase()));
  const port = ports.find((candidate) => names.has(candidate.id.toLowerCase()))
    ?? ports.find((candidate) => candidate.id.match(/(?:GPIO|PIN|IO|D|A|P)[_ ]?(\d+)/i)?.[1] === numeric);
  return port ? { componentId: boardId, portId: port.id } : null;
}

export function hasCatalogDefinition(definitionId: string | undefined) {
  return Boolean(getCatalogComponent(definitionId));
}
