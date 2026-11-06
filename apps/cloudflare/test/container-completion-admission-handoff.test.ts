import { afterEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";
import "../src/container-entrypoint-heavy-runtime.js";

const mocks = vi.hoisted(() => ({
  recordHostedContainerRuntimeCompletionBestEffort: vi.fn(async () => undefined),
  runHostedWorkspaceInvocation: vi.fn(),
}));

vi.mock("../src/hosted-workspace-invocation.js", async () => ({
  ...await vi.importActual<typeof import("../src/hosted-workspace-invocation.js")>(
    "../src/hosted-workspace-invocation.js",
  ),
  runHostedWorkspaceInvocation: mocks.runHostedWorkspaceInvocation,
}));

vi.mock("../src/container-runtime-completion.js", () => ({
  recordHostedContainerRuntimeCompletionBestEffort: mocks.recordHostedContainerRuntimeCompletionBestEffort,
}));

import { startHostedContainerEntrypoint } from "../src/container-entrypoint.js";
import { RunnerContainer } from "../src/runner-container.ts";

const servers: Array<Awaited<ReturnType<typeof startHostedContainerEntrypoint>>> = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

function invocationBody(attemptId: string) {
  return JSON.stringify({
    hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    job: {
      kind: "workspace-invocation",
      request: { attemptId, leaseGeneration: "3", userId: "member_synthetic", workspaceVersion: "1" },
    },
  });
}

function storageDouble() {
  const values = new Map<string, unknown>();
  return {
    async delete(key: string) { return values.delete(key); },
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async list<T>(options?: { prefix?: string }) {
      return new Map([...values].filter(([key]) => !options?.prefix || key.startsWith(options.prefix)) as Array<[string, T]>);
    },
    async put<T>(key: string, value: T) { values.set(key, value); },
  };
}

// A real Durable Object controller whose container port is the real entrypoint.
function controllerFor(port: number, input: { reportSettling: boolean }) {
  const forward = async (url: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${port}${new URL(url).pathname}`, init);
    if (input.reportSettling || !new URL(url).pathname.endsWith("/health")) return response;
    const { settlingCompletionCallbackCount: _omitted, ...olderChild } = await response.json() as Record<string, unknown>;
    return Response.json(olderChild);
  };
  const storage = storageDouble();
  const container = new RunnerContainer({
    container: { running: true, getTcpPort: () => ({ fetch: forward }) },
    storage,
  } as never, {} as never);
  const destroy = vi.fn(async () => undefined);
  Object.assign(container, {
    containerFetch: forward,
    destroy,
    getState: async () => ({ lastChange: Date.now(), status: "running" }),
    start: vi.fn(),
    startAndWaitForPorts: vi.fn(),
    storage,
  });
  return { container, destroy };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function finishedJobWithHeldCallback() {
  const releaseCallback = deferred();
  const callbackStarted = deferred();
  mocks.runHostedWorkspaceInvocation.mockResolvedValue({ nextWakeAt: null, redactedStatus: {}, status: "idle" });
  mocks.recordHostedContainerRuntimeCompletionBestEffort.mockImplementationOnce(async () => {
    callbackStarted.resolve();
    await releaseCallback.promise;
  });
  const server = await startHostedContainerEntrypoint({ port: 0 });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP port.");
  const invoke = (attemptId: string) => fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
    body: invocationBody(attemptId),
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST",
  });
  const finished = await invoke("attempt_synthetic_previous");
  expect(finished.status).toBe(200);
  await finished.arrayBuffer();
  const resultAt = performance.now();
  await callbackStarted.promise;
  return { invoke, port: address.port, releaseCallback, resultAt };
}

describe("completion callback admission handoff", () => {
  it("lets the controller start the next job on the same warm child while the callback settles", async () => {
    const child = await finishedJobWithHeldCallback();
    const { container, destroy } = controllerFor(child.port, { reportSettling: true });

    const readiness = await container.ensureReadyForProcessing({ timeoutMs: 15_000, userId: "member_synthetic" });
    expect(readiness).toMatchObject({ kind: "ready" });
    const next = await child.invoke("attempt_synthetic_next");
    expect(next.status).toBe(200);
    await next.arrayBuffer();
    const admittedAfterResultMs = performance.now() - child.resultAt;

    // The previous attempt's recovery callback is still pending and still counted.
    const health = await (await fetch(`http://127.0.0.1:${child.port}/health`)).json();
    expect(health).toMatchObject({ activeJobCount: 1, settlingCompletionCallbackCount: 1 });
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(2);
    expect(destroy).not.toHaveBeenCalled();
    expect(admittedAfterResultMs).toBeLessThan(1_000);

    child.releaseCallback.resolve();
    await vi.waitFor(async () => {
      expect(await (await fetch(`http://127.0.0.1:${child.port}/health`)).json())
        .toMatchObject({ activeJobCount: 0, settlingCompletionCallbackCount: 0 });
    });
  });

  it("keeps an older child's total busy count until the callback settles", async () => {
    const child = await finishedJobWithHeldCallback();
    const { container, destroy } = controllerFor(child.port, { reportSettling: false });

    await expect(container.ensureReadyForProcessing({ timeoutMs: 15_000, userId: "member_synthetic" }))
      .resolves.toEqual({ kind: "cleanup_unsettled" });
    expect(destroy).not.toHaveBeenCalled();

    child.releaseCallback.resolve();
    await vi.waitFor(async () => {
      expect(await container.ensureReadyForProcessing({ timeoutMs: 15_000, userId: "member_synthetic" }))
        .toMatchObject({ kind: "ready" });
    });
    expect(destroy).not.toHaveBeenCalled();
  });
});
