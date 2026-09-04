import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Download,
  ExternalLink,
  FileArchive,
  Grid3X3,
  Info,
  Layers3,
  Moon,
  Palette,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Wifi,
} from "lucide-react";
import { useThemeStore } from "../store/useThemeStore.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";
import { useWebMCPStore } from "../store/useWebMCPStore.ts";
import { getRegisteredToolNames, inspectWebMCPEnvironment } from "../webmcp/tools.ts";
import LogoMark from "../components/LogoMark.tsx";
import { apiUrl } from "../auth/session.ts";
import { parseSchematicProjectFile, triggerDownloadVlx } from "../utils/vllxFile.ts";

type Notice = { kind: "success" | "error" | "info"; text: string };

function SettingsToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}) {
  return (
    <div className="settings-row">
      <div>
        <b>{label}</b>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className={`settings-switch ${checked ? "is-on" : ""}`}
        aria-label={`Toggle ${label}`}
        aria-pressed={checked}
        onClick={onChange}
      >
        <span />
      </button>
    </div>
  );
}

function SettingsPanelHeading({
  icon,
  title,
  copy,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="settings-panel-heading">
      <span className="settings-panel-icon">{icon}</span>
      <div><h2>{title}</h2><p>{copy}</p></div>
      {action}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useThemeStore();
  const project = useProjectStore((state) => state.project);
  const clear = useProjectStore((state) => state.clear);
  const {
    showGrid,
    setShowGrid,
    snapToGrid,
    setSnapToGrid,
    libraryDensity,
    setLibraryDensity,
    reducedMotion,
    setReducedMotion,
  } = useWorkspaceStore();
  const webmcpRegistration = useWebMCPStore((state) => state.registration);
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "offline">("checking");
  const [apiInfo, setApiInfo] = useState<{ version?: string; runtime?: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const toolCount = getRegisteredToolNames().length;
  const webmcpEnvironment = inspectWebMCPEnvironment();
  const apiBaseUrl = apiUrl("/api");

  const webmcpLabel =
    webmcpRegistration.state === "native"
      ? webmcpRegistration.discovery === "verified"
        ? "Connected and discovered"
        : "Connected, discovery needs review"
      : webmcpRegistration.state === "fallback"
        ? "Fallback ready · native unavailable"
        : webmcpRegistration.state === "checking"
          ? "Checking"
          : webmcpRegistration.state === "unavailable"
            ? "Unavailable in this browser"
            : "Needs review";

  const checkApi = useCallback(async (announce = false) => {
    setApiStatus("checking");
    try {
      const response = await fetch(apiUrl("/api/health"), { credentials: "include" });
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        setApiStatus("offline");
        setApiInfo(null);
        if (announce) setNotice({ kind: "info", text: "The optional API is not connected. Local project editing remains available." });
        return;
      }
      const rawPayload: unknown = await response.json();
      const record = rawPayload && typeof rawPayload === "object" ? rawPayload as Record<string, unknown> : {};
      setApiInfo({
        ...(typeof record.version === "string" ? { version: record.version } : {}),
        ...(typeof record.runtime === "string" ? { runtime: record.runtime } : {}),
      });
      setApiStatus("ok");
      if (announce) setNotice({ kind: "success", text: "The API connection is healthy." });
    } catch (error) {
      setApiStatus("offline");
      setApiInfo(null);
      if (announce) setNotice({ kind: "error", text: `The API check failed: ${(error as Error).message}` });
    }
  }, []);

  useEffect(() => {
    void checkApi(false);
  }, [checkApi]);

  const handleExport = () => {
    triggerDownloadVlx(project.name);
    setNotice({ kind: "success", text: "The project was exported as a portable .vlx file." });
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imported = await parseSchematicProjectFile(file);
      useProjectStore.getState().importProject(imported);
      setNotice({ kind: "success", text: `Imported “${imported.name}” as a new project.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The project file could not be read." });
    } finally {
      input.value = "";
    }
  };

  const handleClear = () => {
    if (!clearArmed) {
      setClearArmed(true);
      setNotice({ kind: "info", text: "Choose Confirm clear to remove this project’s components, wires, plans, and source." });
      return;
    }
    clear();
    setClearArmed(false);
    setNotice({ kind: "success", text: "The project was cleared. Its name was kept." });
  };

  const apiLabel = apiStatus === "ok" ? "Connected" : apiStatus === "offline" ? "Offline" : "Checking";

  return (
    <div className="settings-page-redesign settings-page-v2">
      <header className="settings-topbar">
        <div className="settings-topbar-left">
          <Link to="/studio" className="settings-back-button" aria-label="Back to Studio">
            <ArrowLeft size={15} />
          </Link>
          <Link to="/" className="parts-brand" aria-label="Schematic home">
            <span className="site-brand-mark"><LogoMark /></span>
            <span>Schematic</span>
          </Link>
        </div>
        <div className="settings-topbar-actions">
          <Link to="/parts">Parts</Link>
          <Link to="/studio" className="settings-studio-link">Studio</Link>
        </div>
      </header>

      <main className="settings-dashboard">
        <header className="settings-dashboard-heading">
          <div className="settings-dashboard-title">
            <span><Settings2 size={19} /></span>
            <div>
              <p>Workspace settings</p>
              <h1>Make the Studio work the way you do.</h1>
              <small>Appearance, canvas behavior, live connections, and portable project files.</small>
            </div>
          </div>
        </header>

        <div className="settings-dashboard-body">
          <aside className="settings-dashboard-rail">
            <nav className="settings-dashboard-nav" aria-label="Settings sections">
              <a href="#appearance"><Palette size={13} /> Appearance</a>
              <a href="#canvas"><Grid3X3 size={13} /> Canvas</a>
              <a href="#connections"><Wifi size={13} /> Connections</a>
              <a href="#project-settings"><Save size={13} /> Project files</a>
            </nav>

            <div className="settings-dashboard-project" aria-label="Active project summary">
              <span>{project.name}</span>
              <div><b>{project.components.length}</b><small>components</small></div>
              <div><b>{project.connections.length}</b><small>wires</small></div>
            </div>
          </aside>

          <div className="settings-dashboard-content">
            {notice && (
              <div className={`settings-notice is-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
                {notice.kind === "error" ? <CircleAlert size={15} /> : notice.kind === "success" ? <Check size={15} /> : <Info size={15} />}
                <span>{notice.text}</span>
                <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
              </div>
            )}

            <div className="settings-dashboard-grid">
          <section id="appearance" className="settings-panel settings-panel-appearance">
            <SettingsPanelHeading icon={<Palette size={16} />} title="Appearance" copy="Choose the workspace tone." />
            <div className="theme-choice-grid">
              <button type="button" onClick={() => setTheme("dark")} className={theme === "dark" ? "is-selected" : ""}>
                <span className="theme-preview is-dark"><i /><i /><i /></span>
                <span><Moon size={14} /> Dark</span>
                <small>Quiet contrast for longer sessions</small>
              </button>
              <button type="button" onClick={() => setTheme("light")} className={theme === "light" ? "is-selected" : ""}>
                <span className="theme-preview is-light"><i /><i /><i /></span>
                <span><Sun size={14} /> Light</span>
                <small>Paper tone with clear panel edges</small>
              </button>
            </div>
          </section>

          <section id="canvas" className="settings-panel settings-panel-canvas">
            <SettingsPanelHeading icon={<Grid3X3 size={16} />} title="Canvas and panels" copy="Control movement and density." />
            <div className="settings-rows">
              <SettingsToggle checked={showGrid} onChange={() => setShowGrid(!showGrid)} label="Drafting grid" description="Show guide lines behind the hardware." />
              <SettingsToggle checked={snapToGrid} onChange={() => setSnapToGrid(!snapToGrid)} label="Snap to grid" description="Keep components aligned while they move." />
              <SettingsToggle checked={libraryDensity === "compact"} onChange={() => setLibraryDensity(libraryDensity === "compact" ? "comfortable" : "compact")} label="Compact library" description="Show more parts in the same vertical space." />
              <SettingsToggle checked={reducedMotion} onChange={() => setReducedMotion(!reducedMotion)} label="Reduce motion" description="Replace nonessential movement with simple fades." />
            </div>
          </section>

          <section id="connections" className="settings-panel settings-panel-connections">
            <SettingsPanelHeading
              icon={<Wifi size={16} />}
              title="Connections"
              copy="Live status from the services this workspace can use."
              action={
                <button type="button" className="settings-refresh" onClick={() => void checkApi(true)} aria-label="Check connections again">
                  <RefreshCw size={13} className={apiStatus === "checking" ? "animate-spin" : ""} />
                </button>
              }
            />

            <div className="connection-status-grid">
              <article>
                <div><Layers3 size={15} /><b>Project API</b></div>
                <span className={`connection-state is-${apiStatus}`}>{apiLabel}</span>
                <p>{apiInfo ? `${apiInfo.runtime ?? "Site API"}${apiInfo.version ? ` version ${apiInfo.version}` : ""}` : apiBaseUrl}</p>
                <a href="/api/health" target="_blank" rel="noreferrer">View health <ExternalLink size={11} /></a>
              </article>

              <article>
                <div><ShieldCheck size={15} /><b>WebMCP</b></div>
                <span className={`connection-state is-${webmcpRegistration.state}`}>{webmcpLabel}</span>
                <p>{webmcpRegistration.state === "fallback"
                  ? `${toolCount} direct-call bridge tools are ready. Native blocker: ${webmcpEnvironment.blocker ?? "unknown"}; secure=${webmcpEnvironment.secureContext}, origin-isolated=${webmcpEnvironment.originAgentCluster}, tools-permission=${String(webmcpEnvironment.toolsPermission)}.`
                  : `${webmcpRegistration.registeredCount || toolCount} tools are available to the current workspace surface.`}</p>
                <a href="/api/docs" target="_blank" rel="noreferrer">Open API docs <ExternalLink size={11} /></a>
              </article>
            </div>
          </section>

          <section id="project-settings" className="settings-panel settings-panel-project">
            <SettingsPanelHeading icon={<FileArchive size={16} />} title="Project files" copy="Move the active project in or out of the workspace." />

            <div className="project-file-actions">
              <button type="button" onClick={handleExport} className="project-file-primary">
                <Download size={15} />
                <span><b>Export project</b><small>Components, wires, plans, and editable source</small></span>
              </button>
              <label className="project-file-secondary">
                <Upload size={15} />
                <span><b>Import project</b><small>Open the file as a separate project</small></span>
                <input type="file" accept=".vlx,.json,application/json" onChange={(event) => void handleImport(event)} />
              </label>
            </div>

            <div className="settings-danger-row">
              <div><b>Clear the active project</b><p>Keep the project name, but remove its components, wires, plans, and source.</p></div>
              <div>
                {clearArmed && <button type="button" className="settings-cancel" onClick={() => setClearArmed(false)}>Cancel</button>}
                <button type="button" className={`settings-clear ${clearArmed ? "is-armed" : ""}`} onClick={handleClear}>
                  <Trash2 size={14} />
                  {clearArmed ? "Confirm clear" : "Clear project"}
                </button>
              </div>
            </div>
          </section>
            </div>
          </div>
        </div>

        <footer className="settings-page-footer">
          <span>Schematic 1.0.0</span>
          <span>Project files remain portable and editable.</span>
        </footer>
      </main>
    </div>
  );
}
