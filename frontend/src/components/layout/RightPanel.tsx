import { lazy, Suspense } from "react";
import Inspector from "../inspector/Inspector.tsx";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { getCatalogComponent } from "../../data/catalog.ts";
import { Code2, Eye, FolderKanban, Trash2, ShoppingCart, CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";
import ShoppingWorkspace from "../shopping/ShoppingWorkspace.tsx";
import { useWorkspaceStore } from "../../store/useWorkspaceStore.ts";
import { useValidationStore } from "../../store/useValidationStore.ts";
import { useGraphFocusStore } from "../../store/useGraphFocusStore.ts";
import DestructiveConfirmButton from "../DestructiveConfirmButton.tsx";

const MonacoWorkspace = lazy(() => import("../editor/MonacoWorkspace.tsx"));

export default function RightPanel() {
  const tab = useWorkspaceStore((state) => state.rightPanelTab);
  const setTab = useWorkspaceStore((state) => state.setRightPanelTab);
  const project = useProjectStore((s) => s.project);
  const activeId = useSelectionStore((s) => s.activeComponentId);
  const validationValid = useValidationStore((s) => s.valid);
  const validationIssues = useValidationStore((s) => s.issues);
  const active = project.components.find((c) => c.id === activeId);

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
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "code" && (
          <div className="flex flex-1 flex-col min-h-0">
            <Suspense fallback={<div className="flex h-full items-center justify-center bg-card text-xs text-muted-foreground">Loading source editor…</div>}>
              <MonacoWorkspace />
            </Suspense>
          </div>
        )}
        {tab === "inspect" && (
          <div className="flex-1 overflow-auto">
            <Inspector />
            {active && (
              <div className="flex gap-1.5 p-2">
                <DestructiveConfirmButton
                  targetKey={active.id}
                  onConfirm={() => useProjectStore.getState().removeComponent(active.id)}
                  className="w-full rounded border border-red-200 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
                  aria-label={`Remove ${active.id}`}
                  confirmAriaLabel={`Confirm remove ${active.id}; attached wires and targeted editable source documents will also be removed`}
                  title={`Arm removal of ${active.id}; attached wires and targeted editable source documents are also affected`}
                  confirmTitle={`Click again to remove ${active.id}; attached wires and targeted editable source documents will be removed`}
                  confirmChildren={<>Confirm remove <span className="font-mono">{active.id}</span></>}
                >
                  Remove
                </DestructiveConfirmButton>
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
                <div className="rounded border border-border p-2 text-center"><div className="font-mono text-sm font-medium tabular-nums">{String(project.codeDocuments?.length ?? project.firmwareTargets.length).padStart(2,"0")}</div><div className="kicker !text-[9px]">Code docs</div></div>
              </div>
            </div>

            <div className="overflow-hidden rounded border border-border">
              <div className="border-b border-border bg-muted/30 px-2 py-1.5 kicker">Components</div>
              <div className="max-h-[200px] overflow-auto divide-y divide-border">
                {project.components.length === 0 ? <div className="p-4 text-center text-xs text-muted-foreground">No components</div> : project.components.map((c) => {
                  const d = getCatalogComponent(c.definitionId);
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
                {project.connections.length===0 ? <div className="p-3 text-center text-xs text-muted-foreground">No wires</div> : project.connections.map((w) => {
                  const wireIssues = validationIssues.filter((issue) => issue.affectedConnections?.includes(w.id));
                  const hasError = wireIssues.some((issue) => issue.severity === "error");
                  const hasWarning = wireIssues.some((issue) => issue.severity === "warning");
                  const status = hasError ? "Needs a fix" : hasWarning ? "Review" : validationValid === true ? "Checked" : "Run graph checks";
                  const StatusIcon = hasError ? CircleAlert : hasWarning ? CircleAlert : validationValid === true ? CheckCircle2 : CircleDashed;
                  return <button type="button" key={w.id} onClick={() => { useGraphFocusStore.getState().setActiveConnection(w.id); useSelectionStore.getState().setActive(w.source.componentId); }} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-mono text-xs hover:bg-muted" aria-label={`Select wire ${w.id}; ${status}`} title={`${status}: ${w.source.componentId}.${w.source.portId} → ${w.target.componentId}.${w.target.portId}`}>
                    <StatusIcon size={11} className={hasError ? "text-red-600 dark:text-red-400" : hasWarning ? "text-amber-600 dark:text-amber-400" : validationValid === true ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{w.source.componentId}.{w.source.portId} → {w.target.componentId}.{w.target.portId}</span>
                    <span className="sr-only">{status}</span>
                  </button>;
                })}
              </div>
            </div>

            <div className="flex gap-1.5">
              <DestructiveConfirmButton
                targetKey={project.id}
                onConfirm={() => useProjectStore.getState().clear()}
                className="flex-1 rounded border border-red-200 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 inline-flex items-center justify-center gap-1"
                aria-label={`Clear project ${project.name}`}
                confirmAriaLabel={`Confirm clear project ${project.name}; components, wires, Behavior Plans, and editable source will be removed`}
                title={`Arm project clear; components, wires, Behavior Plans, and editable source are affected`}
                confirmTitle={`Click again to clear ${project.name}; components, wires, Behavior Plans, and editable source will be removed`}
                confirmChildren={<><Trash2 size={11} strokeWidth={1.6} /> Confirm clear</>}
              >
                <Trash2 size={11} strokeWidth={1.6} /> Clear
              </DestructiveConfirmButton>
              <button type="button" onClick={()=>{const b=new Blob([JSON.stringify(project,null,2)],{type:"application/json"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download=`${project.name}.json`; a.click(); URL.revokeObjectURL(u)}} className="flex-1 rounded bg-foreground py-1.5 text-xs font-medium text-background hover:opacity-90">Export</button>
            </div>
          </div>
        )}
        {tab === "shopping" && <ShoppingWorkspace />}
      </div>
    </div>
  );
}
