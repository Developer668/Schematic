import { useRef, useEffect } from "react";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useWorkspaceStore } from "../../store/useWorkspaceStore.ts";
import { useWebMCPStore } from "../../store/useWebMCPStore.ts";
import { isPreviewRunning, PREVIEW_DISCLAIMER, useBehaviorPreviewStore } from "../../behavior/useBehaviorPreviewStore.ts";
import type { PreviewDiagnostic, PreviewSnapshot } from "../../behavior/previewTypes.ts";
import { getRegisteredToolNames } from "../../webmcp/tools.ts";
import ValidationPanel from "../validation/ValidationPanel.tsx";
import { Terminal, ChevronDown, Trash2, Pause, Play, RotateCcw, Clock3, Activity, AlertTriangle } from "lucide-react";

export default function BottomDock({ collapsed, onToggleCollapse, height }: { collapsed: boolean; onToggleCollapse: () => void; height: number }) {
  const tab = useWorkspaceStore((state) => state.bottomPanel);
  const setTab = useWorkspaceStore((state) => state.setBottomPanel);
  const previewStatus = useBehaviorPreviewStore((state) => state.status);
  const snapshot = useBehaviorPreviewStore((state) => state.snapshot);
  const previewDiagnostics = useBehaviorPreviewStore((state) => state.diagnostics);
  const preparationStatus = useBehaviorPreviewStore((state) => state.preparationStatus);
  const previewDurationMs = useBehaviorPreviewStore((state) => state.durationMs);
  const pausePreview = useBehaviorPreviewStore((state) => state.pausePreview);
  const startPreview = useBehaviorPreviewStore((state) => state.startPreview);
  const resetPreview = useBehaviorPreviewStore((state) => state.resetPreview);
  const seekPreview = useBehaviorPreviewStore((state) => state.seekPreview);
  const project = useProjectStore((s) => s.project);
  const toolNames = getRegisteredToolNames();

  if (collapsed) {
    return (
      <div className="h-8 border-t border-border bg-card flex items-center px-2 gap-1 shrink-0 text-xs">
        <button type="button" onClick={() => { setTab("webmcp"); onToggleCollapse(); }} className="bottom-dock-tab px-2 py-1 rounded hover:bg-muted">WebMCP</button>
        <button type="button" onClick={() => { setTab("terminal"); onToggleCollapse(); }} className="bottom-dock-tab px-2 py-1 rounded hover:bg-muted">Terminal</button>
        <button type="button" onClick={() => { setTab("debug"); onToggleCollapse(); }} className="bottom-dock-tab px-2 py-1 rounded hover:bg-muted">Preview</button>
        <button type="button" onClick={() => { setTab("validation"); onToggleCollapse(); }} className="bottom-dock-tab px-2 py-1 rounded hover:bg-muted">Problems</button>
        <button type="button" onClick={onToggleCollapse} className="ml-auto w-6 h-6 rounded border border-border hover:bg-muted flex items-center justify-center" aria-label="Expand bottom panel" title="Expand bottom panel"><ChevronDown size={12} className="rotate-180" /></button>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-card flex flex-col shrink-0" style={{ height }}>
      <div className="h-8 flex items-center gap-0 px-2 border-b border-border shrink-0">
        <div className="flex items-center gap-0">
          <TabBtn active={tab === "webmcp"} onClick={() => setTab("webmcp")}>WebMCP</TabBtn>
          <TabBtn active={tab === "terminal"} onClick={() => setTab("terminal")}>Terminal</TabBtn>
          <TabBtn active={tab === "debug"} onClick={() => setTab("debug")}>Preview</TabBtn>
          <TabBtn active={tab === "validation"} onClick={() => setTab("validation")}>Problems</TabBtn>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">{project.components.length} comps · {project.connections.length} wires</span>
          <span className="font-mono text-[9px] uppercase tracking-wide">{previewStatus}</span>
          <button type="button" onClick={onToggleCollapse} className="w-6 h-6 rounded hover:bg-muted flex items-center justify-center" aria-label="Collapse bottom panel" title="Collapse bottom panel"><ChevronDown size={12} /></button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-card">
        {tab === "webmcp" && <WebMCPCLI toolNames={toolNames} />}
        {tab === "terminal" && <TerminalTab status={previewStatus} snapshot={snapshot} />}
        {tab === "debug" && <PreviewTimeline status={previewStatus} preparationStatus={preparationStatus} snapshot={snapshot} diagnostics={previewDiagnostics} durationMs={previewDurationMs} onPause={() => void pausePreview()} onPlay={() => void startPreview({ durationMs: previewDurationMs })} onReset={() => void resetPreview()} onSeek={(timeMs) => void seekPreview(timeMs)} />}
        {tab === "validation" && <div className="p-2"><ValidationPanel embedded /></div>}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`bottom-dock-tab text-xs px-3 h-8 border-b-2 -mb-px ${active ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

// Read-only inspector. Native calls come from the browser agent through
// document.modelContext; this panel intentionally has no internal executor.
function WebMCPCLI({ toolNames }: { toolNames: string[] }) {
  const activities = useWebMCPStore((state) => state.activities);
  const registration = useWebMCPStore((state) => state.registration);
  const clearActivities = useWebMCPStore((state) => state.clearActivities);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activities]);

  return (
    <div className="h-full flex flex-col font-mono text-xs">
        <div className="flex-1 overflow-auto p-2 space-y-1.5 bg-[#0a0a0a] text-zinc-100" role="log" aria-live="polite" tabIndex={0} aria-label="WebMCP activity log">
        <div className="rounded border border-zinc-800 p-2 text-zinc-300">
          <div className="text-zinc-100">Native WebMCP: {registration.state}</div>
          <div className="mt-1 text-[11px] text-zinc-400">{registration.registeredCount}/{registration.declaredCount} tools registered · discovery {registration.discovery}</div>
          {registration.error && <div className="mt-1 text-amber-300">{registration.error} Manual editing remains available.</div>}
          <div className="mt-2 text-[11px] text-zinc-500">Invoke through the browser's Available Site Tools or Chrome DevTools WebMCP panel. This page has no shortcut executor.</div>
          <div className="mt-2 break-words text-[10px] text-zinc-500">{toolNames.join(" · ")}</div>
        </div>
        {[...activities].reverse().map((activity) => (
          <div key={activity.id} className="space-y-1.5 border-t border-zinc-800 pt-1.5">
            <div className="flex items-center gap-2">
              <span className={activity.status === "error" ? "text-red-300" : activity.status === "running" ? "text-amber-300" : "text-emerald-400"}>{activity.status === "error" ? "!" : activity.status === "running" ? "·" : "✓"}</span>
              <span className="text-zinc-100 break-all">{activity.name}</span>
              <span className="ml-auto text-[10px] text-zinc-500">{activity.status}{activity.finishedAt ? ` · ${activity.finishedAt - activity.startedAt}ms` : ""}</span>
            </div>
            <pre className={`ml-4 whitespace-pre-wrap break-words text-[11px] leading-relaxed ${activity.status === "error" ? "text-red-300" : "text-zinc-300"}`}>
              {JSON.stringify(activity.args)}{activity.resultText ? `\n${activity.resultText}` : ""}
            </pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-zinc-800 bg-zinc-900 flex items-center gap-2 px-2 py-1.5">
        <span className="text-zinc-400">Activity is produced only by browser-native tool calls.</span>
        <button type="button" onClick={clearActivities} className="ml-auto text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-400" aria-label="Clear WebMCP activity" title="Clear WebMCP activity"><Trash2 size={11} /></button>
      </div>
      <div className="px-2 py-1 border-t border-zinc-800 bg-zinc-900 text-[11px] text-zinc-400 flex items-center gap-3">
        <span>Top-level document.modelContext registration</span>
        <span className="ml-auto">{toolNames.length} tools</span>
      </div>
    </div>
  );
}

function TerminalTab({ status, snapshot }: { status: string; snapshot: PreviewSnapshot | null }) {
  return (
    <div className="h-full flex flex-col font-mono text-xs">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-muted/20 text-xs font-sans">
        <span className="flex items-center gap-1.5"><Terminal size={12} /> Preview session log</span>
        <span className="text-muted-foreground">{status} · {snapshot?.sessionLog.length ?? 0} entries</span>
      </div>
      <div className="flex-1 overflow-auto p-2 bg-[#0a0a0a] text-zinc-100 text-xs" role="log" aria-label="Preview session log">
        {!snapshot || snapshot.sessionLog.length === 0 ? <div className="text-zinc-500 text-xs">No preview actions yet — choose Preview behavior or trigger a typed event.</div> : snapshot.sessionLog.map((entry) => (
          <div key={entry.sequence} className="mb-2 border-b border-zinc-800 pb-2 last:border-0">
            <div className="flex items-center gap-2"><span className={entry.outcome === "accepted" ? "text-emerald-400" : "text-red-300"}>{entry.outcome === "accepted" ? "✓" : "!"}</span><span className="text-zinc-300">{entry.kind}</span><span className="ml-auto text-[10px] text-zinc-500">{entry.logicalTimeMs} ms · #{entry.sequence}</span></div>
            <pre className="ml-4 mt-1 whitespace-pre-wrap break-words text-[11px] text-zinc-400">{JSON.stringify(entry.request, null, 2)}{entry.diagnosticCodes.length ? `\n${entry.diagnosticCodes.join(", ")}` : ""}</pre>
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] leading-snug text-zinc-400">Source code execution: none · accepted and rejected typed actions are replayable.</div>
    </div>
  );
}

function PreviewTimeline({
  status,
  preparationStatus,
  snapshot,
  diagnostics,
  durationMs,
  onPause,
  onPlay,
  onReset,
  onSeek,
}: {
  status: string;
  preparationStatus: "ready" | "partial" | null;
  snapshot: PreviewSnapshot | null;
  diagnostics: readonly PreviewDiagnostic[];
  durationMs: number;
  onPause: () => void;
  onPlay: () => void;
  onReset: () => void;
  onSeek: (timeMs: number) => void;
}) {
  const maxTime = Math.max(durationMs, ...(snapshot?.events ?? []).map((event) => event.logicalTimeMs ?? 0), snapshot?.logicalTimeMs ?? 0);
  const currentTime = Math.min(maxTime, Math.max(0, snapshot?.logicalTimeMs ?? 0));
  const isPlaying = isPreviewRunning(status);
  return (
    <div className="h-full overflow-auto p-2 space-y-2 text-xs">
      <div className="preview-timeline-header flex items-start justify-between gap-3 rounded border border-border bg-muted/20 p-2">
        <div><div className="flex items-center gap-1.5 font-medium"><Activity size={12} /> Behavior Preview <span className="preview-status-dot" aria-hidden="true" /></div><p className="mt-1 text-[11px] leading-snug text-muted-foreground">{PREVIEW_DISCLAIMER}</p></div>
        <span className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase">{status}</span>
      </div>
      {preparationStatus === "partial" && <div className="rounded border border-amber-400/60 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"><strong>Partial plan:</strong> unsupported rules or actions were skipped. Review the preparation diagnostics below before treating this preview as the intended complete outcome.</div>}
      <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-muted/20 p-2">
        <button type="button" onClick={isPlaying ? onPause : onPlay} className="secondary-button !h-7 !px-2" aria-label={isPlaying ? "Pause preview" : "Play preview"}>{isPlaying ? <Pause size={11} /> : <Play size={11} />}{isPlaying ? "Pause" : "Play"}</button>
        <button type="button" onClick={onReset} className="secondary-button !h-7 !px-2" aria-label="Reset preview"><RotateCcw size={11} /> Reset</button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground"><Clock3 size={10} className="mr-1 inline" />{currentTime} / {maxTime} ms</span>
        <label className="sr-only" htmlFor="preview-time-seek">Preview time</label>
        <input id="preview-time-seek" type="range" min={0} max={maxTime} step={1} value={currentTime} onChange={(event) => onSeek(Number(event.target.value))} className="w-full accent-[hsl(var(--accent))]" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-border p-2"><div className="mb-1 font-medium">Session</div><div className="space-y-1 text-[11px] text-muted-foreground"><div className="flex justify-between"><span>Time</span><span className="font-mono text-foreground">{currentTime} ms</span></div><div className="flex justify-between"><span>Actions</span><span className="font-mono text-foreground">{snapshot?.sessionLog.length ?? 0}</span></div><div className="flex justify-between"><span>Sequence</span><span className="font-mono text-foreground">{snapshot?.sequence ?? 0}</span></div><div className="flex justify-between"><span>Source</span><span className="font-mono text-foreground">none</span></div></div></div>
        <div className="rounded border border-border p-2"><div className="mb-1 font-medium">Hashes</div><div className="space-y-1 break-all font-mono text-[10px] text-muted-foreground"><div>snapshot · {snapshot?.snapshotSha256 ?? "—"}</div><div>session · {snapshot?.sessionLogSha256 ?? "—"}</div></div></div>
      </div>
      <div className="rounded border border-border p-2"><div className="mb-1 font-medium">Workflow boundary</div><div className="grid gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2"><BoundaryClaim label="Preview basis" value="Behavior Plan" /><BoundaryClaim label="Source" value="Editable handoff" /><BoundaryClaim label="Build + upload" value="External hardware" /><BoundaryClaim label="Modeled wiring" value="Graph checks" /><BoundaryClaim label="Physical outcome" value="Connected board" /></div></div>
      <div className="rounded border border-border p-2"><div className="mb-1 font-medium">Timeline</div>{!snapshot || snapshot.events.length === 0 ? <div className="text-[11px] text-muted-foreground">No accepted or rejected typed events yet.</div> : <div className="max-h-28 space-y-1 overflow-auto">{snapshot.events.slice(-40).map((event) => <div key={`${event.sequence}-${event.logicalTimeMs}`} className="flex items-start gap-2 rounded bg-muted/30 px-2 py-1 text-[11px]"><span className="shrink-0 font-mono text-muted-foreground">{event.logicalTimeMs ?? 0} ms</span><span className="min-w-0 flex-1 truncate">{event.actionId ?? event.eventId ?? event.kind ?? "event"}{event.message ? ` · ${event.message}` : ""}</span><span className={`shrink-0 font-mono ${event.outcome === "rejected" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{event.outcome ?? "—"}</span></div>)}</div>}</div>
      <div className="rounded border border-border p-2"><div className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle size={12} /> Diagnostics <span className="font-mono text-[10px] text-muted-foreground">{diagnostics.length}</span></div>{diagnostics.length === 0 ? <div className="text-[11px] text-muted-foreground">No Behavior Plan diagnostics.</div> : <div className="space-y-1">{diagnostics.slice(0, 20).map((diagnostic, index) => <div key={`${diagnostic.code}-${index}`} className={`rounded border px-2 py-1 text-[11px] ${diagnostic.severity === "error" ? "border-red-300/60 bg-red-50/70 text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200" : "border-border bg-muted/20 text-muted-foreground"}`}><span className="font-mono">{diagnostic.code}</span> · {diagnostic.message}</div>)}</div>}</div>
      {snapshot && <div className="rounded border border-border p-2"><div className="mb-1 font-medium">Component outcomes</div><div className="max-h-24 space-y-1 overflow-auto">{Object.entries(snapshot.components).map(([componentId, projection]) => <div key={componentId} className="flex items-start gap-2 rounded bg-muted/30 px-2 py-1 text-[11px]"><span className="font-mono text-muted-foreground">{componentId}</span><span>{projection.accessibleSummary}</span></div>)}</div></div>}
    </div>
  );
}

function BoundaryClaim({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-2"><span>{label}</span><span className="font-mono text-foreground">{value}</span></div>;
}
