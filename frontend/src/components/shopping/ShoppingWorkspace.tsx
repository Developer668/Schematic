import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Check,
  CircleAlert,
  LoaderCircle,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Star,
  Trash2,
  Undo2,
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
  type ShoppingState,
} from "../../store/useShoppingStore.ts";
import { createPartsSearchCoordinator, getCachedPartsSearch, requestPartsSearch } from "../../shopping/partsSearchClient.ts";
import GooeyInput from "../ui/gooey-input.tsx";

type ShoppingSnapshot = ShoppingState;
type ShoppingQuote = ReturnType<ShoppingSnapshot["getQuote"]>;
type PartsUiPhase =
  | "idle"
  | "searching"
  | "candidates"
  | "verification"
  | "rate-limited"
  | "partial"
  | "verified"
  | "failed"
  | "cancelled";

type DiscoveryOffer = {
  id: string;
  retailer: string;
  title: string;
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
  exactMatch: boolean;
  matchNote?: string;
  provider?: string;
  retailer?: string;
  imageUrl?: string;
  shipping?: string;
  rating?: number;
  reviewCount?: number;
  rank?: number;
  offers: DiscoveryOffer[];
};

type LookupRequest = { query: string; quantity: number };
type LookupMode = "single" | "design";

const MAX_DESIGN_SEARCHES = 12;
const RESULTS_PER_DESIGN_PART = 3;

const phaseMeta: Record<
  PartsUiPhase,
  { label: string; title: string; copy: string; tone: string }
> = {
  idle: {
    label: "Ready to search",
    title: "Search the live parts market",
    copy: "Use an exact manufacturer part number, board name, sensor, module, tool, or build component.",
    tone: "idle",
  },
  searching: {
    label: "Searching live listings",
    title: "Searching Google Shopping",
    copy: "Bright Data is collecting current indexed shopping results. You can cancel without changing the cart.",
    tone: "active",
  },
  candidates: {
    label: "Live results",
    title: "Shopping results ready",
    copy: "Compare the reported seller, price, rating, shipping, and product link. Confirm the exact model before purchasing.",
    tone: "active",
  },
  verification: {
    label: "Ready for agent",
    title: "Ready for agent review",
    copy: "Send this handoff to an authenticated WebMCP agent to review candidates and publish records with canonical ID claims.",
    tone: "active",
  },
  "rate-limited": {
    label: "Try again shortly",
    title: "Provider needs a moment",
    copy: "The provider asked us to slow down. Retry after the suggested wait; your cart is unchanged.",
    tone: "error",
  },
  partial: {
    label: "Published / partial",
    title: "Some listings need review",
    copy: "A few publication records were rejected. Accepted agent-published records remain available for cart actions.",
    tone: "ready",
  },
  verified: {
    label: "Agent-published",
    title: "Agent-published listings ready",
    copy: "Published records claim a canonical catalog ID. Choose an offer and quantity before adding to the cart.",
    tone: "ready",
  },
  failed: {
    label: "Search unavailable",
    title: "Couldn’t complete the live search",
    copy: "Check the provider connection, use a more exact part number, or retry the request.",
    tone: "error",
  },
  cancelled: {
    label: "Cancelled",
    title: "Lookup cancelled",
    copy: "No listing was published. Submit the request again when you are ready.",
    tone: "idle",
  },
};

function money(value: number | null, currency = "USD") {
  if (value === null || !Number.isFinite(value)) return "Price unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function dateLabel(value: number | string | null | undefined) {
  if (!value) return "Awaiting first agent search";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return "";
}

function safeRetailerUrl(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function safeDiscoveryPrice(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeDiscoveryCandidates(value: unknown): DiscoveryCandidate[] {
  const envelope = asRecord(value);
  const rawResults = envelope
    ? Array.isArray(envelope.candidates)
      ? envelope.candidates
      : Array.isArray(envelope.results)
        ? envelope.results
        : []
    : [];
  return rawResults.flatMap((entry, index): DiscoveryCandidate[] => {
    const item = asRecord(entry);
    if (!item) return [];
    const title =
      firstString(item, ["title", "name"]) || "Unlabelled provider candidate";
    const catalogId = firstString(item, [
      "catalogId",
      "componentId",
      "schematicCatalogId",
    ]);
    const partNumber = firstString(item, [
      "partNumber",
      "mpn",
      "manufacturerPartNumber",
    ]);
    const retailer = firstString(item, ["retailer", "shop", "seller"]);
    const provider = firstString(item, ["provider", "source"]);
    const imageUrl = safeRetailerUrl(item.imageUrl ?? item.image_url ?? item.thumbnail);
    const shipping = firstString(item, ["shipping", "delivery"]);
    const rating = safeDiscoveryPrice(item.rating);
    const reviewCount = safeDiscoveryPrice(item.reviewCount ?? item.reviews_cnt ?? item.reviews);
    const rank = safeDiscoveryPrice(item.rank);
    const rawOffers = Array.isArray(item.offers)
      ? item.offers
      : item.verificationUrl
        ? [
            {
              ...item,
              url: item.verificationUrl,
              retailer: retailer || provider || "Google Shopping",
            },
          ]
        : item.url
          ? [item]
          : [];
    const offers = rawOffers.flatMap(
      (rawOffer, offerIndex): DiscoveryOffer[] => {
        const offer = asRecord(rawOffer);
        if (!offer) return [];
        const retailer =
          firstString(offer, ["retailer", "source"]) || "Unidentified retailer";
        const offerTitle = firstString(offer, ["title", "name"]) || title;
        const currency = firstString(offer, [
          "currency",
          "currencyCode",
        ]).toUpperCase();
        const price = /^[A-Z]{3}$/.test(currency)
          ? safeDiscoveryPrice(offer.price ?? offer.unitPrice)
          : null;
        const url = safeRetailerUrl(
          offer.url ?? offer.productUrl ?? offer.link,
        );
        return [
          {
            id:
              firstString(offer, ["id"]) ||
              `candidate-${index}-offer-${offerIndex}`,
            retailer,
            title: offerTitle,
            price,
            currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
            ...(url ? { url } : {}),
            ...(firstString(offer, ["availability"])
              ? { availability: firstString(offer, ["availability"]) }
              : {}),
          },
        ];
      },
    );
    if (!title && !partNumber && !catalogId) return [];
    return [
      {
        id: firstString(item, ["id"]) || `candidate-${index}`,
        catalogId,
        title,
        ...(firstString(item, ["manufacturer"])
          ? { manufacturer: firstString(item, ["manufacturer"]) }
          : {}),
        partNumber,
        exactMatch: item.exactMatch === true,
        ...(firstString(item, ["matchNote"])
          ? { matchNote: firstString(item, ["matchNote"]) }
          : {}),
        ...(provider ? { provider } : {}),
        ...(retailer ? { retailer } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(shipping ? { shipping } : {}),
        ...(rating !== null && rating <= 5 ? { rating } : {}),
        ...(reviewCount !== null ? { reviewCount: Math.round(reviewCount) } : {}),
        ...(rank !== null ? { rank: Math.round(rank) } : {}),
        offers,
      },
    ];
  });
}

function quantityValue(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999
    ? parsed
    : null;
}

function progressLevel(phase: PartsUiPhase) {
  if (phase === "verified" || phase === "partial") return 3;
  if (phase === "candidates" || phase === "verification") return 2;
  if (
    phase === "searching" ||
    phase === "rate-limited" ||
    phase === "failed" ||
    phase === "cancelled"
  )
    return 1;
  return 0;
}

function SourcingProgress({
  phase,
  resultCount,
  candidateCount,
  projectPartCount,
}: {
  phase: PartsUiPhase;
  resultCount: number;
  candidateCount: number;
  projectPartCount: number;
}) {
  const active = progressLevel(phase);
  const steps = ["Search", "Compare", "Review"];
  const title =
    phase === "verified" || phase === "partial"
      ? `${resultCount} agent-published design part${resultCount === 1 ? "" : "s"} ready to compare`
      : phase === "candidates"
        ? `${candidateCount} live shopping result${candidateCount === 1 ? "" : "s"} ready to compare`
        : phase === "searching"
          ? "Searching indexed shopping listings"
          : `${projectPartCount} design part${projectPartCount === 1 ? "" : "s"} queued for supplier lookup`;
  return (
    <div
      className={`shopping-request-card is-${phase}`}
      aria-live="polite"
      data-testid="sourcing-progress"
    >
      <div className="shopping-request-icon">
        {phase === "searching" ? (
          <LoaderCircle size={15} className="shopping-spin" />
        ) : (
          <PackageSearch size={15} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="kicker">Sourcing pipeline</span>
          <span className={`shopping-state-pill is-${phaseMeta[phase].tone}`}>
            {phaseMeta[phase].label}
          </span>
        </div>
        <p className="shopping-request-title">{title}</p>
        <p className="shopping-request-copy">
          {phaseMeta[phase].copy}
        </p>
      </div>
      <div className="shopping-request-steps" aria-label="Sourcing progress">
        {steps.map((step, index) => (
          <div
            key={step}
            className={`shopping-request-step ${active >= index + 1 ? "is-active" : ""}`}
          >
            <span className="shopping-step-dot">
              {active >= index + 1 ? <Check size={10} /> : index + 1}
            </span>
            <span>{step}</span>
            {index < steps.length - 1 && (
              <span className="shopping-step-line" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LookupStatus({
  phase,
  message,
  hasDesign,
  onCancel,
  onRetry,
  onStageDesign,
}: {
  phase: PartsUiPhase;
  message: string;
  hasDesign: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onStageDesign: () => void;
}) {
  // Published listings already carry their concise status in the result zone;
  // keep this panel for transitions and actionable states so status copy does
  // not repeat directly above the results.
  if (phase === "idle" || phase === "candidates" || phase === "verified" || (phase === "partial" && !message)) return null;
  const meta = phaseMeta[phase];
  const retryable =
    phase === "rate-limited" ||
    phase === "failed" ||
    phase === "cancelled";
  return (
    <section
      className={`shopping-state-panel is-${phase}`}
      role="status"
      aria-live="polite"
      data-testid="lookup-status"
    >
      <div className="shopping-state-icon">
        {phase === "searching" ? (
          <LoaderCircle size={15} className="shopping-spin" />
        ) : phase === "cancelled" ? (
          <Ban size={15} />
        ) : phase === "partial" ? (
          <BadgeCheck size={15} />
        ) : (
          <CircleAlert size={15} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="kicker">Lookup state</div>
        <h3>{meta.title}</h3>
        <p>{message || meta.copy}</p>
      </div>
      <div className="shopping-state-actions">
        {phase === "searching" && (
          <button
            type="button"
            onClick={onCancel}
            className="shopping-secondary-action"
          >
            <Ban size={12} /> Cancel lookup
          </button>
        )}
        {retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="shopping-primary-action"
          >
            <RefreshCw size={12} /> Retry lookup
          </button>
        )}
        {phase === "verification" && hasDesign && (
          <button
            type="button"
            onClick={onStageDesign}
            className="shopping-secondary-action"
          >
            <PackageCheck size={12} /> Search current design
          </button>
        )}
      </div>
    </section>
  );
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
  if (!url)
    return (
      <span className="shopping-retailer-unavailable">
        Retailer link unavailable
      </span>
    );
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="shopping-retailer-link"
      aria-label={`View ${retailer} shopping result`}
      title="Open the shopping result; confirm the exact model, seller, stock, shipping, and final price"
    >
      <span>View result</span>
      <ArrowUpRight size={11} />
    </a>
  );
}

function OfferRow({
  offer,
  selected,
  selectable,
  cheapest,
  onSelect,
}: {
  offer: PartOffer;
  selected: boolean;
  selectable: boolean;
  cheapest: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={`shopping-offer-row ${selected ? "is-selected" : ""}`}>
      {selectable ? (
        <button
          type="button"
          onClick={onSelect}
          className={`shopping-offer-radio ${selected ? "is-selected" : ""}`}
          aria-label={`Use ${offer.retailer} offer`}
          aria-pressed={selected}
        >
          {selected && <span />}
        </button>
      ) : (
        <span
          className={`shopping-offer-radio is-readonly ${cheapest ? "is-cheapest" : ""}`}
          aria-hidden="true"
        >
          {cheapest && <span />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11px] font-medium">
            {offer.retailer}
          </span>
          {cheapest && <span className="shopping-best-price">Best price</span>}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {offer.title}
          {offer.availability
            ? ` · reported ${offer.availability}`
            : " · agent-sourced offer"}
        </div>
      </div>
      <span
        className={`shrink-0 font-mono text-[11px] tabular-nums ${offer.price === null ? "text-muted-foreground" : "text-foreground"}`}
      >
        {money(offer.price, offer.currency)}
      </span>
      <RetailerLink retailer={offer.retailer} url={offer.url} />
    </div>
  );
}

function ResultCard({
  result,
  cartLine,
  onAdd,
  onRemove,
  onQuantity,
  onOffer,
  onAlternative,
}: {
  result: ShoppingResult;
  cartLine?: { resultId: string; quantity: number; selectedOfferId?: string };
  onAdd: () => void;
  onRemove: () => void;
  onQuantity: (quantity: number) => void;
  onOffer: (offerId: string) => void;
  onAlternative: (catalogId: string) => void;
}) {
  const alternatives = (
    Array.isArray(result.alternatives) ? result.alternatives : []
  ).filter((alternative) =>
    Boolean(getCatalogComponent(alternative.catalogId)),
  );
  const lowestOfferId = cheapestOfferId(result);
  const catalogEntry = getCatalogComponent(result.id);
  const artworkHref = catalogEntry ? componentArtworkHref(catalogEntry) : null;
  return (
    <article
      className="shopping-verified-card"
      aria-label={`Agent-published listing ${result.title}`}
      data-testid={`verified-result-${result.id}`}
    >
      <div className="shopping-result-head">
        <div className={`shopping-result-mark ${catalogEntry ? "has-artwork" : ""}`}>
          {artworkHref ? (
            <img
              src={artworkHref}
              alt=""
              loading="lazy"
            />
          ) : (
            <PackageCheck size={15} strokeWidth={1.7} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3 className="truncate text-xs font-semibold">{result.title}</h3>
            <span className="shopping-verified-badge">
              <BadgeCheck size={10} /> Canonical catalog ID claimed
            </span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>{result.manufacturer ?? "Catalog identity"}</span>
            <span aria-hidden="true">·</span>
            <code className="font-mono">{result.partNumber}</code>
            <span aria-hidden="true">·</span>
            <span>requested qty {result.requestedQuantity}</span>
          </div>
        </div>
        {cartLine ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <div
              className="shopping-cart-quantity"
              role="group"
              aria-label={`${result.title} cart quantity`}
            >
              <button
                type="button"
                onClick={() => onQuantity(cartLine.quantity - 1)}
                aria-label={`Decrease ${result.title} quantity`}
              >
                −
              </button>
              <span>{cartLine.quantity}</span>
              <button
                type="button"
                onClick={() => onQuantity(cartLine.quantity + 1)}
                aria-label={`Increase ${result.title} quantity`}
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={onRemove}
              className="shopping-icon-action is-remove"
              aria-label={`Remove ${result.title} from cart`}
              title="Remove from cart"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            disabled={!result.exactMatch}
            className="shopping-add-button"
            title={
              result.exactMatch
                ? "Add agent-published record"
                : "Review the part number before adding this listing"
            }
          >
            {result.exactMatch ? "Add to cart" : "Review match"}
          </button>
        )}
      </div>
      {result.matchNote && (
        <div className="shopping-result-note">{result.matchNote}</div>
      )}
      <div className="shopping-offers-block">
        <div className="shopping-offers-head">
          <span className="kicker">Agent-published offers</span>
          <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
            {Math.min(result.offers.length, 3)} of 3 shown
          </span>
        </div>
        {result.offers.slice(0, 3).map((offer) => (
          <OfferRow
            key={offer.id}
            offer={offer}
            selected={
              cartLine?.selectedOfferId === offer.id ||
              Boolean(
                cartLine &&
                !cartLine.selectedOfferId &&
                offer.id === lowestOfferId,
              ) ||
              (!cartLine && offer.id === lowestOfferId)
            }
            selectable={Boolean(cartLine)}
            cheapest={offer.id === lowestOfferId}
            onSelect={() => onOffer(offer.id)}
          />
        ))}
        <p className="shopping-retailer-note">
          <ArrowUpRight size={11} /> Retailer pages open only when clicked.
          Confirm live stock, shipping, and final price before checkout.
        </p>
      </div>
      {alternatives.length > 0 && (
        <div className="shopping-alternatives">
          <span className="text-[10px] font-medium text-muted-foreground">
            Agent-published alternatives
          </span>
          {alternatives.map((alternative) => (
            <button
              key={alternative.catalogId}
              type="button"
              onClick={() => onAlternative(alternative.catalogId)}
              className="shopping-alternative-button"
              title={alternative.reason}
            >
              {alternative.title}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function DiscoveryOfferRow({ offer }: { offer: DiscoveryOffer }) {
  return (
    <div className="shopping-discovery-offer">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium">
          {offer.retailer}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {offer.title}
          {offer.availability ? ` · reported ${offer.availability}` : ""}
        </span>
      </div>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {money(offer.price, offer.currency)}
      </span>
      <RetailerLink retailer={offer.retailer} url={offer.url} />
    </div>
  );
}

function DiscoveryCard({ candidate }: { candidate: DiscoveryCandidate }) {
  return (
    <article
      className="shopping-discovery-card"
      aria-label={`Live shopping result ${candidate.title}`}
      data-testid={`discovery-candidate-${candidate.id}`}
    >
      <div className="shopping-discovery-head">
        <div className={`shopping-discovery-mark ${candidate.imageUrl ? "has-image" : ""}`}>
          {candidate.imageUrl ? (
            <img
              src={candidate.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <PackageSearch size={15} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-xs font-semibold">
              {candidate.title}
            </h3>
            <span className="shopping-unverified-badge">
              Live shopping result
            </span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>{candidate.retailer ?? candidate.manufacturer ?? "Google Shopping"}</span>
            {candidate.partNumber && (
              <>
                <span aria-hidden="true">·</span>
                <code className="font-mono">{candidate.partNumber}</code>
              </>
            )}
            {candidate.rating !== undefined && (
              <span className="shopping-result-rating" title={`${candidate.rating.toFixed(1)} out of 5${candidate.reviewCount ? ` from ${candidate.reviewCount.toLocaleString()} reviews` : ""}`}>
                <Star size={10} /> {candidate.rating.toFixed(1)}
                {candidate.reviewCount ? <small>({candidate.reviewCount.toLocaleString()})</small> : null}
              </span>
            )}
          </div>
        </div>
        <span className="shopping-no-cart-badge">Review first</span>
      </div>
      <div className="shopping-discovery-identity">
        <span className="kicker">Identity to confirm</span>
        <code>{candidate.partNumber || candidate.catalogId || candidate.title}</code>
      </div>
      {candidate.matchNote && (
        <p className="shopping-discovery-note">{candidate.matchNote}</p>
      )}
      {candidate.shipping && (
        <p className="shopping-discovery-shipping">{candidate.shipping}</p>
      )}
      <p className="shopping-discovery-warning">
        <ShieldCheck size={12} /> This result came from a live web search, not a verified Schematic catalog match. Confirm the model number, seller, stock, shipping, and checkout total before buying.
      </p>
      {candidate.offers.length > 0 ? (
        <div className="shopping-discovery-offers">
          <div className="shopping-offers-head">
            <span className="kicker">Reported offer</span>
            <span className="font-mono text-[9px] text-muted-foreground">
              Open to verify
            </span>
          </div>
          {candidate.offers.slice(0, 3).map((offer) => (
            <DiscoveryOfferRow key={offer.id} offer={offer} />
          ))}
        </div>
      ) : (
        <p className="shopping-discovery-empty">
          The search result did not include a retailer link or price. Try the exact manufacturer part number for a more specific result.
        </p>
      )}
    </article>
  );
}

function DiscoveryZone({ candidates }: { candidates: DiscoveryCandidate[] }) {
  const liveShopping = candidates.some((candidate) => candidate.provider === "brightdata-serp");
  return (
    <section
      className="shopping-discovery-zone"
      aria-label="Live shopping results"
      data-testid="public-discovery"
    >
      <div className="shopping-zone-head">
        <div>
          <div className="kicker">{liveShopping ? "Live shopping results" : "Public discovery"}</div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {candidates.length} result{candidates.length === 1 ? "" : "s"} · prices and availability may change
          </p>
        </div>
        <span className="shopping-zone-lock">
          <ShieldCheck size={11} /> Verify before purchase
        </span>
      </div>
      <div className="shopping-discovery-grid">
        {candidates.map((candidate) => (
          <DiscoveryCard key={candidate.id} candidate={candidate} />
        ))}
      </div>
    </section>
  );
}

function CartSummary({
  shopping,
  quote,
  onReset,
  detailed = false,
}: {
  shopping: ShoppingSnapshot;
  quote: ShoppingQuote;
  onReset: () => void;
  detailed?: boolean;
}) {
  return (
    <section
      className={`shopping-cart-summary ${detailed ? "min-h-full p-4" : "shrink-0 p-3"}`}
      aria-label="Build cart"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="kicker">Bill of materials</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
            <ShoppingCart size={13} /> Build cart
          </div>
        </div>
        <span className="rounded bg-background px-2 py-1 font-mono text-[9px] tabular-nums text-muted-foreground">
          {shopping.cart.length} line{shopping.cart.length === 1 ? "" : "s"}
        </span>
      </div>
      {detailed && (
        <div className="mt-4">
          {quote.lines.length === 0 ? (
            <p className="border-y border-dashed border-border px-2 py-6 text-center text-[10px] text-muted-foreground">
              Add agent-published listings to start the build cart.
            </p>
          ) : (
            <div className="divide-y divide-border border-y border-border">
              {quote.lines.map((line) => (
                <div
                  key={line.resultId}
                  className="flex items-start gap-2 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium">
                      {line.title}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      qty {line.quantity} ·{" "}
                      {line.unitPrice === null
                        ? "price unavailable"
                        : `${money(line.unitPrice, line.offer?.currency)} each`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => shopping.removeFromCart(line.resultId)}
                    className="shopping-icon-action"
                    aria-label={`Remove ${line.title} from cart`}
                    title="Remove from cart"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex items-end justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">
          Total build cost
        </span>
        <span
          className={`font-mono text-lg font-semibold tabular-nums ${quote.overBudget ? "text-red-500" : ""}`}
        >
          {quote.missingPrices.length ? "—" : money(quote.total)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {quote.missingPrices.length
            ? `${quote.missingPrices.length} missing price${quote.missingPrices.length === 1 ? "" : "s"}`
            : "Lowest priced offer per line"}
        </span>
        <span className={quote.overBudget ? "font-semibold text-red-500" : ""}>
          {quote.budget === null
            ? "No budget"
            : `${quote.overBudget ? "Over" : "Under"} ${money(quote.budget)}`}
        </span>
      </div>
      <label className="mt-3 flex items-center gap-2 border-b border-border py-1.5">
        <span className="text-[10px] font-medium text-muted-foreground">
          Budget ceiling
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={shopping.budget ?? ""}
          onChange={(event) =>
            shopping.setBudget(
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
          placeholder="Set budget"
          aria-label="Shopping budget"
          className="h-7 min-w-0 flex-1 bg-transparent text-right font-mono text-[11px] outline-none placeholder:text-muted-foreground/60"
        />
      </label>
      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => shopping.undoCart()}
          disabled={shopping.undoStack.length === 0}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded border border-border text-[10px] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          title="Undo cart change"
        >
          <Undo2 size={12} /> Undo
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded border border-border text-[10px] transition-colors hover:bg-muted"
          title="Reset to all project components"
        >
          <RotateCcw size={11} /> Reset required
        </button>
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Prices are agent-sourced and may change at checkout. Open each retailer
        link yourself to confirm stock, shipping, and final quantity.
      </p>
    </section>
  );
}

function AgentEmptyState({
  requiredIds,
  phase,
}: {
  requiredIds: string[];
  phase: PartsUiPhase;
}) {
  const requiredParts = requiredIds
    .map((catalogId) => getCatalogComponent(catalogId))
    .filter(Boolean);
  const meta = phaseMeta[phase];
  return (
    <div className={`shopping-empty-state is-${phase}`} aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="shopping-empty-icon">
          {phase === "searching" ? (
            <LoaderCircle size={16} className="shopping-spin" />
          ) : phase === "cancelled" ? (
            <Ban size={16} />
          ) : (
            <Wifi size={16} strokeWidth={1.7} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="kicker">
            {phase === "idle" ? "No sourced parts yet" : "Parts lookup"}
          </div>
          <h2 className="mt-1 text-sm font-semibold">
            {phase === "idle" ? "Start with a part or the current design" : meta.title}
          </h2>
          <p className="mt-1 max-w-[62ch] text-[10px] leading-relaxed text-muted-foreground">
            {phase === "idle"
              ? "Enter an exact part above or send the active design. Nothing enters the cart until a reviewed listing is selected."
              : meta.copy}
          </p>
        </div>
        <span
          className={`shopping-state-pill hidden shrink-0 sm:inline-flex is-${meta.tone}`}
        >
          {meta.label}
        </span>
      </div>
      {requiredParts.length > 0 && (
        <div className="shopping-required-parts">
          <div className="shopping-required-heading">
            <span className="kicker">Parts in this design</span>
            <b>{requiredParts.length}</b>
          </div>
          <div className="shopping-required-list">
            {requiredParts.slice(0, 8).map((part, index) => (
              <div key={`${part?.id}-${index}`} className="shopping-required-part">
                <span className="shopping-required-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="shopping-required-thumb" aria-hidden="true">
                  {part && componentArtworkHref(part) ? (
                    <img src={componentArtworkHref(part) ?? undefined} alt="" loading="lazy" />
                  ) : (
                    <PackageSearch size={12} />
                  )}
                </span>
                <span className="truncate">{part?.title ?? part?.id}</span>
                <code>{part?.id}</code>
              </div>
            ))}
          </div>
          {requiredParts.length > 8 && (
            <span className="shopping-required-more">+ {requiredParts.length - 8} more components</span>
          )}
        </div>
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
  const [quantityInput, setQuantityInput] = useState("1");
  const [lastRequest, setLastRequest] = useState<LookupRequest | null>(null);
  const [lastLookupMode, setLastLookupMode] = useState<LookupMode>("single");
  const requestSequence = useRef(0);
  const activeRequest = useRef<{
    sequence: number;
    controller: AbortController;
  } | null>(null);
  const query = shopping.query;
  const cartResults = useMemo(
    () => new Map(shopping.cart.map((line) => [line.resultId, line])),
    [shopping.cart],
  );
  const quote = shopping.getQuote();
  const requiredIds = useMemo(
    () => project.components.map((component) => component.definitionId),
    [project.components],
  );
  const providers = useMemo(
    () =>
      [
        ...new Set(
          shopping.results.map((result) => result.provenance.provider),
        ),
      ].join(" · "),
    [shopping.results],
  );
  const offerCount = useMemo(
    () =>
      shopping.results.reduce(
        (count, result) => count + Math.min(result.offers.length, 3),
        0,
      ),
    [shopping.results],
  );
  const requestStatus: ShoppingRequestStatus = shopping.requestStatus ?? "idle";

  useEffect(() => {
    if (
      shopping.results.length > 0 &&
      (requestStatus === "ready" ||
        requestStatus === "partial" ||
        (requestStatus === "idle" && phase === "idle"))
    ) {
      setPhase(requestStatus === "partial" ? "partial" : "verified");
      return;
    }
    if (phase === "idle" && requestStatus === "searching")
      setPhase("searching");
    if (phase === "idle" && requestStatus === "staged" && shopping.handoff)
      setPhase("verification");
    if (phase === "idle" && requestStatus === "failed") setPhase("failed");
  }, [phase, requestStatus, shopping.handoff, shopping.results]);

  const partsSearch = useMemo(() => createPartsSearchCoordinator(), []);

  useEffect(
    () => () => {
      requestSequence.current += 1;
      activeRequest.current?.controller.abort();
      partsSearch.cancel();
    },
    [partsSearch],
  );

  const effectivePhase: PartsUiPhase =
    shopping.results.length > 0 && requestStatus === "partial"
      ? "partial"
      : shopping.results.length > 0 && requestStatus === "ready"
        ? "verified"
        : phase === "idle" && requestStatus === "searching"
          ? "searching"
          : phase === "idle" && requestStatus === "staged" && shopping.handoff
            ? "verification"
            : phase === "idle" && requestStatus === "failed"
              ? "failed"
              : phase;

  const resetToProject = () => {
    if (!requiredIds.length) {
      shopping.resetCart();
      setMessage(
        "Add components to the project, then ask the agent to publish the required part records.",
      );
      return;
    }
    if (
      requiredIds.some(
        (catalogId) =>
          !shopping.results.some((result) => result.catalogId === catalogId),
      )
    ) {
      setMessage(
        "Connect an authenticated WebMCP agent and ask it to publish records for the required parts before resetting the cart.",
      );
      return;
    }
    shopping.resetCart(requiredIds);
    setMessage("Cart reset to one of every part required by the project.");
  };

  const performLookup = async (
    { query: requestedQuery, quantity }: LookupRequest,
    force = false,
  ) => {
    const trimmed = requestedQuery.trim();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequest.current?.controller.abort();
    partsSearch.cancel();
    const controller = new AbortController();
    activeRequest.current = { sequence, controller };
    const requestHandoff = createShoppingHandoff(
      trimmed,
      quantity,
      requiredIds,
    );
    setLastRequest({ query: trimmed, quantity });
    setLastLookupMode("single");
    setDiscoveryCandidates([]);
    setMessage("");
    setPhase("searching");
    shopping.setQuery(trimmed);
    shopping.setHandoff(requestHandoff);
    shopping.setRequestStatus("searching");
    try {
      const outcome = await partsSearch.submit(
        {
          query: trimmed,
          quantity,
          requiredCatalogIds: requiredIds,
          requestId: requestHandoff.requestId,
          requestedAt: requestHandoff.requestedAt,
        },
        { force, signal: controller.signal },
      );
      if (activeRequest.current?.sequence !== sequence) return;
      if (outcome.status === "cancelled") {
        setPhase("cancelled");
        setMessage(
          "Search cancelled; nothing was added to the cart.",
        );
        return;
      }
      if (outcome.discovery) shopping.setDiscovery(outcome.discovery);
      else shopping.setDiscovery(null);
      const candidateMap = new Map<string, DiscoveryCandidate>();
      for (const candidate of [
        ...normalizeDiscoveryCandidates(outcome.discovery),
        ...normalizeDiscoveryCandidates(outcome.payload),
      ]) {
        if (!candidateMap.has(candidate.id))
          candidateMap.set(candidate.id, candidate);
      }
      const candidates = [...candidateMap.values()];
      if (candidates.length > 0) {
        shopping.setRequestStatus(
          outcome.status === "rate-limited" ? "rate-limited" : "staged",
        );
        setDiscoveryCandidates(candidates);
        setPhase(
          outcome.status === "rate-limited" ? "rate-limited" : "candidates",
        );
        setMessage(
          outcome.discovery?.message ??
            outcome.error ??
            "Live shopping results are ready. Confirm the exact part identity, seller, stock, shipping, and checkout total before purchasing.",
        );
        return;
      }
      if (outcome.status === "rate-limited") {
        shopping.setRequestStatus("rate-limited");
        setPhase("rate-limited");
        setMessage(
          outcome.error ??
            "The provider rate limit was reached. Wait a moment and retry the lookup.",
        );
        return;
      }
      if (outcome.status === "agent-required") {
        shopping.setRequestStatus("staged");
        setPhase("verification");
        setMessage(
          outcome.discovery?.message ??
            outcome.error ??
            "No live retailer result was returned. Try an exact manufacturer part number or a more specific board name.",
        );
        return;
      }
      shopping.setRequestStatus("failed");
      setPhase("failed");
      setMessage(
        outcome.error ??
          "No live shopping result was received. Retry with a more specific component name or manufacturer part number.",
      );
    } catch (error) {
      if (
        controller.signal.aborted ||
        activeRequest.current?.sequence !== sequence
      )
        return;
      shopping.setRequestStatus("failed");
      setPhase("failed");
      setMessage(
        error instanceof Error && error.message
          ? `Couldn’t complete lookup: ${error.message}`
          : "Couldn’t complete lookup. Check the connection and retry.",
      );
    } finally {
      if (activeRequest.current?.sequence === sequence)
        activeRequest.current = null;
    }
  };

  const submitLookup = () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setMessage("Enter an exact part, board, or manufacturer first.");
      return;
    }
    const quantity = quantityValue(quantityInput);
    if (quantity === null) {
      setMessage("Enter a whole-number quantity from 1 to 999.");
      return;
    }
    void performLookup({ query: trimmed, quantity });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitLookup();
  };

  const stageDesign = async () => {
    const uniqueTargets = [...new Set(requiredIds)]
      .map((catalogId) => {
        const definition = getCatalogComponent(catalogId);
        return definition ? { catalogId, title: definition.title } : null;
      })
      .filter((target): target is { catalogId: string; title: string } => Boolean(target));

    if (!uniqueTargets.length) {
      setMessage("Add a component to the design before searching its parts.");
      return;
    }

    const targets = uniqueTargets.slice(0, MAX_DESIGN_SEARCHES);
    const quantity = quantityValue(quantityInput) ?? 1;
    const summaryQuery = `${project.name} · ${targets.length} design component${targets.length === 1 ? "" : "s"}`;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequest.current?.controller.abort();
    partsSearch.cancel();
    const controller = new AbortController();
    activeRequest.current = { sequence, controller };
    const requestHandoff = createShoppingHandoff(summaryQuery, quantity, targets.map((target) => target.catalogId));

    setLastLookupMode("design");
    setLastRequest({ query: summaryQuery, quantity });
    setQuantityInput(String(quantity));
    setDiscoveryCandidates([]);
    setMessage(`Searching ${targets.length} unique design component${targets.length === 1 ? "" : "s"}…`);
    setPhase("searching");
    shopping.setQuery(summaryQuery);
    shopping.setHandoff(requestHandoff);
    shopping.setRequestStatus("searching");

    const candidateMap = new Map<string, ShoppingDiscoveryCandidate>();
    const attempts: ShoppingDiscovery["attempts"] = [];
    const sourceOrder = new Set<string>();
    let cacheHit = true;
    let staleCache = false;
    let rateLimited = false;
    let completed = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < targets.length && !controller.signal.aborted) {
        const index = cursor;
        cursor += 1;
        const target = targets[index];
        const lookupQuery = `${target.title} ${target.catalogId}`.slice(0, 240);
        const lookupRequest = {
          requestId: `${requestHandoff.requestId}-${String(index + 1).padStart(2, "0")}`,
          query: lookupQuery,
          quantity,
          requiredCatalogIds: [target.catalogId],
          requestedAt: requestHandoff.requestedAt,
        };
        // A fresh lookup survives graph edits and route changes. Only a new
        // component or an entry older than 24 hours reaches the provider.
        const outcome = getCachedPartsSearch(lookupRequest) ?? await requestPartsSearch(lookupRequest, {}, controller.signal);
        if (controller.signal.aborted || activeRequest.current?.sequence !== sequence) return;

        completed += 1;
        setMessage(`Searching design components · ${completed}/${targets.length}`);
        const discovery = outcome.discovery;
        if (!discovery) continue;
        cacheHit = cacheHit && discovery.cacheHit;
        staleCache = staleCache || discovery.staleCache;
        rateLimited = rateLimited || discovery.rateLimited || outcome.status === "rate-limited";
        discovery.sourceOrder.forEach((source) => sourceOrder.add(source));
        attempts.push(...discovery.attempts);
        for (const candidate of discovery.candidates.slice(0, RESULTS_PER_DESIGN_PART)) {
          const key = `${target.catalogId}|${candidate.id}`;
          if (candidateMap.has(key)) continue;
          candidateMap.set(key, {
            ...candidate,
            id: `${candidate.id}:${target.catalogId}`,
            catalogId: target.catalogId,
            matchNote: `Requested for ${target.title}. Confirm that the retailer listing is the same component and package before purchasing.`,
          });
        }
      }
    };

    try {
      const workerCount = Math.min(2, targets.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      if (controller.signal.aborted || activeRequest.current?.sequence !== sequence) return;

      const candidates = [...candidateMap.values()].slice(0, 24);
      const omitted = uniqueTargets.length - targets.length;
      const resultMessage = candidates.length
        ? `Found ${candidates.length} live result${candidates.length === 1 ? "" : "s"} across ${completed} design component search${completed === 1 ? "" : "es"}.${omitted > 0 ? ` The first ${targets.length} of ${uniqueTargets.length} unique components were searched to limit provider cost.` : ""}`
        : rateLimited
          ? "The live provider rate limited the design search. Wait briefly and retry."
          : `No indexed shopping listings matched the ${completed} design component search${completed === 1 ? "" : "es"}. Try an exact part number manually.`;
      const discovery: ShoppingDiscovery = {
        candidates,
        sourceOrder: [...sourceOrder],
        attempts: attempts.slice(0, 24),
        cacheHit: completed > 0 && cacheHit,
        staleCache,
        rateLimited,
        message: resultMessage,
      };
      shopping.setDiscovery(discovery);
      const normalized = normalizeDiscoveryCandidates(discovery);
      setDiscoveryCandidates(normalized);
      if (normalized.length > 0) {
        shopping.setRequestStatus("staged");
        setPhase("candidates");
      } else if (rateLimited) {
        shopping.setRequestStatus("rate-limited");
        setPhase("rate-limited");
      } else {
        shopping.setRequestStatus("failed");
        setPhase("failed");
      }
      setMessage(resultMessage);
    } catch (error) {
      if (controller.signal.aborted || activeRequest.current?.sequence !== sequence) return;
      shopping.setRequestStatus("failed");
      setPhase("failed");
      setMessage(error instanceof Error && error.message ? `Couldn’t search the design: ${error.message}` : "Couldn’t search the design. Check the provider connection and retry.");
    } finally {
      if (activeRequest.current?.sequence === sequence) activeRequest.current = null;
    }
  };

  const retryLookup = () => {
    if (lastLookupMode === "design") {
      void stageDesign();
      return;
    }
    const request =
      lastRequest ??
      (quantityValue(quantityInput) === null || !query.trim()
        ? null
        : { query: query.trim(), quantity: quantityValue(quantityInput) ?? 1 });
    if (!request) {
      submitLookup();
      return;
    }
    setQuantityInput(String(request.quantity));
    void performLookup(request, true);
  };

  const cancelLookup = () => {
    requestSequence.current += 1;
    activeRequest.current?.controller.abort();
    partsSearch.cancel();
    activeRequest.current = null;
    shopping.setHandoff(null);
    setDiscoveryCandidates([]);
    setPhase("cancelled");
    setMessage(
      "Search cancelled; nothing was added to the cart.",
    );
  };

  const displayMessage =
    effectivePhase === "partial"
      ? (shopping.publicationError ?? message)
      : message ||
        (effectivePhase === "failed" ? (shopping.publicationError ?? "") : "");

  return (
    <div className={`shopping-workspace ${fullPage ? "is-full-page" : "is-compact-panel"} flex h-full min-h-0 flex-col bg-card text-xs`}>
      <div className="shopping-header shrink-0 border-b border-border bg-muted/10 px-3 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="kicker">Live parts market</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight">Search parts for sale</h2>
              <span className="shopping-agent-chip">Bright Data SERP</span>
            </div>
            <p className="mt-1 max-w-[70ch] text-[10px] leading-relaxed text-muted-foreground">
              Search current indexed shopping listings by exact part number, board, sensor, module, tool, or manufacturer.
            </p>
          </div>
          <div className="shopping-header-stats hidden shrink-0 sm:flex">
            <div>
              <span className="shopping-stat-value">
                {project.components.length}
              </span>
              <span className="shopping-stat-label">in design</span>
            </div>
            <div>
              <span className="shopping-stat-value">
                {shopping.results.length}
              </span>
              <span className="shopping-stat-label">published</span>
            </div>
            <div>
              <span className="shopping-stat-value">
                {discoveryCandidates.length}
              </span>
              <span className="shopping-stat-label">live results</span>
            </div>
            <div>
              <span className="shopping-stat-value">
                {shopping.cart.length}
              </span>
              <span className="shopping-stat-label">cart lines</span>
            </div>
          </div>
        </div>
        <form
          className="mt-3"
          onSubmit={handleSubmit}
          aria-label="Parts sourcing request"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="shopping-agent-request" className="kicker">
              Part or board
            </label>
            <span className="text-[10px] text-muted-foreground">
              Enter to search
            </span>
          </div>
          <div className="shopping-search-row">
            <div className="shopping-query-field min-w-0 flex-1">
              <GooeyInput
                id="shopping-agent-request"
                value={query}
                onValueChange={shopping.setQuery}
                maxLength={240}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitLookup();
                  }
                }}
                placeholder="Part number, board, sensor, module, or tool"
                aria-label="Search exact parts"
                aria-keyshortcuts="Enter"
                aria-describedby="shopping-search-help"
                shortcut="Enter"
                tone={fullPage ? "page" : "panel"}
                rootClassName="shopping-gooey-search"
              />
            </div>
            <label className="shopping-quantity-field">
              <span>Qty</span>
              <input
                id="shopping-request-quantity"
                type="number"
                min="1"
                max="999"
                step="1"
                inputMode="numeric"
                value={quantityInput}
                onChange={(event) => setQuantityInput(event.target.value)}
                aria-label="Quantity to source"
              />
            </label>
            <button
              type="submit"
              disabled={!query.trim() || effectivePhase === "searching"}
              className="shopping-request-button"
            >
              <Search size={12} /> Search
            </button>
          </div>
          <div className="shopping-form-foot">
            <span id="shopping-search-help" className="shopping-form-note">
              Nothing runs while you type. Quantity stays attached to this request.
            </span>
            <button
              type="button"
              onClick={stageDesign}
              disabled={!requiredIds.length || effectivePhase === "searching"}
              className="shopping-design-button"
              title={requiredIds.length ? `Runs up to ${Math.min(new Set(requiredIds).size, MAX_DESIGN_SEARCHES)} cached Bright Data shopping searches for the unique components in this project` : "Add components before searching the design"}
            >
              <PackageCheck size={12} /> Search current design
            </button>
          </div>
        </form>
        {effectivePhase === "searching" && (
          <SourcingProgress
            phase={effectivePhase}
            resultCount={shopping.results.length}
            candidateCount={discoveryCandidates.length}
            projectPartCount={project.components.length}
          />
        )}
        <LookupStatus
          phase={effectivePhase}
          message={displayMessage}
          hasDesign={requiredIds.length > 0}
          onCancel={cancelLookup}
          onRetry={retryLookup}
          onStageDesign={stageDesign}
        />
        {effectivePhase === "idle" && displayMessage && (
          <div className="shopping-inline-message" role="status">
            <CircleAlert size={13} />
            <span>{displayMessage}</span>
          </div>
        )}
        <details className="shopping-trust-note">
          <summary><ShieldCheck size={13} /> How sourcing stays reviewable</summary>
          <p>Bright Data returns live indexed shopping results. Prices, seller identity, stock, shipping, and model compatibility can change, so open the result and confirm the checkout details before purchasing. Canonical project-cart records still require a reviewed catalog identity.</p>
        </details>
      </div>
      <div
        className={`${fullPage ? "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_310px] lg:grid-rows-1" : "flex min-h-0 flex-1 flex-col"}`}
      >
        <section
          className="shopping-results-scroll min-h-0 overflow-y-auto px-3 py-3 sm:px-4"
          aria-label="Parts lookup results"
          aria-busy={effectivePhase === "searching"}
        >
          {discoveryCandidates.length > 0 && (
            <DiscoveryZone candidates={discoveryCandidates} />
          )}
          {shopping.results.length === 0 && discoveryCandidates.length === 0 && effectivePhase === "idle" ? (
            <AgentEmptyState requiredIds={requiredIds} phase={effectivePhase} />
          ) : shopping.results.length > 0 ? (
            <section
              className="shopping-verified-zone"
              aria-label="Agent-published listings"
              data-testid="verified-listings"
            >
              <div className="shopping-zone-head">
                <div>
                  <div className="kicker">
                    {effectivePhase === "partial"
                      ? "Agent-published / partial publication"
                      : "Agent-published listings"}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {shopping.results.length} canonical catalog ID claim{shopping.results.length === 1 ? "" : "s"} · {offerCount}{" "}
                    sourced offer{offerCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  <div>{providers || "Authenticated WebMCP agent"}</div>
                  <div className="mt-1 font-mono">
                    {dateLabel(shopping.lastSearchAt)}
                  </div>
                </div>
              </div>
              <div className="shopping-verified-grid">
                {shopping.results.map((result) => {
                  const cartLine = cartResults.get(result.id);
                  return (
                    <ResultCard
                      key={result.id}
                      result={result}
                      cartLine={cartLine}
                      onAdd={() => shopping.addToCart(result.id)}
                      onRemove={() => shopping.removeFromCart(result.id)}
                      onQuantity={(quantity) =>
                        shopping.setQuantity(result.id, quantity)
                      }
                      onOffer={(offerId) =>
                        shopping.setOffer(result.id, offerId)
                      }
                      onAlternative={(catalogId) => {
                        const changed = shopping.chooseAlternative(
                          result.id,
                          catalogId,
                        );
                        setMessage(
                          changed
                            ? "Cart alternative selected."
                            : "Search the alternative listing before switching the cart line.",
                        );
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}
        </section>
        {fullPage && (
          <aside className="min-h-0 max-h-[min(38vh,320px)] overflow-y-auto border-t border-border bg-muted/10 lg:max-h-none lg:border-l lg:border-t-0">
            <CartSummary
              shopping={shopping}
              quote={quote}
              onReset={() => void resetToProject()}
              detailed
            />
          </aside>
        )}
      </div>
      {!fullPage && (
        <CartSummary
          shopping={shopping}
          quote={quote}
          onReset={() => void resetToProject()}
        />
      )}
    </div>
  );
}
