import { useState, useEffect, useRef } from "react";
import { AlertCircle, FileArchive, Loader2, UploadCloud, X } from "lucide-react";
import { apiUrl, getAuthHeaders } from "../../auth/session.ts";

interface Step { step: number; label: string; status: string; detail?: string }
type Analysis = { engines: string[]; fidelity: Record<string, boolean>; steps: Step[] };

export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onClose]);

  const doAnalyze = async () => {
    if (!files.length) return;
    setLoading(true); setError(null); setAnalysis(null);
    try {
      const headers = new Headers(await getAuthHeaders());
      headers.set("Content-Type", "application/json");
      const response = await fetch(apiUrl("/api/components/import/analyze"), { method: "POST", headers, credentials: "include", body: JSON.stringify({ filenames: files.map((file) => file.name), fileSizes: files.map((file) => file.size) }) });
      if (!response.ok) throw new Error(`Import analysis failed (${response.status})`);
      setAnalysis(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import service is unavailable. No component was modified.");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"><div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4"><div><h2 id="import-title" className="text-base font-semibold">Import hardware assets</h2><p className="mt-1 text-xs text-muted-foreground">Analyze real model files before adding anything to the catalog.</p></div><button ref={closeRef} type="button" className="workspace-icon-button" aria-label="Close import" onClick={onClose}><X size={14} /></button></div>
        <div className="text-xs leading-relaxed text-muted-foreground">Supported inputs include SPICE, IBIS, Touchstone, Verilog, firmware binaries, CMSIS packs, FMUs, STEP, and glTF/GLB geometry.</div>
        <label className="import-dropzone"><UploadCloud size={22} /><strong>Choose model files</strong><span>Multiple files are supported. Analysis does not mutate the project.</span><input type="file" multiple className="sr-only" onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setAnalysis(null); setError(null); }} /></label>
        {files.length > 0 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{files.map((file) => <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-md border border-border bg-muted/25 p-2 text-xs"><FileArchive size={14} className="text-muted-foreground"/><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="font-mono text-[10px] text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span></div>)}</div>}
        {error && <div className="flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-500"><AlertCircle size={14}/>{error}</div>}
        {analysis && <div className="rounded-lg border border-border bg-muted/15 p-3 text-xs"><div className="font-medium">Compatible engines</div><div className="mt-1 text-muted-foreground">{analysis.engines.join(", ") || "No executable engine mapping detected"}</div>{analysis.steps.length > 0 && <ol className="mt-3 space-y-1 border-t border-border pt-3">{analysis.steps.map((item) => <li key={item.step} className="flex gap-2"><span className="font-mono text-muted-foreground">{item.step}.</span><span>{item.label}</span>{item.detail && <span className="text-muted-foreground">— {item.detail}</span>}</li>)}</ol>}</div>}
        <button type="button" disabled={!files.length || loading} className="run-button w-full disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void doAnalyze()}>{loading ? <><Loader2 size={13} className="animate-spin"/>Analyzing files</> : "Analyze selected files"}</button>
      </div></div>
    </div>
  );
}
