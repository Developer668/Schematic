import { useProjectStore } from "../../store/useProjectStore.ts";
import { validateProject, useValidationStore } from "../../store/useValidationStore.ts";

export default function ValidationPanel({ embedded = false }: { embedded?: boolean }) {
  const project = useProjectStore((s) => s.project);
  const addComponent = useProjectStore((s) => s.addComponent);
  const { issues, codeIssues, valid, compile, setResult } = useValidationStore();

  const runCheck = () => {
    setResult(validateProject(project));
  };

  const autoFix = (action: string) => {
    if (action === "insert_pullup") addComponent("resistor");
    if (action === "insert_level_shifter") addComponent("level-shifter");
    setResult(validateProject(useProjectStore.getState().project));
  };

  const autoFixAll = () => {
    for (const issue of validateProject(project).issues) if (issue.autoFix) autoFix(issue.autoFix.action);
    setResult(validateProject(useProjectStore.getState().project));
  };

  return (
    <div className={`${embedded ? "border border-border rounded bg-card overflow-hidden" : "p-3 border-t border-border bg-card"}`}>
      <div className={`flex items-center justify-between ${embedded ? "px-2 py-2 bg-muted/20 border-b border-border" : "mb-2"}`}>
        <div className="text-xs font-medium">Validation {valid !== null && <span className={`ml-1 text-[11px] px-1 py-0 rounded border ${valid ? "bg-emerald-500 text-white border-emerald-600" : "bg-red-500 text-white border-red-600"}`}>{valid ? "pass" : "fail"}</span>}</div>
        <div className="flex gap-1">
          <button className="text-xs px-2 py-1 border border-border rounded hover:bg-muted" onClick={runCheck}>Validate</button>
          <button className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90" onClick={autoFixAll}>Auto-fix</button>
        </div>
      </div>

      <div className={embedded ? "p-2" : ""}>
        {valid !== null && (
          <div className={`text-xs px-2 py-1.5 rounded border mb-2 ${valid ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border-emerald-200" : "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border-red-200"}`}>
            {valid ? "No errors — design passes checks." : "Errors found — see issues."}
          </div>
        )}
        <ul className="space-y-1.5">
          {issues.map((iss, i) => (
            <li key={i} className={`px-2 py-2 rounded border text-xs ${iss.severity === "error" ? "bg-red-50 dark:bg-red-950/20 border-red-200 text-red-700 dark:text-red-300" : iss.severity === "warning" ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 text-amber-700 dark:text-amber-300" : "bg-sky-50 dark:bg-sky-950/20 border-sky-200 text-sky-700 dark:text-sky-300"}`}>
              <div className="font-mono text-[11px] font-medium">{iss.code} <span className="ml-1 text-[10px] px-1 py-0 rounded bg-card border border-border">{iss.severity}</span></div>
              <div className="text-xs mt-1 leading-snug">{iss.message}</div>
              {iss.autoFix && <button className="mt-1.5 text-xs px-2 py-1 bg-primary text-primary-foreground rounded" onClick={() => autoFix(iss.autoFix!.action)}>{iss.autoFix.description}</button>}
            </li>
          ))}
          {codeIssues.length > 0 && <li className="pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Firmware diagnostics</li>}
          {codeIssues.map((issue) => (
            <li key={issue.id} className={`rounded border px-2 py-2 text-xs ${issue.severity === "error" ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300" : issue.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300" : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-300"}`}>
              <div className="font-mono text-[11px] font-medium">{issue.code} <span className="ml-1 rounded border border-border bg-card px-1 py-0 text-[10px]">{issue.severity}</span></div>
              <div className="mt-1 leading-snug">{issue.message}</div>
              {(issue.file || issue.line) && <div className="mt-1 font-mono text-[10px] opacity-75">{issue.file ?? "source"}{issue.line ? `:${issue.line}` : ""}</div>}
            </li>
          ))}
          {compile.status !== "idle" && <li className="rounded border border-border bg-muted/20 px-2 py-2 text-xs"><div className="font-medium">Compile · <span className="font-mono">{compile.status}</span></div>{compile.boardFqbn && <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{compile.boardFqbn}</div>}</li>}
          {valid === null && <li className="text-muted-foreground text-xs p-2 rounded border border-dashed border-border bg-muted/20">Click Validate to run checks: voltage, ground, I2C, pull-ups…</li>}
          {valid !== null && issues.length === 0 && codeIssues.length === 0 && <li className="text-muted-foreground text-xs p-2 rounded border border-dashed border-border bg-muted/20">No hardware or firmware diagnostics.</li>}
        </ul>
      </div>
    </div>
  );
}
