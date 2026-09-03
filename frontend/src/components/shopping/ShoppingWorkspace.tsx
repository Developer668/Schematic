import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Cable,
  CircleAlert,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  Star,
  Wifi,
} from "lucide-react";
import { getCatalogComponent } from "../../data/catalog.ts";
import { componentArtworkHref } from "../../data/componentArtwork.ts";
import { useProjectStore } from "../../store/useProjectStore.ts";
import {
  createShoppingHandoff,
  useShoppingStore,
  type PartOffer,
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
  unitPrice: number | null;
  currency: string;
  retailer?: string;
  subtotal: number | null;
};

type PricePoint = {
  price: number | null;
  currency: string;
  retailer?: string;
};

const WIRE_PART_ID = "wire";
const MAX_DESIGN_SEARCHES = 12;
const RESULTS_PER_DESIGN_PART = 3;

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
          query: `${definition.title} ${definition.partNumber ?? catalogId}`.slice(
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
      query: "electronics hookup wire",
      quantity: connectionCount,
      kind: "wire",
    });
  }

  return requirements;
}

function lowestPrice(points: PricePoint[]): PricePoint {
  const priced = points.filter(
    (point) => point.price !== null && Number.isFinite(point.price),
  );
  if (!priced.length) {
    return {
      price: null,
      currency: points[0]?.currency ?? "USD",
      retailer: visibleRetailer(points[0]?.retailer),
    };
  }

  // Do not compare numeric values from different currencies. Prefer USD when
  // it is present, otherwise keep the first currency returned for this part.
  const currency =
    priced.find((point) => point.currency === "USD")?.currency ??
    priced[0].currency;
  return priced
    .filter((point) => point.currency === currency)
    .reduce((lowest, point) => {
      if (
        lowest.price === null ||
        (point.price !== null && point.price < lowest.price)
      ) {
        return point;
      }
      return lowest;
    });
}

function buildCartItems(
  requirements: DesignPartRequirement[],
  candidates: DiscoveryCandidate[],
  results: ShoppingResult[],
): BuildCartItem[] {
  return requirements.map((requirement) => {
    const discoveryPrices = candidates
      .filter((candidate) => candidate.catalogId === requirement.catalogId)
      .flatMap((candidate) =>
        candidate.offers.map((offer) => ({
          price: offer.price,
          currency: offer.currency,
          retailer: visibleRetailer(offer.retailer),
        })),
      );
    const publishedPrices =
      requirement.kind === "component"
        ? results
            .filter((result) => result.catalogId === requirement.catalogId)
            .flatMap((result) =>
              result.offers.map((offer) => ({
                price: offer.price,
                currency: offer.currency,
                retailer: visibleRetailer(offer.retailer),
              })),
            )
        : [];
    const price = lowestPrice([...publishedPrices, ...discoveryPrices]);
    const definition =
      requirement.kind === "component"
        ? getCatalogComponent(requirement.catalogId)
        : null;
    return {
      ...requirement,
      ...(definition
        ? { artworkHref: componentArtworkHref(definition) ?? undefined }
        : {}),
      unitPrice: price.price,
      currency: price.currency,
      retailer: price.retailer,
      subtotal:
        price.price === null ? null : price.price * requirement.quantity,
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

function cheapestOfferId(result: ShoppingResult) {
  return result.offers.reduce<string | undefined>((best, offer) => {
    if (offer.price === null || !Number.isFinite(offer.price)) return best;
    if (!best) return offer.id;
    const current = result.offers.find((candidate) => candidate.id === best);
    return !current || current.price === null || offer.price < current.price
      ? offer.id
      : best;
  }, undefined);
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

function OfferRow({
  offer,
  cheapest,
}: {
  offer: PartOffer;
  cheapest: boolean;
}) {
  const retailer = visibleRetailer(offer.retailer);
  return (
    <div className={`shopping-offer-row ${cheapest ? "is-selected" : ""}`}>
      <span
        className={`shopping-offer-radio is-readonly ${cheapest ? "is-cheapest" : ""}`}
        aria-hidden="true"
      >
        {cheapest && <span />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11px] font-medium">
            {retailer ?? "Retailer listing"}
          </span>
          {cheapest && <span className="shopping-best-price">Best price</span>}
        </div>
        {offer.availability && (
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {offer.availability}
          </div>
        )}
      </div>
      <span
        className={`shrink-0 font-mono text-[11px] tabular-nums ${offer.price === null ? "text-muted-foreground" : "text-foreground"}`}
      >
        {money(offer.price, offer.currency)}
      </span>
      <RetailerLink retailer={retailer ?? "retailer"} url={offer.url} />
    </div>
  );
}

function ResultCard({ result }: { result: ShoppingResult }) {
  const lowestOfferId = cheapestOfferId(result);
  const catalogEntry = getCatalogComponent(result.catalogId);
  const artworkHref = catalogEntry ? componentArtworkHref(catalogEntry) : null;
  return (
    <article
      className="shopping-verified-card"
      aria-label={`Listing for ${result.title}`}
      data-testid={`verified-result-${result.id}`}
    >
      <div className="shopping-result-head">
        <div
          className={`shopping-result-mark ${catalogEntry ? "has-artwork" : ""}`}
        >
          {artworkHref ? (
            <img
              src={artworkHref}
              alt={`${result.title} component image`}
              loading="lazy"
            />
          ) : (
            <PackageSearch size={15} strokeWidth={1.7} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold">{result.title}</h3>
        </div>
      </div>
      <div className="shopping-offers-block">
        {result.offers.slice(0, 3).map((offer) => (
          <OfferRow
            key={offer.id}
            offer={offer}
            cheapest={offer.id === lowestOfferId}
          />
        ))}
      </div>
    </article>
  );
}

function DiscoveryCard({ candidate }: { candidate: DiscoveryCandidate }) {
  const catalogEntry = getCatalogComponent(candidate.catalogId);
  const libraryArtworkHref = catalogEntry
    ? componentArtworkHref(catalogEntry)
    : null;
  const artworkHref = libraryArtworkHref ?? candidate.imageUrl;
  const retailer = visibleRetailer(candidate.retailer);
  const offer = candidate.offers[0];
  return (
    <article
      className="shopping-discovery-card"
      aria-label={`Listing for ${candidate.title}`}
      data-testid={`discovery-candidate-${candidate.id}`}
    >
      <div className="shopping-discovery-head">
        <div
          className={`shopping-discovery-mark ${artworkHref ? "has-image" : ""}`}
        >
          {artworkHref ? (
            <img
              src={artworkHref}
              alt={`${candidate.title} component image`}
              loading="lazy"
            />
          ) : candidate.catalogId === WIRE_PART_ID ? (
            <Cable size={17} />
          ) : (
            <PackageSearch size={15} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold">{candidate.title}</h3>
          {(retailer || offer?.availability || candidate.rating !== undefined) && (
            <div className="shopping-listing-meta">
              {offer?.availability && <span>{offer.availability}</span>}
              {offer?.availability && retailer && <span aria-hidden="true">·</span>}
              {retailer && <span>{retailer}</span>}
              {(offer?.availability || retailer) && candidate.rating !== undefined && <span aria-hidden="true">·</span>}
              {candidate.rating !== undefined && (
                <span
                  className="shopping-result-rating"
                  title={`${candidate.rating.toFixed(1)} out of 5${candidate.reviewCount ? ` from ${candidate.reviewCount.toLocaleString()} reviews` : ""}`}
                >
                  <Star size={10} /> {candidate.rating.toFixed(1)}
                  {candidate.reviewCount ? (
                    <small>({candidate.reviewCount.toLocaleString()})</small>
                  ) : null}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {offer ? (
        <>
          <strong className="shopping-listing-price">
            {money(offer.price, offer.currency)}
          </strong>
          <RetailerLink retailer={retailer ?? "retailer"} url={offer.url} />
        </>
      ) : (
        <p className="shopping-discovery-empty">
          Price pending
        </p>
      )}
      {candidate.shipping && (
        <p className="shopping-discovery-shipping">{candidate.shipping}</p>
      )}
    </article>
  );
}

function ListingResults({
  requirements,
  candidates,
  results,
}: {
  requirements: DesignPartRequirement[];
  candidates: DiscoveryCandidate[];
  results: ShoppingResult[];
}) {
  const groups = requirements.flatMap((requirement) => {
    const matchingCandidates = candidates.filter(
      (candidate) => candidate.catalogId === requirement.catalogId,
    );
    const matchingResults = results.filter(
      (result) => result.catalogId === requirement.catalogId,
    );
    const matchCount = matchingCandidates.length + matchingResults.length;
    return matchCount > 0
      ? [{ requirement, matchingCandidates, matchingResults, matchCount }]
      : [];
  });
  const listingCount = groups.reduce((total, group) => total + group.matchCount, 0);

  return (
    <section
      className="shopping-listing-results"
      aria-label="Matching part listings"
      data-testid="part-listings"
    >
      <header className="shopping-listing-heading">
        <div>
          <div className="kicker">Available listings</div>
          <h2>Matched to the build cart</h2>
        </div>
        <span>{listingCount} match{listingCount === 1 ? "" : "es"}</span>
      </header>
      <div className="shopping-listing-groups">
        {groups.map(({ requirement, matchingCandidates, matchingResults, matchCount }) => (
          <section
            className="shopping-listing-group"
            key={requirement.key}
            aria-labelledby={`listing-group-${requirement.key}`}
          >
            <header className="shopping-listing-group-heading">
              <div>
                <h3 id={`listing-group-${requirement.key}`}>{requirement.title}</h3>
                <span>Qty {requirement.quantity}</span>
              </div>
              <small>{matchCount} option{matchCount === 1 ? "" : "s"}</small>
            </header>
            <div className="shopping-discovery-grid">
              {matchingCandidates.map((candidate) => (
                <DiscoveryCard key={candidate.id} candidate={candidate} />
              ))}
              {matchingResults.map((result) => (
                <ResultCard key={result.id} result={result} />
              ))}
            </div>
          </section>
        ))}
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
  const missingCount = items.filter((item) => item.unitPrice === null).length;

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
                  {item.artworkHref ? (
                    <img
                      src={item.artworkHref}
                      alt={`${item.title} component image`}
                      loading="lazy"
                    />
                  ) : (
                    <Cable size={15} />
                  )}
                </span>
                <div className="shopping-build-item-copy">
                  <div className="shopping-build-item-title">{item.title}</div>
                  <div className="shopping-build-item-detail">
                    {item.retailer ?? (item.unitPrice === null ? "Price pending" : "Current listing")}
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
      <div className="shopping-estimate-note">
        {missingCount > 0
          ? `${missingCount} item${missingCount === 1 ? "" : "s"} awaiting a listing price`
          : items.length > 0
            ? "Based on the lowest current listing for each line item"
            : "Updates from the active design"}
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
  const [message, setMessage] = useState("");
  const requestSequence = useRef(0);
  const activeRequest = useRef<{
    sequence: number;
    controller: AbortController;
  } | null>(null);
  const autoLookupFingerprint = useRef<string | null>(null);
  const stageDesignRef = useRef<() => Promise<void>>(() => Promise.resolve());

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
  const buildItems = useMemo(
    () =>
      buildCartItems(designRequirements, discoveryCandidates, visibleResults),
    [designRequirements, discoveryCandidates, visibleResults],
  );
  const requestStatus: ShoppingRequestStatus =
    shopping.requestStatus ?? "idle";
  const hasListings =
    discoveryCandidates.length > 0 || visibleResults.length > 0;

  const stageDesign = async () => {
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
        const outcome =
          getCachedPartsSearch(lookupRequest) ??
          (await requestPartsSearch(lookupRequest, {}, controller.signal));
        if (
          controller.signal.aborted ||
          activeRequest.current?.sequence !== sequence
        ) {
          return;
        }

        completed += 1;
        setMessage(`Loading design parts · ${completed}/${targets.length}`);
        const discovery = outcome.discovery;
        if (!discovery) {
          if (outcome.status === "rate-limited") rateLimited = true;
          if (outcome.status === "failed") failed += 1;
          continue;
        }

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
          ? "The listing provider is temporarily rate limited. Retry the active design in a moment."
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
    void stageDesignRef.current();
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
        {hasListings && (
          <ListingResults
            requirements={designRequirements}
            candidates={discoveryCandidates}
            results={visibleResults}
          />
        )}
      </section>
    </div>
  );
}
