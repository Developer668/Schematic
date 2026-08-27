import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { catalog } from "../../data/catalog.ts";
import { CircuitBoard, Trash2 } from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";

export interface HardwareNodeData {
  label: string;
  definitionId: string;
  ports: { id: string; domain: string; direction: string }[];
  thumbnail?: string;
  [key: string]: unknown;
}

const domainColor: Record<string, string> = {
  power: "#ef4444",
  ground: "#6b7280",
  gpio: "#22c55e",
  i2c: "#3b82f6",
  spi: "#8b5cf6",
  uart: "#f59e0b",
  pwm: "#ec4899",
  adc: "#06b6d4",
  rf: "#f97316",
  power_output: "#ef4444",
  analog: "#06b6d4",
};

export default function HardwareNode({ data, selected }: NodeProps & { data: HardwareNodeData }) {
  const leftPorts = data.ports.filter((_, i) => i % 2 === 0);
  const rightPorts = data.ports.filter((_, i) => i % 2 === 1);
  const def = catalog.find((d) => d.id === data.definitionId);
  const isBoard = def?.category === "board";

  return (
    <div
      className={`hardware-node min-w-[184px] overflow-hidden ${selected ? "is-selected" : ""}`}
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
        <div className="node-toolbar">
          <span>{data.label}</span>
          <button
            type="button"
            className="node-toolbar-delete"
            onClick={(event) => {
              event.stopPropagation();
              const id = useSelectionStore.getState().activeComponentId;
              if (id) useProjectStore.getState().removeComponent(id);
            }}
            aria-label={`Delete ${data.label}`}
            title="Delete component (Delete)"
          ><Trash2 size={13} /></button>
        </div>
      </NodeToolbar>
      <div className={`flex items-center gap-1.5 border-b border-border px-2.5 py-2 ${selected ? "bg-muted" : "bg-muted/30"}`}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium leading-tight flex items-center gap-1">
            {isBoard && <CircuitBoard size={9} className="text-muted-foreground shrink-0" />}
            {data.label}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{data.definitionId} · {data.ports.length}</div>
        </div>
        {selected && <div className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))] shrink-0" />}
      </div>

      <div className="hardware-node-visual">
        <div className="hardware-node-glow" />
        <ComponentArtwork definition={def} className="hardware-node-artwork" />
      </div>

      <div className="flex justify-between gap-2 border-t border-border bg-card px-2 py-2">
        <div className="flex-1 space-y-1">
          {leftPorts.map((p) => (
            <div key={p.id} className="flex items-center gap-1 relative">
              <Handle type="source" position={Position.Left} id={p.id} style={{ background: domainColor[p.domain] ?? "#6b7280", left: -5, borderColor: "hsl(var(--card))" }} />
              <Handle type="target" position={Position.Left} id={p.id} style={{ background: domainColor[p.domain] ?? "#6b7280", left: -5, borderColor: "hsl(var(--card))" }} />
              <span className="rounded border border-border bg-muted px-1 py-0 font-mono text-[10px] flex items-center gap-1">
                <span className="h-1 w-1 rounded-full shrink-0" style={{ background: domainColor[p.domain] ?? "#6b7280" }} />
                {p.id}
              </span>
            </div>
          ))}
        </div>
        <div className="w-px self-stretch bg-border" />
        <div className="flex-1 space-y-1 text-right">
          {rightPorts.map((p) => (
            <div key={p.id} className="relative flex items-center justify-end gap-1">
              <span className="rounded border border-border bg-muted px-1 py-0 font-mono text-[10px] flex items-center gap-1">
                {p.id}
                <span className="h-1 w-1 rounded-full shrink-0" style={{ background: domainColor[p.domain] ?? "#6b7280" }} />
              </span>
              <Handle type="source" position={Position.Right} id={p.id} style={{ background: domainColor[p.domain] ?? "#6b7280", right: -5, borderColor: "hsl(var(--card))" }} />
              <Handle type="target" position={Position.Right} id={p.id} style={{ background: domainColor[p.domain] ?? "#6b7280", right: -5, borderColor: "hsl(var(--card))" }} />
            </div>
          ))}
        </div>
      </div>

      {def?.description && (
        <div className="border-t border-border bg-muted/20 px-2 py-1 font-mono text-[10px] leading-snug text-muted-foreground line-clamp-1">
          {def.description.slice(0, 80)}
        </div>
      )}
    </div>
  );
}
