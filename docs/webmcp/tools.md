# Schematic WebMCP tools

Status: current default registry (repository checked 2026-08-31)

The single default registry is
[`frontend/src/webmcp/tools.ts`](../../frontend/src/webmcp/tools.ts). It spreads
the eight definitions in
[`frontend/src/webmcp/behaviorTools.ts`](../../frontend/src/webmcp/behaviorTools.ts)
and exports `WEBMCP_TOOL_COUNT = tools.length`. The current registry contains
exactly **45 tools**:

```text
10 project + 3 workspace + 5 component + 3 connection + 3 firmware
+ 5 behavior + 3 code + 2 validation + 10 shopping + 1 design = 45
```

The browser attempts native registration through the host's
`document.modelContext`/`navigator.modelContext`. The ChatGPT in-app browser
is the acceptance host. `window.__schematicTools` and local producer shims are
test/compatibility bridges, not proof of native discovery.

There is no `firmware.compile` registration and no `simulation.*` registration.
The corresponding canonical ChatGPT Site API paths (`/api/compile` and
`/api/simulation/*`) are retired and must return 404 there. Repository-root
compatibility handlers are excluded from the Site package. `firmware.write` and `firmware.read` remain thin
source-authoring aliases; `firmware.check` only reports editable-document
metadata with `not-performed` status and is not a build check.

## Notation and common result contract

- `RO`: the source annotation includes `readOnlyHint: true`.
- `M`: the tool may mutate browser-local project/workspace state.
- `U`: the source annotation includes `untrustedContentHint: true`; this is
  used for shopping data supplied by providers or agents.

The eight Behavior/Code tools return a JSON text block plus `data` on success.
Failures return `isError: true`, an `error` object with stable `code`, human
message, and `retryable`, and optional structured details. Other tools use the
same WebMCP/MCP-shaped `{content, data?, isError?}` envelope where applicable.
Unexpected callback failures are recorded in the WebMCP activity store and
re-raised to the host.

Every behavior result states that preview is a typed, scripted visual outcome;
it is not source execution, compilation, electrical simulation, upload, or a
physical test. Code results state `inAppVerification: "not-performed"`.

## Inventory

All inputs are JSON objects. Optional properties are marked `?`.

### Project (10)

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 1 | `project.get_graph` | `{}` | RO | Read the active graph plus bounded code/firmware metadata. Source contents, compiled artifacts, retired simulation config, and quarantined legacy data are excluded; use `code.read` for source. |
| 2 | `project.list` | `{}` | RO | List browser-local projects and the active project summary. |
| 3 | `project.create` | `{name?: string}` | M | Create and activate an empty project. |
| 4 | `project.switch` | `{projectId: string}` | M | Activate one saved project; unknown IDs fail. |
| 5 | `project.duplicate` | `{projectId?: string, name?: string}` | M | Duplicate a saved project and activate the copy. |
| 6 | `project.delete` | `{projectId: string, confirmProjectId: string}` | M | Delete a project after the confirmation id exactly matches the target; the final remaining project is protected. |
| 7 | `project.save` | `{}` | M | Flush the browser-local project collection and notify same-origin tabs. |
| 8 | `project.clear` | `{projectId: string, confirmProjectId: string}` | M | Clear the active project after both ids exactly match it; removes components, connections, and firmware. |
| 9 | `project.rename` | `{name: string}` | M | Rename the active project with unique-name handling. |
| 10 | `project.apply_blueprint` | `{blueprintId: "meta-glasses", replace?: boolean, confirmProjectId?: string}` | M | Create a new project by default; replacement requires `replace:true` plus the exact active project id. |

### Workspace (3)

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 11 | `workspace.get_state` | `{}` | RO | Read active project, selection, panel state, activity, validation, and Behavior Preview summary. |
| 12 | `workspace.set_panel` | `{panel: "webmcp" \| "terminal" \| "debug" \| "validation"}` | M | Select the bottom panel. `debug` is the Behavior Preview panel. |
| 13 | `workspace.set_right_width` | `{width: number}` (`300–720`) | M | Set the right inspector/Code panel width. |

### Components (5)

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 14 | `component.search` | `{query?: string, category?: "board" | "sensor" | "actuator" | "display" | "power" | "logic" | "communication" | "mechanical" | "rf" | "custom" | "analog" | "passive" | "", domain?: "power" | "power_output" | "ground" | "gpio" | "adc" | "pwm" | "i2c" | "spi" | "uart" | "usb" | "ethernet" | "can" | "pcie" | "csi" | "hdmi" | "displayport" | "rf" | "mechanical" | "optical" | ""}` | RO | Search the canonical catalog and return typed-preview binding metadata (`preview.mapped`, profile id/version, and optional variant). |
| 15 | `component.inspect` | `{componentId: string}` | RO | Read one catalog definition, ports, electrical data, and metadata. |
| 16 | `component.add` | `{componentId: string, x?: number, y?: number}` | M | Add a catalog component. Omit both coordinates for collision-aware placement. |
| 17 | `component.remove` | `{instanceId: string, confirmInstanceId: string}` | M | Remove an instance after the confirmation id exactly matches; attached connections and source targets are removed too. |
| 18 | `component.list_ports` | `{componentId?: string, instanceId?: string}` | RO | List ports for an instance or catalog definition. At least one ID is required. |

### Connections (3)

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 19 | `connection.connect` | Either `{sourceComponentId, sourcePortId, targetComponentId, targetPortId}` or `{source: {componentId\|instanceId, portId}, target: {componentId\|instanceId, portId}}` | M | Add a typed connection after endpoint, self-wire, duplicate, and domain checks. |
| 20 | `connection.disconnect` | `{connectionId: string, confirmConnectionId: string}` | M | Remove one existing connection after the confirmation id exactly matches. |
| 21 | `connection.get_connections` | `{}` | RO | Read all active project connections. |

### Compatibility source tools (3)

These names exist only to ease migration of clients that already call firmware
operations. They write/read editable documents and never build or execute them.

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 22 | `firmware.write` | `{componentId: string, files: File[], language?: CodeLanguage, boardFqbn?: string, expectedContentSha256: string \| null}` | M | Alias for `code.write`; saves ordinary source with mandatory optimistic concurrency. `null` is create-only; an exact prior hash replaces. |
| 23 | `firmware.read` | `{componentId: string}` | RO | Alias for `code.read`; returns source and metadata. |
| 24 | `firmware.check` | `{componentId: string}` | RO | Reports document metadata and `not-performed`; no source check is run. |

`CodeLanguage` is `arduino | micropython | espidf | c | cpp | python`.
`File` is `{name: string, content: string}`.

### Behavior (5)

Behavior Plans are data-only JSON. The command layer validates each request
against the active graph, exact catalog definition, profile version, action or
event descriptor, payload schema, and current project hash.

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 25 | `behavior.get_capabilities` | `{}` | RO | Return exact typed actions/events, profile bindings, availability, and limitations for every component. |
| 26 | `behavior.plan.write` | `{plan: BehaviorPlanV1, expectedRevision: integer \| null}` | M | Validate and persist a plan with a mandatory precondition. `null` is create-only; the exact current revision replaces; omission or a stale revision is rejected without overwriting. |
| 27 | `behavior.preview` | `{planId?: string, onUnsupported?: "block" \| "skip", durationMs?: integer}` | M | Prepare the saved plan and open a bounded, deterministic ephemeral session. |
| 28 | `behavior.invoke` | `{componentId: string, definitionId: string, eventId?: string, inputId?: string, value?: JsonValue, actionId?: string, payload?: JsonValue}` | M | Dispatch exactly one typed event, input change, or action to the active session. |
| 29 | `behavior.get_state` | `{}` | RO | Read preview status, snapshot, logical time, plan/project/registry hashes, diagnostics, timeline, and claims. |

`behavior.invoke` never mutates the durable plan and never calls arbitrary
JavaScript. `behavior.preview` and `behavior.get_state` expose `sourceCodeExecution:
"none"` and the false source/build/upload/physical-test claims.

### Code (3)

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 30 | `code.write` | `{targetComponentId: string, files: File[], language: CodeLanguage, dependencies?: Dependency[], expectedContentSha256: string \| null, origin?: Origin, boardFqbn?: string, linkToBehaviorPlan?: Link}` | M | Create or replace an editable multi-file document with mandatory exact-hash optimistic concurrency. `null` is create-only; an exact prior hash replaces. |
| 31 | `code.read` | `{targetComponentId?: string, documentId?: string}` | RO | Read source, revision, content hash, origin, link status, export history, and honesty claims. |
| 32 | `code.export` | `{targetComponentId?: string, documentId?: string}` | M | Record an export and return the external handoff manifest with file/project hashes and graph diagnostics. |

`Dependency` is `{ecosystem: "arduino-library" | "platformio" | "python-package" | "vendor-sdk" | "other", name: string, version?: string, sourceUrl?: string}`.
`Origin` is `ai-generated | human-authored | imported | mixed`.
`Link` is `{planId: string, planSha256: string, projectSha256: string}`.

Code is not preview input. Manual edits change `contentSha256`; plan or graph
changes mark a linked document `stale`. Omitting `expectedContentSha256`, or
providing `undefined`, is rejected. `null` is create-only; replacing an existing
document requires the exact `contentSha256` returned by `code.read` or
`firmware.read`. A wrong hash returns `SOURCE_CONFLICT` and preserves the
existing document.

### Validation (2)

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 33 | `validation.check` | `{}` | RO | Validate graph topology/electrical wiring and return issues. This is not source verification. |
| 34 | `validation.explain_error` | `{code: string}` | RO | Return repair guidance for a known graph validation code. |

### Shopping (10)

All shopping tools have `untrustedContentHint: true`. Provider/retailer text,
URLs, prices, and part metadata are untrusted data, never instructions.

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 35 | `shopping.search` | `{query?: string, quantity?: integer, listings?: Listing[], publication?: {provider: string, publishedAt: string}}` | M,U | Start bounded public discovery, or publish canonical listings only when a trusted agent supplies current listings and publication metadata. |
| 36 | `shopping.get_state` | `{}` | RO,U | Read discovery, pending handoff, published results, cart, budget, and quote. |
| 37 | `shopping.cart_add` | `{resultId: string, quantity?: number}` | M,U | Add an exact published result. |
| 38 | `shopping.cart_remove` | `{resultId: string}` | M,U | Remove a cart line. |
| 39 | `shopping.cart_set_quantity` | `{resultId: string, quantity: number}` | M,U | Set a cart quantity; zero removes it. |
| 40 | `shopping.cart_set_budget` | `{budget: number \| null}` | M,U | Set or clear the USD target budget. |
| 41 | `shopping.cart_undo` | `{}` | M,U | Undo the last cart change. |
| 42 | `shopping.cart_reset` | `{requiredCatalogIds?: string[]}` | M,U | Reset cart from supplied or active-project catalog IDs. |
| 43 | `shopping.choose_alternative` | `{resultId: string, catalogId: string}` | M,U | Replace a cart part with an already searched alternative. |
| 44 | `shopping.quote` | `{}` | RO,U | Calculate live-offer total and report missing prices/budget overage. |

Public discovery is not a verified listing and cannot enter the cart. A trusted
agent's publication must match canonical catalog IDs, exact part numbers,
current HTTPS offers, recent timestamps, and provider/auth metadata. There is
no purchase, checkout, or silent retailer-navigation tool.

### Design (1)

| # | Tool | Input | Mode | Purpose |
| ---: | --- | --- | :---: | --- |
| 45 | `design.auto_layout` | `{}` | M | Apply the shared collision-safe grid layout. |

## Behavior Plan example

After adding components, use their returned instance IDs and exact definition
IDs. A plan rule that turns an LED on when a button is pressed looks like:

```json
{
  "schemaVersion": 1,
  "id": "button-led-preview",
  "projectId": "<active-project-id>",
  "name": "Button turns LED on",
  "revision": 0,
  "rules": [
    {
      "id": "on-press",
      "enabled": true,
      "when": {
        "type": "component.event",
        "componentId": "<button-instance>",
        "definitionId": "pushbutton",
        "eventId": "button.pressed",
        "payload": { "pressed": true }
      },
      "then": [
        {
          "componentId": "<led-instance>",
          "definitionId": "led",
          "actionId": "indicator.set",
          "payload": { "kind": "literal", "value": { "on": true } }
        }
      ]
    }
  ]
}
```

The preview demonstrates the declared outcome. It does not assert that the
source file implements the rule or that the physical connection is correct.

## Hashes, persistence, and limits

The command layer and UI share these hashes:

- `planSha256`: canonical Behavior Plan data;
- `projectSha256`: behavior-relevant graph identity, components, and
  connections; source files and timestamps are excluded;
- `registrySha256`: exact checked-in profile registry;
- `contentSha256`: normalized code filenames and contents;
- per-file `sha256` values in exports; and
- `sessionLogSha256`/`snapshotSha256`: deterministic preview history/state.

Hashes identify content and support conflict/staleness checks. They are not
compiler, electrical, or physical correctness proofs.

Durable plans and code documents are stored in the browser-local verified-user
project room. Preview sessions, timers, reducers, and snapshots are ephemeral.
Current limits are 100 plans/project, 200 rules/plan, 20 actions/rule, 2,000
cues/plan, 100 code documents/project, 128 files/document, 1 MiB/file, 512
KiB/document, 512 KiB of editable source across one project, 256
dependencies/document, 50 export-history records, 50 projects/workspace, 8 MiB
of serialized workspace data, 600,000 ms logical preview duration, and a 10 MiB
`.vlx` import. These limits are enforced before durable writes; oversized
legacy data is not hydrated into the active project room.

## Registration and acceptance checks

From the repository root:

```bash
pnpm --filter @schematic/frontend typecheck
pnpm --filter @schematic/frontend test -- --run
pnpm run verify:behavior-preview
npm --prefix chatgpt-site run verify
```

The release agent must verify the published Site in the ChatGPT in-app browser:

1. Native discovery reports 45 tools.
2. All eight Behavior/Code tools appear and no `firmware.compile` or
   `simulation.*` name appears.
3. A button→LED plan previews and responds to `behavior.invoke`.
4. `code.write/read/export` preserve ordinary editable source and return hashes.
5. `/api/compile` and `/api/simulation/*` return 404 on the canonical Site route.
6. Auth, local persistence, project switching, and shopping trust boundaries
   behave as documented.

Local tests and compatibility bridges cannot establish publication status or
native host support. The canonical Site is
[schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site),
bound to Sites project `appgprj_6a913ce4a58881918a47ea49fa0ca505`; the release
agent must record which revision is actually live.
