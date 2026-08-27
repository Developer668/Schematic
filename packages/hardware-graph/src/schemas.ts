import { z } from "zod";

export const PortDomainSchema = z.enum([
  "power",
  "power_output",
  "ground",
  "gpio",
  "adc",
  "pwm",
  "i2c",
  "spi",
  "uart",
  "usb",
  "ethernet",
  "can",
  "pcie",
  "csi",
  "hdmi",
  "displayport",
  "rf",
  "mechanical",
  "optical",
]);

export const PortDirectionSchema = z.enum(["input", "output", "bidirectional", "power"]);

export const HardwarePortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  domain: PortDomainSchema,
  direction: PortDirectionSchema,
  electrical: z
    .object({
      minVoltage: z.number().optional(),
      nominalVoltage: z.number().optional(),
      maxVoltage: z.number().optional(),
      maxCurrentA: z.number().optional(),
      requiresPullup: z.boolean().optional(),
      requiresPulldown: z.boolean().optional(),
    })
    .optional(),
  protocol: z
    .object({
      role: z.string().optional(),
      version: z.string().optional(),
      address: z.number().int().min(0).max(127).optional(),
      lanes: z.number().int().optional(),
      bandwidthMbps: z.number().optional(),
    })
    .optional(),
  rf: z
    .object({
      impedanceOhm: z.number().optional(),
      freqMinHz: z.number().optional(),
      freqMaxHz: z.number().optional(),
    })
    .optional(),
  description: z.string().optional(),
});

export const ComponentDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  manufacturer: z.string().optional(),
  partNumber: z.string().optional(),
  category: z.enum(["board", "sensor", "actuator", "display", "power", "logic", "communication", "mechanical", "rf", "custom"]),
  description: z.string().optional(),
  ports: z.array(HardwarePortSchema),
  models: z.record(z.object({ engine: z.string(), file: z.string(), fidelity: z.string(), verified: z.boolean() })),
  electrical: z.object({ nominalVoltage: z.number().optional(), maxVoltage: z.number().optional(), maxCurrentA: z.number().optional(), powerMw: z.number().optional() }).optional(),
  physical: z.object({ widthMm: z.number().optional(), heightMm: z.number().optional(), depthMm: z.number().optional(), weightG: z.number().optional() }).optional(),
  datasheetUrl: z.string().optional(),
  license: z.string().optional(),
  version: z.string().optional(),
});

export const ConnectionSchema = z.object({
  id: z.string().min(1),
  source: z.object({ componentId: z.string(), portId: z.string() }),
  target: z.object({ componentId: z.string(), portId: z.string() }),
  domain: PortDomainSchema,
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  color: z.string().optional(),
  autoRouted: z.boolean().optional(),
});

export const HardwareProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  components: z.array(
    z.object({
      id: z.string(),
      definitionId: z.string(),
      position: z.object({ x: z.number(), y: z.number() }),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
      properties: z.record(z.unknown()),
      firmwareGroupId: z.string().optional(),
      label: z.string().optional(),
    }),
  ),
  connections: z.array(ConnectionSchema),
  firmwareTargets: z.array(
    z.object({
      id: z.string(),
      componentId: z.string(),
      language: z.enum(["arduino", "micropython", "espidf", "c", "python", "wasm"]),
      boardFqbn: z.string().optional(),
      files: z.array(z.object({ name: z.string(), content: z.string() })),
    }),
  ),
  simulation: z.object({
    mode: z.enum(["interactive", "batch"]),
    durationMs: z.number().optional(),
    engines: z.record(z.object({ enabled: z.boolean(), fidelity: z.enum(["fast", "high"]) })),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.literal(1),
});
