import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection as FlowConnection,
  type Edge,
  type Node,
  BackgroundVariant,
  type ReactFlowInstance,
  type MiniMapNodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import HardwareNode from "./HardwareNode.tsx";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { getCatalogComponent } from "../../data/hardware.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { useWorkspaceStore } from "../../store/useWorkspaceStore.ts";
import { Maximize2, Grid3X3, EyeOff, Map, AlertCircle } from "lucide-react";
import { componentArtworkHref } from "../../data/componentArtwork.ts";

const nodeTypes = { hardware: HardwareNode };

function ArtworkMiniMapNode({ id, x, y, width, height, selected }: MiniMapNodeProps) {
  const component = useProjectStore((state) => state.project.components.find((item) => item.id === id));
  const definition = getCatalogComponent(component?.definitionId);
  const artwork = componentArtworkHref(definition);
  const inset = Math.max(2, Math.min(width, height) * 0.08);
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={Math.min(10, height * 0.12)} fill="hsl(var(--card))" stroke={selected ? "hsl(var(--accent))" : "hsl(var(--border))"} strokeWidth={selected ? 2 : 1} />
      {artwork && <image href={artwork} x={x + inset} y={y + inset} width={Math.max(1, width - inset * 2)} height={Math.max(1, height - inset * 2)} preserveAspectRatio="xMidYMid meet" />}
    </g>
  );
}

function projectToFlow(project: ReturnType<typeof useProjectStore.getState>["project"]) {
  const nodes: Node[] = project.components.map((c) => {
    const def = getCatalogComponent(c.definitionId);
    return {
      id: c.id,
      type: "hardware",
      position: c.position,
      data: {
        label: def?.title ?? c.definitionId,
        definitionId: c.definitionId,
        instanceId: c.id,
        thumbnail: def?.thumbnail,
        ports: (def?.ports ?? []).map((p) => ({ id: p.id, domain: p.domain, direction: p.direction })),
      },
    };
  });
  const edges: Edge[] = project.connections.map((conn) => ({
    id: conn.id,
    source: conn.source.componentId,
    sourceHandle: conn.source.portId,
    target: conn.target.componentId,
    targetHandle: conn.target.portId,
    label: conn.domain,
    style: {
      stroke: conn.domain === "i2c" ? "#3b82f6" : conn.domain === "power" ? "#ef4444" : conn.domain === "ground" ? "#9ca3af" : conn.domain === "spi" ? "#8b5cf6" : conn.domain === "uart" ? "#f59e0b" : conn.domain === "pwm" ? "#ec4899" : conn.domain === "adc" ? "#06b6d4" : "#22c55e",
      strokeWidth: conn.domain === "i2c" ? 2.6 : 2,
    },
    labelStyle: { fill: "hsl(var(--foreground))", fontSize: 10, fontWeight: 600 } as any,
    labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.92 } as any,
    labelBgPadding: [4, 2] as any,
    labelBgBorderRadius: 4 as any,
    animated: false,
    type: "smoothstep",
  }));
  return { nodes, edges };
}

export default function HardwareCanvas() {
  const project = useProjectStore((s) => s.project);
  const connectPorts = useProjectStore((s) => s.connectPorts);
  const moveComponent = useProjectStore((s) => s.moveComponent);
  const showGrid = useWorkspaceStore((state) => state.showGrid);
  const setShowGrid = useWorkspaceStore((state) => state.setShowGrid);
  const snapToGrid = useWorkspaceStore((state) => state.snapToGrid);
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => projectToFlow(project), [project]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ html: string; title: string; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);

  useEffect(() => {
    if (!initialNodes.length) return;
    const timer = window.setTimeout(() => flowRef.current?.fitView({ padding: 0.16, maxZoom: 1 }), 120);
    return () => window.clearTimeout(timer);
  }, [project.id, initialNodes.length]);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: FlowConnection) => {
      if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return;
      try {
        const connection = connectPorts({ componentId: params.source, portId: params.sourceHandle }, { componentId: params.target, portId: params.targetHandle });
        setEdges((eds) =>
          addEdge(
            {
              ...params,
              id: connection.id,
              source: connection.source.componentId,
              sourceHandle: connection.source.portId,
              target: connection.target.componentId,
              targetHandle: connection.target.portId,
              label: connection.domain,
              type: "smoothstep",
            } as Edge,
            eds,
          ),
        );
      } catch (e) {
        const msg = (e as Error).message;
        setConnectionError(`Wire failed: ${msg}`);
        window.setTimeout(() => setConnectionError(null), 2600);
      }
    },
    [connectPorts, setEdges],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      useSelectionStore.getState().setActive(node.id);
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    useSelectionStore.getState().clear();
  }, []);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    for (const node of deleted) useProjectStore.getState().removeComponent(node.id);
    useSelectionStore.getState().clear();
  }, []);

  // Drag & drop from left palette — image/board preview in world
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
    // Try to get component id from drag data
    const compId = e.dataTransfer.getData("application/x-schematic-component");
    if (compId) {
      const def = getCatalogComponent(compId);
      if (def) {
        setDragPreview({ html: def.thumbnail ?? "", title: def.title, x: e.clientX, y: e.clientY });
      }
    } else {
      // mouse move preview fallback
      setDragPreview((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDraggingOver(false);
    setDragPreview(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      setDragPreview(null);
      const compId = e.dataTransfer.getData("application/x-schematic-component");
      if (!compId) return;
      const position = flowRef.current?.screenToFlowPosition(
        { x: e.clientX, y: e.clientY },
        { snapToGrid, snapGrid: [16, 16] },
      );
      if (!position) return;
      useProjectStore.getState().addComponent(compId, { x: position.x - 84, y: position.y - 32 });
    },
    [snapToGrid],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragPreview) {
      setDragPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : null));
    }
  }, [dragPreview]);

  return (
    <div
      ref={canvasRef}
      className="w-full h-full relative overflow-hidden bg-background world-grid"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseMove={handleMouseMove}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodesDelete={onNodesDelete}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        onInit={(instance) => { flowRef.current = instance; }}
        onNodeDragStop={(_, node) => moveComponent(node.id, node.position)}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1.2 }}
        snapToGrid={snapToGrid}
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ type: "smoothstep" }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
        className="!bg-transparent"
        connectionLineStyle={{ stroke: "hsl(var(--primary))", strokeWidth: 2.5, strokeDasharray: "6 4" }}
        elevateEdgesOnSelect
        selectNodesOnDrag={false}
        nodesFocusable
        edgesFocusable
        autoPanOnNodeFocus
        ariaLabelConfig={{
          "minimap.ariaLabel": "Hardware workspace overview",
          "controls.ariaLabel": "Canvas view controls",
        }}
      >
        {/* Optional drafting grid uses lines only. */}
        {showGrid && <Background variant={BackgroundVariant.Lines} gap={24} size={0.65} color="hsl(var(--border))" style={{ opacity: 0.46 }} />}

        <Controls
          position="bottom-left"
          style={{ left: 8, bottom: 8, display: "flex", flexDirection: "column", gap: 4 } as any}
          showZoom
          showFitView
          showInteractive={false}
        />

        {showMap && <MiniMap
          position="top-right"
          pannable
          zoomable
          style={
            {
              top: 8,
              right: 8,
              width: 124,
              height: 76,
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              overflow: "hidden",
            } as any
          }
          maskColor="hsl(var(--background) / 0.6)"
          nodeComponent={ArtworkMiniMapNode}
        />}

        <div className="absolute top-2 left-2 right-[144px] flex items-center gap-1 pointer-events-none">
          <div className="flex items-center gap-1 pointer-events-auto bg-card border border-border rounded px-1.5 py-1">
            <button
              type="button"
              onClick={() => setShowGrid(!showGrid)}
              className={`workspace-icon-button ${showGrid ? "is-active" : ""}`}
              aria-pressed={showGrid}
              title={showGrid ? "Hide grid" : "Show grid"}
            >
              {showGrid ? <Grid3X3 size={12} /> : <EyeOff size={12} />}
            </button>
            <button type="button" onClick={() => setShowMap((value) => !value)} className={`workspace-icon-button ${showMap ? "is-active" : ""}`} aria-pressed={showMap} title="Toggle overview map"><Map size={12} /></button>
            <span className="text-[11px] font-mono text-muted-foreground pr-1 hidden sm:inline">
              {nodes.length} · {edges.length}
            </span>
          </div>
          {isDraggingOver && (
            <div className="ml-auto bg-card border border-border text-xs px-2 py-1 rounded pointer-events-auto">
              Drop to place
            </div>
          )}
        </div>
      </ReactFlow>

      {dragPreview && (
        <div className="drag-preview" style={{ left: dragPreview.x, top: dragPreview.y }}>
          <div className="w-[180px] bg-card border border-border rounded">
            <div className="p-2 flex gap-2 items-center">
              <div className="w-10 h-10 rounded border border-border bg-background flex items-center justify-center overflow-hidden shrink-0 [&>svg]:w-full [&>svg]:h-full">
                {dragPreview.html ? <div dangerouslySetInnerHTML={{ __html: dragPreview.html }} className="w-full h-full" /> : <Maximize2 size={14} className="text-muted-foreground" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{dragPreview.title}</div>
                <div className="text-[11px] text-muted-foreground">Drop on canvas</div>
              </div>
            </div>
          </div>
        </div>
      )}
      {connectionError && <div className="canvas-error" role="alert"><AlertCircle size={13} />{connectionError}</div>}
    </div>
  );
}
