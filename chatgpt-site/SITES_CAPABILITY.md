# ChatGPT Site browser capability probes

Status: non-product browser acceptance route (repository checked 2026-08-31)

Canonical Site:
[schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site)

Sites project ID: `appgprj_6a913ce4a58881918a47ea49fa0ca505`.
Whether the current revision is published must be checked by the release agent;
this file documents the probe route, not deployment success.

The route `/capabilities` exercises browser primitives that the Site may use for
local storage and static assets. It is an acceptance aid, not a hardware
runtime and not an assertion that source code can be built or run in-browser.

## What the route probes

[`app/capabilities/CapabilityHarness.tsx`](app/capabilities/CapabilityHarness.tsx)
checks:

- a same-origin classic Web Worker;
- the static `components-metadata.json` catalog asset;
- IndexedDB write/read in the isolated `capability-spike` room and
  `local-browser` namespace;
- Cache Storage write/read for the worker fixture; and
- a Blob URL round-trip with a download filename.

The route does not compile, parse, execute, upload, flash, or physically test
the editable source in Schematic. It does not drive the Behavior Plan preview.
The probe database is separate from project storage and must not overwrite user
projects.

## Probe result semantics

- **pass** — the browser API ran and the expected invariant was observed;
- **fail** — the API was present but the invariant or fixture request failed;
- **blocked** — the API is unavailable or requires a secure context; and
- **pending** — the probe needs a second page load, as with persistence after a
  reload.

IndexedDB is a persistence pass only after clicking “Run browser probes” and
then reloading the page. A local pass does not prove that a published Site has
the same browser policy or host permissions.

## Local checks

From the repository root:

```bash
npm --prefix chatgpt-site run lint
npm --prefix chatgpt-site run typecheck
npm --prefix chatgpt-site run test
npm --prefix chatgpt-site run build
```

The Site test fixture confirms the capability page has all five probes and does
not call `/api/compile` or `/api/simulation`. The build verification checks the
worker, metadata JSON, and preview PNG, removes the generated `_headers`
artifact and verifies none remain, and rejects
WebAssembly compilation/instantiation in the capability harness. These
checks do not load user source or establish native WebMCP discovery.

## Live acceptance

The release agent must open the published URL in the ChatGPT in-app browser and
record:

- the deployed commit/version and timestamp;
- each probe result and any secure-context/permission limitation;
- whether IndexedDB survives the required reload; and
- that the route is isolated from the main project repository.

The release agent must separately test the product's 45 native WebMCP tools,
Behavior Plan preview, editable Code handoff, local project persistence, and
retired-route 404 behavior. A capability probe pass cannot be substituted for
those checks.

## Product boundary and future work

The core Site uses typed Behavior Plans and checked-in visual profiles for
preview. Editable code is a durable, hash-addressed artifact for later external
SDK, IDE, compiler, or hardware use. No in-app compiler, MCU emulator, source
interpreter, uploader, or physical test is part of this release.

Legacy runtime/toolchain files may remain dormant in the repository, but the
active Site import closure must not pull them. Do not add a dynamic source
loader, remote execution route, or hidden SDK call to this probe page.

See [`../docs/CHATGPT_SITE_RUNBOOK.md`](../docs/CHATGPT_SITE_RUNBOOK.md),
[`../docs/CHATGPT_SITE_PROGRESS.md`](../docs/CHATGPT_SITE_PROGRESS.md), and
[`../docs/TYPESCRIPT_WEB_SIMULATION_HANDOFF.md`](../docs/TYPESCRIPT_WEB_SIMULATION_HANDOFF.md)
for release gates, implementation details, and handoff contracts.
