import { lazy, Suspense, useState } from "react";
import Inspector from "../inspector/Inspector.tsx";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { catalog } from "../../data/catalog.ts";
import { Code2, Eye, FolderKanban, Copy, Trash2, ShoppingCart, Check } from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";
import ShoppingWorkspace from "../shopping/ShoppingWorkspace.tsx";

const MonacoWorkspace = lazy(() => import("../editor/MonacoWorkspace.tsx"));

type Tab = "code" | "inspect" | "project" | "shopping";

export default function RightPanel() {
  const [tab, setTab] = useState<Tab>("code");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const project = useProjectStore((s) => s.project);
  const activeId = useSelectionStore((s) => s.activeComponentId);
  const active = project.components.find((c) => c.id === activeId);

  const copyToClipboard = async (value: string, label: string) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied`);
      window.setTimeout(() => setCopyStatus(null), 1800);
    } catch {
      setCopyStatus("Clipboard access is unavailable");
    }
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex min-w-0 h-7 items-center gap-0 overflow-x-auto border-b border-border px-2">
        <button type="button" aria-pressed={tab === "code"} onClick={() => setTab("code")} className={`flex h-7 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs ${tab==="code" ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <Code2 size={12} strokeWidth={1.6} /> Code
        </button>
        <button type="button" aria-pressed={tab === "inspect"} onClick={() => setTab("inspect")} className={`flex h-7 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs ${tab==="inspect" ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <Eye size={12} strokeWidth={1.6} /> Inspect
        </button>
        <button type="button" aria-pressed={tab === "project"} onClick={() => setTab("project")} className={`flex h-7 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs ${tab==="project" ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <FolderKanban size={12} strokeWidth={1.6} /> Project
        </button>
        <button type="button" aria-pressed={tab === "shopping"} onClick={() => setTab("shopping")} className={`flex h-7 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs ${tab==="shopping" ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <ShoppingCart size={12} strokeWidth={1.6} /> Parts
        </button>
        <button type="button" onClick={() => void copyToClipboard(JSON.stringify(project, null, 2), "Project JSON")} className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-muted text-muted-foreground" title="Copy JSON" aria-label="Copy project JSON">
          {copyStatus === "Project JSON copied" ? <Check size={12} strokeWidth={1.8} /> : <Copy size={12} strokeWidth={1.6} />}
        </button>
      </div>
      {copyStatus && <div className="border-b border-border bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground" role="status" aria-live="polite">{copyStatus}</div>}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "code" && (
          <div className="flex flex-1 flex-col min-h-0">
            <Suspense fallback={<div className="flex h-full items-center justify-center bg-card text-xs text-muted-foreground">Loading firmware editor…</div>}>
              <MonacoWorkspace />
            </Suspense>
          </div>
        )}
        {tab === "inspect" && (
          <div className="flex-1 overflow-auto">
            <Inspector />
            {active && (
              <div className="flex gap-1.5 p-2">
                <button type="button" onClick={() => void copyToClipboard(active.id, "Component ID")} className="flex-1 rounded border border-border py-1.5 text-xs hover:bg-muted">Copy ID</button>
                <button type="button" onClick={() => useProjectStore.getState().removeComponent(active.id)} className="flex-1 rounded border border-red-200 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400">Remove</button>
              </div>
            )}
          </div>
        )}
        {tab === "project" && (
          <div className="flex-1 overflow-auto p-2 space-y-2 text-xs">
            <div className="rounded border border-border p-2.5">
              <div className="kicker mb-2">Project</div>
              <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-mono text-xs">{project.name}</span></div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <div className="rounded border border-border p-2 text-center"><div className="font-mono text-sm font-medium tabular-nums">{String(project.components.length).padStart(2,"0")}</div><div className="kicker !text-[9px]">Comps</div></div>
                <div className="rounded border border-border p-2 text-center"><div className="font-mono text-sm font-medium tabular-nums">{String(project.connections.length).padStart(2,"0")}</div><div className="kicker !text-[9px]">Wires</div></div>
                <div className="rounded border border-border p-2 text-center"><div className="font-mono text-sm font-medium tabular-nums">{String(project.firmwareTargets.length).padStart(2,"0")}</div><div className="kicker !text-[9px]">Firmware</div></div>
              </div>
            </div>

            <div className="overflow-hidden rounded border border-border">
              <div className="border-b border-border bg-muted/30 px-2 py-1.5 kicker">Components</div>
              <div className="max-h-[200px] overflow-auto divide-y divide-border">
                {project.components.length === 0 ? <div className="p-4 text-center text-xs text-muted-foreground">No components</div> : project.components.map((c) => {
                  const d = catalog.find(x=>x.id===c.definitionId);
                  const isActive = c.id===activeId;
                  return (
                    <button type="button" key={c.id} onClick={()=>useSelectionStore.getState().setActive(c.id)} className={`flex w-full gap-2 px-2 py-2 text-left hover:bg-muted ${isActive?"bg-muted":""}`}>
                      <div className="h-9 w-11 shrink-0"><ComponentArtwork definition={d} /></div>
                      <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{d?.title ?? c.definitionId}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{c.id}</div></div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="overflow-hidden rounded border border-border">
              <div className="border-b border-border bg-muted/30 px-2 py-1.5 kicker">Wires</div>
              <div className="max-h-[110px] overflow-auto divide-y divide-border">
                {project.connections.length===0 ? <div className="p-3 text-center text-xs text-muted-foreground">No wires</div> : project.connections.map(w=>(
                  <div key={w.id} className="flex items-center gap-1.5 px-2 py-1.5 font-mono text-xs"><span className="h-1.5 w-1.5 rounded-full bg-foreground shrink-0" />{w.source.componentId}.{w.source.portId} → {w.target.componentId}.{w.target.portId}</div>
                ))}
              </div>
            </div>

            <div className="flex gap-1.5">
              <button type="button" onClick={()=>useProjectStore.getState().clear()} className="flex-1 rounded border border-border py-1.5 text-xs hover:bg-muted inline-flex items-center justify-center gap-1"><Trash2 size={11} strokeWidth={1.6}/> Clear</button>
              <button type="button" onClick={()=>{const b=new Blob([JSON.stringify(project,null,2)],{type:"application/json"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download=`${project.name}.json`; a.click(); URL.revokeObjectURL(u)}} className="flex-1 rounded bg-foreground py-1.5 text-xs font-medium text-background hover:opacity-90">Export</button>
            </div>
          </div>
        )}
        {tab === "shopping" && <ShoppingWorkspace />}
      </div>
    </div>
  );
}
