// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const flowMock = vi.hoisted(() => ({ props: null as Record<string, any> | null, nodeChanges: vi.fn(), edgeChanges: vi.fn() }));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, any>) => {
    flowMock.props = props;
    return props.children ?? null;
  },
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  NodeToolbar: ({ children, isVisible }: { children?: unknown; isVisible?: boolean }) => isVisible ? children : null,
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), flowMock.nodeChanges],
  useEdgesState: (initial: unknown[]) => [initial, vi.fn(), flowMock.edgeChanges],
  addEdge: (edge: unknown) => edge,
  BackgroundVariant: { Lines: "lines" },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));
vi.mock("../components/ComponentArtwork.tsx", () => ({ default: () => <div data-testid="artwork" /> }));
vi.mock("../components/canvas/ComponentVisualOverlay.tsx", () => ({ default: () => null }));

import HardwareCanvas from "../components/canvas/HardwareCanvas.tsx";
import HardwareNode from "../components/canvas/HardwareNode.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";
import { useGraphFocusStore } from "../store/useGraphFocusStore.ts";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

beforeEach(() => {
  flowMock.props = null;
  flowMock.nodeChanges.mockReset();
  flowMock.edgeChanges.mockReset();
  useProjectStore.getState().clear();
  useSelectionStore.getState().clear();
  useGraphFocusStore.getState().clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  useProjectStore.getState().clear();
  useSelectionStore.getState().clear();
  useGraphFocusStore.getState().clear();
});

describe("canvas destructive controls", () => {
  it("requires a second toolbar activation and explains the attached-state impact", () => {
    const component = useProjectStore.getState().addComponent("led");
    const container = render(
      <HardwareNode
        id={component.id}
        type="hardware"
        draggable
        dragging={false}
        zIndex={0}
        selectable
        deletable={false}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        selected
        data={{ label: "LED", definitionId: "led", instanceId: component.id, ports: [] }}
      />,
    );
    let deleteButton = container.querySelector<HTMLButtonElement>("button.node-toolbar-delete");

    expect(deleteButton).toBeTruthy();
    act(() => deleteButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(true);
    deleteButton = container.querySelector<HTMLButtonElement>("button.node-toolbar-delete");
    expect(deleteButton?.getAttribute("aria-label")).toMatch(/^Confirm delete LED/);
    expect(deleteButton?.title).toMatch(/wires.*source documents/i);

    deleteButton = container.querySelector<HTMLButtonElement>("button.node-toolbar-delete");
    act(() => deleteButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(false);
  });

  it("disables React Flow keyboard/remove-event deletion so it cannot bypass confirmation", () => {
    useProjectStore.getState().addComponent("led");
    render(<HardwareCanvas />);

    expect(flowMock.props?.deleteKeyCode).toBeNull();
    expect(flowMock.props?.onNodesDelete).toBeUndefined();
    expect((flowMock.props?.nodes as Array<{ deletable?: boolean }>).every((node) => node.deletable === false)).toBe(true);
    expect((flowMock.props?.edges as Array<{ deletable?: boolean }>).every((edge) => edge.deletable === false)).toBe(true);
    flowMock.props?.onNodesChange?.([{ type: "remove", id: "led-not-allowed" }]);
    flowMock.props?.onEdgesChange?.([{ type: "remove", id: "wire-not-allowed" }]);
    expect(flowMock.nodeChanges).not.toHaveBeenCalled();
    expect(flowMock.edgeChanges).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project.components).toHaveLength(1);
  });

  it("selects a target wire and requires a second explicit deletion activation", () => {
    const board = useProjectStore.getState().addComponent("esp32-devkit-v1");
    const led = useProjectStore.getState().addComponent("led");
    const connection = useProjectStore.getState().connectPorts(
      { componentId: board.id, portId: "GPIO18" },
      { componentId: led.id, portId: "IN" },
    );
    const container = render(<HardwareCanvas />);

    act(() => flowMock.props?.onEdgeClick?.({}, { id: connection.id }));
    let deleteButton = container.querySelector<HTMLButtonElement>("button.canvas-wire-delete");
    expect(deleteButton?.getAttribute("aria-label")).toBe(`Delete wire ${connection.id}`);

    act(() => deleteButton?.click());
    expect(useProjectStore.getState().project.connections.some((item) => item.id === connection.id)).toBe(true);
    deleteButton = container.querySelector<HTMLButtonElement>("button.canvas-wire-delete");
    expect(deleteButton?.getAttribute("aria-label")).toBe(`Confirm delete wire ${connection.id}`);

    act(() => deleteButton?.click());
    expect(useProjectStore.getState().project.connections.some((item) => item.id === connection.id)).toBe(false);
    expect(useGraphFocusStore.getState().activeConnectionId).toBeNull();
  });
});
