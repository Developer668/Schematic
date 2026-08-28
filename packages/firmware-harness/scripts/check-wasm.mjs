import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = join(root, "generated", "button-led.wasm");
const metadataOutput = join(root, "generated", "button-led.wasm.json");
const sourceFiles = ["firmware/src/button_led.c", "firmware/src/wasm_button_led.c", "firmware/include/firmware_harness.h"];

if (!existsSync(output)) throw new Error("Required checked-in WASM artifact is missing.");
if (!existsSync(metadataOutput)) throw new Error("Required checked-in WASM metadata is missing.");

function sourceSha256() {
  const hash = createHash("sha256");
  for (const source of sourceFiles) {
    hash.update(source);
    hash.update("\0");
    hash.update(readFileSync(join(root, source)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const metadata = JSON.parse(readFileSync(metadataOutput, "utf8"));
const bytes = readFileSync(output);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (metadata.schemaVersion !== 1 || metadata.abiVersion !== 2 || metadata.artifact !== "button-led.wasm") throw new Error("WASM artifact metadata schema or ABI mismatch.");
if (JSON.stringify(metadata.source) !== JSON.stringify(sourceFiles)) throw new Error("WASM artifact source manifest does not match the declared compilation inputs.");
if (!Number.isInteger(metadata.byteLength) || metadata.byteLength <= 0 || metadata.byteLength !== bytes.byteLength) throw new Error("WASM artifact byte length does not match metadata.");
if (metadata.sha256 !== sha256) throw new Error("WASM artifact SHA-256 does not match metadata.");
if (metadata.sourceSha256 !== sourceSha256()) throw new Error("WASM artifact was not built from the current portable C sources.");
if (!metadata.toolchain || typeof metadata.toolchain.compilerVersion !== "string" || typeof metadata.toolchain.linkerVersion !== "string") throw new Error("WASM metadata is missing compiler/linker versions.");

const result = await WebAssembly.instantiate(bytes);
const wasm = result.instance.exports;
const required = ["wasm_button_led_abi_version", "wasm_button_led_configure", "wasm_button_led_init", "wasm_button_led_set_button", "wasm_button_led_step", "wasm_button_led_read_led"];
for (const name of required) if (typeof wasm[name] !== "function") throw new Error(`missing export ${name}`);
if (wasm.wasm_button_led_abi_version() !== 2) throw new Error("ABI version mismatch");
if (wasm.wasm_button_led_configure(18, 19, 1) !== 1) throw new Error("configuration rejected");
wasm.wasm_button_led_init();
if (wasm.wasm_button_led_read_led() !== 0) throw new Error("initial state mismatch");
wasm.wasm_button_led_set_button(0);
wasm.wasm_button_led_step();
if (wasm.wasm_button_led_read_led() !== 1) throw new Error("pressed state mismatch");
wasm.wasm_button_led_set_button(1);
wasm.wasm_button_led_step();
if (wasm.wasm_button_led_read_led() !== 0) throw new Error("released state mismatch");
console.log(`WASM harness: verified and executed C module successfully (${bytes.byteLength} bytes; ${metadata.toolchain.compilerVersion}; ${metadata.toolchain.linkerVersion})`);
