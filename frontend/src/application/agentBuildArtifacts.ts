import { GENERATED_STARTER_BEHAVIOR_PLAN_ID } from "../store/useProjectStore.ts";
import { getCatalogComponent } from "../data/catalog.ts";
import { boardTargetFor, isBoardDefinition } from "../data/hardware.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { ensureStarterPlanForAgentBuild } from "../behavior/starterPlan.ts";
import { AGENT_STARTER_SOURCE_MARKER, isGeneratedAgentStarterDocument, writeCode } from "./behaviorCommands.ts";
import { checkFirmware } from "./firmwareCommands.ts";

export function generatedAgentStarterSource(componentId: string, definitionId: string) {
  const target = boardTargetFor(definitionId);
  return {
    name: target?.fileName ?? "sketch.ino",
    content: `// ${AGENT_STARTER_SOURCE_MARKER}\n// Target instance: ${componentId}\n// Definition: ${definitionId}\n// Browser Check bootstrap only. Replace this marked scaffold with the user's project-specific firmware.\n\nvoid setup() {\n}\n\nvoid loop() {\n  delay(10);\n}\n`,
  };
}

type AgentBuildCodeSetup = {
  componentId: string;
  definitionId: string;
  created: boolean;
  relinked?: boolean;
  starter?: boolean;
  contentSha256?: string;
  status: "browser-executed" | "browser-executed-with-warnings" | "browser-partial" | "browser-unavailable" | "write-failed" | "check-failed";
  code?: string;
  message?: string;
};

/**
 * Keep semantic graph edits from ending with an empty Outcome/code pane. This
 * creates only unmistakably marked scaffolds and never overwrites authored
 * source. The returned requiredActions tell the agent exactly what remains.
 */
export async function ensureAgentBuildArtifacts() {
  const behaviorSetup = await ensureStarterPlanForAgentBuild();
  const project = useProjectStore.getState().project;
  const boards = project.components.filter((component) => isBoardDefinition(getCatalogComponent(component.definitionId)));
  const codeSetup: AgentBuildCodeSetup[] = [];

  for (const board of boards) {
    let document = useProjectStore.getState().getCodeDocument(board.id);
    let created = false;
    let relinked = false;
    if (!document) {
      const target = boardTargetFor(board.definitionId);
      const write = await writeCode({
        targetComponentId: board.id,
        files: [generatedAgentStarterSource(board.id, board.definitionId)],
        language: "arduino",
        expectedContentSha256: null,
        origin: "ai-generated",
        ...(target?.fqbn ? { boardFqbn: target.fqbn } : {}),
        ...(behaviorSetup.ready ? {
          linkToBehaviorPlan: {
            planId: behaviorSetup.planId,
            planSha256: behaviorSetup.planSha256,
            projectSha256: behaviorSetup.projectSha256,
          },
        } : {}),
      });
      if (!write.ok) {
        codeSetup.push({ componentId: board.id, definitionId: board.definitionId, created: false, status: "write-failed", code: write.error.code, message: write.error.message });
        continue;
      }
      document = write.data.document;
      created = true;
    }

    if (document && !created && behaviorSetup.ready && isGeneratedAgentStarterDocument(document)) {
      const link = document.previewLink;
      const linkIsCurrent = link.status === "linked"
        && link.behaviorPlanId === behaviorSetup.planId
        && link.behaviorPlanSha256 === behaviorSetup.planSha256
        && link.projectSha256 === behaviorSetup.projectSha256
        && link.linkedContentSha256 === document.contentSha256;
      if (!linkIsCurrent) {
        const target = boardTargetFor(board.definitionId);
        const boardFqbn = document.boardFqbn ?? target?.fqbn;
        const rewrite = await writeCode({
          targetComponentId: board.id,
          files: [...document.files],
          language: document.language,
          dependencies: [...document.dependencies],
          expectedContentSha256: document.contentSha256,
          origin: "ai-generated",
          ...(boardFqbn ? { boardFqbn } : {}),
          linkToBehaviorPlan: { planId: behaviorSetup.planId, planSha256: behaviorSetup.planSha256, projectSha256: behaviorSetup.projectSha256 },
        });
        if (!rewrite.ok) {
          codeSetup.push({ componentId: board.id, definitionId: board.definitionId, created: false, status: "write-failed", code: rewrite.error.code, message: rewrite.error.message });
          continue;
        }
        document = rewrite.data.document;
        relinked = true;
      }
    }

    const check = await checkFirmware({ componentId: board.id, durationMs: 100 });
    const starter = isGeneratedAgentStarterDocument(document);
    if (!check.ok) {
      codeSetup.push({ componentId: board.id, definitionId: board.definitionId, created, ...(relinked ? { relinked: true } : {}), starter, contentSha256: document.contentSha256, status: "check-failed", code: check.error.code, message: check.error.message });
      continue;
    }
    codeSetup.push({
      componentId: board.id,
      definitionId: board.definitionId,
      created,
      ...(relinked ? { relinked: true } : {}),
      starter,
      contentSha256: document.contentSha256,
      status: check.data.status,
      ...(check.data.status === "browser-executed" || check.data.status === "browser-executed-with-warnings" ? {} : { message: check.data.notice }),
    });
  }

  const browserChecked = codeSetup.filter((item) => item.status === "browser-executed" || item.status === "browser-executed-with-warnings").length;
  const starterSourceCount = codeSetup.filter((item) => item.starter === true).length;
  const authoredSourceCount = codeSetup.filter((item) => item.starter === false).length;
  const browserReady = browserChecked === boards.length;
  const codeReady = browserReady && starterSourceCount === 0;
  const generatedBehaviorNeedsAuthoring = behaviorSetup.ready && behaviorSetup.planId === GENERATED_STARTER_BEHAVIOR_PLAN_ID;
  const behaviorReady = behaviorSetup.status === "unavailable" || (behaviorSetup.ready && !generatedBehaviorNeedsAuthoring);
  const sourceNeedsAuthoring = codeSetup.filter((item) => item.starter === true).map((item) => item.componentId);
  const requiredActions: Array<Record<string, unknown>> = [];

  if (generatedBehaviorNeedsAuthoring) {
    requiredActions.push({
      tool: "behavior.plan.write",
      reason: "The generated Outcome plan is only a safe demo fallback. Author the user's project-specific Behavior Plan before declaring the build complete.",
      projectId: project.id,
      starterPlanId: behaviorSetup.planId,
      expectedRevision: null,
      instruction: "Create a new bounded plan id using exact capabilities from behavior.get_capabilities.",
    });
  } else if (behaviorSetup.status === "custom-plan-review" || behaviorSetup.status === "blocked") {
    requiredActions.push({ tool: "behavior.plan.write", reason: behaviorSetup.message, planId: behaviorSetup.planId, expectedRevision: behaviorSetup.revision });
  }

  for (const componentId of sourceNeedsAuthoring) {
    const board = boards.find((candidate) => candidate.id === componentId);
    const target = boardTargetFor(board?.definitionId);
    requiredActions.push({
      tool: "code.write",
      reason: "Replace Schematic's marked Browser Check scaffold with project-specific firmware for the intended behavior and actual wiring.",
      targetComponentId: componentId,
      language: "arduino",
      expectedContentSha256: null,
      ...(target?.fqbn ? { boardFqbn: target.fqbn } : {}),
      ...(generatedBehaviorNeedsAuthoring ? {
        dependsOn: "behavior.plan.write",
        instruction: "Write the project-specific Behavior Plan first; generated-scaffold replacement will auto-link to the current non-starter plan.",
      } : behaviorSetup.ready ? {
        linkToBehaviorPlan: { planId: behaviorSetup.planId, planSha256: behaviorSetup.planSha256, projectSha256: behaviorSetup.projectSha256 },
      } : {}),
    });
  }

  for (const item of codeSetup) {
    if (item.status === "browser-partial" || item.status === "browser-unavailable" || item.status === "check-failed") {
      requiredActions.push({ tool: "firmware.check", reason: item.message ?? "Repair the source, then re-run Browser Check.", componentId: item.componentId });
    }
  }

  return {
    ready: codeReady && behaviorReady,
    browserReady,
    behaviorSetup,
    codeSetup,
    boardCount: boards.length,
    sourceCreated: codeSetup.filter((item) => item.created).length,
    sourceChecked: browserChecked,
    starterSourceCount,
    authoredSourceCount,
    sourceNeedsAuthoring,
    generatedBehaviorNeedsAuthoring,
    requiredActions,
  };
}

export function agentBuildSourceText(setup: Awaited<ReturnType<typeof ensureAgentBuildArtifacts>>) {
  if (setup.boardCount === 0) return "No programmable board source is required.";
  if (setup.starterSourceCount > 0) return `Board source: ${setup.sourceChecked}/${setup.boardCount} Browser Check executed; ${setup.starterSourceCount} marked starter scaffold${setup.starterSourceCount === 1 ? "" : "s"} still require project-specific firmware.`;
  return `Board source: ${setup.sourceChecked}/${setup.boardCount} Browser Check ready with project-specific source.`;
}
