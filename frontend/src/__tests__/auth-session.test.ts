import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthModule = typeof import("../auth/session.ts");

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sessionResponse(subject: string, token: string) {
  return new Response(JSON.stringify({
    authenticated: true,
    subject,
    token,
    expiresIn: 300,
    environment: "chatgpt-sites",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function installHostedWindow() {
  const hostedWindow = Object.create(window) as Window;
  Object.defineProperty(hostedWindow, "location", {
    configurable: true,
    value: { hostname: "schematic.hardware-workspace.chatgpt.site", port: "443", protocol: "https:" },
  });
  const dispatchEvent = vi.fn(() => true);
  Object.defineProperty(hostedWindow, "dispatchEvent", { configurable: true, value: dispatchEvent });
  vi.stubGlobal("window", hostedWindow);
  return { dispatchEvent };
}

describe("browser auth session lifecycle", () => {
  let auth: AuthModule;

  beforeEach(async () => {
    // The module owns a process-wide cache. A fresh module keeps each race
    // isolated without adding a production-only cache reset API.
    vi.resetModules();
    auth = await import("../auth/session.ts");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps a hosted shared refresh alive when one caller aborts", async () => {
    const { dispatchEvent } = installHostedWindow();
    const request = deferred<Response>();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined();
      return request.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const abortedCaller = auth.getAuthSession(false, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(abortedCaller).rejects.toMatchObject({ name: "AbortError" });
    expect(dispatchEvent).not.toHaveBeenCalled();

    // A second caller joins the same unabortable refresh and receives the
    // hosted identity even though the first caller stopped waiting.
    const survivingCaller = auth.getAuthSession();
    request.resolve(sessionResponse("hosted-user", "hosted-token"));
    await expect(survivingCaller).resolves.toMatchObject({ subject: "hosted-user", token: "hosted-token" });
    await expect(auth.getAuthSession()).resolves.toMatchObject({ subject: "hosted-user", token: "hosted-token" });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("does not let a slower older refresh overwrite a newer force refresh", async () => {
    const { dispatchEvent } = installHostedWindow();
    const olderRequest = deferred<Response>();
    const newerRequest = deferred<Response>();
    const requests = [olderRequest, newerRequest];
    const fetchMock = vi.fn(() => {
      const next = requests.shift();
      if (!next) throw new Error("Unexpected extra session request");
      return next.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    const older = auth.getAuthSession();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const newer = auth.getAuthSession(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    newerRequest.resolve(sessionResponse("new-user", "new-token"));
    await expect(newer).resolves.toMatchObject({ subject: "new-user", token: "new-token" });

    olderRequest.resolve(sessionResponse("old-user", "old-token"));
    await expect(older).resolves.toMatchObject({ subject: "new-user", token: "new-token" });

    // Even a caller that began on the superseded request observes the winning
    // identity; no consumer is allowed to proceed with uncached stale auth.
    await expect(auth.getAuthSession()).resolves.toMatchObject({ subject: "new-user", token: "new-token" });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });
});
