# ChatGPT Site release checklist

Status: current release checklist (2026-08-31). This file is intentionally
operational; historical agent handoffs and superseded live-version claims do
not belong here.

## Current publishing blocker

- The canonical public URL returns HTTP 200, and its `/api/health` and
  `/api/docs` routes respond.
- In the active ChatGPT workspace, the Sites connector returns
  `project not found` for the persisted project ID below. The current workspace
  therefore cannot save or deploy a new version even though the existing public
  deployment remains reachable.
- Do not replace `chatgpt-site/.openai/hosting.json`, create a duplicate Site, or
  infer deploy permission from the public URL. Switch to the owning ChatGPT
  workspace or obtain explicit authorization for a new binding.
- A GitHub push and a Sites deployment are separate operations. GitHub has no
  workflow in this repository that automatically publishes the Site.

## Canonical release

- Live Site: [schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site)
- Site project: `appgprj_6a913ce4a58881918a47ea49fa0ca505`
- Primary host: authenticated ChatGPT in-app browser.
- Source path: `chatgpt-site` wrapper → shared `frontend` app/store.
- API path: same-origin `chatgpt-site/app/api/[[...path]]/route.ts` importing
  `functions/api/_runtime.ts`.

## Pre-publish gates

- [ ] Confirm the publishing checkout contains the intended source revision and
      the checked-in firmware-harness WASM artifact/metadata.
- [ ] Provide `SCHEMATIC_SESSION_SECRET` through server-side Site configuration;
      it must be a strong random value with at least 32 characters. Never commit
      or expose the value to the browser.
- [ ] Run the root release gate in [README.md](../README.md), including Site
      lint, TypeScript, fixture tests, and production build.
- [ ] Confirm `pnpm --filter @schematic/firmware-harness verify:wasm` passes.
- [ ] Keep production compilation claims bounded: Site `firmware.compile` is
      source/target preflight and does not produce arbitrary firmware binaries.

## Production acceptance

- [ ] Unauthenticated `/studio`, `/parts`, and `/settings` redirect to ChatGPT
      sign-in; an authenticated `/api/auth/session` returns a short-lived session.
- [ ] Live `/api/health` returns 200 with `api_boundary: "same-origin"`, and
      `/api/docs` describes the same-origin routes.
- [ ] In the ChatGPT in-app browser, native WebMCP discovery reports exactly 42
      tools. A compatibility bridge or local polyfill is not native acceptance.
- [ ] Use native tools to search/add a board, pushbutton, and LED, inspect ports,
      connect typed endpoints, and run `validation.check`.
- [ ] Write the exact button→LED source, press and release the virtual button,
      and confirm `simulation.run` reports `executionEngine: "c-wasm"`, ABI v2, a
      64-hex-character artifact hash, and LED `true`/`false` outputs.
- [ ] Submit an unsupported sketch/API and confirm the result is explicitly
      unsupported; no fake binary or silent success is accepted.
- [ ] Call `project.save`, reload or switch projects, and confirm the graph,
      wiring, and firmware remain in the verified-user browser-local room.
- [ ] Confirm public parts candidates remain non-cart data until an authenticated
      WebMCP agent publishes exact, provenance-backed listings.
- [ ] Confirm engine status is honest: behavioral runtime available where its
      model contract applies; native compiler/simulator paths unavailable or
      unsupported on the Site; raw WebSocket transport unavailable.

## Scope reminders

- The fixed precompiled browser path is only the exact button→LED portable
  C/WASM semantic contract (ABI v2, deterministic virtual I/O, hash-verified
  artifact). A conservative recognizer selects it; the matched user sketch is
  not compiled into or executed by that module.
- Other supported behavior uses the bounded TypeScript interpreter and explicit
  model/protocol adapters. Catalog placement and typed validation do not imply
  executable device behavior.
- The Site has no native Site MCP server declaration; its agent surface is the
  client-side WebMCP producer exposed by the shared frontend.
- The browser-local repository is device-local persistence, not a hosted
  database, backup, or cross-device synchronization service.
- Chrome's WebMCP testing flag documentation targets v149+, while this release
  is judged in the ChatGPT in-app browser. Check the actual host at acceptance.

## Reference paths (not Site production)

The standalone Vite frontend, Python/FastAPI service, native engine adapters,
vendored Velxio material, AVR/browser-toolchain packages, and separate worker
entrypoint remain reference/dormant paths. They must not be used as evidence
that the ChatGPT Site runs native engines or arbitrary firmware compilation.

For the complete topology and capability matrix, see
[ARCHITECTURE.md](../ARCHITECTURE.md). For the approved Behavior Preview and
editable-code TypeScript implementation handoff, see
[TYPESCRIPT_WEB_SIMULATION_HANDOFF.md](TYPESCRIPT_WEB_SIMULATION_HANDOFF.md).
For the timed judge flow, see
[DEMO_SCRIPT.md](DEMO_SCRIPT.md). For publish, rollback, and acceptance
procedure, see [CHATGPT_SITE_RUNBOOK.md](CHATGPT_SITE_RUNBOOK.md).
