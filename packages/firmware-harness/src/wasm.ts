export interface ButtonLedWasm {
  readonly abiVersion: 2;
  readonly artifactSha256?: string;
  configure(buttonPin: number, ledPin: number, activeLow: boolean): void;
  init(): void;
  setButton(level: 0 | 1): void;
  step(): void;
  readLed(): 0 | 1;
}

type ButtonLedExports = {
  wasm_button_led_abi_version: () => number;
  wasm_button_led_configure: (buttonPin: number, ledPin: number, activeLow: number) => number;
  wasm_button_led_init: () => void;
  wasm_button_led_set_button: (level: number) => void;
  wasm_button_led_step: () => void;
  wasm_button_led_read_led: () => number;
};

type LoadOptions = { expectedSha256?: string };

async function sha256Hex(bytes: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) throw new Error("This runtime cannot verify the WASM artifact hash.");
  // Normalize cross-realm Response buffers (notably in jsdom and embedded
  // WebViews) before passing them to SubtleCrypto.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function exportsOf(instance: WebAssembly.Instance): ButtonLedExports {
  const exports = instance.exports as unknown as Partial<ButtonLedExports>;
  for (const name of ["wasm_button_led_abi_version", "wasm_button_led_configure", "wasm_button_led_init", "wasm_button_led_set_button", "wasm_button_led_step", "wasm_button_led_read_led"] as const) {
    if (typeof exports[name] !== "function") throw new Error(`WASM module is missing export ${name}.`);
  }
  const typed = exports as ButtonLedExports;
  if (typed.wasm_button_led_abi_version() !== 2) throw new Error("Unsupported button-led WASM ABI version.");
  return typed;
}

function instanceOf(result: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource): WebAssembly.Instance {
  return "instance" in result ? result.instance : result;
}

export async function loadButtonLedWasm(source: ArrayBuffer | ArrayBufferView | WebAssembly.Module | Response, options: LoadOptions = {}): Promise<ButtonLedWasm> {
  let instance: WebAssembly.Instance;
  let sourceBytes: ArrayBuffer | undefined;
  if (source instanceof Response) {
    if (!source.ok) throw new Error(`WASM artifact request failed with HTTP ${source.status}.`);
    if (options.expectedSha256) {
      // A verified artifact must be hashed before it is instantiated. This is
      // slightly less eager than streaming, but prevents executing bytes that
      // fail the release manifest check.
      sourceBytes = await source.arrayBuffer();
      const artifactSha256 = await sha256Hex(sourceBytes);
      if (artifactSha256 !== options.expectedSha256) throw new Error("WASM artifact hash mismatch.");
      instance = instanceOf(await WebAssembly.instantiate(sourceBytes));
    } else {
      // Some static hosts serve .wasm with a generic MIME type. Prefer the
      // streaming path, but retain a buffered fallback without re-fetching.
      const buffered = source.clone();
      const hashBytes = source.clone().arrayBuffer();
      try {
        instance = instanceOf(await WebAssembly.instantiateStreaming(source));
      } catch {
        instance = instanceOf(await WebAssembly.instantiate(await buffered.arrayBuffer()));
      }
      sourceBytes = await hashBytes;
    }
  } else {
    if (source instanceof ArrayBuffer) sourceBytes = source;
    else if (ArrayBuffer.isView(source)) sourceBytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
    if (sourceBytes && options.expectedSha256) {
      const artifactSha256 = await sha256Hex(sourceBytes);
      if (artifactSha256 !== options.expectedSha256) throw new Error("WASM artifact hash mismatch.");
      instance = instanceOf(await WebAssembly.instantiate(sourceBytes));
    } else if (source instanceof WebAssembly.Module) {
      instance = instanceOf(await WebAssembly.instantiate(source));
    } else {
      instance = instanceOf(await WebAssembly.instantiate(sourceBytes ?? source));
    }
  }
  const wasm = exportsOf(instance);
  const artifactSha256 = sourceBytes ? await sha256Hex(sourceBytes) : undefined;
  if (options.expectedSha256 && artifactSha256 !== options.expectedSha256) throw new Error("WASM artifact hash mismatch.");
  return {
    abiVersion: 2,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    configure: (buttonPin, ledPin, activeLow) => {
      if (wasm.wasm_button_led_configure(buttonPin, ledPin, activeLow ? 1 : 0) !== 1) throw new Error("WASM button-led configuration was rejected.");
    },
    init: () => wasm.wasm_button_led_init(),
    setButton: (level) => wasm.wasm_button_led_set_button(level),
    step: () => wasm.wasm_button_led_step(),
    readLed: () => (wasm.wasm_button_led_read_led() ? 1 : 0),
  };
}

export function bundledButtonLedWasmUrl() {
  return new URL("../generated/button-led.wasm", import.meta.url);
}

export function bundledButtonLedWasmMetadataUrl() {
  // Keep metadata as an independent bundler asset. Deriving it from the
  // fingerprinted WASM URL would request `button-led-<hash>.wasm.json`, which
  // is not the name Vite/Vinext emits for the JSON asset.
  return new URL("../generated/button-led.wasm.json", import.meta.url);
}

async function loadBundledButtonLedWasmUncached(): Promise<ButtonLedWasm> {
  const wasmUrl = bundledButtonLedWasmUrl();
  const metadataUrl = bundledButtonLedWasmMetadataUrl();
  const [wasmResponse, metadataResponse] = await Promise.all([fetch(wasmUrl), fetch(metadataUrl)]);
  if (!metadataResponse.ok) throw new Error(`WASM metadata request failed with HTTP ${metadataResponse.status}.`);
  const metadata = await metadataResponse.json() as { schemaVersion?: unknown; abiVersion?: unknown; artifact?: unknown; byteLength?: unknown; sha256?: unknown };
  const byteLength = metadata.byteLength;
  if (metadata.schemaVersion !== 1 || metadata.abiVersion !== 2 || metadata.artifact !== "button-led.wasm" || typeof byteLength !== "number" || !Number.isInteger(byteLength) || byteLength <= 0 || typeof metadata.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(metadata.sha256)) throw new Error("WASM artifact metadata is invalid.");
  const artifactBytes = await wasmResponse.clone().arrayBuffer();
  if (artifactBytes.byteLength !== byteLength) throw new Error("WASM artifact byte length does not match its metadata.");
  return loadButtonLedWasm(wasmResponse, { expectedSha256: metadata.sha256 });
}

let bundledButtonLedWasmPromise: Promise<ButtonLedWasm> | undefined;

export function loadBundledButtonLedWasm(): Promise<ButtonLedWasm> {
  bundledButtonLedWasmPromise ??= loadBundledButtonLedWasmUncached().catch((error) => {
    bundledButtonLedWasmPromise = undefined;
    throw error;
  });
  return bundledButtonLedWasmPromise;
}
