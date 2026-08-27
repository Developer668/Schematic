import Editor from "@monaco-editor/react";
import { useState, useEffect } from "react";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { Play, Trash2, Copy, FileCode2, Cpu } from "lucide-react";

const DEFAULT_SKETCH = `// Schematic — agent and human share this workspace
#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("Hello from Schematic!");
  delay(1000);
  digitalWrite(13, LOW);
  delay(1000);
}
`;

const EDITOR_OPTIONS = {
  minimap: { enabled: false }, fontSize: 12, lineHeight: 18,
  lineNumbersMinChars: 2, glyphMargin: false, lineDecorationsWidth: 4,
  folding: false, overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
  scrollBeyondLastLine: false, padding: { top: 8, bottom: 8 },
  fontFamily: "JetBrains Mono, monospace",
};

export default function MonacoWorkspace() {
  const activeId = useSelectionStore((s) => s.activeComponentId);
  const project = useProjectStore((s) => s.project);
  const active = project.components.find((c) => c.id === activeId);
  const isBoard = active?.definitionId.includes("arduino") || active?.definitionId.includes("esp32") || active?.definitionId.includes("pi") || active?.definitionId.includes("pico");
  const [code, setCode] = useState(DEFAULT_SKETCH);
  const [compileLog, setCompileLog] = useState("");
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    if (active && isBoard) {
      const tgt = project.firmwareTargets.find((f) => f.componentId === active.id);
      if (tgt?.files[0]?.content) setCode(tgt.files[0].content);
    }
  }, [active, activeId, isBoard, project.firmwareTargets]);

  const doCompile = async () => {
    setCompiling(true);
    setCompileLog("");
    const boardFqbn = active?.definitionId.includes("esp32") ? "esp32:esp32:esp32" : active?.definitionId.includes("pico") ? "rp2040:rp2040:rpipico" : "arduino:avr:uno";
    const tgtId = active?.id ?? "sketch";
    const proj = useProjectStore.getState().project;
    const existing = proj.firmwareTargets.find((f) => f.componentId === tgtId);
    if (existing) {
      existing.files = [{ name: "sketch.ino", content: code }];
      useProjectStore.getState().loadProject({ ...proj, firmwareTargets: proj.firmwareTargets.map((f) => (f.componentId === tgtId ? existing : f)) });
    } else if (active) {
      useProjectStore.getState().loadProject({ ...proj, firmwareTargets: [...proj.firmwareTargets, { id: `fw-${tgtId}`, componentId: tgtId, files: [{ name: "sketch.ino", content: code }] }] });
    }
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [{ name: "sketch.ino", content: code }], board_fqbn: boardFqbn }),
      }).then((r) => r.json());
      setCompileLog(JSON.stringify(res, null, 2));
    } catch (e) {
      const msg = (e as Error).message;
      setCompileLog(JSON.stringify({ success: false, error: msg, hint: "Backend offline" }, null, 2));
    } finally {
      setCompiling(false);
    }
  };

  const isDark = typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true;

  if (!active || !isBoard) {
    return (
      <div className="h-full flex flex-col bg-card">
        <div className="h-8 px-2 flex items-center justify-between border-b border-border bg-muted/20 shrink-0">
          <div className="flex items-center gap-1.5 text-xs">
            <FileCode2 size={12} className="text-muted-foreground" />
            <span className="font-medium">Firmware</span>
            <span className="text-muted-foreground hidden sm:inline">· select a board</span>
          </div>
          <button onClick={() => navigator.clipboard.writeText(code)} className="w-6 h-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground" title="Copy"><Copy size={11} /></button>
        </div>
        <div className="flex-1 min-h-[160px] relative">
          <Editor height="100%" theme={isDark ? "vs-dark" : "light"} defaultLanguage="cpp" value={code} options={EDITOR_OPTIONS} onChange={(v) => setCode(v ?? "")} />
        </div>
        <div className="px-2 py-1.5 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">Select a board on canvas to bind firmware.</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="h-8 flex items-center justify-between px-2 border-b border-border bg-muted/20 shrink-0 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-6 h-6 rounded border bg-card flex items-center justify-center shrink-0"><Cpu size={11} /></div>
          <span className="text-xs font-medium truncate">Firmware · {active.id}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => navigator.clipboard.writeText(code)} className="w-6 h-6 rounded border border-border hover:bg-muted flex items-center justify-center"><Copy size={11} /></button>
          <button onClick={() => setCompileLog("")} className="hidden sm:inline-flex text-xs px-2 py-1 rounded border border-border hover:bg-muted">Clear</button>
          <button className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium flex items-center gap-1" onClick={doCompile} disabled={compiling}>
            <Play size={10} className="fill-white" /> {compiling ? "Compiling…" : "Compile"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-[120px] relative">
        <Editor height="100%" theme={isDark ? "vs-dark" : "light"} defaultLanguage="cpp" value={code} onChange={(v) => setCode(v ?? "")} options={EDITOR_OPTIONS} />
      </div>

      {compileLog && (
        <div className="border-t border-border max-h-[140px] flex flex-col shrink-0">
          <div className="h-6 flex items-center justify-between px-2 bg-[#0a0a0a] border-b border-zinc-800">
            <span className="text-[11px] font-mono text-zinc-400">Output</span>
            <button onClick={() => setCompileLog("")} className="text-zinc-400 hover:text-white p-1"><Trash2 size={10} /></button>
          </div>
          <pre className="flex-1 overflow-auto text-[11px] bg-[#0a0a0a] text-zinc-100 p-2 font-mono whitespace-pre-wrap break-words">{compileLog}</pre>
        </div>
      )}
    </div>
  );
}
