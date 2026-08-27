import JSZip from "jszip";
import { HwpkgManifestSchema, type HwpkgManifest } from "./manifest.js";

export interface HwpkgFile { path: string; data: Uint8Array | string; }

/** Create a .hwpkg ZIP from manifest + files (returns Uint8Array) */
export async function packHwpkg(manifest: HwpkgManifest, files: HwpkgFile[]): Promise<Uint8Array> {
  const parsed = HwpkgManifestSchema.parse(manifest);
  const zip = new JSZip();
  zip.file("manifest.yaml", JSON.stringify(parsed, null, 2));
  // also write JSON variant for tooling
  zip.file("manifest.json", JSON.stringify(parsed, null, 2));
  for (const f of files) {
    zip.file(f.path, f.data as any);
  }
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function unpackHwpkg(data: Uint8Array): Promise<{ manifest: HwpkgManifest; files: HwpkgFile[] }> {
  const zip = await JSZip.loadAsync(data);
  const manifestRaw = await zip.file("manifest.json")?.async("string") ?? await zip.file("manifest.yaml")?.async("string");
  if (!manifestRaw) throw new Error("Missing manifest.json/yaml in .hwpkg");
  const manifest = HwpkgManifestSchema.parse(JSON.parse(manifestRaw));
  const files: HwpkgFile[] = [];
  zip.forEach((rel, entry) => {
    if (rel === "manifest.yaml" || rel === "manifest.json" || entry.dir) return;
    files.push({ path: rel, data: "" as any }); // placeholder, caller can load async if needed
  });
  return { manifest, files };
}

export function fidelityChecklist(manifest: HwpkgManifest) {
  return {
    visual: !!manifest.fidelity?.visual,
    spice: !!manifest.fidelity?.spice,
    behavioral: !!manifest.fidelity?.behavioral,
    renode: !!manifest.fidelity?.renode,
    geometry: !!manifest.fidelity?.geometry,
    rf: !!manifest.fidelity?.rf,
    thermal: !!manifest.fidelity?.thermal,
  };
}
