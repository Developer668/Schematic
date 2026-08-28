import type { ToolchainAssetManifest } from "./manifest";
import { sha256Hex } from "./hash";

export interface AssetCacheEntry {
  bytes: Uint8Array;
  sha256?: string;
}

export interface AssetCache {
  get(key: string): Promise<AssetCacheEntry | null>;
  put(key: string, entry: AssetCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryAssetCache implements AssetCache {
  private readonly entries = new Map<string, AssetCacheEntry>();

  async get(key: string): Promise<AssetCacheEntry | null> {
    const entry = this.entries.get(key);
    return entry ? { ...entry, bytes: new Uint8Array(entry.bytes) } : null;
  }

  async put(key: string, entry: AssetCacheEntry): Promise<void> {
    this.entries.set(key, { ...entry, bytes: new Uint8Array(entry.bytes) });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

/** Cache Storage implementation for immutable compiler assets. */
export class CacheStorageAssetCache implements AssetCache {
  constructor(private readonly cache: Cache) {}

  async get(key: string): Promise<AssetCacheEntry | null> {
    const response = await this.cache.match(new Request(key));
    if (!response) return null;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      sha256: response.headers.get("x-schematic-sha256") ?? undefined,
    };
  }

  async put(key: string, entry: AssetCacheEntry): Promise<void> {
    const headers = new Headers({ "content-type": "application/octet-stream" });
    if (entry.sha256) headers.set("x-schematic-sha256", entry.sha256);
    const owned = new Uint8Array(entry.bytes);
    await this.cache.put(new Request(key), new Response(new Blob([owned.buffer as ArrayBuffer]), { headers }));
  }

  async delete(key: string): Promise<void> {
    await this.cache.delete(new Request(key));
  }
}

export interface AssetFetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type AssetFetcher = (url: string, options?: { signal?: AbortSignal }) => Promise<AssetFetchResponse>;

export class AssetIntegrityError extends Error {
  readonly key: string;

  constructor(key: string, message: string) {
    super(`${key}: ${message}`);
    this.name = "AssetIntegrityError";
    this.key = key;
  }
}

/**
 * Reads from Cache Storage first, re-hashes cached bytes, evicts corrupt data,
 * and only then fetches. A network response is accepted only when its SHA-256
 * matches the manifest.
 */
export async function loadVerifiedAsset(
  asset: ToolchainAssetManifest,
  cache: AssetCache,
  fetcher: AssetFetcher = (input, options) => globalThis.fetch(input, options),
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const cached = await cache.get(asset.id);
  if (cached) {
    const cachedHash = await sha256Hex(cached.bytes);
    if (cachedHash === asset.sha256) return new Uint8Array(cached.bytes);
    await cache.delete(asset.id);
  }

  if (signal?.aborted) throw new DOMException("The asset load was cancelled", "AbortError");
  const response = await fetcher(asset.url, { signal });
  if (!response.ok) throw new AssetIntegrityError(asset.id, `asset request failed with HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualHash = await sha256Hex(bytes);
  if (actualHash !== asset.sha256) {
    await cache.delete(asset.id);
    throw new AssetIntegrityError(asset.id, `SHA-256 mismatch: expected ${asset.sha256}, got ${actualHash}`);
  }
  if (asset.sizeBytes !== bytes.byteLength) {
    await cache.delete(asset.id);
    throw new AssetIntegrityError(asset.id, `size mismatch: expected ${asset.sizeBytes}, got ${bytes.byteLength}`);
  }
  await cache.put(asset.id, { bytes, sha256: actualHash });
  return new Uint8Array(bytes);
}
