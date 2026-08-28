import {
  createHardwareGraphIndex,
  type HardwareDefinitionLookup,
  type HardwarePort,
  type PortDomain,
  type HardwareProject,
  type ValidationIssue,
  type ValidationResult,
} from "@schematic/hardware-graph";

/** Kept as a named compatibility alias for existing catalog callers. */
export type ComponentDefLookup = HardwareDefinitionLookup;

const DOMAIN_EDGE_STYLE: Record<PortDomain, string> = {
  power: "solid-thick",
  power_output: "solid-thick",
  ground: "solid-thick",
  gpio: "solid",
  adc: "dashed",
  pwm: "dotted",
  i2c: "double",
  spi: "double-dashed",
  uart: "dashed",
  usb: "stripe",
  ethernet: "stripe",
  can: "solid",
  pcie: "solid",
  csi: "solid",
  hdmi: "solid",
  displayport: "solid",
  rf: "wavy",
  mechanical: "solid",
  optical: "dotted",
};

export function edgeStyleForDomain(domain: PortDomain): string {
  return DOMAIN_EDGE_STYLE[domain] ?? "solid";
}

function diagnosticToIssue(diagnostic: ReturnType<typeof createHardwareGraphIndex>["diagnostics"][number]): ValidationIssue {
  const issue: ValidationIssue = {
    id: diagnostic.id,
    severity: diagnostic.severity,
    code: diagnostic.code === "UNKNOWN_COMPONENT_DEFINITION" ? "UNKNOWN_COMPONENT" : diagnostic.code,
    message: diagnostic.message,
  };
  if (diagnostic.connectionIds?.length) issue.affectedConnections = [...diagnostic.connectionIds];
  if (diagnostic.componentIds?.length) issue.affectedComponents = [...diagnostic.componentIds];
  return issue;
}

function endpointLabel(componentId: string, portId: string) {
  return `${componentId}:${portId}`;
}

function portName(port: HardwarePort) {
  return `${port.id} ${port.name}`.toUpperCase().replace(/[ _-]+/g, " ").trim();
}

function i2cPortFor(
  index: ReturnType<typeof createHardwareGraphIndex>,
  componentId: string,
  signal: "SDA" | "SCL",
) {
  return index.endpoints.find((endpoint) => {
    if (endpoint.componentId !== componentId || endpoint.port?.domain !== "i2c") return false;
    return portName(endpoint.port).split(" ")[0] === signal;
  });
}

function targetAddressFor(
  index: ReturnType<typeof createHardwareGraphIndex>,
  componentId: string,
) {
  return index.endpoints
    .filter((endpoint) => endpoint.componentId === componentId && endpoint.port?.domain === "i2c")
    .map((endpoint) => endpoint.port?.protocol)
    .find((protocol) => protocol?.role === "target" && protocol.address !== undefined)?.address;
}

function addI2cAddressIssues(
  project: HardwareProject,
  index: ReturnType<typeof createHardwareGraphIndex>,
  issues: ValidationIssue[],
) {
  const buses = new Map<string, Map<number, string[]>>();
  for (const component of [...project.components].sort((left, right) => left.id.localeCompare(right.id))) {
    const address = targetAddressFor(index, component.id);
    if (address === undefined) continue;
    const sda = i2cPortFor(index, component.id, "SDA");
    const scl = i2cPortFor(index, component.id, "SCL");
    const sdaNet = sda ? index.netFor(sda.key) : undefined;
    const sclNet = scl ? index.netFor(scl.key) : undefined;
    // An unconnected target is not on an I2C bus yet, so it cannot collide
    // with a target on another connected bus.
    if (!sdaNet?.connected || !sclNet?.connected) continue;
    const busKey = `${sdaNet.id}|${sclNet.id}`;
    const addresses = buses.get(busKey) ?? new Map<number, string[]>();
    addresses.set(address, [...(addresses.get(address) ?? []), component.id]);
    buses.set(busKey, addresses);
  }

  for (const [busKey, addresses] of buses) {
    for (const [address, components] of addresses) {
      if (components.length < 2) continue;
      const sortedComponents = [...components].sort();
      issues.push({
        id: `i2c-collision-${encodeURIComponent(busKey)}-${address}`,
        severity: "error",
        code: "I2C_ADDRESS_COLLISION",
        message: `I2C address 0x${address.toString(16)} collision on bus ${busKey}: ${sortedComponents.join(", ")}.`,
        affectedComponents: sortedComponents,
      });
    }
  }
}

function addI2cPullupIssue(
  project: HardwareProject,
  index: ReturnType<typeof createHardwareGraphIndex>,
  issues: ValidationIssue[],
) {
  const hasConnectedI2c = index.nets.some((net) => net.connected && net.domains.includes("i2c"));
  if (!hasConnectedI2c) return;
  const needsPullup = index.endpoints.some((endpoint) => (
    endpoint.port?.domain === "i2c"
    && endpoint.port.electrical?.requiresPullup === true
    && Boolean(index.netFor(endpoint.key)?.connected)
  ));
  const hasPullupComponent = project.components.some((component) => /resistor|pullup/i.test(component.definitionId));
  if (!needsPullup || hasPullupComponent) return;
  issues.push({
    id: "i2c-pullup",
    severity: "warning",
    code: "MISSING_PULLUP",
    message: "I2C bus missing pull-up resistors (SDA/SCL require pullup).",
    autoFix: { description: "Add 4.7k pull-ups", action: "insert_pullup", params: { value: 4700 } },
  });
}

/** Universal validator backed by the shared graph index and v1 Connection[] state. */
export function validateProject(project: HardwareProject, lookup: ComponentDefLookup): ValidationResult {
  const index = createHardwareGraphIndex(project, lookup);
  const issues = index.diagnostics.map(diagnosticToIssue);

  for (const edge of index.connections) {
    const source = edge.source.port;
    const target = edge.target.port;
    if (!source || !target || !edge.source.valid || !edge.target.valid) continue;
    const sourceKey = endpointLabel(edge.source.componentId, edge.source.portId);
    const targetKey = endpointLabel(edge.target.componentId, edge.target.portId);
    const connectionId = edge.connection.id;

    if (source.direction === "output" && target.direction === "output") {
      issues.push({
        id: `out-out-${connectionId}`,
        severity: "error",
        code: "OUTPUT_TO_OUTPUT",
        message: `Output ${sourceKey} connected to output ${targetKey}.`,
        affectedConnections: [connectionId],
      });
    }
    if (source.direction === "input" && target.direction === "input") {
      issues.push({
        id: `in-in-${connectionId}`,
        severity: "error",
        code: "INPUT_TO_INPUT",
        message: `Input ${sourceKey} connected to input ${targetKey}; connect a driving port to a receiving port.`,
        affectedConnections: [connectionId],
      });
    }
    if (source.domain === "uart" && target.domain === "uart" && portName(source).includes("TX") && portName(target).includes("TX")) {
      issues.push({
        id: `uart-tx-${connectionId}`,
        severity: "error",
        code: "UART_TX_TO_TX",
        message: `UART TX→TX illegal: ${sourceKey} → ${targetKey}.`,
        affectedConnections: [connectionId],
      });
    }
    if (source.domain === "i2c" && target.domain === "i2c" && source.protocol?.role === "controller" && target.protocol?.role === "controller") {
      issues.push({
        id: `i2c-controller-${connectionId}`,
        severity: "warning",
        code: "I2C_CONTROLLER_TO_CONTROLLER",
        message: `I2C controller-to-controller wire: ${sourceKey} → ${targetKey}.`,
        affectedConnections: [connectionId],
      });
    }

    const voltageChecks = [
      { nominal: source.electrical?.nominalVoltage, maximum: target.electrical?.maxVoltage, from: sourceKey, to: targetKey },
      { nominal: target.electrical?.nominalVoltage, maximum: source.electrical?.maxVoltage, from: targetKey, to: sourceKey },
    ];
    const voltageMismatch = voltageChecks.find((check) => check.nominal !== undefined && check.maximum !== undefined && check.nominal > check.maximum + 0.1);
    if (voltageMismatch?.nominal !== undefined && voltageMismatch.maximum !== undefined) {
      issues.push({
        id: `voltage-${connectionId}`,
        severity: "error",
        code: "VOLTAGE_MISMATCH",
        message: `Voltage ${voltageMismatch.nominal}V on ${voltageMismatch.from} exceeds ${voltageMismatch.maximum}V max on ${voltageMismatch.to}.`,
        affectedConnections: [connectionId],
        autoFix: { description: "Insert level shifter", action: "insert_level_shifter", params: { connectionId } },
      });
    }
    if (source.domain === "rf" && target.domain === "rf") {
      const sourceImpedance = source.rf?.impedanceOhm;
      const targetImpedance = target.rf?.impedanceOhm;
      if (sourceImpedance !== undefined && targetImpedance !== undefined && Math.abs(sourceImpedance - targetImpedance) > 5) {
        issues.push({
          id: `rf-imp-${connectionId}`,
          severity: "warning",
          code: "RF_IMPEDANCE_MISMATCH",
          message: `RF impedance ${sourceImpedance}Ω vs ${targetImpedance}Ω.`,
          affectedConnections: [connectionId],
        });
      }
    }
    if (source.domain === "usb" && target.domain === "usb" && source.protocol?.role === "host" && target.protocol?.role === "host") {
      issues.push({
        id: `usb-host-${connectionId}`,
        severity: "error",
        code: "USB_HOST_TO_HOST",
        message: "USB host-to-host connection is not valid.",
        affectedConnections: [connectionId],
      });
    }
    if (source.domain === "pcie" && target.domain === "pcie" && source.protocol?.role === "endpoint" && target.protocol?.role === "endpoint") {
      issues.push({
        id: `pcie-ep-${connectionId}`,
        severity: "error",
        code: "PCIE_EP_TO_EP",
        message: "PCIe endpoint-to-endpoint connection is not valid.",
        affectedConnections: [connectionId],
      });
    }
  }

  const connectedNets = index.nets.filter((net) => net.connected);
  const hasConnectedGround = connectedNets.some((net) => net.rail === "ground");
  const hasConnectedPower = connectedNets.some((net) => net.rail === "power");
  if (project.components.length > 0 && !hasConnectedGround) {
    issues.push({
      id: "missing-ground",
      severity: "warning",
      code: "MISSING_GROUND",
      message: "No connected ground net found — add a GND connection.",
      autoFix: { description: "Auto-connect GND", action: "add_ground" },
    });
  }
  if (project.components.length > 1 && !hasConnectedPower) {
    issues.push({ id: "missing-power", severity: "warning", code: "INSUFFICIENT_POWER", message: "No connected power net found." });
  }

  addI2cAddressIssues(project, index, issues);
  addI2cPullupIssue(project, index, issues);

  const codeIssues = project.firmwareTargets.flatMap((target) => validateFirmwareFiles(target.files));
  return {
    valid: !issues.some((issue) => issue.severity === "error") && !codeIssues.some((issue) => issue.severity === "error"),
    issues,
    codeIssues,
  };
}

export interface CodeIssue {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export function validateFirmwareFiles(files: { name: string; content: string }[]): CodeIssue[] {
  const issues: CodeIssue[] = [];
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    let depth = 0;
    lines.forEach((line, index) => {
      for (const character of line) {
        if (character === "{") depth += 1;
        if (character === "}") depth -= 1;
      }
      if (depth < 0) issues.push({ id: `${file.name}-unexpected-close-${index + 1}`, severity: "error", code: "FIRMWARE_UNBALANCED_BRACES", file: file.name, line: index + 1, message: "Unexpected closing brace." });
    });
    if (depth !== 0) issues.push({ id: `${file.name}-unbalanced-braces`, severity: "error", code: "FIRMWARE_UNBALANCED_BRACES", file: file.name, message: "Opening and closing braces are unbalanced." });
    if (/\.ino$/i.test(file.name) && !/\bvoid\s+setup\s*\(/.test(file.content)) issues.push({ id: `${file.name}-missing-setup`, severity: "warning", code: "FIRMWARE_MISSING_SETUP", file: file.name, message: "Arduino sketch is missing void setup()." });
    if (/\.ino$/i.test(file.name) && !/\bvoid\s+loop\s*\(/.test(file.content)) issues.push({ id: `${file.name}-missing-loop`, severity: "warning", code: "FIRMWARE_MISSING_LOOP", file: file.name, message: "Arduino sketch is missing void loop()." });
  }
  return issues;
}

export function explainIssue(issue: ValidationIssue): string {
  const fixes: Record<string, string> = {
    UNKNOWN_COMPONENT: "Choose a component definition that exists in the catalog.",
    INVALID_PORT_DOMAIN: "Update the catalog port to use a supported electrical or protocol domain.",
    MISSING_COMPONENT: "Restore the referenced component or remove the wire that points to it.",
    MISSING_PORT: "Choose an existing port on the referenced component or remove the stale wire.",
    DUPLICATE_CONNECTION: "Remove the extra wire; a pair of endpoints should be connected only once.",
    DOMAIN_MISMATCH: "Connect compatible signal domains, or insert the appropriate adapter or level shifter.",
    CONNECTION_DOMAIN_MISMATCH: "Update the wire domain to match both endpoint ports.",
    MIXED_DOMAIN_NET: "Split the net so each electrical/protocol domain has its own connected endpoints.",
    MIXED_RAIL_NET: "Separate ground from power; never short a power rail directly to ground.",
    BUS_SIGNAL_MISMATCH: "Keep distinct bus signals on distinct nets (for example, I2C SDA separate from SCL).",
    VOLTAGE_MISMATCH: "Use a level shifter or choose a voltage-compatible variant. Check datasheet max ratings.",
    OUTPUT_TO_OUTPUT: "Outputs must drive inputs. Swap one side or insert a buffer.",
    INPUT_TO_INPUT: "Connect a driving output to the input, or use a bidirectional port.",
    UART_TX_TO_TX: "Connect TX→RX and RX→TX (cross-over).",
    I2C_ADDRESS_COLLISION: "Change one device's address jumper or use an I2C mux.",
    MISSING_PULLUP: "Add 4.7kΩ pull-ups to VCC on SDA/SCL (or enable internal pull-ups if supported).",
    MISSING_GROUND: "All power domains need common ground. Connect GND nets.",
    INSUFFICIENT_POWER: "Add a connected power source or board power rail.",
    USB_HOST_TO_HOST: "USB host must connect to a device; insert a hub if needed.",
    PCIE_EP_TO_EP: "PCIe endpoint must connect to a root complex.",
    RF_IMPEDANCE_MISMATCH: "Match to 50Ω (or design impedance) with a matching network.",
  };
  return fixes[issue.code] ?? issue.message;
}
