import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Moon,
  PackageSearch,
  ReceiptText,
  Settings,
  Sun,
} from "lucide-react";
import ShoppingWorkspace from "../components/shopping/ShoppingWorkspace.tsx";
import LogoMark from "../components/LogoMark.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useShoppingStore } from "../store/useShoppingStore.ts";
import { useThemeStore } from "../store/useThemeStore.ts";

export default function PartsPage() {
  const project = useProjectStore((state) => state.project);
  const cartCount = useShoppingStore((state) => state.cart.length);
  const publishedCount = useShoppingStore((state) => state.results.length);
  const { theme, toggle } = useThemeStore();

  return (
    <div className="parts-page parts-page-redesign parts-page-v2">
      <header className="parts-print-hidden parts-topbar">
        <div className="parts-topbar-left">
          <Link to="/" className="parts-brand" aria-label="Schematic home">
            <span className="site-brand-mark"><LogoMark /></span>
            <span>Schematic</span>
          </Link>
          <span className="parts-topbar-divider" aria-hidden="true" />
          <Link to="/studio" className="parts-back-link">
            <ArrowLeft size={14} />
            Studio
          </Link>
        </div>

        <div className="parts-topbar-actions">
          <button
            type="button"
            onClick={toggle}
            className="workspace-icon-button"
            aria-label="Toggle color theme"
            title="Toggle color theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <Link to="/settings" className="workspace-icon-button" aria-label="Open settings" title="Settings">
            <Settings size={14} />
          </Link>
          <button type="button" onClick={() => window.print()} className="parts-export-button">
            <Download size={14} />
            <span>Export PDF</span>
          </button>
        </div>
      </header>

      <main className="parts-main-redesign">
        <header className="parts-page-heading-v2">
          <div className="parts-page-title-v2">
            <span className="parts-page-title-icon"><PackageSearch size={18} /></span>
            <div>
              <p>Parts market</p>
              <h1>Find hardware for {project.name}.</h1>
              <span>Search live shopping listings, compare sellers and prices, then keep reviewed parts in one bill of materials.</span>
            </div>
          </div>

          <div className="parts-page-metrics" aria-label="Parts workspace summary">
            <div><span>Design</span><b>{project.components.length}</b></div>
            <div><span>Listings</span><b>{publishedCount}</b></div>
            <div><span>Cart</span><b>{cartCount}</b></div>
            <ReceiptText size={16} aria-hidden="true" />
          </div>
        </header>

        <section className="parts-workspace-frame" aria-label="Project parts workspace">
          <ShoppingWorkspace fullPage />
        </section>
      </main>
    </div>
  );
}
