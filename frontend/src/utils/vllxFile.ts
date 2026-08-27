import { useProjectStore } from "../store/useProjectStore.ts";
import { useSimulationStore } from "../store/useSimulationStore.ts";

export interface VlxPayload {
  format: "schematic-project";
  version: 1;
  exportedAt: string;
  name?: string;
  project: ReturnType<typeof useProjectStore.getState>["project"];
  pinStates: Record<string, unknown>;
}

export function buildVlxPayload(name?: string): VlxPayload {
  const { project } = useProjectStore.getState();
  const { pinStates } = useSimulationStore.getState();
  return {
    format: "schematic-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    name: name ?? project.name,
    project,
    pinStates: pinStates as Record<string, unknown>,
  };
}

export function buildVlxBlob(name?: string): Blob {
  return new Blob([JSON.stringify(buildVlxPayload(name), null, 2)], { type: "application/json" });
}

export function triggerDownloadVlx(name?: string): string {
  const blob = buildVlxBlob(name);
  const safe = (name ?? "schematic-project").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "schematic-project";
  const filename = `${safe}.vlx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
  return filename;
}

export async function parseVlxFile(file: File): Promise<VlxPayload> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.format !== "schematic-project") throw new Error(`Not a Schematic .vlx (format=${data.format})`);
  if (data.version > 1) throw new Error(`Unsupported .vlx version ${data.version}`);
  return data as VlxPayload;
}
