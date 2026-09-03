# Behavior Preview implementation audit

- Audit owner: Sol/root (independent of delegated implementation work)
- Initial audit: 2026-08-31
- Scope: behavior core, application commands, persistence/import boundaries, WebMCP, Studio UI, responsive/accessibility behavior, production Site routes, and client bundle
- Decision baseline: [ADR-001](ADR-001-BEHAVIOR-PLAN-PREVIEW.md)

## Initial health score (pre-remediation baseline)

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Functional correctness | 2/5 | Static actions and typed dispatch work, but playback, resume/reset, and the canvas button interaction have user-visible defects. |
| Product truthfulness | 3/5 | The code panel and preview claims are honest; the Inspector and landing page still describe the superseded executable-browser model. |
| Security and boundaries | 4/5 | Source is never evaluated and typed profiles are checked in. A few import/code metadata collections remain insufficiently bounded. |
| Accessibility and responsive UX | 3/5 | The live Safari accessibility tree is meaningful and controls are labelled, but several dense icon controls fall below a reliable touch target and the initial preview state is incorrectly announced as blocked. |
| Performance and release hygiene | 3/5 | Deterministic limits and bundle quarantine exist; the Site build still reports a client chunk above 500 kB and the handoff/runbook are stale. |

Initial verdict (historical, before the implementation pass): **not
release-ready**. This baseline is retained to explain why the findings below
were opened; it is not the current release decision.

## Findings before remediation

### P1-01 — Play does not advance timed Behavior Plans, resume restarts, and a fresh workspace becomes blocked

- Locations: `frontend/src/pages/StudioPage.tsx:184`, `frontend/src/application/behaviorCommands.ts:255`, `frontend/src/application/behaviorCommands.ts:305`, `frontend/src/application/behaviorCommands.ts:500`
- Evidence: “Preview behavior” opens a session and changes a label to `playing`, but no clock calls `seek`; timed rules/cues remain at zero until a user drags the slider. The same start path is used for resume, so a paused preview is reopened from the beginning. During Studio mount/project switch, `resetPreview` calls the adapter with no active session; that failure overwrites the safe idle state with `blocked`. Live Safari verification reproduced `BLOCKED` on a new empty project before the user requested a preview.
- Impact: the central “show the requested outcome” interaction is misleading and incomplete.
- Required fix: carry a bounded playback duration, distinguish start from resume, add one throttled ephemeral playback clock, and make reset-without-session return idle.

### P1-02 — The canvas pushbutton can only emit repeated presses

- Locations: `frontend/src/components/canvas/ComponentVisualOverlay.tsx:19`, `frontend/src/components/canvas/HardwareNode.tsx:56`, `packages/behavior/src/profiles/momentary-input.ts:29`
- Evidence: the overlay chooses pressed/released from the projected profile state, but its callback only dispatches an event. Events do not mutate the momentary-input state, so the projection stays released and every click emits `button.pressed`.
- Impact: users cannot see a pressed button or trigger release rules from the primary canvas interaction.
- Required fix: route the canvas control through the declared `button.setPressed` action and let the trusted profile emit the corresponding typed event.

### P1-03 — Active UI copy still claims browser execution/simulation

- Locations: `frontend/src/components/inspector/Inspector.tsx:69`, `frontend/src/components/inspector/Inspector.tsx:119`, `frontend/src/pages/LandingPage.tsx:176`, `frontend/src/pages/LandingPage.tsx:197`, `frontend/src/pages/LandingPage.tsx:274`
- Evidence: the Inspector derives “Browser execution supported” from legacy model metadata and includes a “Simulation model” card. The live landing page says “Supported models run in-browser” and describes a behavioral runtime. These claims conflict with the new Behavior Plan preview boundary.
- Impact: product messaging undermines the explicit claim that preview does not execute source.
- Required fix: describe exact Behavior Profile mapping, typed outcome preview, and editable external-use source only.

### P2-01 — Rewinding can apply zero-time scheduled work twice

- Location: `packages/behavior/src/session.ts:419`
- Evidence: `resetRuntime()` applies zero-time rules/cues and records their IDs, then `rebuildTo()` clears `appliedScheduleIds` before replaying the schedule.
- Impact: a stateful zero-time action may be duplicated after a backward seek, breaking deterministic replay.
- Required fix: preserve the IDs materialized by `resetRuntime()` and add a backward-seek regression test.

### P2-02 — Plan preparation does not independently reject duplicate or unknown project components

- Location: `packages/behavior/src/prepare.ts:78`
- Evidence: `inspectProject` can diagnose duplicate component IDs and unknown definitions, and the final preparation gate names both errors, but `prepareBehaviorPlan` does not add those structural diagnostics. Its map silently keeps the first duplicate.
- Impact: callers using the package without the frontend's separate graph validator can prepare against an ambiguous project.
- Required fix: add structural project diagnostics at preparation and cover duplicates/unknown definitions in package tests.

### P2-03 — Persistence/code metadata limits and relative path checks are incomplete

- Locations: `frontend/src/store/behaviorPersistence.ts:216`, `frontend/src/store/behaviorPersistence.ts:246`, `frontend/src/application/behaviorCommands.ts:340`, `frontend/src/webmcp/behaviorTools.ts:34`
- Evidence: imported rule objects retain an unbounded `then` array; dependency arrays have no maximum; and filename checks miss exact or terminal dot segments such as `..` and `src/..`. WebMCP schemas do not declare the code file/dependency maxima.
- Impact: malformed imported/model-authored data can consume excessive memory or produce ambiguous unsafe handoff paths.
- Required fix: bound every nested collection, validate code metadata before mutation, and reject unsafe relative path segments explicitly.

### P2-04 — Several compact controls are below a dependable pointer target

- Locations: `frontend/src/pages/StudioPage.tsx:414`, `frontend/src/components/layout/BottomDock.tsx:23`, `frontend/src/components/editor/MonacoWorkspace.tsx:350`
- Evidence: multiple icon controls are 24–28 CSS pixels, and the component-search clear target is 16 pixels. The workspace is responsive, but these targets are fragile on touch devices. Relevant guidance: WCAG 2.5.8 Target Size (Minimum).
- Impact: higher miss rate for touch and motor-impaired users.
- Required fix: retain the dense visual size while expanding hit areas to at least 24 px, preferably 32–36 px for primary workspace controls.

### P3-01 — Production build reports an oversized client chunk

- Evidence: `npm run verify` succeeds but Vite reports at least one minified client chunk above 500 kB. Monaco is the likely dominant dependency.
- Impact: slower first interaction on constrained devices.
- Required fix: verify Monaco stays route/panel lazy-loaded; record remaining chunk size as a measured follow-up if splitting cannot be safely completed in this release.

### P3-02 — Operational documentation still describes the retired runtime path

- Locations: `README.md`, `ARCHITECTURE.md`, `docs/CHATGPT_SITE_RUNBOOK.md`, `docs/DEMO_SCRIPT.md`, `docs/webmcp/tools.md`, `docs/CHATGPT_SITE_PROGRESS.md`, `chatgpt-site/SITES_CAPABILITY.md`
- Impact: a later agent could accidentally restore compiler/simulation claims or use obsolete acceptance tests.
- Required fix: replace the current-state documentation and add exact verification/release facts to the TypeScript handoff.

## Positive controls confirmed in the initial audit

- The checked-in registry is immutable and hash-pinned.
- Behavior Plan parsing uses a small JSON-only schema subset with depth, count, time, event-chain, display-text, and timeline limits.
- Source documents are ordinary text artifacts and no Behavior Profile receives source text.
- Plan/project/registry hashes make preview provenance explicit.
- WebMCP no longer registers `firmware.compile` or any `simulation.*` tool.
- The production Site returns `404` for retired compile/simulation routes.
- The client release gate scans the actual import closure and built assets for dormant runtime/compiler markers.
- Live Safari verification confirmed meaningful page content, labelled Studio controls, device-local persistence messaging, and an explicit preview disclaimer.

## Remediation status (release-candidate audit)

The remediation pass addressed the initial P1/P2 findings and the subsequent
iterative Sol review findings. Sol's final turn reached the account usage limit
before issuing a formal sign-off, so this document does not attribute a final
approval to Sol. The root release audit reran the gates below against the
release candidate; live Site publication and in-app browser acceptance remain
separate deployment evidence.

### Current implementation areas to re-audit

| Area | Current repository control | Final evidence still required |
| --- | --- | --- |
| Playback, reset, and resume | Preview duration is bounded; logical time is advanced by an ephemeral clock; pause/resume preserves the session; reset without a session is safe idle. | Package/application regression tests plus a clean browser run on the release commit. |
| Button press/release | Canvas interaction routes through the declared `button.setPressed` action and the trusted profile emits the matching typed event. | Press/release and downstream-rule fixtures, plus UI interaction verification. |
| Product truthfulness | UI, API, manifests, and source metadata describe a scripted outcome and keep source execution/build/upload/physical-test claims false. | Copy scan, route checks, and live Site inspection. |
| Deterministic replay | Ordered typed session entries, logical time, bounded event chains, snapshot/session hashes, and seek/reset reconstruction are the preview replay contract. | Same-input snapshot/hash parity, backward-seek zero-time behavior, and replay tests. |
| Project fingerprint | `projectBehaviorFingerprint` hashes semantic graph identity (project id/version, sorted component ids/definitions/properties/firmware-group identity, and sorted connection endpoints/domains). It excludes source, timestamps, labels, positions, and rotations, so layout-only edits do not change the semantic preview hash. | Verify layout versus semantic edits and plan/code staleness behavior together. |
| Plan/project/code provenance | Canonical plan, project, registry, source, session-log, and snapshot hashes are carried in preview/code handoff data. Imported source is marked imported; mismatched links become stale; legacy artifacts/configuration stay inert quarantine data. | Import/export round trip, hash recomputation, and stale-link fixtures. |
| Source limits | Canonical editable source is capped at 512 KiB aggregate per project; each file is capped at 1 MiB; canonical documents plus legacy `firmwareTargets` mirrors are capped at a 1 MiB serialized source-container envelope. | Boundary tests for writes, normalization, export, and `.vlx` import. |
| Workspace limits/recovery | A room may contain at most 50 projects and 8 MiB of serialized workspace data. An over-limit hydrated room leaves the original storage untouched, records a recovery error, keeps projects in the bounded recovery window visible/selectable/exportable, and blocks ordinary mutations. Only confirmed project clear/delete actions that strictly reduce project count or serialized size are allowed until the room fits. Create, duplicate, and import checks are atomic. | Oversize hydration, capacity mutation, local-storage/IndexedDB status, and recovery UX checks. |
| Destructive mutations | `project.delete`/`clear`, `component.remove`, and `connection.disconnect` require exact repeated identity fields. Blueprint replacement requires `replace: true` plus the exact active project id; default blueprint application creates a new project. | Structured rejection tests proving no state mutation on missing/wrong confirmation. |
| Input and import safety | JSON-only bounded schemas, exact keys/IDs, safe relative paths, dependency/file/history caps, no source execution, and legacy quarantine are enforced before durable writes. | Full VLLX and WebMCP boundary tests against malformed/deep/oversized inputs. |
| Site/compiler boundary | The active Site path does not register compiler/simulation tools or package legacy runtime imports; retired API paths are intended to return 404. | Active import-closure scan, Site verification, production routes, and native tool discovery. |
| Accessibility/performance | Semantic labels/live regions, responsive panels, coarse-pointer hit areas, and lazy editor loading are implemented. | Fresh browser/device checks and measured release build output; no prior chunk number is authoritative. |

Additional implementation changes reported during remediation include shared
UI/WebMCP commands, rejected downstream actions, lifecycle-safe adapter
installation, visible blocked/partial diagnostics, static capability probes
without WASM execution, and optimistic source conflict handling. These claims
also require the final clean-checkout test and browser evidence.

### Release-candidate score and verdict

| Dimension | Score | Evidence |
| --- | --- | --- |
| Functional correctness | 5/5 | Workspace-wide typecheck, lint, tests (173 frontend tests; 28 Behavior tests), builds, and the static Behavior Preview release gate passed. |
| Product truthfulness | 5/5 | Active Site import closure contains no compiler/simulation path; source claims remain false; retired routes are excluded/404. |
| Security and boundaries | 4/5 | Bounded schemas, persistence/auth leases, optimistic conflicts, import limits, destructive confirmations, and shopping/catalog boundaries passed automated coverage; live host checks remain deployment evidence. |
| Accessibility and responsive UX | 4/5 | Semantic labels, live status text, disabled pre-preview controls, expanded hit areas, and responsive panels are covered in the UI implementation; device/browser inspection remains a live acceptance item. |
| Performance and release hygiene | 4/5 | Monaco is lazy-loaded and Site verification/build passed; the shared frontend bundle remains large (Monaco worker assets and a ~1.1 MB main chunk), so further measured splitting is a follow-up. |

Final release-candidate verdict: **repository gates passed and the current
account Site revision was published successfully**. Live HTTP smoke checks
returned 200 for `/`, `/api/health`, `/api/docs`, and `/capabilities`, and 404
for `/api/compile` and `/api/simulation/state`. Native WebMCP discovery and
interactive button→LED acceptance still require an in-app browser session;
the deployment itself does not claim those checks or any hardware result. The
declared scope remains compiler-free: preview is a typed visual outcome, and
Code is ordinary editable source for a later external SDK, compiler, IDE, or
hardware workflow. Unsupported catalog parts remain explicit; coverage
expansion requires exact profiles and conformance fixtures.

## Evidence record to complete on the release commit

Record the exact commands and observed outputs after the last code change:

- behavior package and frontend typecheck/tests;
- Site lint, typecheck, tests, build, and built-asset checks;
- compiler-free import-closure and forbidden-route checks;
- workspace capacity, source aggregate, import/provenance, and confirmation
  boundary checks; and
- canonical Site URL, authentication, native WebMCP discovery, persistence,
  preview, code handoff, and retired-route results in the ChatGPT in-app
  browser.

The release candidate was checked on 2026-09-03 with `pnpm run verify`:
workspace typecheck/lint passed; frontend reported 187 tests across 31 files;
the Behavior package reported 29 tests; all workspace builds passed; Site
lint/typecheck/tests/build and the static compiler-free asset scan passed; and
`git diff --check` passed. The source was pushed at commit
`1504f7ab56e2851fcd3a881e2b38bac601d37e2e`; Site version 15 was saved from
that commit and deployment `appgdep_6a98ecd1baec8191a8a94a52779e6ba4` reached
`succeeded` at 2026-09-03T03:43:26Z. Authenticated in-app browser acceptance
opened `/studio`, kept the code panel docked beside the canvas, and ran
`behavior.get_capabilities` with 45 WebMCP tools registered. These are
repository/deployment observations, not proof that physical hardware works.
