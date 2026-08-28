import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Boxes,
  Cable,
  Code2,
  Cpu,
  Layers,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
  Search,
  GitBranch,
  Activity,
  ShoppingCart,
  ChevronRight,
  Play,
} from "lucide-react";
import LogoMark from "../components/LogoMark.tsx";
import { WEBMCP_TOOL_COUNT } from "../webmcp/tools.ts";

const bento = [
  {
    span: "lg:col-span-7 lg:row-span-2",
    icon: Boxes,
    kicker: "CATALOG • 500+ DEFINITIONS",
    title: "A catalog that tells you what runs",
    body: "Boards, sensors, displays, power and passives share typed identities. Each part exposes its port contract and execution coverage, so validation-only parts are never presented as simulated hardware.",
    accent: "from-violet-500/10 via-transparent to-transparent",
    stat: "500+",
    statLabel: "definitions",
  },
  {
    span: "lg:col-span-5",
    icon: Cable,
    kicker: "TYPED GRAPH",
    title: "Wires that understand voltage",
    body: "Explicit ports (power/i2c/spi/uart/pwm/adc) with validation for shorts, missing pull-ups, and ground.",
    accent: "from-sky-500/10 via-transparent to-transparent",
  },
  {
    span: "lg:col-span-5",
    icon: Code2,
    kicker: "FIRMWARE",
    title: "Code lives next to copper",
    body: "Monaco, per-board targets, and browser preflight — so agent and human share the same project.",
    accent: "from-emerald-500/10 via-transparent to-transparent",
  },
  {
    span: "lg:col-span-5",
    icon: Terminal,
    kicker: `WEBMCP • ${WEBMCP_TOOL_COUNT} TOOLS`,
    title: "Agent-native, not bolted on",
    body: "project.get_graph → component.add → connection.connect → firmware.write → simulation.run — same Zustand path as the UI.",
    accent: "from-amber-500/10 via-transparent to-transparent",
  },
  {
    span: "lg:col-span-7",
    icon: ShoppingCart,
    kicker: "SHOPPING DESK",
    title: "From graph to cart without copy-paste",
    body: "Agent-supplied offers, retailer links, alternatives, and budget quotes stay attached to the graph — with unavailable prices clearly marked until a provider supplies them.",
    accent: "from-fuchsia-500/10 via-transparent to-transparent",
  },
];

const workflow = [
  { n: "01", title: "Search & place", desc: "500+ catalog definitions and domain filters. Click or drag — every drop is a typed node with visible support coverage.", icon: Search },
  { n: "02", title: "Wire & validate", desc: "Side pins sit 6px from the artwork edge. Validation catches shorts, TX→TX, I²C collisions live.", icon: GitBranch },
  { n: "03", title: "Code & simulate", desc: "Write supported Arduino-style firmware, preflight it, then drive a behavioral model and inspect pin states, serial, and output events.", icon: Activity },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const [heroInView, setHeroInView] = useState(false);

  useEffect(() => {
    document.body.classList.add("landing-body");
    const obs = new IntersectionObserver(
      ([e]) => setHeroInView(e.isIntersecting),
      { threshold: 0.2 }
    );
    if (heroRef.current) obs.observe(heroRef.current);
    return () => {
      obs.disconnect();
      document.body.classList.remove("landing-body");
    };
  }, []);

  return (
    <div className="landing-shell">
      {/* Noise + mesh */}
      <div className="landing-noise" aria-hidden />
      <div className="landing-mesh" aria-hidden>
        <span className="mesh-a" />
        <span className="mesh-b" />
        <span className="mesh-c" />
      </div>

      {/* Floating glass nav */}
      <nav className={`landing-nav ${menuOpen ? "is-open" : ""}`}>
        <Link to="/" className="landing-brand">
          <span className="brand-mark landing-logo">
            <LogoMark />
          </span>
          <span>Schematic</span>
          <span className="brand-dot" />
        </Link>

        <div className="landing-nav-pill hidden md:flex">
          <a href="#platform">Platform</a>
          <a href="#workflow">Workflow</a>
          <a href="#showcase">Showcase</a>
          <Link to="/settings">Settings</Link>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/studio" className="landing-cta-pill hidden sm:inline-flex">
            <span>Open studio</span>
            <span className="cta-icon">
              <ArrowUpRight size={14} strokeWidth={1.6} />
            </span>
          </Link>
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="landing-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="hamburger"
          >
            <span className={menuOpen ? "line1 open" : "line1"} />
            <span className={menuOpen ? "line2 open" : "line2"} />
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div id="landing-menu" className="landing-menu">
          <a href="#platform" onClick={() => setMenuOpen(false)} style={{ transitionDelay: "60ms" }}>
            Platform
          </a>
          <a href="#workflow" onClick={() => setMenuOpen(false)} style={{ transitionDelay: "110ms" }}>
            Workflow
          </a>
          <a href="#showcase" onClick={() => setMenuOpen(false)} style={{ transitionDelay: "160ms" }}>
            Showcase
          </a>
          <Link to="/settings" onClick={() => setMenuOpen(false)} style={{ transitionDelay: "210ms" }}>
            Settings
          </Link>
          <Link to="/studio" className="landing-menu-cta" onClick={() => setMenuOpen(false)} style={{ transitionDelay: "260ms" }}>
            Open studio <ArrowUpRight size={16} />
          </Link>
        </div>
      )}

      <main>
        {/* HERO */}
        <section ref={heroRef} className={`landing-hero ${heroInView ? "in-view" : ""}`}>
          <div className="landing-copy">
            <div className="landing-eyebrow">
              <span className="eyebrow-dot" />
              AGENT-NATIVE • LOCAL-FIRST • 500+ DEFINITIONS
              <Sparkles size={12} strokeWidth={1.4} className="ml-1 opacity-60" />
            </div>
            <h1>
              Design the system.
              <br />
              <span>Understand every connection.</span>
            </h1>
            <p>
              One serious workspace for hardware architecture, firmware, and WebMCP control. The canvas is a typed graph — every surface, tool, and agent share it.
            </p>
            <div className="landing-actions">
              <Link to="/studio" className="landing-primary group">
                <span>Start building</span>
                <span className="btn-icon">
                  <ArrowUpRight size={16} strokeWidth={1.6} />
                </span>
              </Link>
              <a href="#platform" className="landing-secondary">
                Explore platform <ChevronRight size={14} strokeWidth={1.6} />
              </a>
            </div>
            <div className="landing-proof">
              <span>
                <ShieldCheck size={14} strokeWidth={1.4} /> Local-first • no cloud required
              </span>
              <span>
                <Cpu size={14} strokeWidth={1.4} /> 500+ defs • {WEBMCP_TOOL_COUNT} tools
              </span>
              <span className="hidden lg:inline-flex">
                <Zap size={14} strokeWidth={1.4} /> Browser runtime 20k execs
              </span>
            </div>
          </div>

          <div className="landing-visual-wrap">
            <div className="double-bezel">
              <div className="landing-visual" aria-label="Hardware workspace preview">
                <div className="landing-window-bar">
                  <span className="window-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <LogoMark />
                  <span>environment-controller.vlx — Untitled • 3 components</span>
                  <span className="window-badge">
                    <Play size={10} strokeWidth={1.6} /> LIVE
                  </span>
                </div>
                <div className="landing-window-body">
                  <div className="landing-rail">
                    <b>COMPONENTS</b>
                    <div className="landing-part">
                      <img src="/component-svgs/esp32-board.svg" alt="" loading="lazy" /> ESP32-C3
                    </div>
                    <div className="landing-part">
                      <img src="/component-svgs/pushbutton.svg" alt="" loading="lazy" /> Pushbutton
                    </div>
                    <div className="landing-part">
                      <img src="/component-svgs/led.svg" alt="" loading="lazy" /> LED
                    </div>
                    <div className="landing-rail-foot">
                      <Search size={12} strokeWidth={1.4} /> 500+ defs • GPIO • ADC • I²C
                    </div>
                  </div>
                  <div className="landing-canvas">
                    <svg className="landing-connections" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <path className="landing-connection landing-connection-signal" d="M32 49 C 46 49, 55 25, 75 25" />
                      <path className="landing-connection landing-connection-signal" d="M32 55 C 48 55, 56 77, 75 77" />
                      <circle className="landing-connection-dot landing-connection-dot-main" cx="32" cy="49" r="1.1" />
                      <circle className="landing-connection-dot landing-connection-dot-main" cx="32" cy="55" r="1.1" />
                      <circle className="landing-connection-dot landing-connection-dot-device" cx="75" cy="25" r="1.1" />
                      <circle className="landing-connection-dot landing-connection-dot-device" cx="75" cy="77" r="1.1" />
                    </svg>
                    <div className="landing-board board-main">
                      <img src="/component-svgs/esp32-board.svg" alt="" loading="lazy" />
                      <span>ESP32-C3 • GPIO4/GPIO13</span>
                    </div>
                    <div className="landing-board board-sensor">
                      <img src="/component-svgs/pushbutton.svg" alt="" loading="lazy" />
                      <span>Pushbutton • GPIO4</span>
                    </div>
                    <div className="landing-board board-display">
                      <img src="/component-svgs/led.svg" alt="" loading="lazy" />
                      <span>LED • GPIO13</span>
                    </div>
                  </div>
                  <div className="landing-code">
                    <b>FIRMWARE</b>
                    <pre>
                      <em>void</em> setup() {"{"}
                      {"\n"}  pinMode(4, INPUT_PULLUP);
                      {"\n"}  pinMode(13, OUTPUT);
                      {"\n"}
                      {"}"}
                      {"\n\n"}
                      <em>void</em> loop() {"{"}
                      {"\n"}  <em>if</em>(digitalRead(4) == LOW) {"{"}
                      {"\n"}    digitalWrite(13, HIGH);
                      {"\n"}  {"}"} <em>else</em> {"{"}
                      {"\n"}    digitalWrite(13, LOW);
                      {"\n"}  {"}"}
                      {"\n"}
                      {"}"}
                    </pre>
                    <div className="code-foot">
                      <span className="dot on" /> browser runtime • button → LED
                    </div>
                  </div>
                </div>
              </div>
            </div>
              <div className="visual-caption">Typed graph → validation → behavioral runtime. The preview uses a supported button → LED path.</div>
          </div>
        </section>

        {/* PLATFORM BENTO */}
        <section id="platform" className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">THE PLATFORM</div>
            <h2>
              Everything stays connected.
              <br />
              <span>Not a picture — a graph.</span>
            </h2>
            <p>Every panel, every tool, every agent reads the same `HardwareProject`. No export, no drift.</p>
          </div>

          <div className="landing-bento">
            {bento.map(({ icon: Icon, kicker, title, body, span, accent, stat, statLabel }) => (
              <article key={title} className={`bento-card ${span}`}>
                <div className={`bento-accent ${accent}`} />
                <div className="bento-top">
                  <span className="bento-icon">
                    <Icon size={16} strokeWidth={1.4} />
                  </span>
                  <span className="bento-kicker">{kicker}</span>
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
                {stat && (
                  <div className="bento-stat">
                    <strong>{stat}</strong>
                    <span>{statLabel}</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        {/* WORKFLOW */}
        <section id="workflow" className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">WORKFLOW</div>
            <h2>Search. Wire. Run.</h2>
          </div>
          <div className="workflow">
            {workflow.map(({ n, title, desc, icon: Icon }) => (
              <div key={n} className="workflow-step">
                <div className="step-num">{n}</div>
                <div className="step-icon">
                  <Icon size={18} strokeWidth={1.4} />
                </div>
                <h4>{title}</h4>
                <p>{desc}</p>
              </div>
            ))}
          </div>
          <div className="workflow-bar">
            <span>
              <ShieldCheck size={14} strokeWidth={1.4} /> validation: missing pull-up, TX→TX, I²C collision
            </span>
            <span>
              <Activity size={14} strokeWidth={1.4} /> deterministic browser runtime • GPIO + I²C trace
            </span>
            <span>
              <Layers size={14} strokeWidth={1.4} /> netlist • Union-Find • 8 resolved nets in demo
            </span>
          </div>
        </section>

        {/* SHOWCASE */}
        <section id="showcase" className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">SHOWCASE</div>
            <h2>From graph to cart without context loss.</h2>
          </div>
          <div className="showcase">
            <div className="showcase-main">
              <div className="showcase-label">VERIFIED FLOW • button-led • 3 comps • 3 signal paths</div>
              <div className="showcase-canvas">
                <img src="/component-svgs/esp32-board.svg" alt="" loading="lazy" style={{ left: "18%", top: "28%" }} />
                <img src="/component-svgs/pushbutton.svg" alt="" loading="lazy" style={{ left: "8%", top: "62%" }} />
                <img src="/component-svgs/led.svg" alt="" loading="lazy" style={{ right: "12%", top: "34%" }} />
                <svg className="showcase-connections" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <path className="showcase-connection showcase-connection-signal" d="M34 44 C 48 44, 57 39, 72 39" />
                  <path className="showcase-connection showcase-connection-signal" d="M24 74 C 38 74, 47 57, 55 48" />
                  <path className="showcase-connection showcase-connection-power" d="M34 50 C 45 50, 50 69, 55 74" />
                  <circle className="showcase-connection-dot" cx="34" cy="44" r="1.1" />
                  <circle className="showcase-connection-dot" cx="24" cy="74" r="1.1" />
                  <circle className="showcase-connection-dot" cx="34" cy="50" r="1.1" />
                  <circle className="showcase-connection-dot" cx="72" cy="39" r="1.1" />
                  <circle className="showcase-connection-dot" cx="55" cy="74" r="1.1" />
                </svg>
              </div>
              <div className="showcase-foot">
                <span>500+ defs • exact search “pushbutton” → typed GPIO input</span>
                <Link to="/studio" className="mini-cta">
                  Open <ArrowUpRight size={12} />
                </Link>
              </div>
            </div>
            <div className="showcase-side">
              <div className="mini-card">
                <b>Validation</b>
                <code>✓ valid true • GPIO4 → GPIO13</code>
                <code className="muted">input: pressed → LED ACTIVE</code>
              </div>
              <div className="mini-card">
                <b>Shopping</b>
                <code>Exact part • provider/agent offers when connected</code>
                <code className="muted">quote → cart_undo → cart_reset</code>
              </div>
              <div className="mini-card">
                <b>Code</b>
                <code>if(digitalRead(4)==LOW) digitalWrite(13,HIGH);</code>
                <code className="muted">preflight balanced_braces: true</code>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="landing-cta">
          <div className="cta-bezel">
            <div className="cta-inner">
              <div>
                <div className="eyebrow light">READY TO BUILD</div>
                <h2>Open an empty world and make it yours.</h2>
                <p>Local-first in development; hosted workspaces use one platform identity. Your project is a JSON graph you can carry anywhere.</p>
              </div>
              <Link to="/studio" className="landing-primary large group">
                <span>Launch studio</span>
                <span className="btn-icon">
                  <ArrowUpRight size={18} strokeWidth={1.6} />
                </span>
              </Link>
            </div>
          </div>
          <div className="cta-foot">AGPL-3.0 • WebMCP {WEBMCP_TOOL_COUNT} tools • browser runtime • provider-backed prices when connected</div>
        </section>
      </main>

      <footer className="landing-footer">© 2026 Schematic • Built for builders, not slides.</footer>
    </div>
  );
}
