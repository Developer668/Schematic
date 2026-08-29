# ChatGPT Site release and operations runbook

This runbook is for the production ChatGPT Site project and the canonical live
URL:

<https://schematic-hardware-workspace.decipherer71.chatgpt.site>

The release unit is the `chatgpt-site` package plus the shared `frontend`,
`packages/*`, `functions/api/_runtime.ts`, and checked-in C/WASM artifact. The
Site is the primary product path; the standalone Vite/FastAPI and native-engine
paths are reference-only.

## 1. Prepare a release

From the repository root:

```bash
node --version                 # must be v22.13.0 or newer for the Site
pnpm --version                 # pnpm 9 or newer
git status --short
git rev-parse HEAD
```

Before publishing, configure `SCHEMATIC_SESSION_SECRET` in the Site's
server-side environment. It must be a strong random value of at least 32
characters. Generate a value outside the repository, for example with
`openssl rand -base64 48`, and place it only in the platform's secret
configuration. Never commit it, paste it into a ticket, put it in a `VITE_*`
variable, or print it in a build log. The safe template is
[`chatgpt-site/.env.example`](../chatgpt-site/.env.example).

Keep `SCHEMATIC_AUTH_MODE=chatgpt-sites` and platform identity verification
enabled. Local development mode is for a local process only and is not an
acceptable production fallback.

## 2. Install, build, and check

Use the lockfiles and verify the checked-in browser artifact before every
publish:

```bash
pnpm run install:clean
pnpm run verify
git diff --check
```

The Site build verifies the release WASM and metadata; it does not rebuild the
portable C module. If the portable C source or harness header changes, rebuild
deliberately with:

```bash
pnpm --filter @schematic/firmware-harness build:wasm:required
pnpm --filter @schematic/firmware-harness verify:wasm
```

Review the resulting artifact metadata and hash as release inputs. Do not
publish a build that has silently replaced the artifact, omitted its metadata,
or reports an arbitrary firmware compile as successful.

## 3. Publish

1. Confirm the full gate above is green and record the source revision with the
   Site release notes.
2. Push that exact revision to the Site project's source repository, package
   the Site build, and save a new version in project
   `appgprj_6a913ce4a58881918a47ea49fa0ca505`.
3. Deploy the saved version without changing the canonical URL. Record the
   source commit and Site version; never record source credentials, secrets, or
   session tokens.
4. Run production acceptance in the ChatGPT in-app browser, not only against a
   local server or compatibility shim. Open public access only after the same
   version passes the private acceptance run.

If the Site editor cannot publish the intended revision, stop at the build
gate and investigate the editor/project state. Do not switch the hosted Site
to local development auth or a different API origin to bypass a failed check.

## 4. Roll back safely

Use the last known-good Site version when the owner console exposes version
selection:

1. Stop publishing new revisions and identify the last accepted source/build
   revision.
2. Restore that Site version through the Sites version controls.
3. Re-run the live health, auth, WebMCP, persistence, and button→LED checks.
4. Record what was rolled back and why, without recording secrets or session
   tokens.

If a prior Site version cannot be restored directly, check out the last
known-good source revision in a separate working directory, rerun the entire
release gate, and publish it as a new revision. Never roll back by deleting
`SCHEMATIC_SESSION_SECRET`, disabling identity verification, or pointing the
Site at an unreviewed API origin.

## 5. Production acceptance

Perform this checklist after each publish. A failed or host-dependent check is
an acceptance failure until it is recorded and resolved.

| Check                                            | Expected result                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthenticated `/studio`, `/parts`, `/settings` | Redirects to ChatGPT sign-in.                                                                                                                                                       |
| Authenticated `/api/auth/session`                | Returns `authenticated: true`, a short-lived session, and the ChatGPT Site environment. Never expose the token in logs.                                                             |
| `GET /api/health`                                | HTTP 200 with `api_boundary: "same-origin"`.                                                                                                                                        |
| `GET /api/docs`                                  | HTTP 200 JSON describing the Site API routes and limitations.                                                                                                                       |
| Native WebMCP discovery                          | In the ChatGPT in-app browser, the native surface lists exactly 42 tools. A polyfill or `window.__schematicTools` is not evidence of native discovery.                              |
| Graph mutation                                   | Native tools search/add a board, button, and LED, inspect ports, connect typed endpoints, and return structured results.                                                            |
| Exact C/WASM run                                 | Pressed and released `simulation.run` results report `executionEngine: "c-wasm"`, contract `button-led`, ABI `2`, a 64-hex-character artifact hash, and LED `true`/`false` outputs. |
| Unsupported source                               | A sketch outside the exact contract returns an explicit unsupported result/API list; no fake binary or silent success.                                                              |
| Compile boundary                                 | Site `firmware.compile` returns source/target preflight or unavailable; it does not claim arbitrary binary compilation.                                                             |
| Save/reload                                      | `project.save` followed by reload or project switch preserves the graph, connections, and firmware in the verified-user browser-local room.                                         |
| Parts boundary                                   | First `shopping.search` returns bounded no-key candidates and/or a strict `schematic.parts.lookup.v1` handoff; `shopping.get_state` exposes pending handoff/discovery while results/cart stay empty. A second call publishes only after trusted WebMCP auth and canonical, recent, HTTPS listing validation; there is no purchase or checkout action. |
| Engine boundary                                  | Behavioral runtime is reported only where its model contract applies; native compiler/simulator paths are unavailable or unsupported on the Site.                                   |
| Transport boundary                               | Raw WebSocket is unavailable on the Site; browser runtime or same-origin HTTP simulation remains usable.                                                                            |

## 6. Incident triage

- **Session is unauthenticated:** check the Site identity headers and the
  server-side secret configuration. Do not accept caller-provided user IDs.
- **Every tool is rejected:** verify the Site is authenticated and that the
  in-app browser exposes native `modelContext`; distinguish host absence from
  an application registration error.
- **WASM run is unavailable:** inspect the returned artifact/hash error and run
  `verify:wasm`. Do not silently switch the claim to arbitrary C/C++ execution.
- **Run returns interpreter/unsupported:** inspect the source grammar and
  catalog model contract. This is expected for code outside the narrow
  button→LED contract or for unmodeled devices.
- **Project appears missing:** confirm the same verified user and browser
  storage context. Browser-local persistence is not a cross-device backup.
- **Parts appear without agent provenance:** treat as a release blocker; the
  UI must not synthesize listings or retailer links. Public discovery candidates
  are never verified listings, and publication failures should surface their
  structured code (`AUTH_REQUIRED`, `STALE_PUBLICATION`,
  `NON_HTTPS_OFFER`, or `NON_CANONICAL_CATALOG_ID`).

See [CHATGPT_SITE_PROGRESS.md](CHATGPT_SITE_PROGRESS.md) for the concise current
checklist, [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the timed judge flow, and
[ARCHITECTURE.md](../ARCHITECTURE.md) for the production/reference boundary.
