import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("the worker fixture is a safe same-origin echo fixture", async () => {
  const worker = await readFile(new URL("../frontend/public/capability-fixtures/echo-worker.js", root), "utf8");
  assert.match(worker, /self\.onmessage/);
  assert.match(worker, /postMessage/);
  assert.doesNotMatch(worker, /fetch\(|WebSocket|eval\(/);
});

test("the capability page probes browser APIs without executing source or calling retired APIs", async () => {
  const source = await readFile(new URL("app/capabilities/CapabilityHarness.tsx", root), "utf8");
  for (const token of ["new Worker", "components-metadata.json", "repository.loadWorkspace", "caches.open", "URL.createObjectURL"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /WebAssembly\.(?:compile|instantiate)/);
  assert.doesNotMatch(source, /fetch\(["']\/api\/(compile|simulation)/);
});
