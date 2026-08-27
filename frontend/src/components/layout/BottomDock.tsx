import { useState, useRef, useEffect } from "react";
import { useSimulationStore } from "../../store/useSimulationStore.ts";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { getRegisteredToolNames } from "../../webmcp/tools.ts";
import ValidationPanel from "../validation/ValidationPanel.tsx";
import { Terminal, ChevronDown, Trash2 } from "lucide-react";

type Tab = "webmcp" | "terminal" | "debug" | "validation";

export default function BottomDock({ collapsed, onToggleCollapse, height }: { collapsed: boolean; onToggleCollapse: () => void; height: number }) {
  const [tab, setTab] = useState<Tab>("webmcp");
  const { running, serialOutput, pinStates, engineStatus } = useSimulationStore();
  const project = useProjectStore((s) => s.project);
  const toolNames = getRegisteredToolNames();

  if (collapsed) {
    return (
      <div className="h-8 border-t border-border bg-card flex items-center px-2 gap-1 shrink-0 text-xs">
        <button onClick={() => { setTab("webmcp"); onToggleCollapse(); }} className="px-2 py-1 rounded hover:bg-muted">WebMCP</button>
        <button onClick={() => { setTab("terminal"); onToggleCollapse(); }} className="px-2 py-1 rounded hover:bg-muted">Terminal</button>
        <button onClick={() => { setTab("debug"); onToggleCollapse(); }} className="px-2 py-1 rounded hover:bg-muted">Debug</button>
        <button onClick={() => { setTab("validation"); onToggleCollapse(); }} className="px-2 py-1 rounded hover:bg-muted">Problems</button>
        <button onClick={onToggleCollapse} className="ml-auto w-6 h-6 rounded border border-border hover:bg-muted flex items-center justify-center"><ChevronDown size={12} className="rotate-180" /></button>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-card flex flex-col shrink-0" style={{ height }}>
      <div className="h-8 flex items-center gap-0 px-2 border-b border-border shrink-0">
        <div className="flex items-center gap-0">
          <TabBtn active={tab === "webmcp"} onClick={() => setTab("webmcp")}>WebMCP</TabBtn>
          <TabBtn active={tab === "terminal"} onClick={() => setTab("terminal")}>Terminal</TabBtn>
          <TabBtn active={tab === "debug"} onClick={() => setTab("debug")}>Debug</TabBtn>
          <TabBtn active={tab === "validation"} onClick={() => setTab("validation")}>Problems</TabBtn>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">{project.components.length} comps · {project.connections.length} wires</span>
          <span className={`w-1.5 h-1.5 rounded-full ${running ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
          <button onClick={onToggleCollapse} className="w-6 h-6 rounded hover:bg-muted flex items-center justify-center"><ChevronDown size={12} /></button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-card">
        {tab === "webmcp" && <WebMCPCLI toolNames={toolNames} />}
        {tab === "terminal" && <TerminalTab running={running} serialOutput={serialOutput} />}
        {tab === "debug" && <DebugTab pinStates={pinStates} engineStatus={engineStatus} project={project} />}
        {tab === "validation" && <div className="p-2"><ValidationPanel embedded /></div>}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs px-3 h-8 border-b-2 -mb-px ${active ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

// ---- WebMCP CLI ----
function WebMCPCLI({ toolNames }: { toolNames: string[] }) {
  const [history, setHistory] = useState<{ cmd: string; out: string; isError?: boolean }[]>([
    { cmd: "help", out: "WebMCP CLI — type a tool name and JSON args. Examples:\n  component.search {\"query\":\"esp32\"}\n  component.add {\"componentId\":\"esp32-devkit-v1\"}\n  project.get_graph\n  validation.check\n\nTools: " + toolNames.join(", ") },
  ]);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const filteredTools = toolNames.filter((t) => !filter || t.toLowerCase().includes(filter.toLowerCase()));

  const run = async () => {
    const raw = input.trim();
    if (!raw) return;
    if (raw === "clear") { setHistory([]); setInput(""); return; }
    if (raw === "help" || raw === "list" || raw === "tools") {
      setHistory((h) => [...h, { cmd: raw, out: toolNames.join("\n") }]);
      setInput("");
      return;
    }
    // parse: first token is tool name, rest is JSON
    const firstSpace = raw.indexOf(" ");
    let name = raw;
    let args: any = {};
    if (firstSpace !== -1) {
      name = raw.slice(0, firstSpace).trim();
      const rest = raw.slice(firstSpace + 1).trim();
      if (rest) {
        try { args = JSON.parse(rest); }
        catch {
          // try to parse as key=value pairs? fallback to single arg
          setHistory((h) => [...h, { cmd: raw, out: `Invalid JSON args: ${rest}\nUse JSON object, e.g. {"query":"esp32"}`, isError: true }]);
          setInput("");
          return;
        }
      }
    }
    // allow short alias without dot? keep as is
    const tools: any = (window as any).__schematicTools;
    const fn = tools?.[name];
    if (!fn) {
      const suggestion = toolNames.find((t) => t.includes(name) || name.includes(t.split(".").pop()!));
      setHistory((h) => [...h, { cmd: raw, out: `Unknown tool "${name}"${suggestion ? `. Did you mean "${suggestion}"?` : ""}\nType "help" to list tools.`, isError: true }]);
      setInput("");
      return;
    }
    try {
      const res = await fn(args);
      const text = res?.content?.[0]?.text ?? JSON.stringify(res, null, 2);
      setHistory((h) => [...h, { cmd: raw, out: text }]);
    } catch (e: any) {
      setHistory((h) => [...h, { cmd: raw, out: String(e?.message ?? e), isError: true }]);
    }
    setInput("");
  };

  return (
    <div className="h-full flex flex-col font-mono text-xs">
      <div className="flex-1 overflow-auto p-2 space-y-1.5 bg-[#0a0a0a] text-zinc-100">
        {history.map((h, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-2">
              <span className="text-emerald-400 shrink-0">$</span>
              <span className="text-zinc-100 break-all">{h.cmd}</span>
            </div>
            <pre className={`ml-4 whitespace-pre-wrap break-words text-[11px] leading-relaxed ${h.isError ? "text-red-300" : "text-zinc-300"}`}>{h.out}</pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* suggestions */}
      {filter && filteredTools.length > 0 && filteredTools.length < toolNames.length && (
        <div className="border-t border-zinc-800 bg-zinc-900 px-2 py-1.5 flex flex-wrap gap-1 max-h-20 overflow-auto">
          {filteredTools.slice(0, 8).map((t) => (
            <button key={t} onClick={() => { setInput(t + " "); setFilter(""); inputRef.current?.focus(); }} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300">
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-zinc-800 bg-zinc-900 flex items-center gap-2 px-2 py-1.5">
        <span className="text-emerald-400 text-xs">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); const tok = e.target.value.split(" ")[0]; setFilter(tok); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
            if (e.key === "Tab") {
              e.preventDefault();
              const match = filteredTools[0];
              if (match) { setInput(match + " "); setFilter(""); }
            }
            if (e.key === "Escape") setFilter("");
          }}
          placeholder='Type tool — e.g. component.search {"query":"esp32"} — Tab to autocomplete, Enter to run'
          className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
        <button onClick={run} className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200">Run</button>
        <button onClick={() => setHistory([])} className="text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-400"><Trash2 size={11} /></button>
      </div>
      <div className="px-2 py-1 border-t border-zinc-800 bg-zinc-900 text-[11px] text-zinc-500 flex items-center gap-3">
        <span>Enter: run · Tab: autocomplete · clear: reset</span>
        <span className="ml-auto">{toolNames.length} tools</span>
      </div>
    </div>
  );
}

function TerminalTab({ running, serialOutput }: { running: boolean; serialOutput: string }) {
  const [local, setLocal] = useState("");
  return (
    <div className="h-full flex flex-col font-mono text-xs">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-muted/20 text-xs font-sans">
        <span className="flex items-center gap-1.5"><Terminal size={12} /> Serial</span>
        <span className="text-muted-foreground">{running ? "Streaming" : "Idle"} · {serialOutput.length} chars</span>
      </div>
      <div className="flex-1 overflow-auto p-2 bg-[#0a0a0a] text-zinc-100 text-xs">
        {serialOutput ? <pre className="whitespace-pre-wrap break-words text-[11px]">{serialOutput}</pre> : <div className="text-zinc-500 text-xs">No output yet — run simulation.</div>}
      </div>
      <div className="border-t border-zinc-800 bg-zinc-900 flex items-center gap-2 px-2 py-1.5">
        <span className="text-zinc-500">$</span>
        <input value={local} onChange={(e) => setLocal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && local.trim()) { useSimulationStore.getState().appendSerial(`$ ${local}\n`); setLocal(""); } }} placeholder="Type — logs to serial" className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none" />
      </div>
    </div>
  );
}

function DebugTab({ pinStates, engineStatus, project }: any) {
  return (
    <div className="p-2 space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div className="border border-border rounded p-2">
          <div className="font-medium mb-1">Engines</div>
          {Object.entries(engineStatus).map(([k, v]: any) => (
            <div key={k} className="flex justify-between py-1 border-b border-border last:border-0 text-xs">
              <span className="font-mono">{k}</span>
              <span className={`text-[11px] px-1 rounded border ${v.enabled ? "bg-emerald-500 text-white border-emerald-600" : "bg-muted border-border"}`}>{v.status}</span>
            </div>
          ))}
        </div>
        <div className="border border-border rounded p-2">
          <div className="font-medium mb-1">Pin States <span className="text-muted-foreground font-normal">({Object.keys(pinStates).length})</span></div>
          {Object.keys(pinStates).length === 0 ? <div className="text-muted-foreground py-4 text-center border border-dashed border-border rounded text-xs">No activity</div> : (
            <div className="space-y-1 max-h-32 overflow-auto">
              {Object.entries(pinStates).map(([k, v]: any) => (
                <div key={k} className="flex justify-between font-mono text-xs px-1.5 py-1 rounded bg-muted border border-border"><span className="truncate">{k}</span><span>{String(v)}</span></div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="border border-border rounded p-2">
        <div className="font-medium mb-1">Project</div>
        <pre className="text-[11px] bg-muted p-2 rounded border border-border overflow-auto">{JSON.stringify({ id: project.id, components: project.components.length, connections: project.connections.length }, null, 2)}</pre>
      </div>
    </div>
  );
}
