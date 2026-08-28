import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("the small WASM fixture is valid and remains small", async () => {
  const encoded = await readFile(new URL("../frontend/public/capability-fixtures/answer.wasm.base64", root), "utf8");
  const bytes = Buffer.from(encoded.replace(/\s+/g, ""), "base64");
  assert.ok(bytes.byteLength < 1024);
  assert.equal(WebAssembly.validate(bytes), true);
});

test("the worker fixture is a safe same-origin echo fixture", async () => {
  const worker = await readFile(new URL("../frontend/public/capability-fixtures/echo-worker.js", root), "utf8");
  assert.match(worker, /self\.onmessage/);
  assert.match(worker, /postMessage/);
  assert.doesNotMatch(worker, /fetch\(|WebSocket|eval\(/);
});

test("the capability page probes browser APIs without making compile or simulation API calls", async () => {
  const source = await readFile(new URL("app/capabilities/CapabilityHarness.tsx", root), "utf8");
  for (const token of ["new Worker", "WebAssembly.instantiate", "components-metadata.json", "repository.loadWorkspace", "caches.open", "URL.createObjectURL"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /fetch\(["']\/api\/(compile|simulation)/);
});
