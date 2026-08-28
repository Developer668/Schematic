import { Link } from "react-router-dom";
import { FileDown, Moon, Settings, ShoppingCart, Sun } from "lucide-react";
import ShoppingWorkspace from "../components/shopping/ShoppingWorkspace.tsx";
import LogoMark from "../components/LogoMark.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useShoppingStore } from "../store/useShoppingStore.ts";
import { useThemeStore } from "../store/useThemeStore.ts";

export default function PartsPage() {
  const project = useProjectStore((state) => state.project);
  const cartCount = useShoppingStore((state) => state.cart.length);
  const { theme, toggle } = useThemeStore();

  return (
    <div className="parts-page flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="parts-print-hidden workbench-header h-12 shrink-0 border-b border-border px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="flex shrink-0 items-center gap-1.5" aria-label="Schematic home">
            <span className="brand-mark"><LogoMark /></span>
            <span className="hidden text-[13px] font-semibold tracking-[-0.025em] sm:inline">Schematic</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Primary navigation">
            <Link to="/studio" className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">Studio</Link>
            <Link to="/parts" aria-current="page" className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs font-semibold text-foreground"><ShoppingCart size={12} /> Parts</Link>
            <Link to="/settings" className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Settings size={12} /> Settings</Link>
          </nav>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={toggle} className="workspace-icon-button" aria-label="Toggle color theme" title="Toggle color theme">{theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}</button>
          <button type="button" onClick={() => window.print()} className="secondary-button inline-flex"><FileDown size={12} /> <span className="hidden sm:inline">Export PDF</span><span className="sm:hidden">PDF</span></button>
        </div>
      </header>

      <main className="parts-page-main min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full min-h-0 max-w-[1560px] flex-col p-3 sm:p-5">
          <div className="parts-page-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="parts-print-hidden flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
              <div className="min-w-0"><div className="kicker">Procurement workspace</div><h1 className="mt-1 truncate text-base font-semibold tracking-tight">Parts for {project.name}</h1><p className="mt-0.5 text-[11px] text-muted-foreground">Exact identities, agent/provider offers when connected, alternatives, and a build-ready cart in one place.</p></div>
              <div className="hidden shrink-0 items-center gap-2 text-right sm:block"><div className="font-mono text-sm font-semibold tabular-nums">{project.components.length} parts in design</div><div className="text-[11px] text-muted-foreground">{cartCount} cart line{cartCount === 1 ? "" : "s"}</div></div>
            </div>
            <div className="parts-page-shopping min-h-0 flex-1"><ShoppingWorkspace fullPage /></div>
          </div>
        </div>
      </main>
    </div>
  );
}
