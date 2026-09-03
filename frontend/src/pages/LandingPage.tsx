import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Cable,
  FileCheck2,
  Menu,
  PackageSearch,
  X,
} from "lucide-react";
import LogoMark from "../components/LogoMark.tsx";
import LoadingState from "../components/ui/loading-state.tsx";
import MotionFooter from "../components/ui/motion-footer.tsx";
import "../landing-v2.css";

const HardwareModelStage = lazy(() => import("../components/ui/hardware-model-stage.tsx"));

const decisions = [
  {
    number: "01",
    title: "Choose",
    copy: "Start with the exact controller, sensor, display, radio, or power part that belongs in the build.",
    icon: PackageSearch,
  },
  {
    number: "02",
    title: "Connect",
    copy: "Wire power and data interfaces without losing the reason each connection exists.",
    icon: Cable,
  },
  {
    number: "03",
    title: "Review",
    copy: "Keep source, graph checks, expected outcomes, and purchasing decisions attached to one project.",
    icon: FileCheck2,
  },
] as const;

const projectViews = [
  { label: "Hardware graph", copy: "Real component identities and explicit interfaces." },
  { label: "Editable source", copy: "Code remains beside the hardware it controls." },
  { label: "Project checks", copy: "Problems point back to the affected connection." },
  { label: "Parts handoff", copy: "Supplier offers stay reviewable before they enter the cart." },
] as const;

const preloadWorkspace = () => {
  void import("../WorkspaceApp.tsx");
};

function ModelStageFallback() {
  return (
    <div className="curated-stage-loading" aria-busy="true">
      <LoadingState label="Preparing 3D hardware" variant="Drive" />
    </div>
  );
}

export default function LandingPage() {
  const heroRef = useRef<HTMLElement>(null);
  const pointerFrameRef = useRef(0);
  const latestPointerRef = useRef({ x: 0, y: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(false);
  const [visualsReady, setVisualsReady] = useState(false);

  useLayoutEffect(() => {
    document.body.classList.add("landing-body");
    document.documentElement.classList.add("landing-html");
    return () => {
      window.cancelAnimationFrame(pointerFrameRef.current);
      document.body.classList.remove("landing-body");
      document.documentElement.classList.remove("landing-html");
    };
  }, []);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleHandle = idleWindow.requestIdleCallback?.(() => setVisualsReady(true), { timeout: 500 });
    const timeoutHandle = idleHandle === undefined
      ? window.setTimeout(() => setVisualsReady(true), 120)
      : undefined;

    return () => {
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const updateNavigation = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setCompactNav(window.scrollY > 54);
      });
    };

    const revealItems = Array.from(document.querySelectorAll<HTMLElement>("[data-landing-reveal]"));
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.setAttribute("data-visible", "true");
            observer?.unobserve(entry.target);
          }
        }, { threshold: 0.12, rootMargin: "0px 0px -7%" });

    if (observer) revealItems.forEach((item) => observer.observe(item));
    else revealItems.forEach((item) => item.setAttribute("data-visible", "true"));

    updateNavigation();
    window.addEventListener("scroll", updateNavigation, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", updateNavigation);
    };
  }, []);

  const updateSpotlight = (event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    latestPointerRef.current = { x: event.clientX, y: event.clientY };
    if (pointerFrameRef.current) return;

    pointerFrameRef.current = window.requestAnimationFrame(() => {
      pointerFrameRef.current = 0;
      const hero = heroRef.current;
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const x = latestPointerRef.current.x - rect.left;
      const y = latestPointerRef.current.y - rect.top;
      hero.style.setProperty("--spotlight-x", `${x}px`);
      hero.style.setProperty("--spotlight-y", `${y}px`);
    });
  };

  return (
    <div className="hardware-landing">
      <a href="#main-content" className="hardware-skip-link">Skip to content</a>

      <header className={`hardware-nav ${compactNav ? "is-compact" : ""}`}>
        <div className="hardware-nav-inner">
          <Link to="/" className="hardware-brand" aria-label="Schematic home">
            <LogoMark />
            <span>Schematic</span>
          </Link>

          <nav className="hardware-nav-links" aria-label="Primary navigation">
            <a href="#workflow">Workflow</a>
            <a href="#project">Project</a>
            <Link to="/parts" onPointerEnter={preloadWorkspace} onFocus={preloadWorkspace}>Parts</Link>
          </nav>

          <Link
            to="/studio"
            className="hardware-nav-action"
            onPointerEnter={preloadWorkspace}
            onFocus={preloadWorkspace}
          >
            Open Studio
            <ArrowUpRight size={14} />
          </Link>

          <button
            type="button"
            className="hardware-menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="hardware-mobile-menu"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          >
            {menuOpen ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </header>

      {menuOpen && (
        <nav id="hardware-mobile-menu" className="hardware-mobile-menu" aria-label="Mobile navigation">
          <a href="#workflow" onClick={() => setMenuOpen(false)}>Workflow</a>
          <a href="#project" onClick={() => setMenuOpen(false)}>Project</a>
          <Link to="/parts" onClick={() => setMenuOpen(false)}>Parts</Link>
          <Link to="/studio" onClick={() => setMenuOpen(false)}>Open Studio</Link>
        </nav>
      )}

      <main id="main-content">
        <section
          ref={heroRef}
          className="hardware-hero"
          onPointerMove={updateSpotlight}
        >
          <div className="hardware-hero-spotlight" aria-hidden="true" />
          <div className="hardware-hero-inner">
            <div className="hardware-hero-copy">
              <p className="hardware-overline">Connected hardware, clearly planned</p>
              <h1>See the whole build before you touch the bench.</h1>
              <p className="hardware-hero-intro">
                Schematic keeps real parts, interfaces, source, project checks, and the buying handoff together so the system stays understandable while it changes.
              </p>

              <div className="hardware-hero-actions">
                <Link
                  to="/studio"
                  className="hardware-primary-action"
                  onPointerEnter={preloadWorkspace}
                  onFocus={preloadWorkspace}
                >
                  Open Studio
                  <ArrowUpRight size={16} />
                </Link>
                <a href="#workflow" className="hardware-text-action">
                  See the workflow
                  <ArrowDown size={14} />
                </a>
              </div>

              <p className="hardware-hero-note">
                Real component identities. Explicit connections. One project.
              </p>
            </div>

            <div className="hardware-hero-visual" aria-label="Curated interactive hardware preview">
              <div className="hardware-hero-model">
                {visualsReady ? (
                  <Suspense fallback={<ModelStageFallback />}>
                    <HardwareModelStage />
                  </Suspense>
                ) : <ModelStageFallback />}
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="hardware-workflow-section" data-landing-reveal>
          <header className="hardware-section-heading">
            <p className="hardware-overline">A direct workflow</p>
            <h2>Choose. Connect. Review.</h2>
            <p>Three decisions carry the project from a part on the canvas to a build another person can understand.</p>
          </header>

          <ol className="hardware-decision-list">
            {decisions.map(({ number, title, copy, icon: Icon }) => (
              <li key={number}>
                <span className="hardware-decision-number">{number}</span>
                <Icon size={18} strokeWidth={1.5} />
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="project" className="hardware-project-section" data-landing-reveal>
          <div className="hardware-project-copy">
            <p className="hardware-overline">The project stays intact</p>
            <h2>Every working view refers to the same hardware.</h2>
            <p>
              The canvas is not a disposable mockup. Source, checks, outcomes, and supplier choices continue from the active graph.
            </p>
            <Link to="/studio" onPointerEnter={preloadWorkspace} onFocus={preloadWorkspace}>
              Enter the workbench
              <ArrowRight size={14} />
            </Link>
          </div>

          <div className="hardware-project-views">
            {projectViews.map((view, index) => (
              <article key={view.label}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{view.label}</h3>
                  <p>{view.copy}</p>
                </div>
                {index === 1 ? <Braces size={17} /> : index === 2 ? <FileCheck2 size={17} /> : index === 3 ? <PackageSearch size={17} /> : <Cable size={17} />}
              </article>
            ))}
          </div>
        </section>
      </main>

      <MotionFooter />
    </div>
  );
}
