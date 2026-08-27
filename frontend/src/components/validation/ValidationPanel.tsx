import { useState } from "react";
import { useProjectStore } from "../../store/useProjectStore.ts";

interface Issue { severity: string; code: string; message: string; autoFix?: { description: string; action: string } }

export default function ValidationPanel({ embedded = false }: { embedded?: boolean }) {
  const project = useProjectStore((s) => s.project);
  const addComponent = useProjectStore((s) => s.addComponent);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [valid, setValid] = useState<boolean | null>(null);

  const runCheck = () => {
    const list: Issue[] = [];
    if (project.components.length === 0) list.push({ severity: "warning", code: "NO_COMPONENTS", message: "Project is empty — add a board and sensor from the left panel." });
    if (project.connections.length === 0 && project.components.length > 1) list.push({ severity: "warning", code: "NO_CONNECTIONS", message: "Multiple components but no wires — drag between ports on the canvas." });
    const has5v = project.components.some((c) => c.definitionId.includes("arduino-uno"));
    const hasBmp = project.components.some((c) => c.definitionId === "bmp280");
    if (has5v && hasBmp) {
      const hasShifter = project.components.some((c) => c.definitionId.includes("level-shifter"));
      if (!hasShifter) list.push({ severity: "warning", code: "VOLTAGE_MISMATCH", message: "BMP280 is 3.3V max but Arduino Uno is 5V — insert a level shifter.", autoFix: { description: "Insert level shifter", action: "insert_level_shifter" } });
    }
    const needsPullup = project.components.some((c) => ["bmp280", "ssd1306"].includes(c.definitionId));
    const hasPullup = project.components.some((c) => c.definitionId.includes("resistor"));
    if (needsPullup && !hasPullup) list.push({ severity: "warning", code: "MISSING_PULLUP", message: "I2C bus missing pull-up resistors (4.7k to VCC on SDA/SCL).", autoFix: { description: "Add 4.7k pull-ups", action: "insert_pullup" } });
    const hasBoard = project.components.some((c) => ["arduino", "esp32", "pi", "pico"].some(k => c.definitionId.includes(k)));
    if (!hasBoard && project.components.length > 0) list.push({ severity: "info", code: "NO_BOARD", message: "No microcontroller board detected — firmware has no target." });
    setIssues(list);
    setValid(list.filter((i) => i.severity === "error").length === 0);
  };

  const autoFix = (action: string) => {
    if (action === "insert_pullup") addComponent("resistor");
    if (action === "insert_level_shifter") addComponent("level-shifter");
  };

  return (
    <div className={`${embedded ? "border border-border rounded bg-card overflow-hidden" : "p-3 border-t border-border bg-card"}`}>
      <div className={`flex items-center justify-between ${embedded ? "px-2 py-2 bg-muted/20 border-b border-border" : "mb-2"}`}>
        <div className="text-xs font-medium">Validation {valid !== null && <span className={`ml-1 text-[11px] px-1 py-0 rounded border ${valid ? "bg-emerald-500 text-white border-emerald-600" : "bg-red-500 text-white border-red-600"}`}>{valid ? "pass" : "fail"}</span>}</div>
        <div className="flex gap-1">
          <button className="text-xs px-2 py-1 border border-border rounded hover:bg-muted" onClick={runCheck}>Validate</button>
          <button className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90" onClick={() => runCheck()}>Auto-fix</button>
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
          {valid === null && <li className="text-muted-foreground text-xs p-2 rounded border border-dashed border-border bg-muted/20">Click Validate to run checks: voltage, ground, I2C, pull-ups…</li>}
        </ul>
      </div>
    </div>
  );
}
