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
  model: z.object({
    version: z.literal(1),
    family: z.string().min(1),
    support: z.enum(["visual", "validation", "behavioral", "engine-backed"]),
    capabilities: z.array(z.string()),
    verified: z.boolean(),
    source: z.enum(["family-template", "catalog-model", "vendor-reference", "none"]),
    modelId: z.string().min(1),
    reason: z.string().optional(),
  }),
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
      // Firmware is executable only when it is bound to the exact board
      // definition that owns the target. Legacy projects are normalized at
      // the application boundary before they reach this canonical schema.
      definitionId: z.string().min(1),
      language: z.enum(["arduino", "micropython", "espidf", "c", "python", "wasm"]),
      boardFqbn: z.string().min(1),
      files: z.array(z.object({ name: z.string(), content: z.string() })),
      compiledArtifact: z.object({
        hexB64: z.string().optional(),
        elfB64: z.string().optional(),
        binB64: z.string().optional(),
        success: z.boolean(),
        log: z.string(),
        identity: z.object({
          componentId: z.string().optional(),
          definitionId: z.string().optional(),
          sourceSha256: z.string().optional(),
          artifactName: z.string().nullable().optional(),
          artifactSha256: z.string().nullable().optional(),
          boardFqbn: z.string().optional(),
          language: z.enum(["arduino", "micropython", "espidf", "c", "python", "wasm"]).optional(),
          compiler: z.object({
            name: z.string(),
            version: z.string().nullable().optional(),
            core: z.object({ fqbn: z.string(), version: z.string().nullable().optional() }).optional(),
          }).nullable().optional(),
        }).optional(),
      }).optional(),
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
