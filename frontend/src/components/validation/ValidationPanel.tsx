import { useProjectStore } from "../../store/useProjectStore.ts";
import { validateProject, useValidationStore } from "../../store/useValidationStore.ts";

export default function ValidationPanel({ embedded = false }: { embedded?: boolean }) {
  const project = useProjectStore((s) => s.project);
  const { issues, valid, setResult } = useValidationStore();

  const runCheck = () => {
    setResult(validateProject(project));
  };

  return (
    <div className={`${embedded ? "border border-border rounded bg-card overflow-hidden" : "p-3 border-t border-border bg-card"}`}>
      <div className={`flex items-center justify-between ${embedded ? "px-2 py-2 bg-muted/20 border-b border-border" : "mb-2"}`}>
        <div className="text-xs font-medium">Graph checks {valid !== null && <span className={`ml-1 text-[11px] px-1 py-0 rounded border ${valid ? "bg-emerald-500 text-white border-emerald-600" : "bg-red-500 text-white border-red-600"}`}>{valid ? "pass" : "fail"}</span>}</div>
        <div className="flex gap-1">
          <button type="button" className="text-xs px-2 py-1 border border-border rounded hover:bg-muted" onClick={runCheck}>Run graph checks</button>
        </div>
      </div>

      <div className={embedded ? "p-2" : ""}>
        {valid !== null && (
          <div className={`text-xs px-2 py-1.5 rounded border mb-2 ${valid ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border-emerald-200" : "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border-red-200"}`}>
            {valid ? "Graph checks pass for modeled wiring and component constraints. Physical wiring, hardware behavior, and editable source remain unverified." : "Graph checks found rule conflicts. Physical wiring, hardware behavior, and editable source remain unverified."}
          </div>
        )}
        <ul className="space-y-1.5">
          {issues.map((iss, i) => (
            <li key={i} className={`px-2 py-2 rounded border text-xs ${iss.severity === "error" ? "bg-red-50 dark:bg-red-950/20 border-red-200 text-red-700 dark:text-red-300" : iss.severity === "warning" ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 text-amber-700 dark:text-amber-300" : "bg-sky-50 dark:bg-sky-950/20 border-sky-200 text-sky-700 dark:text-sky-300"}`}>
              <div className="font-mono text-[11px] font-medium">{iss.code} <span className="ml-1 text-[10px] px-1 py-0 rounded bg-card border border-border">{iss.severity}</span></div>
              <div className="text-xs mt-1 leading-snug">{iss.message}</div>
            </li>
          ))}
          {valid === null && <li className="text-muted-foreground text-xs p-2 rounded border border-dashed border-border bg-muted/20">Run graph checks to inspect typed wiring and component constraints. Physical wiring, hardware behavior, and editable source remain unverified.</li>}
          {valid !== null && issues.length === 0 && <li className="text-muted-foreground text-xs p-2 rounded border border-dashed border-border bg-muted/20">No graph-rule conflicts reported. Physical wiring, hardware behavior, and editable source remain unverified; source remains editable in Code.</li>}
        </ul>
      </div>
    </div>
  );
}
