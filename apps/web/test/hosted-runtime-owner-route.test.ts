import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const edges = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
  authenticate: vi.fn(), backend: vi.fn(), retire: vi.fn(), release: vi.fn(),
  authorize: vi.fn(), notify: vi.fn(), loaded: vi.fn(),
}));
vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(), after: edges.after,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest: edges.authenticate,
}));
vi.mock("@/src/lib/hosted-execution/runtime-cutover", () => ({
  readHostedRuntimeMemberBackend: edges.backend,
}));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({
  retireHostedRuntime: edges.retire,
  releaseHostedRuntimeAfterCompletion: edges.release,
  authorizeHostedRuntimeProvider: edges.authorize,
}));
vi.mock("@/src/lib/hosted-orchestration/runtime-owner-release", () => {
  edges.loaded("completion");
  return { notifyHostedRuntimeOwnerCompletion: edges.notify };
});
vi.mock("@/src/lib/hosted-execution/runtime-materialization", () => {
  edges.loaded("legacy");
  return {};
});
vi.mock("@/src/lib/hosted-execution/runtime-upload-recovery", () => {
  edges.loaded("uploads");
  return {};
});

const command = {
  operation: "complete", attemptId: "synthetic-attempt", generation: "7",
  settledRunnerContainerName: "synthetic-slot", immediateRecheckRequested: true,
};
const identity = { userId: "synthetic-member", attemptId: command.attemptId, generation: command.generation };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function post() {
  const { POST } = await import("../app/api/internal/hosted-runtime/owner/route");
  return POST(new Request("https://example.test/api/internal/hosted-runtime/owner", { method: "POST" }));
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  edges.authenticate.mockResolvedValue({ userId: identity.userId, payload: command });
  edges.backend.mockResolvedValue("postgres");
  edges.retire.mockResolvedValue(true);
  edges.release.mockResolvedValue(true);
  edges.authorize.mockResolvedValue({ cutover: "postgres", owner: null });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("runtime ownership response", () => {
  it("waits for committed release, then responds before loading or waiting for the advisory hint", async () => {
    const release = createDeferred<boolean>();
    const releasing = createDeferred<void>();
    edges.release.mockImplementationOnce(() => { releasing.resolve(); return release.promise; });
    const response = post();
    await releasing.promise;
    expect(edges.retire).toHaveBeenCalledExactlyOnceWith({ prisma: {}, identity, completed: true });
    expect(edges.release).toHaveBeenCalledExactlyOnceWith({ prisma: {}, identity, runnerContainerName: command.settledRunnerContainerName });
    expect(edges.after).not.toHaveBeenCalled();
    expect(edges.loaded).not.toHaveBeenCalled();

    release.resolve(true);
    await expect((await response).json()).resolves.toEqual({ cutover: "postgres", status: "updated", owner: null });
    expect(edges.after).toHaveBeenCalledOnce();
    expect(edges.loaded).not.toHaveBeenCalled();
    expect(edges.notify).not.toHaveBeenCalled();

    const notification = createDeferred<void>();
    edges.notify.mockReturnValueOnce(notification.promise);
    const deferred = edges.after.mock.calls[0]![0]();
    await vi.waitFor(() => expect(edges.notify).toHaveBeenCalledExactlyOnceWith({
      userId: identity.userId, runtimeAttemptId: command.attemptId, immediateRecheckRequested: true,
    }));
    notification.resolve();
    await deferred;
  });

  it("preserves early completion without native release and retains its recheck flag", async () => {
    edges.authenticate.mockResolvedValueOnce({ userId: identity.userId, payload: {
      ...command, settledRunnerContainerName: null, immediateRecheckRequested: false,
    } });
    expect((await post()).status).toBe(200);
    expect(edges.release).not.toHaveBeenCalled();
    await edges.after.mock.calls[0]![0]();
    expect(edges.notify).toHaveBeenCalledExactlyOnceWith({
      userId: identity.userId, runtimeAttemptId: command.attemptId, immediateRecheckRequested: false,
    });
  });

  it.each(["retire", "release"] as const)("never schedules a hint for stale %s", async (stage) => {
    edges[stage].mockResolvedValueOnce(false);
    await expect((await post()).json()).resolves.toMatchObject({ status: "stale" });
    expect(edges.after).not.toHaveBeenCalled();
    expect(edges.loaded).not.toHaveBeenCalled();
    if (stage === "retire") expect(edges.release).not.toHaveBeenCalled();
  });

  it.each(["authenticate", "retire", "release"] as const)("never schedules a hint when %s fails", async (stage) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    edges[stage].mockRejectedValueOnce(new Error("synthetic failure"));
    expect((await post()).status).toBe(500);
    expect(edges.after).not.toHaveBeenCalled();
    expect(edges.loaded).not.toHaveBeenCalled();
  });

  it("rejects malformed completion before mutating ownership", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    edges.authenticate.mockResolvedValueOnce({ userId: identity.userId, payload: { ...command, generation: "invalid" } });
    expect((await post()).ok).toBe(false);
    expect(edges.retire).not.toHaveBeenCalled();
    expect(edges.after).not.toHaveBeenCalled();
  });

  it("authorizes providers without loading completion, legacy, or upload recovery", async () => {
    const payload = { operation: "authorize_provider", runnerContainerName: "synthetic-slot",
      providerEgressTokenHash: null, providerKind: "linq" };
    edges.authenticate.mockResolvedValueOnce({ userId: identity.userId, payload });
    await expect((await post()).json()).resolves.toEqual({ cutover: "postgres", status: "blocked", owner: null });
    expect(edges.authorize).toHaveBeenCalledExactlyOnceWith({ ...payload, prisma: {}, userId: identity.userId });
    expect(edges.after).not.toHaveBeenCalled();
    expect(edges.loaded).not.toHaveBeenCalled();
    expect(edges.backend).not.toHaveBeenCalled();
  });

  it.each(["legacy", "draining"])("uses the locked authorization result for %s routing", async (cutover) => {
    edges.authenticate.mockResolvedValueOnce({ userId: identity.userId, payload: {
      operation: "authorize_provider", runnerContainerName: null,
      providerEgressTokenHash: "c".repeat(64), providerKind: "linq",
    } });
    edges.authorize.mockResolvedValueOnce({ cutover, owner: null });
    await expect((await post()).json()).resolves.toEqual({ cutover, status: "blocked", owner: null });
    expect(edges.backend).not.toHaveBeenCalled();
  });
});
