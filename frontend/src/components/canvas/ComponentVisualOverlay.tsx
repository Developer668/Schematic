import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import type { PreviewPrimitive, PreviewProjection } from "../../behavior/previewTypes.ts";

interface ComponentVisualOverlayProps {
  componentId: string;
  projection?: PreviewProjection;
  onEvent?: (eventId: string, payload?: unknown) => void;
  /** Invoke one action declared by the component's exact Behavior Profile. */
  onAction?: (actionId: string, payload: { kind: "literal"; value: unknown }) => void;
}

type LiteralActionPayload = { kind: "literal"; value: unknown };

interface VisualAction {
  actionId: string;
  payload: LiteralActionPayload;
  label: string;
}

function safeIndicatorColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "#71717a";
}

function actionForPrimitive(primitive: PreviewPrimitive): VisualAction | undefined {
  switch (primitive.kind) {
    case "indicator":
      return { actionId: "indicator.set", payload: { kind: "literal", value: { on: !primitive.on } }, label: primitive.on ? "Turn indicator off" : "Turn indicator on" };
    case "switch":
      if (primitive.key !== "relay") return undefined;
      return { actionId: "relay.set", payload: { kind: "literal", value: { on: primitive.position !== "closed" } }, label: primitive.position === "closed" ? "Open relay" : "Close relay" };
    case "text-display":
      if (primitive.key !== "display") return undefined;
      return { actionId: "display.clear", payload: { kind: "literal", value: {} }, label: "Clear display" };
    case "numeric-readout": {
      if (primitive.key !== "sensor") return undefined;
      const value = Number.isFinite(primitive.value) ? primitive.value : 0;
      const next = value >= 1_000_000_000 ? -1_000_000_000 : value + 1;
      return { actionId: "sensor.setReading", payload: { kind: "literal", value: { value: next } }, label: "Increase sensor reading" };
    }
    case "rotation": {
      if (primitive.key !== "actuator") return undefined;
      const degrees = Number.isFinite(primitive.degrees) ? Math.max(0, Math.min(180, Math.round(primitive.degrees))) : 0;
      const next = degrees >= 180 ? 0 : Math.min(180, degrees + 45);
      return { actionId: "servo.setAngle", payload: { kind: "literal", value: { degrees: next } }, label: `Set actuator angle to ${next} degrees` };
    }
    case "activity":
      if (primitive.key === "buzzer") {
        return primitive.state === "active"
          ? { actionId: "buzzer.stop", payload: { kind: "literal", value: {} }, label: "Stop buzzer" }
          : { actionId: "buzzer.start", payload: { kind: "literal", value: { frequencyHz: 440 } }, label: "Start buzzer" };
      }
      if (primitive.key === "motor") {
        return primitive.state === "active"
          ? { actionId: "motor.stop", payload: { kind: "literal", value: {} }, label: "Stop motor" }
          : { actionId: "motor.setSpeed", payload: { kind: "literal", value: { rpm: 500 } }, label: "Start motor" };
      }
      return undefined;
    case "button":
      return { actionId: "button.setPressed", payload: { kind: "literal", value: { pressed: !primitive.pressed } }, label: primitive.pressed ? "Release preview button" : "Press preview button" };
    case "keypad":
      return undefined;
    default:
      return undefined;
  }
}

function Primitive({ primitive, onEvent, onAction }: { primitive: PreviewPrimitive; onEvent?: (eventId: string, payload?: unknown) => void; onAction?: (actionId: string, payload: LiteralActionPayload) => void }) {
  switch (primitive.kind) {
    case "indicator": {
      const intensity = Math.max(0, Math.min(1, primitive.intensity));
      const action = actionForPrimitive(primitive);
      if (!onAction || !action) return <span className={`component-visual-indicator ${primitive.on ? "is-on" : ""}`} style={{ "--indicator-color": safeIndicatorColor(primitive.color), "--indicator-intensity": intensity } as CSSProperties} aria-hidden="true" />;
      return <button type="button" className={`component-visual-indicator component-visual-control nodrag nopan ${primitive.on ? "is-on" : ""}`} style={{ "--indicator-color": safeIndicatorColor(primitive.color), "--indicator-intensity": intensity } as CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAction(action.actionId, action.payload); }} aria-label={action.label} title={action.label} />;
    }
    case "button": {
      const click = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const pressed = !primitive.pressed;
        const action = actionForPrimitive(primitive);
        if (onAction && action) onAction(action.actionId, action.payload);
        else onEvent?.(pressed ? "button.pressed" : "button.released", { pressed });
      };
      const stopPointer = (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation();
      return <button type="button" className={`component-visual-button nodrag nopan ${primitive.pressed ? "is-pressed" : ""}`} onPointerDown={stopPointer} onClick={click} aria-label={primitive.pressed ? "Preview button pressed; release" : "Preview button; press"}>{primitive.pressed ? "PRESSED" : "PRESS"}</button>;
    }
    case "switch": {
      const action = actionForPrimitive(primitive);
      const body = <><span>{primitive.position}</span><i /></>;
      if (!onAction || !action) return <span className="component-visual-switch" aria-hidden="true">{body}</span>;
      return <button type="button" className="component-visual-switch component-visual-control nodrag nopan" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAction(action.actionId, action.payload); }} aria-label={action.label} title={action.label}>{body}</button>;
    }
    case "text-display": {
      const action = actionForPrimitive(primitive);
      const body = primitive.lines.slice(0, 4).map((line, index) => <span key={`${index}:${line}`}>{line || " "}</span>);
      if (!onAction || !action) return <span className="component-visual-display" aria-hidden="true">{body}</span>;
      return <button type="button" className="component-visual-display component-visual-control nodrag nopan" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAction(action.actionId, action.payload); }} aria-label={action.label} title={action.label}>{body}</button>;
    }
    case "numeric-readout": {
      const action = actionForPrimitive(primitive);
      const body = <><b>{primitive.value}</b>{primitive.unit && <small>{primitive.unit}</small>}</>;
      if (!onAction || !action) return <span className="component-visual-number" aria-hidden="true">{body}</span>;
      return <button type="button" className="component-visual-number component-visual-control nodrag nopan" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAction(action.actionId, action.payload); }} aria-label={action.label} title={action.label}>{body}</button>;
    }
    case "rotation": {
      const action = actionForPrimitive(primitive);
      const body = <i />;
      if (!onAction || !action) return <span className="component-visual-rotation" style={{ "--rotation": `${primitive.degrees}deg` } as CSSProperties} aria-hidden="true">{body}</span>;
      const degrees = Number.isFinite(primitive.degrees) ? Math.max(0, Math.min(180, primitive.degrees)) : 0;
      return <button type="button" className="component-visual-rotation component-visual-control nodrag nopan" style={{ "--rotation": `${degrees}deg` } as CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAction(action.actionId, action.payload); }} aria-label={action.label} title={action.label}>{body}</button>;
    }
    case "activity": {
      const action = actionForPrimitive(primitive);
      const body = <><i />{primitive.state}</>;
      if (!onAction || !action) return <span className={`component-visual-activity is-${primitive.state}`} aria-hidden="true">{body}</span>;
      return <button type="button" className={`component-visual-activity component-visual-control nodrag nopan is-${primitive.state}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAction(action.actionId, action.payload); }} aria-label={action.label} title={action.label}>{body}</button>;
    }
    case "keypad": {
      const keys = primitive.keys.slice(0, 20);
      if (!onAction) return <span className="component-visual-keypad" aria-label={primitive.lastKey ? `Keypad last pressed ${primitive.lastKey}` : "Calculator keypad ready"}>{keys.join(" ")}</span>;
      return (
        <span className="component-visual-keypad nodrag nopan" role="group" aria-label={primitive.lastKey ? `Calculator keypad; last pressed ${primitive.lastKey}` : "Calculator keypad"}>
          {keys.map((key) => <button
            key={key}
            type="button"
            className={`component-visual-keypad-key component-visual-control nodrag nopan ${primitive.lastKey === key ? "is-active" : ""}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onAction("keypad.press", { kind: "literal", value: { key } }); }}
            aria-label={`Press calculator key ${key}`}
            title={`Press ${key}`}
          >{key}</button>)}
        </span>
      );
    }
  }
}

/** Render shared profile projections above static artwork, with no definition-specific branches. */
export default function ComponentVisualOverlay({ componentId, projection, onEvent, onAction }: ComponentVisualOverlayProps) {
  if (!projection || projection.primitives.length === 0) return null;
  return (
    <div className="component-visual-overlay" data-component-id={componentId} aria-label={projection.accessibleSummary} aria-live="polite">
      <span className="sr-only">{projection.accessibleSummary}</span>
      <div className="component-visual-primitives">
        {projection.primitives.map((primitive, index) => <Primitive key={`${index}:${primitive.key}`} primitive={primitive} onEvent={onEvent} onAction={onAction} />)}
      </div>
    </div>
  );
}
