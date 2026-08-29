# ChatGPT Site browser capability spike

The Site now includes a non-product acceptance route at `/capabilities`. It exercises only browser-local primitives required by the browser-first release direction:

- a same-origin classic Web Worker;
- a 37-byte WebAssembly module that returns `42`;
- the existing `components-metadata.json` catalog as a larger static asset (currently over 64 KiB);
- IndexedDB write/read in the `capability-spike` room and `local-browser` user namespace;
- Cache Storage write/read for the worker fixture;
- a Blob URL round-trip with a download filename.

No compiler, simulator, backend, API credential, or large WASM toolchain asset is included in this spike. The existing same-origin API routes are unchanged and remain optional compatibility routes for the core browser path.

## Probe semantics

Each row reports one of these states:

- **pass** — the browser API ran and the expected invariant was observed;
- **fail** — the API was present but the invariant or fixture request failed;
- **blocked** — the API is unavailable in the current context, usually because the runtime lacks the API or requires a secure context;
- **pending** — the probe needs a second page load, as with IndexedDB persistence before and after reload.

IndexedDB is only a persistence pass after clicking “Run browser probes” and then reloading the page. The harness uses a separate database (`schematic-sites-capability-spike-v1`) so it cannot overwrite Schematic projects.

## Local verification

Verified locally without deployment:

- the static worker fixture is present and contains no network, WebSocket, or dynamic-code execution;
- the small WASM fixture validates in Node and is below 1 KiB;
- the capability page contains all six browser probes and no compile/simulation API call;
- `npm run build` runs `scripts/verify-build-assets.mjs`, which checks the built worker, WASM, metadata JSON, preview PNG, and explicit `/_headers` 404 route;
- the project-storage package has unit coverage for repository and migration behavior;
- the Site TypeScript/build checks can compile the new route and package alias once the existing Site build prerequisites are available.

Known local-preview blocker: with Vinext `1.0.0-beta.3`, `vinext start` currently routes these public asset requests through the catch-all HTML page instead of serving `dist/client` files. Treat the deterministic build-artifact check as authoritative until the preview static-file routing is fixed; this does not affect the checked-in asset outputs.

Not verifiable in the current non-browser local process:

- actual `Worker` creation;
- IndexedDB persistence across a real page reload;
- Cache Storage availability and secure-context behavior;
- browser Blob download behavior;
- ChatGPT Sites’ published runtime policy for large static assets;
- Web Serial/WebUSB permissions;
- real browser memory limits for future compiler bundles.

The first five items must be run at `/capabilities` in the published Site before treating the Site capability track as accepted. Record the result with the deployed Site version; a local build alone is not production acceptance.

## Release assumptions

The core Site remains browser-first and does not require `/api/compile`, `/api/simulation`, Python, native subprocesses, a database, or a queue. IndexedDB is device-local storage; it is not cross-device synchronization or a cloud backup. Compiler and simulator workers must be added later behind the same browser capability gates and must remain lazy-loaded static assets.
