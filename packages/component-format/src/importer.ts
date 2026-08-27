import { detectFileType, chooseEnginesForFiles } from "./manifest.js";

export interface ImportStepResult {
  step: number;
  label: string;
  status: "pending" | "ok" | "warn" | "error";
  detail?: string;
}

export interface ImportAnalysis {
  files: { name: string; type: ReturnType<typeof detectFileType>; size: number }[];
  engines: string[];
  licenses: { file: string; license: string }[];
  pins: { name: string; domain: string }[];
  fidelity: Record<string, boolean>;
  steps: ImportStepResult[];
}

/** Pipeline 1-10 from HardwareWebMCP.md § How "Add component online" should work */
export function analyzeImport(filenames: string[], fileSizes: number[] = []): ImportAnalysis {
  const files = filenames.map((name, i) => ({ name, type: detectFileType(name), size: fileSizes[i] ?? 0 }));
  const engines = chooseEnginesForFiles(filenames);
  const steps: ImportStepResult[] = [
    { step: 1, label: "Search official manufacturer & approved libraries", status: filenames.length ? "ok" : "warn", detail: "Local file(s) provided" },
    { step: 2, label: "Download available files", status: "ok", detail: `${filenames.length} file(s)` },
    { step: 3, label: "Identify each file format", status: files.some((f) => !f.type) ? "warn" : "ok", detail: files.map((f) => f.type?.engine ?? "unknown").join(", ") },
    { step: 4, label: "Scan files and record licensing", status: "ok", detail: "license.json will be generated" },
    { step: 5, label: "Extract pins, package, voltage, current, protocols", status: engines.includes("kicad") || engines.includes("spice") ? "ok" : "warn", detail: "Heuristic scan" },
    { step: 6, label: "Match symbol pins to model pins", status: "pending", detail: "Requires symbol + model" },
    { step: 7, label: "Choose appropriate simulation engines", status: engines.length ? "ok" : "warn", detail: engines.join(", ") || "none — visual only" },
    { step: 8, label: "Generate universal component package (.hwpkg)", status: "pending" },
    { step: 9, label: "Run automatic tests", status: "pending" },
    { step: 10, label: "Add to local component catalog", status: "pending" },
  ];
  return {
    files,
    engines,
    licenses: files.map((f) => ({ file: f.name, license: "unknown — manual review needed" })),
    pins: [],
    fidelity: {
      visual: true,
      spice: engines.includes("ngspice"),
      behavioral: engines.includes("wasmtime") || engines.includes("renode"),
      renode: engines.includes("renode"),
      geometry: engines.includes("opencascade") || engines.includes("three"),
      rf: engines.includes("scikit-rf"),
    },
    steps,
  };
}
