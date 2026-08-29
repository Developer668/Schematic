<div align="center">
  <img src="frontend/public/schematic-logo.png" width="118" alt="Schematic logo" />

# Schematic

**An agent-native workspace for designing and programming connected hardware.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-f97316.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![WebMCP](https://img.shields.io/badge/WebMCP-42_tools-8b5cf6.svg)](frontend/src/webmcp/tools.ts)

</div>

---

## Primary release

The supported submission is the authenticated ChatGPT Site:

[Open Schematic in ChatGPT](https://schematic-hardware-workspace.decipherer71.chatgpt.site)

The Site wraps the shared React frontend and Zustand stores. Its 42 semantic
WebMCP tools operate on the same graph actions as the human UI. Project data is
saved in the browser-local project repository, scoped to the verified ChatGPT
identity and device; it is not a cloud backup or a cross-device sync service.

The current WebMCP draft used here is dated 26 August 2026. Chrome's testing
flag documentation targets v149+, but the judge target is the ChatGPT in-app
browser. Native tool discovery therefore must be checked in that in-app
browser. A local compatibility bridge is useful for tests and constrained
browsers, but it is not proof of native WebMCP discovery.

## What is live

- Visual hardware graph with catalog search, typed ports, wiring, validation,
  firmware files, project switching, and save/persistence.
- Exactly 42 WebMCP tool definitions in
  [`frontend/src/webmcp/tools.ts`](frontend/src/webmcp/tools.ts), registered on
  the native surface when the host exposes `modelContext`; they cover project,
  workspace, component, connection, firmware, simulation, validation,
  shopping, and layout operations.
- A verified, deterministic C/WASM path for one exact button→LED contract
  (portable C core, ABI v2, artifact SHA-256, virtual I/O). Pressed and
  released runs report the resolved board and component endpoints.
- A bounded TypeScript behavioral interpreter and explicit device/protocol
  adapters for supported browser behavior. Unsupported source or device
  behavior returns an explicit result.
- Same-origin Site API routes that reuse `functions/api/_runtime.ts` for
  catalog, validation, behavioral HTTP simulation, sessions, and compile
  preflight.
- Keyless parts discovery: `shopping.search` can query a bounded, cached
  JLCSearch/LCSC snapshot or an exact Adafruit public product endpoint without
  provider accounts or API keys. Candidates never become cart listings
  automatically; an authenticated WebMCP agent still verifies exact catalog
  identity, part number, URL, timestamp, currency, offer, and provenance before
  publication. If public sources are unavailable or rate-limited, the tool
  returns the stable `schematic.parts.lookup.v1` JSON handoff for another
  browsing agent. Paid provider adapters remain dormant for a later release.

The Site does not claim arbitrary C/C++ compilation, MCU-library execution,
full analog/RF simulation, or a native simulator. `firmware.compile` on the
Site performs target/source checks and returns a preflight/unavailable result;
it must not be described as producing a firmware binary.

## Run the ChatGPT Site locally

Use Node.js **22.13 or newer** for the Site and pnpm 9 or newer. Python 3.11+
is needed only for the optional standalone FastAPI reference service.

From the repository root:

```bash
pnpm install --frozen-lockfile
npm ci --prefix chatgpt-site
pnpm --filter @schematic/firmware-harness verify:wasm
pnpm --dir chatgpt-site dev
```

The Site's `predev` hook verifies the checked-in WASM artifact before starting
Vinext. The local preview is normally at `http://localhost:3000`. The Site
route uses same-origin API handlers; it does not require a second API server.

For a production build and local start:

```bash
pnpm --dir chatgpt-site build
pnpm --dir chatgpt-site start
```

Do not put a real secret in the repository or in a `VITE_*` variable. A hosted
Site requires the server-only `SCHEMATIC_SESSION_SECRET` to be a strong random
value of at least 32 characters. See
[`chatgpt-site/.env.example`](chatgpt-site/.env.example) and the
[Site runbook](docs/CHATGPT_SITE_RUNBOOK.md).

## Site checks

The Site package has no synthetic success path for compilation. Run its checks
explicitly:

```bash
pnpm --dir chatgpt-site lint
pnpm --dir chatgpt-site exec tsc --noEmit -p tsconfig.json
node --test chatgpt-site/tests/capability-fixtures.test.mjs
pnpm --dir chatgpt-site build
```

The shared frontend and portable harness checks are also part of the release:

```bash
pnpm --filter frontend exec tsc --noEmit
pnpm --filter frontend lint
pnpm --filter frontend test -- --run
pnpm --filter @schematic/firmware-harness test
```

## Root release gate

Run this gate from a clean checkout before publishing a Site revision:

```bash
pnpm run install:clean
pnpm run verify
git diff --check
```

`pnpm run verify` covers workspace and Site type-checking, linting, tests,
WASM verification, production builds, and Site asset checks. Publish only
after it and the live acceptance checklist in the runbook pass.

## Optional standalone development reference

The original Vite frontend and Python/FastAPI service remain useful for local
development and tests. They are reference paths, not the production ChatGPT
Site path:

```bash
pnpm dev
pnpm dev:backend
```

The standalone frontend opens at `http://localhost:3000`; the optional API
opens at `http://localhost:8001` with docs at `http://localhost:8001/api/docs`.
Local development uses the explicit development auth mode from the root
script. Never expose that mode or an empty/weak session secret as a hosted
deployment.

## Release provenance

The initial repository commit is dated 25 August 2026. Git history records a
meaningful WebMCP extension afterward: `00d9956` added the hardware WebMCP
studio on 26 August; `de54b96` fixed the WebMCP testing environment on 26
August; `7d2c587` completed the hardware workflow and `7d3f702` verified it on
27 August; and `6e59adf` plus `67b6783` bound the Site and authenticated
workspace runtime on 28 August. These commit facts describe the work that
landed; they do not turn dormant engines into live Site capabilities.

## License

Schematic is licensed under [AGPL-3.0](LICENSE). Third-party components retain
their original licenses; see [NOTICE](NOTICE).
