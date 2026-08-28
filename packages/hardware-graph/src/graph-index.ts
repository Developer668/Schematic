import type {
  ComponentInstance,
  ConnectionEndpoint,
  HardwarePort,
  PortDomain,
} from "./types";

/**
 * The portion of a component definition needed to resolve a project graph.
 * Keeping this boundary small lets callers use catalog records, maps, or
 * another definition registry without coupling the graph package to storage.
 */
export interface HardwareDefinitionLike {
  ports: readonly HardwarePort[];
}

export type HardwareDefinitionLookup =
  | ((definitionId: string) => HardwareDefinitionLike | undefined)
  | ReadonlyMap<string, HardwareDefinitionLike>
  | Readonly<Record<string, HardwareDefinitionLike | undefined>>;

/** The v1 project slice required to derive topology. Persisted schema stays v1. */
export interface HardwareGraphProjectInput {
  components: readonly Pick<ComponentInstance, "id" | "definitionId">[];
  connections: readonly HardwareGraphConnectionInput[];
}

/** A structurally compatible v1 connection, including frontend legacy graphs. */
export interface HardwareGraphConnectionInput {
  id: string;
  source: ConnectionEndpoint;
  target: ConnectionEndpoint;
  domain: string;
}

export type HardwareGraphEndpointMissingReason = "component" | "definition" | "port";

export interface HardwareGraphEndpoint {
  readonly key: string;
  readonly componentId: string;
  readonly portId: string;
  readonly component?: Pick<ComponentInstance, "id" | "definitionId">;
  readonly port?: HardwarePort;
  readonly valid: boolean;
  readonly missing?: HardwareGraphEndpointMissingReason;
}

export interface HardwareGraphConnection {
  readonly connection: HardwareGraphConnectionInput;
  readonly source: HardwareGraphEndpoint;
  readonly target: HardwareGraphEndpoint;
  /** Endpoint pair normalized lexicographically; orientation is not significant. */
  readonly endpointPair: string;
}

export type HardwareNetDomain = PortDomain | "mixed" | "unknown";
export type HardwareNetRail = "power" | "ground" | "signal" | "mixed" | "unknown";

export interface HardwareGraphNet {
  /** Stable for a given set of endpoints, independent of connection order/orientation. */
  readonly id: string;
  /** Lexicographically smallest endpoint key in the net. */
  readonly representative: string;
  /** Canonical domain, or mixed/unknown when topology cannot be treated as one domain. */
  readonly domain: HardwareNetDomain;
  readonly domains: readonly (PortDomain | "unknown")[];
  readonly rail: HardwareNetRail;
  /** Qualified bus signal names such as `i2c:SDA` or `uart:TX`. */
  readonly busSignals: readonly string[];
  readonly endpoints: readonly HardwareGraphEndpoint[];
  readonly connectionIds: readonly string[];
  /** False for an unconnected declared port; invalid references remain inspectable. */
  readonly connected: boolean;
}

export type HardwareGraphDiagnosticCode =
  | "INVALID_COMPONENT_ID"
  | "DUPLICATE_COMPONENT_ID"
  | "UNKNOWN_COMPONENT_DEFINITION"
  | "INVALID_PORT_ID"
  | "INVALID_PORT_DOMAIN"
  | "DUPLICATE_PORT_ID"
  | "MISSING_COMPONENT"
  | "MISSING_PORT"
  | "DUPLICATE_CONNECTION"
  | "SELF_CONNECTION"
  | "INVALID_CONNECTION_DOMAIN"
  | "DOMAIN_MISMATCH"
  | "CONNECTION_DOMAIN_MISMATCH"
  | "MIXED_DOMAIN_NET"
  | "MIXED_RAIL_NET"
  | "BUS_SIGNAL_MISMATCH";

export interface HardwareGraphDiagnostic {
  readonly id: string;
  readonly severity: "error" | "warning" | "info";
  readonly code: HardwareGraphDiagnosticCode;
  readonly message: string;
  readonly connectionIds?: readonly string[];
  readonly componentIds?: readonly string[];
  readonly endpointKeys?: readonly string[];
  readonly netId?: string;
}

export interface HardwareGraphIndex {
  readonly components: readonly Pick<ComponentInstance, "id" | "definitionId">[];
  readonly endpoints: readonly HardwareGraphEndpoint[];
  readonly connections: readonly HardwareGraphConnection[];
  readonly nets: readonly HardwareGraphNet[];
  readonly diagnostics: readonly HardwareGraphDiagnostic[];
  endpoint(reference: ConnectionEndpoint | string): HardwareGraphEndpoint | undefined;
  port(reference: ConnectionEndpoint | string): HardwarePort | undefined;
  netFor(reference: ConnectionEndpoint | string): HardwareGraphNet | undefined;
  /** Returns all other endpoints in the same net, sorted by canonical key. */
  connected(reference: ConnectionEndpoint | string): readonly HardwareGraphEndpoint[];
  netsForDomain(domain: PortDomain): readonly HardwareGraphNet[];
}

const PORT_DOMAINS = new Set<string>([
  "power",
  "power_output",
  "ground",
  "gpio",
  "adc",
  "pwm",
  "i2c",
  "spi",
  "uart",
  "usb",
  "ethernet",
  "can",
  "pcie",
  "csi",
  "hdmi",
  "displayport",
  "rf",
  "mechanical",
  "optical",
]);

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function endpointKey(reference: ConnectionEndpoint) {
  return `${reference.componentId}:${reference.portId}`;
}

/** Returns the canonical key used by the graph index for an endpoint. */
export function hardwareEndpointKey(reference: ConnectionEndpoint) {
  return endpointKey(reference);
}

function diagnosticId(prefix: string, ...parts: string[]) {
  return `${prefix}-${parts.map((part) => encodeURIComponent(part)).join("-")}`;
}

function definitionFromLookup(lookup: HardwareDefinitionLookup, definitionId: string) {
  if (typeof lookup === "function") return lookup(definitionId);
  if (typeof (lookup as ReadonlyMap<string, HardwareDefinitionLike>).get === "function") {
    return (lookup as ReadonlyMap<string, HardwareDefinitionLike>).get(definitionId);
  }
  return (lookup as Readonly<Record<string, HardwareDefinitionLike | undefined>>)[definitionId];
}

function componentSort(left: Pick<ComponentInstance, "id" | "definitionId">, right: Pick<ComponentInstance, "id" | "definitionId">) {
  return compareStrings(left.id, right.id) || compareStrings(left.definitionId, right.definitionId);
}

function portSort(left: HardwarePort, right: HardwarePort) {
  return compareStrings(left.id, right.id)
    || compareStrings(left.name, right.name)
    || compareStrings(left.domain, right.domain)
    || compareStrings(left.direction, right.direction);
}

function connectionSort(left: HardwareGraphConnectionInput, right: HardwareGraphConnectionInput) {
  const leftPair = [endpointKey(left.source), endpointKey(left.target)].sort(compareStrings).join("|");
  const rightPair = [endpointKey(right.source), endpointKey(right.target)].sort(compareStrings).join("|");
  return compareStrings(leftPair, rightPair)
    || compareStrings(left.domain, right.domain)
    || compareStrings(left.id, right.id);
}

function isPowerDomain(domain: string) {
  return domain === "power" || domain === "power_output";
}

function domainsCompatible(left: string, right: string) {
  return left === right || (isPowerDomain(left) && isPowerDomain(right));
}

function connectionDomainMatches(domain: string, left: string, right: string) {
  return PORT_DOMAINS.has(domain) && domainsCompatible(domain, left) && domainsCompatible(domain, right);
}

function canonicalNetDomain(domains: readonly string[]): HardwareNetDomain {
  const known = domains.filter((domain): domain is PortDomain => PORT_DOMAINS.has(domain));
  if (known.length === 0) return "unknown";
  const unique = [...new Set(known)].sort(compareStrings);
  if (unique.every(isPowerDomain)) return "power";
  if (unique.length === 1) return unique[0];
  return "mixed";
}

function canonicalNetRail(domains: readonly string[]): HardwareNetRail {
  const known = domains.filter((domain) => PORT_DOMAINS.has(domain));
  if (known.length === 0) return "unknown";
  const unique = [...new Set(known)];
  if (unique.every(isPowerDomain)) return "power";
  if (unique.every((domain) => domain === "ground")) return "ground";
  if (unique.some((domain) => domain === "ground") || unique.some(isPowerDomain)) return "mixed";
  return unique.length === 1 ? "signal" : "mixed";
}

function busSignalForPort(port: HardwarePort) {
  const name = `${port.id} ${port.name}`.toUpperCase().replace(/[ _-]+/g, " ").trim();
  const firstName = name.split(" ")[0];
  if (port.domain === "i2c") {
    if (firstName === "SDA") return "SDA";
    if (firstName === "SCL") return "SCL";
  }
  if (port.domain === "spi") {
    if (["SCK", "SCLK", "CLK", "CLOCK"].includes(firstName)) return "CLOCK";
    if (["MOSI", "SDI", "SI"].includes(firstName)) return "MOSI";
    if (["MISO", "SDO", "SO"].includes(firstName)) return "MISO";
  }
  if (port.domain === "uart") {
    if (["TX", "TXD"].includes(firstName)) return "TX";
    if (["RX", "RXD"].includes(firstName)) return "RX";
  }
  if (port.domain === "can") {
    if (firstName === "CANH") return "CANH";
    if (firstName === "CANL") return "CANL";
  }
  if (port.domain === "usb") {
    if (["D+", "DP", "DATA+"].includes(firstName)) return "D+";
    if (["D-", "DM", "DATA-"].includes(firstName)) return "D-";
  }
  return undefined;
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(value: string) {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    const parent = this.parent.get(value);
    if (parent === undefined) {
      this.parent.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(leftRoot, rightRoot);
  }
}

function makeEndpoint(
  reference: ConnectionEndpoint,
  componentsById: ReadonlyMap<string, Pick<ComponentInstance, "id" | "definitionId">>,
  definitionsByComponentId: ReadonlyMap<string, HardwareDefinitionLike | undefined>,
  portsByEndpoint: ReadonlyMap<string, HardwarePort>,
): HardwareGraphEndpoint {
  const componentId = typeof reference.componentId === "string" ? reference.componentId : String(reference.componentId ?? "");
  const portId = typeof reference.portId === "string" ? reference.portId : String(reference.portId ?? "");
  const key = endpointKey({ componentId, portId });
  const component = componentsById.get(componentId);
  const definition = component ? definitionsByComponentId.get(component.id) : undefined;
  const port = portsByEndpoint.get(key);
  const missing = !component ? "component" : !definition ? "definition" : !port ? "port" : undefined;
  return { key, componentId, portId, component, port, valid: missing === undefined, ...(missing ? { missing } : {}) };
}

function issueForMissingEndpoint(edge: HardwareGraphConnection, side: "source" | "target") {
  const endpoint = edge[side];
  if (endpoint.valid) return undefined;
  if (endpoint.missing === "component") {
    return {
      id: diagnosticId("missing-component", edge.connection.id, side),
      severity: "error" as const,
      code: "MISSING_COMPONENT" as const,
      message: `Connection ${edge.connection.id} ${side} endpoint ${endpoint.key} references missing component ${endpoint.componentId}.`,
      connectionIds: [edge.connection.id],
      componentIds: [endpoint.componentId],
      endpointKeys: [endpoint.key],
    };
  }
  if (endpoint.missing === "definition") {
    return {
      id: diagnosticId("missing-definition", edge.connection.id, side),
      severity: "error" as const,
      code: "UNKNOWN_COMPONENT_DEFINITION" as const,
      message: `Connection ${edge.connection.id} ${side} endpoint ${endpoint.key} belongs to component ${endpoint.componentId}, whose definition cannot be resolved.`,
      connectionIds: [edge.connection.id],
      componentIds: [endpoint.componentId],
      endpointKeys: [endpoint.key],
    };
  }
  return {
    id: diagnosticId("missing-port", edge.connection.id, side),
    severity: "error" as const,
    code: "MISSING_PORT" as const,
    message: `Connection ${edge.connection.id} ${side} endpoint ${endpoint.key} references a missing port ${endpoint.portId}.`,
    connectionIds: [edge.connection.id],
    componentIds: [endpoint.componentId],
    endpointKeys: [endpoint.key],
  };
}

/**
 * Build a reusable, read-only view of a v1 project graph.
 *
 * Every declared port receives a net, including singleton nets for
 * disconnected ports. Connection edges are then unioned into those nets;
 * invalid edges are still included so callers can inspect and report the
 * complete faulty topology rather than receiving a partially built graph.
 */
export function createHardwareGraphIndex(project: HardwareGraphProjectInput, lookup: HardwareDefinitionLookup): HardwareGraphIndex {
  const diagnostics: HardwareGraphDiagnostic[] = [];
  const components = [...project.components]
    .map((component) => ({ id: component.id, definitionId: component.definitionId }))
    .sort(componentSort);
  const componentsById = new Map<string, Pick<ComponentInstance, "id" | "definitionId">>();

  for (const component of components) {
    if (!component.id) {
      diagnostics.push({
        id: diagnosticId("invalid-component", component.definitionId),
        severity: "error",
        code: "INVALID_COMPONENT_ID",
        message: `Component definition ${component.definitionId} has an empty component id.`,
        componentIds: [component.id],
      });
      continue;
    }
    if (componentsById.has(component.id)) {
      diagnostics.push({
        id: diagnosticId("duplicate-component", component.id),
        severity: "error",
        code: "DUPLICATE_COMPONENT_ID",
        message: `Component id ${component.id} is used more than once; endpoint identity is ambiguous.`,
        componentIds: [component.id],
      });
      continue;
    }
    componentsById.set(component.id, component);
  }

  const definitionsByComponentId = new Map<string, HardwareDefinitionLike | undefined>();
  const portsByEndpoint = new Map<string, HardwarePort>();
  for (const component of [...componentsById.values()].sort(componentSort)) {
    const definition = definitionFromLookup(lookup, component.definitionId);
    definitionsByComponentId.set(component.id, definition);
    if (!definition) {
      diagnostics.push({
        id: diagnosticId("unknown-definition", component.id, component.definitionId),
        severity: "error",
        code: "UNKNOWN_COMPONENT_DEFINITION",
        message: `Unknown component definition ${component.definitionId} for ${component.id}; its ports cannot be resolved.`,
        componentIds: [component.id],
      });
      continue;
    }

    const ports = [...definition.ports].sort(portSort);
    for (const port of ports) {
      const portKey = `${component.id}:${port.id}`;
      if (!port.id) {
        diagnostics.push({
          id: diagnosticId("invalid-port", component.id, port.name),
          severity: "error",
          code: "INVALID_PORT_ID",
          message: `Component ${component.id} has a port with an empty id.`,
          componentIds: [component.id],
        });
        continue;
      }
      if (!PORT_DOMAINS.has(port.domain)) {
        diagnostics.push({
          id: diagnosticId("invalid-port-domain", component.id, port.id),
          severity: "error",
          code: "INVALID_PORT_DOMAIN",
          message: `Port ${portKey} uses unknown domain ${String(port.domain)}.`,
          componentIds: [component.id],
          endpointKeys: [portKey],
        });
      }
      if (portsByEndpoint.has(portKey)) {
        diagnostics.push({
          id: diagnosticId("duplicate-port", component.id, port.id),
          severity: "error",
          code: "DUPLICATE_PORT_ID",
          message: `Component ${component.id} defines port ${port.id} more than once; endpoint identity is ambiguous.`,
          componentIds: [component.id],
          endpointKeys: [portKey],
        });
        continue;
      }
      portsByEndpoint.set(portKey, port);
    }
  }

  const endpointByKey = new Map<string, HardwareGraphEndpoint>();
  for (const component of [...componentsById.values()].sort(componentSort)) {
    const definition = definitionsByComponentId.get(component.id);
    if (!definition) continue;
    for (const port of [...definition.ports].sort(portSort)) {
      const endpoint = makeEndpoint({ componentId: component.id, portId: port.id }, componentsById, definitionsByComponentId, portsByEndpoint);
      if (!endpointByKey.has(endpoint.key)) endpointByKey.set(endpoint.key, endpoint);
    }
  }

  const connections = [...project.connections].sort(connectionSort);
  const indexedConnections: HardwareGraphConnection[] = [];
  const disjointSet = new DisjointSet();
  for (const endpoint of endpointByKey.values()) disjointSet.add(endpoint.key);

  for (const connection of connections) {
    const source = makeEndpoint(connection.source, componentsById, definitionsByComponentId, portsByEndpoint);
    const target = makeEndpoint(connection.target, componentsById, definitionsByComponentId, portsByEndpoint);
    endpointByKey.set(source.key, source);
    endpointByKey.set(target.key, target);
    disjointSet.add(source.key);
    disjointSet.add(target.key);
    disjointSet.union(source.key, target.key);
    const edge: HardwareGraphConnection = {
      connection,
      source,
      target,
      endpointPair: [source.key, target.key].sort(compareStrings).join("|"),
    };
    indexedConnections.push(edge);

    const missingSource = issueForMissingEndpoint(edge, "source");
    const missingTarget = issueForMissingEndpoint(edge, "target");
    if (missingSource) diagnostics.push(missingSource);
    if (missingTarget) diagnostics.push(missingTarget);

    if (source.key === target.key) {
      diagnostics.push({
        id: diagnosticId("self-connection", connection.id),
        severity: "error",
        code: "SELF_CONNECTION",
        message: `Connection ${connection.id} connects endpoint ${source.key} to itself.`,
        connectionIds: [connection.id],
        endpointKeys: [source.key],
      });
    }

    if (!PORT_DOMAINS.has(connection.domain)) {
      diagnostics.push({
        id: diagnosticId("invalid-connection-domain", connection.id),
        severity: "error",
        code: "INVALID_CONNECTION_DOMAIN",
        message: `Connection ${connection.id} uses unknown domain ${String(connection.domain)}.`,
        connectionIds: [connection.id],
      });
    }

    if (source.valid && target.valid && source.port && target.port) {
      if (!domainsCompatible(source.port.domain, target.port.domain)) {
        diagnostics.push({
          id: diagnosticId("domain-mismatch", connection.id),
          severity: "error",
          code: "DOMAIN_MISMATCH",
          message: `Connection ${connection.id} joins incompatible domains ${source.key} (${source.port.domain}) and ${target.key} (${target.port.domain}).`,
          connectionIds: [connection.id],
          endpointKeys: [source.key, target.key].sort(compareStrings),
        });
      }
      if (!connectionDomainMatches(connection.domain, source.port.domain, target.port.domain)) {
        diagnostics.push({
          id: diagnosticId("connection-domain-mismatch", connection.id),
          severity: "error",
          code: "CONNECTION_DOMAIN_MISMATCH",
          message: `Connection ${connection.id} is declared as ${connection.domain}, but its endpoints are ${source.port.domain} and ${target.port.domain}.`,
          connectionIds: [connection.id],
          endpointKeys: [source.key, target.key].sort(compareStrings),
        });
      }
    }
  }

  const duplicateConnectionGroups = new Map<string, string[]>();
  for (const connection of indexedConnections) {
    if (connection.source.key === connection.target.key) continue;
    const ids = duplicateConnectionGroups.get(connection.endpointPair) ?? [];
    ids.push(connection.connection.id);
    duplicateConnectionGroups.set(connection.endpointPair, ids);
  }
  for (const [pair, ids] of duplicateConnectionGroups) {
    const uniqueIds = [...new Set(ids)].sort(compareStrings);
    if (uniqueIds.length < 2) continue;
    diagnostics.push({
      id: diagnosticId("duplicate-connection", pair),
      severity: "error",
      code: "DUPLICATE_CONNECTION",
      message: `Duplicate wires connect the same endpoints: ${pair}.`,
      connectionIds: uniqueIds,
      endpointKeys: pair.split("|"),
    });
  }

  const groups = new Map<string, string[]>();
  for (const key of [...endpointByKey.keys()].sort(compareStrings)) {
    const root = disjointSet.find(key);
    const members = groups.get(root) ?? [];
    members.push(key);
    groups.set(root, members);
  }

  const nets: HardwareGraphNet[] = [];
  const netByEndpoint = new Map<string, HardwareGraphNet>();
  for (const members of groups.values()) {
    const endpointKeys = [...members].sort(compareStrings);
    const representative = endpointKeys[0];
    const id = `net:${representative}`;
    const netConnections = indexedConnections
      .filter((connection) => endpointKeys.includes(connection.source.key) || endpointKeys.includes(connection.target.key))
      .map((connection) => connection.connection.id)
      .sort(compareStrings);
    const netEndpoints = endpointKeys.map((key) => endpointByKey.get(key)!).sort((left, right) => compareStrings(left.key, right.key));
    const domains = [...new Set(netEndpoints.map((endpoint) => endpoint.port?.domain ?? "unknown"))].sort(compareStrings) as (PortDomain | "unknown")[];
    const busSignals = [...new Set(netEndpoints.flatMap((endpoint) => {
      if (!endpoint.port) return [];
      const signal = busSignalForPort(endpoint.port);
      return signal ? [`${endpoint.port.domain}:${signal}`] : [];
    }))].sort(compareStrings);
    const net: HardwareGraphNet = {
      id,
      representative,
      domain: canonicalNetDomain(domains),
      domains,
      rail: canonicalNetRail(domains),
      busSignals,
      endpoints: netEndpoints,
      connectionIds: [...new Set(netConnections)],
      connected: netConnections.length > 0,
    };
    nets.push(net);
    for (const key of endpointKeys) netByEndpoint.set(key, net);

    const knownDomains = domains.filter((domain): domain is PortDomain => domain !== "unknown");
    const uniqueKnownDomains = [...new Set(knownDomains)];
    if (uniqueKnownDomains.some((domain) => domain === "ground") && uniqueKnownDomains.some((domain) => isPowerDomain(domain))) {
      diagnostics.push({
        id: diagnosticId("mixed-rail-net", id),
        severity: "error",
        code: "MIXED_RAIL_NET",
        message: `Net ${id} mixes ground with a power rail (${uniqueKnownDomains.sort(compareStrings).join(", ")}).`,
        netId: id,
        endpointKeys,
        connectionIds: net.connectionIds,
      });
    } else if (uniqueKnownDomains.length > 1 && !uniqueKnownDomains.every(isPowerDomain)) {
      diagnostics.push({
        id: diagnosticId("mixed-domain-net", id),
        severity: "error",
        code: "MIXED_DOMAIN_NET",
        message: `Net ${id} mixes incompatible domains: ${uniqueKnownDomains.sort(compareStrings).join(", ")}.`,
        netId: id,
        endpointKeys,
        connectionIds: net.connectionIds,
      });
    }

    const busSignalsByDomain = new Map<string, string[]>();
    for (const qualifiedSignal of busSignals) {
      const separator = qualifiedSignal.indexOf(":");
      const domain = qualifiedSignal.slice(0, separator);
      const signal = qualifiedSignal.slice(separator + 1);
      const signals = busSignalsByDomain.get(domain) ?? [];
      signals.push(signal);
      busSignalsByDomain.set(domain, signals);
    }
    for (const [domain, signals] of busSignalsByDomain) {
      const uniqueSignals = [...new Set(signals)].sort(compareStrings);
      if (uniqueSignals.length < 2) continue;
      diagnostics.push({
        id: diagnosticId("bus-signal-mismatch", id, domain),
        severity: "error",
        code: "BUS_SIGNAL_MISMATCH",
        message: `Net ${id} mixes ${domain} bus signals: ${uniqueSignals.join(", ")}.`,
        netId: id,
        endpointKeys,
        connectionIds: net.connectionIds,
      });
    }
  }

  nets.sort((left, right) => compareStrings(left.id, right.id));
  const endpointList = [...endpointByKey.values()].sort((left, right) => compareStrings(left.key, right.key));
  const diagnosticList = diagnostics.sort((left, right) => compareStrings(left.id, right.id));

  return {
    components: [...componentsById.values()].sort(componentSort),
    endpoints: endpointList,
    connections: indexedConnections,
    nets,
    diagnostics: diagnosticList,
    endpoint(reference) {
      const key = typeof reference === "string" ? reference : endpointKey(reference);
      return endpointByKey.get(key);
    },
    port(reference) {
      const key = typeof reference === "string" ? reference : endpointKey(reference);
      return endpointByKey.get(key)?.port;
    },
    netFor(reference) {
      const key = typeof reference === "string" ? reference : endpointKey(reference);
      return netByEndpoint.get(key);
    },
    connected(reference) {
      const key = typeof reference === "string" ? reference : endpointKey(reference);
      const net = netByEndpoint.get(key);
      return net ? net.endpoints.filter((endpoint) => endpoint.key !== key) : [];
    },
    netsForDomain(domain) {
      return nets.filter((net) => net.domain === domain || net.domains.includes(domain));
    },
  };
}
