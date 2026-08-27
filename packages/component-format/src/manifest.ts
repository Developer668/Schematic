import { z } from "zod";

export const HwpkgManifestSchema = z.object({
  format: z.literal("hwpkg"),
  version: z.number().int().min(1),
  component: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    manufacturer: z.string().optional(),
    partNumber: z.string().optional(),
    category: z.string(),
    version: z.string().optional(),
  }),
  ports: z.array(z.object({
    id: z.string(),
    name: z.string(),
    domain: z.string(),
    direction: z.string(),
    voltage: z.object({ min: z.number().optional(), nominal: z.number().optional(), max: z.number().optional(), maxCurrentA: z.number().optional() }).optional(),
  })).optional(),
  models: z.record(z.object({ engine: z.string(), file: z.string(), fidelity: z.string().optional(), verified: z.boolean().optional() })).optional(),
  files: z.record(z.string()).optional(),
  fidelity: z.object({
    visual: z.boolean().optional(),
    spice: z.boolean().optional(),
    behavioral: z.boolean().optional(),
    renode: z.boolean().optional(),
    geometry: z.boolean().optional(),
    rf: z.boolean().optional(),
    thermal: z.boolean().optional(),
  }).optional(),
  license: z.object({ component: z.string().optional(), files: z.record(z.string()).optional() }).optional(),
});

export type HwpkgManifest = z.infer<typeof HwpkgManifestSchema>;

export function createMinimalManifest(componentId: string, title: string): HwpkgManifest {
  return {
    format: "hwpkg",
    version: 1,
    component: { id: componentId, title, category: "custom", version: "0.1.0" },
    fidelity: { visual: true },
    models: {},
  };
}

// File-type → engine map per HardwareWebMCP.md table
export const FILE_TYPE_MAP: Record<string, { engine: string; fidelity: string; description: string }> = {
  ".lib": { engine: "ngspice", fidelity: "spice", description: "Analog electrical behavior" },
  ".cir": { engine: "ngspice", fidelity: "spice", description: "Analog electrical behavior" },
  ".sp": { engine: "ngspice", fidelity: "spice", description: "Analog electrical behavior" },
  ".subckt": { engine: "ngspice", fidelity: "spice", description: "Analog electrical behavior" },
  ".model": { engine: "ngspice", fidelity: "spice", description: "Analog electrical behavior" },
  ".ibs": { engine: "ibis", fidelity: "ibis", description: "Digital IO buffer" },
  ".s1p": { engine: "scikit-rf", fidelity: "rf_sparam", description: "RF S-params 1-port" },
  ".s2p": { engine: "scikit-rf", fidelity: "rf_sparam", description: "RF S-params 2-port" },
  ".s4p": { engine: "scikit-rf", fidelity: "rf_sparam", description: "RF S-params 4-port" },
  ".v": { engine: "verilator", fidelity: "verilog", description: "Digital hardware logic" },
  ".sv": { engine: "verilator", fidelity: "verilog", description: "Digital hardware logic" },
  ".elf": { engine: "renode", fidelity: "firmware", description: "Compiled firmware" },
  ".hex": { engine: "renode", fidelity: "firmware", description: "Compiled firmware" },
  ".bin": { engine: "renode", fidelity: "firmware", description: "Compiled firmware" },
  ".uf2": { engine: "renode", fidelity: "firmware", description: "Compiled firmware" },
  ".svd": { engine: "renode", fidelity: "svd", description: "Registers/memory map" },
  ".pack": { engine: "cmsis", fidelity: "cmsis-pack", description: "Device files headers" },
  ".fmu": { engine: "fmi", fidelity: "fmu", description: "Physical model FMU" },
  ".mo": { engine: "openmodelica", fidelity: "modelica", description: "Physical model Modelica" },
  ".urdf": { engine: "gazebo", fidelity: "urdf", description: "Robot/mechanical" },
  ".sdf": { engine: "gazebo", fidelity: "sdf", description: "Robot/mechanical" },
  ".step": { engine: "opencascade", fidelity: "geometry", description: "Shape/dimensions" },
  ".stp": { engine: "opencascade", fidelity: "geometry", description: "Shape/dimensions" },
  ".iges": { engine: "opencascade", fidelity: "geometry", description: "Shape/dimensions" },
  ".glb": { engine: "three", fidelity: "geometry", description: "Visual representation" },
  ".gltf": { engine: "three", fidelity: "geometry", description: "Visual representation" },
  ".kicad_sym": { engine: "kicad", fidelity: "symbol", description: "Symbol/pin metadata" },
  ".kicad_mod": { engine: "kicad", fidelity: "footprint", description: "PCB footprint" },
};

export function detectFileType(filename: string) {
  const lower = filename.toLowerCase();
  for (const [ext, meta] of Object.entries(FILE_TYPE_MAP)) if (lower.endsWith(ext)) return { ext, ...meta };
  if (lower.endsWith(".pdf")) return { ext: ".pdf", engine: "metadata", fidelity: "datasheet", description: "Human-readable only" };
  return null;
}

export function chooseEnginesForFiles(filenames: string[]): string[] {
  const engines = new Set<string>();
  for (const f of filenames) {
    const t = detectFileType(f);
    if (t) engines.add(t.engine);
  }
  return [...engines];
}
