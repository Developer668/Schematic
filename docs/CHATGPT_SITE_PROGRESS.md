# ChatGPT Site implementation progress

Last updated: 2026-08-28 (live placement regression reproduced; source fix and legacy-state repair verified locally; final ChatGPT Site publication pending)
Owner: Codex; Sol (gpt-5.6-sol, medium) is the architecture and release authority.

## Scope

This pass is limited to the ChatGPT Site/shared codebase. Cloudflare deployment is intentionally deferred.

## Sol architecture decision

Approved with constraints: keep one portable C/C++ firmware core and expose small HAL entry points (`gpio`, `adc`, `pwm`, `millis`, `delay`, and serial). Compile the browser target to WebAssembly with a deterministic virtual-I/O harness, use a native HAL for fast tests, and generate a board-specific export (ESP32 first) for real-device compilation. Do not claim unsupported device-specific simulation.

The first vertical slice is button -> firmware -> LED, with matching native/browser traces. Online libraries may be reused only with pinned versions, license metadata, target compatibility checks, and adapters for hardware calls.

Shopping must be agent-only: the UI must not generate, crawl, or fall back to retailer listings. Only a WebMCP agent mutation with a canonical catalog ID, `exactMatch: true`, part number, source URL, timestamp, currency, and provenance may populate offers.

## Workstreams

- [completed] Portable firmware/browser contract and reproducible device export (Luna: Plato; native C and ESP32 adapter use the shared core; browser contract was explicitly labeled as a TypeScript mirror).
- [completed] WebMCP-only parts sourcing and cart behavior (Luna: Gauss; tool boundary rejects fallback/provider paths, binds identity to the verified session, and validates offers).
- [completed] ChatGPT Site UI: visible project selector, safe rename, essential top-nav controls, responsive overflow menu, and no redundant right-panel copy actions (Luna: Dalton).
- [completed] Genuine C→WASM browser target (Luna: Maxwell; optimized C module, configurable pin ABI v2, hash metadata, loader, and production build prerequisites are wired and tested).
- [completed] Explicit device behavior coverage audit for common portable protocols: registry/adapters and deterministic display text capture added; unsupported boundaries remain explicit.
- [completed] ChatGPT Site/auth/WebMCP/performance verification (Luna: McClintock; read-only).
- [in_progress] Integration tests and Sol’s release-candidate validation are complete for the corrected source; final Site publication and authenticated browser acceptance remain pending.

## Acceptance gates

- [partial] Same firmware source passes the native and browser/WASM paths; the ESP32 export shares the core and is ready for PlatformIO, but a real ESP32 toolchain/device was not available in this pass.
- [completed] Button input produces LED output with deterministic native and C/WASM trace evidence.
- [completed] Unsupported firmware/library behavior fails explicitly.
- [completed] Shopping displays no listings before an agent publishes exact, provenance-backed results.
- [completed] Project selector/rename/nav/copy behavior passes interaction tests at desktop and narrow widths; the live canvas placement regression has a source fix and saved-state repair tracked separately below.
- [partial] ChatGPT Site auth redirect, API, production build, asset delivery, WASM HTTP execution, and browser WebMCP compatibility bridge pass in production. Native WebMCP discovery by an external connected ChatGPT agent was not available in the verification browser and is not claimed. The publication does not declare a native Site MCP server; that is distinct from the client-side WebMCP surface shipped in the app.

## Handoff notes

This file is the continuation record. Update it after each meaningful implementation or test result. If the remaining context budget becomes low, add the exact failing command, changed files, open risks, and next commands under this section before handing off.

### Current blockers and boundaries

Homebrew LLVM 23.1.0 and LLD 23.1.0 are installed at `/opt/homebrew/opt/llvm` and `/opt/homebrew/opt/lld`; the initial Apple Clang target/linker limitation is bypassed with explicit tool paths. The required package build produces a 400-byte optimized C→WASM module with ABI v2 and SHA-256 metadata. The browser artifact and metadata are release inputs now, and site builds verify them without requiring a compiler; rebuilding after C-source changes remains a deliberate developer/toolchain step.

The compiled browser path is intentionally limited to the exact button-led contract. Arbitrary C/C++, MCU-specific libraries, analog/RF/power behavior, and unsupported device models still use the interpreter/transport path or return an explicit unsupported result. A physical ESP32 toolchain/device was not available in this pass. The same-origin ChatGPT Site API is deployed and validated over HTTPS. The remaining verification boundary is native external-agent WebMCP discovery/invocation, which requires a browser/ChatGPT environment that exposes the native producer API.

### Simulation coverage audit (2026-08-28)

Catalog contains 504 models. Before this pass, 33 had executable behavioral contracts (MCU GPIO, digital I/O, PWM, ADC, and DS3231); display contracts were validation-only. After this pass, 37 have executable behavioral adapters, including four SSD1306 I²C text adapters. A further 181 models have explicit transport-only adapters (89 I²C register transport, 25 I²C display transport, 44 SPI transport, 23 UART transport); these trace wiring/transactions but do not claim device behavior. The remaining 286 are explicitly unsupported for deterministic execution.

Focused checks: capability registry, runtime, and hardware tests pass (26/26 in the coverage worker); frontend full suite passes (11 files, 61 tests), frontend TypeScript checking and lint pass, and the compiled harness suite passes (3 files, 11 tests plus native and WASM execution checks). The browser WebMCP button→LED path now executes the actual C/WASM module with resolved project pins, ABI, and artifact hash in its result. The remaining browser limitation is intentional: only the bounded button-led contract uses compiled C/WASM; other common APIs use the explicit interpreter/transport adapters or fail honestly when device behavior is not modeled.

### Live placement regression and fix (2026-08-28)

The deployed ChatGPT Site was tested through its real browser UI, not only through API smoke tests. Searching for a board, pushbutton, and LED and clicking each result reproduced a blocking issue: the three nodes were added at overlapping canvas coordinates, making selection and wiring unreliable. The root cause was random default placement in the store combined with a fixed `{x: 100, y: 100}` fallback in `component.add`; the existing WebMCP auto-layout also used 220×180 spacing for nodes rendered about 270px wide and up to 350px tall.

The fix uses one deterministic collision-aware placement grid for click-to-add and coordinate-less WebMCP adds, and uses conservative 360×460 spacing for auto-layout. Explicit agent coordinates remain respected, while malformed or partial WebMCP coordinates are rejected instead of being coerced. Loading an older saved graph now repairs only later rectangles that actually collide, preserving component identity, properties, rotations, and wiring. Regression tests cover five default additions, twenty additions, blocked manual cells, delete/reuse, saved overlap repair, and malformed WebMCP coordinates. The meta-glasses blueprint also uses catalog-typed sensor, button, battery, and SPI ports, one ESP32-S3 ADC endpoint (`GPIO1`, documented as ADC1 channel 0) that resolves consistently with firmware pin `1`, and separate button/LED GPIOs. The landing footer is platform-neutral and no longer names a hosting provider.

### Asset and release verification notes

- Both `frontend` and `chatgpt-site` run `@schematic/firmware-harness verify:wasm` before their production build; `build:wasm:required` remains an explicit developer/toolchain rebuild command. ChatGPT Site also declares `**/*.wasm` as an asset type.
- WASM and metadata are independent bundler URLs, so fingerprinting does not turn the metadata request into `button-led-<hash>.wasm.json`.
- Vite and Vinext production outputs emit explicit hashed WASM and metadata files (400-byte WASM plus 687-byte metadata); the runtime uses streaming-first for unverified generic loads and a hash-before-instantiation buffered path for the verified bundled artifact.
- The local Vinext Node server serves the WASM with `application/octet-stream`; the loader’s buffered fallback was exercised successfully, and Pages `_headers` now declares `application/wasm` for the deployed asset path.
- The published ChatGPT Site serves the latest pushed release containing this record. Its studio route redirects unauthenticated users to ChatGPT sign-in, its session endpoint issues the ChatGPT Site session under platform identity, and its hashed WASM/metadata assets are delivered over HTTPS.

### Adversarial review handoff

- OpenCode Muse (`opencode/muse-spark-1.2-contributor-free`) was run read-only as an adversarial reviewer; it was not permitted to edit or approve the release.
- Muse initially flagged missing generated files and ambiguous Vite asset delivery because the package test cleanup had removed generated artifacts and the frontend build was still using the default inline threshold. Those findings led to required build prerequisites, explicit hashed asset emission, independent metadata URLs, runtime byte-length/hash checks, and missing-asset/hash-negative tests.
- A final Muse invocation exited successfully after inspecting the corrected source and output. Its compact JSON filter did not expose the final text, so it is not counted as a release approval. Sol remains the release authority and is re-reviewing after the latest blocker fixes.

### Latest verification (2026-08-28)

- `pnpm --filter @schematic/firmware-harness test`: PASS — 3 files, 11 tests; native contract and required 400-byte optimized WASM artifact both execute.
- `pnpm --filter @schematic/firmware-harness build:wasm:required` followed by `verify:wasm`: PASS — the source build records `Homebrew clang version 23.1.0` and `Homebrew LLD 23.1.0`; verification itself only reads the release artifact and does not invoke a compiler.
- `pnpm --filter frontend test -- --run`: PASS — 11 files, 58 tests.
- Frontend TypeScript (`tsc --noEmit`), frontend ESLint, ChatGPT Site ESLint, and `git diff --check`: PASS.
- `npm run build` in `chatgpt-site`: PASS — Vinext production build completed with the WASM and metadata assets emitted separately and no missing hashed server imports.
- Fresh local Vinext server smoke: PASS — `/api/auth/session` issues a signed ChatGPT Sites session under platform identity headers; same-origin health/docs/search/details/ports/import/compile/simulation/state/stop routes return their JSON contracts; unauthenticated protected API calls return 401; the parts endpoint returns explicit agent-only 503; WebSocket routes return explicit 501; unknown API routes return JSON 404. A real button→LED graph returned completed/LED-on when pressed and LED-off when released.
- The `agent-browser` CLI required by the browser-verification skill is not installed in this environment, so the final browser evidence uses the real built server, HTTP checks, and the hash-verified WASM loader rather than a simulated browser click.
- Sol’s first retry returned an account usage-limit error; after explicitly resuming the completed session, the final re-review completed successfully.
- The latest strict-recognition test proves that a hard-coded `digitalWrite(LED_PIN, LOW)` source is not routed through the fixed C/WASM contract; it remains on the browser interpreter path.
- The release manifest now hashes all three browser compilation inputs (`button_led.c`, `wasm_button_led.c`, and `firmware_harness.h`) and the standalone verification scripts work from either the package directory or repository root.
- Sol’s first review blocked release on unchecked placement fallback and permissive WebMCP coordinate coercion. Both blockers are addressed in the current source candidate; a final read-only Sol review is pending before publication. Remaining known risks are the intentionally bounded C/WASM contract, the lack of a physical ESP32 check, and the fact that the current ChatGPT Site publication does not declare a native Site MCP server.

### Final agent review notes

- Sol (gpt-5.6-sol, medium) independently verified the header provenance, preprocessor/dead-code/macro guards, package/frontend/backend tests, typecheck/lint, production builds, and local HTTP/WASM trace. It returned no scoped blockers and a conditional GO.
- Muse’s read-only adversarial review found the same release-input staging risk. Its earlier stale-cache observations were resolved by rebuilding both site outputs; current frontend and ChatGPT Site metadata contain the three-input source manifest and the same artifact SHA-256.

### Production release evidence

- GitHub `main` and the ChatGPT Site are kept on the same pushed release source; production is still on the prior published release while the corrected placement candidate is being finalized.
- Production URL: `https://schematic-hardware-workspace.decipherer71.chatgpt.site`.
- HTTPS `/api/health` returned 200 JSON with `api_boundary: same-origin`; `/api/docs` returned 200 JSON; the live Settings page showed `API connected`, `/api · same-origin API`, and 5 engines reported.
- Live browser verification found the project selector/menu, component search (ESP32 results), Parts navigation/agent-only gate, workspace menu, and both resize separators. The browser rendered the WebMCP compatibility bridge; native WebMCP was not available in that session and is not represented as proven.
- Live browser reproduction also confirmed the prior release’s component-overlap bug; the current release candidate contains collision-aware placement, saved-state repair, strict WebMCP coordinate validation, and the wider auto-layout grid described above. Authenticated post-publication browser acceptance is still required.
