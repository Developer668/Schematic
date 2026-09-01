import { useState, useEffect, useRef } from "react";
import { AlertCircle, Boxes, Check, FileArchive, FileJson, Loader2, UploadCloud, X } from "lucide-react";
import { apiUrl, getAuthHeaders } from "../../auth/session.ts";
import { useProjectStore, type HardwareGraph } from "../../store/useProjectStore.ts";
import { parseSchematicProjectFile } from "../../utils/vllxFile.ts";

interface Step { step: number; label: string; status: string; detail?: string }
type Analysis = { engines: string[]; fidelity: Record<string, boolean>; steps: Step[] };

export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"project" | "models">("project");
  const [files, setFiles] = useState<File[]>([]);
  const [projectFile, setProjectFile] = useState<File | null>(null);
  const [projectPreview, setProjectPreview] = useState<HardwareGraph | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const projectReadGenerationRef = useRef(0);
  const analysisGenerationRef = useRef(0);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const loading = projectLoading || analysisLoading;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, [onClose]);

  useEffect(() => () => {
    projectReadGenerationRef.current += 1;
    analysisGenerationRef.current += 1;
    analysisAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onClose]);

  const chooseProjectFile = async (file: File | null) => {
    const generation = ++projectReadGenerationRef.current;
    setProjectFile(file);
    setProjectPreview(null);
    setError(null);
    setProjectLoading(Boolean(file));
    if (!file) return;
    try {
      const preview = await parseSchematicProjectFile(file);
      if (projectReadGenerationRef.current === generation) setProjectPreview(preview);
    } catch (cause) {
      if (projectReadGenerationRef.current === generation) {
        setError(cause instanceof Error ? cause.message : "The project file could not be read.");
      }
    } finally {
      if (projectReadGenerationRef.current === generation) setProjectLoading(false);
    }
  };

  const doImportProject = () => {
    if (!projectPreview) return;
    useProjectStore.getState().importProject(projectPreview);
    onClose();
  };

  const chooseModelFiles = (nextFiles: File[]) => {
    analysisGenerationRef.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setAnalysisLoading(false);
    setFiles(nextFiles);
    setAnalysis(null);
    setError(null);
  };

  const doAnalyze = async () => {
    if (!files.length) return;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    const generation = ++analysisGenerationRef.current;
    const selectedFiles = files;
    analysisAbortRef.current = controller;
    setAnalysisLoading(true); setError(null); setAnalysis(null);
    try {
      const headers = new Headers(await getAuthHeaders(false, controller.signal));
      headers.set("Content-Type", "application/json");
      const response = await fetch(apiUrl("/api/components/import/analyze"), { method: "POST", headers, credentials: "include", signal: controller.signal, body: JSON.stringify({ filenames: selectedFiles.map((file) => file.name), fileSizes: selectedFiles.map((file) => file.size) }) });
      if (!response.ok) throw new Error(`Import analysis failed (${response.status})`);
      const result = await response.json() as Analysis;
      if (analysisGenerationRef.current === generation && !controller.signal.aborted) setAnalysis(result);
    } catch (cause) {
      if (analysisGenerationRef.current === generation && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "The import service is unavailable. No component was modified.");
      }
    } finally {
      if (analysisGenerationRef.current === generation) {
        analysisAbortRef.current = null;
        setAnalysisLoading(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div ref={dialogRef} aria-busy={loading} className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"><div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4"><div><h2 id="import-title" className="text-base font-semibold">Import into Schematic</h2><p className="mt-1 text-xs text-muted-foreground">Open a project or check hardware model compatibility.</p></div><button ref={closeRef} type="button" className="workspace-icon-button" aria-label="Close import" onClick={onClose}><X size={14} /></button></div>

        <div role="tablist" aria-label="Import type" className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <button type="button" role="tab" aria-selected={mode === "project"} onClick={() => { analysisGenerationRef.current += 1; analysisAbortRef.current?.abort(); analysisAbortRef.current = null; setAnalysisLoading(false); setMode("project"); setError(null); }} className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${mode === "project" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><FileJson size={13} /> Project file</button>
          <button type="button" role="tab" aria-selected={mode === "models"} onClick={() => { projectReadGenerationRef.current += 1; setProjectLoading(false); setMode("models"); setError(null); }} className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${mode === "models" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><Boxes size={13} /> Hardware models</button>
        </div>

        {mode === "project" ? (
          <div role="tabpanel" aria-busy={projectLoading} className="space-y-4">
            <p className="text-xs leading-relaxed text-muted-foreground">Import a Schematic <code className="rounded bg-muted px-1 py-0.5">.vlx</code> file or a legacy project JSON. The project opens as a new copy; your current project is not replaced.</p>
            <label className="import-dropzone focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"><UploadCloud size={22} /><strong>Choose a project file</strong><span>.vlx or legacy .json · one file</span><input type="file" accept=".vlx,.json,application/json" className="sr-only" onChange={(event) => void chooseProjectFile(event.target.files?.[0] ?? null)} /></label>
            {projectFile && <div className="flex items-center gap-2 rounded-md border border-border bg-muted/25 p-2 text-xs"><FileJson size={14} className="text-muted-foreground"/><span className="min-w-0 flex-1 truncate">{projectFile.name}</span><span className="font-mono text-[10px] text-muted-foreground">{Math.ceil(projectFile.size / 1024)} KB</span></div>}
            {projectPreview && <div role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs"><div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300"><Check size={13} /> Ready to import “{projectPreview.name}”</div><div className="mt-2 font-mono text-[10px] text-muted-foreground">{projectPreview.components.length} components · {projectPreview.connections.length} connections · {projectPreview.firmwareTargets?.length ?? 0} firmware targets</div></div>}
            {error && <div className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300" role="alert"><AlertCircle size={14} className="mt-0.5 shrink-0"/><span>{error}</span></div>}
            <button type="button" disabled={!projectPreview || projectLoading} className="run-button h-9 w-full disabled:cursor-not-allowed disabled:opacity-40" onClick={doImportProject}>{projectLoading ? <><Loader2 size={13} className="animate-spin"/>Reading project</> : "Import as new project"}</button>
          </div>
        ) : (
          <div role="tabpanel" aria-busy={analysisLoading} className="space-y-4">
            <p className="text-xs leading-relaxed text-muted-foreground">Check whether SPICE, IBIS, Touchstone, Verilog, firmware, CMSIS, FMU, STEP, or glTF/GLB files map to available engines. This analysis does not change the component catalog.</p>
            <label className="import-dropzone focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"><UploadCloud size={22} /><strong>Choose model files</strong><span>Multiple files are supported. Analysis does not mutate the project.</span><input type="file" multiple className="sr-only" onChange={(event) => chooseModelFiles(Array.from(event.target.files ?? []))} /></label>
            {files.length > 0 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{files.map((file) => <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-md border border-border bg-muted/25 p-2 text-xs"><FileArchive size={14} className="text-muted-foreground"/><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="font-mono text-[10px] text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span></div>)}</div>}
            {error && <div className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300" role="alert"><AlertCircle size={14} className="mt-0.5 shrink-0"/><span>{error}</span></div>}
            {analysis && <div role="status" className="rounded-lg border border-border bg-muted/15 p-3 text-xs"><div className="font-medium">Compatible engines</div><div className="mt-1 text-muted-foreground">{analysis.engines.join(", ") || "No executable engine mapping detected"}</div>{analysis.steps.length > 0 && <ol className="mt-3 space-y-1 border-t border-border pt-3">{analysis.steps.map((item) => <li key={item.step} className="flex gap-2"><span className="font-mono text-muted-foreground">{item.step}.</span><span>{item.label}</span>{item.detail && <span className="text-muted-foreground">— {item.detail}</span>}</li>)}</ol>}</div>}
            <button type="button" disabled={!files.length || analysisLoading} className="run-button h-9 w-full disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void doAnalyze()}>{analysisLoading ? <><Loader2 size={13} className="animate-spin"/>Analyzing files</> : "Check selected files"}</button>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{projectLoading ? "Reading the selected project file." : analysisLoading ? "Analyzing the selected hardware model files." : projectPreview ? `Project ${projectPreview.name} is ready to import.` : analysis ? "Hardware model analysis is complete." : ""}</div>
      </div></div>
    </div>
  );
}
