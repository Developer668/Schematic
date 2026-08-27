import { useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import HardwareCanvas from "../components/canvas/HardwareCanvas.tsx";
import RightPanel from "../components/layout/RightPanel.tsx";
import BottomDock from "../components/layout/BottomDock.tsx";
import ImportDialog from "../components/import/ImportDialog.tsx";
import { useComponentCatalogStore } from "../store/useComponentCatalogStore.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSimulationStore } from "../store/useSimulationStore.ts";
import { getRegisteredToolNames, invokeWebMCPTool } from "../webmcp/tools.ts";
import { triggerDownloadVlx } from "../utils/vllxFile.ts";
import { useThemeStore } from "../store/useThemeStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";
import { catalog, categories as allCategories } from "../data/catalog.ts";
import ComponentArtwork from "../components/ComponentArtwork.tsx";
import LogoMark from "../components/LogoMark.tsx";
import { Search, X, Settings, Download, Trash2, Play, Square, PanelLeft, PanelRight, ChevronDown, Box, Wrench, Wifi, PanelBottom } from "lucide-react";

function ThemeIcon({ theme }: { theme: string }) {
  return theme === "dark" ? (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.2v1M8 14v1M1.2 8h1M13.8 8h1M3.2 3.2l.7.7M12.1 12.1l.7.7M3.2 12.8l.7-.7M12.1 3.9l.7-.7" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M12.5 8A4.5 4.5 0 1 1 8 3.5 3.4 3.4 0 0 0 12.5 8Z" />
    </svg>
  );
}

export default function StudioPage() {
  const { results, search, setCategory, category } = useComponentCatalogStore();
  const { addComponent, project, clear } = useProjectStore();
  const running = useSimulationStore((state) => state.running);
  const { theme, toggle } = useThemeStore();
  const libraryDensity = useWorkspaceStore((s) => s.libraryDensity);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(category);
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [runError, setRunError] = useState("");

  const [leftCollapsed, setLeftCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const [rightCollapsed, setRightCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 1280);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(224);
  const isResizingRef = useRef(false);
  const toolNames = getRegisteredToolNames();

  const doRun = async () => {
    setRunError("");
    const result = await invokeWebMCPTool("simulation.run", { durationMs: 1000 });
    if (result?.isError) setRunError(result.content?.[0]?.text ?? "Simulation failed");
  };

  const doStop = async () => { await invokeWebMCPTool("simulation.stop"); };

  const handleSearch = (v: string) => { setQuery(v); search(v); };
  const handleCategory = (c: string | null) => { setActiveCat(c); setCategory(c); };

  const manufacturers = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of catalog) if (c.manufacturer) m.set(c.manufacturer, (m.get(c.manufacturer) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  }, []);

  const filteredResults = useMemo(() => {
    if (!orgFilter) return results;
    return results.filter((c) => c.manufacturer === orgFilter);
  }, [results, orgFilter]);

  const handleDragStart = (e: React.DragEvent, compId: string) => {
    e.dataTransfer.setData("application/x-schematic-component", compId);
    e.dataTransfer.effectAllowed = "copy";
    const def = catalog.find((c) => c.id === compId);
    if (def?.thumbnail) {
      const div = document.createElement("div");
      div.innerHTML = def.thumbnail;
      div.style.position = "absolute"; div.style.top = "-1000px"; div.style.width = "28px"; div.style.height = "28px";
      document.body.appendChild(div);
      const svg = div.querySelector("svg");
      if (svg) e.dataTransfer.setDragImage(svg as any, 14, 14);
      setTimeout(() => div.remove(), 0);
    }
  };

  const onResizeStart = (e: React.MouseEvent) => {
    isResizingRef.current = true;
    const sy = e.clientY, sh = bottomHeight;
    const onMove = (ev: MouseEvent) => { if (isResizingRef.current) setBottomHeight(Math.min(360, Math.max(140, sh + (sy - ev.clientY)))); };
    const onUp = () => { isResizingRef.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="workbench flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
      <header className="workbench-header h-11 shrink-0 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="flex items-center gap-1.5">
            <span className="brand-mark"><LogoMark /></span>
            <span className="hidden text-[13px] font-semibold tracking-[-0.025em] sm:inline">Schematic</span>
          </Link>
          <span className="hidden h-4 w-px bg-border md:block" />
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <span className="truncate text-xs font-medium">{project.name}</span>
            <span className="status-pill">Saved locally</span>
          </div>
          <div className="hidden items-center gap-1 lg:flex">
            <button aria-label="Toggle component library" title="Toggle component library" onClick={() => setLeftCollapsed(v => !v)} className={`workspace-icon-button ${!leftCollapsed ? "is-active" : ""}`}>
              <PanelLeft size={13} strokeWidth={1.8} />
            </button>
            <button aria-label="Toggle code panel" title="Toggle code panel" onClick={() => setRightCollapsed(v => !v)} className={`workspace-icon-button hidden xl:grid ${!rightCollapsed ? "is-active" : ""}`}>
              <PanelRight size={13} strokeWidth={1.8} />
            </button>
            <button aria-label="Toggle bottom panel" title="Toggle bottom panel" onClick={() => setBottomCollapsed(v => !v)} className={`workspace-icon-button ${!bottomCollapsed ? "is-active" : ""}`}>
              <PanelBottom size={13} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="status-pill hidden lg:inline-flex"><Wifi size={11} /> WebMCP · {toolNames.length}</span>
          <button aria-label="Toggle color theme" title="Toggle color theme" onClick={toggle} className="workspace-icon-button">
            <ThemeIcon theme={theme} />
          </button>
          <Link to="/settings" className="secondary-button hidden sm:inline-flex">
            <Settings size={12} strokeWidth={1.8} /> Settings
          </Link>
          <button onClick={() => setShowImport(true)} className="secondary-button hidden sm:inline-flex">Import</button>
          <button onClick={() => triggerDownloadVlx(project.name)} className="secondary-button hidden md:inline-flex">
            <Download size={12} strokeWidth={1.8} /> Export
          </button>
          <button onClick={clear} className="workspace-icon-button hidden sm:grid" title="Clear workspace" aria-label="Clear workspace">
            <Trash2 size={12} strokeWidth={1.8} />
          </button>
          {running ? (
            <button onClick={doStop} className="run-button is-running">
              <Square size={9} className="fill-white" /> Stop
            </button>
          ) : (
            <button onClick={doRun} className="run-button">
              <Play size={9} className="fill-current" /> Run
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* LEFT — compact 260px */}
        {!leftCollapsed && (
          <aside className="panel-enter w-[292px] shrink-0 border-r border-border bg-card flex flex-col">
            <div className="flex h-11 items-center justify-between border-b border-border px-3">
              <div className="flex items-center gap-2"><Box size={14} /><div><div className="text-xs font-semibold">Components</div><div className="text-[10px] text-muted-foreground">Drag into the workspace</div></div></div>
              <span className="count-badge">{filteredResults.length}</span>
            </div>

            <div className="space-y-2.5 border-b border-border p-3">
              <div className="relative">
                <Search size={13} strokeWidth={1.8} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search 48+ parts and boards"
                  aria-label="Search component library"
                  className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/10"
                />
                {query ? (
                  <button onClick={() => handleSearch("")} className="absolute right-1 top-1/2 -translate-y-1/2 h-4 w-4 grid place-items-center rounded hover:bg-muted text-muted-foreground">
                    <X size={10} strokeWidth={1.8} />
                  </button>
                ) : (
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden sm:inline text-[9px] font-mono text-muted-foreground border border-border rounded px-1 leading-none py-0.5">/</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="kicker !text-[8px] !tracking-[0.06em]">Category</span>
                  <div className="relative">
                    <select value={activeCat ?? ""} onChange={(e) => handleCategory(e.target.value || null)} className="h-8 w-full appearance-none rounded-md border border-border bg-background pl-2 pr-6 text-xs focus:outline-none focus:ring-2 focus:ring-ring/10">
                      <option value="">All</option>
                      {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={10} strokeWidth={1.7} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="kicker !text-[8px]">Mfr</span>
                  <div className="relative">
                    <select value={orgFilter ?? ""} onChange={(e) => setOrgFilter(e.target.value || null)} className="h-8 w-full appearance-none rounded-md border border-border bg-background pl-2 pr-6 text-xs focus:outline-none focus:ring-2 focus:ring-ring/10">
                      <option value="">All</option>
                      {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <ChevronDown size={10} strokeWidth={1.7} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
              </div>

              {(activeCat || orgFilter || query) && (
                <div className="flex items-center gap-1">
                  {activeCat && <span className="inline-flex rounded border border-foreground bg-foreground text-background px-1 py-0 text-[10px] font-medium">{activeCat}</span>}
                  {orgFilter && <span className="inline-flex rounded border border-foreground bg-foreground text-background px-1 py-0 text-[10px] font-medium">{orgFilter}</span>}
                  <button onClick={() => { setActiveCat(null); setCategory(null); setOrgFilter(null); handleSearch(""); }} className="ml-auto text-[11px] underline decoration-muted-foreground/30 underline-offset-2 hover:decoration-foreground">Reset</button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto">
              <div className={`component-list p-2 ${libraryDensity === "compact" ? "is-compact" : ""}`}>
                {filteredResults.length === 0 ? (
                  <div className="mx-1 my-4 rounded border border-dashed border-border p-4 text-center">
                    <p className="text-[11px] font-medium">No components</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Try “esp32”</p>
                  </div>
                ) : (
                  filteredResults.slice(0, 80).map((c) => {
                    const dot = c.category === "board" || c.category === "display" ? "bg-blue-500" : "bg-zinc-400";
                    return (
                      <button
                        key={c.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, c.id)}
                        onClick={() => addComponent(c.id)}
                        className="component-list-item group"
                      >
                        <div className="component-preview shrink-0">
                          <ComponentArtwork definition={c} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold leading-tight">{c.title}</div>
                          <div className="truncate text-[10px] text-muted-foreground">{c.manufacturer ?? c.id}</div>
                          <div className="mt-0.5 flex items-center gap-1">
                            <span className={`h-3 w-[2px] rounded-sm ${dot}`} />
                            <span className="text-[10px] capitalize text-muted-foreground">{c.category}</span>
                            <span className="text-muted-foreground/30 text-[10px]">·</span>
                            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{c.ports.length}</span>
                          </div>
                        </div>
                        <span className="component-add">+</span>
                      </button>
                    );
                  })
                )}
                {filteredResults.length > 80 && <div className="py-1.5 text-center font-mono text-[10px] text-muted-foreground">80 of {filteredResults.length}</div>}
              </div>
            </div>

            <div className="border-t border-border bg-muted/20 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground"><Wrench size={11} /> Click to add · drag to position</p>
            </div>
          </aside>
        )}

        {/* CENTER */}
        <main className="flex flex-1 flex-col min-w-0 bg-background relative">
          {leftCollapsed && (
            <button onClick={() => setLeftCollapsed(false)} className="absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded border border-border bg-card hover:bg-muted">
              <PanelLeft size={11} strokeWidth={1.7} />
            </button>
          )}
          <div className="relative min-h-0 flex-1">
            <HardwareCanvas />
            {runError && <div className="run-error" role="alert">{runError}</div>}
          </div>
          {!bottomCollapsed && <div onMouseDown={onResizeStart} className="h-px bg-border hover:bg-foreground/20 cursor-row-resize shrink-0" />}
          <BottomDock collapsed={bottomCollapsed} onToggleCollapse={() => setBottomCollapsed(v => !v)} height={bottomHeight} />
        </main>

        {/* RIGHT — compact 300px */}
        {!rightCollapsed ? (
          <aside className="panel-enter hidden w-[360px] shrink-0 flex-col border-l border-border bg-card xl:flex">
            <RightPanel />
          </aside>
        ) : (
          <div className="hidden xl:flex w-7 shrink-0 flex-col items-center gap-1.5 border-l border-border bg-card py-1.5">
            <button onClick={() => setRightCollapsed(false)} className="grid h-6 w-6 place-items-center rounded bg-foreground text-background">
              <PanelRight size={11} strokeWidth={1.7} />
            </button>
          </div>
        )}
      </div>

      <div className="xl:hidden">
        {!rightCollapsed && (
          <div className="fixed inset-0 z-30 flex">
            <div className="flex-1 bg-foreground/10 backdrop-blur-[1px]" onClick={() => setRightCollapsed(true)} />
            <div className="flex w-[84vw] max-w-[320px] flex-col border-l border-border bg-card">
              <div className="flex h-7 items-center justify-between border-b border-border px-2.5">
                <span className="kicker">Inspector</span>
                <button onClick={() => setRightCollapsed(true)} className="grid h-5 w-5 place-items-center rounded hover:bg-muted"><X size={11} strokeWidth={1.7} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden"><RightPanel /></div>
            </div>
          </div>
        )}
        {rightCollapsed && (
          <button onClick={() => setRightCollapsed(false)} className="fixed bottom-3 right-3 z-20 grid h-8 w-8 place-items-center rounded bg-foreground text-background shadow">
            <PanelRight size={12} strokeWidth={1.7} />
          </button>
        )}
      </div>

      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}

      <footer className="flex h-5 items-center gap-2 border-t border-border bg-muted/40 px-2.5 text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
        <span>{project.components.length}c · {project.connections.length}w</span>
        <span className="hidden sm:inline">· {toolNames.length} tools</span>
        <span className="ml-auto">{running ? "running" : "idle"}</span>
      </footer>
    </div>
  );
}
