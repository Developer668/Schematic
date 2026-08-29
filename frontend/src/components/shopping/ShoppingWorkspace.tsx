import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BadgeCheck, Check, CircleAlert, Clock3, ExternalLink, PackageCheck, RotateCcw, Search, ShieldCheck, ShoppingCart, Sparkles, Trash2, Undo2, Wifi, X } from "lucide-react";
import { getCatalogComponent } from "../../data/catalog.ts";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { createShoppingHandoff, useShoppingStore, type PartOffer, type ShoppingDiscovery, type ShoppingRequestStatus, type ShoppingResult, type ShoppingState } from "../../store/useShoppingStore.ts";
import { createPartsSearchCoordinator } from "../../shopping/partsSearchClient.ts";

type ShoppingSnapshot = ShoppingState;
type ShoppingQuote = ReturnType<ShoppingSnapshot["getQuote"]>;

function money(value: number | null, currency = "USD") {
  if (value === null || !Number.isFinite(value)) return "Price unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function dateLabel(value: number | string | null | undefined) {
  if (!value) return "Awaiting first agent search";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function requestStatusLabel(status: ShoppingRequestStatus | undefined, resultCount: number) {
  if (resultCount > 0 || status === "ready" || status === "partial") return status === "partial" ? "Review partial match" : "Offers ready";
  if (status === "searching") return "Checking suppliers";
  if (status === "agent-required") return "Agent verification needed";
  if (status === "rate-limited") return "Retry public lookup later";
  if (status === "staged") return "Request staged";
  if (status === "failed") return "Needs sourcing agent";
  return "Ready to source";
}

function SourcingProgress({ status, resultCount, projectPartCount }: { status?: ShoppingRequestStatus; resultCount: number; projectPartCount: number }) {
  const active = resultCount > 0 || status === "ready" || status === "partial" ? 3 : status === "agent-required" ? 2 : status === "searching" ? 2 : status === "staged" || status === "rate-limited" ? 1 : 0;
  const steps = ["Request", "Compare", "Verify"];
  return (
    <div className="shopping-request-card" aria-live="polite">
      <div className="shopping-request-icon"><Sparkles size={15} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="kicker">Sourcing pipeline</span><span className={`shopping-state-pill is-${active === 3 ? "ready" : active > 0 ? "active" : "idle"}`}>{requestStatusLabel(status, resultCount)}</span></div>
        <p className="shopping-request-title">{resultCount > 0 ? `${resultCount} verified design part${resultCount === 1 ? "" : "s"} ready to compare` : `${projectPartCount} design part${projectPartCount === 1 ? "" : "s"} queued for supplier lookup`}</p>
        <p className="shopping-request-copy">Public feeds find candidate part numbers first. A connected agent verifies identity and live retailer offers before anything reaches the cart.</p>
      </div>
      <div className="shopping-request-steps" aria-label="Sourcing progress">
        {steps.map((step, index) => <div key={step} className={`shopping-request-step ${active >= index + 1 ? "is-active" : ""}`}><span className="shopping-step-dot">{active >= index + 1 ? <Check size={10} /> : index + 1}</span><span>{step}</span>{index < steps.length - 1 && <span className="shopping-step-line" aria-hidden="true" />}</div>)}
      </div>
    </div>
  );
}

function discoverySourceLabel(source: string) {
  if (source === "jlcsearch") return "JLCSearch · LCSC snapshot";
  if (source === "adafruit") return "Adafruit public catalog";
  return source;
}

function discoveryStatusLabel(status: ShoppingDiscovery["attempts"][number]["status"]) {
  if (status === "success") return "checked";
  if (status === "rate_limited") return "rate limited";
  if (status === "circuit_open") return "paused";
  if (status === "skipped") return "agent fallback";
  if (status === "timeout") return "timed out";
  if (status === "empty") return "no matches";
  return "unavailable";
}

function PublicDiscoveryPanel({ discovery, onRetry }: { discovery: ShoppingDiscovery; onRetry?: () => void }) {
  const visibleCandidates = discovery.candidates.slice(0, 8);
  const attempts = discovery.attempts.filter((attempt) => attempt.source !== "request");
  return (
    <section className="shopping-discovery-panel" aria-label="Public part discovery" aria-live="polite">
      <div className="flex items-start gap-2.5">
        <div className="shopping-discovery-icon"><Search size={14} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="kicker">Public discovery</span><span className="shopping-state-pill is-active">Agent verification required</span></div>
          <p className="mt-1 text-[11px] font-semibold">{visibleCandidates.length ? `${discovery.candidates.length} candidate${discovery.candidates.length === 1 ? "" : "s"} found` : discovery.rateLimited ? "Public lookup is rate limited" : "Ready for the web-search fallback"}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{discovery.message} Candidates are hints only: they have no canonical Schematic identity or checkout-ready offer yet.</p>
        </div>
      </div>
      {attempts.length > 0 && <div className="shopping-discovery-attempts">{attempts.map((attempt, index) => <span key={`${attempt.source}-${index}`} className="shopping-discovery-attempt"><span className={`shopping-discovery-dot is-${attempt.status === "success" ? "good" : attempt.status === "rate_limited" ? "warn" : "muted"}`} />{discoverySourceLabel(attempt.source)} · {discoveryStatusLabel(attempt.status)}</span>)}</div>}
      {visibleCandidates.length > 0 && (
        <div className="shopping-candidate-list">
          {visibleCandidates.map((candidate) => (
            <div key={candidate.id} className="shopping-candidate-row">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-semibold">{candidate.title}</div>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] text-muted-foreground">
                  <code className="font-mono">{candidate.partNumber}</code>
                  {candidate.package && <><span aria-hidden="true">·</span><span>{candidate.package}</span></>}
                  {candidate.stock !== null && <><span aria-hidden="true">·</span><span>{candidate.stock.toLocaleString()} in snapshot</span></>}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{candidate.price === null ? "Price —" : money(candidate.price, candidate.currency ?? "USD")}</span>
              <a href={candidate.verificationUrl} target="_blank" rel="noreferrer" className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`Verify ${candidate.partNumber} source`}><ExternalLink size={10} /></a>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-start justify-between gap-2 border-t border-border/70 pt-2 text-[9px] leading-relaxed text-muted-foreground"><div className="flex min-w-0 items-start gap-1.5"><ShieldCheck size={11} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><span>Ask the connected WebMCP agent to resolve these part numbers to the project catalog and publish current HTTPS retailer offers through <code className="font-mono text-foreground">shopping.search</code>.</span></div>{onRetry && <button type="button" onClick={onRetry} className="shrink-0 rounded border border-border px-2 py-1 text-[9px] font-semibold text-foreground transition-colors hover:bg-muted">Retry lookup</button>}</div>
    </section>
  );
}

function cheapestOfferId(result: ShoppingResult) {
  return result.offers.reduce<string | undefined>((best, offer) => {
    if (offer.price === null || !Number.isFinite(offer.price)) return best;
    if (!best) return offer.id;
    const current = result.offers.find((candidate) => candidate.id === best);
    return !current || current.price === null || offer.price < current.price ? offer.id : best;
  }, undefined);
}

function OfferRow({ offer, selected, selectable, cheapest, onSelect }: { offer: PartOffer; selected: boolean; selectable: boolean; cheapest: boolean; onSelect: () => void }) {
  return (
    <div className={`flex items-center gap-2 border-t border-border/70 px-3 py-2 transition-colors ${selected ? "bg-muted/70" : "hover:bg-muted/35"}`}>
      {selectable ? (
        <button type="button" onClick={onSelect} className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors ${selected ? "border-primary bg-primary" : "border-border hover:border-muted-foreground"}`} aria-label={`Use ${offer.retailer} offer`} aria-pressed={selected}>
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
        </button>
      ) : (
        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${cheapest ? "border-emerald-500/50" : "border-border"}`} aria-hidden="true">
          {cheapest && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11px] font-medium">{offer.retailer}</span>
          {cheapest && <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">Best price</span>}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{offer.title}{offer.availability ? ` · reported ${offer.availability}` : " · agent-sourced offer"}</div>
      </div>
      <span className={`shrink-0 font-mono text-[11px] tabular-nums ${offer.price === null ? "text-muted-foreground" : "text-foreground"}`}>{money(offer.price, offer.currency)}</span>
      <a href={offer.url} target="_blank" rel="noreferrer" className="grid h-7 w-7 shrink-0 place-items-center rounded border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`Open ${offer.retailer} listing`}>
        <ArrowUpRight size={11} />
      </a>
    </div>
  );
}

function ResultCard({ result, cartLine, onAdd, onRemove, onQuantity, onOffer, onAlternative }: { result: ShoppingResult; cartLine?: { resultId: string; quantity: number; selectedOfferId?: string }; onAdd: () => void; onRemove: () => void; onQuantity: (quantity: number) => void; onOffer: (offerId: string) => void; onAlternative: (catalogId: string) => void }) {
  const alternatives = result.alternatives.filter((alternative) => Boolean(getCatalogComponent(alternative.catalogId)));
  const lowestOfferId = cheapestOfferId(result);
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground">
          <PackageCheck size={15} strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3 className="truncate text-xs font-semibold">{result.title}</h3>
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300"><BadgeCheck size={10} /> Exact catalog match</span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>{result.manufacturer ?? "Catalog identity"}</span><span aria-hidden="true">·</span><code className="font-mono">{result.partNumber}</code><span aria-hidden="true">·</span><span>requested qty {result.requestedQuantity}</span>
          </div>
        </div>
        {cartLine ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="flex h-8 items-center rounded border border-border bg-background" aria-label={`${result.title} quantity`}>
              <button type="button" onClick={() => onQuantity(cartLine.quantity - 1)} className="grid h-8 w-7 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`Decrease ${result.title} quantity`}>−</button>
              <span className="min-w-6 text-center font-mono text-[10px] tabular-nums">{cartLine.quantity}</span>
              <button type="button" onClick={() => onQuantity(cartLine.quantity + 1)} className="grid h-8 w-7 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`Increase ${result.title} quantity`}>+</button>
            </div>
            <button type="button" onClick={onRemove} className="grid h-8 w-8 place-items-center rounded border border-border text-muted-foreground transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-500" aria-label={`Remove ${result.title} from cart`} title="Remove from cart"><Trash2 size={12} /></button>
          </div>
        ) : (
          <button type="button" onClick={onAdd} disabled={!result.exactMatch} className="shrink-0 rounded bg-foreground px-2.5 py-1.5 text-[10px] font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground" title={result.exactMatch ? "Add exact catalog match" : "Review the part number before adding this listing"}>{result.exactMatch ? "Add to cart" : "Review match"}</button>
        )}
      </div>
      {result.matchNote && <div className="border-t border-border/70 bg-muted/20 px-3 py-2 text-[10px] leading-snug text-muted-foreground">{result.matchNote}</div>}
      <div className="border-t border-border/70">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="kicker">Sourced offers</span>
          <span className="font-mono text-[9px] tabular-nums text-muted-foreground">{Math.min(result.offers.length, 3)} of 3 shown</span>
        </div>
        <div>
          {result.offers.slice(0, 3).map((offer) => <OfferRow key={offer.id} offer={offer} selected={cartLine?.selectedOfferId === offer.id || (!cartLine && offer.id === lowestOfferId)} selectable={Boolean(cartLine)} cheapest={offer.id === lowestOfferId} onSelect={() => onOffer(offer.id)} />)}
        </div>
      </div>
      {alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 bg-muted/10 px-3 py-2">
          <span className="mr-1 text-[10px] font-medium text-muted-foreground">Agent alternatives</span>
          {alternatives.map((alternative) => <button key={alternative.catalogId} type="button" onClick={() => onAlternative(alternative.catalogId)} className="max-w-full truncate rounded border border-border px-1.5 py-1 text-[10px] transition-colors hover:bg-muted" title={alternative.reason}>{alternative.title}</button>)}
        </div>
      )}
    </article>
  );
}

function CartSummary({ shopping, quote, onReset, detailed = false }: { shopping: ShoppingSnapshot; quote: ShoppingQuote; onReset: () => void; detailed?: boolean }) {
  return (
    <section className={`shopping-cart-summary ${detailed ? "min-h-full p-4" : "shrink-0 p-3"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="kicker">Bill of materials</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold"><ShoppingCart size={13} /> Build cart</div>
        </div>
        <span className="rounded bg-background px-2 py-1 font-mono text-[9px] tabular-nums text-muted-foreground">{shopping.cart.length} line{shopping.cart.length === 1 ? "" : "s"}</span>
      </div>
      {detailed && (
        <div className="mt-4">
          {quote.lines.length === 0 ? <p className="border-y border-dashed border-border px-2 py-6 text-center text-[10px] text-muted-foreground">Add validated listings to start the build cart.</p> : (
            <div className="divide-y divide-border border-y border-border">
              {quote.lines.map((line) => (
                <div key={line.resultId} className="flex items-start gap-2 py-3">
                  <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium">{line.title}</div><div className="mt-1 font-mono text-[10px] text-muted-foreground">qty {line.quantity} · {line.unitPrice === null ? "price unavailable" : `${money(line.unitPrice, line.offer?.currency)} each`}</div></div>
                  <button type="button" onClick={() => shopping.removeFromCart(line.resultId)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500" aria-label={`Remove ${line.title} from cart`} title="Remove from cart"><Trash2 size={11} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex items-end justify-between gap-3"><span className="text-[11px] text-muted-foreground">Total build cost</span><span className={`font-mono text-lg font-semibold tabular-nums ${quote.overBudget ? "text-red-500" : ""}`}>{quote.missingPrices.length ? "—" : money(quote.total)}</span></div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{quote.missingPrices.length ? `${quote.missingPrices.length} missing price${quote.missingPrices.length === 1 ? "" : "s"}` : "Lowest priced offer per line"}</span><span className={quote.overBudget ? "font-semibold text-red-500" : ""}>{quote.budget === null ? "No budget" : `${quote.overBudget ? "Over" : "Under"} ${money(quote.budget)}`}</span></div>
      <label className="mt-3 flex items-center gap-2 border-b border-border py-1.5"><span className="text-[10px] font-medium text-muted-foreground">Budget ceiling</span><span className="font-mono text-[10px] text-muted-foreground">$</span><input type="number" min="0" step="0.01" value={shopping.budget ?? ""} onChange={(event) => shopping.setBudget(event.target.value === "" ? null : Number(event.target.value))} placeholder="Set budget" aria-label="Shopping budget" className="h-7 min-w-0 flex-1 bg-transparent text-right font-mono text-[11px] outline-none placeholder:text-muted-foreground/60" /></label>
      <div className="mt-3 flex items-center gap-1.5"><button type="button" onClick={() => shopping.undoCart()} disabled={shopping.undoStack.length === 0} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded border border-border text-[10px] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40" title="Undo cart change"><Undo2 size={12} /> Undo</button><button type="button" onClick={onReset} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded border border-border text-[10px] transition-colors hover:bg-muted" title="Reset to all project components"><RotateCcw size={11} /> Reset required</button></div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">Prices are agent-sourced and may change at checkout. Open each retailer link to confirm stock, shipping, and final quantity.</p>
    </section>
  );
}

function AgentEmptyState({ query, requiredIds, status, onStageQuery, onStageDesign }: { query: string; requiredIds: string[]; status?: ShoppingRequestStatus; onStageQuery: () => void; onStageDesign: () => void }) {
  const requiredParts = requiredIds.map((catalogId) => getCatalogComponent(catalogId)).filter(Boolean);
  const statusTone = status === "failed" ? "error" : status === "staged" || status === "agent-required" || status === "rate-limited" ? "active" : "idle";
  const statusText = status === "failed" ? "Action needed" : status === "agent-required" ? "Verify with agent" : status === "staged" ? "Staged" : status === "rate-limited" ? "Retry later" : "Agent only";
  return (
    <div className="shopping-empty-state" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="shopping-empty-icon"><Wifi size={16} strokeWidth={1.7} /></div>
        <div className="min-w-0 flex-1"><div className="kicker">Ready when you are</div><h2 className="mt-1 text-sm font-semibold">Waiting for the WebMCP agent</h2><p className="mt-1 max-w-[62ch] text-[10px] leading-relaxed text-muted-foreground">Agent publication required. This desk stays empty until a connected, authenticated agent finds and publishes exact catalog matches with sourced retailer offers.</p></div>
        <span className={`shopping-state-pill hidden shrink-0 sm:inline-flex is-${statusTone}`}>{statusText}</span>
      </div>
      <div className="shopping-empty-actions"><button type="button" onClick={onStageQuery} disabled={!query.trim()} className="shopping-primary-action"><Search size={12} /> Request this part</button><button type="button" onClick={onStageDesign} disabled={!requiredIds.length} className="shopping-secondary-action"><PackageCheck size={12} /> Source required design</button><span className="shopping-empty-note"><Clock3 size={12} /> Supplier results stay reviewable until added to the cart.</span></div>
      <div className="shopping-empty-lower">
        <div className="shopping-empty-flow"><div className="shopping-empty-flow-item"><span>01</span><div><p>Resolve identity</p><small>Match every request to a real catalog part number.</small></div></div><div className="shopping-empty-flow-item"><span>02</span><div><p>Compare offers</p><small>Keep the best supplier options side by side.</small></div></div><div className="shopping-empty-flow-item"><span>03</span><div><p>Build the cart</p><small>Choose quantities only after the exact match is verified.</small></div></div></div>
        {requiredParts.length > 0 && <div className="shopping-required-parts"><div className="kicker">Parts in this design</div><div className="shopping-required-list">{requiredParts.slice(0, 8).map((part, index) => <div key={`${part?.id}-${index}`} className="shopping-required-part"><span className="shopping-required-index">{String(index + 1).padStart(2, "0")}</span><span className="truncate">{part?.title ?? part?.id}</span><code>{part?.id}</code></div>)}</div>{requiredParts.length > 8 && <span className="shopping-required-more">+ {requiredParts.length - 8} more components</span>}</div>}
      </div>
      <div className="mt-4 flex min-w-0 items-center justify-between gap-3 border-t border-border pt-3 text-[10px]"><span className="kicker">Agent request</span><code className="min-w-0 truncate font-mono text-foreground">{query || "Enter a part or board above"}</code><span className="sr-only">Return verified listings through shopping.search.</span></div>
    </div>
  );
}

export default function ShoppingWorkspace({ fullPage = false }: { fullPage?: boolean }) {
  const project = useProjectStore((state) => state.project);
  const shopping = useShoppingStore();
  const [message, setMessage] = useState("");
  const query = shopping.query;
  const cartResults = useMemo(() => new Map(shopping.cart.map((line) => [line.resultId, line])), [shopping.cart]);
  const quote = shopping.getQuote();
  const partsSearch = useMemo(() => createPartsSearchCoordinator(), []);
  const requiredIds = useMemo(() => project.components.map((component) => component.definitionId), [project.components]);
  const providers = useMemo(() => [...new Set(shopping.results.map((result) => result.provenance.provider))].join(" · "), [shopping.results]);
  const offerCount = useMemo(() => shopping.results.reduce((count, result) => count + Math.min(result.offers.length, 3), 0), [shopping.results]);
  const requestStatus = shopping.requestStatus ?? "idle";

  useEffect(() => () => { partsSearch.cancel(); }, [partsSearch]);

  const resetToProject = () => {
    if (!requiredIds.length) {
      shopping.resetCart();
      setMessage("Add components to the project, then ask the agent to search the required parts.");
      return;
    }
    if (requiredIds.some((catalogId) => !shopping.results.some((result) => result.catalogId === catalogId))) {
      setMessage("Connect an authenticated WebMCP agent and ask it to publish the required part listings before resetting the cart.");
      return;
    }
    shopping.resetCart(requiredIds);
    setMessage("Cart reset to one of every part required by the project.");
  };

  const runPartsSearch = async (force = false) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setMessage("Enter an exact part, board, or manufacturer first.");
      return;
    }
    const requestHandoff = createShoppingHandoff(trimmed, 1, requiredIds);
    shopping.clearResults();
    shopping.setHandoff(requestHandoff);
    shopping.setRequestStatus("searching");
    setMessage(`Searching public sources for “${trimmed}”…`);
    const outcome = await partsSearch.submit({ query: trimmed, quantity: 1, requiredCatalogIds: requiredIds, requestId: requestHandoff.requestId, requestedAt: requestHandoff.requestedAt }, { force });
    if (outcome.status === "cancelled") return;
    if (outcome.discovery) {
      shopping.setDiscovery(outcome.discovery);
    } else {
      shopping.setDiscovery(null);
      shopping.setRequestStatus(outcome.status);
    }
    if (outcome.status === "rate-limited") {
      setMessage(outcome.error ?? "Public lookup is rate limited. The agent handoff is still ready; retry shortly.");
    } else if (outcome.discovery?.candidates.length) {
      setMessage(`${outcome.discovery.candidates.length} public candidate${outcome.discovery.candidates.length === 1 ? "" : "s"} found. Ask the WebMCP agent to verify and publish current offers.`);
    } else if (outcome.status === "agent-required") {
      setMessage(outcome.error ?? "Public lookup is ready for WebMCP agent verification.");
    } else {
      setMessage(outcome.error ?? "Public lookup failed. The WebMCP handoff is ready for another browsing agent.");
    }
  };

  const stageQuery = () => { void runPartsSearch(); };

  const stageDesign = () => {
    if (!requiredIds.length) {
      setMessage("Add a component to the design before sourcing a bill of materials.");
      return;
    }
    const designQuery = `${project.name} required parts`;
    shopping.setQuery(designQuery);
    shopping.setHandoff(createShoppingHandoff(designQuery, 1, requiredIds));
    setMessage(`Design lookup staged for ${requiredIds.length} required part${requiredIds.length === 1 ? "" : "s"}.`);
  };

  return (
    <div className="shopping-workspace flex h-full min-h-0 flex-col bg-card text-xs">
      <div className="shopping-header shrink-0 border-b border-border bg-muted/10 px-3 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="kicker">Sourcing workspace</div>
            <div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold tracking-tight">Build-ready parts</h2><span className="shopping-agent-chip"><span className="shopping-agent-dot" /> Agent assisted</span></div>
            <p className="mt-1 max-w-[70ch] text-[10px] leading-relaxed text-muted-foreground">Compare verified supplier offers for the exact components already in your hardware graph, then move the choices into one build cart.</p>
          </div>
          <div className="shopping-header-stats hidden shrink-0 sm:flex"><div><span className="shopping-stat-value">{project.components.length}</span><span className="shopping-stat-label">in design</span></div><div><span className="shopping-stat-value">{shopping.results.length}</span><span className="shopping-stat-label">verified</span></div><div><span className="shopping-stat-value">{shopping.cart.length}</span><span className="shopping-stat-label">cart lines</span></div></div>
        </div>
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2"><label htmlFor="shopping-agent-request" className="kicker">Find a part</label><span className="text-[10px] text-muted-foreground">Search public sources · Enter to hand off verification</span></div>
          <div className="shopping-search-row"><div className="relative min-w-0 flex-1"><Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><input id="shopping-agent-request" value={query} onChange={(event) => shopping.setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); stageQuery(); } }} placeholder="Exact part, board, or manufacturer" aria-label="Search exact parts" className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-16 text-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/30 focus:ring-2 focus:ring-ring/10" /><kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">Enter</kbd></div>{requestStatus === "searching" ? <button type="button" onClick={() => { partsSearch.cancel(); shopping.setRequestStatus("idle"); setMessage("Public lookup cancelled. The handoff remains available for the WebMCP agent."); }} className="shopping-request-button"><X size={12} /> Cancel search</button> : <button type="button" onClick={stageQuery} disabled={!query.trim()} className="shopping-request-button"><Search size={12} /> Search parts</button>}</div>
        </div>
        <SourcingProgress status={requestStatus} resultCount={shopping.results.length} projectPartCount={project.components.length} />
        <div className="shopping-trust-note mt-2 flex items-start gap-2 rounded-md border border-border/70 bg-card/70 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><span><strong className="font-semibold text-foreground">Verified before checkout.</strong> A listing needs the exact catalog identity, part number, provider, recent timestamp, secure retailer URL, currency, and offer price before it can enter the cart. Confirm stock, shipping, and final pricing with the retailer.</span></div>
        {(message || shopping.publicationError) && <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300" role="status"><CircleAlert size={13} className="mt-0.5 shrink-0" /><span>{shopping.publicationError ?? message}</span></div>}
      </div>

      <div className={`${fullPage ? "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1" : "flex min-h-0 flex-1 flex-col"}`}>
        <section className="shopping-results-scroll min-h-0 overflow-y-auto px-3 py-3 sm:px-4" aria-label="Agent sourced parts">
          {shopping.results.length === 0 ? <>{shopping.discovery && <PublicDiscoveryPanel discovery={shopping.discovery} onRetry={() => { void runPartsSearch(true); }} />}<AgentEmptyState query={query} requiredIds={requiredIds} status={requestStatus} onStageQuery={stageQuery} onStageDesign={stageDesign} /></> : (
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3 border-b border-border pb-2"><div><div className="kicker">Validated results</div><p className="mt-1 text-[10px] text-muted-foreground">{shopping.results.length} exact catalog match{shopping.results.length === 1 ? "" : "es"} · {offerCount} sourced offer{offerCount === 1 ? "" : "s"}</p></div><div className="text-right text-[10px] text-muted-foreground"><div>{providers}</div><div className="mt-1 font-mono">{dateLabel(shopping.lastSearchAt)}</div></div></div>
              {shopping.results.map((result) => {
                const cartLine = cartResults.get(result.id);
                return <ResultCard key={result.id} result={result} cartLine={cartLine} onAdd={() => shopping.addToCart(result.id)} onRemove={() => shopping.removeFromCart(result.id)} onQuantity={(quantity) => shopping.setQuantity(result.id, quantity)} onOffer={(offerId) => shopping.setOffer(result.id, offerId)} onAlternative={(catalogId) => { const changed = shopping.chooseAlternative(result.id, catalogId); setMessage(changed ? "Cart alternative selected." : "Search the alternative listing before switching the cart line."); }} />;
              })}
            </div>
          )}
        </section>
        {fullPage && <aside className="min-h-0 max-h-[min(38vh,320px)] overflow-y-auto border-t border-border bg-muted/10 lg:max-h-none lg:border-l lg:border-t-0"><CartSummary shopping={shopping} quote={quote} onReset={() => void resetToProject()} detailed /></aside>}
      </div>
      {!fullPage && <CartSummary shopping={shopping} quote={quote} onReset={() => void resetToProject()} />}
    </div>
  );
}
