# Behavior profile authoring guide

Behavior profiles are Schematic's small, trusted vocabulary for describing an
intended component outcome in the browser. They do not model firmware,
electricity, timing fidelity, or physical hardware. A profile accepts a bounded
typed action, returns deterministic state transitions, and projects that state
to generic visual primitives.

Read [ADR 001](ADR-001-BEHAVIOR-PLAN-PREVIEW.md) and the
[TypeScript handoff](TYPESCRIPT_WEB_SIMULATION_HANDOFF.md) before adding a
profile. New profiles should come from observed product demand, not an attempt
to make every catalog item appear supported.

## Contract

A profile is checked-in TypeScript implementing the public
`BehaviorProfile<State>` contract from `@schematic/behavior`. It owns:

- a stable profile ID and integer version;
- action and event descriptors with bounded payload schemas;
- strict initial-state parsing;
- pure deterministic reducers;
- a generic visual projection and accurate accessible summary.

A profile must not import React, Zustand, Monaco, WebMCP, browser globals,
network clients, compiler/emulator packages, or untrusted executable code.
Reducers must not read the wall clock, random values, the DOM, storage, or the
network. Logical time and sequence are supplied by the behavior session.

Imported Behavior Plans can reference IDs and JSON data only. They can never
provide a reducer, renderer, callback, expression, module URL, or schema
reference.

## Authoring sequence

1. Choose one reusable physical behavior, not a specific part number. Examples:
   `digital-indicator`, `text-display`, or `rotary-actuator`.
2. Define the smallest action/event vocabulary that expresses real user intent.
   Use namespaced IDs such as `indicator.set` or `button.pressed`.
3. Describe every payload with the shared bounded JSON Schema 2020-12 subset.
   Do not add a second validator in UI or tool code.
4. Set explicit numerical, text, collection, duration, and history bounds.
5. Implement a pure reducer. Return a new state; never mutate the input state or
   retain mutable data outside the reducer.
6. Project state using the shared primitives: indicator, button, switch,
   text-display, numeric-readout, rotation, and activity.
7. Write an accessible summary that communicates the same state as the visual
   projection. Bound and normalize user-provided text.
8. Register the exact profile ID and version in the immutable default registry.
9. Opt individual catalog definition IDs in with an explicit behavior binding.
   Do not infer support from names, tags, categories, descriptions, or ports.
10. Add boundary/conformance fixtures and update the explicit coverage report.

## Payload-schema rules

The supported schema keywords are deliberately limited to:

`type`, `properties`, `required`, `additionalProperties`, `items`, `enum`,
`const`, `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`,
`minItems`, and `maxItems`.

Unknown keywords, `$ref`, remote schemas, formats, dynamic loading, executable
values, non-finite numbers, class instances, maps, sets, binary objects, and
cyclic values fail closed. Prefer object payloads with
`additionalProperties: false` so future fields require an intentional version
decision.

## Catalog binding policy

Catalog support is granted only through an exact checked-in binding:

```ts
{
  profileId: "digital-indicator",
  profileVersion: 1,
  variant: "single-led"
}
```

The profile version is part of prepared-plan and registry fingerprints. Changing
behavior in a way that can change a snapshot requires a new profile version.
Never silently reinterpret an existing version. A catalog entry without a
binding resolves to `catalog-only:v1`, remains placeable, and reports why no
preview action is available.

Variants may select bounded trusted defaults or projection details. A variant
must not change action meaning, load code, or infer a different profile.

## Required conformance coverage

Every registered action needs tests proving:

- the descriptor schema itself is accepted by the shared validator;
- valid minimum, typical, and maximum payloads reach the reducer;
- wrong types, unknown fields, non-finite numbers, and out-of-range values do
  not reach the reducer;
- the reducer does not mutate its input and returns byte-identical output for
  identical state, payload, logical time, and sequence;
- the visual primitive matches the resulting state;
- the accessible summary communicates the same result and respects text bounds;
- preparation resolves the exact catalog definition/profile/version only;
- an unknown action/event/version produces a structured unsupported diagnostic;
- seek, sequential playback, and reset agree for rules/cues using the action;
- all snapshot claims continue to say no source ran and no hardware was tested.

If a reducer can emit an event, also prove that event chains stop at the global
depth/count budgets and end with an explicit diagnostic.

## Versioning and removal

- Additive descriptor changes that cannot affect existing inputs still require
  careful registry-hash review.
- Any changed payload interpretation, default, reducer result, projection, or
  accessibility output requires a new integer profile version.
- Keep migrations data-only and explicit. Do not guess which version an imported
  plan meant.
- Removing a version requires a project/import migration and a clear unsupported
  result for plans that cannot migrate safely.

## Release checklist

- [ ] Exact catalog IDs are listed and coverage counts are updated.
- [ ] No fuzzy capability inference was introduced.
- [ ] Payload, reducer, projection, accessibility, determinism, and unsupported
      cases pass through the package's public boundary.
- [ ] UI and WebMCP expose the same descriptors and return the same hashes.
- [ ] Preview history, text, time, event, and payload budgets still hold.
- [ ] Project import/export remains data-only and round-trips the profile version.
- [ ] The Site's initial bundle contains no compiler, emulator, or legacy runtime
      path because of the new profile.
- [ ] Product copy never implies that code executed, firmware compiled, hardware
      uploaded, wiring passed, or physical behavior was verified.

External SDK or hardware integrations are separate security/product decisions.
A behavior profile must never call them or turn their status into an in-app
preview claim.
