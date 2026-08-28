"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ProjectRepository,
  type StorageError,
  type WorkspaceSnapshot,
} from "@schematic/project-storage";

type ProbeStatus = "pass" | "fail" | "blocked" | "pending" | "running";

type ProbeId = "worker" | "wasm" | "static-asset" | "indexeddb" | "cache" | "blob";

interface ProbeResult {
  id: ProbeId;
  label: string;
  status: ProbeStatus;
  detail: string;
  bytes?: number;
}

interface CapabilityProbeProject {
  id: string;
  marker: string;
  createdAt: string;
}

const CAPABILITY_DB = "schematic-sites-capability-spike-v1";
const CAPABILITY_ROOM = "capability-spike";
const CAPABILITY_USER = "local-browser";
const CAPABILITY_PROJECT_ID = "capability-persistence-marker";
const CAPABILITY_MARKER = "browser-runtime-v1";
const LARGE_ASSET_MIN_BYTES = 64 * 1024;

const initialResults: ProbeResult[] = [
  { id: "worker", label: "Web Worker", status: "pending", detail: "Not run" },
  { id: "wasm", label: "Small WebAssembly module", status: "pending", detail: "Not run" },
  { id: "static-asset", label: "Larger static asset", status: "pending", detail: "Not run" },
  { id: "indexeddb", label: "IndexedDB persistence", status: "pending", detail: "Run probes, then reload this page" },
  { id: "cache", label: "Cache Storage", status: "pending", detail: "Not run" },
  { id: "blob", label: "Blob download boundary", status: "pending", detail: "Not run" },
];

function result(
  id: ProbeId,
  label: string,
  status: ProbeStatus,
  detail: string,
  bytes?: number,
): ProbeResult {
  return { id, label, status, detail, ...(bytes == null ? {} : { bytes }) };
}

function errorDetail(error: StorageError): ProbeResult["detail"] {
  return `${error.code}: ${error.message}`;
}

function blockedOrFailed(id: ProbeId, label: string, error: unknown): ProbeResult {
  const message = error instanceof Error ? error.message : "The browser API returned an unknown error.";
  const unavailable = /unavailable|not supported|undefined|secure context/i.test(message);
  return result(id, label, unavailable ? "blocked" : "fail", message);
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function persistenceWorkspace(): WorkspaceSnapshot<CapabilityProbeProject> {
  return {
    version: 1,
    activeProjectId: CAPABILITY_PROJECT_ID,
    projects: [{
      id: CAPABILITY_PROJECT_ID,
      marker: CAPABILITY_MARKER,
      createdAt: new Date().toISOString(),
    }],
  };
}

async function runWorkerProbe(): Promise<ProbeResult> {
  const label = "Web Worker";
  if (typeof Worker === "undefined") return result("worker", label, "blocked", "Worker is unavailable in this browser context.");

  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker("/capability-fixtures/echo-worker.js");
    } catch (error) {
      resolve(blockedOrFailed("worker", label, error));
      return;
    }
    const timeout = window.setTimeout(() => {
      worker.terminate();
      resolve(result("worker", label, "fail", "The worker did not respond within 3 seconds."));
    }, 3000);
    worker.onmessage = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data?.ok === true && event.data.value === 42) {
        resolve(result("worker", label, "pass", "Static worker loaded and returned 41 + 1 = 42."));
      } else {
        resolve(result("worker", label, "fail", "The worker responded with an unexpected payload."));
      }
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(result("worker", label, "fail", event.message || "The static worker failed to load."));
    };
    worker.postMessage({ type: "increment", value: 41 });
  });
}

async function runWasmProbe(): Promise<ProbeResult> {
  const label = "Small WebAssembly module";
  if (typeof WebAssembly === "undefined") return result("wasm", label, "blocked", "WebAssembly is unavailable in this browser context.");
  try {
    const response = await fetch("/capability-fixtures/answer.wasm.base64", { cache: "no-store" });
    if (!response.ok) return result("wasm", label, "fail", `Static fixture returned HTTP ${response.status}.`);
    const bytes = decodeBase64(await response.text());
    const wasmModule = await WebAssembly.compile(bytes as unknown as BufferSource);
    const instance = await WebAssembly.instantiate(wasmModule);
    const main = instance.exports.main;
    if (typeof main !== "function") return result("wasm", label, "fail", "The WASM fixture has no exported main function.", bytes.byteLength);
    const value = (main as () => number)();
    return value === 42
      ? result("wasm", label, "pass", "Static WASM fixture instantiated and returned 42.", bytes.byteLength)
      : result("wasm", label, "fail", `WASM returned ${String(value)} instead of 42.`, bytes.byteLength);
  } catch (error) {
    return blockedOrFailed("wasm", label, error);
  }
}

async function runStaticAssetProbe(): Promise<ProbeResult> {
  const label = "Larger static asset";
  try {
    const response = await fetch("/components-metadata.json", { cache: "no-store" });
    if (!response.ok) return result("static-asset", label, "fail", `Catalog fixture returned HTTP ${response.status}.`);
    const bytes = (await response.arrayBuffer()).byteLength;
    return bytes >= LARGE_ASSET_MIN_BYTES
      ? result("static-asset", label, "pass", `Catalog JSON loaded as a ${bytes.toLocaleString()}-byte static asset.`, bytes)
      : result("static-asset", label, "fail", `Catalog fixture was only ${bytes.toLocaleString()} bytes; expected at least ${LARGE_ASSET_MIN_BYTES.toLocaleString()}.`, bytes);
  } catch (error) {
    return blockedOrFailed("static-asset", label, error);
  }
}

async function runCacheProbe(): Promise<ProbeResult> {
  const label = "Cache Storage";
  if (typeof caches === "undefined") return result("cache", label, "blocked", "Cache Storage is unavailable; a secure context may be required.");
  try {
    const url = new URL("/capability-fixtures/echo-worker.js", window.location.origin).toString();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return result("cache", label, "fail", `Cache fixture returned HTTP ${response.status}.`);
    const cache = await caches.open("schematic-sites-capability-spike-v1");
    await cache.put(url, response.clone());
    const cached = await cache.match(url);
    if (!cached) return result("cache", label, "fail", "Cache Storage accepted the write but returned no matching entry.");
    const text = await cached.text();
    return text.includes("postMessage")
      ? result("cache", label, "pass", "A same-origin static fixture was written and read from Cache Storage.", text.length)
      : result("cache", label, "fail", "The cached fixture contents were unexpected.", text.length);
  } catch (error) {
    return blockedOrFailed("cache", label, error);
  }
}

async function runBlobProbe(): Promise<ProbeResult> {
  const label = "Blob download boundary";
  if (typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") {
    return result("blob", label, "blocked", "Blob URLs are unavailable in this browser context.");
  }
  const expected = "Schematic browser capability fixture\n";
  const blob = new Blob([expected], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "schematic-capability-fixture.txt";
    const roundTrip = await (await fetch(url)).text();
    return anchor.download && roundTrip === expected
      ? result("blob", label, "pass", "A Blob URL round-tripped and exposed a browser download filename.", blob.size)
      : result("blob", label, "fail", "The Blob URL or download filename did not round-trip.", blob.size);
  } catch (error) {
    return blockedOrFailed("blob", label, error);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function updateResults(current: ProbeResult[], next: ProbeResult[]): ProbeResult[] {
  const byId = new Map(next.map((item) => [item.id, item]));
  return current.map((item) => byId.get(item.id) ?? item);
}

export default function CapabilityHarness() {
  const repository = useMemo(() => new ProjectRepository<CapabilityProbeProject>({
    namespace: { roomId: CAPABILITY_ROOM, userId: CAPABILITY_USER },
    dbName: CAPABILITY_DB,
  }), []);
  const [results, setResults] = useState<ProbeResult[]>(initialResults);
  const [running, setRunning] = useState(false);

  const checkPersistence = useCallback(async () => {
    const loaded = await repository.loadWorkspace();
    if (!loaded.ok) {
      setResults((current) => updateResults(current, [
        result("indexeddb", "IndexedDB persistence", loaded.error.code === "unavailable" ? "blocked" : "fail", errorDetail(loaded.error)),
      ]));
      return;
    }
    const project = loaded.value?.projects.find((candidate) => candidate.id === CAPABILITY_PROJECT_ID);
    if (project?.marker === CAPABILITY_MARKER) {
      setResults((current) => updateResults(current, [
        result("indexeddb", "IndexedDB persistence", "pass", `Marker survived a new page load at revision ${loaded.value?.metadata.revision ?? "?"}.`),
      ]));
      return;
    }
    setResults((current) => updateResults(current, [
      result("indexeddb", "IndexedDB persistence", "pending", "No marker yet. Run probes, then reload this page to verify persistence."),
    ]));
  }, [repository]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkPersistence();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkPersistence]);

  const runPersistenceProbe = useCallback(async (): Promise<ProbeResult> => {
    const loaded = await repository.loadWorkspace();
    if (!loaded.ok) return result("indexeddb", "IndexedDB persistence", loaded.error.code === "unavailable" ? "blocked" : "fail", errorDetail(loaded.error));
    const saved = await repository.saveWorkspace(persistenceWorkspace(), {
      expectedRevision: loaded.value?.metadata.revision ?? null,
      updatedBy: "capability-spike",
    });
    if (!saved.ok) return result("indexeddb", "IndexedDB persistence", saved.error.code === "unavailable" ? "blocked" : "fail", errorDetail(saved.error));
    return result("indexeddb", "IndexedDB persistence", "pending", `Saved revision ${saved.value.metadata.revision}. Reload this page to verify the record survived.`);
  }, [repository]);

  const runProbes = async () => {
    setRunning(true);
    setResults((current) => current.map((item) => ({ ...item, status: "running", detail: "Running…" })));
    const [worker, wasm, staticAsset, indexeddb, cache, blob] = await Promise.all([
      runWorkerProbe(),
      runWasmProbe(),
      runStaticAssetProbe(),
      runPersistenceProbe(),
      runCacheProbe(),
      runBlobProbe(),
    ]);
    setResults([worker, wasm, staticAsset, indexeddb, cache, blob]);
    setRunning(false);
  };

  const resetProbe = async () => {
    await repository.clearWorkspace();
    if (typeof caches !== "undefined") await caches.delete("schematic-sites-capability-spike-v1");
    setResults(initialResults);
  };

  const passed = results.filter((item) => item.status === "pass").length;
  const blocked = results.filter((item) => item.status === "blocked").length;
  const failed = results.filter((item) => item.status === "fail").length;

  return (
    <main style={{ minHeight: "100vh", padding: "48px 24px", background: "#0e1117", color: "#e7edf5", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <p style={{ color: "#78a9ff", letterSpacing: "0.08em", fontSize: 12, marginBottom: 12 }}>SCHEMATIC / SITE CAPABILITY SPIKE</p>
        <h1 style={{ fontSize: "clamp(28px, 5vw, 52px)", lineHeight: 1.05, margin: 0, maxWidth: 700 }}>Browser runtime acceptance harness</h1>
        <p style={{ color: "#a7b3c5", maxWidth: 720, lineHeight: 1.6, margin: "20px 0 28px" }}>
          These probes use only browser APIs and small same-origin fixtures. They do not call <code>/api/compile</code> or <code>/api/simulation</code>; those routes remain optional compatibility paths.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
          <button type="button" onClick={() => void runProbes()} disabled={running} style={{ background: "#78a9ff", color: "#07101e", border: 0, borderRadius: 8, padding: "12px 16px", fontWeight: 700, cursor: running ? "wait" : "pointer" }}>
            {running ? "Running probes…" : "Run browser probes"}
          </button>
          <button type="button" onClick={() => window.location.reload()} style={{ background: "transparent", color: "#e7edf5", border: "1px solid #344158", borderRadius: 8, padding: "12px 16px", cursor: "pointer" }}>
            Reload to verify IndexedDB
          </button>
          <button type="button" onClick={() => void resetProbe()} style={{ background: "transparent", color: "#a7b3c5", border: "1px solid #283347", borderRadius: 8, padding: "12px 16px", cursor: "pointer" }}>
            Reset spike data
          </button>
        </div>

        <section aria-label="Probe summary" style={{ display: "flex", gap: 24, flexWrap: "wrap", border: "1px solid #283347", borderRadius: 10, padding: 16, marginBottom: 20, color: "#a7b3c5" }}>
          <span><strong style={{ color: "#75e0a0" }}>{passed}</strong> passed</span>
          <span><strong style={{ color: "#f4c66d" }}>{blocked}</strong> blocked/unavailable</span>
          <span><strong style={{ color: "#ff8b8b" }}>{failed}</strong> failed</span>
          <span>{results.length} total</span>
        </section>

        <section aria-label="Capability probes" style={{ display: "grid", gap: 10 }}>
          {results.map((item) => {
            const color = item.status === "pass" ? "#75e0a0" : item.status === "fail" ? "#ff8b8b" : item.status === "blocked" ? "#f4c66d" : "#9fb4d9";
            return (
              <article key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 0.4fr) minmax(0, 1fr)", gap: 18, border: "1px solid #283347", borderRadius: 10, padding: "16px 18px", background: "#151b26" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{item.label}</div>
                  <div style={{ color, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11, marginTop: 7 }}>{item.status}</div>
                </div>
                <div style={{ color: "#a7b3c5", lineHeight: 1.55 }}>{item.detail}{item.bytes == null ? "" : ` (${item.bytes.toLocaleString()} bytes)`}</div>
              </article>
            );
          })}
        </section>

        <p style={{ color: "#77869d", lineHeight: 1.6, fontSize: 13, marginTop: 28 }}>
          A persistence probe is <strong>pending</strong> until the marker written by “Run browser probes” is found after a real page reload. Browser download permission, cross-device sync, compiler assets, Web Serial, and WebUSB are intentionally outside this safe fixture spike.
        </p>
      </div>
    </main>
  );
}
