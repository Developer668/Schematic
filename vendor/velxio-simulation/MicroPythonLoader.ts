/**
 * MicroPythonLoader — Loads MicroPython firmware + user files into RP2040 flash
 *
 * 1. Parses UF2 firmware and writes it to flash
 * 2. Creates a LittleFS image with user .py files and writes it to flash at 0xa0000
 * 3. Caches the MicroPython firmware UF2 in IndexedDB for fast subsequent loads
 */

import { get as idbGet, set as idbSet } from 'idb-keyval';
import createLittleFS from 'littlefs';
// ?url tells Vite to return the correct asset URL for the WASM binary
// (without this, Emscripten fetches 'littlefs.wasm' relative to the bundle
//  which resolves to the SPA index.html — causing the "expected magic word" error)
// @ts-ignore — Vite ?url import, no type declaration needed
import littlefsWasmUrl from 'littlefs/dist/littlefs.wasm?url';

// Flash geometry (matches rp2040js and MicroPython defaults)
const FLASH_START_ADDRESS = 0x10000000;
const MICROPYTHON_FS_BLOCK_SIZE = 4096;

// UF2 block constants
const UF2_MAGIC_START0 = 0x0a324655;
const UF2_MAGIC_START1 = 0x9e5d5157;
const UF2_BLOCK_SIZE = 512;
const UF2_PAYLOAD_SIZE = 256;
const UF2_DATA_OFFSET = 32;
const UF2_ADDR_OFFSET = 12;

/**
 * MicroPython firmware variant. RP2040 boards split into the plain Raspberry
 * Pi Pico and the Pico W. The W build is larger because it embeds the CYW43439
 * WiFi driver + blob and the `network`/`socket`/`ssl` modules the plain build
 * omits, which also pushes its LittleFS filesystem to a higher flash offset.
 * Loading the plain firmware onto a Pico W board is what produced
 * "ImportError: no module named 'network'" on every WiFi/MQTT example.
 */
// 'pico' is the only variant the OSS build ships. Extra variants (e.g. the W
// build with CYW43/network, a paid pro feature) are added at runtime via
// registerFirmwareVariant(), so this is a plain string.
export type FirmwareVariant = string;

export interface FirmwareConfig {
  /** IndexedDB cache key — MUST differ per variant or the two builds collide. */
  cacheKey: string;
  remoteUrl: string;
  /** Bundled fallback served from public/firmware/. */
  fallbackPath: string;
  /** Flash offset of the MicroPython LittleFS region (board-specific). */
  fsFlashStart: number;
  /** Number of 4K blocks in the LittleFS region. */
  fsBlockCount: number;
}

// Geometry mirrors MicroPython rp2 v1.20.0 board configs:
//   PICO : MICROPY_HW_FLASH_STORAGE_BYTES = 1408K -> FS @ 0x200000-0x160000 = 0xa0000 (352 blocks)
// OSS ships only the plain Pico build. The Pico W variant (CYW43 + network, a
// paid feature) is registered at runtime by the pro overlay via
// registerFirmwareVariant('pico-w', ...) — see pro/.../cyw43/installCyw43.ts.
const FIRMWARE_CONFIGS: Record<string, FirmwareConfig> = {
  pico: {
    cacheKey: 'micropython-rp2040-uf2-v1.20.0',
    remoteUrl: 'https://micropython.org/resources/firmware/RPI_PICO-20230426-v1.20.0.uf2',
    fallbackPath: '/firmware/micropython-rp2040.uf2',
    fsFlashStart: 0xa0000,
    fsBlockCount: 352,
  },
};

/** Register an extra firmware variant at runtime (e.g. the pro overlay adds
 *  the RPI_PICO_W build). Idempotent — re-registering replaces. */
export function registerFirmwareVariant(name: string, cfg: FirmwareConfig): void {
  FIRMWARE_CONFIGS[name] = cfg;
}

/** Resolve a variant config, falling back to the plain Pico build if a
 *  variant was requested that isn't registered (defensive — never crash). */
function firmwareConfig(variant: FirmwareVariant): FirmwareConfig {
  return FIRMWARE_CONFIGS[variant] ?? FIRMWARE_CONFIGS.pico;
}

/**
 * Parse UF2 binary and write payload blocks into RP2040 flash.
 * UF2 format: 512-byte blocks, each with a 256-byte payload targeted at a flash address.
 */
export function loadUF2(uf2Data: Uint8Array, flash: Uint8Array): void {
  const view = new DataView(uf2Data.buffer, uf2Data.byteOffset, uf2Data.byteLength);

  for (let offset = 0; offset + UF2_BLOCK_SIZE <= uf2Data.length; offset += UF2_BLOCK_SIZE) {
    const magic0 = view.getUint32(offset, true);
    const magic1 = view.getUint32(offset + 4, true);
    if (magic0 !== UF2_MAGIC_START0 || magic1 !== UF2_MAGIC_START1) {
      continue; // skip non-UF2 blocks
    }

    const flashAddress = view.getUint32(offset + UF2_ADDR_OFFSET, true);
    const payload = uf2Data.subarray(
      offset + UF2_DATA_OFFSET,
      offset + UF2_DATA_OFFSET + UF2_PAYLOAD_SIZE,
    );
    const flashOffset = flashAddress - FLASH_START_ADDRESS;

    if (flashOffset >= 0 && flashOffset + UF2_PAYLOAD_SIZE <= flash.length) {
      flash.set(payload, flashOffset);
    }
  }
}

/**
 * Create a LittleFS filesystem image containing the user's Python files
 * and write it into RP2040 flash at the MicroPython filesystem offset.
 */
export async function loadUserFiles(
  files: Array<{ name: string; content: string }>,
  flash: Uint8Array,
  variant: FirmwareVariant = 'pico',
): Promise<void> {
  const { fsFlashStart, fsBlockCount } = firmwareConfig(variant);
  // Create a backing buffer for the LittleFS filesystem
  const fsBuffer = new Uint8Array(fsBlockCount * MICROPYTHON_FS_BLOCK_SIZE);

  // Initialize the littlefs WASM module.
  // locateFile redirects Emscripten's internal fetch to the Vite-resolved asset URL.
  const lfs = await createLittleFS({ locateFile: () => littlefsWasmUrl });

  // Register flash read/write callbacks for the WASM module
  const flashRead = lfs.addFunction(
    (_cfg: number, block: number, off: number, buffer: number, size: number) => {
      const start = block * MICROPYTHON_FS_BLOCK_SIZE + off;
      lfs.HEAPU8.set(fsBuffer.subarray(start, start + size), buffer);
      return 0;
    },
    'iiiiii',
  );

  const flashProg = lfs.addFunction(
    (_cfg: number, block: number, off: number, buffer: number, size: number) => {
      const start = block * MICROPYTHON_FS_BLOCK_SIZE + off;
      fsBuffer.set(lfs.HEAPU8.subarray(buffer, buffer + size), start);
      return 0;
    },
    'iiiiii',
  );

  const flashErase = lfs.addFunction((_cfg: number, _block: number) => 0, 'iii');

  const flashSync = lfs.addFunction(() => 0, 'ii');

  // Create LittleFS config and instance
  const config = lfs._new_lfs_config(
    flashRead,
    flashProg,
    flashErase,
    flashSync,
    fsBlockCount,
    MICROPYTHON_FS_BLOCK_SIZE,
  );
  const lfsInstance = lfs._new_lfs();

  // Format and mount
  lfs._lfs_format(lfsInstance, config);
  lfs._lfs_mount(lfsInstance, config);

  // Write user files using cwrap for automatic string marshalling
  const writeFile = lfs.cwrap('lfs_write_file', 'number', ['number', 'string', 'string', 'number']);

  for (const file of files) {
    const fileName = file.name;
    const content = file.content;
    // cwrap marshals `content` to the WASM heap as UTF-8, so the byte count we
    // pass must be the UTF-8 length, NOT content.length (UTF-16 code units).
    // A multi-byte char (e.g. an em-dash in a comment) makes UTF-8 longer, and
    // passing the shorter content.length truncates the tail of the file —
    // corrupting the final statement into a SyntaxError at EOF.
    const byteLength = new TextEncoder().encode(content).length;
    writeFile(lfsInstance, fileName, content, byteLength);
  }

  // Unmount and free
  lfs._lfs_unmount(lfsInstance);
  lfs._free(lfsInstance);
  lfs._free(config);

  // Copy the LittleFS image into RP2040 flash at the filesystem offset
  flash.set(fsBuffer, fsFlashStart);
}

/**
 * Get the MicroPython UF2 firmware binary.
 * Checks IndexedDB cache first, then tries remote download, then bundled fallback.
 */
export async function getFirmware(
  variant: FirmwareVariant = 'pico',
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const { cacheKey, remoteUrl, fallbackPath } = firmwareConfig(variant);

  // 1. Check IndexedDB cache
  try {
    const cached = await idbGet(cacheKey);
    if (cached instanceof Uint8Array && cached.length > 0) {
      console.log(`[MicroPython] Firmware (${variant}) loaded from cache`);
      return cached;
    }
  } catch {
    // IndexedDB unavailable, continue
  }

  // 2. Try remote download
  try {
    const response = await fetch(remoteUrl);
    if (response.ok) {
      const total = Number(response.headers.get('content-length') || 0);
      const reader = response.body?.getReader();

      if (reader) {
        const chunks: Uint8Array[] = [];
        let loaded = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          onProgress?.(loaded, total);
        }

        const firmware = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          firmware.set(chunk, offset);
          offset += chunk.length;
        }

        // Cache for next time
        try {
          await idbSet(cacheKey, firmware);
        } catch {
          // Cache write failure is non-fatal
        }

        console.log(`[MicroPython] Firmware (${variant}) downloaded (${firmware.length} bytes)`);
        return firmware;
      }
    }
  } catch {
    console.warn('[MicroPython] Remote firmware download failed, trying bundled fallback');
  }

  // 3. Fallback to bundled firmware
  const response = await fetch(fallbackPath);
  if (!response.ok) {
    throw new Error(`MicroPython firmware (${variant}) not available (remote and bundled both failed)`);
  }
  const buffer = await response.arrayBuffer();
  const firmware = new Uint8Array(buffer);

  // Cache for next time
  try {
    await idbSet(cacheKey, firmware);
  } catch {
    // non-fatal
  }

  console.log(`[MicroPython] Firmware (${variant}) loaded from bundled fallback (${firmware.length} bytes)`);
  return firmware;
}
