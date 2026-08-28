#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = resolve(root, "generated/button-led.wasm");
const metadataOutput = resolve(root, "generated/button-led.wasm.json");
const temporaryOutput = `${output}.tmp-${process.pid}`;
const temporaryMetadataOutput = `${metadataOutput}.tmp-${process.pid}`;
const include = resolve(root, "firmware/include");
const sources = [resolve(root, "firmware/src/button_led.c"), resolve(root, "firmware/src/wasm_button_led.c")];
const inputs = [...sources, resolve(include, "firmware_harness.h")];
const args = process.argv.slice(2);
const required = args.includes("--required");
rmSync(temporaryOutput, { force: true });
rmSync(temporaryMetadataOutput, { force: true });

function available(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function firstAvailable(commands) {
  return commands.find(available) ?? null;
}

function versionOf(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim().split(/\r?\n/, 1)[0] || "unknown";
}

function sourceSha256() {
  const hash = createHash("sha256");
  for (const source of inputs) {
    hash.update(relative(root, source));
    hash.update("\0");
    hash.update(readFileSync(source));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function report(available, compiler, linker, reason) {
  const result = { available, compiler, linker, output: available ? output : null, reason };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const emcc = firstAvailable([process.env.EMCC, "emcc"].filter(Boolean));
const clang = firstAvailable([process.env.WASM_CC, "/opt/homebrew/opt/llvm/bin/clang", "/usr/local/opt/llvm/bin/clang", "clang"].filter(Boolean));
const wasmLd = firstAvailable([process.env.WASM_LD, "/opt/homebrew/opt/lld/bin/wasm-ld", "/usr/local/opt/lld/bin/wasm-ld", "wasm-ld"].filter(Boolean));
let compiler = null;
let linker = null;

if (emcc) {
  compiler = emcc;
  linker = "emscripten";
} else if (clang && wasmLd) {
  compiler = clang;
  linker = wasmLd;
} else {
  const missing = [!clang && "clang", !wasmLd && "wasm-ld", !emcc && "emcc"].filter(Boolean).join(", ");
  const result = report(false, clang, wasmLd, `No supported WASM toolchain found (missing: ${missing}). No artifact was written.`);
  process.exitCode = required ? 1 : 0;
  if (required) process.exit(1);
  process.exit(0);
}

mkdirSync(dirname(output), { recursive: true });
const common = ["-Oz", "-ffreestanding", "-fno-builtin", "-fvisibility=hidden", "-I", include, ...sources];
const command = emcc
  ? ["-Oz", "-flto", "-ffreestanding", "-fno-builtin", "-fvisibility=hidden", "-I", include, ...sources,
      "-s", "STANDALONE_WASM=1", "-s", "ERROR_ON_UNDEFINED_SYMBOLS=1", "-Wl,--no-entry", "-Wl,--export=wasm_button_led_abi_version", "-Wl,--export=wasm_button_led_configure", "-Wl,--export=wasm_button_led_init", "-Wl,--export=wasm_button_led_set_button", "-Wl,--export=wasm_button_led_step", "-Wl,--export=wasm_button_led_read_led", "-Wl,--strip-all", "-o", temporaryOutput]
  : [...common, "--target=wasm32", "-flto", "-nostdlib", `-fuse-ld=${wasmLd}`, "-Wl,--no-entry", "-Wl,--export=wasm_button_led_abi_version", "-Wl,--export=wasm_button_led_configure", "-Wl,--export=wasm_button_led_init", "-Wl,--export=wasm_button_led_set_button", "-Wl,--export=wasm_button_led_step", "-Wl,--export=wasm_button_led_read_led", "-Wl,--strip-all", "-o", temporaryOutput];

const result = spawnSync(compiler, command, { cwd: root, encoding: "utf8" });
if (result.status !== 0 || !existsSync(temporaryOutput)) {
  const reason = [result.stderr, result.stdout].filter(Boolean).join("\n").trim() || "Compiler did not produce a WASM module.";
  const reportResult = report(false, compiler, linker, `WASM build failed: ${reason}`);
  process.exitCode = 1;
  rmSync(temporaryOutput, { force: true });
  rmSync(temporaryMetadataOutput, { force: true });
  process.exit(1);
}

const artifactBytes = readFileSync(temporaryOutput);
const bytes = artifactBytes.byteLength;
const sha256 = createHash("sha256").update(artifactBytes).digest("hex");
const compilerVersion = versionOf(compiler);
const linkerVersion = linker === "emscripten" ? compilerVersion : versionOf(linker);
writeFileSync(temporaryMetadataOutput, JSON.stringify({
  schemaVersion: 1,
  abiVersion: 2,
  artifact: "button-led.wasm",
  byteLength: bytes,
  sha256,
  sourceSha256: sourceSha256(),
  toolchain: {
    compiler,
    compilerVersion,
    linker,
    linkerVersion,
  },
  optimization: ["-Oz", "-flto", "--strip-all"],
  source: inputs.map((input) => relative(root, input)),
}, null, 2) + "\n");
renameSync(temporaryOutput, output);
renameSync(temporaryMetadataOutput, metadataOutput);
report(true, compiler, linker, `Optimized C module built and written (${bytes} bytes).`);
