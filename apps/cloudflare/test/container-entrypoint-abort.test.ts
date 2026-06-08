import { request as httpRequest } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";

const mocks = vi.hoisted(() => ({
  runHostedWorkspaceInvocation: vi.fn(),
}));

vi.mock("../src/hosted-workspace-invocation.js", async () => {
  const actual = await vi.importActual<typeof import("../src/hosted-workspace-invocation.js")>(
    "../src/hosted-workspace-invocation.js",
  );
  return {
    ...actual,
    runHostedWorkspaceInvocation: mocks.runHostedWorkspaceInvocation,
  };
});

import { startHostedContainerEntrypoint } from "../src/container-entrypoint.js";

const servers: Array<Awaited<ReturnType<typeof startHostedContainerEntrypoint>>> = [];

beforeEach(() => {
  mocks.runHostedWorkspaceInvocation.mockResolvedValue(buildWorkspaceRunnerResult());
});

afterEach(async () => {
  mocks.runHostedWorkspaceInvocation.mockReset();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }));
});

function buildWorkspaceRunnerResult() {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle" as const,
  };
}

function buildWorkspaceJobBody(input: {
  eventId: string;
}) {
  return {
    hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    job: {
      kind: "workspace-invocation",
      request: {
        attemptId: `attempt_${input.eventId}`,
        leaseGeneration: "1",
        userId: "u1",
        workspaceVersion: "0",
      },
    },
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

async function sendHostedContainerGetRequest(input: {
  path: string;
  port: number;
}): Promise<{ json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        connection: "close",
      },
      host: "127.0.0.1",
      method: "GET",
      path: input.path,
      port: input.port,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        resolve({
          json: bodyText.length > 0 ? JSON.parse(bodyText) : null,
          status: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);
    request.end();
  });
}

async function waitForAssertion(
  assertion: () => Promise<void> | void,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() <= deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for assertion.");
}

describe("container entrypoint abort boundary", () => {
  it("poisons the warm container when a workspace request aborts before a durable result", async () => {
    const invocationStarted = createDeferred<AbortSignal>();
    const invocationAborted = createDeferred();
    const exitCalled = createDeferred();
    const exit = vi.fn(() => {
      exitCalled.resolve();
    });
    mocks.runHostedWorkspaceInvocation.mockImplementation(
      async (_job, options) => {
        const signal = options?.signal;
        if (!signal) {
          throw new Error("Expected hosted workspace invocation signal.");
        }

        invocationStarted.resolve(signal);
        await new Promise<never>((_resolve, reject) => {
          const rejectForAbort = () => {
            invocationAborted.resolve();
            reject(signal.reason instanceof Error ? signal.reason : new Error("Request aborted."));
          };

          if (signal.aborted) {
            rejectForAbort();
            return;
          }

          signal.addEventListener("abort", rejectForAbort, { once: true });
        });
      },
    );

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        exitScheduler: exit,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const controller = new AbortController();
    const requestPromise = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_abort_before_result" })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal: controller.signal,
    }).catch((error: unknown) => error);

    await invocationStarted.promise;
    controller.abort();
    await invocationAborted.promise;
    await requestPromise;
    await exitCalled.promise;

    expect(exit).toHaveBeenCalledTimes(1);
    await waitForAssertion(async () => {
      const health = await sendHostedContainerGetRequest({
        path: "/health",
        port: address.port,
      });
      expect(health.status).toBe(200);
      expect(health.json).toMatchObject({
        activeJobCount: 0,
        poisoned: true,
      });
    });

    const rejectedAfterPoison = await fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation`,
      {
        body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_after_poisoned_container" })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(rejectedAfterPoison.status).toBe(503);
    await expect(rejectedAfterPoison.json()).resolves.toMatchObject({
      error: "Hosted runner container is poisoned.",
    });
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(1);
  });

  it("keeps the warm container when an aborted workspace request returns safely and cleanup passes", async () => {
    const invocationStarted = createDeferred<AbortSignal>();
    const invocationFinished = createDeferred();
    const exit = vi.fn();
    const readdir = vi.fn(async () => [
      { isDirectory: () => true, name: String(process.pid) },
    ]);
    const readFile = vi.fn(async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    mocks.runHostedWorkspaceInvocation.mockImplementation(
      async (_job, options) => {
        const signal = options?.signal;
        if (!signal) {
          throw new Error("Expected hosted workspace invocation signal.");
        }

        invocationStarted.resolve(signal);
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }

          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        invocationFinished.resolve();
        return buildWorkspaceRunnerResult();
      },
    );

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        exitScheduler: exit,
        processApi: { readFile, readdir },
        processIsolation: true,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const controller = new AbortController();
    const requestPromise = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_abort_after_safe_return" })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal: controller.signal,
    }).catch((error: unknown) => error);

    await invocationStarted.promise;
    controller.abort();
    await invocationFinished.promise;
    await requestPromise;

    await waitForAssertion(async () => {
      const health = await sendHostedContainerGetRequest({
        path: "/health",
        port: address.port,
      });
      expect(health.status).toBe(200);
      expect(health.json).toMatchObject({
        activeJobCount: 0,
        lastCleanupStatus: "passed",
        poisoned: false,
      });
    });
    expect(exit).not.toHaveBeenCalled();
  });
});
