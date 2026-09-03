import { lazy, Suspense } from "react";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { getCatalogComponent } from "../../data/catalog.ts";
import {
  Box,
  Cable,
  Check,
  Minus,
  TriangleAlert,
  Code2,
  Download,
  Eye,
  FileCode2,
  FolderKanban,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import ComponentArtwork from "../ComponentArtwork.tsx";
import { useWorkspaceStore } from "../../store/useWorkspaceStore.ts";
import { useValidationStore } from "../../store/useValidationStore.ts";
import { useGraphFocusStore } from "../../store/useGraphFocusStore.ts";
import DestructiveConfirmButton from "../DestructiveConfirmButton.tsx";
import LoadingState from "../ui/loading-state.tsx";

const MonacoWorkspace = lazy(() => import("../editor/MonacoWorkspace.tsx"));
const Inspector = lazy(() => import("../inspector/Inspector.tsx"));
const ShoppingWorkspace = lazy(() => import("../shopping/ShoppingWorkspace.tsx"));

type RightPanelTab = "code" | "inspect" | "project" | "shopping";

const panelTabs: Array<{ id: RightPanelTab; label: string; icon: typeof Code2 }> = [
  { id: "code", label: "Code", icon: Code2 },
  { id: "inspect", label: "Inspector", icon: Eye },
  { id: "project", label: "Project", icon: FolderKanban },
  { id: "shopping", label: "Parts", icon: ShoppingCart },
];

function PanelFallback({ label }: { label: string }) {
  return (
    <div className="right-panel-loading" aria-live="polite">
      <LoadingState label={`Opening ${label}`} variant="Drive" compact />
    </div>
  );
}

function ProjectPanel() {
  const project = useProjectStore((state) => state.project);
  const activeId = useSelectionStore((state) => state.activeComponentId);
  const validationValid = useValidationStore((state) => state.valid);
  const validationIssues = useValidationStore((state) => state.issues);
  const documentCount = project.codeDocuments?.length ?? project.firmwareTargets.length;

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="project-panel-v2">
      <header className="project-panel-heading">
        <span className="project-panel-mark"><FolderKanban size={15} /></span>
        <div>
          <small>Active project</small>
          <h2>{project.name}</h2>
        </div>
      </header>

      <div className="project-panel-summary" aria-label="Project summary">
        <div><Box size={12} /><span><b>{project.components.length}</b><small>Components</small></span></div>
        <div><Cable size={12} /><span><b>{project.connections.length}</b><small>Wires</small></span></div>
        <div><FileCode2 size={12} /><span><b>{documentCount}</b><small>Source files</small></span></div>
      </div>

      <section className="project-panel-section">
        <header><span>Components</span><b>{project.components.length}</b></header>
        <div className="project-panel-list">
          {project.components.length === 0 ? (
            <div className="project-panel-empty"><Box size={15} /><span>No components in this project</span></div>
          ) : project.components.map((component) => {
            const definition = getCatalogComponent(component.definitionId);
            const isActive = component.id === activeId;
            return (
              <button
                type="button"
                key={component.id}
                onClick={() => useSelectionStore.getState().setActive(component.id)}
                className={`project-component-row ${isActive ? "is-active" : ""}`}
              >
                <span className="project-component-art"><ComponentArtwork definition={definition} /></span>
                <span className="project-component-copy">
                  <b>{definition?.title ?? component.definitionId}</b>
                  <small>{component.id}</small>
                </span>
                {isActive && <Check size={11} aria-label="Selected component" />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="project-panel-section">
        <header><span>Wires</span><b>{project.connections.length}</b></header>
        <div className="project-panel-list is-wires">
          {project.connections.length === 0 ? (
            <div className="project-panel-empty"><Cable size={15} /><span>No wires in this project</span></div>
          ) : project.connections.map((wire) => {
            const wireIssues = validationIssues.filter((issue) => issue.affectedConnections?.includes(wire.id));
            const hasError = wireIssues.some((issue) => issue.severity === "error");
            const hasWarning = wireIssues.some((issue) => issue.severity === "warning");
            const status = hasError ? "Needs a fix" : hasWarning ? "Review" : validationValid === true ? "Checked" : "Run graph checks";
            const StatusIcon = hasError || hasWarning ? TriangleAlert : validationValid === true ? Check : Minus;
            return (
              <button
                type="button"
                key={wire.id}
                onClick={() => {
                  useGraphFocusStore.getState().setActiveConnection(wire.id);
                  useSelectionStore.getState().setActive(wire.source.componentId);
                }}
                className="project-wire-row"
                aria-label={`Select wire ${wire.id}; ${status}`}
                title={`${status}: ${wire.source.componentId}.${wire.source.portId} → ${wire.target.componentId}.${wire.target.portId}`}
              >
                <StatusIcon size={11} className={hasError ? "is-error" : hasWarning ? "is-warning" : validationValid === true ? "is-checked" : ""} aria-hidden="true" />
                <span>{wire.source.componentId}.{wire.source.portId}</span>
                <i>→</i>
                <span>{wire.target.componentId}.{wire.target.portId}</span>
              </button>
            );
          })}
        </div>
      </section>

      <footer className="project-panel-actions">
        <DestructiveConfirmButton
          targetKey={project.id}
          onConfirm={() => useProjectStore.getState().clear()}
          className="project-panel-clear"
          aria-label={`Clear project ${project.name}`}
          confirmAriaLabel={`Confirm clear project ${project.name}; components, wires, plans, and editable source will be removed`}
          title="Clear the active project"
          confirmTitle={`Click again to clear ${project.name}`}
          confirmChildren={<><Trash2 size={12} /> Confirm clear</>}
        >
          <Trash2 size={12} /> Clear
        </DestructiveConfirmButton>
        <button type="button" onClick={exportProject} className="project-panel-export">
          <Download size={12} /> Export
        </button>
      </footer>
    </div>
  );
}

export default function RightPanel() {
  const tab = useWorkspaceStore((state) => state.rightPanelTab) as RightPanelTab;
  const setTab = useWorkspaceStore((state) => state.setRightPanelTab);

  return (
    <div className="right-panel-v2">
      <div className="right-panel-tabs" role="tablist" aria-label="Project tools">
        {panelTabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`right-panel-${id}`}
            onClick={() => setTab(id)}
            className={tab === id ? "is-active" : ""}
          >
            <Icon size={12} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="right-panel-content">
        {tab === "code" && (
          <section id="right-panel-code" className="right-panel-view" role="tabpanel">
            <Suspense fallback={<PanelFallback label="source editor" />}>
              <MonacoWorkspace />
            </Suspense>
          </section>
        )}

        {tab === "inspect" && (
          <section id="right-panel-inspect" className="right-panel-view right-inspector-panel" role="tabpanel">
            <Suspense fallback={<PanelFallback label="Inspector" />}>
              <Inspector />
            </Suspense>
          </section>
        )}

        {tab === "project" && (
          <section id="right-panel-project" className="right-panel-view" role="tabpanel">
            <ProjectPanel />
          </section>
        )}

        {tab === "shopping" && (
          <section id="right-panel-shopping" className="right-panel-view right-parts-panel" role="tabpanel">
            <Suspense fallback={<PanelFallback label="parts desk" />}>
              <ShoppingWorkspace />
            </Suspense>
          </section>
        )}
      </div>
    </div>
  );
}
