import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { Check, CircuitBoard, Trash2 } from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";
import ComponentVisualOverlay from "./ComponentVisualOverlay.tsx";
import DestructiveConfirmButton from "../DestructiveConfirmButton.tsx";
import { getCatalogComponent } from "../../data/hardware.ts";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useBehaviorPreviewStore } from "../../behavior/useBehaviorPreviewStore.ts";

export interface HardwareNodeData {
  label: string;
  definitionId: string;
  instanceId: string;
  ports: { id: string; domain: string; direction: string }[];
  thumbnail?: string;
  [key: string]: unknown;
}

const domainColor: Record<string, string> = {
  power: "#ef4444",
  power_output: "#f97316",
  ground: "#73737d",
  gpio: "#22c55e",
  i2c: "#3b82f6",
  spi: "#8b5cf6",
  uart: "#f59e0b",
  pwm: "#ec4899",
  adc: "#06b6d4",
  analog: "#06b6d4",
  rf: "#f97316",
};

function Pin({ port, side, index, total }: { port: HardwareNodeData["ports"][number]; side: "left" | "right"; index: number; total: number }) {
  const color = domainColor[port.domain] ?? "#71717a";
  const position = side === "left" ? Position.Left : Position.Right;
  const top = `${((index + 1) / (total + 1)) * 100}%`;
  return (
    <div className={`hardware-pin hardware-pin-${side}`} style={{ top }} title={`${port.id} · ${port.domain} · ${port.direction}`}>
      {port.direction === "output" || port.direction === "bidirectional" || port.direction === "power"
        ? <Handle type="source" position={position} id={port.id} style={{ background: color, borderColor: "hsl(var(--background))" }} />
        : null}
      {port.direction === "input" || port.direction === "bidirectional" || port.direction === "power"
        ? <Handle type="target" position={position} id={port.id} style={{ background: color, borderColor: "hsl(var(--background))" }} />
        : null}
      <span className="hardware-pin-label"><b style={{ background: color }} />{port.id}</span>
    </div>
  );
}

export default function HardwareNode({ id, data, selected }: NodeProps & { data: HardwareNodeData }) {
  const def = getCatalogComponent(data.definitionId);
  const leftPorts = data.ports.filter((_, index) => index % 2 === 0);
  const rightPorts = data.ports.filter((_, index) => index % 2 === 1);
  const rows = Math.max(leftPorts.length, rightPorts.length, 4);
  const compact = data.ports.length <= 4 && ["passive", "analog", "logic"].includes(def?.category ?? "");
  const display = ["display", "displays"].includes(def?.category ?? "");
  const projection = useBehaviorPreviewStore((state) => state.snapshot?.components[data.instanceId]);
  const dispatchEvent = useBehaviorPreviewStore((state) => state.dispatchEvent);
  const invokeAction = useBehaviorPreviewStore((state) => state.invokeAction);
  const visualHeight = compact ? 108 : display ? Math.max(138, rows * 22 + 20) : Math.min(320, Math.max(142, rows * 22 + 30));

  return (
    <div className={`hardware-node ${compact ? "is-compact-part" : ""} ${display ? "is-display-part" : ""} ${selected ? "is-selected" : ""}`} style={{ fontFamily: "Inter, sans-serif" }}>
      <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
        <div className="node-toolbar">
          <span>{data.label}</span>
          <DestructiveConfirmButton
            targetKey={id}
            onConfirm={() => useProjectStore.getState().removeComponent(id)}
            className="node-toolbar-delete"
            onPointerDown={(event) => event.stopPropagation()}
            aria-label={`Delete ${data.label} (${id})`}
            confirmAriaLabel={`Confirm delete ${data.label} (${id})`}
            title={`Arm deletion of ${data.label} (${id}); attached wires and targeted editable source documents are also affected`}
            confirmTitle={`Click again to delete ${data.label} (${id}); attached wires and targeted editable source documents will be removed`}
            confirmChildren={<><Check size={13} /><span className="sr-only">Confirm delete</span></>}
          ><Trash2 size={13} /></DestructiveConfirmButton>
        </div>
      </NodeToolbar>

      <div className="hardware-node-identity">
        {def?.category === "board"
          ? <span className="hardware-node-kind"><CircuitBoard size={11} /></span>
          : <span className="hardware-node-glyph">{(def?.category ?? "part").slice(0, 2).toUpperCase()}</span>}
        <span className="min-w-0"><strong>{data.label}</strong><small>{data.definitionId} · {data.ports.length} pins</small></span>
      </div>

      <div className="hardware-part-stage" style={{ height: visualHeight }}>
        <div className="hardware-part-selection" />
        <div className="hardware-part-shadow" />
        <ComponentArtwork definition={def} className="hardware-part-artwork" />
        <ComponentVisualOverlay
          componentId={data.instanceId}
          projection={projection}
          onAction={(actionId, payload) => {
            void invokeAction({
              componentId: data.instanceId,
              definitionId: data.definitionId,
              actionId,
              payload,
            });
          }}
          onEvent={(eventId, payload) => {
            void dispatchEvent({ componentId: data.instanceId, definitionId: data.definitionId, eventId, payload });
          }}
        />
        {leftPorts.map((port, index) => <Pin key={`left-${port.id}`} port={port} side="left" index={index} total={leftPorts.length} />)}
        {rightPorts.map((port, index) => <Pin key={`right-${port.id}`} port={port} side="right" index={index} total={rightPorts.length} />)}
      </div>

      {def?.description && <div className="hardware-node-caption">{def.description}</div>}
    </div>
  );
}
