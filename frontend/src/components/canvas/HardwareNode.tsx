import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { CircuitBoard, Trash2 } from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";
import { catalog } from "../../data/catalog.ts";
import { useProjectStore } from "../../store/useProjectStore.ts";

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
      <Handle type="source" position={position} id={port.id} style={{ background: color, borderColor: "hsl(var(--background))" }} />
      <Handle type="target" position={position} id={port.id} style={{ background: color, borderColor: "hsl(var(--background))" }} />
      <span className="hardware-pin-label"><i style={{ background: color }} />{port.id}</span>
    </div>
  );
}

export default function HardwareNode({ id, data, selected }: NodeProps & { data: HardwareNodeData }) {
  const def = catalog.find((definition) => definition.id === data.definitionId);
  const leftPorts = data.ports.filter((_, index) => index % 2 === 0);
  const rightPorts = data.ports.filter((_, index) => index % 2 === 1);
  const rows = Math.max(leftPorts.length, rightPorts.length, 4);
  const visualHeight = Math.min(320, Math.max(142, rows * 22 + 30));

  return (
    <div className={`hardware-node ${selected ? "is-selected" : ""}`} style={{ fontFamily: "Inter, sans-serif" }}>
      <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
        <div className="node-toolbar">
          <span>{data.label}</span>
          <button type="button" className="node-toolbar-delete" onClick={(event) => { event.stopPropagation(); useProjectStore.getState().removeComponent(id); }} aria-label={`Delete ${data.label}`} title="Delete component (Delete)"><Trash2 size={13} /></button>
        </div>
      </NodeToolbar>

      <div className="hardware-node-identity">
        <span className="hardware-node-kind">{def?.category === "board" ? <CircuitBoard size={11} /> : <span className="hardware-node-status" />}</span>
        <span className="min-w-0"><strong>{data.label}</strong><small>{data.definitionId} · {data.ports.length} pins</small></span>
      </div>

      <div className="hardware-part-stage" style={{ height: visualHeight }}>
        <div className="hardware-part-selection" />
        <div className="hardware-part-shadow" />
        <ComponentArtwork definition={def} className="hardware-part-artwork" />
        {leftPorts.map((port, index) => <Pin key={`left-${port.id}`} port={port} side="left" index={index} total={leftPorts.length} />)}
        {rightPorts.map((port, index) => <Pin key={`right-${port.id}`} port={port} side="right" index={index} total={rightPorts.length} />)}
      </div>

      {def?.description && <div className="hardware-node-caption">{def.description}</div>}
    </div>
  );
}
