# ChatGPT Site release and operations runbook

Status: release procedure; publication must be verified by the release agent.

Canonical Site URL:
[schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site)

Sites project ID: `appgprj_6a913ce4a58881918a47ea49fa0ca505`

Hosting configuration:
[`chatgpt-site/.openai/hosting.json`](../chatgpt-site/.openai/hosting.json)

The release unit is the `chatgpt-site` wrapper plus its shared frontend,
`packages/*` dependencies, and same-origin API route. The product path is typed
Behavior Preview plus editable code and a separate bounded Browser Check.
Behavior Preview never reads or executes source. Browser Check can execute its
documented Arduino/C/C++ subset and static preflight, but it does not compile,
electrically simulate, upload, flash, or physically verify hardware. The
standalone Vite/FastAPI app and legacy runtime/toolchain packages are development
or historical boundaries, not evidence of Site capability.

## 1. Prepare a release

From the repository root:

```bash
node --version                 # v22.13.0 or newer
pnpm --version                 # pnpm 9 or newer
git status --short
git rev-parse HEAD
```

Keep `SCHEMATIC_SESSION_SECRET` server-only, random, and at least 32 characters.
Generate it outside the repository, for example:

```bash
openssl rand -base64 48
```

Set `SCHEMATIC_AUTH_MODE=chatgpt-sites` and retain platform identity
verification. Never commit the secret, put it in `VITE_*`, print it in logs,
or use local development auth in a hosted Site. See
[`chatgpt-site/.env.example`](../chatgpt-site/.env.example).

## 2. Install, check, and build

Use the lockfiles and inspect the exact source revision before publishing:

```bash
pnpm run install:clean
git diff --check
pnpm --filter @schematic/frontend typecheck
pnpm --filter @schematic/frontend test -- --run
pnpm run verify:behavior-preview
npm --prefix chatgpt-site run verify
```

The static behavior release gate is safe to run in CI: it checks the
`@schematic/behavior` dependency boundary, active Site import closure, exact
catalog bindings, 56-tool registration, active client/server import boundaries,
forbidden endpoint references, truthful Behavior Preview and Browser Check
claims, and initial bundle boundaries. It does not make live HTTP requests;
live retired-route 404 checks are separate.

Build the Site explicitly when publishing:

```bash
npm --prefix chatgpt-site run build
```

The build creates the Site artifact and runs the checked-in asset verification.
Do not infer publication from a local build. Record the commit and build
metadata that the release agent actually submits.

## 3. Publish the canonical project

1. Confirm the source revision, focused checks, Site verification, and
   `git diff --check` are green.
2. Push the reviewed commit to the repository according to the repository
   owner's normal GitHub process.
3. In the Sites publishing flow, select project
   `appgprj_6a913ce4a58881918a47ea49fa0ca505` and publish the intended Site
   build. Keep the canonical URL unchanged.
4. Record the deployed revision/version without recording secrets or bearer
   tokens.
5. Perform the acceptance checklist below in the ChatGPT in-app browser. A
   local polyfill, local preview, or build artifact is not proof of native host
   behavior.

This repository documentation intentionally does not assert that the latest
commit is live. Publication status, deployed version, and native WebMCP
discovery must be verified by the release agent after publishing.

## 4. Roll back safely

If a previously accepted Site version is available in the owner console:

1. Stop publishing new revisions and identify the last accepted commit/version.
2. Restore that Site version through the Sites controls.
3. Repeat live health, auth, WebMCP, persistence, Behavior Preview, and code
   handoff checks.
4. Record the rollback reason and restored revision, never credentials or
   session tokens.

If version restore is unavailable, prepare the last known-good source in a
separate worktree, run the complete release gate, and publish it as a new
version. Do not disable identity verification, delete the session secret, or
point the Site at an unreviewed origin.

## 5. Production acceptance

Run every check against the published URL in the ChatGPT in-app browser.

| Check | Expected result |
| --- | --- |
| Unauthenticated `/studio`, `/parts`, `/settings` | Redirects to ChatGPT sign-in. |
| Authenticated `/api/auth/session` | Returns an authenticated short-lived Schematic session; bearer tokens never appear in logs. |
| `GET /api/health` | HTTP 200 with `api_boundary: "same-origin"`. |
| `GET /api/docs` | HTTP 200 JSON listing health, catalog, import, parts, and identity limits. |
| Native WebMCP discovery | The ChatGPT host exposes exactly 56 registered tools. Local shims are not evidence of native discovery. |
| Tool inventory | Six `behavior.*`, three `code.*`, eleven `project.*`, five `workspace.*`, eight `design.*`, and the remaining component/connection/firmware/validation/shopping tools are present; `firmware.write/read` are compatibility aliases; `firmware.compile` and all `simulation.*` names are absent. |
| Graph workflow | Search/add a board, button, and LED; inspect ports; connect valid endpoints; return structured errors for invalid wiring. |
| Behavior workflow | Discover capabilities, write a button→LED Behavior Plan, preview it, invoke `button.pressed`, and observe the LED visual projection. |
| Preview truth | Result says scripted/typed preview; `sourceCodeExecuted`, `sourceCodeCompiled`, `hardwareUploaded`, and physical-verification claims remain false. |
| Code workflow | Write ordinary editable source, read it back, edit it in Monaco, run `firmware.check`, and export the handoff manifest. Browser Check may execute only its bounded documented subset; it is not compilation or physical verification. |
| Conflict/staleness | A wrong expected content hash preserves existing code; manual code edits or plan/graph changes make an old link stale. |
| Save/reload | Plans and code documents survive reload in the same verified-user browser room; the preview session and snapshot are recreated, not persisted. |
| Project isolation | Switching projects cannot leak plans, code documents, or preview snapshots between projects. |
| Retired API paths | `/api/compile`, `/api/simulation/state`, `/api/simulation/step`, and `/api/simulation/ws` return 404. |
| Capability probes | `/capabilities` reports browser-local probe results; it does not imply source build or hardware support. |
| Parts boundary | Public discovery remains untrusted; only a trusted, current, canonical listing publication can enter shopping state. No purchase or checkout action exists. |

## 6. Evidence to record

For each accepted publication, keep a release note containing:

- Git commit, Site project ID, deployed Site version, and verification timestamp;
- native WebMCP discovery count and host context;
- `planSha256`, `projectSha256`, `registrySha256`, `sessionLogSha256`, and
  `snapshotSha256` from the Behavior Preview fixture where available;
- code document `contentSha256`, per-file hashes, and exported manifest hash;
- the exact Behavior Preview claims showing no source execution and the separate
  Browser Check claims showing whether bounded browser execution occurred while
  compilation/upload/physical-verification remain false; and
- the result of the retired-route 404 checks.

Hashes identify the data and provenance of a run. They are not correctness
proofs and do not mean that source compiles or hardware works.

## 7. Incident triage

- **Unauthenticated session:** inspect Site identity headers and server-only
  secret configuration. Never accept a caller-supplied user ID.
- **Native tools unavailable:** distinguish host absence from registration
  failure. A compatibility bridge can help local tests but cannot satisfy native
  acceptance.
- **Plan blocked:** inspect exact component IDs, profile versions, event/action
  IDs, payload diagnostics, and current graph hash. Unsupported actions must
  remain explicit; do not guess a profile.
- **Preview appears stale:** compare plan/project/registry hashes and recreate
  the session after a graph, plan, or project change. Code-only edits should not
  alter the preview snapshot.
- **Code write conflict:** re-read the document and retry with the current
  `contentSha256`; never force an overwrite without an explicit user decision.
- **Project appears missing:** confirm the same verified identity and browser
  storage context. Local persistence is not a cloud backup.
- **Retired endpoint responds:** treat it as a release blocker. The Site route
  must return 404 for compile and legacy runtime paths.
- **Shopping data appears verified without provenance:** treat it as a release
  blocker. Discovery candidates are never cart listings.

See [ARCHITECTURE.md](../ARCHITECTURE.md),
[TYPESCRIPT_WEB_SIMULATION_HANDOFF.md](TYPESCRIPT_WEB_SIMULATION_HANDOFF.md),
[DEMO_SCRIPT.md](DEMO_SCRIPT.md), and
[CHATGPT_SITE_PROGRESS.md](CHATGPT_SITE_PROGRESS.md) for the architecture,
agent handoff, timed flow, and current release checklist.
