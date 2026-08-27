import { useMemo, useState } from "react";
import { ExternalLink, RotateCcw, Search, ShoppingCart, Sparkles, Trash2, Undo2 } from "lucide-react";
import { catalog } from "../../data/catalog.ts";
import { invokeWebMCPTool } from "../../webmcp/tools.ts";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useShoppingStore, type PartOffer, type ShoppingResult, type ShoppingState } from "../../store/useShoppingStore.ts";

type ShoppingSnapshot = ShoppingState;
type ShoppingQuote = ReturnType<ShoppingSnapshot["getQuote"]>;

function money(value: number | null, currency = "USD") {
  if (value === null || !Number.isFinite(value)) return "Live quote";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function OfferRow({ offer, selected, onSelect }: { offer: PartOffer; selected: boolean; onSelect: () => void }) {
  return (
    <div className={`flex items-center gap-2 border-t border-border px-2 py-1.5 ${selected ? "bg-muted/70" : ""}`}>
      <button type="button" onClick={onSelect} className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${selected ? "border-primary bg-primary" : "border-border"}`} aria-label={`Use ${offer.retailer} offer`}>
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
      </button>
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{offer.retailer}</span>
      <span className={`shrink-0 font-mono text-[11px] tabular-nums ${offer.price === null ? "text-muted-foreground" : "text-foreground"}`}>{money(offer.price, offer.currency)}</span>
      <a href={offer.url} target="_blank" rel="noreferrer" className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${offer.retailer} listing`}>
        <ExternalLink size={10} />
      </a>
    </div>
  );
}

function ResultCard({ result, cartLine, onAdd, onRemove, onQuantity, onOffer, onAlternative }: { result: ShoppingResult; cartLine?: { resultId: string; quantity: number; selectedOfferId?: string }; onAdd: () => void; onRemove: () => void; onQuantity: (quantity: number) => void; onOffer: (offerId: string) => void; onAlternative: (catalogId: string) => void }) {
  const alternatives = result.alternatives.filter((alternative) => catalog.some((definition) => definition.id === alternative.catalogId));
  return (
    <article className="rounded-md border border-border bg-card">
      <div className="flex items-start gap-2 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-xs font-semibold">{result.title}</h3>
            <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${result.exactMatch ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>{result.exactMatch ? "Exact" : "Review match"}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{result.manufacturer ?? "Catalog"}{result.partNumber ? ` · ${result.partNumber}` : ""} · qty {result.requestedQuantity}</div>
        </div>
        {cartLine ? (
          <div className="flex shrink-0 items-center gap-1">
            <div className="flex h-7 items-center rounded border border-border bg-background">
              <button type="button" onClick={() => onQuantity(cartLine.quantity - 1)} className="grid h-7 w-6 place-items-center text-muted-foreground hover:bg-muted" aria-label={`Decrease ${result.title} quantity`}>−</button>
              <span className="min-w-5 text-center font-mono text-[10px] tabular-nums">{cartLine.quantity}</span>
              <button type="button" onClick={() => onQuantity(cartLine.quantity + 1)} className="grid h-7 w-6 place-items-center text-muted-foreground hover:bg-muted" aria-label={`Increase ${result.title} quantity`}>+</button>
            </div>
            <button type="button" onClick={onRemove} className="grid h-7 w-7 place-items-center rounded border border-border text-muted-foreground hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-500" aria-label={`Remove ${result.title} from cart`}><Trash2 size={12} /></button>
          </div>
        ) : (
          <button type="button" onClick={onAdd} className="shrink-0 rounded bg-foreground px-2 py-1 text-[10px] font-semibold text-background hover:opacity-85">Add</button>
        )}
      </div>
      <div className="border-t border-border bg-muted/20 px-2 py-1 text-[10px] leading-snug text-muted-foreground">{result.matchNote}</div>
      <div className="border-t border-border">
        {result.offers.slice(0, 3).map((offer) => <OfferRow key={offer.id} offer={offer} selected={cartLine?.selectedOfferId === offer.id} onSelect={() => onOffer(offer.id)} />)}
      </div>
      {alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">
          <span className="mr-1 text-[10px] text-muted-foreground">Alternative</span>
          {alternatives.map((alternative) => <button key={alternative.catalogId} type="button" onClick={() => onAlternative(alternative.catalogId)} className="truncate rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted" title={alternative.reason}>{alternative.title}</button>)}
        </div>
      )}
    </article>
  );
}

function CartSummary({ shopping, quote, onReset, detailed = false }: { shopping: ShoppingSnapshot; quote: ShoppingQuote; onReset: () => void; detailed?: boolean }) {
  return (
    <section className={`border-border bg-muted/20 p-3 ${detailed ? "min-h-full border-l-0" : "shrink-0 border-t p-2.5"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5"><ShoppingCart size={12} /><span className="font-semibold">Build cart</span></div>
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground">{shopping.cart.length} line{shopping.cart.length === 1 ? "" : "s"}</span>
      </div>
      {detailed && (
        <div className="mt-3 space-y-1.5">
          {quote.lines.length === 0 ? <p className="rounded border border-dashed border-border px-3 py-5 text-center text-[10px] text-muted-foreground">Your cart is empty.</p> : quote.lines.map((line) => (
            <div key={line.resultId} className="flex items-start gap-2 rounded border border-border bg-card px-2 py-2">
              <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium">{line.title}</div><div className="mt-0.5 font-mono text-[10px] text-muted-foreground">qty {line.quantity} · {line.unitPrice === null ? "live quote" : money(line.unitPrice)} each</div></div>
              <button type="button" onClick={() => shopping.removeFromCart(line.resultId)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500" aria-label={`Remove ${line.title} from cart`}><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between"><span className="text-[11px] text-muted-foreground">Total build cost</span><span className={`font-mono text-base font-semibold tabular-nums ${quote.overBudget ? "text-red-500" : ""}`}>{quote.missingPrices.length ? "—" : money(quote.total)}</span></div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground"><span>{quote.missingPrices.length ? `${quote.missingPrices.length} missing live price${quote.missingPrices.length === 1 ? "" : "s"}` : "Cheapest live offers"}</span><span>{quote.budget === null ? "No budget" : `${quote.overBudget ? "Over" : "Under"} ${money(quote.budget)}`}</span></div>
      <label className="mt-2 flex items-center gap-1.5 rounded border border-border bg-background px-2"><span className="text-[10px] text-muted-foreground">Budget</span><input type="number" min="0" step="0.01" value={shopping.budget ?? ""} onChange={(event) => shopping.setBudget(event.target.value === "" ? null : Number(event.target.value))} placeholder="—" aria-label="Shopping budget" className="h-8 min-w-0 flex-1 bg-transparent text-right font-mono text-[11px] outline-none" /></label>
      <div className="mt-2 flex items-center gap-1.5"><button type="button" onClick={() => shopping.undoCart()} disabled={shopping.undoStack.length === 0} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded border border-border text-[10px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40" title="Undo cart change"><Undo2 size={12} /> Undo</button><button type="button" onClick={onReset} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded border border-border text-[10px] hover:bg-muted" title="Reset to all project components"><RotateCcw size={11} /> Reset required</button></div>
    </section>
  );
}

export default function ShoppingWorkspace({ fullPage = false }: { fullPage?: boolean }) {
  const project = useProjectStore((state) => state.project);
  const shopping = useShoppingStore();
  const [query, setQuery] = useState(shopping.query);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");

  const cartResults = useMemo(() => new Map(shopping.cart.map((line) => [line.resultId, line])), [shopping.cart]);
  const quote = shopping.getQuote();
  const requiredIds = useMemo(() => project.components.map((component) => component.definitionId), [project.components]);

  const search = async (value = query) => {
    setSearching(true);
    setMessage("");
    try {
      const result: any = await invokeWebMCPTool("shopping.search", { query: value, quantity: 1 });
      if (result?.isError) setMessage(result.content?.[0]?.text ?? "Part search failed.");
      else if (result.data?.source === "webmcp-agent") setMessage(result.data?.liveOffers ? "Agent listings updated with live offers." : "Agent listings loaded. Prices marked live only when supplied by the agent.");
      else setMessage(result.data?.liveOffers ? "Live offers updated by the connected parts provider." : "Catalog matches ready. Ask the agent for live prices or open a retailer link.");
    } catch (error) {
      setMessage(`Part search failed: ${(error as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  const resetToProject = async () => {
    if (!requiredIds.length) {
      shopping.resetCart();
      setMessage("Add components to the project, then search build parts.");
      return;
    }
    if (requiredIds.some((catalogId) => !shopping.results.some((result) => result.catalogId === catalogId))) await search("");
    shopping.resetCart(requiredIds);
    setMessage("Cart reset to one of every part required by the project.");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-xs">
      <div className="shrink-0 border-b border-border bg-muted/20 px-2.5 py-2">
        <div className="flex items-center gap-1.5"><ShoppingCart size={13} /><span className="font-semibold">Parts desk</span><span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground">{shopping.cart.length} in cart</span></div>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">Search exact identities for this build. The agent can attach three current retailer offers and context-aware alternatives.</p>
        <div className="mt-2 flex gap-1.5">
          <div className="relative min-w-0 flex-1"><Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="ESP32, pushbutton, 1N4007…" aria-label="Search exact parts" className="h-8 w-full rounded border border-border bg-background pl-7 pr-2 text-xs outline-none focus:border-foreground/30 focus:ring-2 focus:ring-ring/10" /></div>
          <button type="button" onClick={() => void search()} disabled={searching} className="inline-flex h-8 items-center gap-1 rounded bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"><Sparkles size={11} />{searching ? "Searching" : "Search"}</button>
        </div>
        {message && <div className="mt-1.5 text-[10px] text-muted-foreground" role="status">{message}</div>}
      </div>

      <div className={`${fullPage ? "flex flex-1 min-h-0 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px]" : "flex min-h-0 flex-1 flex-col"}`}>
        <div className="shopping-results-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {shopping.results.length === 0 ? (
            <div className="rounded border border-dashed border-border px-3 py-8 text-center"><ShoppingCart size={18} className="mx-auto text-muted-foreground" /><p className="mt-2 text-xs font-medium">No part listings yet</p><p className="mt-1 text-[10px] leading-snug text-muted-foreground">Search for a part or ask the WebMCP agent to call <span className="font-mono">shopping.search</span> with live listings.</p></div>
          ) : (
            <div className="space-y-2">
              {shopping.results.map((result) => {
                const cartLine = cartResults.get(result.id);
                return <ResultCard key={result.id} result={result} cartLine={cartLine} onAdd={() => shopping.addToCart(result.id)} onRemove={() => shopping.removeFromCart(result.id)} onQuantity={(quantity) => shopping.setQuantity(result.id, quantity)} onOffer={(offerId) => shopping.setOffer(result.id, offerId)} onAlternative={(catalogId) => { const changed = shopping.chooseAlternative(result.id, catalogId); setMessage(changed ? "Cart alternative selected." : "Search the alternative listing before switching the cart line."); }} />;
              })}
            </div>
          )}
        </div>
        {fullPage && <aside className="min-h-0 overflow-y-auto border-t border-border bg-muted/10 lg:border-l lg:border-t-0"><CartSummary shopping={shopping} quote={quote} onReset={() => void resetToProject()} detailed /></aside>}
      </div>
      {!fullPage && <CartSummary shopping={shopping} quote={quote} onReset={() => void resetToProject()} />}
    </div>
  );
}
