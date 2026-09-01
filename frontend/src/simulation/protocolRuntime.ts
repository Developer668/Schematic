import type { HardwarePort } from "@schematic/hardware-graph";
import { getCatalogComponent, type CatalogComponent } from "../data/catalog.ts";
import { capabilityRegistryEntry, type CapabilityAdapterId } from "./capabilityRegistry.ts";
import { inferModelContract } from "./modelContract.ts";

export type ProtocolValue = boolean | number;

export interface RuntimeProject {
  components: { id: string; definitionId: string; properties?: Record<string, unknown> }[];
  connections: { source: { componentId: string; portId: string }; target: { componentId: string; portId: string }; domain: string }[];
}

export interface RuntimeDisjointSet {
  find(key: string): string;
  members(root: string): string[];
}

export type ProtocolTrace =
  | { kind: "i2c"; timeMs: number; controllerId: string; deviceId?: string; address: number; operation: "write" | "read"; register?: number; data: number[]; acknowledged: boolean }
  | { kind: "spi"; timeMs: number; controllerId: string; deviceId?: string; data: number[]; response: number[]; acknowledged: boolean }
  | { kind: "uart"; timeMs: number; controllerId: string; deviceId?: string; direction: "tx" | "rx"; data: number[]; acknowledged: boolean }
  | { kind: "adc"; timeMs: number; controllerId: string; deviceId?: string; portId: string; value: number }
  | { kind: "pwm"; timeMs: number; controllerId: string; deviceId?: string; portId: string; duty: number; frequencyHz?: number };

export interface DeviceRuntimeState {
  componentId: string;
  definitionId: string;
  family: string;
  modelId: string;
  adapterId: CapabilityAdapterId;
  support: string;
  status: "active" | "unwired" | "unsupported";
  values: Record<string, ProtocolValue | string | number[]>;
}

export interface ProtocolWarning {
  code: string;
  message: string;
  componentId?: string;
  controllerId?: string;
}

interface WireTransaction {
  address: number;
  bytes: number[];
  readQueue: number[];
  pointer?: number;
  deviceId?: string;
}

interface RuntimeState {
  cursorMs: number;
  i2c: Map<string, WireTransaction>;
  registerPointers: Map<string, number>;
  registers: Map<string, Uint8Array>;
  spiChipSelect: Map<string, number | string | undefined>;
  serialRx: Map<string, number[]>;
  deviceStates: Map<string, DeviceRuntimeState>;
}

function legacyModelFor(definition: CatalogComponent) {
  return inferModelContract(definition);
}

const I2C_ADDRESSES: Record<string, number> = {
  ds3231: 0x68,
  ds1307: 0x68,
  bmp280: 0x76,
  bme280: 0x76,
  mpu6050: 0x68,
  "gy-521-mpu6050": 0x68,
  "gy-68-bmp280": 0x76,
  "gy-273-hmc5883l": 0x1e,
  "bme280-2": 0x76,
  "bme280-3": 0x76,
  "bmp280-2": 0x76,
  "bmp280-3": 0x76,
  ssd1306: 0x3c,
  "ssd1306-i2c-4pin": 0x3c,
  "lcd1602-i2c": 0x27,
  "lcd2004-i2c": 0x27,
};

function endpointKey(componentId: string, portId: string) {
  return `${componentId}:${portId}`;
}

function parseNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = /^0x/i.test(value.trim()) ? Number.parseInt(value.trim(), 16) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function bcd(value: number) {
  const normalized = Math.max(0, Math.floor(value));
  return ((Math.floor(normalized / 10) & 0xf) << 4) | (normalized % 10 & 0xf);
}

function modelAddress(component: RuntimeProject["components"][number], definition: CatalogComponent) {
  const property = component.properties?.i2cAddress ?? component.properties?.address;
  if (property !== undefined) return parseNumber(property, I2C_ADDRESSES[definition.id] ?? 0);
  const port = definition.ports.find((candidate) => candidate.id.toUpperCase() === "SDA");
  return port?.protocol?.address ?? I2C_ADDRESSES[definition.id] ?? (/^ds3231(?:-\d+)?$/i.test(definition.id) ? 0x68 : 0);
}

function isDs3231Definition(definition: CatalogComponent) {
  return /^ds3231(?:-\d+)?$/i.test(definition.id) || definition.tags?.some((tag) => /^ds3231$/i.test(tag)) === true;
}

function sharedNet(dsu: RuntimeDisjointSet, a: string, b: string) {
  return dsu.find(a) === dsu.find(b);
}

function componentFor(project: RuntimeProject, componentId: string) {
  return project.components.find((component) => component.id === componentId);
}

function definitionFor(component: RuntimeProject["components"][number] | undefined) {
  return component ? getCatalogComponent(component.definitionId) : undefined;
}

type BusLine = "data" | "clock" | "tx" | "rx" | "sck";

function busPort(definition: CatalogComponent, domain: "i2c" | "spi" | "uart", line: BusLine) {
  const candidates = definition.ports.filter((candidate) => candidate.domain === domain);
  const aliases: Record<BusLine, string[]> = {
    data: ["sda", "data", "p20"],
    clock: ["scl", "clock", "p19"],
    sck: ["sck", "sclk", "scl", "clk", "clock"],
    tx: ["tx", "txd", "do", "ro"],
    rx: ["rx", "rxd", "di"],
  };
  const named = candidates.find((candidate) => aliases[line].includes(candidate.id.toLowerCase()));
  if (named) return named;
  if (domain === "i2c") return candidates[line === "data" ? 0 : 1];
  if (domain === "spi" && line === "sck") return candidates[0];
  return undefined;
}

function netsConnected(dsu: RuntimeDisjointSet, left: HardwarePort | undefined, leftComponentId: string, right: HardwarePort | undefined, rightComponentId: string) {
  if (!left || !right) return false;
  return sharedNet(dsu, endpointKey(leftComponentId, left.id), endpointKey(rightComponentId, right.id));
}

function poweredBy(
  dsu: RuntimeDisjointSet,
  controller: RuntimeProject["components"][number],
  controllerDefinition: CatalogComponent,
  target: RuntimeProject["components"][number],
  targetDefinition: CatalogComponent,
) {
  const controllerPower = controllerDefinition.ports.filter((port) => port.domain === "power" || port.domain === "power_output");
  const targetPower = targetDefinition.ports.filter((port) => port.domain === "power" || port.domain === "power_output");
  const controllerGround = controllerDefinition.ports.filter((port) => port.domain === "ground");
  const targetGround = targetDefinition.ports.filter((port) => port.domain === "ground");
  const power = controllerPower.some((left) => targetPower.some((right) => netsConnected(dsu, left, controller.id, right, target.id)));
  const ground = controllerGround.some((left) => targetGround.some((right) => netsConnected(dsu, left, controller.id, right, target.id)));
  return power && ground;
}

function connectedProtocolTarget(
  project: RuntimeProject,
  dsu: RuntimeDisjointSet,
  controllerId: string,
  domain: "i2c" | "spi" | "uart",
  address?: number,
) {
  const controller = componentFor(project, controllerId);
  const controllerDefinition = definitionFor(controller);
  if (!controller || !controllerDefinition) return undefined;
  const candidates = project.components.filter((candidate) => candidate.id !== controllerId).filter((candidate) => {
    const definition = definitionFor(candidate);
    if (!definition || !["behavioral", "engine-backed"].includes(legacyModelFor(definition).support) || !definition.ports.some((candidatePort) => candidatePort.domain === domain)) return false;
    if (domain === "i2c" && address !== undefined && modelAddress(candidate, definition) !== address) return false;
    if (domain === "i2c") {
      return netsConnected(dsu, busPort(controllerDefinition, "i2c", "data"), controllerId, busPort(definition, "i2c", "data"), candidate.id)
        && netsConnected(dsu, busPort(controllerDefinition, "i2c", "clock"), controllerId, busPort(definition, "i2c", "clock"), candidate.id)
        && poweredBy(dsu, controller, controllerDefinition, candidate, definition);
    }
    if (domain === "spi") {
      return netsConnected(dsu, busPort(controllerDefinition, "spi", "sck"), controllerId, busPort(definition, "spi", "sck"), candidate.id);
    }
    return netsConnected(dsu, busPort(controllerDefinition, "uart", "tx"), controllerId, busPort(definition, "uart", "rx"), candidate.id)
      || netsConnected(dsu, busPort(controllerDefinition, "uart", "rx"), controllerId, busPort(definition, "uart", "tx"), candidate.id);
  });
  return candidates[0];
}

function initialDeviceState(component: RuntimeProject["components"][number], definition: CatalogComponent): DeviceRuntimeState {
  const model = legacyModelFor(definition);
  const adapter = capabilityRegistryEntry(model.adapterId);
  const values: DeviceRuntimeState["values"] = {};
  if (model.family === "digital-input") values.input = false;
  if (model.family === "adc-source") values.value = 0;
  if (isDs3231Definition(definition)) {
    values.seconds = 0;
    values.minutes = 0;
    values.hours = 0;
    values.temperatureC = parseNumber(component.properties?.temperatureC ?? component.properties?.temperature, 25);
  }
  if (model.family === "i2c-display" || model.family === "spi-device") values.displayText = "";
  return {
    componentId: component.id,
    definitionId: component.definitionId,
    family: model.family,
    modelId: model.modelId,
    adapterId: adapter.adapterId,
    support: model.support,
    status: adapter.support === "behavioral" || adapter.support === "engine-backed" ? "unwired" : "unsupported",
    values,
  };
}

/**
 * Protocol-aware device runtime shared by the browser firmware interpreter.
 * It models buses and device state; it does not parse firmware source.
 */
export interface ProtocolRuntime {
  readonly events: ProtocolTrace[];
  readonly warnings: ProtocolWarning[];
  readonly deviceStates: DeviceRuntimeState[];
  advanceTo(timeMs: number): void;
  analogRead(controllerId: string, portId: string, inputs: Record<string, ProtocolValue>): number;
  pwmWrite(controllerId: string, portId: string, duty: number, frequencyHz?: number): void;
  i2cBeginTransmission(controllerId: string, address: number): void;
  i2cWrite(controllerId: string, value: number): void;
  i2cEndTransmission(controllerId: string): number;
  i2cRequestFrom(controllerId: string, address: number, length: number): number;
  i2cAvailable(controllerId: string): number;
  i2cRead(controllerId: string): number;
  spiBeginTransaction(controllerId: string, chipSelect?: number | string): void;
  spiTransfer(controllerId: string, value: number): number;
  spiEndTransaction(controllerId: string): void;
  serialWrite(controllerId: string, data: number[]): void;
  serialAvailable(controllerId: string): number;
  serialRead(controllerId: string): number;
}

export function createProtocolRuntime(project: RuntimeProject, dsu: RuntimeDisjointSet, durationMs: number, inputs: Record<string, ProtocolValue> = {}): ProtocolRuntime {
  const state: RuntimeState = {
    cursorMs: 0,
    i2c: new Map(),
    registerPointers: new Map(),
    registers: new Map(),
    spiChipSelect: new Map(),
    serialRx: new Map(),
    deviceStates: new Map(),
  };
  const events: ProtocolTrace[] = [];
  const warnings: ProtocolWarning[] = [];

  for (const component of project.components) {
    const definition = definitionFor(component);
    if (definition) state.deviceStates.set(component.id, initialDeviceState(component, definition));
  }

  // The UI exposes scalar simulation inputs. Treat <boardId>:rx (or an
  // input attached to a connected device TX) as one deterministic UART byte;
  // this keeps Serial.available()/read() observable without pretending to
  // implement a device-specific serial protocol.
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const separator = key.indexOf(":");
    if (separator < 1 || !/^(rx|serial|uart|incoming)$/i.test(key.slice(separator + 1))) continue;
    const sourceId = key.slice(0, separator);
    for (const controller of project.components) {
      const controllerDefinition = definitionFor(controller);
      if (!controllerDefinition || legacyModelFor(controllerDefinition).family !== "mcu") continue;
      const sourceDefinition = definitionFor(componentFor(project, sourceId));
      const receivesFromSource = sourceId === controller.id || (
        sourceId !== controller.id
        && Boolean(sourceDefinition)
        && netsConnected(dsu, busPort(controllerDefinition, "uart", "rx"), controller.id, busPort(sourceDefinition!, "uart", "tx"), sourceId)
      );
      if (receivesFromSource) state.serialRx.set(controller.id, [Math.max(0, Math.min(255, Math.floor(value)))]);
    }
  }

  function updateClock(deviceId: string) {
    const component = componentFor(project, deviceId);
    const definition = definitionFor(component);
    const device = state.deviceStates.get(deviceId);
    if (!component || !definition || !isDs3231Definition(definition) || !device) return;
    const start = component.properties?.epochMs !== undefined
      ? parseNumber(component.properties.epochMs, Date.UTC(2024, 0, 1))
      : Date.UTC(2024, 0, 1);
    const date = new Date(start + Math.floor(state.cursorMs / 1000) * 1000);
    device.values.seconds = date.getUTCSeconds();
    device.values.minutes = date.getUTCMinutes();
    device.values.hours = date.getUTCHours();
  }

  function markConnected(deviceId: string | undefined, active: boolean) {
    if (!deviceId) return;
    const device = state.deviceStates.get(deviceId);
    if (device && device.status !== "unsupported") device.status = active ? "active" : "unwired";
  }

  function warn(code: string, message: string, details: { componentId?: string; controllerId?: string } = {}) {
    if (!warnings.some((item) => item.code === code && item.componentId === details.componentId && item.controllerId === details.controllerId)) warnings.push({ code, message, ...details });
  }

  function deviceAt(controllerId: string, address: number) {
    const candidate = connectedProtocolTarget(project, dsu, controllerId, "i2c", address);
    const definition = definitionFor(candidate);
    if (!candidate || !definition) return undefined;
    const device = state.deviceStates.get(candidate.id);
    if (!device || !["i2c-register", "i2c-display"].includes(device.family)) return undefined;
    if (!["behavioral", "engine-backed"].includes(legacyModelFor(definition).support)) return undefined;
    updateClock(candidate.id);
    return { component: candidate, definition, state: device };
  }

  function registerFile(deviceId: string) {
    let registers = state.registers.get(deviceId);
    if (!registers) {
      registers = new Uint8Array(256);
      state.registers.set(deviceId, registers);
    }
    return registers;
  }

  function readRegister(deviceId: string, definition: CatalogComponent, register: number) {
    if (isDs3231Definition(definition)) {
      const component = componentFor(project, deviceId);
      const temperature = parseNumber(component?.properties?.temperatureC ?? component?.properties?.temperature, 25);
      const start = component?.properties?.epochMs !== undefined ? parseNumber(component.properties.epochMs, Date.UTC(2024, 0, 1)) : Date.UTC(2024, 0, 1);
      const date = new Date(start + Math.floor(state.cursorMs / 1000) * 1000);
      switch (register & 0xff) {
        case 0x00: return bcd(date.getUTCSeconds());
        case 0x01: return bcd(date.getUTCMinutes());
        case 0x02: return bcd(date.getUTCHours());
        case 0x03: return bcd(date.getUTCDay() + 1);
        case 0x04: return bcd(date.getUTCDate());
        case 0x05: return bcd(date.getUTCMonth() + 1);
        case 0x06: return bcd(date.getUTCFullYear() % 100);
        case 0x0e: return 0x00;
        case 0x0f: return 0x00;
        case 0x11: return Math.trunc(temperature) & 0xff;
        case 0x12: return (Math.round((temperature - Math.trunc(temperature)) / 0.25) & 0x03) << 6;
        default: return registerFile(deviceId)[register & 0xff];
      }
    }
    return registerFile(deviceId)[register & 0xff];
  }

  function updateDisplay(deviceId: string, data: number[]) {
    const device = state.deviceStates.get(deviceId);
    if (!device || !["i2c-display", "spi-device"].includes(device.family)) return;
    const text = data.filter((byte) => byte >= 32 && byte <= 126).map((byte) => String.fromCharCode(byte)).join("");
    if (text) device.values.displayText = `${String(device.values.displayText ?? "")}${text}`.slice(-256);
  }

  const runtime: ProtocolRuntime = {
    events,
    warnings,
    get deviceStates() {
      for (const component of project.components) {
        if (state.deviceStates.has(component.id)) updateClock(component.id);
      }
      return [...state.deviceStates.values()].map((device) => ({ ...device, values: { ...device.values } }));
    },
    advanceTo(timeMs) {
      state.cursorMs = Math.max(state.cursorMs, Math.min(Math.max(0, timeMs), durationMs));
      for (const component of project.components) updateClock(component.id);
    },
    analogRead(controllerId, portId, inputs) {
      const root = dsu.find(endpointKey(controllerId, portId));
      const sensor = project.components.find((candidate) => {
        if (candidate.id === controllerId) return false;
        const definition = definitionFor(candidate);
        return Boolean(definition && legacyModelFor(definition).family === "adc-source") && definition?.ports.some((candidatePort) => candidatePort.domain === "adc" && sharedNet(dsu, root, dsu.find(endpointKey(candidate.id, candidatePort.id))));
      });
      const definition = definitionFor(sensor);
      const inputEntries = sensor ? Object.entries(inputs).filter(([key]) => key.startsWith(`${sensor.id}:`)) : [];
      const inputValue = inputEntries.find(([key]) => /:(value|analog|voltage|temperature|temperatureC|lux|light|humidity)$/i.test(key))?.[1];
      let value = typeof inputValue === "number" ? inputValue : sensor ? parseNumber(sensor.properties?.value ?? sensor.properties?.analogValue, 0) : 0;
      if (sensor && definition && /(tmp36|temperature|thermistor|ntc)/i.test(`${sensor.definitionId} ${definition.title}`) && inputValue !== undefined && /temperature/i.test(inputEntries.find(([key]) => key.includes(":"))?.[0] ?? "")) {
        const voltage = 0.5 + value * 0.01;
        value = Math.max(0, Math.min(1023, voltage / (controllerId.toLowerCase().includes("esp32") ? 3.3 : 5) * 1023));
      }
      const device = sensor ? state.deviceStates.get(sensor.id) : undefined;
      if (device) device.values.value = value;
      events.push({ kind: "adc", timeMs: state.cursorMs, controllerId, deviceId: sensor?.id, portId, value });
      return value;
    },
    pwmWrite(controllerId, portId, duty, frequencyHz) {
      const root = dsu.find(endpointKey(controllerId, portId));
      const target = project.components.find((candidate) => candidate.id !== controllerId && definitionFor(candidate)?.ports.some((candidatePort) => candidatePort.domain === "pwm" && sharedNet(dsu, root, dsu.find(endpointKey(candidate.id, candidatePort.id)))));
      const boundedDuty = Math.max(0, Math.min(255, duty));
      const device = target ? state.deviceStates.get(target.id) : undefined;
      if (device) {
        device.status = "active";
        device.values.duty = boundedDuty;
        device.values.angle = Math.round(boundedDuty / 255 * 180);
      }
      events.push({ kind: "pwm", timeMs: state.cursorMs, controllerId, deviceId: target?.id, portId, duty: boundedDuty, frequencyHz });
    },
    i2cBeginTransmission(controllerId, address) {
      const target = deviceAt(controllerId, address);
      state.i2c.set(controllerId, { address, bytes: [], readQueue: [], pointer: target ? state.registerPointers.get(target.component.id) ?? 0 : undefined, deviceId: target?.component.id });
    },
    i2cWrite(controllerId, value) {
      const transaction = state.i2c.get(controllerId);
      if (!transaction) {
        warn("I2C_WRITE_WITHOUT_START", "Wire.write() was called without Wire.beginTransmission().", { controllerId });
        return;
      }
      transaction.bytes.push(value & 0xff);
    },
    i2cEndTransmission(controllerId) {
      const transaction = state.i2c.get(controllerId);
      if (!transaction) return 4;
      const target = transaction.deviceId ? { component: componentFor(project, transaction.deviceId), definition: definitionFor(componentFor(project, transaction.deviceId)) } : undefined;
      const acknowledged = Boolean(target?.component && target.definition);
      if (target?.component && target.definition && transaction.bytes.length > 0) {
        const displayPayload = legacyModelFor(target.definition).adapterId === "i2c-display-text";
        const pointer = transaction.bytes[0] & 0xff;
        if (!displayPayload) state.registerPointers.set(target.component.id, pointer);
        transaction.pointer = pointer;
        if (displayPayload) {
          updateDisplay(target.component.id, transaction.bytes);
        } else if (isDs3231Definition(target.definition)) {
          if (transaction.bytes.length > 1) warn("DS3231_REGISTER_WRITE_UNSUPPORTED", "The DS3231 model supports deterministic register reads only; control/time register writes were not applied.", { componentId: target.component.id, controllerId });
        } else {
          const registers = registerFile(target.component.id);
          for (const [index, byte] of transaction.bytes.slice(1).entries()) registers[(pointer + index) & 0xff] = byte;
        }
        if (!displayPayload) updateDisplay(target.component.id, transaction.bytes.slice(1));
        markConnected(target.component.id, true);
      }
      events.push({ kind: "i2c", timeMs: state.cursorMs, controllerId, deviceId: target?.component?.id, address: transaction.address, operation: "write", register: transaction.bytes[0], data: [...transaction.bytes], acknowledged });
      if (!acknowledged) warn("I2C_DEVICE_NOT_FOUND", `No wired I2C device acknowledged address 0x${transaction.address.toString(16)}.`, { controllerId });
      return acknowledged ? 0 : 2;
    },
    i2cRequestFrom(controllerId, address, length) {
      const target = deviceAt(controllerId, address);
      const transaction = state.i2c.get(controllerId) ?? { address, bytes: [], readQueue: [], deviceId: target?.component.id };
      transaction.address = address;
      transaction.deviceId = target?.component.id;
      transaction.readQueue = [];
      const pointer = target?.component ? state.registerPointers.get(target.component.id) ?? 0 : 0;
      if (target?.component && target.definition) {
        for (let index = 0; index < Math.max(0, Math.min(512, Math.floor(length))); index += 1) transaction.readQueue.push(readRegister(target.component.id, target.definition, pointer + index));
        state.registerPointers.set(target.component.id, (pointer + transaction.readQueue.length) & 0xff);
        markConnected(target.component.id, true);
      }
      const acknowledged = Boolean(target?.component && target.definition);
      events.push({ kind: "i2c", timeMs: state.cursorMs, controllerId, deviceId: target?.component?.id, address, operation: "read", register: pointer, data: [...transaction.readQueue], acknowledged });
      if (!acknowledged) warn("I2C_DEVICE_NOT_FOUND", `No wired I2C device acknowledged address 0x${address.toString(16)}.`, { controllerId });
      state.i2c.set(controllerId, transaction);
      return transaction.readQueue.length;
    },
    i2cAvailable(controllerId) {
      return state.i2c.get(controllerId)?.readQueue.length ?? 0;
    },
    i2cRead(controllerId) {
      const transaction = state.i2c.get(controllerId);
      if (!transaction || transaction.readQueue.length === 0) {
        warn("I2C_READ_WITHOUT_DATA", "Wire.read() was called without available bytes.", { controllerId });
        return 0;
      }
      return transaction.readQueue.shift() ?? 0;
    },
    spiBeginTransaction(controllerId, chipSelect) {
      state.spiChipSelect.set(controllerId, chipSelect);
    },
    spiTransfer(controllerId, value) {
      const target = connectedProtocolTarget(project, dsu, controllerId, "spi");
      const response = 0;
      events.push({ kind: "spi", timeMs: state.cursorMs, controllerId, deviceId: target?.id, data: [value & 0xff], response: [response], acknowledged: Boolean(target) });
      if (!target) warn("SPI_DEVICE_NOT_FOUND", "SPI.transfer() has no wired SPI target on the active bus.", { controllerId });
      return response;
    },
    spiEndTransaction(controllerId) {
      state.spiChipSelect.delete(controllerId);
    },
    serialWrite(controllerId, data) {
      const target = connectedProtocolTarget(project, dsu, controllerId, "uart");
      events.push({ kind: "uart", timeMs: state.cursorMs, controllerId, deviceId: target?.id, direction: "tx", data: data.map((value) => value & 0xff), acknowledged: Boolean(target) });
    },
    serialAvailable(controllerId) {
      return state.serialRx.get(controllerId)?.length ?? 0;
    },
    serialRead(controllerId) {
      const queue = state.serialRx.get(controllerId);
      if (!queue?.length) {
        warn("UART_READ_WITHOUT_DATA", "Serial.read() was called without an RX byte.", { controllerId });
        return -1;
      }
      const value = queue.shift() ?? -1;
      events.push({ kind: "uart", timeMs: state.cursorMs, controllerId, direction: "rx", data: [value], acknowledged: true });
      return value;
    },
  };

  return runtime;
}

export function catalogModelCoverage(definitions: CatalogComponent[]) {
  return definitions.reduce<Record<string, number>>((coverage, definition) => {
    const model = legacyModelFor(definition);
    const key = `${model.support}:${model.family}`;
    coverage[key] = (coverage[key] ?? 0) + 1;
    return coverage;
  }, {});
}

export type HardwarePortContract = HardwarePort;
