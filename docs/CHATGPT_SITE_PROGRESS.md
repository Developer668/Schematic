# ChatGPT Site release checklist

Status: current 56-tool calculator/collaboration candidate is **not yet release-verified or published from this worktree**. Run the full repository gate, review the Git diff, commit/push the intended source, publish the canonical Site project, and then perform live acceptance before marking this revision complete.

## Canonical release target

- Site URL: [schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site)
- Sites project: `appgprj_6a913ce4a58881918a47ea49fa0ca505`
- Binding: [`chatgpt-site/.openai/hosting.json`](../chatgpt-site/.openai/hosting.json)
- Wrapper entry: [`chatgpt-site/app/[[...path]]/SchematicClient.tsx`](../chatgpt-site/app/%5B%5B...path%5D%5D/SchematicClient.tsx)
- Shared app entry: [`frontend/src/App.tsx`](../frontend/src/App.tsx)

Publication status, deployed revision, and native-host behavior are live release evidence. Do not infer them from this repository or from an older deployment record.

## Current product truth

Schematic now has three intentionally separate evidence layers:

1. **Hardware graph and validation**: exact catalog parts, typed ports, wiring, topology/electrical rule diagnostics, and project persistence.
2. **Behavior Preview**: a data-only Behavior Plan prepared against exact checked-in component profiles. It drives deterministic visual state through typed actions/events and never reads or executes board source.
3. **Editable source + Browser Check**: source remains a durable code artifact. The separate Browser Check can execute a bounded documented Arduino/C/C++ subset and static preflight in the browser. It is not a compiler, MCU emulator, electrical simulator, uploader, or physical-hardware test.

Generated starter Behavior Plans and marked starter source are scaffolds only. A project-specific behavior/source implementation must replace or supersede them before the project should be described as complete.

## Current implementation evidence

- `packages/behavior/` contains deterministic Behavior Plan preparation/session logic plus explicit profiles for buttons, membrane keypads, calculator state, indicators, displays, buzzers, relays, servos, motors, and numeric sensors.
- The membrane keypad calculator path is typed end to end: `keypad.press` updates deterministic calculator state, emits `keypad.displayChanged`, and a saved Behavior Plan can route that payload into `display.showText` on the LCD.
- [`frontend/src/application/behaviorCommands.ts`](../frontend/src/application/behaviorCommands.ts) is the shared UI/WebMCP command boundary for plans, preview, typed invocation, source persistence, conflict handling, and export.
- [`frontend/src/application/firmwareCommands.ts`](../frontend/src/application/firmwareCommands.ts) implements bounded Browser Check and explicit non-compilation/non-hardware claims.
- [`frontend/src/application/projectVerification.ts`](../frontend/src/application/projectVerification.ts) combines graph, behavior, source, Browser Check, preflight, compilation boundary, and physical-hardware boundary into one readiness report.
- [`frontend/src/application/agentBuildArtifacts.ts`](../frontend/src/application/agentBuildArtifacts.ts) keeps fallback Behavior/source artifacts synchronized without silently overwriting authored work.
- [`frontend/src/webmcp/designTools.ts`](../frontend/src/webmcp/designTools.ts) provides proposal staging, preview, exact approval, discard, shared undo/redo, goal-level verification, and the state-aware tool surface.
- The default registry contains exactly **56 WebMCP tools**: 11 project, 5 workspace, 5 component, 3 connection, 3 firmware, 6 behavior, 3 code, 2 validation, 10 shopping, and 8 design.
- `workspace.get_state` is intentionally compact; detailed history/state is available through bounded specialist tools.
- Bright Data/public discovery candidates remain untrusted sourcing evidence. They cannot become cart listings without the strict canonical publication boundary.
- The canonical Site API keeps `/api/compile` and `/api/simulation/*` retired.

## Repository verification

Run from the repository root against the exact intended release worktree:

```bash
node --version
pnpm --version
git status --short
git branch --show-current
git rev-parse HEAD
git diff --check
pnpm verify
```

Useful focused checks if the full gate stops:

```bash
pnpm --filter @schematic/frontend typecheck
pnpm --filter @schematic/frontend test -- --run
pnpm run verify:behavior-preview
npm --prefix chatgpt-site run verify
npm --prefix chatgpt-site run build
```

Do not mark this section green based on an older commit. The current calculator/collaboration changes must pass the commands above after the final edits.

## Pre-publish checklist

- [ ] Node.js is 22.13+ and pnpm is 9+.
- [ ] `git status --short` contains only reviewed intended changes.
- [ ] No secrets, environment files, private keys, generated caches, or unintended build output are staged.
- [ ] `git diff --check` passes.
- [ ] `pnpm verify` passes from the intended release revision.
- [ ] The static release gate reports exactly 56 tools and no deprecated `firmware.compile` or `simulation.*` registration.
- [ ] The active Site import closure does not pull the quarantined legacy compiler/runtime packages.
- [ ] Site verification/build passes from a clean output directory.
- [ ] The reviewed commit is pushed to `main`.
- [ ] Only canonical Sites project `appgprj_6a913ce4a58881918a47ea49fa0ca505` is published.

## Live acceptance checklist

Run these against the published revision inside the ChatGPT in-app browser.

- [ ] Native WebMCP discovery reports exactly **56** tools. Local shims do not count.
- [ ] `workspace.get_tool_surface` returns a small state-aware shortlist while the full registry remains available.
- [ ] Start from an empty project and call `design.propose` for a basic calculator.
- [ ] `design.preview` shows the staged Arduino Uno + membrane keypad + I2C LCD design without mutating the project.
- [ ] A mismatched proposal confirmation is rejected without mutation.
- [ ] Exact `design.apply` approval produces 3 components and 12 connections plus the saved `calculator-interaction-v1` Behavior Plan.
- [ ] `behavior.preview` starts successfully.
- [ ] `behavior.press_key` with `7`, `+`, `5`, `=` makes the LCD projection display `12` and the keypad projection record `=`.
- [ ] `behavior.get_state` shows the accepted typed keypad/display events and keeps Behavior Preview source/build/physical claims false.
- [ ] Break one connection, use `design.undo` to restore it, then verify `design.redo` and a second undo.
- [ ] `workspace.get_state` remains compact; activity can be read through `workspace.get_activity`.
- [ ] `design.verify` reports calculator interactivity and distinguishes generated starter source from authored source.
- [ ] Replace only the marked generated starter source with project-specific firmware using `code.write` and its required precondition.
- [ ] `firmware.check` executes only supported bounded Browser Check constructs and reports unsupported ones as partial/unavailable rather than pretending success.
- [ ] Browser Check keeps `sourceCodeCompiled`, `electricalBehaviorSimulated`, `uploadedToHardware`, and `physicalHardwareVerified` false.
- [ ] Wrong expected source hash preserves the current document.
- [ ] Plans/source survive reload in the same verified-user browser room; active preview state is recreated rather than persisted.
- [ ] Project switching does not leak plans, source, preview snapshots, shopping state, or selection between projects.
- [ ] Shopping discovery can surface Bright Data/public candidates when configured, but candidates remain non-cart-trusted until reviewed canonical publication.
- [ ] `/api/compile` and `/api/simulation/*` return 404.
- [ ] `/capabilities` browser probes are recorded separately and are not presented as hardware/source correctness evidence.

## Release evidence to record

Record the exact current publication, not a historical one:

- Git commit and branch;
- Site project ID and deployed Site version/deployment ID;
- publication timestamp;
- native WebMCP count and host context;
- calculator proposal ID and exact apply confirmation;
- graph component/connection counts and validation result;
- Behavior `planSha256`, `projectSha256`, `registrySha256`, `sessionLogSha256`, and `snapshotSha256` where available;
- source `contentSha256`, Browser Check status, unsupported constructs/warnings, and export manifest hash;
- exact false compilation/electrical/upload/physical claims;
- undo/redo evidence;
- compact-state/tool-surface evidence;
- shopping provenance boundary evidence; and
- retired-route 404 results.

An older deployment record may be useful historical context, but it must never be presented as proof that this worktree or the 56-tool revision is live.

## Scope reminders

- Quarantined `packages/avr-runtime`, `packages/browser-toolchain`, `packages/firmware-harness`, and old simulation/runtime files are not current Site capabilities and must stay outside the active Site import closure.
- Behavior support is exact and finite. Unsupported parts/actions fail explicitly rather than receiving guessed behavior.
- Browser-local persistence is not cloud backup or cross-device synchronization.
- Browser Check is bounded source execution, not target compilation or electrical simulation.
- Physical wiring, upload, board bring-up, and hardware verification remain external.

See [ARCHITECTURE.md](../ARCHITECTURE.md), [webmcp/tools.md](webmcp/tools.md), [DEMO_SCRIPT.md](DEMO_SCRIPT.md), [CHATGPT_SITE_RUNBOOK.md](CHATGPT_SITE_RUNBOOK.md), and [`../chatgpt-site/SITES_CAPABILITY.md`](../chatgpt-site/SITES_CAPABILITY.md).
