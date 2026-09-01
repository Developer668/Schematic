import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { getCatalogComponent } from "../../data/catalog.ts";
import { useEffect, useMemo, useRef } from "react";
import { useState } from "react";
import { Check, X, Trash2, Play, Zap, Info } from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";
import DestructiveConfirmButton from "../DestructiveConfirmButton.tsx";
import { capabilitiesForCatalogComponent } from "../../behavior/capabilities.ts";
import { useBehaviorPreviewStore } from "../../behavior/useBehaviorPreviewStore.ts";
import type { BehaviorActionDescriptor, BehaviorEventDescriptor, ComponentActionCapability, ComponentEventCapability } from "@schematic/behavior";
import type { PreviewProjection } from "../../behavior/previewTypes.ts";

function literalPayload(value: unknown) {
  return { kind: "literal", value };
}

function defaultPayload(action: BehaviorActionDescriptor, value: string | number | boolean): Record<string, unknown> {
  if (action.id === "button.setPressed") return { pressed: Boolean(value) };
  if (action.id === "indicator.set") return { on: Boolean(value) };
  if (action.id === "indicator.setBrightness") return { intensity: Number(value) };
  if (action.id === "relay.set") return { on: Boolean(value) };
  if (action.id === "servo.setAngle") return { degrees: Number(value) };
  if (action.id === "motor.setSpeed") return { rpm: Number(value) };
  if (action.id === "buzzer.start") return { frequencyHz: Number(value) };
  if (action.id === "display.showText") return { text: String(value) };
  if (action.id === "sensor.setReading") return { value: Number(value) };
  return {};
}

function eventPayload(event: BehaviorEventDescriptor, value: string | number | boolean) {
  if (event.id === "button.pressed") return { pressed: true };
  if (event.id === "button.released") return { pressed: false };
  if (event.id === "sensor.changed") return { value: Number(value) };
  return {};
}

function projectedControlValue(actionId: string, projection: PreviewProjection | undefined): string | number | boolean | undefined {
  const primitives = projection?.primitives ?? [];
  const indicator = primitives.find((primitive) => primitive.kind === "indicator");
  const button = primitives.find((primitive) => primitive.kind === "button");
  const relay = primitives.find((primitive) => primitive.kind === "switch");
  const display = primitives.find((primitive) => primitive.kind === "text-display");
  const numeric = primitives.find((primitive) => primitive.kind === "numeric-readout");
  const rotation = primitives.find((primitive) => primitive.kind === "rotation");
  if (actionId === "button.setPressed" && button?.kind === "button") return button.pressed;
  if (actionId === "indicator.set" && indicator?.kind === "indicator") return indicator.on;
  if (actionId === "indicator.setBrightness" && indicator?.kind === "indicator") return indicator.intensity;
  if (actionId === "relay.set" && relay?.kind === "switch") return relay.position === "closed";
  if (actionId === "display.showText" && display?.kind === "text-display") return display.lines.join("\n");
  if (actionId === "sensor.setReading" && numeric?.kind === "numeric-readout") return numeric.value;
  if (actionId === "servo.setAngle" && rotation?.kind === "rotation") return rotation.degrees;
  return undefined;
}

function ActionControl({ componentId, definitionId, capability }: { componentId: string; definitionId: string; capability: ComponentActionCapability }) {
  const descriptor = capability.descriptor;
  const invokeAction = useBehaviorPreviewStore((state) => state.invokeAction);
  const snapshot = useBehaviorPreviewStore((state) => state.snapshot);
  const projection = snapshot?.components[componentId];
  const [value, setValue] = useState<string | number | boolean>(descriptor?.control.kind === "number" ? descriptor.control.min : descriptor?.control.kind === "text" ? "" : false);
  const valueRef = useRef(value);
  const dirtyRef = useRef(false);
  const updateValue = (next: string | number | boolean, dirty = true) => { valueRef.current = next; dirtyRef.current = dirty; setValue(next); };
  useEffect(() => {
    if (!descriptor) return;
    const projected = projectedControlValue(descriptor.id, projection);
    if (dirtyRef.current && (projected === undefined || !Object.is(projected, valueRef.current))) return;
    const next = projected ?? (descriptor.control.kind === "number" ? descriptor.control.min : descriptor.control.kind === "text" ? "" : false);
    updateValue(next, false);
  }, [componentId, descriptor, projection]);
  if (!descriptor) return null;
  const previewReady = Boolean(snapshot);
  const invoke = async (nextValue = value) => {
    const previousProjection = projectedControlValue(descriptor.id, projection);
    const result = await invokeAction({ componentId, definitionId, actionId: descriptor.id, payload: literalPayload(defaultPayload(descriptor, nextValue)) });
    const nextProjection = projectedControlValue(descriptor.id, result?.snapshot?.components[componentId]);
    const rejected = result?.status === "blocked" || result?.diagnostics?.some((diagnostic) => diagnostic.severity === "error");
    // The reducer snapshot is authoritative. Optimistic control state is
    // useful while a request is pending, but must never imply that a rejected
    // action changed the preview.
    if (nextProjection !== undefined) updateValue(nextProjection, false);
    else if (rejected) updateValue(previousProjection ?? (descriptor.control.kind === "number" ? descriptor.control.min : descriptor.control.kind === "text" ? "" : false), false);
    else dirtyRef.current = false;
  };
  const control = descriptor.control;
  return (
    <div className="behavior-action-row">
      <div className="min-w-0 flex-1"><div className="truncate font-medium">{descriptor.label}</div><div className="truncate text-[10px] text-muted-foreground" title={descriptor.description}>{descriptor.description}</div></div>
      {control.kind === "toggle" && <button type="button" disabled={!previewReady} onClick={() => { const next = !value; updateValue(next); void invoke(next); }} className="behavior-control-toggle" aria-label={`Preview ${descriptor.label}`}><span className={value ? "is-on" : ""} />{value ? "On" : "Off"}</button>}
      {control.kind === "number" && <div className="flex items-center gap-1"><input disabled={!previewReady} type="number" min={control.min} max={control.max} step={control.step} value={Number(value)} onChange={(event) => updateValue(Number(event.target.value))} className="behavior-control-input" aria-label={`${descriptor.label} value`} /><span className="text-[10px] text-muted-foreground">{control.unit ?? ""}</span><button disabled={!previewReady} type="button" onClick={() => void invoke()} className="behavior-control-trigger" aria-label={`Preview ${descriptor.label}`}><Play size={10} /></button></div>}
      {control.kind === "text" && <div className="flex items-center gap-1"><input disabled={!previewReady} type="text" maxLength={control.maxLength} value={String(value)} onChange={(event) => updateValue(event.target.value)} className="behavior-control-input behavior-control-text" aria-label={`${descriptor.label} text`} placeholder="Text" /><button disabled={!previewReady} type="button" onClick={() => void invoke()} className="behavior-control-trigger" aria-label={`Preview ${descriptor.label}`}><Play size={10} /></button></div>}
      {control.kind === "select" && <div className="flex items-center gap-1"><select disabled={!previewReady} value={JSON.stringify(value)} onChange={(event) => updateValue(JSON.parse(event.target.value))} className="behavior-control-input" aria-label={`${descriptor.label} option`}>{control.options.map((option: { value: unknown; label: string }) => <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>{option.label}</option>)}</select><button disabled={!previewReady} type="button" onClick={() => void invoke()} className="behavior-control-trigger" aria-label={`Preview ${descriptor.label}`}><Play size={10} /></button></div>}
      {control.kind === "trigger" && <button disabled={!previewReady} type="button" onClick={() => void invoke()} className="behavior-control-trigger" aria-label={`Preview ${descriptor.label}`}><Zap size={10} /> Invoke</button>}
    </div>
  );
}

function EventControl({ componentId, definitionId, capability }: { componentId: string; definitionId: string; capability: ComponentEventCapability }) {
  const descriptor = capability.descriptor;
  const dispatchEvent = useBehaviorPreviewStore((state) => state.dispatchEvent);
  const snapshot = useBehaviorPreviewStore((state) => state.snapshot);
  const projection = snapshot?.components[componentId];
  const [value, setValue] = useState<number>(0);
  const valueRef = useRef(value);
  const dirtyRef = useRef(false);
  const updateValue = (next: number, dirty = true) => { valueRef.current = next; dirtyRef.current = dirty; setValue(next); };
  useEffect(() => {
    const numeric = projection?.primitives.find((primitive) => primitive.kind === "numeric-readout");
    const projected = numeric?.kind === "numeric-readout" ? numeric.value : undefined;
    if (dirtyRef.current && (projected === undefined || !Object.is(projected, valueRef.current))) return;
    updateValue(projected ?? 0, false);
  }, [componentId, projection]);
  if (!descriptor) return null;
  const previewReady = Boolean(snapshot);
  const invoke = async () => {
    const previousProjection = projection?.primitives.find((primitive) => primitive.kind === "numeric-readout");
    const result = await dispatchEvent({ componentId, definitionId, eventId: descriptor.id, payload: eventPayload(descriptor, value) });
    const nextProjection = result?.snapshot?.components[componentId]?.primitives.find((primitive) => primitive.kind === "numeric-readout");
    const rejected = result?.status === "blocked" || result?.diagnostics?.some((diagnostic) => diagnostic.severity === "error");
    if (nextProjection?.kind === "numeric-readout") updateValue(nextProjection.value, false);
    else if (rejected) updateValue(previousProjection?.kind === "numeric-readout" ? previousProjection.value : 0, false);
    else dirtyRef.current = false;
  };
  return <div className="behavior-action-row"><div className="min-w-0 flex-1"><div className="truncate font-medium">{descriptor.label}</div><div className="truncate text-[10px] text-muted-foreground" title={descriptor.description}>{descriptor.description}</div></div><div className="flex items-center gap-1">{descriptor.id === "sensor.changed" && <input disabled={!previewReady} type="number" value={value} onChange={(event) => updateValue(Number(event.target.value))} className="behavior-control-input" aria-label="Sensor event value" />}<button disabled={!previewReady} type="button" onClick={() => void invoke()} className="behavior-control-trigger" aria-label={`Send ${descriptor.control.label}`}><Zap size={10} /> {descriptor.control.label}</button></div></div>;
}

export default function Inspector() {
  const project = useProjectStore((s) => s.project);
  const activeId = useSelectionStore((s) => s.activeComponentId);
  const previewActive = useBehaviorPreviewStore((state) => Boolean(state.snapshot));
  const active = useMemo(() => project.components.find((c) => c.id === activeId), [project.components, activeId]);
  const def = useMemo(() => (active ? getCatalogComponent(active.definitionId) : null), [active]);
  const behavior = useMemo(() => (active ? capabilitiesForCatalogComponent(active) : null), [active]);
  const previewMapped = Boolean(def?.behavior && behavior?.profile?.profileId !== "catalog-only");
  const previewClasses = previewMapped
    ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900"
    : "bg-muted text-muted-foreground border-border";

  if (!active || !def) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        <div className="font-medium mb-1 text-foreground text-xs">Inspector</div>
        <div className="text-xs leading-snug">Select a component on the canvas.</div>
        <div className="mt-3 p-2 rounded border border-border bg-muted/30 text-xs">
          <div className="font-mono">{project.name}</div>
          <div className="text-muted-foreground">{project.components.length} comps · {project.connections.length} wires</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 overflow-auto text-xs">
      <div className="inspector-hero">
        <ComponentArtwork definition={def} className="inspector-artwork" />
        <div className="min-w-0">
          <div className="text-xs font-semibold leading-tight">{def.title}</div>
          <div className="text-[11px] text-muted-foreground truncate">{def.manufacturer ?? ""} {def.id}</div>
          <div className="text-[11px] text-muted-foreground capitalize">{def.category} · {def.ports.length} pins</div>
        </div>
        <DestructiveConfirmButton
          targetKey={active.id}
          onConfirm={() => useProjectStore.getState().removeComponent(active.id)}
          className="inspector-delete"
          aria-label={`Delete ${def.title}`}
          confirmAriaLabel={`Confirm delete ${def.title} (${active.id}); attached wires and targeted editable source documents will also be removed`}
          title={`Arm deletion of ${def.title} (${active.id}); attached wires and targeted editable source documents are also affected`}
          confirmTitle={`Click again to delete ${def.title} (${active.id}); attached wires and targeted editable source documents will be removed`}
          confirmChildren={<><Check size={14} /><span className="sr-only">Confirm delete</span></>}
        ><Trash2 size={14} /></DestructiveConfirmButton>
      </div>

      <div>
        <div className="text-xs font-medium mb-1">Ports</div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40"><tr><th className="text-left px-2 py-1 font-medium">Port</th><th className="text-left px-2 py-1 font-medium">Domain</th><th className="text-left px-2 py-1 font-medium">Dir</th></tr></thead>
            <tbody className="divide-y divide-border">
              {def.ports.map((p) => (
                <tr key={p.id}><td className="px-2 py-1 font-mono">{p.id}</td><td className="px-2 py-1"><span className="px-1 py-0 rounded bg-muted border border-border text-[11px]">{p.domain}</span></td><td className="px-2 py-1 text-muted-foreground">{p.direction}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-2 rounded border border-border bg-muted/20">
        <div className="font-medium mb-1.5 text-xs">Preview coverage</div>
        <ul className="space-y-1 text-xs">
          <li className={`flex items-center gap-1.5 px-2 py-1 rounded border ${previewClasses}`}>
            {previewMapped ? <Check size={11} /> : <X size={11} />} Typed outcome preview {previewMapped ? "mapped" : "not mapped"}
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted text-muted-foreground"><Check size={11} /> Typed graph validation</li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted text-muted-foreground"><Check size={11} /> Editable source and external export</li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted text-muted-foreground"><X size={11} /> Physical hardware validation</li>
        </ul>
      </div>

      <div className="p-2 rounded border border-border bg-muted/20">
        <div className="font-medium mb-1.5 text-xs">Behavior Profile</div>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Profile</span><span className={`px-1.5 py-0.5 rounded border font-mono ${previewClasses}`}>{behavior?.profile ? `${behavior.profile.profileId}:v${behavior.profile.profileVersion}` : "catalog-only:v1"}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Actions</span><span className="font-mono">{behavior?.actions.length ?? 0}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Events</span><span className="font-mono">{behavior?.events.length ?? 0}</span></div>
          <div className="pt-1 text-muted-foreground leading-snug">Checked-in typed actions update the visual outcome. Editable source is not read or executed.</div>
        </div>
      </div>

      <section className="p-2 rounded border border-border bg-muted/20" aria-labelledby="behavior-actions-title">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div id="behavior-actions-title" className="font-medium text-xs">Events and actions</div>
          {behavior?.profile && <span className="font-mono text-[9px] text-muted-foreground">{behavior.profile.profileId}:v{behavior.profile.profileVersion}</span>}
        </div>
        <p className="mb-2 text-[10px] leading-snug text-muted-foreground">{previewActive ? "Typed controls update the Behavior Preview only. They do not call firmware or arbitrary component functions." : "Start Behavior Preview to enable typed events and actions. No firmware or arbitrary component functions run."}</p>
        {behavior?.limitations.map((limitation) => <div key={limitation} className="mb-1.5 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200"><Info size={11} className="mt-0.5 shrink-0" /> <span>{limitation}</span></div>)}
        {behavior && behavior.events.length > 0 && <div className="mb-2"><div className="kicker mb-1 !text-[9px]">Events</div><div className="space-y-1">{behavior.events.map((capability) => <EventControl key={`${active.id}:${capability.eventId}`} componentId={active.id} definitionId={active.definitionId} capability={capability} />)}</div></div>}
        {behavior && behavior.actions.length > 0 && <div><div className="kicker mb-1 !text-[9px]">Actions</div><div className="space-y-1">{behavior.actions.map((capability) => <ActionControl key={`${active.id}:${capability.actionId}`} componentId={active.id} definitionId={active.definitionId} capability={capability} />)}</div></div>}
        {behavior && behavior.events.length === 0 && behavior.actions.length === 0 && behavior.limitations.length === 0 && <div className="text-[10px] text-muted-foreground">No typed preview controls are registered for this component.</div>}
      </section>

      <div>
        <div className="font-medium mb-1">Properties</div>
        <pre className="text-[11px] bg-muted p-2 rounded border border-border overflow-auto font-mono">{JSON.stringify(active.properties, null, 2) || "{}"}</pre>
        <div className="text-[11px] text-muted-foreground mt-1 font-mono truncate">{active.id}</div>
      </div>
    </div>
  );
}
