import Editor, { type Monaco } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Download, FileCode2, FileDown, Sparkles, Link2, UserRound, PackageOpen, AlertTriangle } from "lucide-react";
import { useProjectStore } from "../../store/useProjectStore.ts";
import { useSelectionStore } from "../../store/useSelectionStore.ts";
import { resolveFirmwareBinding } from "../../data/hardware.ts";
import { useBehaviorPreviewStore } from "../../behavior/useBehaviorPreviewStore.ts";
import { isSafeRelativeCodePath, MAX_CODE_DOCUMENT_BYTES, MAX_CODE_FILE_BYTES, MAX_CODE_FILES_PER_DOCUMENT } from "../../store/behaviorPersistence.ts";
import { getCurrentUserId } from "../../auth/session.ts";

const DEFAULT_SKETCH = `// Schematic — editable source for your hardware project
// This file is an AI draft until you review and test it on your board.
#include <Arduino.h>

void setup() {
  Serial.begin(115200);
}

void loop() {
  // Write the firmware you want to take to your board here.
}
`;

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12,
  lineHeight: 18,
  lineNumbersMinChars: 2,
  glyphMargin: false,
  lineDecorationsWidth: 4,
  folding: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollBeyondLastLine: false,
  padding: { top: 8, bottom: 8 },
  fontFamily: "Geist Mono, ui-monospace, monospace",
};

type CodeOrigin = "ai-generated" | "human-authored" | "imported" | "mixed";
type PreviewLink = { status: "unlinked" | "linked" | "stale"; behaviorPlanId?: string; changed?: readonly string[] };

interface CodeFileLike { name: string; content: string }
interface CodeDocumentLike {
  id?: string;
  targetComponentId?: string;
  componentId?: string;
  targetDefinitionId?: string;
  language?: string;
  boardFqbn?: string;
  files?: readonly CodeFileLike[];
  origin?: CodeOrigin;
  revision?: number;
  contentSha256?: string;
  previewLink?: PreviewLink;
  inAppVerification?: "not-performed";
  dependencies?: readonly { ecosystem: string; name: string; version?: string }[];
}

interface CodeSourceConflict {
  /** The local files that were refused by the optimistic write. */
  localFiles: CodeFileLike[];
  /** The exact durable files observed at the conflict boundary. */
  newerFiles: CodeFileLike[];
  /** Whether a durable source document still existed at the conflict boundary. */
  newerExists: boolean;
  /** Exact hash accepted by a future explicit rebase, or null for create. */
  newerContentSha256: string | null;
  newerRevision?: number;
}

interface ProjectWithCodeDocuments {
  codeDocuments?: readonly CodeDocumentLike[];
  firmwareTargets?: readonly CodeDocumentLike[];
}

const CODE_SAVE_DEBOUNCE_MS = 280;

interface CodeDraft {
  /** Authenticated workspace owner at the moment this draft was created. */
  ownerId: string | null;
  projectId: string;
  componentId: string;
  files: CodeFileLike[];
  /** Source files at the moment the local draft was started. */
  baselineFiles: CodeFileLike[];
  /** Exact durable revision the draft is allowed to replace. */
  baselineContentSha256: string | null;
  language?: string;
  boardFqbn?: string;
  origin?: CodeOrigin;
  dirty: boolean;
  /** An optimistic conflict pauses autosave until the user chooses a path. */
  conflict?: CodeSourceConflict;
}

// Drafts outlive the panel component so a fast project/tab/route switch cannot
// destroy an edit before its debounce fires. A draft is still guarded by its
// authenticated owner, project id, and optimistic baseline hash before it can
// be flushed.
const sharedCodeDrafts = new Map<string, CodeDraft>();
const MAX_SHARED_CODE_DRAFTS = 64;
const MAX_SHARED_CODE_DRAFT_BYTES = 8 * 1024 * 1024;
let sharedCodeDraftOwnerId = getCurrentUserId();
let sharedCodeDraftCapacityError: string | null = null;

function codeDraftByteLength(draft: CodeDraft) {
  return new TextEncoder().encode(JSON.stringify({
    ownerId: draft.ownerId,
    projectId: draft.projectId,
    componentId: draft.componentId,
    files: draft.files,
    baselineFiles: draft.baselineFiles,
    conflict: draft.conflict,
  })).byteLength;
}

/** Keep route-surviving source drafts bounded and account-scoped. */
function pruneSharedCodeDrafts(ownerId = getCurrentUserId()) {
  sharedCodeDraftCapacityError = null;
  for (const [key, draft] of sharedCodeDrafts) {
    if (draft.ownerId !== ownerId) sharedCodeDrafts.delete(key);
  }

  let totalBytes = 0;
  for (const draft of sharedCodeDrafts.values()) totalBytes += codeDraftByteLength(draft);
  while (sharedCodeDrafts.size > MAX_SHARED_CODE_DRAFTS || totalBytes > MAX_SHARED_CODE_DRAFT_BYTES) {
    // Never evict dirty/conflicted source: those entries are the user's only
    // recovery copy and the UI explicitly promises to preserve them. Clean
    // route-surviving drafts are the reclaimable cache population.
    const oldest = [...sharedCodeDrafts.entries()].find(([, draft]) => !draft.dirty && !draft.conflict) as [string, CodeDraft] | undefined;
    if (!oldest) break;
    totalBytes -= codeDraftByteLength(oldest[1]);
    sharedCodeDrafts.delete(oldest[0]);
  }
  if (sharedCodeDrafts.size > MAX_SHARED_CODE_DRAFTS || totalBytes > MAX_SHARED_CODE_DRAFT_BYTES) {
    sharedCodeDraftCapacityError = "Draft cache capacity is reserved for unsaved source. Save or resolve an older draft before opening more source editors.";
  }
}

function syncSharedCodeDraftOwner() {
  const ownerId = getCurrentUserId();
  if (ownerId !== sharedCodeDraftOwnerId) sharedCodeDraftOwnerId = ownerId;
  pruneSharedCodeDrafts(ownerId);
}

function setSharedCodeDraft(key: string, draft: CodeDraft) {
  syncSharedCodeDraftOwner();
  sharedCodeDrafts.set(key, draft);
  pruneSharedCodeDrafts();
  return sharedCodeDraftCapacityError;
}

function cloneCodeFiles(files: readonly CodeFileLike[]) {
  return files.map((file) => ({ name: file.name, content: file.content }));
}

/**
 * A stable, order-independent source signature. It is intentionally not a
 * content hash: it is only used to decide whether a controlled editor value
 * needs to be synchronized after a project-store revision.
 */
function codeFilesSignature(files: readonly CodeFileLike[]) {
  return JSON.stringify([...files]
    .map((file) => [file.name, file.content] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function codeFilesEqual(left: readonly CodeFileLike[], right: readonly CodeFileLike[]) {
  return codeFilesSignature(left) === codeFilesSignature(right);
}

function editorDocumentKey(projectId: string, componentId: string | undefined) {
  // The store has one canonical source document per component target. Keying
  // by its generated document id creates a race at first write: a dirty
  // fallback draft would move to a different identity when another writer
  // creates that document. Room + project + target remain stable throughout
  // the whole optimistic-concurrency lifecycle.
  syncSharedCodeDraftOwner();
  return `${getCurrentUserId() ?? "anonymous"}:${projectId}:${componentId ?? "none"}`;
}

function configureEditorTheme(monaco: Monaco) {
  monaco.editor.defineTheme("schematic-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [{ token: "comment", foreground: "7CA668" }],
    colors: { "editor.background": "#18181b" },
  });
}

function languageFor(document: CodeDocumentLike | undefined, fallback = "cpp") {
  const language = document?.language ?? fallback;
  if (language === "micropython" || language === "python") return "python";
  if (language === "c" || language === "cpp" || language === "arduino") return "cpp";
  return language;
}

function originLabel(origin: CodeOrigin | undefined) {
  switch (origin) {
    case "ai-generated": return { label: "AI draft", icon: Sparkles, className: "code-origin-ai" };
    case "human-authored": return { label: "Human edited", icon: UserRound, className: "code-origin-human" };
    case "imported": return { label: "Imported", icon: PackageOpen, className: "code-origin-imported" };
    case "mixed": return { label: "Mixed", icon: UserRound, className: "code-origin-mixed" };
    default: return { label: "Editable source", icon: FileCode2, className: "code-origin-default" };
  }
}

function getDocuments(project: ProjectWithCodeDocuments) {
  // `codeDocuments` is canonical. `firmwareTargets` is a read-only migration
  // fallback so existing projects keep their source while they are upgraded.
  return project.codeDocuments?.length ? project.codeDocuments : (project.firmwareTargets ?? []);
}

function downloadTextFile(name: string, content: string, mime = "text/plain;charset=utf-8") {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name || "sketch.ino";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

const MAX_SOURCE_RECOVERY_ARTIFACT_BYTES = 1024 * 1024;

function downloadSourceFiles(
  prefix: string,
  files: readonly CodeFileLike[],
  details: { status?: "draft" | "available" | "deleted"; contentSha256?: string | null; revision?: number } = {},
) {
  // Keep recovery dependency-free and collision-free: a multi-file source
  // version is one bounded JSON artifact, never several flattened downloads.
  const artifact = {
    schemaVersion: 1,
    kind: "schematic.source-recovery",
    status: details.status ?? (files.length ? "available" : "deleted"),
    ...(details.contentSha256 !== undefined ? { contentSha256: details.contentSha256 } : {}),
    ...(details.revision !== undefined ? { revision: details.revision } : {}),
    files: cloneCodeFiles(files),
  };
  const pretty = JSON.stringify(artifact, null, 2);
  const serialized = new TextEncoder().encode(pretty).byteLength <= MAX_SOURCE_RECOVERY_ARTIFACT_BYTES
    ? pretty
    : JSON.stringify(artifact);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SOURCE_RECOVERY_ARTIFACT_BYTES) return false;
  downloadTextFile(`${prefix}.json`, serialized, "application/json;charset=utf-8");
  return true;
}

class CodeSourceConflictError extends Error {
  readonly current: CodeDocumentLike | null;
  readonly deleted: boolean;

  constructor(current: CodeDocumentLike | null, deleted = current === null) {
    super(deleted
      ? "The durable source was deleted outside this editor. Your draft was kept and was not recreated automatically."
      : "Source changed outside this editor. Your draft was kept and was not allowed to overwrite the newer revision.");
    this.name = "CodeSourceConflictError";
    this.current = current;
    this.deleted = deleted;
  }
}

function saveCodeDocument(
  componentId: string,
  files: CodeFileLike[],
  metadata: { language?: string; boardFqbn?: string; origin?: CodeOrigin },
  expectedContentSha256: string | null,
) {
  if (!files.length || files.length > MAX_CODE_FILES_PER_DOCUMENT) throw new Error(`A source document must contain 1–${MAX_CODE_FILES_PER_DOCUMENT} files.`);
  const fileNames = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (!isSafeRelativeCodePath(file.name)) throw new Error(`${file.name || "Source file"} is not a safe relative path.`);
    if (fileNames.has(file.name)) throw new Error(`${file.name} appears more than once.`);
    fileNames.add(file.name);
    const contentBytes = new TextEncoder().encode(file.content).byteLength;
    if (contentBytes > MAX_CODE_FILE_BYTES) throw new Error(`${file.name} exceeds the 1 MiB source-file limit.`);
    totalBytes += contentBytes;
    if (totalBytes > MAX_CODE_DOCUMENT_BYTES) throw new Error("A source document may contain at most 512 KiB across all files.");
  }
  const store = useProjectStore.getState() as ReturnType<typeof useProjectStore.getState> & {
    writeCodeDocument?: (request: { targetComponentId: string; targetDefinitionId?: string; files: readonly CodeFileLike[]; language: string; boardFqbn?: string; origin?: CodeOrigin; expectedContentSha256?: string | null }) => { document: CodeDocumentLike; conflict?: { current?: CodeDocumentLike; deleted?: boolean } };
  };
  if (store.writeCodeDocument) {
    const component = useProjectStore.getState().project.components.find((candidate) => candidate.id === componentId);
    if (component) {
      const result = store.writeCodeDocument({
        targetComponentId: componentId,
        targetDefinitionId: component.definitionId,
        files,
        language: metadata.language ?? "arduino",
        ...(metadata.boardFqbn ? { boardFqbn: metadata.boardFqbn } : {}),
        origin: metadata.origin,
        expectedContentSha256,
      });
      if (result.conflict) throw new CodeSourceConflictError(result.conflict.current ?? null, result.conflict.deleted === true || !result.conflict.current);
      return result.document;
    }
  }
  throw new Error("The durable code-document writer is unavailable. Your draft was kept.");
}

export default function MonacoWorkspace() {
  const activeId = useSelectionStore((state) => state.activeComponentId);
  const project = useProjectStore((state) => state.project);
  const active = project.components.find((component) => component.id === activeId);
  const selectedBoardId = active?.id;
  const binding = active ? resolveFirmwareBinding(project, active.id) : null;
  const isBoard = binding?.definition?.category === "board";
  const projectWithDocuments = project as typeof project & ProjectWithCodeDocuments;
  const documentForBoard = selectedBoardId
    ? getDocuments(projectWithDocuments).find((document) => (document.targetComponentId ?? document.componentId) === selectedBoardId)
    : undefined;
  const fallbackFileName = binding?.targetConfig?.fileName ?? "sketch.ino";
  const files = documentForBoard?.files?.length ? documentForBoard.files : [{ name: fallbackFileName, content: DEFAULT_SKETCH }];
  const [activeFileName, setActiveFileName] = useState(files[0]?.name ?? "sketch.ino");
  const [code, setCode] = useState(files[0]?.content ?? DEFAULT_SKETCH);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftFilesByKey, setDraftFilesByKey] = useState<Record<string, CodeFileLike[]>>({});
  const [conflictsByKey, setConflictsByKey] = useState<Record<string, CodeSourceConflict | undefined>>({});
  const previewSnapshotHash = useBehaviorPreviewStore((state) => state.snapshot?.snapshotSha256);
  const draftsRef = useRef(sharedCodeDrafts);
  const saveTimersRef = useRef(new Map<string, number>());
  const savedStateTimerRef = useRef<number | null>(null);
  const activeFileNamesRef = useRef(new Map<string, string>());
  const editorIdentityRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const previewLink = documentForBoard?.previewLink;
  const origin = originLabel(documentForBoard?.origin);
  const OriginIcon = origin.icon;
  const documentKey = editorDocumentKey(project.id, selectedBoardId);
  const sourceFileSignature = codeFilesSignature(files);
  const visibleFiles = draftFilesByKey[documentKey] ?? files;
  const currentFile = visibleFiles.find((file) => file.name === activeFileName) ?? visibleFiles[0];

  const clearSaveTimer = useCallback((key: string) => {
    const timer = saveTimersRef.current.get(key);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    saveTimersRef.current.delete(key);
  }, []);

  const flushDraft = useCallback((key: string) => {
    const draft = draftsRef.current.get(key);
    if (!draft?.dirty) return;

    // A debounced callback may fire after the user changed projects. Never
    // write an old project's source into the newly active project. The draft
    // remains in memory so returning to that project can resume and flush it.
    if (getCurrentUserId() !== draft.ownerId) return;
    if (useProjectStore.getState().project.id !== draft.projectId) return;

    try {
      const savedDocument = saveCodeDocument(draft.componentId, cloneCodeFiles(draft.files), {
        language: draft.language,
        boardFqbn: draft.boardFqbn,
        origin: draft.origin,
      }, draft.baselineContentSha256);
      const savedFiles = cloneCodeFiles(draft.files);
      setSharedCodeDraft(key, { ...draft, files: savedFiles, baselineFiles: savedFiles, baselineContentSha256: savedDocument?.contentSha256 ?? draft.baselineContentSha256, dirty: false, conflict: undefined });
      setConflictsByKey((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
      if (mountedRef.current && editorIdentityRef.current === key) {
        setSaveState("saved");
        setSaveError(null);
        if (savedStateTimerRef.current !== null) window.clearTimeout(savedStateTimerRef.current);
        savedStateTimerRef.current = window.setTimeout(() => {
          savedStateTimerRef.current = null;
          if (mountedRef.current && editorIdentityRef.current === key) setSaveState("idle");
        }, 1200);
      }
    } catch (error) {
      // Keep the draft dirty so a later edit or project revisit can retry. A
      // visible error is preferable to claiming the source was persisted.
      if (error instanceof CodeSourceConflictError) {
        const newerExists = !error.deleted && Boolean(error.current);
        const conflict: CodeSourceConflict = {
          localFiles: cloneCodeFiles(draft.files),
          newerFiles: cloneCodeFiles(error.current?.files ?? []),
          newerExists,
          newerContentSha256: error.current?.contentSha256 ?? null,
          ...(typeof error.current?.revision === "number" ? { newerRevision: error.current.revision } : {}),
        };
        const conflictedDraft = { ...draft, conflict };
        const capacityError = setSharedCodeDraft(key, conflictedDraft);
        if (mountedRef.current && editorIdentityRef.current === key) setConflictsByKey((current) => ({ ...current, [key]: conflict }));
        if (mountedRef.current && editorIdentityRef.current === key && capacityError) setSaveError(capacityError);
      }
      if (mountedRef.current && editorIdentityRef.current === key) {
        setSaveState("error");
        setSaveError(error instanceof Error ? error.message : "Source save failed. Your draft was kept.");
      }
    }
  }, []);

  const scheduleDraftSave = useCallback((key: string) => {
    clearSaveTimer(key);
    if (mountedRef.current && editorIdentityRef.current === key) {
      setSaveState("saving");
      setSaveError(null);
    }
    saveTimersRef.current.set(key, window.setTimeout(() => {
      saveTimersRef.current.delete(key);
      flushDraft(key);
    }, CODE_SAVE_DEBOUNCE_MS));
  }, [clearSaveTimer, flushDraft]);

  // Monaco is a controlled editor, but the project store is also reactive.
  // Synchronize only on a real source identity/content change. A local save
  // increments the document revision; matching the draft files means that
  // revision is our own and must not replace Monaco's model/cursor.
  useEffect(() => {
    const identityChanged = editorIdentityRef.current !== documentKey;
    editorIdentityRef.current = documentKey;
    const draft = draftsRef.current.get(documentKey);
    const incomingFiles = cloneCodeFiles(files);

    if (draft && codeFilesEqual(draft.files, incomingFiles)) {
      if (draft.dirty && !saveTimersRef.current.has(documentKey)) scheduleDraftSave(documentKey);
      if (!identityChanged) return;
    } else if (draft?.dirty) {
      // Preserve local edits when another project-store writer advances the
      // same document. The next debounced write retains all edited files.
      // Once an optimistic conflict is recorded, autosave is intentionally
      // paused. Retrying the same stale baseline would turn an actionable
      // conflict into a loop and could hide the fact that a choice is needed.
      if (!draft.conflict && !saveTimersRef.current.has(documentKey)) scheduleDraftSave(documentKey);
      if (!identityChanged) return;
    } else if (draft?.conflict) {
      // A conflict remains recoverable even if another writer advances the
      // durable source again or the user navigates away and back. Keep the
      // selected draft version visible until the user explicitly resolves it.
      if (!identityChanged) return;
    } else if (draft) {
      // A clean draft that no longer matches is an external source update.
      // Drop the cached copy and let the incoming document become authoritative.
      draftsRef.current.delete(documentKey);
      setDraftFilesByKey((current) => {
        if (!(documentKey in current)) return current;
        const next = { ...current };
        delete next[documentKey];
        return next;
      });
    }

    const source = draftsRef.current.get(documentKey)?.files ?? incomingFiles;
    const preferredName = activeFileNamesRef.current.get(documentKey) ?? activeFileName;
    const file = source.find((candidate) => candidate.name === preferredName) ?? source[0];
    activeFileNamesRef.current.set(documentKey, file?.name ?? "sketch.ino");
    setActiveFileName(file?.name ?? "sketch.ino");
    setCode(file?.content ?? DEFAULT_SKETCH);
  // `sourceFileSignature` is the content identity; depending on the files
  // array itself would make a fallback document look external on every render.
  // Revision is retained for metadata-only external updates and for tests.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, sourceFileSignature, documentForBoard?.revision, scheduleDraftSave]);

  useEffect(() => {
    mountedRef.current = true;
    const saveTimers = saveTimersRef.current;
    const drafts = draftsRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of saveTimers.values()) window.clearTimeout(timer);
      saveTimers.clear();
      // Flush drafts for the active project before unmounting. Drafts belonging
      // to another project remain dirty and cannot cross the project boundary.
      for (const key of drafts.keys()) flushDraft(key);
      if (savedStateTimerRef.current !== null) window.clearTimeout(savedStateTimerRef.current);
      savedStateTimerRef.current = null;
    };
  }, [flushDraft]);

  // Auth transitions can leave this route-mounted editor alive while the
  // session room changes. Purge both the shared source cache and React's
  // visible draft/conflict projections at that boundary.
  useEffect(() => {
    const purgeForSessionChange = () => {
      syncSharedCodeDraftOwner();
      setDraftFilesByKey((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([key]) => sharedCodeDrafts.has(key)));
        return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
      setConflictsByKey((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([key]) => sharedCodeDrafts.has(key)));
        return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
    };
    purgeForSessionChange();
    if (typeof window === "undefined") return;
    window.addEventListener("schematic-session", purgeForSessionChange);
    return () => window.removeEventListener("schematic-session", purgeForSessionChange);
  }, []);

  const conflict = conflictsByKey[documentKey];

  // A route remount can find a conflict in the shared draft cache before the
  // local React projection has been reconstructed. Do that ref read in an
  // effect (never during render), then render the same recoverable conflict
  // controls used by an in-place save failure.
  useEffect(() => {
    const cachedConflict = draftsRef.current.get(documentKey)?.conflict;
    if (!cachedConflict) return;
    setConflictsByKey((current) => current[documentKey] ? current : { ...current, [documentKey]: cachedConflict });
  }, [documentKey]);

  const showConflictFiles = useCallback((nextFiles: readonly CodeFileLike[]) => {
    const clonedFiles = cloneCodeFiles(nextFiles);
    const preferredName = activeFileNamesRef.current.get(documentKey) ?? activeFileName;
    const file = clonedFiles.find((candidate) => candidate.name === preferredName) ?? clonedFiles[0];
    activeFileNamesRef.current.set(documentKey, file?.name ?? "sketch.ino");
    setActiveFileName(file?.name ?? "sketch.ino");
    setCode(file?.content ?? DEFAULT_SKETCH);
    setDraftFilesByKey((current) => ({ ...current, [documentKey]: clonedFiles }));
  }, [activeFileName, documentKey]);

  const useNewerConflictSource = useCallback(() => {
    const draft = draftsRef.current.get(documentKey);
    const currentConflict = conflictsByKey[documentKey] ?? draft?.conflict;
    if (!draft || !currentConflict) return;
    clearSaveTimer(documentKey);
    const newerFiles = cloneCodeFiles(currentConflict.newerFiles);
    setSharedCodeDraft(documentKey, {
      ...draft,
      files: newerFiles,
      baselineFiles: newerFiles,
      baselineContentSha256: currentConflict.newerContentSha256,
      dirty: false,
      conflict: undefined,
    });
    setConflictsByKey((current) => {
      if (!(documentKey in current)) return current;
      const next = { ...current };
      delete next[documentKey];
      return next;
    });
    if (currentConflict.newerExists) {
      showConflictFiles(newerFiles);
    } else {
      // A delete is an explicit resolution too: remove the stale draft and
      // return to the ordinary empty-document fallback rather than displaying
      // an editor with no selected source file.
      draftsRef.current.delete(documentKey);
      setDraftFilesByKey((current) => {
        if (!(documentKey in current)) return current;
        const next = { ...current };
        delete next[documentKey];
        return next;
      });
      activeFileNamesRef.current.set(documentKey, fallbackFileName);
      setActiveFileName(fallbackFileName);
      setCode(DEFAULT_SKETCH);
    }
    setSaveState("idle");
    setSaveError(null);
  }, [clearSaveTimer, conflictsByKey, documentKey, fallbackFileName, showConflictFiles]);

  const restoreLocalConflictDraft = () => {
    const draft = draftsRef.current.get(documentKey);
    const currentConflict = conflictsByKey[documentKey] ?? draft?.conflict;
    if (!draft || !currentConflict) return;
    clearSaveTimer(documentKey);
    const localFiles = cloneCodeFiles(currentConflict.localFiles);
    setSharedCodeDraft(documentKey, { ...draft, files: localFiles, dirty: true, conflict: currentConflict });
    showConflictFiles(localFiles);
    setSaveState("error");
    setSaveError("Your local draft is restored. Review both versions, then explicitly rebase it before saving.");
  };

  const rebaseLocalConflictDraft = () => {
    const draft = draftsRef.current.get(documentKey);
    const currentConflict = conflictsByKey[documentKey] ?? draft?.conflict;
    if (!draft || !currentConflict) return;
    clearSaveTimer(documentKey);
    const localFiles = cloneCodeFiles(currentConflict.localFiles);
    const rebasedDraft: CodeDraft = {
      ...draft,
      files: localFiles,
      baselineFiles: cloneCodeFiles(currentConflict.newerFiles),
      baselineContentSha256: currentConflict.newerContentSha256,
      dirty: true,
      conflict: undefined,
    };
    setSharedCodeDraft(documentKey, rebasedDraft);
    setConflictsByKey((current) => {
      if (!(documentKey in current)) return current;
      const next = { ...current };
      delete next[documentKey];
      return next;
    });
    showConflictFiles(localFiles);
    setSaveState("saving");
    setSaveError(null);
    scheduleDraftSave(documentKey);
  };

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

  const handleCodeChange = (value: string) => {
    setCode(value);
    if (!active || !isBoard || !currentFile) return;
    const key = documentKey;
    const existingDraft = draftsRef.current.get(key);
    const baseFiles = existingDraft?.files ?? cloneCodeFiles(files);
    const nextFiles = baseFiles.map((file) => file.name === currentFile.name ? { ...file, content: value } : { ...file });
    const draft: CodeDraft = existingDraft ?? {
      ownerId: getCurrentUserId(),
      projectId: project.id,
      componentId: active.id,
      files: cloneCodeFiles(files),
      baselineFiles: cloneCodeFiles(files),
      baselineContentSha256: documentForBoard?.contentSha256 ?? null,
      language: documentForBoard?.language ?? binding?.targetConfig?.language,
      boardFqbn: documentForBoard?.boardFqbn ?? binding?.targetConfig?.fqbn,
      origin: documentForBoard?.origin === "ai-generated" ? "mixed" : (documentForBoard?.origin ?? "human-authored"),
      dirty: false,
    };
    const conflict = existingDraft?.conflict
      ? { ...existingDraft.conflict, localFiles: cloneCodeFiles(nextFiles) }
      : undefined;
    const capacityError = setSharedCodeDraft(key, { ...draft, files: nextFiles, dirty: true, ...(conflict ? { conflict } : {}) });
    setDraftFilesByKey((current) => ({ ...current, [key]: nextFiles }));
    editorIdentityRef.current = key;
    if (conflict) {
      setConflictsByKey((current) => ({ ...current, [key]: conflict }));
      setSaveState("error");
      setSaveError(capacityError ?? "Source conflict needs an explicit reload or rebase before Schematic can save this draft.");
    } else {
      scheduleDraftSave(key);
      if (capacityError) {
        setSaveState("error");
        setSaveError(capacityError);
      }
    }
  };

  const handleFileSelect = (name: string) => {
    const source = draftsRef.current.get(documentKey)?.files ?? files;
    const file = source.find((candidate) => candidate.name === name);
    if (!file) return;
    activeFileNamesRef.current.set(documentKey, name);
    setActiveFileName(name);
    setCode(file.content);
  };

  const isDark = typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true;

  if (!active || !isBoard) {
    return (
      <div className="h-full flex flex-col bg-card">
        <div className="h-8 px-2 flex items-center justify-between border-b border-border bg-muted/20 shrink-0">
          <div className="flex items-center gap-1.5 text-xs"><FileCode2 size={12} className="text-muted-foreground" /><span className="font-medium">Code</span><span className="text-muted-foreground hidden sm:inline">· select a board</span></div>
          <button type="button" onClick={() => void copyCode()} className="w-7 h-7 rounded hover:bg-muted flex items-center justify-center text-muted-foreground" title={copied ? "Copied" : "Copy source"} aria-label={copied ? "Source copied" : "Copy source"}>{copied ? <span className="text-[10px] text-emerald-500">✓</span> : <Copy size={11} />}</button>
        </div>
        <div className="flex-1 min-h-[160px] relative"><Editor height="100%" beforeMount={configureEditorTheme} theme={isDark ? "schematic-dark" : "light"} language="cpp" value={DEFAULT_SKETCH} options={{ ...EDITOR_OPTIONS, readOnly: true }} /></div>
        <div className="px-2 py-2 border-t border-border bg-muted/20 text-[11px] leading-snug text-muted-foreground">Select a programmable board to open its editable source document. This panel never compiles or runs source.</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card" data-testid="code-authoring-panel">
      <div className="min-h-8 flex flex-wrap items-center justify-between gap-1 px-2 py-1 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0"><div className="w-6 h-6 rounded border bg-card flex items-center justify-center shrink-0"><FileCode2 size={11} /></div><span className="text-xs font-medium truncate">Code · {active.id}</span><span className={`code-origin-badge ${origin.className}`} title={origin.label}><OriginIcon size={10} /> {origin.label}</span>{saveState === "saving" && <span className="text-[10px] text-muted-foreground">Saving…</span>}{saveState === "saved" && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Saved</span>}{saveState === "error" && <span className="text-[10px] text-red-600 dark:text-red-400" title={saveError ?? undefined}>Save failed — draft kept</span>}</div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void copyCode()} className="w-7 h-7 rounded border border-border hover:bg-muted flex items-center justify-center" title={copied ? "Copied" : "Copy current file"} aria-label={copied ? "Source copied" : "Copy current file"}>{copied ? <span className="text-[10px] text-emerald-500">✓</span> : <Copy size={11} />}</button>
          <button type="button" onClick={() => downloadTextFile(currentFile?.name ?? "sketch.ino", code)} className="w-7 h-7 rounded border border-border hover:bg-muted flex items-center justify-center" title="Download current source file" aria-label="Download current source file"><Download size={11} /></button>
        </div>
      </div>

      <div className="code-authoring-meta border-b border-border bg-card px-2 py-2 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {previewLink?.status === "linked" && <span className="code-link-badge is-linked"><Link2 size={10} /> Preview mapped</span>}
          {previewLink?.status === "stale" && <span className="code-link-badge is-stale"><AlertTriangle size={10} /> Preview link stale</span>}
          {(!previewLink || previewLink.status === "unlinked") && <span className="code-link-badge"><Link2 size={10} /> Preview unlinked</span>}
          {documentForBoard?.revision !== undefined && <span className="font-mono text-[9px] text-muted-foreground">rev {documentForBoard.revision}</span>}
          {previewSnapshotHash && <span className="font-mono text-[9px] text-muted-foreground">plan {previewSnapshotHash.slice(0, 8)}</span>}
        </div>
        <p className="code-authoring-notice">Editable source for external use. Schematic has not compiled, uploaded, run, or physically tested this code. Behavior Preview follows the Behavior Plan.</p>
      </div>

      {conflict && <div className="border-b border-amber-500/30 bg-amber-500/10 px-2 py-2 text-[11px] leading-snug" role="alert" data-testid="code-source-conflict">
        <div className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <p><strong>Source conflict.</strong> {conflict.newerExists ? "A newer durable revision was found." : "The durable source was deleted by another writer."} Your local draft is preserved; Schematic will not overwrite or recreate it automatically.</p>
        </div>
        <p className="mt-1 text-amber-900/70 dark:text-amber-100/70">{conflict.newerExists ? `Newer source${conflict.newerRevision !== undefined ? ` · revision ${conflict.newerRevision}` : ""} · ${conflict.newerFiles.length} file${conflict.newerFiles.length === 1 ? "" : "s"}.` : "No newer files remain; the durable version is represented by a deletion tombstone."} Download either version before choosing a resolution.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => downloadSourceFiles("schematic-local-draft", conflict.localFiles, { status: "draft" })} className="rounded border border-amber-500/40 px-2 py-1 font-medium text-amber-900 hover:bg-amber-500/15 dark:text-amber-100" aria-label="Download local draft">Download local draft</button>
          <button type="button" onClick={() => downloadSourceFiles("schematic-newer-source", conflict.newerFiles, { status: conflict.newerExists ? "available" : "deleted", contentSha256: conflict.newerContentSha256, revision: conflict.newerRevision })} className="rounded border border-amber-500/40 px-2 py-1 font-medium text-amber-900 hover:bg-amber-500/15 dark:text-amber-100" aria-label="Download newer source">Download newer source</button>
          <button type="button" onClick={useNewerConflictSource} className="rounded border border-border bg-card px-2 py-1 font-medium text-foreground hover:bg-muted" aria-label="Reload newer source">Reload newer source</button>
          <button type="button" onClick={restoreLocalConflictDraft} className="rounded border border-border bg-card px-2 py-1 font-medium text-foreground hover:bg-muted" aria-label="Restore local draft">Restore local draft</button>
          <button type="button" onClick={rebaseLocalConflictDraft} className="rounded bg-foreground px-2 py-1 font-medium text-background hover:opacity-90" aria-label="Rebase and save local draft">Rebase &amp; save local draft</button>
        </div>
      </div>}

      {visibleFiles.length > 1 && <div className="flex min-h-7 items-center gap-1 overflow-x-auto border-b border-border px-2" role="tablist" aria-label="Source files">
        {visibleFiles.map((file) => <button type="button" role="tab" aria-selected={file.name === currentFile?.name} key={file.name} onClick={() => handleFileSelect(file.name)} className={`code-file-tab ${file.name === currentFile?.name ? "is-active" : ""}`}>{file.name}</button>)}
      </div>}

      <div className="flex-1 min-h-[120px] relative"><Editor height="100%" beforeMount={configureEditorTheme} theme={isDark ? "schematic-dark" : "light"} language={languageFor(documentForBoard, binding?.targetConfig?.editorLanguage)} value={code} onChange={(value) => handleCodeChange(value ?? "")} options={EDITOR_OPTIONS} /></div>
      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5 truncate"><FileDown size={10} /> {currentFile?.name ?? "sketch.ino"} · {code.length.toLocaleString()} chars</span>
        <span className="shrink-0">Not tested in Schematic</span>
      </div>
    </div>
  );
}
