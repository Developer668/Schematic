import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { getCatalogComponent } from "../../data/catalog.ts";
import { useMemo } from "react";
import { Check, X, Trash2 } from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";

export default function Inspector() {
  const project = useProjectStore((s) => s.project);
  const activeId = useSelectionStore((s) => s.activeComponentId);
  const active = useMemo(() => project.components.find((c) => c.id === activeId), [project.components, activeId]);
  const def = useMemo(() => (active ? getCatalogComponent(active.definitionId) : null), [active]);
  const executable = Boolean(def && (def.model.support === "behavioral" || def.model.support === "engine-backed"));
  const executionClasses = executable
    ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900"
    : "bg-muted text-muted-foreground border-border";

  if (!active || !def) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        <div className="font-medium mb-1 text-foreground text-xs">Inspector</div>
        <div className="text-xs leading-snug">Select a component on the canvas.</div>
        <div className="mt-3 p-2 rounded border border-border bg-muted/30 text-xs">
          <div className="font-mono">{project.name}</div>
          <div className="text-muted-foreground">{project.components.length} comps · {project.connections.length} wires</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 overflow-auto text-xs">
      <div className="inspector-hero">
        <ComponentArtwork definition={def} className="inspector-artwork" />
        <div className="min-w-0">
          <div className="text-xs font-semibold leading-tight">{def.title}</div>
          <div className="text-[11px] text-muted-foreground truncate">{def.manufacturer ?? ""} {def.id}</div>
          <div className="text-[11px] text-muted-foreground capitalize">{def.category} · {def.ports.length} pins</div>
        </div>
        <button
          type="button"
          className="inspector-delete"
          onClick={() => useProjectStore.getState().removeComponent(active.id)}
          aria-label={`Delete ${def.title}`}
          title="Delete component"
        ><Trash2 size={14} /></button>
      </div>

      <div>
        <div className="text-xs font-medium mb-1">Ports</div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40"><tr><th className="text-left px-2 py-1 font-medium">Port</th><th className="text-left px-2 py-1 font-medium">Domain</th><th className="text-left px-2 py-1 font-medium">Dir</th></tr></thead>
            <tbody className="divide-y divide-border">
              {def.ports.map((p) => (
                <tr key={p.id}><td className="px-2 py-1 font-mono">{p.id}</td><td className="px-2 py-1"><span className="px-1 py-0 rounded bg-muted border border-border text-[11px]">{p.domain}</span></td><td className="px-2 py-1 text-muted-foreground">{p.direction}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-2 rounded border border-border bg-muted/20">
        <div className="font-medium mb-1.5 text-xs">Execution coverage</div>
        <ul className="space-y-1 text-xs">
          <li className={`flex items-center gap-1.5 px-2 py-1 rounded border ${executionClasses}`}>
            {executable ? <Check size={11} /> : <X size={11} />} Browser execution {executable ? "supported" : "unavailable"}
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted text-muted-foreground"><Check size={11} /> Typed graph validation</li>
          {!executable && <li className="flex items-center gap-1.5 px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200"><Check size={11} /> Source export and physical-board testing available</li>}
          <li className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted text-muted-foreground"><X size={11} /> Physical hardware validation</li>
        </ul>
      </div>

      <div className="p-2 rounded border border-border bg-muted/20">
        <div className="font-medium mb-1.5 text-xs">Simulation model</div>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Support</span><span className={`px-1.5 py-0.5 rounded border font-mono ${def.model.support === "behavioral" || def.model.support === "engine-backed" ? "text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20" : "text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20"}`}>{def.model.support}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Family</span><span className="font-mono truncate" title={def.model.family}>{def.model.family}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Model ID</span><span className="font-mono truncate" title={def.model.modelId}>{def.model.modelId}</span></div>
          {def.model.reason && <div className="pt-1 text-muted-foreground leading-snug">{def.model.reason}</div>}
        </div>
      </div>

      <div>
        <div className="font-medium mb-1">Properties</div>
        <pre className="text-[11px] bg-muted p-2 rounded border border-border overflow-auto font-mono">{JSON.stringify(active.properties, null, 2) || "{}"}</pre>
        <div className="text-[11px] text-muted-foreground mt-1 font-mono truncate">{active.id}</div>
      </div>
    </div>
  );
}
