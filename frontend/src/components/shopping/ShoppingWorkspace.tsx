import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Cable,
  CircleAlert,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  Wifi,
} from "lucide-react";
import { getCatalogComponent } from "../../data/catalog.ts";
import { componentArtworkHref } from "../../data/componentArtwork.ts";
import { useProjectStore } from "../../store/useProjectStore.ts";
import {
  createShoppingHandoff,
  useShoppingStore,
  type ShoppingDiscovery,
  type ShoppingDiscoveryCandidate,
  type ShoppingRequestStatus,
  type ShoppingResult,
} from "../../store/useShoppingStore.ts";
import {
  getCachedPartsSearch,
  requestPartsSearch,
} from "../../shopping/partsSearchClient.ts";

type PartsUiPhase =
  | "idle"
  | "searching"
  | "candidates"
  | "partial"
  | "verified"
  | "rate-limited"
  | "failed";

type DiscoveryOffer = {
  id: string;
  retailer: string;
  price: number | null;
  currency: string;
  url?: string;
  availability?: string;
};

type DiscoveryCandidate = {
  id: string;
  catalogId: string;
  title: string;
  manufacturer?: string;
  partNumber: string;
  retailer?: string;
  imageUrl?: string;
  shipping?: string;
  rating?: number;
  reviewCount?: number;
  offers: DiscoveryOffer[];
};

type DesignPartRequirement = {
  key: string;
  catalogId: string;
  title: string;
  query: string;
  quantity: number;
  kind: "component" | "wire";
};

type BuildCartItem = DesignPartRequirement & {
  artworkHref?: string;
  fallbackArtworkHref?: string;
  unitPrice: number | null;
  currency: string;
  retailer?: string;
  listingTitle?: string;
  subtotal: number | null;
};

type ListingChoice = {
  id: string;
  catalogId: string;
  title: string;
  price: number | null;
  currency: string;
  retailer?: string;
  url?: string;
  availability?: string;
  shipping?: string;
  imageUrl?: string;
};

type ListingGroup = {
  requirement: DesignPartRequirement;
  choices: ListingChoice[];
};

const WIRE_PART_ID = "wire";
const MAX_DESIGN_SEARCHES = 12;
// The discovery envelope accepts at most 24 candidates. Two options for each
// of the 12 supported BOM lines keeps every required part represented instead
// of truncating the last lines in larger designs.
const RESULTS_PER_DESIGN_PART = 2;
const LISTING_SELECTION_STORAGE_PREFIX = "schematic-parts-listing-selections";

function readListingSelections(projectId: string) {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(`${LISTING_SELECTION_STORAGE_PREFIX}:${projectId}`) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .slice(0, MAX_DESIGN_SEARCHES),
    );
  } catch {
    return {};
  }
}

const phaseMeta: Record<
  PartsUiPhase,
  { label: string; title: string; copy: string; tone: string }
> = {
  idle: {
    label: "Waiting for design",
    title: "Add components to your design",
    copy: "Matching listings will appear here as soon as the active design has components to source.",
    tone: "idle",
  },
  searching: {
    label: "Updating listings",
    title: "Loading matching listings",
    copy: "The active design is being matched to current supplier listings. Fresh cached searches are reused when available.",
    tone: "active",
  },
  candidates: {
    label: "Listings ready",
    title: "Matching listings are ready",
    copy: "Current supplier listings and prices are shown below the build cart.",
    tone: "active",
  },
  partial: {
    label: "Partially loaded",
    title: "Some listings need review",
    copy: "Some parts have listings while the remaining parts are still waiting for a usable supplier match.",
    tone: "ready",
  },
  verified: {
    label: "Listings loaded",
    title: "Build cart estimates are ready",
    copy: "The build cart combines the current supplier prices for the active design.",
    tone: "ready",
  },
  "rate-limited": {
    label: "Try again shortly",
    title: "Listings need a moment",
    copy: "The listing provider asked us to slow down. Retry after the suggested wait; your build cart is unchanged.",
    tone: "error",
  },
  failed: {
    label: "Update unavailable",
    title: "Couldn’t load the listings",
    copy: "Check the provider connection and retry the active design lookup.",
    tone: "error",
  },
};

function money(value: number | null, currency = "USD") {
  if (value === null || !Number.isFinite(value)) return "Price pending";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function visibleRetailer(value: string | undefined) {
  const retailer = value?.trim();
  if (!retailer) return undefined;
  const normalized = retailer.toLowerCase();
  if (
    normalized === "jlcsearch" ||
    normalized === "adafruit" ||
    normalized === "brightdata-serp" ||
    normalized === "google shopping"
  ) {
    return undefined;
  }
  return retailer;
}

function buildDesignRequirements(
  components: Array<{ definitionId: string }>,
  connectionCount: number,
): DesignPartRequirement[] {
  const counts = new Map<string, number>();
  for (const component of components) {
    if (getCatalogComponent(component.definitionId)) {
      counts.set(
        component.definitionId,
        (counts.get(component.definitionId) ?? 0) + 1,
      );
    }
  }

  const requirements = [...counts.entries()].flatMap(
    ([catalogId, quantity]): DesignPartRequirement[] => {
      const definition = getCatalogComponent(catalogId);
      if (!definition) return [];
      return [
        {
          key: `component:${catalogId}`,
          catalogId,
          title: definition.title,
          query: `${definition.title} ${definition.partNumber ?? catalogId} electronics component price`.slice(
            0,
            240,
          ),
          quantity,
          kind: "component",
        },
      ];
    },
  );

  if (connectionCount > 0) {
    requirements.push({
      key: WIRE_PART_ID,
      catalogId: WIRE_PART_ID,
      title: "Hookup wire",
      query: "22 AWG stranded electronics hookup wire spool price",
      quantity: connectionCount,
      kind: "wire",
    });
  }

  return requirements;
}

function choicesForRequirement(
  requirement: DesignPartRequirement,
  candidates: DiscoveryCandidate[],
  results: ShoppingResult[],
): ListingChoice[] {
  const discovered = candidates
    .filter((candidate) => candidate.catalogId === requirement.catalogId)
    .flatMap((candidate): ListingChoice[] => {
      const offer = candidate.offers[0];
      if (!offer) return [];
      return [{
        id: `candidate:${candidate.id}`,
        catalogId: requirement.catalogId,
        title: candidate.title,
        price: offer.price,
        currency: offer.currency,
        retailer: visibleRetailer(candidate.retailer ?? offer.retailer),
        ...(offer.url ? { url: offer.url } : {}),
        ...(offer.availability ? { availability: offer.availability } : {}),
        ...(candidate.shipping ? { shipping: candidate.shipping } : {}),
        ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
      }];
    });
  const published = requirement.kind === "component"
    ? results
        .filter((result) => result.catalogId === requirement.catalogId)
        .flatMap((result) => result.offers.map((offer): ListingChoice => ({
          id: `result:${result.id}:${offer.id}`,
          catalogId: requirement.catalogId,
          title: offer.title || result.title,
          price: offer.price,
          currency: offer.currency,
          retailer: visibleRetailer(offer.retailer),
          url: offer.url,
          ...(offer.availability ? { availability: offer.availability } : {}),
        })))
    : [];
  const unique = new Map<string, ListingChoice>();
  for (const choice of [...discovered, ...published]) {
    const identity = `${choice.url ?? ""}|${choice.title.toLowerCase()}|${choice.price ?? "pending"}`;
    if (!unique.has(identity)) unique.set(identity, choice);
  }
  return [...unique.values()].sort((left, right) => {
    if (left.price === null && right.price !== null) return 1;
    if (left.price !== null && right.price === null) return -1;
    if (left.currency === right.currency && left.price !== null && right.price !== null) {
      return left.price - right.price;
    }
    return left.title.localeCompare(right.title);
  });
}

function preferredChoice(choices: ListingChoice[], selectedId?: string) {
  return choices.find((choice) => choice.id === selectedId) ?? choices[0];
}

function buildCartItems(
  groups: ListingGroup[],
  selectedChoiceIds: Record<string, string>,
): BuildCartItem[] {
  return groups.map(({ requirement, choices }) => {
    const choice = preferredChoice(choices, selectedChoiceIds[requirement.key]);
    const definition =
      requirement.kind === "component"
        ? getCatalogComponent(requirement.catalogId)
        : null;
    const fallbackArtworkHref = definition
      ? componentArtworkHref(definition) ?? undefined
      : undefined;
    return {
      ...requirement,
      ...(choice?.imageUrl ? { artworkHref: choice.imageUrl } : fallbackArtworkHref ? { artworkHref: fallbackArtworkHref } : {}),
      ...(choice?.imageUrl && fallbackArtworkHref ? { fallbackArtworkHref } : {}),
      unitPrice: choice?.price ?? null,
      currency: choice?.currency ?? "USD",
      retailer: choice?.retailer,
      listingTitle: choice?.title,
      subtotal:
        choice?.price === null || choice?.price === undefined
          ? null
          : choice.price * requirement.quantity,
    };
  });
}

function toDiscoveryCandidate(
  candidate: ShoppingDiscoveryCandidate,
  requirement: DesignPartRequirement,
): DiscoveryCandidate {
  const currency =
    candidate.currency && /^[A-Z]{3}$/.test(candidate.currency)
      ? candidate.currency
      : "USD";
  const retailer = candidate.retailer ?? candidate.source;
  return {
    id: `${candidate.id}:${requirement.key}`,
    catalogId: requirement.catalogId,
    title: candidate.title,
    ...(candidate.manufacturer ? { manufacturer: candidate.manufacturer } : {}),
    partNumber: candidate.partNumber,
    ...(visibleRetailer(candidate.retailer)
      ? { retailer: candidate.retailer }
      : {}),
    ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    ...(candidate.shipping ? { shipping: candidate.shipping } : {}),
    ...(candidate.rating !== undefined ? { rating: candidate.rating } : {}),
    ...(candidate.reviewCount !== undefined
      ? { reviewCount: candidate.reviewCount }
      : {}),
    offers: [
      {
        id: `${candidate.id}:offer`,
        retailer,
        price: candidate.price,
        currency,
        url: candidate.verificationUrl,
        ...(candidate.availability
          ? { availability: candidate.availability }
          : {}),
      },
    ],
  };
}

function RetailerLink({ retailer, url }: { retailer: string; url?: string }) {
  if (!url) {
    return (
      <span className="shopping-retailer-unavailable">Link unavailable</span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="shopping-retailer-link"
      aria-label={`Open ${retailer} listing`}
      title="Open this listing to confirm the model, seller, stock, shipping, and final price"
    >
      <span>Open listing</span>
      <ArrowUpRight size={11} />
    </a>
  );
}

function ProductArtwork({
  src,
  fallback,
  alt,
  wire = false,
}: {
  src?: string;
  fallback?: string;
  alt: string;
  wire?: boolean;
}) {
  const [activeSrc, setActiveSrc] = useState(src ?? fallback);
  useEffect(() => setActiveSrc(src ?? fallback), [fallback, src]);
  if (!activeSrc) {
    return wire ? <Cable size={17} /> : <PackageSearch size={15} />;
  }
  return (
    <img
      src={activeSrc}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (fallback && activeSrc !== fallback) setActiveSrc(fallback);
        else setActiveSrc(undefined);
      }}
    />
  );
}

function ListingResults({
  groups,
  selectedChoiceIds,
  loading,
  onSelect,
  onRetry,
}: {
  groups: ListingGroup[];
  selectedChoiceIds: Record<string, string>;
  loading: boolean;
  onSelect: (requirementKey: string, choiceId: string) => void;
  onRetry: () => void;
}) {
  const selectedCount = groups.filter((group) => group.choices.length > 0).length;

  return (
    <section
      className="shopping-listing-results"
      aria-label="Matching part listings"
      data-testid="part-listings"
    >
      <header className="shopping-listing-heading">
        <div>
          <div className="kicker">Product selections</div>
          <h2>Choose one listing for each cart line</h2>
        </div>
        <span>{selectedCount}/{groups.length} selected</span>
      </header>
      <div className="shopping-listing-groups">
        {groups.map(({ requirement, choices }) => {
          const choice = preferredChoice(choices, selectedChoiceIds[requirement.key]);
          const definition = requirement.kind === "component"
            ? getCatalogComponent(requirement.catalogId)
            : null;
          const fallbackArtworkHref = definition
            ? componentArtworkHref(definition) ?? undefined
            : undefined;
          return (
            <section
              className="shopping-listing-picker"
              key={requirement.key}
              aria-labelledby={`listing-group-${requirement.key}`}
              data-testid={`listing-picker-${requirement.catalogId}`}
            >
              <div className="shopping-picker-part">
                <span className="shopping-picker-image">
                  <ProductArtwork
                    src={choice?.imageUrl}
                    fallback={fallbackArtworkHref}
                    alt={`${choice?.title ?? requirement.title} product image`}
                    wire={requirement.kind === "wire"}
                  />
                </span>
                <div>
                  <h3 id={`listing-group-${requirement.key}`}>{requirement.title}</h3>
                  <span>Qty {requirement.quantity}</span>
                </div>
              </div>
              <div className="shopping-picker-control">
                <label htmlFor={`listing-choice-${requirement.key}`}>Product listing</label>
                <select
                  id={`listing-choice-${requirement.key}`}
                  aria-label={`Choose listing for ${requirement.title}`}
                  value={choice?.id ?? ""}
                  disabled={choices.length === 0}
                  onChange={(event) => onSelect(requirement.key, event.target.value)}
                >
                  {choices.length === 0 ? (
                    <option value="">{loading ? "Searching current products…" : "No priced listing found"}</option>
                  ) : choices.map((option) => (
                    <option key={option.id} value={option.id}>
                      {[option.retailer, option.title, money(option.price, option.currency)].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
                {choice ? (
                  <p>
                    {[choice.availability, choice.shipping].filter(Boolean).join(" · ") || "Current product result"}
                  </p>
                ) : (
                  <button type="button" onClick={onRetry} disabled={loading}>
                    {loading ? "Searching…" : "Search again"}
                  </button>
                )}
              </div>
              <div className="shopping-picker-action">
                <strong>{money(choice?.price ?? null, choice?.currency)}</strong>
                {choice ? (
                  <RetailerLink retailer={choice.retailer ?? "retailer"} url={choice.url} />
                ) : <span>Awaiting result</span>}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function CartSummary({
  items,
  loading,
}: {
  items: BuildCartItem[];
  loading: boolean;
}) {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.subtotal !== null) {
      totals.set(
        item.currency,
        (totals.get(item.currency) ?? 0) + item.subtotal,
      );
    }
  }
  const totalText =
    items.length === 0
      ? money(0)
      : totals.size === 0
        ? "Price pending"
        : [...totals.entries()]
            .map(([currency, total]) => money(total, currency))
            .join(" + ");
  return (
    <section
      className="shopping-cart-summary shopping-auto-build-cart"
      aria-label="Build cart"
      data-testid="build-cart"
    >
      <div className="shopping-build-cart-heading">
        <div>
          <div className="kicker">Bill of materials</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
            <ShoppingCart size={13} /> Build cart
          </div>
        </div>
        <span className="shopping-build-cart-count">
          {items.length} line item{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="shopping-build-list">
        {items.length === 0 ? (
          <div className="shopping-build-empty">
            <span className="shopping-build-empty-icon">
              <Cable size={14} />
            </span>
            <span>
              {loading
                ? "Preparing the active design…"
                : "Add components to the design to build the parts list."}
            </span>
          </div>
        ) : (
          <>
            <div className="shopping-build-table-head" aria-hidden="true">
              <span>Part</span>
              <span>Qty</span>
              <span>Unit</span>
              <span>Subtotal</span>
            </div>
            {items.map((item) => (
              <div className="shopping-build-item" key={item.key}>
                <span className="shopping-build-item-image">
                  <ProductArtwork
                    src={item.artworkHref}
                    fallback={item.fallbackArtworkHref}
                    alt={`${item.listingTitle ?? item.title} product image`}
                    wire={item.kind === "wire"}
                  />
                </span>
                <div className="shopping-build-item-copy">
                  <div className="shopping-build-item-title">{item.title}</div>
                  <div className="shopping-build-item-detail">
                    {item.listingTitle ?? item.retailer ?? (item.unitPrice === null ? "Price pending" : "Current listing")}
                  </div>
                  <div className="shopping-build-item-compact-meta">
                    Qty {item.quantity} · {money(item.unitPrice, item.currency)} each
                  </div>
                </div>
                <span className="shopping-build-item-qty">{item.quantity}</span>
                <span className="shopping-build-item-unit">
                  {money(item.unitPrice, item.currency)}
                </span>
                <strong className="shopping-build-item-cost">
                  {item.subtotal === null
                    ? "—"
                    : money(item.subtotal, item.currency)}
                </strong>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="shopping-build-total">
        <span>Est. build cost</span>
        <strong>{totalText}</strong>
      </div>
    </section>
  );
}

function AutoLookupState({
  requirements,
  phase,
  message,
  hasListings,
  onRetry,
}: {
  requirements: DesignPartRequirement[];
  phase: PartsUiPhase;
  message: string;
  hasListings: boolean;
  onRetry: () => void;
}) {
  if (
    hasListings &&
    phase !== "searching" &&
    phase !== "failed" &&
    phase !== "rate-limited"
  ) {
    return null;
  }

  const meta = phaseMeta[phase];
  const noDesign = requirements.length === 0;
  const title = noDesign ? phaseMeta.idle.title : meta.title;
  const copy = noDesign ? phaseMeta.idle.copy : message || meta.copy;
  const needsProviderSetup = !noDesign && phase === "failed" && /not configured|missing.*key|credential|not bound|explicitly disabled|SERP zone/i.test(copy);
  return (
    <div
      className={`shopping-auto-lookup-state is-${phase}`}
      aria-live="polite"
      data-testid="auto-lookup-state"
    >
      <span className="shopping-auto-lookup-icon">
        {phase === "searching" ? (
          <LoaderCircle size={15} className="shopping-spin" />
        ) : phase === "failed" || phase === "rate-limited" ? (
          <CircleAlert size={15} />
        ) : (
          <Wifi size={15} strokeWidth={1.7} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="kicker">
          {noDesign ? "No parts in the active design" : meta.label}
        </div>
        <h2>{title}</h2>
        <p>{copy}</p>
        {needsProviderSetup ? (
          <p className="shopping-setup-hint">
            For local Vite development, add the server-only BRIGHTDATA_API_KEY to backend/.env and restart the dev server. For the hosted ChatGPT Site, bind BRIGHTDATA_API_KEY in the Site environment and publish a new version. BRIGHTDATA_SERP_ENABLED is optional when a key is present; setting it to false explicitly disables Bright Data.
          </p>
        ) : null}
      </div>
      {(phase === "failed" || phase === "rate-limited") && !noDesign && (
        <button
          type="button"
          onClick={onRetry}
          className="shopping-primary-action"
        >
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

export default function ShoppingWorkspace({
  fullPage = false,
}: {
  fullPage?: boolean;
}) {
  const project = useProjectStore((state) => state.project);
  const shopping = useShoppingStore();
  const [phase, setPhase] = useState<PartsUiPhase>("idle");
  const [discoveryCandidates, setDiscoveryCandidates] = useState<
    DiscoveryCandidate[]
  >([]);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<Record<string, string>>(
    () => readListingSelections(project.id),
  );
  const [message, setMessage] = useState("");
  const requestSequence = useRef(0);
  const activeRequest = useRef<{
    sequence: number;
    controller: AbortController;
  } | null>(null);
  const autoLookupFingerprint = useRef<string | null>(null);
  const stageDesignRef = useRef<(force?: boolean) => Promise<void>>(() => Promise.resolve());

  const designRequirements = useMemo(
    () =>
      buildDesignRequirements(project.components, project.connections.length),
    [project.components, project.connections.length],
  );
  const requiredCatalogIds = useMemo(
    () =>
      designRequirements
        .filter((requirement) => requirement.kind === "component")
        .map((requirement) => requirement.catalogId),
    [designRequirements],
  );
  const designFingerprint = useMemo(
    () =>
      `${project.id}|${designRequirements
        .map((requirement) => `${requirement.key}:${requirement.quantity}`)
        .join("|")}`,
    [designRequirements, project.id],
  );
  const visibleResults = useMemo(() => {
    const componentIds = new Set(requiredCatalogIds);
    return shopping.results.filter((result) =>
      componentIds.has(result.catalogId),
    );
  }, [requiredCatalogIds, shopping.results]);
  const listingGroups = useMemo<ListingGroup[]>(
    () => designRequirements.map((requirement) => ({
      requirement,
      choices: choicesForRequirement(requirement, discoveryCandidates, visibleResults),
    })),
    [designRequirements, discoveryCandidates, visibleResults],
  );
  const buildItems = useMemo(
    () => buildCartItems(listingGroups, selectedChoiceIds),
    [listingGroups, selectedChoiceIds],
  );
  const requestStatus: ShoppingRequestStatus =
    shopping.requestStatus ?? "idle";
  const hasListings =
    discoveryCandidates.length > 0 || visibleResults.length > 0;

  const stageDesign = async (force = false) => {
    const targets = designRequirements.slice(0, MAX_DESIGN_SEARCHES);
    if (!targets.length) {
      setDiscoveryCandidates([]);
      setPhase("idle");
      setMessage("");
      return;
    }

    const summaryQuery = `${project.name} parts`;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequest.current?.controller.abort();
    const controller = new AbortController();
    activeRequest.current = { sequence, controller };
    const requestHandoff = createShoppingHandoff(
      summaryQuery,
      1,
      requiredCatalogIds,
    );

    setDiscoveryCandidates([]);
    setMessage(
      `Loading ${targets.length} design part${targets.length === 1 ? "" : "s"}…`,
    );
    setPhase("searching");
    shopping.setQuery(summaryQuery);
    shopping.setHandoff(requestHandoff);
    shopping.setDiscovery(null);
    shopping.setRequestStatus("searching");

    const candidateMap = new Map<string, DiscoveryCandidate>();
    const discoveryCandidateMap = new Map<string, ShoppingDiscoveryCandidate>();
    const attempts: ShoppingDiscovery["attempts"] = [];
    const sourceOrder = new Set<string>();
    let cacheHit = true;
    let staleCache = false;
    let rateLimited = false;
    let retryAfterSeconds: number | undefined;
    let completed = 0;
    let failed = 0;
    const lookupErrors: string[] = [];
    const lookupMessages: string[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < targets.length && !controller.signal.aborted) {
        const index = cursor;
        cursor += 1;
        const target = targets[index];
        const lookupRequest = {
          requestId: `${requestHandoff.requestId}-${String(index + 1).padStart(2, "0")}`,
          query: target.query,
          quantity: target.quantity,
          requiredCatalogIds:
            target.kind === "component" ? [target.catalogId] : [],
          requestedAt: requestHandoff.requestedAt,
        };
        // The lookup client owns the short-lived and user-scoped persistent
        // caches. A fresh match is reused; a new or expired part reaches the
        // provider, so graph edits only add the searches they need.
        const cachedOutcome = force ? null : getCachedPartsSearch(lookupRequest);
        const cachedHasPrice = cachedOutcome?.discovery?.candidates.some(
          (candidate) => candidate.price !== null,
        ) === true;
        const outcome = cachedOutcome && cachedHasPrice
          ? cachedOutcome
          : await requestPartsSearch(
              lookupRequest,
              { bypassPersistentCache: force || Boolean(cachedOutcome) },
              controller.signal,
            );
        if (
          controller.signal.aborted ||
          activeRequest.current?.sequence !== sequence
        ) {
          return;
        }

        completed += 1;
        setMessage(`Loading design parts · ${completed}/${targets.length}`);
        if (outcome.status === "failed") {
          failed += 1;
          if (outcome.error && !lookupErrors.includes(outcome.error)) lookupErrors.push(outcome.error);
        }
        const discovery = outcome.discovery;
        if (!discovery) {
          if (outcome.status === "rate-limited") rateLimited = true;
          continue;
        }

        if (discovery.message && !lookupMessages.includes(discovery.message)) lookupMessages.push(discovery.message);
        cacheHit = cacheHit && discovery.cacheHit;
        staleCache = staleCache || discovery.staleCache;
        rateLimited =
          rateLimited ||
          discovery.rateLimited ||
          outcome.status === "rate-limited";
        retryAfterSeconds =
          retryAfterSeconds ?? discovery.retryAfterSeconds;
        discovery.sourceOrder.forEach((source) => sourceOrder.add(source));
        attempts.push(...discovery.attempts);
        for (const candidate of discovery.candidates.slice(
          0,
          RESULTS_PER_DESIGN_PART,
        )) {
          const normalized = toDiscoveryCandidate(candidate, target);
          const discoveryKey = `${target.key}:${candidate.id}`;
          if (!discoveryCandidateMap.has(discoveryKey)) {
            discoveryCandidateMap.set(discoveryKey, {
              ...candidate,
              id: `${candidate.id}:${target.key}`,
              catalogId:
                target.kind === "component" ? target.catalogId : undefined,
            });
          }
          if (!candidateMap.has(normalized.id)) {
            candidateMap.set(normalized.id, normalized);
          }
        }
      }
    };

    try {
      const workerCount = Math.min(2, targets.length);
      await Promise.all(
        Array.from({ length: workerCount }, () => worker()),
      );
      if (
        controller.signal.aborted ||
        activeRequest.current?.sequence !== sequence
      ) {
        return;
      }

      const candidates = [...candidateMap.values()].slice(0, 24);
      const omitted = designRequirements.length - targets.length;
      const resultMessage = candidates.length
        ? `Found ${candidates.length} listing${candidates.length === 1 ? "" : "s"} for ${completed} design part${completed === 1 ? "" : "s"}.${omitted > 0 ? ` ${omitted} additional part${omitted === 1 ? " was" : "s were"} kept in the cart but not searched in this pass.` : ""}`
        : rateLimited
          ? lookupMessages[0] ?? "The listing provider is temporarily rate limited. Retry the active design in a moment."
          : lookupErrors.length > 0
            ? `Couldn’t load the listings: ${lookupErrors[0]}`
            : lookupMessages.length > 0
              ? lookupMessages[0]
              : failed > 0
                ? "Some design lookups could not be completed. Retry to update the listings."
                : `No current listings matched the ${completed} design part${completed === 1 ? "" : "s"} yet.`;
      const discovery: ShoppingDiscovery = {
        candidates: [...discoveryCandidateMap.values()].slice(0, 24),
        sourceOrder: [...sourceOrder],
        attempts: attempts.slice(0, 24),
        cacheHit: completed > 0 && cacheHit,
        staleCache,
        rateLimited,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        message: resultMessage,
      };
      shopping.setDiscovery(discovery);
      shopping.setRequestStatus(
        candidates.length
          ? "staged"
          : rateLimited
            ? "rate-limited"
            : "failed",
      );
      setDiscoveryCandidates(candidates);
      setPhase(
        candidates.length
          ? "candidates"
          : rateLimited
            ? "rate-limited"
            : "failed",
      );
      setMessage(resultMessage);
    } catch (error) {
      if (
        controller.signal.aborted ||
        activeRequest.current?.sequence !== sequence
      ) {
        return;
      }
      shopping.setRequestStatus("failed");
      setPhase("failed");
      setMessage(
        error instanceof Error && error.message
          ? `Couldn’t update the listings: ${error.message}`
          : "Couldn’t update the listings. Check the connection and retry.",
      );
    } finally {
      if (activeRequest.current?.sequence === sequence) {
        activeRequest.current = null;
      }
    }
  };

  useEffect(() => {
    stageDesignRef.current = stageDesign;
  });

  useEffect(() => {
    setSelectedChoiceIds(readListingSelections(project.id));
  }, [project.id]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        `${LISTING_SELECTION_STORAGE_PREFIX}:${project.id}`,
        JSON.stringify(selectedChoiceIds),
      );
    } catch {
      // A storage-restricted browser can still keep the current selection in memory.
    }
  }, [project.id, selectedChoiceIds]);

  useEffect(() => {
    // Drop selections for design lines that no longer exist so a removed
    // component cannot pin a stale listing choice after the next lookup.
    setSelectedChoiceIds((current) => {
      const validKeys = new Set(designRequirements.map((requirement) => requirement.key));
      const pruned = Object.fromEntries(Object.entries(current).filter(([key]) => validKeys.has(key)));
      return Object.keys(pruned).length === Object.keys(current).length ? current : pruned;
    });
  }, [designFingerprint, designRequirements]);

  useEffect(() => {
    if (!designRequirements.length) {
      autoLookupFingerprint.current = null;
      requestSequence.current += 1;
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
      setDiscoveryCandidates([]);
      setPhase("idle");
      setMessage("");
      return;
    }
    if (autoLookupFingerprint.current === designFingerprint) return;
    autoLookupFingerprint.current = designFingerprint;
    void stageDesignRef.current();
  }, [designFingerprint, designRequirements.length]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
      // React StrictMode mounts, unmounts, and remounts once in development.
      // Clearing the fingerprint here lets the remounted effect re-run the
      // lookup that the simulated unmount just aborted, instead of leaving
      // the store stuck in "searching" forever.
      autoLookupFingerprint.current = null;
    },
    [],
  );

  useEffect(() => {
    // A successful canonical publication replaces the temporary discovery
    // feed in the store. Drop its local mirror too so the page never shows an
    // obsolete pre-publication list beside the accepted records.
    if (
      (requestStatus === "ready" || requestStatus === "partial") &&
      shopping.discovery === null &&
      shopping.results.length > 0
    ) {
      setDiscoveryCandidates([]);
    }
  }, [requestStatus, shopping.discovery, shopping.results.length]);

  const effectivePhase: PartsUiPhase =
    requestStatus === "searching"
      ? "searching"
      : requestStatus === "rate-limited"
        ? "rate-limited"
        : requestStatus === "failed" && phase === "idle"
          ? "failed"
          : requestStatus === "partial"
            ? "partial"
            : requestStatus === "ready" && visibleResults.length > 0
              ? "verified"
              : phase;
  const retryAutoLookup = () => {
    autoLookupFingerprint.current = designFingerprint;
    void stageDesignRef.current(true);
  };
  const selectListing = (requirementKey: string, choiceId: string) => {
    setSelectedChoiceIds((current) => ({ ...current, [requirementKey]: choiceId }));
  };

  return (
    <div
      className={`shopping-workspace shopping-auto-sourced ${fullPage ? "is-full-page" : "is-compact-panel"} flex h-full min-h-0 flex-col bg-card text-xs`}
    >
      <CartSummary
        items={buildItems}
        loading={effectivePhase === "searching"}
      />
      <section
        className="shopping-results-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4"
        aria-label="Parts lookup results"
        aria-busy={effectivePhase === "searching"}
      >
        <AutoLookupState
          requirements={designRequirements}
          phase={effectivePhase}
          message={message}
          hasListings={hasListings}
          onRetry={retryAutoLookup}
        />
        {designRequirements.length > 0 && (
          <ListingResults
            groups={listingGroups}
            selectedChoiceIds={selectedChoiceIds}
            loading={effectivePhase === "searching"}
            onSelect={selectListing}
            onRetry={retryAutoLookup}
          />
        )}
      </section>
    </div>
  );
}
