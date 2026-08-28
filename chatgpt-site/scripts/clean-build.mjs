import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Vinext can retain a server manifest after an interrupted build. Remove only
// the generated site output so the next build cannot point at stale chunks.
await rm(resolve(siteRoot, "dist"), { recursive: true, force: true });
