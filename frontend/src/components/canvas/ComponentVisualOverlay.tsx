import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import type { PreviewPrimitive, PreviewProjection } from "../../behavior/previewTypes.ts";

interface ComponentVisualOverlayProps {
  componentId: string;
  projection?: PreviewProjection;
  onEvent?: (eventId: string, payload?: unknown) => void;
}

function safeIndicatorColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "#71717a";
}

function Primitive({ primitive, onEvent }: { primitive: PreviewPrimitive; onEvent?: (eventId: string, payload?: unknown) => void }) {
  switch (primitive.kind) {
    case "indicator": {
      const intensity = Math.max(0, Math.min(1, primitive.intensity));
      return <span className={`component-visual-indicator ${primitive.on ? "is-on" : ""}`} style={{ "--indicator-color": safeIndicatorColor(primitive.color), "--indicator-intensity": intensity } as CSSProperties} aria-hidden="true" />;
    }
    case "button": {
      const click = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const pressed = !primitive.pressed;
        onEvent?.(pressed ? "button.pressed" : "button.released", { pressed });
      };
      const stopPointer = (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation();
      return <button type="button" className={`component-visual-button nodrag nopan ${primitive.pressed ? "is-pressed" : ""}`} onPointerDown={stopPointer} onClick={click} aria-label={primitive.pressed ? "Preview button pressed; release" : "Preview button; press"}>{primitive.pressed ? "PRESSED" : "PRESS"}</button>;
    }
    case "switch":
      return <span className="component-visual-switch" aria-hidden="true"><span>{primitive.position}</span><i /></span>;
    case "text-display":
      return <span className="component-visual-display" aria-hidden="true">{primitive.lines.slice(0, 4).map((line, index) => <span key={`${index}:${line}`}>{line || " "}</span>)}</span>;
    case "numeric-readout":
      return <span className="component-visual-number" aria-hidden="true"><b>{primitive.value}</b>{primitive.unit && <small>{primitive.unit}</small>}</span>;
    case "rotation":
      return <span className="component-visual-rotation" style={{ "--rotation": `${primitive.degrees}deg` } as CSSProperties} aria-hidden="true"><i /></span>;
    case "activity":
      return <span className={`component-visual-activity is-${primitive.state}`} aria-hidden="true"><i />{primitive.state}</span>;
  }
}

/** Render shared profile projections above static artwork, with no definition-specific branches. */
export default function ComponentVisualOverlay({ componentId, projection, onEvent }: ComponentVisualOverlayProps) {
  if (!projection || projection.primitives.length === 0) return null;
  return (
    <div className="component-visual-overlay" data-component-id={componentId} aria-label={projection.accessibleSummary} aria-live="polite">
      <span className="sr-only">{projection.accessibleSummary}</span>
      <div className="component-visual-primitives">
        {projection.primitives.map((primitive, index) => <Primitive key={`${index}:${primitive.key}`} primitive={primitive} onEvent={onEvent} />)}
      </div>
    </div>
  );
}
