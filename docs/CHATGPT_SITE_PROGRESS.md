# ChatGPT Site release checklist

Status: Behavior Preview/editable-code implementation documented 2026-09-01;
repository-wide release gates passed. The formal Sol turn reached the account
usage limit before sign-off; publication of the release candidate is still
pending and must be verified in the ChatGPT host.

## Canonical release target

- Live URL: [schematic-hardware-workbench.decipherer71951502.chatgpt.site](https://schematic-hardware-workbench.decipherer71951502.chatgpt.site)
- Sites project: `appgprj_6a9216cfb16881919e467839d41b29b8`
- Binding file: [`chatgpt-site/.openai/hosting.json`](../chatgpt-site/.openai/hosting.json)
- Wrapper entry: [`chatgpt-site/app/[[...path]]/SchematicClient.tsx`](../chatgpt-site/app/%5B%5B...path%5D%5D/SchematicClient.tsx)
- Shared app entry: [`frontend/src/App.tsx`](../frontend/src/App.tsx)

Publication status, deployed revision, and native host behavior are release
evidence, not repository facts. Do not mark publication complete until the
published URL passes the live checklist below.

## Product truth

The current product has two separate authoring surfaces:

1. A data-only Behavior Plan is validated against exact component profiles and
   drives a deterministic visual preview through typed actions/events.
2. An independently editable Code document stores ordinary source for copy,
   download, export, and later use in an external SDK, compiler, IDE, or
   physical-hardware workflow.

Schematic does not compile, parse, interpret, emulate, upload, flash, or
physically test the source. Preview claims must keep source execution,
compilation, upload, electrical behavior, wiring verification, and physical
verification false. A preview outcome is not evidence that generated source or
hardware works.

## Landed implementation evidence

- `packages/behavior/` contains contracts, JSON-safe schemas, canonical hashes,
  exact profile registry, preparation, deterministic sessions, and profiles for
  button, indicator, text display, buzzer, relay, servo, motor, and numeric
  sensor behavior.
- [`frontend/src/application/behaviorCommands.ts`](../frontend/src/application/behaviorCommands.ts)
  is the shared application-command seam for UI and WebMCP. It validates plans,
  opens ephemeral preview sessions, dispatches typed requests, persists code,
  records export history, and produces handoff manifests.
- [`frontend/src/store/behaviorPersistence.ts`](../frontend/src/store/behaviorPersistence.ts)
  defines durable plan/code records, exact content hashes, origins, limits, and
  legacy quarantine normalization.
- [`frontend/src/store/useProjectStore.ts`](../frontend/src/store/useProjectStore.ts)
  stores normalized `behaviorPlans` and `codeDocuments`; old simulation config
  and compiled artifacts are inert `legacyBehaviorData` only.
- [`frontend/src/webmcp/behaviorTools.ts`](../frontend/src/webmcp/behaviorTools.ts)
  exposes five `behavior.*` and three `code.*` adapters. The default registry in
  [`frontend/src/webmcp/tools.ts`](../frontend/src/webmcp/tools.ts) has 45 tools
  and no `firmware.compile` or `simulation.*` registration.
- [`chatgpt-site/app/api/[[...path]]/route.ts`](../chatgpt-site/app/api/%5B%5B...path%5D%5D/route.ts)
  exposes only same-origin health, catalog, import-analysis, parts, and
  identity helpers. Retired compile and legacy runtime paths return 404 on the
  canonical ChatGPT Site route; repository-root compatibility handlers are not packaged.
- The Code panel is explicitly labeled editable source and
  `inAppVerification: "not-performed"`; manual edits do not alter the preview.
- The semantic project fingerprint covers project identity/version, component
  identities/definitions/properties, firmware-group identity, and connection
  endpoints/domains. It excludes source, timestamps, labels, positions, and
  rotations, so layout-only changes do not invalidate a preview's semantic
  hash. Session logs and snapshot hashes make replay deterministic; they are
  not executable source.
- Workspace persistence is bounded at 50 projects and 8 MiB serialized data.
  An over-limit room enters recovery without overwriting the original stored
  data; every project in the bounded recovery window remains visible and
  exportable, while ordinary edits remain blocked. Only confirmed project
  clear/delete operations that strictly reduce project count or serialized size
  are allowed until the room fits. Canonical editable source is capped at 512 KiB aggregate per project,
  with a separate 1 MiB serialized envelope cap across canonical documents and
  compatibility `firmwareTargets` mirrors (and a 1 MiB per-file upper bound).
- Destructive operations are identity-confirmed: delete/clear repeat the exact
  project id, component removal repeats the instance id, connection removal
  repeats the connection id, and blueprint replacement requires `replace:true`
  plus the exact active project id. Blueprint application defaults to creating a
  separate project.

## Repository checks

Run the following against the final release commit. The current candidate
passed `pnpm run verify` on 2026-09-01: 31 frontend test files/173 tests, 28
Behavior package tests, all workspace checks/builds, Site verification, and
the compiler-free asset scan. Re-run these checks against any later commit;
they are repository observations, not hardware or compiler evidence.

```bash
pnpm --filter @schematic/frontend typecheck
pnpm --filter @schematic/frontend test -- --run
pnpm run verify:behavior-preview
npm --prefix chatgpt-site run verify
git diff --check
```

`pnpm run verify:behavior-preview` is a static compiler-free boundary check. It
does not execute user source. Repository-wide checks may still inspect dormant
reference workspaces; that is separate from the Site runtime dependency graph.

## Pre-publish checklist

- [ ] Confirm Node.js 22.13+, pnpm 9+, frozen lockfiles, and clean intended
      source revision.
- [ ] Confirm server-only `SCHEMATIC_SESSION_SECRET` is strong and
      `SCHEMATIC_AUTH_MODE=chatgpt-sites` is enabled.
- [ ] Pass focused frontend checks, behavior boundary gate, Site verification,
      capacity/import/confirmation boundary checks, and `git diff --check`.
- [ ] Inspect the active Site import closure; it must not pull firmware harness,
      browser toolchain, AVR runtime, source interpreter, or legacy remote
      runtime modules.
- [ ] Build the Site with `npm --prefix chatgpt-site run build`.
- [ ] Publish only to Sites project
      `appgprj_6a9216cfb16881919e467839d41b29b8`; do not create a duplicate
      binding or change the canonical URL.

## Live acceptance checklist

- [ ] In the ChatGPT in-app browser, native WebMCP discovery reports exactly 45
      tools; local shims do not count.
- [ ] Five behavior tools and three code tools are available; only source
      compatibility aliases `firmware.write/read` remain from the old naming.
- [ ] No `firmware.compile` or `simulation.*` tool is registered.
- [ ] Search/add/connect a board, button, and LED; invalid endpoints return
      structured diagnostics.
- [ ] Write a button→LED Behavior Plan, preview it, invoke `button.pressed`,
      and observe the LED visual projection.
- [ ] Preview result says scripted/typed outcome and keeps source/build/upload/
      physical-verification claims false.
- [ ] Write, read, manually edit, and export ordinary source. Verify the
      content hash, handoff manifest, and `inAppVerification` metadata.
- [ ] Confirm source aggregate limits (512 KiB canonical project total, 1 MiB
      per file upper bound, 1 MiB canonical-plus-mirror serialized envelope),
      and verify rejected writes/imports leave durable state unchanged.
- [ ] Wrong expected source hash returns a conflict without overwriting code;
      plan/graph/code edits mark a link stale as appropriate.
- [ ] Reload preserves plans/code in the same verified-user local room but does
      not restore a live preview session or snapshot.
- [ ] Exercise the 50-project/8 MiB workspace boundary and verify an oversized
      hydrated room preserves the original storage, keeps projects
      switchable/exportable, and allows only reduction-only confirmed
      clear/delete recovery actions until it fits.
- [ ] Switch projects and confirm plans, code, and preview state do not leak.
- [ ] Move components/auto-layout and confirm the semantic project hash is
      unchanged; then change wiring/properties and confirm the preview/link
      fingerprint becomes stale as appropriate.
- [ ] Verify destructive tools reject missing or mismatched exact confirmation
      ids without mutating state; verify blueprint replacement requires the
      explicit replacement flag and active project id.
- [ ] `GET /api/health` and `/api/docs` succeed; `/api/compile` and
      `/api/simulation/*` return 404.
- [ ] Run `/capabilities`; record browser probe results separately from product
      behavior. It does not prove source build or hardware support.
- [ ] Confirm shopping discovery remains untrusted and no purchase/checkout
      operation exists.

## Evidence to record after publication

Record the commit, deployed Site version, publication timestamp, project ID,
native tool count/host, live-route results, and the behavior/code fixture
metadata:

- Behavior `planSha256`, `projectSha256`, `registrySha256`;
- preview `sessionLogSha256` and `snapshotSha256`;
- code `contentSha256`, per-file hashes, and exported manifest hash; and
- workspace/source capacity and import provenance observations, including
  whether the recovery path was exercised, including switch/export and
  reduction-only confirmed clear/delete behavior; and
- the exact false claims for source execution, build, upload, electrical
  simulation, wiring verification, and physical behavior.

Hashes establish which content and registry produced an artifact. They do not
prove that source compiles or that hardware works.

## Scope reminders

- `packages/avr-runtime/`, `packages/browser-toolchain/`, old runtime files,
  and legacy API handlers may remain as dormant/quarantined repository history.
  They are not Site capabilities and must not enter the active import closure.
- Behavior profile support is exact and finite. Unsupported components/actions
  fail explicitly rather than receiving guessed behavior.
- Browser-local persistence is not cloud backup or cross-device synchronization.
- An over-limit workspace must be recovered explicitly; never silently truncate
  or overwrite its original serialized room while trying to make the Site load.
- External SDK/build/upload/physical testing requires a user-selected workflow
  outside Schematic.

See [ARCHITECTURE.md](../ARCHITECTURE.md),
[TYPESCRIPT_WEB_SIMULATION_HANDOFF.md](TYPESCRIPT_WEB_SIMULATION_HANDOFF.md),
[webmcp/tools.md](webmcp/tools.md), [DEMO_SCRIPT.md](DEMO_SCRIPT.md), and
[CHATGPT_SITE_RUNBOOK.md](CHATGPT_SITE_RUNBOOK.md).
