# Continuation checkpoint — 2026-08-31

This file is the exact pause point for the compiler-free Behavior Preview release. The worktree is intentionally uncommitted and must not be reset or cleaned. All existing modifications belong to this release.

## User objective

Ship Schematic as a web workspace where:

- a typed Behavior Plan is the source of truth for deterministic visual outcomes;
- editable Arduino/C++ and related source is shown as an AI draft/artifact and is never claimed to have run, compiled, or verified;
- preview and generated source derive from the same declared behavior intent;
- unsupported component actions fail explicitly;
- real compilation/upload is outside this product direction;
- the finished work is audited, committed and pushed to GitHub, then published to the existing ChatGPT Site.

## Repository and deployment identity

- Workspace: `/Volumes/Adi-SSD/Users/adityadas/Desktop/Programming/Schematic/Schematic`
- Branch: `main`
- GitHub remote: `https://github.com/Developer668/Schematic.git`
- Remote HEAD before this release: `477e81d95a4366e55893037cf563ebfc4922efaf`
- Active Sites project ID: `appgprj_6a913ce4a58881918a47ea49fa0ca505`
- Active Site URL: `https://schematic-hardware-workspace.decipherer71.chatgpt.site/`
- Site source checkout: `chatgpt-site/`
- Site metadata: `.openai/hosting.json`
- GitHub issue tracking this release: `https://github.com/Developer668/Schematic/issues/1`

Release completed after the account switch: GitHub commit
`134c28dbd9fc58376b68f87b87ff3c4eb3c85318` is pushed to `main`; the current
account Site source is pushed, Site version 6 is saved, and deployment
`appgdep_6a96798637ac819183c18605d5c4fa6d` succeeded. GitHub issue #1 still
needs its final close/comment update. Native in-app WebMCP/browser acceptance
is not asserted by the HTTP smoke checks.

## Implemented in the current worktree

- Compiler/runtime-oriented simulation was replaced by a checked-in typed Behavior System and deterministic outcome preview.
- Nine checked profiles and eight exact catalog bindings are present, with generic visual primitives and explicit unsupported behavior.
- Behavior Plan persistence, schema validation, revision preconditions, deterministic replay, bounded history count, command tooling, WebMCP tooling, visual overlays, timeline, UI controls, and documentation were added.
- Editable multi-file source is isolated from preview, labeled as an uncompiled AI draft, and supports copy/download/export.
- WebMCP has exactly 45 tools; `firmware.compile` and `simulation.*` are absent.
- Project/source/import persistence, optimistic concurrency, workspace capacity/recovery, auth-room isolation, abort handling, server response caps, JSON fidelity, destructive confirmation, catalog-runtime consistency, and shopping trust boundaries received substantial hardening and regression coverage.
- `behavior.plan.write` requires `expectedRevision` at TypeScript and WebMCP boundaries: `null` is create-only, an exact non-negative safe integer is replace-only, omission fails with `PLAN_REVISION_REQUIRED`, and malformed values fail with `INVALID_PLAN_REVISION`.
- Shopping query/listing/storage/broadcast limits and cart-input limits are implemented, including rejection of more than 500 cart-reset IDs or IDs longer than 120 characters.
- Inspector behavior controls were just changed to remain disabled until a preview snapshot exists and to reconcile optimistic values back to the authoritative reducer projection after rejection.

## Last verified state

Before the final pause:

- Frontend TypeScript typecheck passed after the Inspector and shopping changes.
- `webmcp-shopping-boundary.test.ts` passed all eight tests, including query, nested publication, and cart-reset bounds.
- `room-scoped-ui-stores.test.ts` passed all three tests, including oversized same-room shopping storage/broadcast ingestion.
- The new Inspector control test initially used the wrong accessible label and failed only because the button selector returned nothing. The selector was corrected from `Preview Set on/off` to `Preview Set indicator`, but the test was **not rerun after that one-line correction**.
- Earlier focused suites reported passing for Behavior commands/WebMCP, auth, project persistence, validation, catalog runtime, parts providers, visual overlays, and TypeScript. A fresh complete verification is still mandatory because agents subsequently edited shared files.

## Known unfinished audit findings

These must be resolved before calling the release complete:

1. **Behavior aggregate byte limits (P2).** `packages/behavior/src/schemas.ts` limits node count and individual strings, but not aggregate key/string bytes. A single accepted payload can still be extremely large. Add separate aggregate plan/dispatch byte or code-unit budgets in the iterative JSON validator. In `packages/behavior/src/session.ts`, track cumulative retained history bytes with a hard lifetime cap that seek/reset cannot regain. Add repeated-large-payload and rewind regressions.

2. **Caller-controlled `__proto__` component IDs (P2).** `prepare.ts` builds `componentProfiles`/`profileVersions` with `{}` plus indexed assignment, and `session.ts` builds `projected` the same way. An imported component ID of `__proto__` can mutate the accumulator prototype and disappear. Use null-prototype dictionaries or `Object.defineProperty` for every caller-keyed accumulator; defensively fix the similar profile metadata clone. Add a prepare/open/snapshot regression with component ID `__proto__`.

3. **Inspector control truth test.** Rerun `inspector-behavior-controls.test.tsx`, fix any real failure, and ensure pre-preview actions are disabled and rejected invocations visibly revert.

4. **Monaco source conflict recoverability (P2).** Optimistic source conflicts keep a stale baseline and the UI has no explicit recovery. Preserve both local and newer durable files, expose review/download paths for both, and provide explicit actions to reload the newer source or rebase/save the local draft using the exact current hash. Never overwrite automatically. Add a conflict/rebase regression.

5. **Session rehydration gate audit (potential P1).** The interrupted Luna agent edited `frontend/src/store/persistenceGate.ts`, `projectPersistence.ts`, `useProjectStore.ts`, `App.tsx`, and WebMCP command gating. Inspect its shared edits. Confirm duplicate same-room session events do not microtask-spin while hydration is slow; use an event/subscription waiter rather than polling. Verify UI/store mutations fail closed during hydration, Behavior Plan writes and preview preparation revalidate the captured room across awaits, and an async shopping lookup started in room A cannot publish into room B. Run the relevant auth/project/WebMCP tests.

6. **Final independent audit.** The Sol audit agent was interrupted at this checkpoint and has not issued a final no-P1/P2 verdict. Resume an independent iterative audit after the fixes above, apply every confirmed P1/P2 fix, then obtain a clean verdict.

## Immediate continuation order

1. Inspect `git status --short`, `git diff --check`, and the shared persistence-gate edits. Do not discard anything.
2. Rerun the Inspector and shopping focused tests plus frontend typecheck.
3. Implement aggregate Behavior byte/lifetime caps and `__proto__`-safe accumulators with package regressions.
4. Finish and test the session hydration gate across duplicate events and room switches.
5. Implement Monaco conflict recovery and tests.
6. Ask an independent Sol agent for iterative architecture/security/UX truth audit; keep fixing until it reports no remaining P1/P2 issues.
7. Run `pnpm run verify` from the repository root and `git diff --check` after the tree freezes.
8. Update `docs/BEHAVIOR_PREVIEW_IMPLEMENTATION_AUDIT.md`, `docs/TYPESCRIPT_WEB_SIMULATION_HANDOFF.md`, README, architecture, and Site progress docs with the final evidence and honest limitations.
9. Commit all intended changes, push `main`, verify the remote SHA, comment on and close GitHub issue #1.
10. Publish the existing Site rather than creating a duplicate. Split/push the `chatgpt-site` subtree, package it with the bundled Sites packaging script, save the version against the exact subtree commit, deploy according to existing access mode, and poll deployment status to completion.

## Verification commands

```bash
pnpm --filter @schematic/frontend typecheck
pnpm --filter @schematic/frontend test -- --run src/__tests__/inspector-behavior-controls.test.tsx src/__tests__/webmcp-shopping-boundary.test.ts src/__tests__/room-scoped-ui-stores.test.ts
pnpm --filter @schematic/behavior test
pnpm run verify
git diff --check
```

## Product truth that must remain explicit

The preview demonstrates the requested typed behavior. It does not execute, compile, emulate, or verify the displayed firmware; it does not verify physical wiring or hardware behavior. Source remains an editable/exportable artifact for later SDK or hardware work. Compilation/upload must not be reintroduced into this release direction.
