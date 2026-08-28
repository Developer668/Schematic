import { failure, storageError } from "./errors";
import type {
  DebouncedWorkspaceSaver,
  SaveWorkspaceOptions,
  StorageResult,
  StoredWorkspace,
  WorkspaceSnapshot,
} from "./types";
import type { ProjectRepository } from "./repository";

export function createDebouncedWorkspaceSaver<TProject>(
  repository: Pick<ProjectRepository<TProject>, "saveWorkspace">,
  delayMs = 500,
): DebouncedWorkspaceSaver<TProject> {
  const safeDelay = Math.max(0, Math.floor(delayMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: { workspace: WorkspaceSnapshot<TProject>; options?: SaveWorkspaceOptions } | undefined;
  let waiters: Array<(result: StorageResult<StoredWorkspace<TProject>>) => void> = [];
  let running: Promise<StorageResult<StoredWorkspace<TProject>> | null> | undefined;

  const flush = async (): Promise<StorageResult<StoredWorkspace<TProject>> | null> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (running) return running;
    if (!latest) return null;

    const job = latest;
    latest = undefined;
    const currentWaiters = waiters;
    waiters = [];
    let task: Promise<StorageResult<StoredWorkspace<TProject>>>;
    task = repository.saveWorkspace(job.workspace, job.options)
      .then((result) => {
        if (running === task) running = undefined;
        currentWaiters.forEach((resolve) => resolve(result));
        return result;
      })
      .catch((error: unknown) => {
        const result = failure<StoredWorkspace<TProject>>(storageError(
          "unknown",
          "save",
          error instanceof Error ? error.message : "The debounced save failed.",
          { retryable: true },
        ));
        if (running === task) running = undefined;
        currentWaiters.forEach((resolve) => resolve(result));
        return result;
      });
    running = task;
    return running;
  };

  const schedule = (
    workspace: WorkspaceSnapshot<TProject>,
    options?: SaveWorkspaceOptions,
  ): Promise<StorageResult<StoredWorkspace<TProject>>> => {
    latest = { workspace, options };
    const promise = new Promise<StorageResult<StoredWorkspace<TProject>>>((resolve) => {
      waiters.push(resolve);
    });
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, safeDelay);
    return promise;
  };

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    latest = undefined;
    const result = failure<StoredWorkspace<TProject>>(storageError(
      "aborted",
      "save",
      "The debounced save was cancelled before it ran.",
      { retryable: true },
    ));
    const currentWaiters = waiters;
    waiters = [];
    currentWaiters.forEach((resolve) => resolve(result));
  };

  return {
    schedule,
    flush,
    cancel,
    get pending() {
      return latest !== undefined || timer !== undefined || running !== undefined;
    },
  };
}
