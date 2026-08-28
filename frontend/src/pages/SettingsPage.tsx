import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useThemeStore } from "../store/useThemeStore.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";
import { useWebMCPStore } from "../store/useWebMCPStore.ts";
import { getRegisteredToolNames } from "../webmcp/tools.ts";
import LogoMark from "../components/LogoMark.tsx";
import { apiUrl, getAuthHeaders } from "../auth/session.ts";
import {
  Palette,
  Grid3X3,
  Cpu,
  Wifi,
  Save,
  Trash2,
  Download,
  Upload,
  ArrowLeft,
  Moon,
  Sun,
  Zap,
  Globe,
  Shield,
  Info,
  ExternalLink,
  Check,
  AlertCircle,
  Layers,
} from "lucide-react";

export default function SettingsPage() {
  const { theme, setTheme } = useThemeStore();
  const project = useProjectStore((s) => s.project);
  const clear = useProjectStore((s) => s.clear);
  const { showGrid: lineGrid, setShowGrid: setLineGrid, snapToGrid: snapGrid, setSnapToGrid: setSnapGrid, libraryDensity, setLibraryDensity, reducedMotion, setReducedMotion } = useWorkspaceStore();
  const webmcpRegistration = useWebMCPStore((state) => state.registration);
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "offline">("checking");
  const [enginesStatus, setEnginesStatus] = useState<any>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const toolCount = getRegisteredToolNames().length;
  const apiBaseUrl = apiUrl("/api");
  const apiBoundaryLabel = apiBaseUrl.startsWith("/") ? "same-origin API" : "configured API";
  const webmcpStatus = webmcpRegistration.state === "native"
    ? "Native WebMCP connected"
    : webmcpRegistration.state === "fallback"
      ? "Local compatibility bridge"
      : webmcpRegistration.state === "error"
        ? "Registration incomplete"
        : webmcpRegistration.state === "unavailable"
          ? "WebMCP unavailable"
          : "Checking WebMCP…";
  const webmcpCount = webmcpRegistration.state === "checking" ? `${toolCount} declared` : `${webmcpRegistration.registeredCount}/${toolCount} registered`;

  const checkApi = useCallback(async () => {
    setApiStatus("checking");
    try {
      const request = async (force = false) => fetch(apiUrl("/api/engines"), { headers: await getAuthHeaders(force), credentials: "include" });
      let response = await request();
      if (response.status === 401) response = await request(true);
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        setApiStatus("offline");
        setEnginesStatus(null);
        setNotice({ kind: "info", text: "The remote backend is not connected. The browser behavioral runtime and local WebMCP tools remain available." });
        return;
      }
      const payload = await response.json();
      setApiStatus("ok");
      setEnginesStatus(payload);
      setNotice({ kind: "success", text: "Backend and engine status checked successfully." });
    } catch (error) {
      setApiStatus("offline");
      setEnginesStatus(null);
      setNotice({ kind: "error", text: `Backend check failed: ${(error as Error).message}` });
    }
  }, []);

  useEffect(() => { void checkApi(); }, [checkApi]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name || "schematic"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.currentTarget;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        useProjectStore.getState().loadProject(data);
        setNotice({ kind: "success", text: "Project imported successfully." });
      } catch {
        setNotice({ kind: "error", text: "This file is not valid project JSON." });
      }
      input.value = "";
    };
    reader.onerror = () => {
      setNotice({ kind: "error", text: "The project file could not be read." });
      input.value = "";
    };
    reader.readAsText(file);
  };

  const handleClear = () => {
    if (!clearArmed) {
      setClearArmed(true);
      setNotice({ kind: "info", text: "Clear is ready. Choose Confirm clear to remove this project's components, wires, and firmware." });
      return;
    }
    clear();
    setClearArmed(false);
    setNotice({ kind: "success", text: "Project cleared. The project name was kept." });
  };

  return (
    <div className="settings-shell h-screen min-h-0 bg-background text-foreground flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-[52px] shrink-0 border-b border-border flex items-center justify-between px-4 bg-card/95 backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          <Link to="/studio" className="w-8 h-8 rounded-lg border border-border hover:bg-muted flex items-center justify-center transition-colors">
            <ArrowLeft size={14} />
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="brand-mark"><LogoMark /></div>
            <div className="leading-none">
              <div className="font-bold text-[15px] tracking-tight">Settings</div>
              <div className="text-[11px] text-muted-foreground">Schematic · Hardware WebMCP Workbench</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/studio" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium">
            Back to Studio
          </Link>
          <Link to="/parts" className="hidden text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted font-medium sm:inline-flex">
            Parts
          </Link>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-[1180px] w-full mx-auto p-4 md:p-6 space-y-4 animate-fadeIn">
        {notice && <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${notice.kind === "error" ? "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400" : notice.kind === "success" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-border bg-muted text-muted-foreground"}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite"><span className="mt-0.5 shrink-0">{notice.kind === "error" ? <AlertCircle size={13} /> : notice.kind === "success" ? <Check size={13} /> : <Info size={13} />}</span><span className="min-w-0 flex-1">{notice.text}</span><button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded p-0.5 hover:bg-foreground/10" aria-label="Dismiss notification">×</button></div>}
        {/* Intro */}
        <div className="rounded-lg border border-border bg-card p-5 md:p-6 flex flex-col md:flex-row gap-4 items-start shadow-sm">
          <div className="w-11 h-11 rounded-md border border-border bg-muted flex items-center justify-center shrink-0">
            <Cpu size={19} />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold tracking-tight">Workspace Settings</h1>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">
              Tune appearance, canvas, and connectivity. Projects are saved in browser <code className="bg-muted px-1 rounded">IndexedDB</code> with localStorage compatibility migration; the app keeps editing, validation, and source export local even when its optional API boundary is offline.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${apiStatus === "ok" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" : apiStatus === "offline" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                {apiStatus === "ok" ? <Check size={12} /> : apiStatus === "offline" ? <AlertCircle size={12} /> : <Layers size={12} />}
                API {apiStatus === "ok" ? "connected" : apiStatus === "offline" ? "offline" : "checking…"}
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground">{project.components.length} comps · {project.connections.length} wires</span>
            </div>
          </div>
          <div className="hidden md:block text-right">
            <div className="text-[11px] text-muted-foreground">Version</div>
            <div className="text-sm font-mono font-medium">1.0.0 · AGPL-3.0</div>
            <a href="/api/docs" target="_blank" className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1">
              API docs <ExternalLink size={10} />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Appearance */}
          <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
              <Palette size={14} className="text-primary" />
              <span className="text-sm font-semibold">Appearance</span>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="text-xs font-medium mb-2">Theme</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    className={`p-3 rounded-md border text-center transition-all ${theme === "dark" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card border-border hover:bg-muted"}`}
                  >
                    <Moon size={16} className="mx-auto mb-1" />
                    <div className="text-xs font-medium">Dark</div>
                    <div className="text-[10px] opacity-70">Black · default</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    className={`p-3 rounded-md border text-center transition-all ${theme === "light" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card border-border hover:bg-muted"}`}
                  >
                    <Sun size={16} className="mx-auto mb-1" />
                    <div className="text-xs font-medium">Light</div>
                    <div className="text-[10px] opacity-70">Paper · high contrast</div>
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2 leading-snug">Dark black is default. Light keeps cursor visible via custom SVG cursor in the world canvas.</p>
              </div>

              <div className="space-y-3 pt-3 border-t border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium flex items-center gap-1"><Grid3X3 size={12} /> Drafting line grid</div>
                    <div className="text-[11px] text-muted-foreground">Subtle 24px lines in the world canvas</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle drafting line grid"
                    aria-pressed={lineGrid}
                    onClick={() => setLineGrid(!lineGrid)}
                    className={`w-10 h-6 rounded-full p-0.5 transition-colors ${lineGrid ? "bg-primary" : "bg-muted border border-border"}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${lineGrid ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Snap to grid (16px)</div>
                    <div className="text-[11px] text-muted-foreground">Keeps components aligned</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle snap to grid"
                    aria-pressed={snapGrid}
                    onClick={() => setSnapGrid(!snapGrid)}
                    className={`w-10 h-6 rounded-full p-0.5 transition-colors ${snapGrid ? "bg-primary" : "bg-muted border border-border"}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${snapGrid ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Compact component library</div>
                    <div className="text-[11px] text-muted-foreground">Show more parts at once</div>
                  </div>
                  <button type="button" aria-label="Toggle compact component library" aria-pressed={libraryDensity === "compact"} onClick={() => setLibraryDensity(libraryDensity === "compact" ? "comfortable" : "compact")} className={`w-10 h-6 rounded-full p-0.5 transition-colors ${libraryDensity === "compact" ? "bg-primary" : "bg-muted border border-border"}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${libraryDensity === "compact" ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Reduce motion</div>
                    <div className="text-[11px] text-muted-foreground">Disable non-essential interface movement</div>
                  </div>
                  <button type="button" aria-label="Toggle reduced motion" aria-pressed={reducedMotion} onClick={() => setReducedMotion(!reducedMotion)} className={`w-10 h-6 rounded-full p-0.5 transition-colors ${reducedMotion ? "bg-primary" : "bg-muted border border-border"}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${reducedMotion ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Connectivity */}
          <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
              <Wifi size={14} className="text-primary" />
              <span className="text-sm font-semibold">Connectivity · “all connect”</span>
              <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full border ${apiStatus === "ok" ? "bg-emerald-500 text-white border-emerald-600" : "bg-amber-500 text-white border-amber-600"}`}>{apiStatus}</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/30">
                  <div>
                    <div className="text-xs font-medium flex items-center gap-1"><Globe size={12} /> Backend API</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{apiBaseUrl} · {apiBoundaryLabel} · browser runtime fallback enabled</div>
                  </div>
                  <a href="/api/docs" target="_blank" className="text-xs px-2.5 py-1 rounded-lg bg-card border border-border hover:bg-muted inline-flex items-center gap-1">
                    Open <ExternalLink size={10} />
                  </a>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/30">
                  <div>
                    <div className="text-xs font-medium flex items-center gap-1"><Zap size={12} /> Engines</div>
                    <div className="text-[11px] text-muted-foreground">
                      {enginesStatus ? `${Object.keys(enginesStatus).length} engines reported` : "Checking…"}
                    </div>
                  </div>
                  <a href="/api/engines" target="_blank" className="text-xs px-2.5 py-1 rounded-lg bg-card border border-border hover:bg-muted inline-flex items-center gap-1">
                    View <ExternalLink size={10} />
                  </a>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/30">
                  <div>
                    <div className="text-xs font-medium flex items-center gap-1"><Shield size={12} /> WebMCP</div>
                    <div className="text-[11px] text-muted-foreground">{webmcpCount} tools · {webmcpStatus}</div>
                  </div>
                  <span className={`text-[11px] px-2 py-1 rounded-full ${webmcpRegistration.state === "native" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : webmcpRegistration.state === "error" || webmcpRegistration.state === "unavailable" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-primary text-primary-foreground"}`}>{webmcpRegistration.state === "native" ? "Connected" : webmcpRegistration.state === "fallback" ? "Fallback" : webmcpRegistration.state === "checking" ? "Checking" : "Review"}</span>
                </div>
              </div>

              <div className="rounded-xl bg-muted/20 border border-border p-3">
                <div className="text-xs font-medium mb-1">Verify checklist</div>
                <ul className="text-xs space-y-1 text-muted-foreground">
                  <li className="flex items-center gap-1.5"><Check size={11} className="text-emerald-500" /> Frontend ↔ same-origin API boundary</li>
                  <li className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${webmcpRegistration.state === "native" ? "bg-emerald-500" : webmcpRegistration.state === "error" || webmcpRegistration.state === "unavailable" ? "bg-amber-500" : "bg-primary"}`} /> {webmcpStatus}</li>
                  <li className="flex items-center gap-1.5"><Check size={11} className="text-emerald-500" /> Canvas world ↔ Project store live-sync</li>
                  <li className="flex items-center gap-1.5"><Check size={11} className="text-emerald-500" /> Right panel Code ↔ firmware.write</li>
                  <li className="flex items-center gap-1.5"><Check size={11} className="text-emerald-500" /> Bottom dock ↔ Simulation/Validation</li>
                </ul>
              </div>

              <button type="button" onClick={() => void checkApi()}
                className="w-full text-xs py-2 rounded-xl border border-border hover:bg-muted flex items-center justify-center gap-1.5"
              >
                <Zap size={12} /> Recheck connections
              </button>
            </div>
          </div>

          {/* Project */}
          <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
              <Save size={14} className="text-primary" />
              <span className="text-sm font-semibold">Project</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-muted border border-border p-3">
                  <div className="text-xl font-bold">{project.components.length}</div>
                  <div className="text-[11px] text-muted-foreground">Components</div>
                </div>
                <div className="rounded-xl bg-muted border border-border p-3">
                  <div className="text-xl font-bold">{project.connections.length}</div>
                  <div className="text-[11px] text-muted-foreground">Wires</div>
                </div>
                <div className="rounded-xl bg-muted border border-border p-3">
                  <div className="text-xl font-bold">{project.firmwareTargets.length}</div>
                  <div className="text-[11px] text-muted-foreground">Firmware</div>
                </div>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={handleExport} className="flex-1 text-xs py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-1.5 font-medium">
                  <Download size={12} /> Export project + source
                </button>
                <label className="flex-1 text-xs py-2 rounded-xl border border-border hover:bg-muted flex items-center justify-center gap-1.5 cursor-pointer">
                  <Upload size={12} /> Import
                  <input type="file" accept=".json" className="hidden" onChange={handleImport} />
                </label>
              </div>

              {clearArmed ? <div className="flex gap-2">
                <button type="button" onClick={handleClear} className="flex-1 text-xs py-2 rounded-xl bg-red-500 text-white hover:bg-red-600 border border-red-600 flex items-center justify-center gap-1.5 font-medium"><Trash2 size={12} /> Confirm clear</button>
                <button type="button" onClick={() => setClearArmed(false)} className="px-3 text-xs py-2 rounded-xl border border-border hover:bg-muted">Cancel</button>
              </div> : <button type="button" onClick={handleClear} className="w-full text-xs py-2 rounded-xl bg-red-500/10 hover:bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 flex items-center justify-center gap-1.5">
                <Trash2 size={12} /> Clear project
              </button>}

              <div className="text-[11px] text-muted-foreground leading-snug p-2 rounded-xl bg-muted/20 border border-border">
                Exports include components, wires, and firmware source targets. Import replaces the current project.
              </div>
            </div>
          </div>

          {/* About */}
          <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
              <Info size={14} className="text-primary" />
              <span className="text-sm font-semibold">About · WebMCP Studio</span>
            </div>
            <div className="p-4 space-y-3 text-sm leading-snug">
              <p className="text-muted-foreground">
                <b className="text-foreground">Schematic</b> is an agent-native virtual hardware workbench. Humans and AI compose, wire, program, validate and simulate heterogeneous hardware via <b className="text-foreground">WebMCP</b>.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="font-semibold">Layout</div>
                  <div className="text-muted-foreground">Left: Components · Center: World (dots) · Right: Code/Inspector · Bottom: WebMCP/Terminal/Debug</div>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="font-semibold">Curriculum</div>
                  <div className="text-muted-foreground">Minimap small top-right · drag shows 3D board preview · white-on-white cursor fixed</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Link to="/studio" className="flex-1 text-xs py-2 rounded-xl bg-card border border-border hover:bg-muted text-center">Open Studio</Link>
                <a href="https://github.com/Developer668/Schematic" target="_blank" rel="noreferrer" className="flex-1 text-xs py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-center">Feedback</a>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center text-[11px] text-muted-foreground py-4">
          Dark black default · Animations on every panel · Dotted world · No emoji — lucide icons only.
        </div>
        </div>
      </main>
    </div>
  );
}
