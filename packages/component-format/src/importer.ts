import { detectFileType, chooseEnginesForFiles } from "./manifest.js";

export interface ImportStepResult {
  step: number;
  label: string;
  status: "pending" | "ok" | "warn" | "error";
  detail?: string;
}

export interface ImportAnalysis {
  files: { name: string; recognizedFormat: string | null; description: string; possibleExternalTool: string | null; size: number; verification: "not-performed" }[];
  possibleExternalTools: string[];
  licenses: { file: string; license: string }[];
  pins: { name: string; domain: string }[];
  claims: { filesRead: false; filesExecuted: false; filesImported: false; compatibilityVerified: false };
  steps: ImportStepResult[];
}

/** Filename-only artifact handoff analysis. This never reads file contents,
 * grants in-app capability, or claims compatibility with an external tool. */
export function analyzeImport(filenames: string[], fileSizes: number[] = []): ImportAnalysis {
  const files = filenames.map((name, i) => {
    const detected = detectFileType(name);
    return { name, recognizedFormat: detected?.ext ?? null, description: detected?.description ?? "Unknown filename extension", possibleExternalTool: detected?.engine ?? null, size: fileSizes[i] ?? 0, verification: "not-performed" as const };
  });
  const possibleExternalTools = chooseEnginesForFiles(filenames);
  const steps: ImportStepResult[] = [
    { step: 1, label: "Receive artifact filenames", status: filenames.length ? "ok" : "warn", detail: `${filenames.length} filename(s); contents were not read` },
    { step: 2, label: "Recognize filename extensions", status: files.some((file) => !file.recognizedFormat) ? "warn" : "ok", detail: files.map((file) => file.recognizedFormat ?? "unknown").join(", ") },
    { step: 3, label: "List possible external tools", status: possibleExternalTools.length ? "warn" : "pending", detail: possibleExternalTools.length ? `${possibleExternalTools.join(", ")} (suggestions only; unavailable and unverified in Schematic)` : "No external tool suggestion" },
    { step: 4, label: "Review licensing externally", status: "pending", detail: "No license scan was performed" },
    { step: 5, label: "Inspect contents externally", status: "pending", detail: "No pins, models, firmware, or electrical behavior were inspected" },
    { step: 6, label: "Verify compatibility externally", status: "pending", detail: "No import, execution, fidelity, or compatibility test was performed" },
  ];
  return {
    files,
    possibleExternalTools,
    licenses: files.map((f) => ({ file: f.name, license: "unknown — manual review needed" })),
    pins: [],
    claims: { filesRead: false, filesExecuted: false, filesImported: false, compatibilityVerified: false },
    steps,
  };
}
