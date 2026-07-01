import { request as httpRequest } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";

const mocks = vi.hoisted(() => ({
  reportHostedContainerFatalBestEffort: vi.fn(async () => undefined),
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

vi.mock("../src/container-fatal-report.js", async () => {
  const actual = await vi.importActual<typeof import("../src/container-fatal-report.js")>(
    "../src/container-fatal-report.js",
  );
  return {
    ...actual,
    reportHostedContainerFatalBestEffort: mocks.reportHostedContainerFatalBestEffort,
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

function sendHostedContainerPostRequest(input: {
  body: unknown;
  path: string;
  port: number;
}): {
  close: () => void;
  done: Promise<void>;
} {
  const body = JSON.stringify(input.body);
  let requestClosed = false;
  let request!: ReturnType<typeof httpRequest>;
  const done = new Promise<void>((resolve) => {
    request = httpRequest({
      headers: {
        "connection": "close",
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json; charset=utf-8",
      },
      host: "127.0.0.1",
      method: "POST",
      path: input.path,
      port: input.port,
    }, (response) => {
      response.resume();
      response.on("end", resolve);
      response.on("close", resolve);
    });
    request.on("error", () => resolve());
    request.on("close", () => {
      requestClosed = true;
      resolve();
    });
    request.end(body);
  });

  return {
    close: () => {
      if (!requestClosed) {
        request.destroy();
      }
    },
    done,
  };
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
  it("keeps an accepted workspace invocation running when only the response closes", async () => {
    const invocationStarted = createDeferred<AbortSignal>();
    const finishInvocation = createDeferred();
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
        await finishInvocation.promise;
        expect(signal.aborted).toBe(false);
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

    const request = sendHostedContainerPostRequest({
      body: buildWorkspaceJobBody({ eventId: "evt_response_close_after_accept" }),
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    const signal = await invocationStarted.promise;
    request.close();
    await request.done;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(signal.aborted).toBe(false);

    finishInvocation.resolve();

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
    expect(mocks.reportHostedContainerFatalBestEffort).not.toHaveBeenCalled();

    const nextInvocation = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_after_response_close" })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });
    expect(nextInvocation.status).toBe(200);
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(2);
  });

  it("aborts an accepted workspace invocation through the internal abort endpoint", async () => {
    const invocationStarted = createDeferred<AbortSignal>();
    const invocationAborted = createDeferred();
    const exit = vi.fn();
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

    const requestBody = buildWorkspaceJobBody({ eventId: "evt_semantic_abort" });
    const request = sendHostedContainerPostRequest({
      body: requestBody,
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    const signal = await invocationStarted.promise;
    expect(signal.aborted).toBe(false);
    const abortResponse = await fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation/abort`,
      {
        body: JSON.stringify({
          attemptId: requestBody.job.request.attemptId,
          leaseGeneration: requestBody.job.request.leaseGeneration,
          userId: requestBody.job.request.userId,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(abortResponse.status).toBe(204);
    await invocationAborted.promise;
    await request.done;

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(Error);
    expect((signal.reason as Error).message).toBe("workspace invocation preempted");
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.reportHostedContainerFatalBestEffort).not.toHaveBeenCalled();
    await waitForAssertion(async () => {
      const health = await sendHostedContainerGetRequest({
        path: "/health",
        port: address.port,
      });
      expect(health.status).toBe(200);
      expect(health.json).toMatchObject({
        activeJobCount: 0,
        poisoned: false,
      });
    });
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(1);
  });

  it("applies an abort that arrives before the matching workspace invocation is accepted", async () => {
    const invocationAborted = createDeferred<AbortSignal>();
    const exit = vi.fn();
    mocks.runHostedWorkspaceInvocation.mockImplementation(
      async (_job, options) => {
        const signal = options?.signal;
        if (!signal) {
          throw new Error("Expected hosted workspace invocation signal.");
        }

        expect(signal.aborted).toBe(true);
        invocationAborted.resolve(signal);
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("workspace invocation preempted");
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

    const requestBody = buildWorkspaceJobBody({ eventId: "evt_abort_before_accept" });
    const abortResponse = await fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation/abort`,
      {
        body: JSON.stringify({
          attemptId: requestBody.job.request.attemptId,
          leaseGeneration: requestBody.job.request.leaseGeneration,
          userId: requestBody.job.request.userId,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(abortResponse.status).toBe(204);

    const invocationResponse = await fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation`,
      {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(invocationResponse.ok).toBe(false);
    const signal = await invocationAborted.promise;
    expect(signal.reason).toBeInstanceOf(Error);
    expect((signal.reason as Error).message).toBe("workspace invocation preempted");

    await waitForAssertion(async () => {
      const health = await sendHostedContainerGetRequest({
        path: "/health",
        port: address.port,
      });
      expect(health.status).toBe(200);
      expect(health.json).toMatchObject({
        activeJobCount: 0,
        poisoned: false,
      });
    });
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.reportHostedContainerFatalBestEffort).not.toHaveBeenCalled();
  });

  it("ignores stale workspace invocation abort requests with a mismatched lease", async () => {
    const invocationStarted = createDeferred<AbortSignal>();
    const finishInvocation = createDeferred();
    const exit = vi.fn();
    mocks.runHostedWorkspaceInvocation.mockImplementation(
      async (_job, options) => {
        const signal = options?.signal;
        if (!signal) {
          throw new Error("Expected hosted workspace invocation signal.");
        }

        invocationStarted.resolve(signal);
        await finishInvocation.promise;
        expect(signal.aborted).toBe(false);
        return buildWorkspaceRunnerResult();
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

    const requestBody = buildWorkspaceJobBody({ eventId: "evt_stale_abort_lease" });
    const request = sendHostedContainerPostRequest({
      body: requestBody,
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    const signal = await invocationStarted.promise;
    const abortResponse = await fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation/abort`,
      {
        body: JSON.stringify({
          attemptId: requestBody.job.request.attemptId,
          leaseGeneration: "stale",
          userId: requestBody.job.request.userId,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(abortResponse.status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(signal.aborted).toBe(false);

    finishInvocation.resolve();
    await request.done;

    await waitForAssertion(async () => {
      const health = await sendHostedContainerGetRequest({
        path: "/health",
        port: address.port,
      });
      expect(health.status).toBe(200);
      expect(health.json).toMatchObject({
        activeJobCount: 0,
        poisoned: false,
      });
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it("keeps cleanup failure as poison even when the response is already closed", async () => {
    const invocationStarted = createDeferred<AbortSignal>();
    const failCleanup = createDeferred();
    const exit = vi.fn();
    const readdir = vi.fn(async () => [
      { isDirectory: () => true, name: String(process.pid) },
      { isDirectory: () => true, name: String(process.pid + 1) },
    ]);
    const readFile = vi.fn(async (filePath: string) => {
      if (String(filePath).endsWith(`/${process.pid + 1}/stat`)) {
        return `${process.pid + 1} (node) S ${process.pid}`;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    mocks.runHostedWorkspaceInvocation.mockImplementation(
      async (_job, options) => {
        const signal = options?.signal;
        if (!signal) {
          throw new Error("Expected hosted workspace invocation signal.");
        }

        invocationStarted.resolve(signal);
        await failCleanup.promise;
        expect(signal.aborted).toBe(false);
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

    const request = sendHostedContainerPostRequest({
      body: buildWorkspaceJobBody({ eventId: "evt_response_close_cleanup_failure" }),
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    const signal = await invocationStarted.promise;
    request.close();
    await request.done;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(signal.aborted).toBe(false);

    failCleanup.resolve();

    await waitForAssertion(async () => {
      const health = await sendHostedContainerGetRequest({
        path: "/health",
        port: address.port,
      });
      expect(health.status).toBe(200);
      expect(health.json).toMatchObject({
        activeJobCount: 0,
        lastCleanupStatus: "failed",
        poisoned: true,
      });
    }, 7000);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
