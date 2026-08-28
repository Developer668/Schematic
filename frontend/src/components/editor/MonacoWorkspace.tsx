import Editor from "@monaco-editor/react";
import { useState, useEffect, useRef } from "react";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { useValidationStore, validateFirmwareFiles } from "../../store/useValidationStore.ts";
import { invokeWebMCPTool } from "../../webmcp/tools.ts";
import { Play, Trash2, Copy, FileCode2, Cpu } from "lucide-react";
import { resolveFirmwareBinding } from "../../data/hardware.ts";

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
  const activeId = useSelectionStore((state) => state.activeComponentId);
  const project = useProjectStore((state) => state.project);
  const active = project.components.find((component) => component.id === activeId);
  const selectedBoardId = active?.id;
  const binding = active ? resolveFirmwareBinding(project, active.id) : null;
  const isBoard = binding?.definition?.category === "board";
  const updateFirmware = useProjectStore((state) => state.updateFirmware);
  const [code, setCode] = useState(DEFAULT_SKETCH);
  const [copied, setCopied] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const compile = useValidationStore((state) => state.compile);
  const setCompile = useValidationStore((state) => state.setCompile);
  const setCodeIssues = useValidationStore((state) => state.setCodeIssues);
  const syncingCodeRef = useRef(false);

  const copyCode = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    if (!selectedBoardId || !isBoard) return;
    const target = binding?.target;
    const nextCode = target?.files[0]?.content ?? DEFAULT_SKETCH;
    syncingCodeRef.current = true;
    setCode(nextCode);
    setCodeIssues(validateFirmwareFiles(target?.files ?? [{ name: binding?.targetConfig?.fileName ?? "sketch.ino", content: nextCode }]));
    queueMicrotask(() => { syncingCodeRef.current = false; });
  }, [binding?.target, binding?.targetConfig?.fileName, isBoard, selectedBoardId, setCodeIssues]);

  const handleCodeChange = (value: string) => {
    setCode(value);
    if (!active || !isBoard || syncingCodeRef.current) return;
    const currentProject = useProjectStore.getState().project;
    const currentBinding = resolveFirmwareBinding(currentProject, active.id);
    const currentTarget = currentBinding.target;
    const files = [{ name: currentTarget?.files[0]?.name ?? currentBinding.targetConfig?.fileName ?? "sketch.ino", content: value }];
    updateFirmware(active.id, files, { language: currentTarget?.language ?? currentBinding.targetConfig?.language, boardFqbn: currentBinding.targetConfig?.fqbn ?? currentTarget?.boardFqbn });
    setCodeIssues(validateFirmwareFiles(files));
  };

  const doCompile = async () => {
    if (!active || !isBoard) return;
    const currentProject = useProjectStore.getState().project;
    const currentBinding = resolveFirmwareBinding(currentProject, active.id);
    const currentTarget = currentBinding.target;
    const boardFqbn = currentBinding.targetConfig?.fqbn ?? currentTarget?.boardFqbn;
    setCompiling(true);
    setCompile({ status: boardFqbn ? "checking" : "unavailable", boardFqbn, log: boardFqbn ? "Checking source…" : "No compiler target is mapped for this board.", checkedAt: Date.now() });
    updateFirmware(active.id, [{ name: currentTarget?.files[0]?.name ?? currentBinding.targetConfig?.fileName ?? "sketch.ino", content: code }], { language: currentTarget?.language ?? currentBinding.targetConfig?.language, boardFqbn });
    if (!boardFqbn) {
      setCompiling(false);
      return;
    }
    try {
      await invokeWebMCPTool("firmware.compile", { componentId: active.id, boardFqbn });
    } catch (error) {
      setCompile({ status: "error", boardFqbn, log: JSON.stringify({ success: false, error: (error as Error).message }, null, 2), checkedAt: Date.now() });
    } finally {
      setCompiling(false);
    }
  };

  const isDark = typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true;

  if (!active || !isBoard) {
    return (
      <div className="h-full flex flex-col bg-card">
        <div className="h-8 px-2 flex items-center justify-between border-b border-border bg-muted/20 shrink-0">
          <div className="flex items-center gap-1.5 text-xs"><FileCode2 size={12} className="text-muted-foreground" /><span className="font-medium">Firmware</span><span className="text-muted-foreground hidden sm:inline">· select a board</span></div>
          <button type="button" onClick={() => void copyCode()} className="w-7 h-7 rounded hover:bg-muted flex items-center justify-center text-muted-foreground" title={copied ? "Copied" : "Copy code"} aria-label={copied ? "Code copied" : "Copy code"}>{copied ? <span className="text-[10px] text-emerald-500">✓</span> : <Copy size={11} />}</button>
        </div>
        <div className="flex-1 min-h-[160px] relative"><Editor height="100%" theme={isDark ? "vs-dark" : "light"} language={binding?.targetConfig?.editorLanguage ?? "cpp"} value={code} options={EDITOR_OPTIONS} onChange={(value) => setCode(value ?? "")} /></div>
        <div className="px-2 py-1.5 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">Select a board on canvas to bind firmware.</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="h-8 flex items-center justify-between px-2 border-b border-border bg-muted/20 shrink-0 gap-2">
        <div className="flex items-center gap-1.5 min-w-0"><div className="w-6 h-6 rounded border bg-card flex items-center justify-center shrink-0"><Cpu size={11} /></div><span className="text-xs font-medium truncate">Firmware · {active.id}</span></div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void copyCode()} className="w-7 h-7 rounded border border-border hover:bg-muted flex items-center justify-center" title={copied ? "Copied" : "Copy code"} aria-label={copied ? "Code copied" : "Copy code"}>{copied ? <span className="text-[10px] text-emerald-500">✓</span> : <Copy size={11} />}</button>
          <button type="button" onClick={() => setCompile({ status: "idle" })} className="hidden sm:inline-flex text-xs px-2 py-1 rounded border border-border hover:bg-muted">Clear</button>
          <button type="button" className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium flex items-center gap-1" onClick={() => void doCompile()} disabled={compiling}><Play size={10} className="fill-white" /> {compiling ? "Compiling…" : "Compile"}</button>
        </div>
      </div>
      <div className="flex-1 min-h-[120px] relative"><Editor height="100%" theme={isDark ? "vs-dark" : "light"} language={binding?.targetConfig?.editorLanguage ?? "cpp"} value={code} onChange={(value) => handleCodeChange(value ?? "")} options={EDITOR_OPTIONS} /></div>
      {compile.log && compile.status !== "idle" && (
        <div className="border-t border-border max-h-[140px] flex flex-col shrink-0">
          <div className="h-6 flex items-center justify-between px-2 bg-[#0a0a0a] border-b border-zinc-800"><span className="text-[11px] font-mono text-zinc-400">Output · {compile.status}</span><button type="button" onClick={() => setCompile({ status: "idle" })} className="text-zinc-400 hover:text-white p-1" aria-label="Clear compile output" title="Clear compile output"><Trash2 size={10} /></button></div>
          <pre className="flex-1 overflow-auto text-[11px] bg-[#0a0a0a] text-zinc-100 p-2 font-mono whitespace-pre-wrap break-words">{compile.log}</pre>
        </div>
      )}
    </div>
  );
}
