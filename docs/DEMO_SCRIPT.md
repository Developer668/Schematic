# Judge demo: agent-built interactive calculator

Target: the published ChatGPT Site at
[schematic-hardware-workspace.decipherer71.chatgpt.site](https://schematic-hardware-workspace.decipherer71.chatgpt.site)

This demo proves one focused story: a ChatGPT agent can move from intent to a visible, editable hardware design, demonstrate its declared behavior, repair it with the same shared workspace history, and prepare source without pretending that browser checks equal physical hardware verification.

Use the native WebMCP surface in the ChatGPT in-app browser. A local compatibility bridge is useful for tests but is not native-host evidence.

## 0:00–0:20: show the agent-native surface

Ask the agent to inspect the current Schematic tool surface.

Expected evidence:

- native discovery exposes exactly **56 tools**;
- `workspace.get_tool_surface` returns a smaller state-aware recommendation set;
- the full registry includes proposal/preview/apply/discard, undo/redo, calculator key interaction, project verification, Browser Check, and the primitive graph tools;
- no `firmware.compile` or `simulation.*` tool is registered.

The point is not the raw tool count. The point is that the model can use a small relevant surface while the complete semantic hardware API remains available.

## 0:20–0:45: propose before mutating

Start from an empty project and ask:

> Build me a basic calculator with an Arduino, keypad, and LCD. Show me the design before changing my project.

The agent should call `design.propose`, then `design.preview`.

Show that the preview contains:

- one Arduino Uno;
- one membrane keypad;
- one I2C LCD;
- the reviewed typed wiring plan; and
- validation diagnostics.

Nothing on the active canvas should change yet.

Optionally demonstrate the safety boundary by trying `design.apply` with the wrong confirmation ID. It must reject the mutation. Then approve the exact proposal ID.

## 0:45–1:10: apply the complete hardware design

Call `design.apply` with the exact `proposalId`.

Expected active project:

- **3 components**;
- **12 typed connections**;
- saved Behavior Plan `calculator-interaction-v1`;
- generated starter source for the programmable board, clearly marked as scaffold rather than finished firmware; and
- Browser Check/preflight evidence for that scaffold without compilation or physical-hardware claims.

Briefly show the canvas. The design should be visually inspectable and editable by the human immediately after the agent creates it.

## 1:10–1:45: make the calculator actually respond

Call `behavior.preview` for `calculator-interaction-v1`.

Then call `behavior.press_key` four times:

```text
7
+
5
=
```

Expected visible result:

- membrane keypad projection records the typed keys;
- the deterministic keypad calculator reducer computes the result;
- `keypad.displayChanged` is emitted as a typed component event;
- the saved Behavior Plan routes that event payload into `display.showText`; and
- the LCD projection displays **12**.

Call `behavior.get_state` if useful and show the accepted `keypad.keyPressed` / `keypad.displayChanged` evidence plus the final LCD/keypad projections.

Explain the boundary precisely: this is genuine in-app typed behavior through Schematic's Behavior System. It is not a fake scripted LCD text replacement. It also does not prove that real physical hardware is wired correctly or that target firmware compiles.

## 1:45–2:10: show shared repair with undo/redo

Disconnect one existing wire using its exact connection ID.

Show the graph now has 11 connections. Then call `design.undo` and confirm the exact prior 12-connection project is restored. Call `design.redo` to reapply the break, then `design.undo` once more to restore the working design.

This demonstrates that agent edits participate in an explicit shared design history rather than becoming irreversible hidden mutations.

## 2:10–2:30: show compact state and verification

Call `workspace.get_state` and `workspace.get_tool_surface`.

The default state response should remain compact. Detailed history belongs in `workspace.get_activity` or specialist tools rather than a giant every-detail state dump.

Call `design.verify` or `project.verify`.

Expected truth before authored firmware replaces the scaffold:

- graph validation is reported explicitly;
- calculator behavior is ready/interactable;
- source is identified as generated starter source, not completed project firmware;
- Browser Check/preflight status is separate;
- compilation is `not-performed`; and
- physical hardware is `not-verified`.

## 2:30–2:50: replace the scaffold and run Browser Check

Write project-specific Arduino source through `code.write`. `expectedContentSha256: null` may replace only Schematic's exact marked generated starter scaffold. Any real existing source requires its exact current hash.

Then call `firmware.check`.

Browser Check may execute its documented bounded Arduino/C/C++ subset in the browser. Show the returned source hash, outputs/events/serial data if applicable, unsupported constructs or warnings, and the explicit claims:

```text
sourceCodeCompiled = false
electricalBehaviorSimulated = false
uploadedToHardware = false
physicalHardwareVerified = false
```

If the code uses an unsupported construct, the correct outcome is partial/unavailable with diagnostics, not guessed success.

## 2:50–3:00: close on the product story

Summarize what the judge just saw:

- The user kept the same ChatGPT context and moved directly into a shared hardware workspace.
- The agent proposed before mutating, then built exact semantic hardware rather than clicking pixels.
- The finished in-app calculator was interactively testable through typed keypad and LCD behavior.
- Human and agent shared the same editable graph and undo/redo history.
- The model received a small state-aware tool surface instead of needing to reason over every tool at once.
- Source was editable and browser-checkable without misleading compiler or physical-hardware claims.

Do not claim that a real Arduino was flashed, that the browser performed target compilation, that electrical behavior was simulated, or that physical wiring was verified. Those remain external acceptance steps.

## Live acceptance before recording the demo

Before using this script for judges, verify the published revision in the ChatGPT in-app browser:

1. Native tool discovery is 56.
2. Proposal preview does not mutate.
3. Exact approval applies 3 components and 12 connections.
4. `7 + 5 =` visibly produces `12` through the Behavior Preview path.
5. Undo/redo restores the graph correctly.
6. Default workspace state is compact and the state-aware tool surface is useful.
7. Browser Check behaves honestly for supported and unsupported source.
8. `/api/compile` and `/api/simulation/*` remain retired.
9. Auth, persistence, project isolation, and shopping provenance still pass their release checks.

If any of those fail on the published Site, do not substitute a local test or old deployment as evidence.
