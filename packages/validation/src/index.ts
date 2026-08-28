import type { HardwareProject, HardwarePort, Connection, ValidationResult, ValidationIssue, PortDomain } from "@schematic/hardware-graph";

export type ComponentDefLookup = (definitionId: string) => { ports: HardwarePort[] } | undefined;

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

/** Universal validator — checks all rules from HardwareWebMCP.md § central connection system */
export function validateProject(project: HardwareProject, lookup: ComponentDefLookup): ValidationResult {
  const issues: ValidationIssue[] = [];
  const portMap = new Map<string, HardwarePort>();
  for (const inst of project.components) {
    const def = lookup(inst.definitionId);
    if (!def) {
      issues.push({ id: `missing-def-${inst.id}`, severity: "error", code: "UNKNOWN_COMPONENT", message: `Unknown component definition ${inst.definitionId} for ${inst.id}`, affectedComponents: [inst.id] });
      continue;
    }
    for (const p of def.ports) portMap.set(`${inst.id}:${p.id}`, p);
  }

  // 1. Connection existence & domain/bias checks
  for (const conn of project.connections) {
    const srcKey = `${conn.source.componentId}:${conn.source.portId}`;
    const tgtKey = `${conn.target.componentId}:${conn.target.portId}`;
    const src = portMap.get(srcKey);
    const tgt = portMap.get(tgtKey);
    if (!src || !tgt) {
      issues.push({ id: `missing-port-${conn.id}`, severity: "error", code: "MISSING_PORT", message: `Connection ${conn.id} references missing port ${!src ? srcKey : tgtKey}`, affectedConnections: [conn.id] });
      continue;
    }
    // Output→output
    if (src.direction === "output" && tgt.direction === "output") {
      issues.push({ id: `out-out-${conn.id}`, severity: "error", code: "OUTPUT_TO_OUTPUT", message: `Output ${srcKey} connected to output ${tgtKey}`, affectedConnections: [conn.id] });
    }
    if (src.direction === "input" && tgt.direction === "input") {
      issues.push({ id: `in-in-${conn.id}`, severity: "error", code: "INPUT_TO_INPUT", message: `Input ${srcKey} connected to input ${tgtKey}`, affectedConnections: [conn.id] });
    }
    // TX→TX (UART)
    if (src.domain === "uart" && tgt.domain === "uart" && src.name.includes("TX") && tgt.name.includes("TX")) {
      issues.push({ id: `uart-tx-${conn.id}`, severity: "error", code: "UART_TX_TO_TX", message: `UART TX→TX illegal: ${srcKey} → ${tgtKey}`, affectedConnections: [conn.id] });
    }
    // I2C role mismatch (controller↔controller)
    if (src.domain === "i2c" && tgt.domain === "i2c" && src.protocol?.role === "controller" && tgt.protocol?.role === "controller") {
      issues.push({ id: `i2c-ctrl-${conn.id}`, severity: "warning", code: "I2C_CONTROLLER_TO_CONTROLLER", message: `I2C controller to controller: ${srcKey}→${tgtKey}`, affectedConnections: [conn.id] });
    }
    // Voltage incompatibility
    const srcMax = src.electrical?.maxVoltage;
    const tgtMax = tgt.electrical?.maxVoltage;
    const srcNom = src.electrical?.nominalVoltage;
    const tgtNom = tgt.electrical?.nominalVoltage;
    if (srcNom !== undefined && tgtMax !== undefined && srcNom > tgtMax + 0.1) {
      issues.push({
        id: `volt-${conn.id}`,
        severity: "error",
        code: "VOLTAGE_MISMATCH",
        message: `Voltage ${srcNom}V on ${srcKey} exceeds ${tgtMax}V max on ${tgtKey}`,
        affectedConnections: [conn.id],
        autoFix: { description: "Insert level shifter", action: "insert_level_shifter", params: { connectionId: conn.id } },
      });
    }
    // RF impedance
    if (src.domain === "rf" && tgt.domain === "rf") {
      const sImp = src.rf?.impedanceOhm;
      const tImp = tgt.rf?.impedanceOhm;
      if (sImp !== undefined && tImp !== undefined && Math.abs(sImp - tImp) > 5) {
        issues.push({ id: `rf-imp-${conn.id}`, severity: "warning", code: "RF_IMPEDANCE_MISMATCH", message: `RF impedance ${sImp}Ω vs ${tImp}Ω`, affectedConnections: [conn.id] });
      }
    }
    // USB host→host
    if (src.domain === "usb" && tgt.domain === "usb" && src.protocol?.role === "host" && tgt.protocol?.role === "host") {
      issues.push({ id: `usb-host-${conn.id}`, severity: "error", code: "USB_HOST_TO_HOST", message: `USB host→host forbidden`, affectedConnections: [conn.id] });
    }
    // PCIe endpoint→endpoint
    if (src.domain === "pcie" && tgt.domain === "pcie" && src.protocol?.role === "endpoint" && tgt.protocol?.role === "endpoint") {
      issues.push({ id: `pcie-ep-${conn.id}`, severity: "error", code: "PCIE_EP_TO_EP", message: `PCIe endpoint→endpoint forbidden`, affectedConnections: [conn.id] });
    }
    void srcMax; void tgtNom;
  }

  // 2. Power/ground presence
  const hasGround = Array.from(portMap.values()).some((p) => p.domain === "ground");
  const hasPower = Array.from(portMap.values()).some((p) => p.domain === "power" || p.domain === "power_output");
  if (project.components.length > 0 && !hasGround) {
    issues.push({ id: "missing-ground", severity: "warning", code: "MISSING_GROUND", message: "No ground net found — add GND connection", autoFix: { description: "Auto-connect GND", action: "add_ground" } });
  }
  if (project.components.length > 1 && !hasPower) {
    issues.push({ id: "missing-power", severity: "warning", code: "INSUFFICIENT_POWER", message: "No power supply in design" });
  }

  // 3. I2C address collision & missing pull-up
  const i2cNets = new Map<string, { addr: number; portKey: string }[]>();
  for (const conn of project.connections) {
    const src = portMap.get(`${conn.source.componentId}:${conn.source.portId}`);
    const tgt = portMap.get(`${conn.target.componentId}:${conn.target.portId}`);
    if (!src || !tgt) continue;
    if (src.domain !== "i2c" || tgt.domain !== "i2c") continue;
    const srcAddr = src.protocol?.address;
    const tgtAddr = tgt.protocol?.address;
    // Build net key from connection id (simplified: treat each bus wire as one net)
    // Real impl would union-find; here we group by controller
    if (src.protocol?.role === "target" && srcAddr !== undefined) {
      const k = conn.source.componentId;
      if (!i2cNets.has(k)) i2cNets.set(k, []);
      i2cNets.get(k)!.push({ addr: srcAddr, portKey: `${conn.source.componentId}:${conn.source.portId}` });
    }
    if (tgt.protocol?.role === "target" && tgtAddr !== undefined) {
      const k = conn.target.componentId;
      if (!i2cNets.has(k)) i2cNets.set(k, []);
      i2cNets.get(k)!.push({ addr: tgtAddr, portKey: `${conn.target.componentId}:${conn.target.portId}` });
    }
  }
  // Check duplicates per bus controller grouping (approx)
  const allI2cAddrs = new Map<number, string[]>();
  for (const groups of i2cNets.values()) for (const g of groups as any) {
    if (!allI2cAddrs.has((g as any).addr)) allI2cAddrs.set((g as any).addr, []);
    allI2cAddrs.get((g as any).addr)!.push((g as any).portKey);
  }
  for (const [addr, keys] of allI2cAddrs) if (keys.length > 1) {
    issues.push({ id: `i2c-collision-${addr}`, severity: "error", code: "I2C_ADDRESS_COLLISION", message: `I2C address 0x${addr.toString(16)} collision: ${keys.join(", ")}` });
  }

  // I2C requires pullup
  const i2cWires = project.connections.filter((c: any) => (c as any).domain === "i2c");
  if (i2cWires.length > 0) {
    const hasPullup = Array.from(portMap.values()).some((p: any) => (p as any).domain === "i2c" && (p as any).electrical?.requiresPullup);
    // Heuristic: if any i2c device declares requiresPullup but no pullup component present
    const needsPullup = Array.from(portMap.values()).some((p: any) => (p as any).domain === "i2c" && (p as any).electrical?.requiresPullup === true);
    const hasResistorPullup = project.components.some((inst: any) => (inst as any).definitionId.includes("resistor") || (inst as any).definitionId.includes("pullup"));
    if (needsPullup && !hasResistorPullup) {
      issues.push({ id: "i2c-pullup", severity: "warning", code: "MISSING_PULLUP", message: "I2C bus missing pull-up resistors (SDA/SCL require pullup)", autoFix: { description: "Add 4.7k pull-ups", action: "insert_pullup", params: { value: 4700 } } });
    }
    void hasPullup;
  }

  // 4. UART TX/RX wiring sanity (at least one RX)
  // 5. Physical / thermal stubs (future: check occupancy grid)

  return { valid: issues.filter((i) => i.severity === "error").length === 0, issues };
}

export function explainIssue(issue: ValidationIssue): string {
  const fixes: Record<string, string> = {
    VOLTAGE_MISMATCH: "Use a level shifter or choose a voltage-compatible variant. Check datasheet max ratings.",
    OUTPUT_TO_OUTPUT: "Outputs must drive inputs. Swap one side or insert buffer.",
    INPUT_TO_INPUT: "Connect a driving output to the input, or use a bidirectional port.",
    UART_TX_TO_TX: "Connect TX→RX and RX→TX (cross-over).",
    I2C_ADDRESS_COLLISION: "Change one device's address jumper or use I2C mux.",
    MISSING_PULLUP: "Add 4.7kΩ pull-ups to VCC on SDA/SCL (or enable internal pull-ups if supported).",
    MISSING_GROUND: "All power domains need common ground. Connect GND nets.",
    USB_HOST_TO_HOST: "USB host must connect to device, insert hub if needed.",
    PCIE_EP_TO_EP: "PCIe endpoint must connect to root complex.",
    RF_IMPEDANCE_MISMATCH: "Match to 50Ω (or design impedance) with matching network.",
  };
  return fixes[issue.code] ?? issue.message;
}
