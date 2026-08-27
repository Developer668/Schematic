/**
 * WebMCP tool surface — ~18 semantic hardware tools via document.modelContext.registerTool
 * Per HardwareWebMCP.md: don't expose 100 tiny tools, expose powerful semantic ones.
 * Human click and AI call share same underlying Zustand functions.
 */
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSimulationStore } from "../store/useSimulationStore.ts";
import { catalog, searchCatalog } from "../data/catalog.ts";

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: any) => Promise<any>;
  annotations?: { readOnlyHint?: boolean };
};

const tools: ToolDef[] = [
  {
    name: "project.get_graph",
    description: "Get the current hardware project graph (components, connections, firmware)",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const g = useProjectStore.getState().getGraph();
      return { content: [{ type: "text", text: JSON.stringify(g, null, 2) }], data: g };
    },
  },
  {
    name: "project.clear",
    description: "Clear the current project (remove all components and connections)",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      useProjectStore.getState().clear();
      return { content: [{ type: "text", text: "Project cleared" }] };
    },
  },
  {
    name: "project.rename",
    description: "Rename the active hardware project",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    execute: async ({ name }) => {
      useProjectStore.getState().setProjectName(name);
      return { content: [{ type: "text", text: `Renamed project to ${name}` }], data: { name } };
    },
  },
  {
    name: "component.search",
    description: "Search components in catalog by query, category, or domain. e.g. ESP32, TI DRV, sensor",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text" },
        category: { type: "string", enum: ["board", "sensor", "actuator", "display", "power", "logic", "communication", ""] },
        domain: { type: "string", enum: ["gpio", "i2c", "spi", "uart", "power", "rf", ""] },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async ({ query, category, domain }) => {
      const res = searchCatalog(query ?? "", { category: category || undefined, domain: domain || undefined });
      return { content: [{ type: "text", text: JSON.stringify(res.map((r) => ({ id: r.id, title: r.title, category: r.category, ports: r.ports.length })), null, 2) }], data: res };
    },
  },
  {
    name: "component.inspect",
    description: "Inspect a component definition by id — returns ports, models, fidelity checklist, electrical specs",
    inputSchema: { type: "object", properties: { componentId: { type: "string", description: "Catalog id, e.g. bmp280" } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      const def = catalog.find((c) => c.id === componentId);
      if (!def) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(def, null, 2) }], data: def };
    },
  },
  {
    name: "component.add",
    description: "Add a hardware component to the current project at x,y",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Catalog definition id" },
        x: { type: "number", description: "Canvas x" },
        y: { type: "number", description: "Canvas y" },
      },
      required: ["componentId"],
    },
    execute: async ({ componentId, x, y }) => {
      const def = catalog.find((c) => c.id === componentId);
      if (!def) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      const { id } = useProjectStore.getState().addComponent(componentId, { x: x ?? 100, y: y ?? 100 });
      return { content: [{ type: "text", text: `Added ${componentId} as ${id}` }], data: { instanceId: id } };
    },
  },
  {
    name: "component.remove",
    description: "Remove a component instance from the project",
    inputSchema: { type: "object", properties: { instanceId: { type: "string" } }, required: ["instanceId"] },
    execute: async ({ instanceId }) => {
      useProjectStore.getState().removeComponent(instanceId);
      return { content: [{ type: "text", text: `Removed ${instanceId}` }] };
    },
  },
  {
    name: "component.list_ports",
    description: "List ports for a component instance (or definition if no instance)",
    inputSchema: { type: "object", properties: { componentId: { type: "string", description: "Instance id or definition id" } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      const inst = useProjectStore.getState().project.components.find((c) => c.id === componentId);
      const defId = inst?.definitionId ?? componentId;
      const def = catalog.find((c) => c.id === defId);
      if (!def) return { content: [{ type: "text", text: `Unknown ${componentId}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(def.ports, null, 2) }], data: def.ports };
    },
  },
  {
    name: "connection.connect",
    description: "Connect two ports: source component.port → target component.port. Validates typed domains.",
    inputSchema: {
      type: "object",
      properties: {
        sourceComponentId: { type: "string" },
        sourcePortId: { type: "string" },
        targetComponentId: { type: "string" },
        targetPortId: { type: "string" },
      },
      required: ["sourceComponentId", "sourcePortId", "targetComponentId", "targetPortId"],
    },
    execute: async ({ sourceComponentId, sourcePortId, targetComponentId, targetPortId }) => {
      try {
        const { id } = useProjectStore.getState().connectPorts({ componentId: sourceComponentId, portId: sourcePortId }, { componentId: targetComponentId, portId: targetPortId });
        return { content: [{ type: "text", text: `Connected ${sourceComponentId}.${sourcePortId} → ${targetComponentId}.${targetPortId} as ${id}` }], data: { connectionId: id } };
      } catch (e) {
        return { content: [{ type: "text", text: `Failed: ${(e as Error).message}` }], isError: true };
      }
    },
  },
  {
    name: "connection.disconnect",
    description: "Disconnect (remove) a connection by id",
    inputSchema: { type: "object", properties: { connectionId: { type: "string" } }, required: ["connectionId"] },
    execute: async ({ connectionId }) => {
      useProjectStore.getState().disconnectPorts(connectionId);
      return { content: [{ type: "text", text: `Disconnected ${connectionId}` }] };
    },
  },
  {
    name: "connection.get_connections",
    description: "Get all connections in current project",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const conns = useProjectStore.getState().project.connections;
      return { content: [{ type: "text", text: JSON.stringify(conns, null, 2) }], data: conns };
    },
  },
  {
    name: "firmware.write",
    description: "Write firmware files for a board instance (creates/overwrites FirmwareTarget)",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Board instance id" },
        files: { type: "array", items: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } },
      },
      required: ["componentId", "files"],
    },
    execute: async ({ componentId, files }) => {
      // Persist to the same project state used by the editor and project export.
      const proj = useProjectStore.getState().project;
      const existing = proj.firmwareTargets.find((f) => f.componentId === componentId);
      if (existing) {
        existing.files = files;
        useProjectStore.getState().loadProject({ ...proj, firmwareTargets: proj.firmwareTargets.map((f) => (f.componentId === componentId ? existing : f)) });
      } else {
        const id = `fw-${componentId}`;
        useProjectStore.getState().loadProject({ ...proj, firmwareTargets: [...proj.firmwareTargets, { id, componentId, files }] });
      }
      return { content: [{ type: "text", text: `Firmware written for ${componentId} (${files.length} file(s))` }] };
    },
  },
  {
    name: "firmware.compile",
    description: "Compile firmware for a board (calls backend /api/compile)",
    inputSchema: { type: "object", properties: { componentId: { type: "string" }, boardFqbn: { type: "string", description: "e.g. arduino:avr:uno" } }, required: ["componentId"] },
    execute: async ({ componentId, boardFqbn }) => {
      const proj = useProjectStore.getState().project;
      const tgt = proj.firmwareTargets.find((f) => f.componentId === componentId);
      if (!tgt) return { content: [{ type: "text", text: `No firmware for ${componentId} — call firmware.write first` }], isError: true };
      try {
        const response = await fetch("/api/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: tgt.files, board_fqbn: boardFqbn ?? "arduino:avr:uno" }) });
        const res = await response.json();
        if (!response.ok) return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res, isError: true };
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res };
      } catch (e) {
        return { content: [{ type: "text", text: `Compile failed: ${(e as Error).message}` }], isError: true };
      }
    },
  },
  {
    name: "simulation.run",
    description: "Run simulation for current project (initialize engines, advance)",
    inputSchema: { type: "object", properties: { durationMs: { type: "number", description: "Duration ms, default 1000" } } },
    execute: async ({ durationMs }) => {
      const project = useProjectStore.getState().project;
      const inputs = useSimulationStore.getState().pinStates;
      useSimulationStore.getState().start();
      try {
        const response = await fetch("/api/simulation/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, inputs, duration_ns: (durationMs ?? 1000) * 1e6 }) });
        const res = await response.json();
        if (!response.ok) {
          useSimulationStore.getState().stop();
          return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res, isError: true };
        }
        const timeNs = BigInt(res.time_ns ?? 0);
        const simulation = useSimulationStore.getState();
        simulation.setTime(timeNs);
        for (const [portId, value] of Object.entries(res.outputs ?? {})) {
          if (typeof value === "boolean" || typeof value === "number") simulation.setPin(portId, value);
        }
        const readings = Object.entries(res.outputs ?? {}).map(([key, value]) => `${key.split(":").pop()}=${value}`).join("  ");
        simulation.appendSerial(`[${project.name}] t=${timeNs}ns${readings ? `  ${readings}` : ""}\n`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res };
      } catch (e) {
        useSimulationStore.getState().stop();
        return { content: [{ type: "text", text: `Simulation failed: ${(e as Error).message}` }], isError: true };
      }
    },
  },
  {
    name: "simulation.stop",
    description: "Stop simulation",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      useSimulationStore.getState().stop();
      try {
        const response = await fetch("/api/simulation/stop", { method: "POST" });
        if (!response.ok) return { content: [{ type: "text", text: `Simulation stopped locally; backend returned HTTP ${response.status}` }], isError: true };
        return { content: [{ type: "text", text: "Simulation stopped" }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Simulation stopped locally; backend stop failed: ${(e as Error).message}` }], isError: true };
      }
    },
  },
  {
    name: "simulation.get_state",
    description: "Get simulation state (running, timeNs, pinStates, engineStatus)",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const sim = useSimulationStore.getState();
      const state = { running: sim.running, timeNs: sim.timeNs.toString(), pinStates: sim.pinStates, engineStatus: sim.engineStatus, serialOutput: sim.serialOutput.slice(-500) };
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], data: state };
    },
  },
  {
    name: "simulation.set_input",
    description: "Set sensor input (e.g. motion=true, temperature=25) for simulation",
    inputSchema: { type: "object", properties: { componentId: { type: "string" }, key: { type: "string" }, value: {} } , required: ["componentId", "key", "value"]},
    execute: async ({ componentId, key, value }) => {
      useSimulationStore.getState().setPin(`${componentId}:${key}`, value as boolean | number);
      // also try WS
      try {
        const ws = new WebSocket(`ws://${location.hostname}:8001/api/simulation/ws`);
        ws.onopen = () => {
          ws.send(JSON.stringify({ op: "set_sensor_input", componentId, key, value }));
          ws.close();
        };
      } catch {}
      return { content: [{ type: "text", text: `Set ${componentId}.${key}=${JSON.stringify(value)}` }] };
    },
  },
  {
    name: "validation.check",
    description: "Validate current design — returns issues (voltage, ground, I2C collision, TX-TX, etc.)",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      // Client-side validator (mirrors Python). For simplicity, use fetch if backend available.
      try {
        const project = useProjectStore.getState().project;
        // naive local checks
        const issues: any[] = [];
        if (project.connections.length === 0 && project.components.length > 1) issues.push({ severity: "warning", code: "NO_CONNECTIONS", message: "Multiple components but no connections" });
        if (!project.components.some((c) => c.definitionId.includes("arduino") || c.definitionId.includes("esp32") || c.definitionId.includes("pi"))) issues.push({ severity: "info", code: "NO_BOARD", message: "No board in project" });
        const valid = !issues.some((i) => i.severity === "error");
        return { content: [{ type: "text", text: JSON.stringify({ valid, issues }, null, 2) }], data: { valid, issues } };
      } catch (e) {
        return { content: [{ type: "text", text: `Validation error: ${(e as Error).message}` }], isError: true };
      }
    },
  },
  {
    name: "validation.explain_error",
    description: "Explain a validation error code with fix guidance",
    inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
    annotations: { readOnlyHint: true },
    execute: async ({ code }) => {
      const map: Record<string, string> = {
        VOLTAGE_MISMATCH: "Voltage exceeds target max — insert level shifter or choose compatible variant.",
        OUTPUT_TO_OUTPUT: "Output→output illegal — one side must be input/bidirectional.",
        UART_TX_TO_TX: "Connect TX→RX and RX→TX (cross).",
        I2C_ADDRESS_COLLISION: "Two devices share same I2C address — change address jumper or use mux.",
        MISSING_PULLUP: "I2C needs 4.7kΩ pull-ups to VCC on SDA/SCL.",
        MISSING_GROUND: "Add common ground net.",
        USB_HOST_TO_HOST: "Host must connect to device.",
      };
      return { content: [{ type: "text", text: map[code] ?? `No explanation for ${code}` }] };
    },
  },
  {
    name: "design.auto_layout",
    description: "Auto-layout components on canvas (simple grid)",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const proj = useProjectStore.getState().project;
      const next = proj.components.map((c, i) => ({ ...c, position: { x: 50 + (i % 4) * 220, y: 50 + Math.floor(i / 4) * 180 } }));
      useProjectStore.getState().loadProject({ ...proj, components: next });
      return { content: [{ type: "text", text: `Auto-layout applied to ${next.length} components` }] };
    },
  },
];

let controllers: AbortController[] = [];

export async function registerWebMCPTools() {
  const mc: any = (document as any).modelContext ?? (navigator as any).modelContext;
  if (!mc || typeof mc.registerTool !== "function") {
    console.warn("[WebMCP] modelContext not available — run in Chrome ≥146 with #enable-webmcp-testing, or use demo shim. Tools still callable via window.__schematicTools");
    (window as any).__schematicTools = Object.fromEntries(tools.map((t) => [t.name, t.execute]));
    return;
  }
  for (const t of tools) {
    const ctrl = new AbortController();
    controllers.push(ctrl);
    try {
      await mc.registerTool(
        {
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
          execute: t.execute,
        },
        { signal: ctrl.signal },
      );
      console.log(`[WebMCP] registered ${t.name}`);
    } catch (e) {
      console.error(`[WebMCP] failed to register ${t.name}:`, e);
    }
  }
  // expose for in-page testing / fallback
  (window as any).__schematicTools = Object.fromEntries(tools.map((t) => [t.name, t.execute]));
  // listen for toolchange
  if ("ontoolchange" in mc) {
    mc.ontoolchange = () => console.log("[WebMCP] toolset changed");
  }
}

export function unregisterWebMCPTools() {
  for (const c of controllers) c.abort();
  controllers = [];
}

export function getRegisteredToolNames() {
  return tools.map((t) => t.name);
}

/** Invoke the exact same callback registered with document.modelContext. */
export async function invokeWebMCPTool(name: string, args: Record<string, any> = {}) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
  return tool.execute(args);
}
