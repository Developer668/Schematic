import { describe, expect, it } from "vitest";
import {
  AVR_UNO_FQBN,
  CompilerManager,
  MemoryAssetCache,
  createAvrGccWasmCompiler,
  createBlockedCompiler,
  createIntelHexArtifact,
  sha256Hex,
  loadVerifiedAsset,
  parseIntelHex,
  validateToolchainManifest,
  type BrowserCompilerTarget,
} from "./index";

const target: BrowserCompilerTarget = { fqbn: AVR_UNO_FQBN, language: "arduino", boardId: "arduino-uno" };
const validHex = ":0400000001020304F2\n:00000001FF\n";

describe("browser toolchain boundaries", () => {
  it("parses and verifies a compiler-produced Intel HEX artifact", async () => {
    const image = parseIntelHex(validHex, { maxAddressExclusive: 32 * 1024 });
    expect(image.dataBytes).toBe(4);

    const compiler = createAvrGccWasmCompiler({
      bridge: {
        name: "test-bridge",
        version: "test",
        compile: async () => ({ hex: validHex, flashBytes: 4, fitsTarget: true }),
      },
    });
    const result = await compiler.compile({ target, files: [{ name: "sketch.ino", content: "void setup(){} void loop(){}" }] });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.artifact.flashBytes).toBe(4);
    expect(result.artifact.provenance.targetFqbn).toBe(AVR_UNO_FQBN);
    expect(result.artifact.provenance.compiler).toBe("test-bridge");
  });

  it("returns blocked instead of pretending an unprovisioned toolchain exists", async () => {
    const manager = new CompilerManager([createBlockedCompiler("avr-review-required")]);
    const result = await manager.compile({ target, files: [{ name: "sketch.ino", content: "" }] });
    expect(result.status).toBe("blocked");
    expect(result.error?.code).toBe("blocked-toolchain");
    expect(manager.supports(target).status).toBe("blocked");
  });

  it("rejects unsupported targets before invoking the bridge", async () => {
    let calls = 0;
    const compiler = createAvrGccWasmCompiler({
      bridge: { compile: async () => { calls += 1; return { hex: validHex }; } },
    });
    const result = await compiler.compile({
      target: { fqbn: "esp32:esp32:esp32", language: "arduino" },
      files: [{ name: "sketch.ino", content: "void setup(){} void loop(){}" }],
    });
    expect(result.status).toBe("unsupported");
    expect(calls).toBe(0);
  });

  it("validates manifests and caches only hash-matching assets", async () => {
    const bytes = new TextEncoder().encode("abc");
    const actualHash = await sha256Hex(bytes);
    const manifest = validateToolchainManifest({
      schemaVersion: 1,
      id: "avr-review",
      family: "avr",
      version: "1",
      source: { repository: "https://example.test/repo", revision: "abc", buildRecipe: "make" },
      legal: { licenseExpression: "GPL-3.0-or-later", noticeFiles: ["NOTICE"], sourceUrl: "https://example.test/src", redistribution: "review-required" },
      assets: [{ id: "tool", kind: "wasm", path: "tool.wasm", url: "/tool.wasm", sizeBytes: 3, sha256: actualHash }],
      targets: [{ id: "uno", fqbn: AVR_UNO_FQBN, mcu: "atmega328p", flashBytes: 32 * 1024, assetIds: ["tool"], sourceExtensions: [".ino"] }],
    });
    const cache = new MemoryAssetCache();
    const loaded = await loadVerifiedAsset(manifest.assets[0], cache, async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }));
    expect(new TextDecoder().decode(loaded)).toBe("abc");
    expect(() => validateToolchainManifest({ ...manifest, assets: [{ ...manifest.assets[0], path: "../escape.wasm" }] })).toThrow();
  });

  it("produces a stable artifact hash for exact text bytes", async () => {
    const artifact = await createIntelHexArtifact(validHex, {
      targetFqbn: AVR_UNO_FQBN,
      provenance: { compiler: "test", targetFqbn: AVR_UNO_FQBN, sourceSha256: "0".repeat(64) },
    });
    expect(artifact.bytes.byteLength).toBe(new TextEncoder().encode(validHex).byteLength);
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
