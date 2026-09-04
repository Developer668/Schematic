# Schematic WebMCP tools

Status: current default registry (repository reconciled 2026-09-03)

The default registry is assembled by [`frontend/src/webmcp/tools.ts`](../../frontend/src/webmcp/tools.ts), which spreads the shared Behavior/Code tools from [`frontend/src/webmcp/behaviorTools.ts`](../../frontend/src/webmcp/behaviorTools.ts) and the reviewed collaboration tools from [`frontend/src/webmcp/designTools.ts`](../../frontend/src/webmcp/designTools.ts).

`WEBMCP_TOOL_COUNT = tools.length` is the source of truth. The current registry contains exactly **56 tools**:

```text
11 project + 5 workspace + 5 component + 3 connection + 3 firmware
+ 6 behavior + 3 code + 2 validation + 10 shopping + 8 design = 56
```

The browser attempts native registration through `document.modelContext` with a compatibility fallback for older host surfaces. The ChatGPT in-app browser is the acceptance host. `window.__schematicTools` and `navigator.modelContextTesting` are local/test compatibility surfaces and are not proof of native discovery.

There is no `firmware.compile` registration and no `simulation.*` registration. The canonical ChatGPT Site must keep `/api/compile` and `/api/simulation/*` retired. `firmware.write` and `firmware.read` are compatibility aliases for editable code documents. `firmware.check` is the separate bounded Browser Check: it can execute the documented Arduino/C/C++ subset and static preflight in the browser, but it is not compilation, electrical simulation, upload, or physical verification.

## Result and trust contract

- `RO`: read-only tool, declared with `readOnlyHint: true`.
- `M`: may mutate browser-local project/workspace state.
- `U`: handles untrusted provider/agent content using `untrustedContentHint: true`.
- Behavior Preview is driven only by typed Behavior Plans and checked-in profiles. It never reads or executes board source.
- Browser Check is separate from Behavior Preview and reports explicit execution, compilation, simulation, upload, and physical-hardware claims.
- Generated starter Behavior Plans and marked starter firmware are scaffolds. They do not count as completed project-specific behavior or firmware.
- Destructive graph/project operations require exact confirmation IDs where documented.
- Code writes use exact-hash optimistic concurrency. `expectedContentSha256: null` creates source and may replace only Schematic's marked generated starter scaffold. Authored source requires its exact current hash.

## Inventory

### Project, 11

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `project.get_graph` | RO | Read the active hardware graph and bounded source metadata. Source contents are excluded; use `code.read`. |
| `project.verify` | RO | Return the unified readiness report for graph, Behavior Plan, editable source, Browser Check, preflight, compilation boundary, and physical-hardware boundary. |
| `project.list` | RO | List browser-local projects and the active project. |
| `project.create` | M | Create and activate a new empty project. |
| `project.switch` | M | Switch the active project. |
| `project.duplicate` | M | Duplicate a saved project and activate the copy. |
| `project.delete` | M | Delete a project after exact-ID confirmation; the final project is protected. |
| `project.save` | M | Flush the current browser-local project collection. |
| `project.clear` | M | Clear the active project after exact-ID confirmation. |
| `project.rename` | M | Rename the active project. |
| `project.apply_blueprint` | M | Create a project from a reviewed blueprint, or replace the active project only with explicit confirmation. |

### Workspace, 5

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `workspace.get_state` | RO | Return a compact state summary designed to stay small enough for agent use. |
| `workspace.get_activity` | RO | Read bounded paginated WebMCP activity. |
| `workspace.get_tool_surface` | RO | Return the small state-aware shortlist of tools relevant to the current project stage. |
| `workspace.set_panel` | M | Open a bottom workspace panel. |
| `workspace.set_right_width` | M | Resize the right inspector/code panel. |

### Components, 5

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `component.search` | RO | Search the canonical component catalog and return exact preview binding metadata. |
| `component.inspect` | RO | Inspect one catalog definition, ports, metadata, and Behavior binding. |
| `component.add` | M | Add a component, keep generated fallback artifacts synchronized, and record an undoable design mutation. |
| `component.remove` | M | Remove a component after exact-ID confirmation and refresh dependent generated artifacts. |
| `component.list_ports` | RO | List exact ports for an instance or catalog definition. |

### Connections, 3

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `connection.connect` | M | Connect two exact component ports with typed validation and structured repair errors. |
| `connection.disconnect` | M | Remove a connection after exact-ID confirmation. |
| `connection.get_connections` | RO | Read all current connections. |

### Firmware compatibility / Browser Check, 3

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `firmware.write` | M | Compatibility alias for `code.write`. |
| `firmware.read` | RO | Compatibility alias for `code.read`. |
| `firmware.check` | RO | Run bounded Browser Check for one programmable board. It may execute the supported Arduino/C/C++ subset and reports unsupported constructs explicitly. It never claims compilation, electrical simulation, upload, or physical verification. |

### Behavior, 6

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `behavior.get_capabilities` | RO | Read exact typed actions/events declared by checked-in behavior profiles for current component instances. |
| `behavior.plan.write` | M | Validate and persist a versioned Behavior Plan using revision preconditions. |
| `behavior.preview` | M | Prepare and open a deterministic typed Behavior Preview session. Source code is not read or executed. |
| `behavior.invoke` | M | Dispatch one validated event, input, or typed action into the active preview session. |
| `behavior.press_key` | M | Press one calculator key on a membrane-keypad instance through the exact `keypad.press` action. |
| `behavior.get_state` | RO | Read compact or full Behavior Preview state with bounded log/event pagination. |

### Code, 3

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `code.write` | M | Create or replace editable multi-file board source with exact-hash concurrency and safe generated-starter replacement. |
| `code.read` | RO | Read editable source, hashes, revision, origin, and Behavior Plan link state. |
| `code.export` | M | Record and return an external source handoff manifest with hashes and graph diagnostics. |

Supported code-language metadata is `arduino | micropython | espidf | c | cpp | python`. Browser Check execution is currently limited to its documented Arduino/C/C++ subset; other languages remain editable/exportable and are reported as unavailable for Browser Check execution.

### Validation, 2

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `validation.check` | RO | Run static graph-rule validation. This is not compilation or physical wiring verification. |
| `validation.explain_error` | RO | Explain a known graph validation code with repair guidance. |

### Shopping, 10

Every shopping tool treats provider/retailer content as untrusted data. Public or Bright Data discovery candidates are sourcing evidence only and never become cart listings automatically.

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `shopping.search` | M,U | Run bounded discovery when listings are omitted, or publish trusted agent-reviewed canonical listings when strict publication data is supplied. |
| `shopping.get_state` | RO,U | Read discovery, handoff, accepted results, cart, budget, and quote state. |
| `shopping.cart_add` | M,U | Add an accepted exact-match result to the cart. |
| `shopping.cart_remove` | M,U | Remove a cart line. |
| `shopping.cart_set_quantity` | M,U | Set or clear a cart quantity. |
| `shopping.cart_set_budget` | M,U | Set or clear the target USD budget. |
| `shopping.cart_undo` | M,U | Undo the last cart change. |
| `shopping.cart_reset` | M,U | Rebuild cart lines from required canonical catalog IDs that have accepted results. |
| `shopping.choose_alternative` | M,U | Replace a cart result with an already-published compatible alternative. |
| `shopping.quote` | RO,U | Calculate totals from accepted priced offers and report missing prices/budget overage. |

Bright Data discovery may provide current shopping candidates when configured server-side. A candidate can omit an exact manufacturer part number if the provider did not establish one; Schematic must not infer the missing identity from the user's query. Exact canonical publication still requires reviewed identity, current direct HTTPS retailer data, and recent provenance.

### Design and collaboration, 8

| Tool | Mode | Purpose |
| --- | :---: | --- |
| `design.propose` | M | Stage a non-mutating reviewed goal-level proposal. The current reviewed template is the interactive calculator. |
| `design.preview` | RO | Preview a staged proposal and graph diagnostics without mutating the active project. |
| `design.apply` | M | Apply a proposal only after exact proposal-ID approval; the transaction rolls back on failure. |
| `design.discard` | M | Discard a staged proposal without changing the project. |
| `design.undo` | M | Restore the exact snapshot before the latest recorded agent design mutation. |
| `design.redo` | M | Reapply the latest undone agent design mutation. |
| `design.verify` | RO | Return a compact goal-level readiness summary, including calculator interactivity and honest external boundaries. |
| `design.auto_layout` | M | Apply the shared collision-aware grid layout and record it as undoable. |

## Reviewed calculator journey

The release demo for the goal-level design surface is:

1. Start with an empty project.
2. `design.propose` a basic calculator.
3. `design.preview` the staged Arduino Uno + membrane keypad + I2C LCD design.
4. Approve using the exact `proposalId` in `design.apply`.
5. Confirm three components and twelve typed wires are present.
6. Start `behavior.preview` for `calculator-interaction-v1`.
7. Call `behavior.press_key` for `7`, `+`, `5`, `=`.
8. Confirm the LCD projection displays `12` and the keypad projection records `=`.
9. Make a graph edit and demonstrate `design.undo` / `design.redo`.
10. Read `workspace.get_tool_surface` and `design.verify`.
11. Replace the marked starter source with project-specific firmware, run `firmware.check`, then verify again.

The calculator's preview path is a real typed Behavior System flow: `keypad.press` updates deterministic keypad calculator state, emits `keypad.displayChanged`, and the saved Behavior Plan routes that value to `display.showText`. This demonstrates the declared in-app behavior. It still does not prove that physical hardware is wired correctly, that target firmware compiles, or that a real board produces the same outcome.

## Hashes and persistence

The Behavior/Code workflow uses canonical hashes including `planSha256`, `projectSha256`, `registrySha256`, `contentSha256`, `sessionLogSha256`, and `snapshotSha256` where applicable. Hashes identify exact data/revisions and support concurrency/auditability; they are not correctness or physical-hardware proofs.

Behavior Plans and code documents are durable project data. Preview sessions, reducers, timers, and snapshots are ephemeral and are recreated against the current graph.

## Release acceptance

From the repository root:

```bash
pnpm run verify
```

Before publishing, the release agent must also confirm `git diff --check`, the intended Git revision, and the canonical Site project. After publishing, native acceptance in the ChatGPT in-app browser must verify:

1. Native discovery exposes exactly 56 tools.
2. The state-aware tool surface works and the full registry contains no `firmware.compile` or `simulation.*` names.
3. The reviewed calculator journey produces `12` through the live Behavior Preview path.
4. `workspace.get_state` remains compact and detailed state is available through paginated specialist tools.
5. Proposal approval/discard and shared design undo/redo behave correctly.
6. `firmware.check` reports Browser Check execution honestly and keeps compilation, electrical simulation, upload, and physical verification false.
7. `/api/compile` and `/api/simulation/*` remain retired on the canonical Site.
8. Auth, browser-local persistence, project isolation, and shopping trust boundaries behave as documented.

Local tests and compatibility bridges do not prove that a revision is published or that the host discovered the native tools.
