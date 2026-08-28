import type { CompilerFamily } from "./types";

export type ToolchainAssetKind = "wasm" | "header" | "object" | "linker" | "metadata";

export interface ToolchainSource {
  repository: string;
  revision: string;
  buildRecipe: string;
}

export interface ToolchainLegalMetadata {
  licenseExpression: string;
  noticeFiles: readonly string[];
  sourceUrl: string;
  redistribution: "review-required" | "approved";
}

export interface ToolchainAssetManifest {
  id: string;
  kind: ToolchainAssetKind;
  path: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface ToolchainTargetManifest {
  id: string;
  fqbn: string;
  mcu: string;
  flashBytes: number;
  assetIds: readonly string[];
  sourceExtensions: readonly string[];
}

export interface ToolchainManifest {
  schemaVersion: 1;
  id: string;
  family: CompilerFamily;
  version: string;
  source: ToolchainSource;
  legal: ToolchainLegalMetadata;
  assets: readonly ToolchainAssetManifest[];
  targets: readonly ToolchainTargetManifest[];
}

export class ToolchainManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolchainManifestError";
  }
}

const HASH_PATTERN = /^[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ToolchainManifestError(`${label} must be a non-empty string`);
  return value;
}

function requiredStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ToolchainManifestError(`${label} must be an array of non-empty strings`);
  }
  return value;
}

function safePath(path: string, label: string): string {
  if (path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new ToolchainManifestError(`${label} must not escape the asset root`);
  }
  return path;
}

export function validateToolchainManifest(input: unknown): ToolchainManifest {
  if (!isRecord(input)) throw new ToolchainManifestError("manifest must be an object");
  if (input.schemaVersion !== 1) throw new ToolchainManifestError("unsupported manifest schemaVersion");

  const sourceValue = input.source;
  const legalValue = input.legal;
  if (!isRecord(sourceValue) || !isRecord(legalValue)) {
    throw new ToolchainManifestError("manifest source and legal metadata are required");
  }

  const assetsValue = input.assets;
  const targetsValue = input.targets;
  if (!Array.isArray(assetsValue) || !Array.isArray(targetsValue)) {
    throw new ToolchainManifestError("manifest assets and targets must be arrays");
  }

  const assets: ToolchainAssetManifest[] = [];
  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  for (const [index, value] of assetsValue.entries()) {
    if (!isRecord(value)) throw new ToolchainManifestError(`assets[${index}] must be an object`);
    const id = requiredString(value.id, `assets[${index}].id`);
    const path = safePath(requiredString(value.path, `assets[${index}].path`), `assets[${index}].path`);
    const url = requiredString(value.url, `assets[${index}].url`);
    const sizeBytes = value.sizeBytes;
    const sha256 = requiredString(value.sha256, `assets[${index}].sha256`);
    if (!HASH_PATTERN.test(sha256)) throw new ToolchainManifestError(`assets[${index}].sha256 must be a SHA-256 hex string`);
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) < 0) {
      throw new ToolchainManifestError(`assets[${index}].sizeBytes must be a non-negative integer`);
    }
    if (assetIds.has(id) || assetPaths.has(path)) throw new ToolchainManifestError(`duplicate asset id or path: ${id}`);
    if (!["wasm", "header", "object", "linker", "metadata"].includes(String(value.kind))) {
      throw new ToolchainManifestError(`assets[${index}].kind is invalid`);
    }
    assetIds.add(id);
    assetPaths.add(path);
    assets.push({
      id,
      kind: value.kind as ToolchainAssetKind,
      path,
      url,
      sizeBytes: sizeBytes as number,
      sha256: sha256.toLowerCase(),
    });
  }

  const targets: ToolchainTargetManifest[] = [];
  const targetIds = new Set<string>();
  const targetFqbns = new Set<string>();
  for (const [index, value] of targetsValue.entries()) {
    if (!isRecord(value)) throw new ToolchainManifestError(`targets[${index}] must be an object`);
    const id = requiredString(value.id, `targets[${index}].id`);
    const fqbn = requiredString(value.fqbn, `targets[${index}].fqbn`);
    const mcu = requiredString(value.mcu, `targets[${index}].mcu`);
    const flashBytes = value.flashBytes;
    const assetIdsForTarget = requiredStringArray(value.assetIds, `targets[${index}].assetIds`);
    const sourceExtensions = requiredStringArray(value.sourceExtensions, `targets[${index}].sourceExtensions`);
    if (!Number.isSafeInteger(flashBytes) || (flashBytes as number) <= 0) {
      throw new ToolchainManifestError(`targets[${index}].flashBytes must be a positive integer`);
    }
    if (targetIds.has(id) || targetFqbns.has(fqbn)) throw new ToolchainManifestError(`duplicate target id or FQBN: ${id}`);
    for (const assetId of assetIdsForTarget) {
      if (!assetIds.has(assetId)) throw new ToolchainManifestError(`target ${id} references missing asset ${assetId}`);
    }
    targetIds.add(id);
    targetFqbns.add(fqbn);
    targets.push({ id, fqbn, mcu, flashBytes: flashBytes as number, assetIds: assetIdsForTarget, sourceExtensions });
  }

  const redistribution = legalValue.redistribution;
  if (redistribution !== "review-required" && redistribution !== "approved") {
    throw new ToolchainManifestError("legal.redistribution must be review-required or approved");
  }

  return {
    schemaVersion: 1,
    id: requiredString(input.id, "id"),
    family: input.family === "avr" ? "avr" : (() => { throw new ToolchainManifestError("only the AVR family is supported"); })(),
    version: requiredString(input.version, "version"),
    source: {
      repository: requiredString(sourceValue.repository, "source.repository"),
      revision: requiredString(sourceValue.revision, "source.revision"),
      buildRecipe: requiredString(sourceValue.buildRecipe, "source.buildRecipe"),
    },
    legal: {
      licenseExpression: requiredString(legalValue.licenseExpression, "legal.licenseExpression"),
      noticeFiles: requiredStringArray(legalValue.noticeFiles, "legal.noticeFiles"),
      sourceUrl: requiredString(legalValue.sourceUrl, "legal.sourceUrl"),
      redistribution,
    },
    assets,
    targets,
  };
}
