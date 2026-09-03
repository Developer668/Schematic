"use client";

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ArrowUp, ArrowUpRight, Github } from "lucide-react";
import { Link } from "react-router-dom";
import LogoMark from "../LogoMark.tsx";

type MagneticLinkProps = {
  children: ReactNode;
  className?: string;
  to?: string;
  href?: string;
  external?: boolean;
};

function moveMagnetic(event: ReactPointerEvent<HTMLElement>) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width / 2;
  const y = event.clientY - rect.top - rect.height / 2;
  element.style.setProperty("--magnetic-x", `${x * 0.13}px`);
  element.style.setProperty("--magnetic-y", `${y * 0.13}px`);
}

function resetMagnetic(event: ReactPointerEvent<HTMLElement>) {
  event.currentTarget.style.setProperty("--magnetic-x", "0px");
  event.currentTarget.style.setProperty("--magnetic-y", "0px");
}

function MagneticLink({ children, className = "", to, href, external = false }: MagneticLinkProps) {
  const shared = {
    className: `schematic-magnetic ${className}`.trim(),
    onPointerMove: moveMagnetic,
    onPointerLeave: resetMagnetic,
  };

  if (to) return <Link to={to} {...shared}>{children}</Link>;

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      {...shared}
    >
      {children}
    </a>
  );
}

export default function MotionFooter() {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = wrapper.getBoundingClientRect();
        const viewport = Math.max(1, window.innerHeight);
        const progress = Math.min(1, Math.max(0, (viewport - rect.top) / Math.max(viewport, rect.height * 0.82)));
        wrapper.style.setProperty("--footer-progress", progress.toFixed(4));
      });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="schematic-footer-curtain">
      <footer className="schematic-footer-stage">
        <div className="schematic-footer-grid" aria-hidden="true" />
        <div className="schematic-footer-light" aria-hidden="true" />
        <div className="schematic-footer-word" aria-hidden="true">SCHEMATIC</div>

        <div className="schematic-footer-ribbon" aria-hidden="true">
          <div>
            <span>Exact hardware</span><i>/</i><span>Explicit interfaces</span><i>/</i><span>Editable source</span><i>/</i><span>Project checks</span><i>/</i><span>Reviewable parts</span><i>/</i>
            <span>Exact hardware</span><i>/</i><span>Explicit interfaces</span><i>/</i><span>Editable source</span><i>/</i><span>Project checks</span><i>/</i><span>Reviewable parts</span><i>/</i>
          </div>
        </div>

        <div className="schematic-footer-center">
          <p>Ready for the workbench</p>
          <h2>Build the system once. Understand it all the way through.</h2>
          <div className="schematic-footer-actions">
            <MagneticLink to="/studio" className="schematic-footer-primary">
              Open Studio
              <ArrowUpRight size={17} />
            </MagneticLink>
            <MagneticLink to="/parts" className="schematic-footer-secondary">
              Open Parts
            </MagneticLink>
          </div>
        </div>

        <div className="schematic-footer-base">
          <Link to="/" className="schematic-footer-brand" aria-label="Schematic home">
            <LogoMark />
            <span>Schematic</span>
          </Link>

          <nav className="schematic-footer-links" aria-label="Footer navigation">
            <Link to="/studio">Studio</Link>
            <Link to="/parts">Parts</Link>
            <Link to="/settings">Settings</Link>
            <a href="https://github.com/Developer668/Schematic" target="_blank" rel="noreferrer"><Github size={13} /> Source</a>
          </nav>

          <span className="schematic-footer-copyright">© 2026 Schematic</span>

          <button
            type="button"
            className="schematic-magnetic schematic-footer-top"
            onPointerMove={moveMagnetic}
            onPointerLeave={resetMagnetic}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="Back to top"
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </footer>
    </div>
  );
}
