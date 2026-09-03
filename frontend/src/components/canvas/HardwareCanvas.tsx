import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type EdgeChange,
  type Node,
  type NodeChange,
  BackgroundVariant,
  type ReactFlowInstance,
  type MiniMapNodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import HardwareNode from "./HardwareNode.tsx";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { getCatalogComponent } from "../../data/hardware.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { useGraphFocusStore } from "../../store/useGraphFocusStore.ts";
import { useWorkspaceStore } from "../../store/useWorkspaceStore.ts";
import { AlertCircle, Check, Maximize2, Trash2 } from "lucide-react";
import { componentArtworkHref } from "../../data/componentArtwork.ts";
import DestructiveConfirmButton from "../DestructiveConfirmButton.tsx";

const nodeTypes = { hardware: HardwareNode };

function ArtworkMiniMapNode({ id, x, y, width, height }: MiniMapNodeProps) {
  const component = useProjectStore((state) => state.project.components.find((item) => item.id === id));
  const definition = getCatalogComponent(component?.definitionId);
  const artwork = componentArtworkHref(definition);
  const inset = Math.max(2, Math.min(width, height) * 0.08);

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={Math.min(7, height * 0.1)}
        fill="#08090d"
        stroke="none"
      />
      {artwork && (
        <image
          href={artwork}
          x={x + inset}
          y={y + inset}
          width={Math.max(1, width - inset * 2)}
          height={Math.max(1, height - inset * 2)}
          preserveAspectRatio="xMidYMid meet"
          opacity="0.9"
        />
      )}
    </g>
  );
}

function projectToFlow(project: ReturnType<typeof useProjectStore.getState>["project"]) {
  const nodes: Node[] = project.components.map((component) => {
    const definition = getCatalogComponent(component.definitionId);
    return {
      id: component.id,
      type: "hardware",
      deletable: false,
      position: component.position,
      data: {
        label: definition?.title ?? component.definitionId,
        definitionId: component.definitionId,
        instanceId: component.id,
        thumbnail: definition?.thumbnail,
        ports: (definition?.ports ?? []).map((port) => ({
          id: port.id,
          domain: port.domain,
          direction: port.direction,
        })),
      },
    };
  });

  const edges: Edge[] = project.connections.map((connection) => ({
    id: connection.id,
    source: connection.source.componentId,
    sourceHandle: connection.source.portId,
    target: connection.target.componentId,
    targetHandle: connection.target.portId,
    label: connection.domain,
    style: {
      stroke:
        connection.domain === "i2c"
          ? "#3b82f6"
          : connection.domain === "power"
            ? "#ef4444"
            : connection.domain === "ground"
              ? "#9ca3af"
              : connection.domain === "spi"
                ? "#8b5cf6"
                : connection.domain === "uart"
                  ? "#f59e0b"
                  : connection.domain === "pwm"
                    ? "#ec4899"
                    : connection.domain === "adc"
                      ? "#06b6d4"
                      : "#22c55e",
      strokeWidth: connection.domain === "i2c" ? 2.6 : 2,
    },
    labelStyle: { fill: "hsl(var(--foreground))", fontSize: 10, fontWeight: 600 } as any,
    labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.92 } as any,
    labelBgPadding: [4, 2] as any,
    labelBgBorderRadius: 4 as any,
    animated: false,
    deletable: false,
    type: "smoothstep",
  }));

  return { nodes, edges };
}

export default function HardwareCanvas() {
  const project = useProjectStore((state) => state.project);
  const connectPorts = useProjectStore((state) => state.connectPorts);
  const moveComponent = useProjectStore((state) => state.moveComponent);
  const showGrid = useWorkspaceStore((state) => state.showGrid);
  const snapToGrid = useWorkspaceStore((state) => state.snapToGrid);
  const activeConnectionId = useGraphFocusStore((state) => state.activeConnectionId);
  const setActiveConnection = useGraphFocusStore((state) => state.setActiveConnection);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const flow = projectToFlow(project);
    return {
      ...flow,
      edges: flow.edges.map<Edge>((edge) => ({
        ...edge,
        selected: edge.id === activeConnectionId,
      })),
    };
  }, [activeConnectionId, project]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ html: string; title: string; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);

  const activeConnection = useMemo(
    () => project.connections.find((connection) => connection.id === activeConnectionId) ?? null,
    [activeConnectionId, project.connections],
  );

  const onSafeNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const safeChanges = changes.filter((change) => change.type !== "remove");
      if (safeChanges.length > 0) onNodesChange(safeChanges);
    },
    [onNodesChange],
  );

  const onSafeEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const safeChanges = changes.filter((change) => change.type !== "remove");
      if (safeChanges.length > 0) onEdgesChange(safeChanges);
    },
    [onEdgesChange],
  );

  useEffect(() => {
    canvasRef.current?.querySelector(".react-flow__controls")?.removeAttribute("aria-label");
  }, []);

  useEffect(() => {
    if (!initialNodes.length) return;
    const timer = window.setTimeout(
      () => flowRef.current?.fitView({ padding: 0.16, maxZoom: 1 }),
      120,
    );
    return () => window.clearTimeout(timer);
  }, [project.id, initialNodes.length]);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  useEffect(() => {
    if (activeConnectionId && !activeConnection) setActiveConnection(null);
  }, [activeConnection, activeConnectionId, setActiveConnection]);

  const onConnect = useCallback(
    (params: FlowConnection) => {
      if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return;
      try {
        const connection = connectPorts(
          { componentId: params.source, portId: params.sourceHandle },
          { componentId: params.target, portId: params.targetHandle },
        );
        setEdges((currentEdges) =>
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
            currentEdges,
          ),
        );
      } catch (error) {
        setConnectionError(`Wire failed: ${(error as Error).message}`);
        window.setTimeout(() => setConnectionError(null), 2600);
      }
    },
    [connectPorts, setEdges],
  );

  const onNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      setActiveConnection(null);
      useSelectionStore.getState().setActive(node.id);
    },
    [setActiveConnection],
  );

  const onPaneClick = useCallback(() => {
    setActiveConnection(null);
    useSelectionStore.getState().clear();
  }, [setActiveConnection]);

  const onEdgeClick = useCallback(
    (_event: unknown, edge: Edge) => {
      setActiveConnection(edge.id);
      const connection = useProjectStore
        .getState()
        .project.connections.find((item) => item.id === edge.id);
      useSelectionStore.getState().setActive(connection?.source.componentId ?? null);
    },
    [setActiveConnection],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDraggingOver(true);
    const componentId = event.dataTransfer.getData("application/x-schematic-component");
    if (componentId) {
      const definition = getCatalogComponent(componentId);
      if (definition) {
        setDragPreview({
          html: definition.thumbnail ?? "",
          title: definition.title,
          x: event.clientX,
          y: event.clientY,
        });
      }
    } else {
      setDragPreview((current) =>
        current ? { ...current, x: event.clientX, y: event.clientY } : null,
      );
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDraggingOver(false);
    setDragPreview(null);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDraggingOver(false);
      setDragPreview(null);
      const componentId = event.dataTransfer.getData("application/x-schematic-component");
      if (!componentId) return;
      const position = flowRef.current?.screenToFlowPosition(
        { x: event.clientX, y: event.clientY },
        { snapToGrid, snapGrid: [16, 16] },
      );
      if (!position) return;
      useProjectStore
        .getState()
        .addComponent(componentId, { x: position.x - 84, y: position.y - 32 });
    },
    [snapToGrid],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!dragPreview) return;
      setDragPreview((current) =>
        current ? { ...current, x: event.clientX, y: event.clientY } : null,
      );
    },
    [dragPreview],
  );

  return (
    <div
      ref={canvasRef}
      className="hardware-canvas-redesign world-grid"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseMove={handleMouseMove}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onSafeNodesChange}
        onEdgesChange={onSafeEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        onNodeDragStop={(_event, node) => moveComponent(node.id, node.position)}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1.2 }}
        snapToGrid={snapToGrid}
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ type: "smoothstep" }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
        className="!bg-transparent"
        connectionLineStyle={{
          stroke: "hsl(var(--accent))",
          strokeWidth: 2.5,
          strokeDasharray: "6 4",
        }}
        elevateEdgesOnSelect
        selectNodesOnDrag={false}
        deleteKeyCode={null}
        nodesFocusable
        edgesFocusable
        autoPanOnNodeFocus
        ariaLabelConfig={{
          "minimap.ariaLabel": "Hardware workspace overview",
        }}
      >
        {showGrid && (
          <Background
            variant={BackgroundVariant.Lines}
            gap={24}
            size={0.65}
            color="hsl(var(--border))"
            style={{ opacity: 0.34 }}
          />
        )}

        <Controls
          position="bottom-left"
          style={{ left: 10, bottom: 10 } as any}
          showZoom
          showFitView
          showInteractive={false}
        />

        <MiniMap
          position="top-right"
          pannable
          zoomable
          style={
            {
              top: 10,
              right: 10,
              width: 126,
              height: 78,
              background: "transparent",
              border: "none",
              borderRadius: 0,
              overflow: "visible",
            } as any
          }
          maskColor="transparent"
          nodeComponent={ArtworkMiniMapNode}
        />

        {isDraggingOver && (
          <div className="canvas-drop-label">
            Drop to place
          </div>
        )}
      </ReactFlow>

      {dragPreview && (
        <div className="drag-preview" style={{ left: dragPreview.x, top: dragPreview.y }}>
          <div className="drag-preview-card">
            <div className="drag-preview-art">
              {dragPreview.html ? (
                <div
                  dangerouslySetInnerHTML={{ __html: dragPreview.html }}
                  className="h-full w-full"
                />
              ) : (
                <Maximize2 size={14} />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{dragPreview.title}</div>
              <div className="text-[11px] text-muted-foreground">Place on canvas</div>
            </div>
          </div>
        </div>
      )}

      {connectionError && (
        <div className="canvas-error" role="alert">
          <AlertCircle size={13} />
          {connectionError}
        </div>
      )}

      {activeConnection && (
        <div
          className="canvas-wire-toolbar"
          role="toolbar"
          aria-label={`Wire ${activeConnection.id} actions`}
        >
          <div className="min-w-0">
            <div className="truncate font-mono text-[10px] font-medium">
              {activeConnection.id}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {activeConnection.source.componentId}:{activeConnection.source.portId} →{" "}
              {activeConnection.target.componentId}:{activeConnection.target.portId} ·{" "}
              {activeConnection.domain}
            </div>
          </div>
          <DestructiveConfirmButton
            targetKey={activeConnection.id}
            onConfirm={() => {
              useProjectStore.getState().disconnectPorts(activeConnection.id);
              setActiveConnection(null);
            }}
            className="canvas-wire-delete"
            aria-label={`Delete wire ${activeConnection.id}`}
            confirmAriaLabel={`Confirm delete wire ${activeConnection.id}`}
            title={`Arm deletion of wire ${activeConnection.id}`}
            confirmTitle={`Click again to permanently delete wire ${activeConnection.id}`}
            confirmChildren={<><Check size={11} /> Confirm</>}
          >
            <Trash2 size={11} />
          </DestructiveConfirmButton>
        </div>
      )}
    </div>
  );
}
