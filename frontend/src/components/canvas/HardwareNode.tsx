import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { CircuitBoard, Trash2 } from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";
import { catalog } from "../../data/catalog.ts";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSimulationStore } from "../../store/useSimulationStore.ts";

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
      <span className="hardware-pin-label"><b style={{ background: color }} />{port.id}</span>
    </div>
  );
}

export default function HardwareNode({ id, data, selected }: NodeProps & { data: HardwareNodeData }) {
  const def = catalog.find((definition) => definition.id === data.definitionId);
  const leftPorts = data.ports.filter((_, index) => index % 2 === 0);
  const rightPorts = data.ports.filter((_, index) => index % 2 === 1);
  const rows = Math.max(leftPorts.length, rightPorts.length, 4);
  const compact = data.ports.length <= 4 && ["passive", "analog", "logic"].includes(def?.category ?? "");
  const display = ["display", "displays"].includes(def?.category ?? "");
  const running = useSimulationStore((state) => state.running);
  const timeNs = useSimulationStore((state) => state.timeNs);
  const pinStates = useSimulationStore((state) => state.pinStates);
  const reading = (suffix: string, fallback: number) => {
    const entry = Object.entries(pinStates).find(([key]) => key.endsWith(`:${suffix}`));
    return typeof entry?.[1] === "number" ? entry[1] : fallback;
  };
  const visualHeight = compact ? 108 : display ? Math.max(138, rows * 22 + 20) : Math.min(320, Math.max(142, rows * 22 + 30));

  return (
    <div className={`hardware-node ${compact ? "is-compact-part" : ""} ${display ? "is-display-part" : ""} ${selected ? "is-selected" : ""}`} style={{ fontFamily: "Inter, sans-serif" }}>
      <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
        <div className="node-toolbar">
          <span>{data.label}</span>
          <button type="button" className="node-toolbar-delete" onClick={(event) => { event.stopPropagation(); useProjectStore.getState().removeComponent(id); }} aria-label={`Delete ${data.label}`} title="Delete component (Delete)"><Trash2 size={13} /></button>
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
        {data.definitionId === "ssd1306" && (
          <div className={`hardware-live-display ${running ? "is-running" : ""}`} aria-live="polite">
            <header><span>ENVIRONMENT</span><b>{running ? "LIVE" : "STANDBY"}</b></header>
            {running ? (
              <div className="hardware-live-readings">
                <strong>{reading("temperatureC", 0).toFixed(1)}<small>°C</small></strong>
                <span>{reading("pressureHpa", 0).toFixed(1)} hPa</span>
                <span>{reading("humidityPct", 0).toFixed(1)} %RH</span>
                <footer>FRAME {timeNs.toString()} ns</footer>
              </div>
            ) : <div className="hardware-live-standby">PRESS RUN</div>}
          </div>
        )}
        {leftPorts.map((port, index) => <Pin key={`left-${port.id}`} port={port} side="left" index={index} total={leftPorts.length} />)}
        {rightPorts.map((port, index) => <Pin key={`right-${port.id}`} port={port} side="right" index={index} total={rightPorts.length} />)}
      </div>

      {def?.description && <div className="hardware-node-caption">{def.description}</div>}
    </div>
  );
}
