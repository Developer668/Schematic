import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadButtonLedWasm, loadBundledButtonLedWasm } from "./wasm";

const artifact = resolve(process.cwd(), "generated/button-led.wasm");

describe("compiled button-to-LED WASM", () => {
  it.skipIf(!existsSync(artifact))("executes the C core and matches the native contract", async () => {
    const wasm = await loadButtonLedWasm(readFileSync(artifact));
    wasm.configure(18, 19, true);
    wasm.init();
    expect(wasm.readLed()).toBe(0);

    wasm.setButton(0);
    wasm.step();
    expect(wasm.readLed()).toBe(1);

    wasm.setButton(1);
    wasm.step();
    expect(wasm.readLed()).toBe(0);
  });

  it.skipIf(!existsSync(artifact))("rejects a mismatched artifact hash", async () => {
    await expect(loadButtonLedWasm(readFileSync(artifact), { expectedSha256: "0".repeat(64) })).rejects.toThrow("hash mismatch");
  });
});

describe("bundled artifact loading", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails closed when the deployed metadata asset is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(loadBundledButtonLedWasm()).rejects.toThrow("metadata request failed");
  });
});
