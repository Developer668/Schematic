/**
 * WebMCP tool surface — semantic hardware tools via document.modelContext.registerTool
 * Per HardwareWebMCP.md: don't expose 100 tiny tools, expose powerful semantic ones.
 * Human click and AI call share same underlying Zustand functions.
 */
import { layoutComponentPositions, MAX_PROJECTS_PER_WORKSPACE, MAX_WORKSPACE_SERIALIZED_BYTES, ConnectionValidationError, WorkspaceCapacityError, useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";
import { useWorkspaceStore, type BottomPanel } from "../store/useWorkspaceStore.ts";
import { useValidationStore, validateProject } from "../store/useValidationStore.ts";
import { useWebMCPStore } from "../store/useWebMCPStore.ts";
import { createShoppingHandoff, MAX_SHOPPING_QUERY_LENGTH, useShoppingStore, type AgentPublication, type PartOffer, type ShoppingDiscovery, type ShoppingResult } from "../store/useShoppingStore.ts";
import {
  flushProjectPersistence,
  getProjectPersistenceContext,
  getProjectPersistenceStatus,
  isCurrentProjectPersistenceContext,
  waitForProjectPersistence,
} from "../store/projectPersistence.ts";
import { PersistenceNotReadyError, type PersistenceContextToken } from "../store/persistenceGate.ts";
import { getCatalogComponent, searchCatalog } from "../data/catalog.ts";
import { isBoardDefinition } from "../data/hardware.ts";
import { explainIssue } from "@schematic/validation";
import { apiUrl, getAuthHeaders, getAuthSession, getCurrentUserId, waitForAuth } from "../auth/session.ts";
import metaGlassesBlueprint from "../../../examples/demo4-meta-glasses/project.json";
import { behaviorToolDefinitions } from "./behaviorTools.ts";
import { getBehaviorState, readCode, writeCode } from "../application/behaviorCommands.ts";
import { ensureStarterPlanForAgentBuild } from "../behavior/starterPlan.ts";

type ToolAnnotations = {
  readOnlyHint?: boolean;
  /** The operation can irreversibly remove user-created state. */
  destructiveHint?: boolean;
  /** Result may contain content supplied by an external provider or agent. */
  untrustedContentHint?: boolean;
};

type ToolExecutionContext = { signal?: AbortSignal; persistenceContext?: PersistenceContextToken | null };

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: any, context?: ToolExecutionContext) => Promise<any>;
  annotations?: ToolAnnotations;
};

type ApiJsonResult = {
  response: Response | null;
  data: any;
  available: boolean;
  error?: string;
};

type TrustedToolContext = {
  authenticated: true;
  subject: string;
  environment: string;
};

const MAX_TOOL_IDENTIFIER_LENGTH = 200;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const GRAPH_VALIDATION_NOTICE = "Static graph checks only; physical wiring, hardware behavior, and editable source remain unverified.";

function boundedToolIdentifier(value: unknown) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= MAX_TOOL_IDENTIFIER_LENGTH
    && !hasShoppingControlCharacters(value);
}

function validSha256(value: unknown) {
  return value === null || (typeof value === "string" && SHA256_PATTERN.test(value));
}

function toolFailure(code: string, message: string, data: Record<string, unknown> = {}, retryable = false) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    error: { code, message, retryable },
    data: { code, ...data },
  };
}

function workspaceCapacityFailure(action: string, cause: unknown) {
  if (!(cause instanceof WorkspaceCapacityError)) return null;
  const state = useProjectStore.getState();
  return toolFailure(
    "WORKSPACE_CAPACITY",
    `${action} was blocked: ${cause.message}`,
    {
      scope: "workspace",
      projectCount: state.projects.length,
      maxProjects: MAX_PROJECTS_PER_WORKSPACE,
      maxSerializedBytes: MAX_WORKSPACE_SERIALIZED_BYTES,
      unchanged: true,
      hint: "Delete an unused project or export the room before retrying.",
    },
  );
}

function persistenceNotReadyFailure(cause: unknown) {
  if (!(cause instanceof PersistenceNotReadyError)) return null;
  return toolFailure(
    "PERSISTENCE_NOT_READY",
    cause.message,
    { unchanged: true, hint: "Wait for the active account room to finish loading, then re-read the project before retrying." },
    true,
  );
}

async function persistProjectMutation(action: string, projectId: string) {
  const stored = await flushProjectPersistence();
  const status = getProjectPersistenceStatus();
  if (status.error) {
    return {
      failure: toolFailure(
        "PROJECT_PERSISTENCE_FAILED",
        `${action} was applied to the current tab and fallback snapshot, but the device-local project repository could not be updated: ${status.error}`,
        { projectId, locallyApplied: true, backend: status.backend },
      ),
    };
  }
  return {
    persistence: stored ? "flushed" : status.hydrated ? "already-current" : "local-snapshot-only",
    revision: stored?.metadata.revision ?? status.revision,
  };
}

function connectionEndpointDetails(project: HardwareGraph, componentId: string, portId: string) {
  const component = project.components.find((item) => item.id === componentId);
  const definition = component ? getCatalogComponent(component.definitionId) : undefined;
  const port = definition?.ports.find((item) => item.id === portId);
  return {
    componentId,
    portId,
    exists: Boolean(component && port),
    definitionId: component?.definitionId,
    port: port ? { id: port.id, name: port.name, domain: port.domain, direction: port.direction } : undefined,
  };
}

function connectionFailure(error: unknown, requested: { source: { componentId: string; portId: string }; target: { componentId: string; portId: string } }, project: HardwareGraph) {
  const message = error instanceof Error ? error.message : String(error);
  const source = connectionEndpointDetails(project, requested.source.componentId, requested.source.portId);
  const target = connectionEndpointDetails(project, requested.target.componentId, requested.target.portId);
  const graphIssue = error instanceof ConnectionValidationError ? error.issues[0] : undefined;
  const graphCode = graphIssue?.code;
  const code = graphCode === "MISSING_ENDPOINT" || message.includes("existing component ports")
    ? "ENDPOINT_NOT_FOUND"
    : graphCode === "SELF_CONNECTION" || message.includes("itself")
      ? "SELF_CONNECTION"
      : graphCode === "DUPLICATE_CONNECTION" || message.includes("already connected")
        ? "DUPLICATE_CONNECTION"
        : graphCode === "DOMAIN_MISMATCH" || graphCode === "CONNECTION_DOMAIN_MISMATCH" || message.includes("Incompatible domains")
          ? "INCOMPATIBLE_DOMAINS"
          : graphCode ?? "CONNECTION_REJECTED";
  const hint = graphIssue
    ? explainIssue(graphIssue as unknown as Parameters<typeof explainIssue>[0])
    : code === "ENDPOINT_NOT_FOUND"
      ? "Use the instance id returned by component.add and a port id returned by component.list_ports."
      : code === "INCOMPATIBLE_DOMAINS"
        ? "The graph keeps typed electrical domains strict; choose compatible ports or add the required interface/level-shifter component."
        : code === "DUPLICATE_CONNECTION"
          ? "Read connection.get_connections before retrying; the wire may already exist even if the canvas did not refresh."
          : undefined;
  return toolFailure(code, `Connection failed [${code}]: ${message}${hint ? ` ${hint}` : ""}`, {
    requested,
    endpoints: { source, target },
    ...(error instanceof ConnectionValidationError ? { diagnostics: error.issues } : {}),
    ...(hint ? { hint } : {}),
  });
}

const BLUEPRINTS: Record<string, unknown> = { "meta-glasses": metaGlassesBlueprint };

function cloneProject(source: unknown): HardwareGraph {
  return JSON.parse(JSON.stringify(source)) as HardwareGraph;
}

function abortError() {
  try {
    return new DOMException("The WebMCP tool call was aborted", "AbortError");
  } catch {
    const error = new Error("The WebMCP tool call was aborted");
    error.name = "AbortError";
    return error;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return Boolean(value && typeof value === "object" && "aborted" in value && "addEventListener" in value);
}

function executionSignal(value: unknown): AbortSignal | undefined {
  if (isAbortSignal(value)) return value;
  if (value && typeof value === "object" && isAbortSignal((value as { signal?: unknown }).signal)) return (value as { signal: AbortSignal }).signal;
  return undefined;
}

function persistenceContextStillCurrent(context: PersistenceContextToken | null | undefined) {
  // Direct unit/degraded-runtime calls do not have a mounted persistence
  // owner, so they intentionally retain the in-memory behaviour.
  return context === undefined || isCurrentProjectPersistenceContext(context);
}

/**
 * Pages serves the SPA fallback for unknown /api routes. Read the body once
 * and identify that case before calling JSON.parse, so WebMCP gets a useful
 * result instead of "Unexpected end of JSON input".
 */
export async function fetchJson(path: string, init?: RequestInit): Promise<ApiJsonResult> {
  throwIfAborted(init?.signal ?? undefined);
  try {
    const request = async (authHeaders: Record<string, string>) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
      for (const [key, value] of Object.entries(authHeaders)) headers.set(key, value);
      return fetch(apiUrl(path), { credentials: "include", ...init, headers });
    };
    let response = await request(await getAuthHeaders(false, init?.signal || undefined));
    throwIfAborted(init?.signal ?? undefined);
    // A Site session is intentionally short-lived. Retry one time with a
    // freshly issued session so an agent action does not fail just because a
    // tab was left open. All current WebMCP requests use replayable JSON
    // bodies; avoid replaying an arbitrary streaming request.
    if (response.status === 401 && (!init?.body || typeof init.body === "string")) {
      response = await request(await getAuthHeaders(true, init?.signal || undefined));
    }
    const responseText = typeof response.text === "function" ? await response.text() : null;

    if (responseText !== null) {
      throwIfAborted(init?.signal ?? undefined);
      if (!responseText.trim()) {
        return { response, data: null, available: false, error: `API ${path} returned an empty response` };
      }
      try {
        return { response, data: JSON.parse(responseText), available: true };
      } catch {
        return { response, data: null, available: false, error: `API ${path} returned non-JSON content` };
      }
    }

    // Lightweight fetch mocks and older WebViews may only expose response.json().
    const data = await response.json();
    throwIfAborted(init?.signal ?? undefined);
    return { response, data, available: true };
  } catch (e) {
    if (init?.signal?.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
    return { response: null, data: null, available: false, error: (e as Error).message };
  }
}

function normalizeShoppingResults(raw: unknown, _query: string, quantity: number): ShoppingResult[] {
  const entries = Array.isArray(raw) ? raw : [];
  return entries.slice(0, 24).map((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, any> : {};
    // This is intentionally a shape conversion only. It never invents a
    // catalog identity, retailer, URL, price, timestamp, or provenance. The
    // shopping store rejects incomplete records before they reach the UI.
    const catalogId = String(item.catalogId ?? item.componentId ?? "").trim();
    const catalogDefinition = getCatalogComponent(catalogId);
    const exactMatch = item.exactMatch === true && Boolean(catalogDefinition);
    const title = String(item.title ?? "").trim();
    const partNumber = String(item.partNumber ?? "").trim();
    const rawOffers = Array.isArray(item.offers) ? item.offers : [];
    const offers = rawOffers.slice(0, 3).map((rawOffer: any) => {
      const offer = rawOffer && typeof rawOffer === "object" ? rawOffer as Record<string, any> : {};
      const parsedPrice = typeof offer.price === "number" ? offer.price : typeof offer.price === "string" && offer.price.trim() ? Number(offer.price) : null;
      return {
        id: String(offer.id ?? "").trim(),
        retailer: String(offer.retailer ?? offer.source ?? "").trim(),
        title: String(offer.title ?? "").trim(),
        price: typeof parsedPrice === "number" && Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null,
        currency: String(offer.currency ?? "").trim(),
        url: String(offer.url ?? "").trim(),
        availability: offer.availability ? String(offer.availability) : undefined,
        fetchedAt: String(offer.fetchedAt ?? "").trim(),
        provider: String(offer.provider ?? "").trim(),
      } satisfies PartOffer;
    });
    const alternatives = (Array.isArray(item.alternatives) ? item.alternatives : []).slice(0, 3).map((alternative: any) => ({
      catalogId: String(alternative.catalogId ?? alternative.id ?? ""),
      title: String(alternative.title ?? alternative.name ?? "Alternative part"),
      reason: String(alternative.reason ?? "Verify electrical limits and footprint before substituting."),
      resultId: alternative.resultId ? String(alternative.resultId) : undefined,
    })).filter((alternative: { catalogId: string }) => alternative.catalogId);
    return {
      id: String(item.resultId ?? item.id ?? "").trim(),
      catalogId,
      title,
      manufacturer: item.manufacturer ? String(item.manufacturer).trim() : catalogDefinition?.manufacturer,
      partNumber,
      requestedQuantity: Math.max(1, Math.round(Number(item.requestedQuantity ?? quantity))),
      exactMatch,
      matchNote: item.matchNote ? String(item.matchNote) : undefined,
      offers,
      alternatives,
      updatedAt: String(item.updatedAt ?? "").trim(),
      provenance: item.provenance && typeof item.provenance === "object" ? {
        source: item.provenance.source,
        provider: String(item.provenance.provider ?? "").trim(),
        agentId: String(item.provenance.agentId ?? "").trim(),
        publishedAt: String(item.provenance.publishedAt ?? "").trim(),
      } : { source: "webmcp-agent", provider: "", agentId: "", publishedAt: "" },
    };
  });
}

function bindShoppingPublication(results: ShoppingResult[], publication: AgentPublication, trustedAuth: TrustedToolContext) {
  // The agent supplies sourcing provenance, while identity is bound to the
  // session that invoked the tool. Never require or trust a caller-provided
  // user/agent id; that would make the publication boundary self-asserted.
  return results.map((result) => ({
    ...result,
    provenance: {
      source: "webmcp-agent" as const,
      provider: publication.provider,
      agentId: `webmcp:${trustedAuth.environment}:${trustedAuth.subject}`,
      publishedAt: publication.publishedAt,
    },
  }));
}

function normalizeShoppingDiscovery(raw: unknown): ShoppingDiscovery | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const rawCandidates = Array.isArray(value.candidates) ? value.candidates : [];
  const candidates = rawCandidates.slice(0, 24).flatMap((entry): ShoppingDiscovery["candidates"] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const source = item.source === "jlcsearch" || item.source === "adafruit" ? item.source : null;
    const id = String(item.id ?? "").trim();
    const sourcePartId = String(item.sourcePartId ?? "").trim();
    const title = String(item.title ?? "").trim();
    const partNumber = String(item.partNumber ?? "").trim();
    const verificationUrl = String(item.verificationUrl ?? "").trim();
    if (!source
      || !shoppingText(id, 160)
      || !shoppingText(sourcePartId, 160)
      || !shoppingText(title, 240)
      || !shoppingText(partNumber, 160)
      || !shoppingText(verificationUrl, 2_000)
      || item.verificationRequired !== true) return [];
    try {
      const url = new URL(verificationUrl);
      if (url.protocol !== "https:") return [];
    } catch { return []; }
    const price = item.price === null ? null : Number(item.price);
    const stock = item.stock === null ? null : Number(item.stock);
    if ((price !== null && (!Number.isFinite(price) || price < 0)) || (stock !== null && (!Number.isFinite(stock) || stock < 0))) return [];
    const currency = item.currency === null ? null : String(item.currency ?? "").trim().toUpperCase();
    if (currency !== null && !/^[A-Z]{3}$/.test(currency)) return [];
    return [{
      id,
      source,
      sourcePartId,
      title,
      ...(item.manufacturer ? { manufacturer: String(item.manufacturer).trim().slice(0, 120) } : {}),
      partNumber,
      ...(item.package ? { package: String(item.package).trim().slice(0, 100) } : {}),
      ...(item.description ? { description: String(item.description).trim().slice(0, 300) } : {}),
      stock,
      ...(item.availability ? { availability: String(item.availability).trim().slice(0, 80) } : {}),
      price,
      currency,
      verificationUrl,
      verificationRequired: true as const,
    }];
  });
  const rawAttempts = Array.isArray(value.attempts) ? value.attempts : [];
  const attempts = rawAttempts.slice(0, 8).flatMap((entry): ShoppingDiscovery["attempts"] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const source = ["jlcsearch", "adafruit", "request"].includes(String(item.source)) ? String(item.source) as ShoppingDiscovery["attempts"][number]["source"] : null;
    const status = ["success", "empty", "error", "timeout", "rate_limited", "circuit_open", "skipped"].includes(String(item.status)) ? String(item.status) as ShoppingDiscovery["attempts"][number]["status"] : null;
    if (!source || !status) return [];
    return [{ source, status, durationMs: Math.max(0, Number(item.durationMs) || 0), resultCount: Math.max(0, Math.min(24, Number(item.resultCount) || 0)), ...(item.cache === "fresh" || item.cache === "stale" ? { cache: item.cache } : {}), ...(item.retryAfterSeconds ? { retryAfterSeconds: Math.max(1, Number(item.retryAfterSeconds)) } : {}), ...(item.message ? { message: String(item.message).slice(0, 180) } : {}) }];
  });
  return {
    candidates,
    sourceOrder: Array.isArray(value.sourceOrder) ? value.sourceOrder.map(String).slice(0, 8) : ["jlcsearch", "adafruit", "web-search"],
    attempts,
    cacheHit: value.cacheHit === true,
    staleCache: value.staleCache === true,
    rateLimited: value.rateLimited === true,
    ...(value.retryAfterSeconds ? { retryAfterSeconds: Math.max(1, Number(value.retryAfterSeconds)) } : {}),
    message: String(value.message ?? "Public candidates are ready for agent verification.").slice(0, 240),
  };
}

type ShoppingPublicationIssue = {
  code: "MALFORMED_PUBLICATION" | "STALE_PUBLICATION" | "MALFORMED_LISTING" | "NON_CANONICAL_CATALOG_ID" | "NON_EXACT_MATCH" | "NON_HTTPS_OFFER" | "PUBLICATION_PROVIDER_MISMATCH";
  message: string;
  listingIndex?: number;
  offerIndex?: number;
};

const SHOPPING_MAX_LISTINGS = 24;
const SHOPPING_MAX_OFFERS = 3;
const SHOPPING_MAX_ALTERNATIVES = 3;
const SHOPPING_MAX_PUBLICATION_BYTES = 128 * 1024;
const SHOPPING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SHOPPING_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function hasShoppingControlCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function shoppingText(value: unknown, maxLength = 240): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !hasShoppingControlCharacters(value);
}

function shoppingTimestampStatus(value: unknown, now: number): "valid" | "malformed" | "stale" {
  if (typeof value !== "string" || !value.trim()) return "malformed";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "malformed";
  if (parsed < now - SHOPPING_MAX_AGE_MS || parsed > now + SHOPPING_MAX_FUTURE_SKEW_MS) return "stale";
  return "valid";
}

function shoppingHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function shoppingPublicationIssues(listings: unknown, publication: unknown): ShoppingPublicationIssue[] {
  const now = Date.now();
  const issues: ShoppingPublicationIssue[] = [];
  const publicationObject = publication && typeof publication === "object" && !Array.isArray(publication)
    ? publication as Record<string, unknown>
    : null;
  const provider = publicationObject?.provider;
  const publishedAt = publicationObject?.publishedAt;

  try {
    if (new TextEncoder().encode(JSON.stringify({ listings, publication })).byteLength > SHOPPING_MAX_PUBLICATION_BYTES) {
      issues.push({ code: "MALFORMED_PUBLICATION", message: `Shopping publication data may contain at most ${SHOPPING_MAX_PUBLICATION_BYTES} bytes.` });
      return issues;
    }
  } catch {
    issues.push({ code: "MALFORMED_PUBLICATION", message: "Shopping publication must be finite JSON data." });
    return issues;
  }

  if (!publicationObject || !shoppingText(provider, 120) || !shoppingText(publishedAt, 80)) {
    issues.push({ code: "MALFORMED_PUBLICATION", message: "Publication must contain non-empty provider and publishedAt strings." });
    return issues;
  }
  const publicationTimestamp = shoppingTimestampStatus(publishedAt, now);
  if (publicationTimestamp === "malformed") {
    issues.push({ code: "MALFORMED_PUBLICATION", message: "publication.publishedAt must be a valid date-time string." });
  } else if (publicationTimestamp === "stale") {
    issues.push({ code: "STALE_PUBLICATION", message: "Publication timestamps must be within the last 24 hours and no more than five minutes in the future." });
  }

  if (!Array.isArray(listings) || listings.length < 1 || listings.length > SHOPPING_MAX_LISTINGS) {
    issues.push({ code: "MALFORMED_LISTING", message: `listings must contain 1–${SHOPPING_MAX_LISTINGS} listing objects.` });
    return issues;
  }

  const listingIds = new Set<string>();
  listings.forEach((rawListing, listingIndex) => {
    const listing = rawListing && typeof rawListing === "object" && !Array.isArray(rawListing)
      ? rawListing as Record<string, unknown>
      : null;
    if (!listing
      || !shoppingText(listing.id, 160)
      || !shoppingText(listing.catalogId, 120)
      || !shoppingText(listing.title)
      || !shoppingText(listing.partNumber, 160)
      || (listing.manufacturer !== undefined && !shoppingText(listing.manufacturer, 160))
      || (listing.matchNote !== undefined && !shoppingText(listing.matchNote, 500))
      || !Number.isInteger(listing.requestedQuantity)
      || Number(listing.requestedQuantity) < 1
      || Number(listing.requestedQuantity) > 999
      || !Array.isArray(listing.offers)
      || listing.offers.length < 1
      || listing.offers.length > SHOPPING_MAX_OFFERS) {
      issues.push({ code: "MALFORMED_LISTING", message: `Listing ${listingIndex + 1} is missing a strictly typed required field or has an invalid offer count.`, listingIndex });
      return;
    }
    if (listing.alternatives !== undefined) {
      if (!Array.isArray(listing.alternatives) || listing.alternatives.length > SHOPPING_MAX_ALTERNATIVES || listing.alternatives.some((rawAlternative) => {
        const alternative = rawAlternative && typeof rawAlternative === "object" && !Array.isArray(rawAlternative) ? rawAlternative as Record<string, unknown> : null;
        return !alternative
          || !shoppingText(alternative.catalogId, 120)
          || !getCatalogComponent(alternative.catalogId)
          || !shoppingText(alternative.title, 240)
          || !shoppingText(alternative.reason, 500)
          || (alternative.resultId !== undefined && !shoppingText(alternative.resultId, 160));
      })) {
        issues.push({ code: "MALFORMED_LISTING", message: `Listing ${listingIndex + 1} contains invalid or oversized alternatives.`, listingIndex });
        return;
      }
    }
    const listingId = listing.id as string;
    const catalogId = listing.catalogId as string;
    const offers = listing.offers as unknown[];
    if (listingIds.has(listingId)) {
      issues.push({ code: "MALFORMED_LISTING", message: `Listing ${listingIndex + 1} reuses another listing id.`, listingIndex });
      return;
    }
    listingIds.add(listingId);
    if (catalogId !== catalogId.trim() || !getCatalogComponent(catalogId)) {
      issues.push({ code: "NON_CANONICAL_CATALOG_ID", message: `Listing ${listingIndex + 1} must use an existing canonical Schematic catalogId.`, listingIndex });
    }
    if (listing.exactMatch !== true) {
      issues.push({ code: "NON_EXACT_MATCH", message: `Listing ${listingIndex + 1} must assert exactMatch=true only after exact catalog verification.`, listingIndex });
    }
    const updatedAtStatus = shoppingTimestampStatus(listing.updatedAt, now);
    if (updatedAtStatus === "malformed") {
      issues.push({ code: "MALFORMED_LISTING", message: `Listing ${listingIndex + 1} updatedAt must be a valid date-time string.`, listingIndex });
    } else if (updatedAtStatus === "stale") {
      issues.push({ code: "STALE_PUBLICATION", message: `Listing ${listingIndex + 1} has a stale updatedAt timestamp.`, listingIndex });
    }

    const retailers = new Set<string>();
    offers.forEach((rawOffer, offerIndex) => {
      const offer = rawOffer && typeof rawOffer === "object" && !Array.isArray(rawOffer)
        ? rawOffer as Record<string, unknown>
        : null;
      if (!offer
        || !shoppingText(offer.id, 160)
        || !shoppingText(offer.retailer, 160)
        || !shoppingText(offer.title)
        || !(offer.price === null || (typeof offer.price === "number" && Number.isFinite(offer.price) && offer.price >= 0))
        || typeof offer.currency !== "string"
        || !/^[A-Z]{3}$/.test(offer.currency)
        || typeof offer.url !== "string"
        || offer.url.length > 2_000
        || (offer.availability !== undefined && !shoppingText(offer.availability, 160))
        || !shoppingText(offer.fetchedAt, 80)
        || !shoppingText(offer.provider, 120)) {
        issues.push({ code: "MALFORMED_LISTING", message: `Offer ${offerIndex + 1} in listing ${listingIndex + 1} is not strict JSON listing data.`, listingIndex, offerIndex });
        return;
      }
      const retailerName = offer.retailer as string;
      const offerProvider = offer.provider as string;
      if (!shoppingHttpsUrl(offer.url)) {
        issues.push({ code: "NON_HTTPS_OFFER", message: `Offer ${offerIndex + 1} in listing ${listingIndex + 1} must use an HTTPS retailer URL without embedded credentials.`, listingIndex, offerIndex });
      }
      const retailer = retailerName.toLowerCase();
      if (retailers.has(retailer)) {
        issues.push({ code: "MALFORMED_LISTING", message: `Listing ${listingIndex + 1} contains duplicate retailer offers.`, listingIndex, offerIndex });
      }
      retailers.add(retailer);
      if (offerProvider !== provider) {
        issues.push({ code: "PUBLICATION_PROVIDER_MISMATCH", message: `Offer ${offerIndex + 1} in listing ${listingIndex + 1} must use the publication provider string exactly.`, listingIndex, offerIndex });
      }
      const fetchedAtStatus = shoppingTimestampStatus(offer.fetchedAt, now);
      if (fetchedAtStatus === "malformed") {
        issues.push({ code: "MALFORMED_LISTING", message: `Offer ${offerIndex + 1} in listing ${listingIndex + 1} fetchedAt must be a valid date-time string.`, listingIndex, offerIndex });
      } else if (fetchedAtStatus === "stale") {
        issues.push({ code: "STALE_PUBLICATION", message: `Offer ${offerIndex + 1} in listing ${listingIndex + 1} has a stale fetchedAt timestamp.`, listingIndex, offerIndex });
      }
    });
  });
  return issues;
}

function shoppingError(code: string, message: string, data: Record<string, unknown>) {
  const result = toolFailure(code, message, data);
  return {
    ...result,
    // Keep the handoff/error payload machine-readable for a browsing agent;
    // provider and retailer strings remain data under untrustedContentHint.
    content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
  };
}

function publicProjectGraph(graph: HardwareGraph) {
  const {
    firmwareTargets,
    codeDocuments,
    legacyBehaviorData: _legacyBehaviorData,
    simulation: _retiredSimulationConfig,
    ...publicGraph
  } = graph;
  const fileMetadata = (files: readonly { name: string; content: string }[]) => files.map((file) => ({
    name: file.name,
    byteLength: new TextEncoder().encode(file.content).byteLength,
  }));
  return {
    ...publicGraph,
    firmwareTargets: firmwareTargets.map(({ compiledArtifact: _compiledArtifact, files, ...target }) => ({ ...target, files: fileMetadata(files) })),
    ...(codeDocuments ? {
      codeDocuments: codeDocuments.map(({ files, ...document }) => ({ ...document, files: fileMetadata(files) })),
    } : {}),
    sourceAccess: "Source contents are excluded. Use code.read for one explicit source document.",
  };
}

const tools: ToolDef[] = [
  ...behaviorToolDefinitions,
  {
    name: "project.get_graph",
    description: "Get the current hardware graph and source-document metadata. Source contents and quarantined legacy data are excluded; use code.read for source.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const g = publicProjectGraph(useProjectStore.getState().getGraph());
      return { content: [{ type: "text", text: JSON.stringify(g, null, 2) }], data: g };
    },
  },
  {
    name: "project.list",
    description: "List all projects saved in this browser and identify the active project",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const state = useProjectStore.getState();
      const projects = state.listProjects().map((project) => ({ id: project.id, name: project.name, components: project.components.length, connections: project.connections.length, firmwareTargets: project.firmwareTargets.length, updatedAt: project.updatedAt }));
      return { content: [{ type: "text", text: JSON.stringify({ activeProjectId: state.activeProjectId, projects }, null, 2) }], data: { activeProjectId: state.activeProjectId, projects } };
    },
  },
  {
    name: "project.create",
    description: "Create and activate a new empty hardware project saved in this browser",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
    execute: async ({ name }) => {
      let projectId: string;
      try {
        projectId = useProjectStore.getState().createProject(name ?? "Untitled");
      } catch (cause) {
        const failure = workspaceCapacityFailure("Creating a project", cause);
        if (failure) return failure;
        throw cause;
      }
      const created = useProjectStore.getState().project;
      return { content: [{ type: "text", text: `Created project ${created.name}` }], data: { projectId, name: created.name } };
    },
  },
  {
    name: "project.switch",
    description: "Switch the active project; the selected project becomes live in every same-origin Schematic tab",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
    execute: async ({ projectId }) => {
      const switched = useProjectStore.getState().switchProject(projectId);
      if (!switched) return { content: [{ type: "text", text: `Unknown project ${projectId}` }], isError: true };
      const project = useProjectStore.getState().project;
      return { content: [{ type: "text", text: `Switched to ${project.name}` }], data: { projectId, name: project.name } };
    },
  },
  {
    name: "project.duplicate",
    description: "Duplicate a saved project and activate the copy",
    inputSchema: { type: "object", properties: { projectId: { type: "string" }, name: { type: "string" } } },
    execute: async ({ projectId, name }) => {
      let duplicateId: string | null;
      try {
        duplicateId = useProjectStore.getState().duplicateProject(projectId, name);
      } catch (cause) {
        const failure = workspaceCapacityFailure("Duplicating the project", cause);
        if (failure) return failure;
        throw cause;
      }
      if (!duplicateId) return { content: [{ type: "text", text: `Unknown project ${projectId ?? ""}` }], isError: true };
      const duplicate = useProjectStore.getState().projects.find((project) => project.id === duplicateId);
      return { content: [{ type: "text", text: `Duplicated project as ${duplicate?.name ?? duplicateId}` }], data: { projectId: duplicateId, name: duplicate?.name } };
    },
  },
  {
    name: "project.delete",
    description: "Delete one saved project after confirming its exact id; the final remaining project cannot be deleted",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Exact id of the project to delete" },
        confirmProjectId: { type: "string", description: "Repeat the exact project id to confirm this irreversible operation" },
      },
      required: ["projectId", "confirmProjectId"],
    },
    annotations: { destructiveHint: true },
    execute: async ({ projectId, confirmProjectId }) => {
      const targetId = typeof projectId === "string" ? projectId : "";
      if (!targetId.trim() || confirmProjectId !== targetId) {
        return toolFailure("CONFIRMATION_REQUIRED", "Project deletion requires confirmProjectId to exactly match projectId.", { projectId: targetId || null });
      }
      const target = useProjectStore.getState().projects.find((project) => project.id === targetId);
      if (!target) return toolFailure("PROJECT_NOT_FOUND", `Unknown project ${targetId}.`, { projectId: targetId });
      const deleted = useProjectStore.getState().deleteProject(targetId);
      if (!deleted) return toolFailure("PROJECT_DELETE_REJECTED", "Project was not deleted. Schematic must retain at least one project.", { projectId: targetId });
      const persisted = await persistProjectMutation("Project deletion", targetId);
      if ("failure" in persisted) return persisted.failure;
      return { content: [{ type: "text", text: `Deleted project ${target.name} (${targetId})` }], data: { projectId: targetId, name: target.name, ...persisted } };
    },
  },
  {
    name: "project.save",
    description: "Persist the active project collection to this browser and broadcast it to same-origin tabs",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const saved = useProjectStore.getState().saveProject();
      const stored = await flushProjectPersistence();
      const status = getProjectPersistenceStatus();
      if (status.error) {
        return toolFailure("PROJECT_SAVE_FAILED", `The device-local project repository could not be saved: ${status.error}`, { projectId: saved.projectId, backend: status.backend });
      }
      const persistence = stored ? "flushed" : status.hydrated ? "already-current" : "local-snapshot-only";
      const message = persistence === "local-snapshot-only"
        ? `Saved a device-local fallback snapshot for ${saved.projectId}; the IndexedDB repository is not active in this context.`
        : `Saved ${saved.projectId} to the device-local project repository at ${saved.savedAt}.`;
      return { content: [{ type: "text", text: message }], data: { ...saved, persistence, revision: stored?.metadata.revision ?? status.revision } };
    },
  },
  {
    name: "project.clear",
    description: "Clear the current project after confirming its exact id (remove all components, connections, and firmware)",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Exact id of the active project to clear" },
        confirmProjectId: { type: "string", description: "Repeat the exact active project id to confirm this irreversible operation" },
      },
      required: ["projectId", "confirmProjectId"],
    },
    annotations: { destructiveHint: true },
    execute: async ({ projectId, confirmProjectId }) => {
      const active = useProjectStore.getState().project;
      if (projectId !== active.id || confirmProjectId !== active.id) {
        return toolFailure("CONFIRMATION_REQUIRED", "Clearing requires projectId and confirmProjectId to exactly match the active project id.", { activeProjectId: active.id, requestedProjectId: projectId ?? null });
      }
      useProjectStore.getState().clear();
      const persisted = await persistProjectMutation("Project clear", active.id);
      if ("failure" in persisted) return persisted.failure;
      return { content: [{ type: "text", text: `Cleared ${active.name} (${active.id})` }], data: { projectId: active.id, name: active.name, ...persisted } };
    },
  },
  {
    name: "project.rename",
    description: "Rename the active hardware project",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    execute: async ({ name }) => {
      const state = useProjectStore.getState();
      const renamed = state.renameProject(state.activeProjectId, String(name));
      if (!renamed) return { content: [{ type: "text", text: "The active project could not be renamed" }], isError: true };
      return { content: [{ type: "text", text: `Renamed project to ${renamed}` }], data: { name: renamed } };
    },
  },
  {
    name: "project.apply_blueprint",
    description: "Create a complete hardware design as a new project by default and prepare fallback Outcome behavior for mapped parts. Replacing the active project requires replace=true and its exact id in confirmProjectId.",
    inputSchema: { type: "object", properties: { blueprintId: { type: "string", enum: ["meta-glasses"] }, replace: { type: "boolean", default: false }, confirmProjectId: { type: "string" } }, required: ["blueprintId"] },
    annotations: { destructiveHint: true },
    execute: async ({ blueprintId, replace = false, confirmProjectId }) => {
      const blueprint = BLUEPRINTS[blueprintId];
      if (!blueprint) return { content: [{ type: "text", text: `Unknown blueprint ${blueprintId}` }], isError: true };
      const current = useProjectStore.getState().project;
      const project = cloneProject(blueprint);
      try {
        if (replace) {
          if (confirmProjectId !== current.id) return toolFailure("CONFIRMATION_REQUIRED", "Replacing a project with a blueprint requires confirmProjectId to exactly match the active project id.", { activeProjectId: current.id });
          useProjectStore.getState().loadProject(project);
        } else {
          useProjectStore.getState().importProject(project);
        }
      } catch (cause) {
        const failure = workspaceCapacityFailure("Applying a blueprint", cause);
        if (failure) return failure;
        throw cause;
      }
      const applied = useProjectStore.getState().project;
      useSelectionStore.getState().setActive(applied.components.find((component) => isBoardDefinition(getCatalogComponent(component.definitionId)))?.id ?? null);
      useValidationStore.getState().clear();
      const behaviorSetup = await ensureStarterPlanForAgentBuild();
      const persisted = await persistProjectMutation("Blueprint application", applied.id);
      if ("failure" in persisted) return persisted.failure;
      return {
        content: [{ type: "text", text: `${replace ? "Replaced the active project with" : "Created a new project from"} ${blueprintId}: ${applied.components.length} components, ${applied.connections.length} connections. Outcome setup: ${behaviorSetup.status}.` }],
        data: { blueprintId, projectId: applied.id, replaced: replace, name: applied.name, components: applied.components.length, connections: applied.connections.length, firmwareTargets: applied.firmwareTargets.length, behaviorSetup, ...persisted },
      };
    },
  },
  {
    name: "workspace.get_state",
    description: "Read the live workspace panel state and recent WebMCP activity",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const workspace = useWorkspaceStore.getState();
      const validation = useValidationStore.getState();
      const selection = useSelectionStore.getState();
      const behavior = await getBehaviorState();
      const state = {
        project: { id: useProjectStore.getState().activeProjectId, name: useProjectStore.getState().project.name },
        projects: useProjectStore.getState().projects.map((project) => ({ id: project.id, name: project.name, active: project.id === useProjectStore.getState().activeProjectId })),
        selection: { activeComponentId: selection.activeComponentId, selectedIds: selection.selectedIds },
        panel: workspace.bottomPanel,
        collapsed: workspace.bottomCollapsed,
        height: workspace.bottomHeight,
        rightPanelWidth: workspace.rightPanelWidth,
        panels: {
          webmcp: { activities: useWebMCPStore.getState().activities.slice(0, 12) },
          behavior: behavior.ok ? behavior.data : { status: "unavailable", error: behavior.error },
          validation: { valid: validation.valid, issues: validation.issues, checkedAt: validation.checkedAt },
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], data: state };
    },
  },
  {
    name: "workspace.set_panel",
    description: "Open a live bottom workspace panel for the user or agent: webmcp, terminal, debug, or validation",
    inputSchema: { type: "object", properties: { panel: { type: "string", enum: ["webmcp", "terminal", "debug", "validation"] } }, required: ["panel"] },
    execute: async ({ panel }) => {
      const panels: BottomPanel[] = ["webmcp", "terminal", "debug", "validation"];
      if (!panels.includes(panel)) return { content: [{ type: "text", text: `Unknown workspace panel ${panel}` }], isError: true };
      useWorkspaceStore.getState().setBottomPanel(panel);
      return { content: [{ type: "text", text: `Opened ${panel} panel` }], data: { panel, collapsed: false } };
    },
  },
  {
    name: "workspace.set_right_width",
    description: "Resize the right code and inspector panel in pixels; keeps the value across sessions",
    inputSchema: { type: "object", properties: { width: { type: "number", minimum: 300, maximum: 720 } }, required: ["width"] },
    execute: async ({ width }) => {
      if (!Number.isFinite(Number(width))) return { content: [{ type: "text", text: "Width must be a number between 300 and 720 pixels" }], isError: true };
      const requested = Number(width);
      if (requested < 300 || requested > 720) return { content: [{ type: "text", text: "Width must be between 300 and 720 pixels" }], isError: true };
      useWorkspaceStore.getState().setRightPanelWidth(requested);
      const actual = useWorkspaceStore.getState().rightPanelWidth;
      return { content: [{ type: "text", text: `Right panel width set to ${actual}px` }], data: { rightPanelWidth: actual } };
    },
  },
  {
    name: "component.search",
    description: "Search components in catalog by query, category, or domain. e.g. ESP32, TI DRV, sensor",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text" },
        category: { type: "string", enum: ["board", "sensor", "actuator", "display", "power", "logic", "communication", "mechanical", "rf", "custom", "analog", "passive", ""] },
        domain: { type: "string", enum: ["power", "power_output", "ground", "gpio", "adc", "pwm", "i2c", "spi", "uart", "usb", "ethernet", "can", "pcie", "csi", "hdmi", "displayport", "rf", "mechanical", "optical", ""] },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async ({ query, category, domain }) => {
      const res = searchCatalog(query ?? "", { category: category || undefined, domain: domain || undefined });
      const publicResults = res.map((component) => {
        const { models: _legacyModels, ...catalogData } = component;
        return {
          ...catalogData,
          preview: component.behavior
            ? { mapped: true, profileId: component.behavior.profileId, profileVersion: component.behavior.profileVersion, ...(component.behavior.variant ? { variant: component.behavior.variant } : {}) }
            : { mapped: false },
        };
      });
      return { content: [{ type: "text", text: JSON.stringify(publicResults.map((component) => ({ id: component.id, title: component.title, category: component.category, ports: component.ports.length, preview: component.preview })), null, 2) }], data: publicResults };
    },
  },
  {
    name: "component.inspect",
    description: "Inspect a component definition by id — returns ports, exact typed-preview mapping, and catalog metadata",
    inputSchema: { type: "object", properties: { componentId: { type: "string", description: "Catalog id, e.g. bmp280" } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      const def = getCatalogComponent(componentId);
      if (!def) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      const { models: _legacyModels, ...catalogData } = def;
      const inspected = {
        ...catalogData,
        preview: def.behavior
          ? { mapped: true, profileId: def.behavior.profileId, profileVersion: def.behavior.profileVersion, ...(def.behavior.variant ? { variant: def.behavior.variant } : {}) }
          : { mapped: false },
      };
      return { content: [{ type: "text", text: JSON.stringify(inspected, null, 2) }], data: inspected };
    },
  },
  {
    name: "component.add",
    description: "Add a hardware component to the current project; omit x and y for collision-aware automatic placement, or provide both finite numeric coordinates. Behavior-mapped parts also keep the fallback Outcome plan synchronized without starting playback.",
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
      const def = getCatalogComponent(componentId);
      if (!def) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      const hasX = typeof x !== "undefined";
      const hasY = typeof y !== "undefined";
      if (hasX !== hasY) return { content: [{ type: "text", text: "x and y must be provided together, or both omitted for automatic placement" }], isError: true };
      if (hasX && (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y))) {
        return { content: [{ type: "text", text: "x and y must both be finite numbers when coordinates are provided" }], isError: true };
      }
      const position = hasX ? { x: x as number, y: y as number } : undefined;
      const { id } = useProjectStore.getState().addComponent(componentId, position);
      useSelectionStore.getState().setActive(id);
      const resolvedPosition = useProjectStore.getState().project.components.find((component) => component.id === id)?.position ?? position;
      const behaviorSetup = def.behavior
        ? await ensureStarterPlanForAgentBuild()
        : { ready: false as const, status: "not-applicable" as const, previewStarted: false as const };
      return {
        content: [{ type: "text", text: `Added ${componentId} as ${id} at (${resolvedPosition?.x}, ${resolvedPosition?.y}). Outcome setup: ${behaviorSetup.status}.` }],
        data: { instanceId: id, position: resolvedPosition, behaviorSetup },
      };
    },
  },
  {
    name: "component.remove",
    description: "Remove a component instance and its connections after confirming the exact instance id, then refresh generated fallback Outcome behavior so it does not target the removed instance",
    inputSchema: { type: "object", properties: { instanceId: { type: "string" }, confirmInstanceId: { type: "string" } }, required: ["instanceId", "confirmInstanceId"] },
    annotations: { destructiveHint: true },
    execute: async ({ instanceId, confirmInstanceId }) => {
      if (instanceId !== confirmInstanceId) return toolFailure("CONFIRMATION_REQUIRED", "Removing a component requires confirmInstanceId to exactly match instanceId.", { instanceId });
      const exists = useProjectStore.getState().project.components.some((component) => component.id === instanceId);
      if (!exists) return { content: [{ type: "text", text: `Unknown component instance ${instanceId}` }], isError: true };
      useProjectStore.getState().removeComponent(instanceId);
      if (useSelectionStore.getState().activeComponentId === instanceId) useSelectionStore.getState().clear();
      const behaviorSetup = await ensureStarterPlanForAgentBuild();
      return {
        content: [{ type: "text", text: `Removed ${instanceId}. Outcome setup: ${behaviorSetup.status}.` }],
        data: { instanceId, behaviorSetup },
      };
    },
  },
  {
    name: "component.list_ports",
    description: "List ports for a component instance (or catalog definition). Use componentId; instanceId is accepted as a compatibility alias.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Instance id or catalog definition id" },
        instanceId: { type: "string", description: "Compatibility alias for componentId" },
      },
      anyOf: [{ required: ["componentId"] }, { required: ["instanceId"] }],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId, instanceId }) => {
      const requestedId = typeof componentId === "string" && componentId.trim() ? componentId.trim() : typeof instanceId === "string" ? instanceId.trim() : "";
      if (!requestedId) return toolFailure("INVALID_COMPONENT_ID", "component.list_ports needs a componentId or instanceId string.");
      const inst = useProjectStore.getState().project.components.find((c) => c.id === requestedId);
      const defId = inst?.definitionId ?? requestedId;
      const def = getCatalogComponent(defId);
      if (!def) return toolFailure("UNKNOWN_COMPONENT", `Unknown component or catalog definition ${requestedId}.`, { componentId: requestedId });
      return { content: [{ type: "text", text: JSON.stringify(def.ports, null, 2) }], data: def.ports };
    },
  },
  {
    name: "connection.connect",
    description: "Connect two existing ports. Use instance IDs from component.add and port IDs from component.list_ports; source and target may be supplied in either direction and the graph will orient them. Typed domains, self-wiring, duplicates, and missing endpoints are rejected with structured repair details.",
    inputSchema: {
      type: "object",
      properties: {
        sourceComponentId: { type: "string", minLength: 1, description: "Instance id returned by component.add" },
        sourcePortId: { type: "string", minLength: 1, description: "Port id returned by component.list_ports" },
        targetComponentId: { type: "string", minLength: 1, description: "Instance id returned by component.add" },
        targetPortId: { type: "string", minLength: 1, description: "Port id returned by component.list_ports" },
        source: { type: "object", description: "Compatibility shape: {componentId|instanceId, portId}", properties: { componentId: { type: "string" }, instanceId: { type: "string" }, portId: { type: "string" } }, required: ["portId"] },
        target: { type: "object", description: "Compatibility shape: {componentId|instanceId, portId}", properties: { componentId: { type: "string" }, instanceId: { type: "string" }, portId: { type: "string" } }, required: ["portId"] },
      },
      anyOf: [
        { required: ["sourceComponentId", "sourcePortId", "targetComponentId", "targetPortId"] },
        { required: ["source", "target"] },
      ],
    },
    execute: async ({ sourceComponentId, sourcePortId, targetComponentId, targetPortId, source, target }) => {
      const sourceObject = source && typeof source === "object" ? source as Record<string, unknown> : {};
      const targetObject = target && typeof target === "object" ? target as Record<string, unknown> : {};
      const requested = {
        source: { componentId: typeof sourceComponentId === "string" && sourceComponentId.trim() ? sourceComponentId.trim() : String(sourceObject.componentId ?? sourceObject.instanceId ?? "").trim(), portId: typeof sourcePortId === "string" && sourcePortId.trim() ? sourcePortId.trim() : String(sourceObject.portId ?? "").trim() },
        target: { componentId: typeof targetComponentId === "string" && targetComponentId.trim() ? targetComponentId.trim() : String(targetObject.componentId ?? targetObject.instanceId ?? "").trim(), portId: typeof targetPortId === "string" && targetPortId.trim() ? targetPortId.trim() : String(targetObject.portId ?? "").trim() },
      };
      if (!requested.source.componentId || !requested.source.portId || !requested.target.componentId || !requested.target.portId) {
        return toolFailure("INVALID_ENDPOINT", "connection.connect needs four non-empty strings: sourceComponentId, sourcePortId, targetComponentId, and targetPortId.", { requested });
      }
      const projectBefore = useProjectStore.getState().project;
      try {
        const created = useProjectStore.getState().connectPorts(requested.source, requested.target);
        return {
          content: [{ type: "text", text: `Connected ${created.source.componentId}.${created.source.portId} → ${created.target.componentId}.${created.target.portId} as ${created.id} (${created.domain})` }],
          data: {
            connectionId: created.id,
            domain: created.domain,
            requested,
            resolved: { source: created.source, target: created.target },
          },
        };
      } catch (e) {
        return connectionFailure(e, requested, projectBefore);
      }
    },
  },
  {
    name: "connection.disconnect",
    description: "Disconnect (remove) a connection after confirming its exact id",
    inputSchema: { type: "object", properties: { connectionId: { type: "string" }, confirmConnectionId: { type: "string" } }, required: ["connectionId", "confirmConnectionId"] },
    annotations: { destructiveHint: true },
    execute: async ({ connectionId, confirmConnectionId }) => {
      if (connectionId !== confirmConnectionId) return toolFailure("CONFIRMATION_REQUIRED", "Disconnecting requires confirmConnectionId to exactly match connectionId.", { connectionId });
      const exists = useProjectStore.getState().project.connections.some((connection) => connection.id === connectionId);
      if (!exists) return { content: [{ type: "text", text: `Unknown connection ${connectionId}` }], isError: true };
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
    description: "Compatibility alias for code.write. Save ordinary editable source for a board; Schematic does not compile, run, upload, or physically test it.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", minLength: 1, maxLength: MAX_TOOL_IDENTIFIER_LENGTH, description: "Board instance id" },
        files: { type: "array", minItems: 1, maxItems: 128, items: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 240 }, content: { type: "string", maxLength: 1048576 } }, required: ["name", "content"], additionalProperties: false } },
        language: { type: "string", enum: ["arduino", "micropython", "espidf", "c", "cpp", "python"] },
        boardFqbn: { type: "string", minLength: 1, maxLength: MAX_TOOL_IDENTIFIER_LENGTH },
        expectedContentSha256: { anyOf: [{ type: "string", pattern: "^[0-9a-fA-F]{64}$" }, { type: "null" }], description: "null for create-only, or the exact hash returned by firmware.read/code.read for replacement" },
    },
    required: ["componentId", "files", "expectedContentSha256"],
    },
    execute: async (args) => {
      const { componentId, files, language, boardFqbn, expectedContentSha256 } = args;
      if (!boundedToolIdentifier(componentId)) return toolFailure("INVALID_CODE_REQUEST", "componentId must be a bounded identifier and expectedContentSha256 must be null or a 64-character SHA-256 hash.");
      if (!Object.prototype.hasOwnProperty.call(args ?? {}, "expectedContentSha256") || expectedContentSha256 === undefined) return toolFailure("SOURCE_PRECONDITION_REQUIRED", "Code writes require expectedContentSha256: null for create-only, or the exact current hash for replacement.");
      if (!validSha256(expectedContentSha256)) return toolFailure("INVALID_CODE_REQUEST", "expectedContentSha256 must be null or a 64-character SHA-256 hash.");
      const result = await writeCode({ targetComponentId: componentId, files: Array.isArray(files) ? files : [], language: language ?? "arduino", boardFqbn, expectedContentSha256, origin: "ai-generated" });
      if (!result.ok) return { content: [{ type: "text", text: JSON.stringify(result.error, null, 2) }], isError: true, error: result.error, data: { code: result.error.code, ...(result.data ?? {}) } };
      useSelectionStore.getState().setActive(String(componentId ?? ""));
      return { content: [{ type: "text", text: JSON.stringify({ ...result.data, compatibilityAlias: "firmware.write" }, null, 2) }], data: { ...result.data, compatibilityAlias: "firmware.write" } };
    },
  },
  {
    name: "firmware.read",
    description: "Compatibility alias for code.read. Read editable source metadata for a board; source is not executed.",
    inputSchema: { type: "object", properties: { componentId: { type: "string", minLength: 1, maxLength: MAX_TOOL_IDENTIFIER_LENGTH } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      if (!boundedToolIdentifier(componentId)) return toolFailure("INVALID_CODE_REQUEST", "componentId must be a bounded non-empty identifier of at most 200 characters.");
      const result = await readCode(String(componentId ?? ""));
      if (!result.ok) return { content: [{ type: "text", text: JSON.stringify(result.error, null, 2) }], isError: true, error: result.error, data: { code: result.error.code, ...(result.data ?? {}) } };
      return { content: [{ type: "text", text: JSON.stringify({ ...result.data, compatibilityAlias: "firmware.read" }, null, 2) }], data: { ...result.data, compatibilityAlias: "firmware.read" } };
    },
  },
  {
    name: "firmware.check",
    description: "Compatibility diagnostic alias. Reports editable source metadata only; Schematic does not compile or preflight source in the preview workflow.",
    inputSchema: { type: "object", properties: { componentId: { type: "string", minLength: 1, maxLength: MAX_TOOL_IDENTIFIER_LENGTH } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      if (!boundedToolIdentifier(componentId)) return toolFailure("INVALID_CODE_REQUEST", "componentId must be a bounded non-empty identifier of at most 200 characters.");
      const id = String(componentId ?? "");
      const result = await readCode(id);
      if (!result.ok) return { content: [{ type: "text", text: JSON.stringify(result.error, null, 2) }], isError: true, error: result.error, data: { code: result.error.code, ...(result.data ?? {}) } };
      return {
        content: [{ type: "text", text: JSON.stringify({ componentId: id, status: "not-performed", notice: "Schematic does not compile or preflight editable source. Use the board SDK/toolchain externally.", document: result.data.document }, null, 2) }],
        data: { componentId: id, status: "not-performed", notice: "Schematic does not compile or preflight editable source. Use the board SDK/toolchain externally.", document: result.data.document },
      };
    },
  },
  {
    name: "validation.check",
    description: "Run static graph-rule validation for wiring and component constraints. Source is not read or executed, and physical wiring/hardware are not verified.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      try {
        const project = useProjectStore.getState().project;
        const result = validateProject(project);
        useValidationStore.getState().setResult(result);
        const data = { ...result, scope: "static-graph-rules", sourceCodeEvaluated: false, physicalWiringVerified: false, hardwareVerified: false, notice: GRAPH_VALIDATION_NOTICE };
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], data };
      } catch (e) {
        return { content: [{ type: "text", text: `Validation error: ${(e as Error).message}` }], isError: true };
      }
    },
  },
  {
    name: "validation.explain_error",
    description: "Explain a static graph-check error code with fix guidance. Physical wiring, hardware behavior, and editable source remain unverified.",
    inputSchema: { type: "object", properties: { code: { type: "string", minLength: 1, maxLength: MAX_TOOL_IDENTIFIER_LENGTH } }, required: ["code"] },
    annotations: { readOnlyHint: true },
    execute: async ({ code }) => {
      if (!boundedToolIdentifier(code)) return toolFailure("INVALID_VALIDATION_CODE", "code must be a bounded non-empty string of at most 200 characters.");
      const map: Record<string, string> = {
        VOLTAGE_MISMATCH: "Voltage exceeds target max — insert level shifter or choose compatible variant.",
        OUTPUT_TO_OUTPUT: "Output→output illegal — one side must be input/bidirectional.",
        UART_TX_TO_TX: "Connect TX→RX and RX→TX (cross).",
        I2C_ADDRESS_COLLISION: "Two devices share same I2C address — change address jumper or use mux.",
        MISSING_PULLUP: "I2C needs 4.7kΩ pull-ups to VCC on SDA/SCL.",
        MISSING_GROUND: "Add common ground net.",
        USB_HOST_TO_HOST: "Host must connect to device.",
      };
      const normalizedCode = code.trim();
      return { content: [{ type: "text", text: map[normalizedCode] ?? `No explanation for ${normalizedCode}` }] };
    },
  },
  {
    name: "shopping.search",
    description: "Discover electronics parts through the configured bounded shopping source when listings are omitted, then publish agent-attributed listings into the Parts desk after checking them. Discovery is cached and rate-limited; candidates never become offers automatically. Return the schematic.parts.lookup.v1 handoff to a browsing agent when publication is unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_SHOPPING_QUERY_LENGTH, description: "Exact part, board, manufacturer, or catalog id" },
        quantity: { type: "integer", minimum: 1, maximum: 999, description: "Required quantity" },
        listings: {
          type: "array",
          minItems: 1,
          maxItems: 24,
          description: "Agent-found listings only; every item must identify one canonical catalog part and its reported offers.",
          items: {
            type: "object",
            required: ["id", "catalogId", "title", "partNumber", "requestedQuantity", "exactMatch", "offers", "updatedAt"],
            properties: {
              id: { type: "string" },
              catalogId: { type: "string", description: "Schematic catalog id; do not invent one" },
              title: { type: "string" },
              partNumber: { type: "string", description: "Manufacturer or distributor part number" },
              requestedQuantity: { type: "integer", minimum: 1 },
              exactMatch: { const: true, description: "Agent's exact-match claim; the boundary does not independently verify real-world identity." },
              updatedAt: { type: "string", format: "date-time", description: "Recent time at which the agent refreshed this claimed catalog record." },
              offers: {
                type: "array",
                minItems: 1,
                maxItems: 3,
                items: {
                  type: "object",
                  required: ["id", "retailer", "title", "price", "currency", "url", "fetchedAt", "provider"],
                  properties: {
                    id: { type: "string" }, retailer: { type: "string" }, title: { type: "string" },
                    price: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
                    currency: { type: "string", pattern: "^[A-Z]{3}$" }, url: { type: "string", format: "uri", description: "HTTPS retailer URL supplied by the agent; the UI does not verify the page." },
                    fetchedAt: { type: "string", format: "date-time", description: "Recent time at which the agent observed this offer." }, provider: { type: "string" },
                  },
                },
              },
              alternatives: { type: "array", maxItems: 3, description: "Optional context-aware alternatives; publish each alternative as its own canonical catalog-ID claim too." },
            },
          },
        },
        publication: { type: "object", description: "Sourcing provenance supplied by the agent. Authentication and agent identity come from the verified WebMCP session, not from these fields. publishedAt must be recent.", properties: { provider: { type: "string", minLength: 1 }, publishedAt: { type: "string", format: "date-time" } }, required: ["provider", "publishedAt"] },
      },
      description: "Omit listings/publication to run bounded public discovery and receive a handoff request. Include both to publish agent-attributed results.",
    },
    annotations: { untrustedContentHint: true },
    execute: async ({ query = "", quantity = 1, listings, publication, __trustedAuth }, { signal, persistenceContext } = {}) => {
      if (typeof query !== "string" || query.trim().length === 0 || query.length > MAX_SHOPPING_QUERY_LENGTH || hasShoppingControlCharacters(query) || (quantity !== undefined && (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999))) {
        return shoppingError("INVALID_SEARCH_REQUEST", "shopping.search requires a string query and an integer quantity between 1 and 999.", {
          query: typeof query === "string" ? query.slice(0, MAX_SHOPPING_QUERY_LENGTH) : null,
          quantity: typeof quantity === "number" ? quantity : null,
          results: [],
          liveOffers: false,
          requiresWebMCPAgent: true,
        });
      }
      const requestedQuantity = quantity;
      const searchQuery = query.trim();
      const shopping = useShoppingStore.getState();
      shopping.setQuery(searchQuery);
      const requiredCatalogIds = useProjectStore.getState().project.components.map((component) => component.definitionId);
      const handoff = createShoppingHandoff(searchQuery, requestedQuantity, requiredCatalogIds);
      const trustedAuth = __trustedAuth as TrustedToolContext | undefined;
      const discoveryRequest = typeof listings === "undefined" && typeof publication === "undefined";
      if (discoveryRequest) {
        shopping.setRequestStatus("searching");
        shopping.setResults([]);
        shopping.setHandoff(handoff);
        let providerFallback: Record<string, unknown> = { attempted: false, reason: "trusted_webmcp_session_required" };
        let discovery: ShoppingDiscovery | null = null;
        if (trustedAuth?.authenticated && trustedAuth.subject) {
          const lookup = await fetchJson(`/api/parts/search?query=${encodeURIComponent(searchQuery)}&quantity=${requestedQuantity}`, { signal });
          if (!persistenceContextStillCurrent(persistenceContext)) {
            return toolFailure(
              "PERSISTENCE_NOT_READY",
              "The active account room changed while parts discovery was running; the stale result was discarded.",
              { unchanged: true, hint: "Re-run parts search after the workspace reports Saved." },
              true,
            );
          }
          providerFallback = {
            attempted: true,
            available: Boolean(lookup.response?.ok),
            ...(lookup.data && typeof lookup.data === "object" ? lookup.data : {}),
            ...(lookup.error ? { error: lookup.error } : {}),
          };
          discovery = normalizeShoppingDiscovery(lookup.data);
          if (discovery) shopping.setDiscovery(discovery);
          else shopping.setRequestStatus("agent-required");
        }
        // A stale persistence/broadcast event may arrive while the upstream
        // lookup is awaiting a response. Re-assert the active request after
        // discovery so get_state and the UI cannot show candidates without
        // their matching handoff.
        shopping.setQuery(searchQuery);
        shopping.setHandoff(handoff);
        if (discovery) shopping.setDiscovery(discovery);
        const data = { query: searchQuery, source: "webmcp-agent-required", liveOffers: false, results: shopping.results, cart: shopping.cart, unchanged: shopping.results.length > 0 || shopping.cart.length > 0, requiresWebMCPAgent: true, handoff, discovery: shopping.discovery ?? discovery, providerFallback };
        const hasCandidates = (Array.isArray(providerFallback.candidates) && providerFallback.candidates.length > 0)
          || (Array.isArray(providerFallback.results) && providerFallback.results.length > 0);
        const message = hasCandidates
          ? "Public candidates are ready. Check canonical catalog IDs, part numbers, timestamps, and HTTPS retailer offers, then call shopping.search again with listings and publication. These remain agent-published claims; confirm identity and live availability with the retailer."
          : "Parts shopping requires a connected, authenticated WebMCP agent to publish listings. Public discovery was checked and the handoff JSON is ready for another browsing agent.";
        return shoppingError("AGENT_PUBLICATION_REQUIRED", message, data);
      }
      if (!trustedAuth?.authenticated || !trustedAuth.subject) {
        shopping.setResults([]);
        shopping.setHandoff(handoff);
        return shoppingError("AUTH_REQUIRED", "Listing publication was rejected because no trusted WebMCP session was present. Caller-supplied authentication fields are ignored; resume the handoff from a trusted WebMCP session.", { query: searchQuery, source: "webmcp-agent-required", liveOffers: false, results: shopping.results, cart: shopping.cart, unchanged: true, requiresWebMCPAgent: true, handoff, discovery: shopping.discovery });
      }
      const requestedPublication = publication && typeof publication === "object" ? publication as Record<string, unknown> : {};
      const provider = String(requestedPublication.provider ?? "").trim();
      const publishedAt = String(requestedPublication.publishedAt ?? "").trim();
      if (!provider || !publishedAt) {
        shopping.setResults([]);
        shopping.setHandoff(handoff);
        return shoppingError("PUBLICATION_METADATA_REQUIRED", "Each WebMCP publication must include the parts provider and the time the agent sourced the listings.", { query: searchQuery, source: "webmcp-agent-required", liveOffers: false, results: shopping.results, cart: shopping.cart, unchanged: true, requiresWebMCPAgent: true, handoff, discovery: shopping.discovery });
      }
      const publicationIssues = shoppingPublicationIssues(listings, publication);
      if (publicationIssues.length > 0) {
        const firstIssue = publicationIssues[0];
        shopping.setResults([]);
        shopping.setHandoff(handoff);
        return shoppingError(firstIssue.code, firstIssue.message, {
          query: searchQuery,
          source: "webmcp-agent-required",
          liveOffers: false,
          results: shopping.results,
          cart: shopping.cart,
          unchanged: true,
          requiresWebMCPAgent: true,
          handoff,
          discovery: shopping.discovery,
          rejected: publicationIssues,
        });
      }
      const trustedPublication: AgentPublication = {
        authenticated: true,
        agentId: `webmcp:${trustedAuth.environment}:${trustedAuth.subject}`,
        provider,
        publishedAt,
      };
      const normalized = bindShoppingPublication(normalizeShoppingResults(listings, searchQuery, requestedQuantity), trustedPublication, trustedAuth);
      const publicationResult = shopping.publishAgentResults(normalized, trustedPublication);
      const results = useShoppingStore.getState().results;
      const data = {
        query: searchQuery,
        source: "webmcp-agent",
        // A price value is not proof that a retailer page is live or in stock.
        // Preserve the legacy field as a conservative capability flag and
        // expose the useful fact separately for callers that need it.
        liveOffers: false,
        pricedOffers: results.some((result) => result.offers.some((offer) => offer.price !== null)),
        accepted: publicationResult.accepted,
        rejected: publicationResult.rejected,
        results,
        requiresWebMCPAgent: true,
        handoff: publicationResult.accepted ? null : handoff,
        discovery: publicationResult.accepted ? null : shopping.discovery,
      };
      if (!publicationResult.accepted) {
        return shoppingError("PUBLICATION_REJECTED", publicationResult.message ?? "The WebMCP agent publication was rejected.", { ...data, rejected: [{ code: "PUBLICATION_REJECTED", message: publicationResult.message ?? "The WebMCP agent publication was rejected." }] });
      }
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        data,
      };
    },
  },
  {
    name: "shopping.get_state",
    description: "Read agent-sourced part listings, cart lines, budget, and cheapest-price quote for the current build",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const shopping = useShoppingStore.getState();
      const quote = shopping.getQuote();
      const pendingRequest = shopping.handoff
        ? {
            requestId: shopping.handoff.requestId,
            query: shopping.handoff.query,
            quantity: shopping.handoff.quantity,
            requiredCatalogIds: shopping.handoff.requiredCatalogIds,
            requestedAt: shopping.handoff.requestedAt,
          }
        : null;
      const state = { query: shopping.query, results: shopping.results, cart: shopping.cart, budget: shopping.budget, lastSearchAt: shopping.lastSearchAt, requestStatus: shopping.requestStatus, pendingRequest, handoff: shopping.handoff, discovery: shopping.discovery, quote };
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], data: state };
    },
  },
  {
    name: "shopping.cart_add",
    description: "Add an agent-published shopping result to the build cart",
    inputSchema: { type: "object", properties: { resultId: { type: "string", maxLength: 160 }, quantity: { type: "integer", minimum: 1, maximum: 999 } }, required: ["resultId"] },
    annotations: { untrustedContentHint: true },
    execute: async ({ resultId, quantity }) => {
      if (!shoppingText(resultId, 160) || (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 999))) {
        return toolFailure("INVALID_CART_REQUEST", "resultId must be a non-empty string of at most 160 characters and quantity must be an integer from 1 to 999.");
      }
      const id = String(resultId);
      const result = useShoppingStore.getState().results.find((item) => item.id === id);
      if (!result) return { content: [{ type: "text", text: `Unknown shopping result ${id}; search for the part first` }], isError: true };
      if (!result.exactMatch) return { content: [{ type: "text", text: `${result.title} does not carry an agent-published exact-match claim; review the part number before adding it to the cart` }], isError: true };
      useShoppingStore.getState().addToCart(id, Number(quantity) || 1);
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_remove",
    description: "Remove a part from the shopping cart",
    inputSchema: { type: "object", properties: { resultId: { type: "string", maxLength: 160 } }, required: ["resultId"] },
    annotations: { untrustedContentHint: true },
    execute: async ({ resultId }) => {
      if (!shoppingText(resultId, 160)) return toolFailure("INVALID_CART_REQUEST", "resultId must be a non-empty string of at most 160 characters.");
      const id = String(resultId);
      if (!useShoppingStore.getState().cart.some((line) => line.resultId === id)) return { content: [{ type: "text", text: `Shopping result ${id} is not in the cart` }], isError: true };
      useShoppingStore.getState().removeFromCart(id);
      return { content: [{ type: "text", text: "Cart line removed" }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_set_quantity",
    description: "Set the quantity for a shopping cart line, or remove it with zero",
    inputSchema: { type: "object", properties: { resultId: { type: "string", maxLength: 160 }, quantity: { type: "integer", minimum: 0, maximum: 999 } }, required: ["resultId", "quantity"] },
    annotations: { untrustedContentHint: true },
    execute: async ({ resultId, quantity }) => {
      if (!shoppingText(resultId, 160) || !Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
        return toolFailure("INVALID_CART_REQUEST", "resultId must be a non-empty string of at most 160 characters and quantity must be an integer from 0 to 999.");
      }
      const id = String(resultId);
      if (!useShoppingStore.getState().cart.some((line) => line.resultId === id)) return { content: [{ type: "text", text: `Shopping result ${id} is not in the cart` }], isError: true };
      useShoppingStore.getState().setQuantity(id, Number(quantity));
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_set_budget",
    description: "Set or clear the target build budget in USD",
    inputSchema: { type: "object", properties: { budget: { type: ["number", "null"], minimum: 0, maximum: 1_000_000_000 } }, required: ["budget"] },
    annotations: { untrustedContentHint: true },
    execute: async ({ budget }) => {
      if (budget !== null && (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0 || budget > 1_000_000_000)) {
        return toolFailure("INVALID_CART_REQUEST", "budget must be null or a finite number from 0 to 1,000,000,000.");
      }
      useShoppingStore.getState().setBudget(budget === null ? null : Number(budget));
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_undo",
    description: "Undo the last cart change",
    inputSchema: { type: "object", properties: {} },
    annotations: { untrustedContentHint: true },
    execute: async () => {
      useShoppingStore.getState().undoCart();
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_reset",
    description: "Reset the cart to one of every catalog part currently required by the project, after listings have been searched",
    inputSchema: { type: "object", properties: { requiredCatalogIds: { type: "array", maxItems: 500, items: { type: "string", maxLength: 120 } } } },
    annotations: { untrustedContentHint: true },
    execute: async ({ requiredCatalogIds }) => {
      if (requiredCatalogIds !== undefined && (!Array.isArray(requiredCatalogIds)
        || requiredCatalogIds.length > 500
        || requiredCatalogIds.some((catalogId) => !shoppingText(catalogId, 120)))) {
        return toolFailure("INVALID_CART_REQUEST", "requiredCatalogIds must contain at most 500 non-empty catalog IDs of at most 120 characters each.");
      }
      const project = useProjectStore.getState().project;
      const ids = Array.isArray(requiredCatalogIds) && requiredCatalogIds.length ? requiredCatalogIds : project.components.map((component) => component.definitionId);
      const availableIds = new Set(useShoppingStore.getState().results.filter((result) => result.exactMatch).map((result) => result.catalogId));
      const missingCatalogIds = [...new Set(ids)].filter((catalogId) => !availableIds.has(catalogId));
      useShoppingStore.getState().resetCart(ids);
      const data = { requiredCatalogIds: ids, missingCatalogIds, quote: useShoppingStore.getState().getQuote() };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], data };
    },
  },
  {
    name: "shopping.choose_alternative",
    description: "Replace a cart part with an agent-recommended context-aware alternative",
    inputSchema: { type: "object", properties: { resultId: { type: "string", maxLength: 160 }, catalogId: { type: "string", maxLength: 120 } }, required: ["resultId", "catalogId"] },
    annotations: { untrustedContentHint: true },
    execute: async ({ resultId, catalogId }) => {
      if (!shoppingText(resultId, 160) || !shoppingText(catalogId, 120)) {
        return toolFailure("INVALID_CART_REQUEST", "resultId and catalogId must be non-empty bounded strings.");
      }
      const changed = useShoppingStore.getState().chooseAlternative(String(resultId), String(catalogId));
      if (!changed) return { content: [{ type: "text", text: "Alternative is not available as a searched result yet" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.quote",
    description: "Calculate the total using the cheapest priced agent-sourced offer per cart line and report missing prices or budget overage",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const quote = useShoppingStore.getState().getQuote();
      return { content: [{ type: "text", text: JSON.stringify(quote, null, 2) }], data: quote };
    },
  },
  {
    name: "design.auto_layout",
    description: "Auto-layout components on canvas (simple grid)",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const proj = useProjectStore.getState().project;
      const next = layoutComponentPositions(proj.components);
      useProjectStore.getState().loadProject({ ...proj, components: next });
      return { content: [{ type: "text", text: `Auto-layout applied to ${next.length} components` }] };
    },
  },
];

/** Single source of truth for the tool count shown in the product UI. */
export const WEBMCP_TOOL_COUNT = tools.length;

let controllers: AbortController[] = [];
let registrationGeneration = 0;

async function executeToolWithActivity(tool: ToolDef, args: Record<string, any> = {}, signal?: AbortSignal) {
  throwIfAborted(signal);
  const activityId = useWebMCPStore.getState().beginTool(tool.name, args);
  try {
    // Keep the public landing page from becoming an unauthenticated mutation
    // surface. Local development has the explicit development session; hosted
    // builds must have a platform-verified identity before any mutation.
    // Read-only inspection stays available so ChatGPT discovery + exploration
    // works even before sign-in; mutations still require a verified session.
    const hosted = typeof window !== "undefined" && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const session = await getAuthSession(false, signal);
    // shopping.search owns a phase-aware gate: query-only calls can return a
    // bounded machine-readable handoff while unauthenticated, while its
    // publication branch returns AUTH_REQUIRED without a trusted session.
    const shoppingSearch = tool.name === "shopping.search";
    const isReadOnly = tool.annotations?.readOnlyHint === true;
    if (hosted && !session && !isReadOnly && !shoppingSearch) {
      const denied = toolFailure("AUTH_REQUIRED", "Sign in to use Schematic WebMCP mutation tools; read-only tools (search, inspect, graph, validation, behavior capabilities) remain available. Project mutations are scoped to your verified account.");
      useWebMCPStore.getState().finishTool(activityId, denied, true);
      return denied;
    }
    // A session event can replace the persistence room while tools remain
    // registered in the browser. Mutation tools capture the current hydrated
    // lease and fail immediately during a room transition; read-only
    // inspection can continue to report the currently visible snapshot.
    const isMutation = !tool.annotations?.readOnlyHint;
    const persistenceContext = isMutation ? getProjectPersistenceContext() : null;
    if (isMutation && !isCurrentProjectPersistenceContext(persistenceContext)) {
      const denied = toolFailure(
        "PERSISTENCE_NOT_READY",
        "The active account room is changing; wait for workspace hydration to finish before editing.",
        { unchanged: true, hint: "Retry after the workspace reports Saved." },
        true,
      );
      useWebMCPStore.getState().finishTool(activityId, denied, true);
      return denied;
    }
    const trustedAuth: TrustedToolContext | undefined = session
      ? { authenticated: true, subject: session.subject, environment: session.environment }
      : undefined;
    throwIfAborted(signal);
    const result = await tool.execute({ ...args, __trustedAuth: trustedAuth }, { signal, persistenceContext });
    // A mutating tool may have crossed its point of no return before its
    // promise settled. Once execute returns, report that applied result even
    // if cancellation arrived in the final microtask; throwing here would
    // invite an unsafe retry of an operation that already committed.
    useWebMCPStore.getState().finishTool(activityId, result);
    return result;
  } catch (e) {
    const notReady = persistenceNotReadyFailure(e);
    if (notReady) {
      useWebMCPStore.getState().finishTool(activityId, notReady, true);
      return notReady;
    }
    const message = (e as Error).message;
    useWebMCPStore.getState().finishTool(activityId, { content: [{ type: "text", text: message }], isError: true }, true);
    throw e;
  }
}

/** Prefer the current document-scoped API, but keep the deprecated navigator surface as a compatibility fallback. */
function getNativeModelContext() {
  const documentContext: any = (document as any).modelContext;
  if (typeof documentContext?.registerTool === "function") return documentContext;
  const navigatorContext: any = (navigator as any).modelContext;
  if (typeof navigatorContext?.registerTool === "function") return navigatorContext;
  return null;
}

/** Chrome WebMCP Bridge reads navigator.modelContextTesting (consumer API). */
function installModelContextTestingPolyfill() {
  const nav = navigator as any;
  if (nav.modelContextTesting?.listTools && nav.modelContextTesting?.executeTool) return;
  try {
    Object.defineProperty(nav, "modelContextTesting", {
      configurable: true,
      value: {
        listTools() {
          return tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: JSON.stringify(t.inputSchema ?? { type: "object" }),
          }));
        },
        async executeTool(toolName: string, inputArgsJson: string) {
          const tool = tools.find((candidate) => candidate.name === toolName);
          if (!tool) throw new Error(`Unknown WebMCP tool: ${toolName}`);
          const args = inputArgsJson ? JSON.parse(inputArgsJson) : {};
          const result = await executeToolWithActivity(tool, args);
          return typeof result === "string" ? result : JSON.stringify(result ?? null);
        },
        registerToolsChangedCallback(callback: () => void) {
          callback();
        },
      },
    });
  } catch (error) {
    // This non-standard testing surface must never be able to prevent native
    // document.modelContext registration in a host that owns Navigator.
    console.warn("[WebMCP] modelContextTesting fallback could not be installed:", error);
  }
}

/**
 * ChatGPT's in-app browser may inject document.modelContext just after page
 * scripts run. If no native surface existed at bootstrap, re-register once one
 * appears so the host actually discovers the 45 tools. We never polyfill
 * document/navigator.modelContext: a fake registry would report success while
 * the host still sees zero tools.
 */
let lateNativeRetryScheduled = false;
function scheduleLateNativeRetry(generation: number) {
  if (lateNativeRetryScheduled || typeof window === "undefined") return;
  lateNativeRetryScheduled = true;
  const attempts = [250, 750, 1500, 3000, 6000, 12000];
  for (const delayMs of attempts) {
    window.setTimeout(() => {
      if (generation !== registrationGeneration) return;
      const current = getNativeModelContext();
      if (current && useWebMCPStore.getState().registration.state === "unavailable") {
        lateNativeRetryScheduled = false;
        void registerWebMCPTools();
      }
      if (delayMs === attempts[attempts.length - 1]) lateNativeRetryScheduled = false;
    }, delayMs);
  }
}

export async function registerWebMCPTools() {
  // React StrictMode and hot reload can invoke startup twice. Abort the old
  // lease before creating a new one so a native registry never accumulates
  // duplicate callbacks for the same tool name.
  // IMPORTANT (ChatGPT fix): register synchronously on every route — including
  // the landing page — without waiting for auth or IndexedDB hydration first.
  // ChatGPT discovers tools the moment the top-level document loads; gating
  // registration on session/persistence left "/" with 0 tools and made the
  // model report WebMCP as unavailable. Per-call auth/persistence gates in
  // executeToolWithActivity still protect mutations.
  for (const controller of controllers) controller.abort();
  controllers = [];
  const generation = ++registrationGeneration;
  useWebMCPStore.getState().setRegistration({ state: "checking", registeredCount: 0, declaredCount: WEBMCP_TOOL_COUNT, discoveredCount: 0, discovery: "unavailable", error: undefined });
  const mc = getNativeModelContext();
  // Never install the non-standard testing bridge in front of a real native
  // WebMCP surface. Some embedded hosts own or lock Navigator properties, and
  // a testing polyfill must not be allowed to break production registration.
  if (!mc) installModelContextTestingPolyfill();
  // Test/degraded-runtime fallback only. Native agents must use the
  // document.modelContext registration below; this same-origin object is not a
  // cross-origin mutation bridge. Install it immediately so local probes and
  // the ChatGPT host see a stable surface even while native registration is
  // still awaiting per-tool promises.
  (window as any).__schematicTools = Object.fromEntries(tools.map((t) => [t.name, (args: Record<string, unknown>, context?: ToolExecutionContext | AbortSignal) => executeToolWithActivity(t, args, executionSignal(context))]));
  (window as any).__schematicWebMCP = {
    version: "schematic-webmcp.v1",
    declaredToolNames: getRegisteredToolNames(),
    getRegistration: () => useWebMCPStore.getState().registration,
    listTools: () => getRegisteredToolNames(),
  };
  // Warm auth/persistence in the background without blocking discovery.
  // Failures here must never un-register tools; they only affect per-call
  // mutation gates.
  void Promise.allSettled([waitForAuth(), waitForProjectPersistence()]).then(() => {
    if (generation !== registrationGeneration) return;
    (window as any).__schematicRoom ??= () => getCurrentUserId() || "global";
  });
  if (generation !== registrationGeneration) return;
  if (!mc || typeof mc.registerTool !== "function") {
    useWebMCPStore.getState().setRegistration({ state: "unavailable", registeredCount: 0, declaredCount: WEBMCP_TOOL_COUNT, discoveredCount: 0, discovery: "unavailable", error: "The browser did not expose document.modelContext." });
    console.warn("[WebMCP] native document.modelContext is unavailable; no browser-visible tools were registered");
    scheduleLateNativeRetry(generation);
    return;
  }
  // Submit the complete registry before awaiting any individual registration.
  // registerTool() returns a Promise, and awaiting each of 45 tools serially
  // creates an avoidable window where a browser agent can observe only a
  // partial tool map during initial page discovery.
  const registrationResults = await Promise.all(tools.map(async (t) => {
    if (generation !== registrationGeneration) return false;
    const ctrl = new AbortController();
    controllers.push(ctrl);
    try {
      const registration = mc.registerTool(
        {
          name: t.name,
          description: t.description + " — Scoped to your verified account and its local project room. Agent may place hardware on your behalf within your room only.",
          inputSchema: t.inputSchema,
          annotations: t.annotations,
          execute: (args: Record<string, unknown>, context?: ToolExecutionContext | AbortSignal) => executeToolWithActivity(t, args, executionSignal(context)),
        },
        { signal: ctrl.signal },
      );
      await registration;
      console.log(`[WebMCP] registered ${t.name} (room-aware)`);
      return true;
    } catch (e) {
      console.error(`[WebMCP] failed to register ${t.name}:`, e);
      return false;
    }
  }));
  if (generation !== registrationGeneration) return;
  const registeredCount = registrationResults.filter(Boolean).length;
  const registrationErrors = WEBMCP_TOOL_COUNT - registeredCount;
  // listen for toolchange
  if ("ontoolchange" in mc) {
    mc.ontoolchange = () => console.log("[WebMCP] toolset changed");
  }
  let discoveredCount = 0;
  let discovery: "verified" | "unverified" = "unverified";
  if (typeof mc.getTools === "function") {
    try {
      const discovered = await mc.getTools();
      discoveredCount = Array.isArray(discovered) ? discovered.filter((tool: any) => typeof tool?.name === "string").length : 0;
      if (discoveredCount === registeredCount && registeredCount === WEBMCP_TOOL_COUNT) discovery = "verified";
    } catch (error) {
      console.warn("[WebMCP] native tool discovery check failed:", error);
    }
  }
  useWebMCPStore.getState().setRegistration({
    state: registrationErrors > 0 ? "error" : "native",
    registeredCount,
    declaredCount: WEBMCP_TOOL_COUNT,
    discoveredCount,
    discovery,
    ...(registrationErrors > 0 ? { error: `${registrationErrors} tool registration${registrationErrors === 1 ? "" : "s"} failed.` } : { error: undefined }),
  });
  (window as any).__schematicWebMCP.getRegistration = () => useWebMCPStore.getState().registration;
  console.log(`[WebMCP] ready — ${WEBMCP_TOOL_COUNT} tools, room:`, (window as any).__schematicRoom?.() || "global", "— agent may now place hardware on your behalf inside your room");
}

export function unregisterWebMCPTools() {
  registrationGeneration += 1;
  for (const c of controllers) c.abort();
  controllers = [];
}

export function getRegisteredToolNames() {
  return tools.map((t) => t.name);
}

/** Invoke the exact same callback registered with document.modelContext. */
export async function invokeWebMCPTool(name: string, args: Record<string, any> = {}, signal?: AbortSignal) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
  return executeToolWithActivity(tool, args, signal);
}
