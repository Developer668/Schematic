# Judge demo — genuine WebMCP hardware build

Target: the published Schematic studio opened in a compatible browser with
native WebMCP enabled. The page must be visible in the same tab the agent uses.

This demo uses only the browser's Available Site Tools / WebMCP panel. Do not
type commands into the page and do not call an app-owned callback global.

## 0:00–0:30 — Prove native discovery

1. Open the studio and its WebMCP inspector.
2. Show 12 tools registered through the top-level `document.modelContext`.
3. Show that the page has no `window.__schematicTools`, no producer polyfill,
   and no fabricated `navigator.modelContextTesting`.

## 0:30–1:20 — Build Meta Glasses

Ask the browser agent:

> Use `project.apply_blueprint` with `blueprintId` `meta-glasses`. Then inspect
> the graph and auto-layout it. Do not click or type into the Schematic UI.

The visible canvas should update in the same tab. The activity panel should show
native calls for `project.apply_blueprint`, `project.get_graph`, and
`design.auto_layout`.

## 1:20–2:00 — Validate and inspect

Ask the agent to run `validation.check`, inspect the main controller with
`component.inspect`, and list its ports with `component.list_ports`. Explain any
remaining physical bring-up warnings without claiming firmware was executed.

## 2:00–2:30 — Firmware/export handoff

Ask the agent to write an editable firmware draft with `firmware.write`, then
download the handoff with `code.export`. Source authoring is not compilation or
physical-device verification.

## 2:30–3:00 — Persistence proof

1. Copy the stable `/studio/project/{id}` URL.
2. Refresh and show that the same project returns.
3. Open that URL in another browser authenticated as the same user and show the
   server-synced workspace.
4. In an unsupported browser, show the honest “WebMCP unavailable” state and
   demonstrate that manual editing still works.

Cloudflare deployments require the `SCHEMATIC_PROJECTS` KV binding. Localhost
uses the same API contract backed by SQLite.
