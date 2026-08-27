import { ArrowRight, Boxes, Cable, Code2, Cpu, ShieldCheck, Sparkles, TerminalSquare } from "lucide-react";
import { Link } from "react-router-dom";

const capabilities = [
  { icon: Boxes, title: "Real component catalog", body: "Search boards, sensors, displays, actuators, and passives with recognizable hardware artwork." },
  { icon: Cable, title: "Typed hardware graph", body: "Place parts, wire explicit ports, inspect electrical domains, and keep project structure machine-readable." },
  { icon: Code2, title: "Firmware workspace", body: "Edit project firmware next to the physical design with component-aware project context." },
  { icon: TerminalSquare, title: "Agent-native control", body: "WebMCP tools expose project, component, connection, firmware, and validation operations to compatible agents." },
];

export default function LandingPage() {
  return (
    <div className="landing-shell">
      <nav className="landing-nav">
        <Link to="/" className="landing-brand"><span className="landing-logo"><Cpu size={17} /></span>Schematic</Link>
        <div className="landing-nav-links"><a href="#platform">Platform</a><a href="#workflow">Workflow</a><Link to="/settings">Settings</Link></div>
        <Link to="/studio" className="landing-open">Open studio <ArrowRight size={14} /></Link>
      </nav>

      <main>
        <section className="landing-hero">
          <div className="landing-orb landing-orb-one" /><div className="landing-orb landing-orb-two" />
          <div className="landing-copy">
            <div className="landing-eyebrow"><Sparkles size={13} /> Agent-native hardware workspace</div>
            <h1>Design the system.<br /><span>Understand every connection.</span></h1>
            <p>One serious workspace for hardware architecture, firmware, component inspection, validation, and WebMCP control.</p>
            <div className="landing-actions"><Link to="/studio" className="landing-primary">Start building <ArrowRight size={16} /></Link><a href="#platform" className="landing-secondary">Explore platform</a></div>
            <div className="landing-proof"><span><ShieldCheck size={14} /> Local-first project state</span><span><Cpu size={14} /> 150+ catalog definitions</span></div>
          </div>

          <div className="landing-visual" aria-label="Hardware workspace preview">
            <div className="landing-window-bar"><i /><i /><i /><span>environment-controller.vlx</span></div>
            <div className="landing-window-body">
              <div className="landing-rail"><b>COMPONENTS</b><div className="landing-part"><img src="/component-svgs/esp32-board.svg" /> ESP32</div><div className="landing-part"><img src="/component-svgs/bmp280.svg" /> BMP280</div><div className="landing-part"><img src="/component-svgs/ssd1306.svg" /> OLED</div></div>
              <div className="landing-canvas">
                <div className="landing-wire wire-one" /><div className="landing-wire wire-two" />
                <div className="landing-board board-main"><img src="/component-svgs/esp32-board.svg" /><span>ESP32 controller</span></div>
                <div className="landing-board board-sensor"><img src="/component-svgs/bmp280.svg" /><span>Pressure sensor</span></div>
                <div className="landing-board board-display"><img src="/component-svgs/ssd1306.svg" /><span>OLED display</span></div>
              </div>
              <div className="landing-code"><b>FIRMWARE</b><pre><em>void</em> setup() {'{'}{`\n`}  Wire.begin();{`\n`}  display.begin();{`\n`}{'}'}{`\n\n`}<em>void</em> loop() {'{'}{`\n`}  readSensors();{`\n`}  renderStatus();{`\n`}{'}'}</pre></div>
            </div>
          </div>
        </section>

        <section id="platform" className="landing-section"><div className="landing-section-head"><span>THE PLATFORM</span><h2>Everything stays connected.</h2><p>The canvas is not a picture. It is a structured hardware project shared by every workspace surface and tool.</p></div><div className="landing-grid">{capabilities.map(({icon: Icon,title,body}) => <article key={title}><Icon size={18} /><h3>{title}</h3><p>{body}</p></article>)}</div></section>
        <section id="workflow" className="landing-cta"><div><span>READY TO BUILD</span><h2>Open an empty world and make it yours.</h2></div><Link to="/studio" className="landing-primary">Launch studio <ArrowRight size={16} /></Link></section>
      </main>
    </div>
  );
}
