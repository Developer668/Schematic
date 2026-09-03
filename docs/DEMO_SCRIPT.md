# Judge demo — Behavior Preview plus editable code

Target: the published ChatGPT Site at
[schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site)

This is a three-minute demo of the product's actual boundary. The model uses
WebMCP to build a graph, declare a Behavior Plan, preview typed outcomes, and
write ordinary source into Code. The preview is not firmware execution, and
the source is not compiled or run by Schematic.

Use the native WebMCP surface in the ChatGPT in-app browser. A local
`window.__schematicTools` bridge is useful for tests but is not native-host
evidence.

## 0:00–0:20 — Discover the contract

Ask the agent:

> Inspect the Schematic WebMCP surface. Report the count, the five behavior
> tools, the three code tools, and whether any compiler or legacy runtime tools
> are registered.

Expected result:

- exactly 45 tools;
- `behavior.get_capabilities`, `behavior.plan.write`, `behavior.preview`,
  `behavior.invoke`, and `behavior.get_state`;
- `code.write`, `code.read`, and `code.export`;
- `firmware.write`/`firmware.read` only as source compatibility aliases; and
- no `firmware.compile` or `simulation.*` registration.

The UI should show the WebMCP count and the activity panel. Native discovery
must be confirmed by the host, not inferred from a compatibility shim.

## 0:20–0:55 — Build a small graph

Use tools, not visual clicking, for the agent workflow:

1. Call `component.search` for an ESP32 or other board, `pushbutton`, and `led`.
2. Call `component.add` for one board, button, and LED. Keep the returned
   instance IDs; do not invent IDs.
3. Call `component.list_ports` for each instance.
4. Call `connection.connect` with the exact returned endpoint IDs. If the graph
   rejects a connection, show the structured repair diagnostic instead of
   claiming that the wire exists.
5. Call `validation.check` and leave graph diagnostics visible.

The graph proves catalog identity, typed topology, and validation results. It
does not prove electrical safety or that a physical board will work.

## 0:55–1:35 — Declare and preview the outcome

Call `behavior.get_capabilities` and use the exact profile IDs, definition IDs,
event IDs, and action IDs it returns. For instance IDs represented here as
`<button-instance>`, `<led-instance>`, and `<definition-id>`, write this
data-only plan:

```json
{
  "schemaVersion": 1,
  "id": "button-led-preview",
  "projectId": "<active-project-id>",
  "name": "Button turns LED on",
  "intent": "Show the requested button-to-indicator outcome",
  "revision": 0,
  "rules": [
    {
      "id": "on-press",
      "enabled": true,
      "when": {
        "type": "component.event",
        "componentId": "<button-instance>",
        "definitionId": "<button-definition-id>",
        "eventId": "button.pressed",
        "payload": { "pressed": true }
      },
      "then": [
        {
          "componentId": "<led-instance>",
          "definitionId": "<led-definition-id>",
          "actionId": "indicator.set",
          "payload": { "kind": "literal", "value": { "on": true } }
        }
      ]
    }
  ]
}
```

Call `behavior.plan.write`, then `behavior.preview` with the returned plan ID.
Call `behavior.invoke` with:

```json
{
  "componentId": "<button-instance>",
  "definitionId": "<button-definition-id>",
  "eventId": "button.pressed",
  "payload": { "pressed": true }
}
```

Call `behavior.get_state` and show the LED indicator projection, timeline, and
snapshot hash. The expected explanation is:

> Scripted preview: the declared typed action changed the visual LED state. No
> source code ran; wiring, electrical behavior, and hardware were not verified.

The same pattern can show `display.showText`, `buzzer.start`, `relay.set`,
`servo.setAngle`, `motor.setSpeed`, or `sensor.setReading` when the selected
catalog component has that exact profile. An unsupported action must fail
explicitly without changing visual state.

## 1:35–2:20 — Put normal code in the side panel

Call `code.write` for the selected board. The content can be an ordinary
multi-file Arduino/C++/Python response; it does not need to be reduced to the
preview vocabulary:

```json
{
  "targetComponentId": "<board-instance>",
  "language": "arduino",
  "files": [
    {
      "name": "sketch.ino",
      "content": "void setup() {}\nvoid loop() {}\n"
    }
  ],
  "origin": "ai-generated"
}
```

Show the Code panel opening the editable document. Call `code.read` to show
the revision, `contentSha256`, origin, preview-link status, and
`inAppVerification: "not-performed"`. Edit the file manually, save it, and
show that the source hash changes while the Behavior Preview snapshot remains
plan-driven. A linked plan/code pair becomes `stale` after either side changes;
the source is never silently overwritten.

## 2:20–2:45 — Export the external handoff

Call `code.export`. Show the JSON manifest containing:

- project and behavior-relevant graph hashes;
- target component, definition, and optional board FQBN;
- source file contents and per-file SHA-256 values;
- source hash, language, and declared dependencies;
- preview-link provenance and graph diagnostics; and
- explicit false claims for in-app build, execution, upload, and physical test.

Say:

> This is ready to carry to the user's external SDK, IDE, compiler, or board
> workflow. Schematic has not built or tested it.

## 2:45–3:00 — Close with limits

Call `project.save` if needed, then summarize:

- Behavior Plan is the source of truth for the visual outcome.
- Code is an independently editable/exportable artifact.
- Preview is deterministic typed projection, not source execution or electrical
  simulation.
- Plans and code persist in the verified user's local browser room; preview
  sessions are ephemeral.
- The product does not compile, upload, flash, or physically test in the Site.
- `/api/compile` and `/api/simulation/*` are retired and must return 404 on the canonical ChatGPT Site route.

Do not claim that a light turned on on real hardware, that generated firmware
compiles, or that the graph is electrically correct. Those are external
testing outcomes.
