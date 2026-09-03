import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Braces,
  Boxes,
  Check,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  Eraser,
  ListChecks,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useWorkspaceStore } from "../../store/useWorkspaceStore.ts";
import { useWebMCPStore } from "../../store/useWebMCPStore.ts";
import {
  isPreviewRunning,
  PREVIEW_DISCLAIMER,
  useBehaviorPreviewStore,
} from "../../behavior/useBehaviorPreviewStore.ts";
import type {
  PreviewDiagnostic,
  PreviewSnapshot,
} from "../../behavior/previewTypes.ts";
import { getRegisteredToolNames } from "../../webmcp/tools.ts";
import { createStarterPlanAndPreview } from "../../behavior/starterPlan.ts";
import ValidationPanel from "../validation/ValidationPanel.tsx";

type DockTab = "webmcp" | "terminal" | "debug" | "validation";

const tabLabels: Record<DockTab, { label: string; icon: typeof Braces }> = {
  webmcp: { label: "WebMCP", icon: Braces },
  terminal: { label: "Terminal", icon: Terminal },
  debug: { label: "Outcome", icon: Activity },
  validation: { label: "Problems", icon: ListChecks },
};

export default function BottomDock({
  collapsed,
  onToggleCollapse,
  height,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  height: number;
}) {
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
  const previewError = useBehaviorPreviewStore((state) => state.error);
  const project = useProjectStore((state) => state.project);
  const toolNames = getRegisteredToolNames();

  const selectTab = (next: DockTab) => {
    setTab(next);
    if (collapsed) onToggleCollapse();
  };

  if (collapsed) {
    return (
      <div className="bottom-dock-collapsed">
        {(Object.keys(tabLabels) as DockTab[]).map((key) => {
          const Icon = tabLabels[key].icon;
          return (
            <button type="button" key={key} onClick={() => selectTab(key)}>
              <Icon size={12} />
              <span>{tabLabels[key].label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="bottom-dock-expand"
          aria-label="Expand bottom panel"
          title="Expand bottom panel"
        >
          <ChevronDown size={13} className="rotate-180" />
        </button>
      </div>
    );
  }

  return (
    <div className="bottom-dock-redesign" style={{ height }}>
      <div className="bottom-dock-header">
        <div className="bottom-dock-tabs" role="tablist" aria-label="Workspace tools">
          {(Object.keys(tabLabels) as DockTab[]).map((key) => {
            const Icon = tabLabels[key].icon;
            return (
              <DockTabButton
                key={key}
                active={tab === key}
                onClick={() => setTab(key)}
                icon={<Icon size={12} />}
              >
                {tabLabels[key].label}
              </DockTabButton>
            );
          })}
        </div>
        <div className="bottom-dock-context">
          <span>{project.components.length} components</span>
          <span>{project.connections.length} wires</span>
          <span className="bottom-dock-preview-state">{previewStatus}</span>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse bottom panel"
            title="Collapse bottom panel"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      <div className="bottom-dock-content">
        {tab === "webmcp" && <WebMCPCLI toolNames={toolNames} />}
        {tab === "terminal" && <TerminalTab status={previewStatus} snapshot={snapshot} />}
        {tab === "debug" && (
          <PreviewTimeline
            status={previewStatus}
            preparationStatus={preparationStatus}
            snapshot={snapshot}
            diagnostics={previewDiagnostics}
            durationMs={previewDurationMs}
            onPause={() => void pausePreview()}
            onPlay={() => void startPreview({ durationMs: previewDurationMs })}
            onReset={() => void resetPreview()}
            onSeek={(timeMs) => void seekPreview(timeMs)}
            blockedMessage={previewStatus === "blocked" ? previewError : null}
            onCreatePlan={() => createStarterPlanAndPreview()}
          />
        )}
        {tab === "validation" && (
          <div className="dock-problems">
            <ValidationPanel embedded />
          </div>
        )}
      </div>
    </div>
  );
}

function DockTabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={active ? "is-active" : ""}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

type CommandEntry = { cmd: string; out: string; isError?: boolean };

function WebMCPCLI({ toolNames }: { toolNames: string[] }) {
  const [history, setHistory] = useState<CommandEntry[]>([]);
  const [input, setInput] = useState("");
  const activities = useWebMCPStore((state) => state.activities);
  const clearActivities = useWebMCPStore((state) => state.clearActivities);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const firstToken = input.trimStart().split(/\s/, 1)[0] ?? "";
  const suggestions =
    firstToken && !input.includes(" ")
      ? toolNames
          .filter((toolName) => toolName.toLowerCase().includes(firstToken.toLowerCase()))
          .slice(0, 7)
      : [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [activities, history]);

  const run = async () => {
    const raw = input.trim();
    if (!raw) return;

    if (raw === "clear") {
      setHistory([]);
      clearActivities();
      setInput("");
      return;
    }

    if (raw === "help" || raw === "list" || raw === "tools") {
      setHistory((current) => [...current, { cmd: raw, out: toolNames.join("\n") }]);
      setInput("");
      return;
    }

    const firstSpace = raw.indexOf(" ");
    let name = raw;
    let args: Record<string, unknown> = {};

    if (firstSpace !== -1) {
      name = raw.slice(0, firstSpace).trim();
      const rest = raw.slice(firstSpace + 1).trim();
      if (rest) {
        try {
          const parsed: unknown = JSON.parse(rest);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Arguments must be a JSON object.");
          }
          args = parsed as Record<string, unknown>;
        } catch (error) {
          setHistory((current) => [
            ...current,
            {
              cmd: raw,
              out: error instanceof Error
                ? `Invalid arguments: ${error.message}`
                : "Invalid JSON arguments.",
              isError: true,
            },
          ]);
          setInput("");
          return;
        }
      }
    }

    const registry = (window as typeof window & {
      __schematicTools?: Record<string, (args: Record<string, unknown>) => Promise<{
        content?: Array<{ type?: string; text?: string }>;
        data?: unknown;
        isError?: boolean;
      }>>;
    }).__schematicTools;
    const tool = registry?.[name];

    if (!tool) {
      const suggestion = toolNames.find(
        (toolName) => toolName.includes(name) || name.includes(toolName.split(".").pop() ?? ""),
      );
      setHistory((current) => [
        ...current,
        {
          cmd: raw,
          out: `Unknown tool “${name}”.${suggestion ? ` Try “${suggestion}”.` : " Type “tools” to see the available commands."}`,
          isError: true,
        },
      ]);
      setInput("");
      return;
    }

    try {
      const result = await tool(args);
      const text = result.content
        ?.filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n");
      const output = text || (result.data ? JSON.stringify(result.data, null, 2) : "Tool completed.");
      setHistory((current) => [
        ...current,
        { cmd: raw, out: output, isError: Boolean(result.isError) },
      ]);
    } catch (error) {
      setHistory((current) => [
        ...current,
        {
          cmd: raw,
          out: `Tool failed: ${(error as Error).message}`,
          isError: true,
        },
      ]);
    }

    setInput("");
  };

  const clearAll = () => {
    setHistory([]);
    clearActivities();
    inputRef.current?.focus();
  };

  const empty = history.length === 0 && activities.length === 0;

  return (
    <div className="dock-console dock-webmcp">
      <div className="dock-console-log" role="log" aria-live="polite" tabIndex={0} aria-label="WebMCP activity log">
        {empty && (
          <div className="dock-console-empty">
            <Braces size={18} />
            <div>
              <b>Run a workspace tool</b>
              <p>Type a tool name with a JSON object. The output below comes from the live workspace registry.</p>
            </div>
            <div className="dock-console-samples">
              {toolNames.slice(0, 4).map((toolName) => (
                <button
                  type="button"
                  key={toolName}
                  onClick={() => {
                    setInput(`${toolName} `);
                    inputRef.current?.focus();
                  }}
                >
                  {toolName}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((entry, index) => (
          <div key={`${entry.cmd}-${index}`} className="dock-command-entry">
            <div className="dock-command-line">
              <ChevronDown size={11} className="-rotate-90" />
              <span>{entry.cmd}</span>
            </div>
            <pre className={entry.isError ? "is-error" : ""}>{entry.out}</pre>
          </div>
        ))}

        {[...activities].reverse().map((activity) => (
          <div key={activity.id} className="dock-command-entry is-activity">
            <div className="dock-command-line">
              {activity.status === "running" ? (
                <LoaderCircle size={11} className="animate-spin" />
              ) : activity.status === "error" ? (
                <TriangleAlert size={11} />
              ) : (
                <Check size={11} />
              )}
              <span>{activity.name}</span>
              <small>
                {activity.status}
                {activity.finishedAt ? ` · ${activity.finishedAt - activity.startedAt} ms` : ""}
              </small>
            </div>
            <pre className={activity.status === "error" ? "is-error" : ""}>
              {JSON.stringify(activity.args)}
              {activity.resultText ? `\n${activity.resultText}` : ""}
            </pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {suggestions.length > 0 && (
        <div className="dock-console-suggestions" role="listbox" aria-label="Tool suggestions">
          {suggestions.map((toolName) => (
            <button
              type="button"
              role="option"
              key={toolName}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setInput(`${toolName} `);
                inputRef.current?.focus();
              }}
            >
              {toolName}
            </button>
          ))}
        </div>
      )}

      <div className="dock-console-input">
        <Braces size={13} />
        <input
          ref={inputRef}
          value={input}
          aria-label="WebMCP command"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void run();
            if (event.key === "Tab" && suggestions[0]) {
              event.preventDefault();
              setInput(`${suggestions[0]} `);
            }
            if (event.key === "Escape") setInput("");
          }}
          placeholder='component.search {"query":"esp32"}'
        />
        <button type="button" onClick={() => void run()} aria-label="Run WebMCP command" title="Run command">
          <CornerDownLeft size={13} />
        </button>
        <button type="button" onClick={clearAll} aria-label="Clear WebMCP output" title="Clear output">
          <Eraser size={13} />
        </button>
      </div>

      <div className="dock-console-footer">
        <span>Enter to run</span>
        <span>Tab to complete</span>
        <span>{toolNames.length} tools</span>
      </div>
    </div>
  );
}

function TerminalTab({
  status,
  snapshot,
}: {
  status: string;
  snapshot: PreviewSnapshot | null;
}) {
  const entries = snapshot?.sessionLog ?? [];

  return (
    <div className="dock-console">
      <div className="dock-terminal-heading">
        <span><Terminal size={13} /> Preview activity</span>
        <span>{status} · {entries.length} entries</span>
      </div>
      <div className="dock-console-log" role="log" aria-label="Preview session log">
        {entries.length === 0 ? (
          <div className="dock-console-empty is-compact">
            <Terminal size={17} />
            <div>
              <b>No preview activity yet</b>
              <p>Start the project preview or use a typed control in the Inspector.</p>
            </div>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.sequence} className="dock-command-entry">
              <div className="dock-command-line">
                {entry.outcome === "accepted" ? <Check size={11} /> : <TriangleAlert size={11} />}
                <span>{entry.kind}</span>
                <small>{entry.logicalTimeMs} ms · {entry.sequence}</small>
              </div>
              <pre className={entry.outcome === "accepted" ? "" : "is-error"}>
                {JSON.stringify(entry.request, null, 2)}
                {entry.diagnosticCodes.length ? `\n${entry.diagnosticCodes.join(", ")}` : ""}
              </pre>
            </div>
          ))
        )}
      </div>
      <div className="dock-console-footer">
        <span>Typed preview activity only</span>
        <span>Source is not executed here</span>
      </div>
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
  blockedMessage,
  onCreatePlan,
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
  blockedMessage: string | null;
  onCreatePlan: () => Promise<string | null>;
}) {
  const maxTime = Math.max(
    durationMs,
    ...(snapshot?.events ?? []).map((event) => event.logicalTimeMs ?? 0),
    snapshot?.logicalTimeMs ?? 0,
  );
  const currentTime = Math.min(maxTime, Math.max(0, snapshot?.logicalTimeMs ?? 0));
  const isPlaying = isPreviewRunning(status);

  return (
    <div className="outcome-workbench">
      <header className="outcome-workbench-header">
        <div className="outcome-title-block">
          <span className="outcome-title-icon"><Activity size={14} /></span>
          <span>
            <b>Outcome timeline</b>
            <small>{PREVIEW_DISCLAIMER}</small>
          </span>
        </div>
        <span className="outcome-status-label">{status}</span>
      </header>

      {preparationStatus === "partial" && (
        <div className="outcome-warning outcome-workbench-warning">
          <AlertTriangle size={14} />
          <span>Some unsupported rules or actions were skipped. Review the diagnostics before using this as the complete intended outcome.</span>
        </div>
      )}

      {status === "blocked" && (
        <BlockedPlanNotice
          message={blockedMessage ?? "No Behavior Plan is saved for this project."}
          onCreatePlan={onCreatePlan}
        />
      )}

      <div className="outcome-transport">
        <div className="outcome-transport-actions">
          <button type="button" onClick={isPlaying ? onPause : onPlay} aria-label={isPlaying ? "Pause outcome" : "Play outcome"} title={isPlaying ? "Pause outcome" : "Play outcome"}>
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            <span>{isPlaying ? "Pause" : "Play"}</span>
          </button>
          <button type="button" onClick={onReset} aria-label="Reset outcome" title="Reset outcome">
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>
        <label className="outcome-time-label" htmlFor="preview-time-seek">
          <Clock3 size={11} />
          <span>{currentTime} / {maxTime} ms</span>
        </label>
        <input
          id="preview-time-seek"
          type="range"
          min={0}
          max={maxTime}
          step={1}
          value={currentTime}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>

      <div className="outcome-workspace">
        <aside className="outcome-summary-rail">
          <section>
            <h3>Session</h3>
            <dl>
              <div><dt>Time</dt><dd>{currentTime} ms</dd></div>
              <div><dt>Actions</dt><dd>{snapshot?.sessionLog.length ?? 0}</dd></div>
              <div><dt>Sequence</dt><dd>{snapshot?.sequence ?? 0}</dd></div>
              <div><dt>Source</dt><dd>Not executed</dd></div>
            </dl>
          </section>
          <section>
            <h3>Recorded hashes</h3>
            <div className="outcome-hashes">
              <span>Snapshot</span><code title={snapshot?.snapshotSha256}>{snapshot?.snapshotSha256 ?? "Not created"}</code>
              <span>Session</span><code title={snapshot?.sessionLogSha256}>{snapshot?.sessionLogSha256 ?? "Not created"}</code>
            </div>
          </section>
        </aside>

        <main className="outcome-stream">
          <section className="outcome-stream-section">
            <header>
              <div><Activity size={12} /><h3>Timeline</h3></div>
              <span>{snapshot?.events.length ?? 0} events</span>
            </header>
            {!snapshot || snapshot.events.length === 0 ? (
              <div className="outcome-stream-empty">
                <Activity size={18} />
                <span><b>No outcome events yet</b><small>Start the project preview or use a typed control in the Inspector.</small></span>
              </div>
            ) : (
              <div className="outcome-event-list">
                {snapshot.events.slice(-40).map((event) => (
                  <div key={`${event.sequence}-${event.logicalTimeMs}`}>
                    <code>{event.logicalTimeMs ?? 0} ms</code>
                    <span>{event.actionId ?? event.eventId ?? event.kind ?? "event"}{event.message ? ` · ${event.message}` : ""}</span>
                    <b className={event.outcome === "rejected" ? "is-rejected" : ""}>{event.outcome ?? "unknown"}</b>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="outcome-stream-section">
            <header>
              <div><AlertTriangle size={12} /><h3>Diagnostics</h3></div>
              <span>{diagnostics.length}</span>
            </header>
            {diagnostics.length === 0 ? (
              <p className="outcome-empty">No project preview diagnostics.</p>
            ) : (
              <div className="outcome-diagnostics">
                {diagnostics.slice(0, 20).map((diagnostic, index) => (
                  <div key={`${diagnostic.code}-${index}`} className={diagnostic.severity === "error" ? "is-error" : ""}>
                    <code>{diagnostic.code}</code>
                    <span>{diagnostic.message}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {snapshot && (
            <section className="outcome-stream-section">
              <header>
                <div><Boxes size={12} /><h3>Component outcomes</h3></div>
                <span>{Object.keys(snapshot.components).length}</span>
              </header>
              <div className="outcome-components">
                {Object.entries(snapshot.components).map(([componentId, projection]) => (
                  <div key={componentId}>
                    <code>{componentId}</code>
                    <span>{projection.accessibleSummary}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Rendered inside the Outcome tab whenever preview status is "blocked":
 * explains the failure and offers a one-click starter Behavior Plan generated
 * from the canvas components' own checked-in behavior profiles.
 * `onCreatePlan` resolves to null on success or an honest error message.
 */
function BlockedPlanNotice({
  message,
  onCreatePlan,
}: {
  message: string;
  onCreatePlan: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <div className="outcome-blocked-plan" role="status">
      <div className="outcome-blocked-head">
        <TriangleAlert size={15} />
        <div>
          <b>Preview is blocked — no Behavior Plan is saved</b>
          <p>{message}</p>
        </div>
        <button
          type="button"
          className="outcome-blocked-generate"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFeedback(null);
            void onCreatePlan().then((error) => {
              setBusy(false);
              if (error) setFeedback(error);
            });
          }}
        >
          {busy ? "Generating…" : "Generate starter plan & play"}
        </button>
      </div>
      <p className="outcome-blocked-hint">
        A starter plan drives every behavior-capable part on the canvas with its own checked-in profile — one typed action per part, plus an indicator blink timeline. No source code is read or executed.
      </p>
      {feedback && <p className="outcome-blocked-feedback">{feedback}</p>}
    </div>
  );
}
