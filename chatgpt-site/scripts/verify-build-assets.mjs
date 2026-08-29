import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = resolve(siteRoot, "dist", "client");

async function requiredFile(relativePath) {
  const path = resolve(clientRoot, relativePath);
  await access(path, constants.R_OK);
  return { path, bytes: await readFile(path) };
}

async function findHeadersFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findHeadersFiles(path));
    else if (entry.name === "_headers") matches.push(path);
  }
  return matches;
}

const worker = await requiredFile("capability-fixtures/echo-worker.js");
if (!worker.bytes.toString("utf8").includes("self.onmessage")) throw new Error("The built worker fixture is not the expected echo worker.");

const wasmFixture = await requiredFile("capability-fixtures/answer.wasm.base64");
const wasmBytes = Buffer.from(wasmFixture.bytes.toString("utf8").replace(/\s+/g, ""), "base64");
if (!WebAssembly.validate(wasmBytes)) throw new Error("The built WASM fixture is invalid.");
if (wasmBytes.byteLength >= 1024) throw new Error("The built WASM fixture is unexpectedly large.");

const metadata = await requiredFile("components-metadata.json");
if (metadata.bytes.byteLength < 64 * 1024) throw new Error("The built component metadata asset is unexpectedly small.");
const parsedMetadata = JSON.parse(metadata.bytes.toString("utf8"));
if (!parsedMetadata || typeof parsedMetadata !== "object" || !Array.isArray(parsedMetadata.components)) throw new Error("The built component metadata asset has no components array.");

const preview = await requiredFile("social-preview.png");
if (!preview.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("The built social preview is not a PNG.");

const headersFiles = await findHeadersFiles(clientRoot);
if (headersFiles.length > 1 || (headersFiles.length === 1 && !headersFiles[0].endsWith("/dist/client/_headers"))) {
  throw new Error(`Unexpected _headers artifact outside Vinext's generated client metadata: ${headersFiles.join(", ")}`);
}

console.log("Verified Site static assets: worker, WASM, metadata JSON, social preview PNG; /_headers is handled by the explicit 404 route.");
