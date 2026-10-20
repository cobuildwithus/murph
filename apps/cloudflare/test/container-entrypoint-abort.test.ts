import { request as httpRequest } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedWorkspaceRestorePreparation,
} from "@murphai/assistant-runtime/hosted-workspace-restore-preparation";
import type { HostedExecutionStructuredLogRecord } from "@murphai/hosted-execution";
import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";
import "../src/container-entrypoint-heavy-runtime.js";

const mocks = vi.hoisted(() => ({
  recordHostedContainerRuntimeCompletionBestEffort: vi.fn(
    async (_input: {
      job: { request: { attemptId: string } };
      result: { status: string };
    }) => undefined,
  ),
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

vi.mock("../src/container-runtime-completion.js", () => ({
  recordHostedContainerRuntimeCompletionBestEffort:
    mocks.recordHostedContainerRuntimeCompletionBestEffort,
}));

import { startHostedContainerEntrypoint } from "../src/container-entrypoint.js";

const servers: Array<Awaited<ReturnType<typeof startHostedContainerEntrypoint>>> = [];

beforeEach(() => {
  mocks.recordHostedContainerRuntimeCompletionBestEffort.mockResolvedValue(
    undefined,
  );
  mocks.runHostedWorkspaceInvocation.mockResolvedValue(buildWorkspaceRunnerResult());
});

afterEach(async () => {
  mocks.runHostedWorkspaceInvocation.mockReset();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

function createTestHostedWorkspaceRestorePreparer() {
  return vi.fn(async (input: {
    signal: AbortSignal;
  }): Promise<HostedWorkspaceRestorePreparation> => {
    const promise = new Promise<never>((_resolve, reject) => {
      const rejectForAbort = () => reject(input.signal.reason);
      if (input.signal.aborted) {
        rejectForAbort();
        return;
      }
      input.signal.addEventListener("abort", rejectForAbort, { once: true });
    });
    void promise.catch(() => undefined);
    return {
      adoptRuntimeAbortGuard: vi.fn(),
      phaseLogger: {
        close: vi.fn(),
        emit: vi.fn(),
        failOpenPhases: vi.fn(() => []),
      },
      promise,
      runtimePhaseStartedAt: "2026-08-27T15:00:00.000Z",
      vaultRoot: "/tmp/murph-entrypoint-abort-prepared-restore/durable/vault",
    };
  });
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

function captureRequestExitWarnings(): () => HostedExecutionStructuredLogRecord[] {
  vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  return () => warn.mock.calls
    .filter(([payload]) => typeof payload === "string" && payload.includes('"exitReason":'))
    .map(([payload]) => JSON.parse(String(payload)) as HostedExecutionStructuredLogRecord);
}

async function closePartialHostedContainerPostRequest(input: {
  bodyPrefix: string;
  path: string;
  port: number;
  server: Awaited<ReturnType<typeof startHostedContainerEntrypoint>>;
}): Promise<void> {
  const bodyObserved = createDeferred();
  input.server.once("request", (request) => {
    request.once("data", () => bodyObserved.resolve());
  });
  const request = httpRequest({
    headers: {
      connection: "close",
      "content-type": "application/json; charset=utf-8",
      "x-synthetic-private": "synthetic-private-header",
    },
    host: "127.0.0.1",
    method: "POST",
    path: input.path,
    port: input.port,
  });
  const closed = new Promise<void>((resolve) => request.once("close", resolve));
  request.on("error", () => undefined);
  request.write(input.bodyPrefix);
  await bodyObserved.promise;
  request.destroy();
  await closed;
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
    const exitWarnings = captureRequestExitWarnings();
    const invocationStarted = createDeferred<AbortSignal>();
    const finishInvocation = createDeferred();
    const completionStarted = createDeferred<{
      job: { request: { attemptId: string } };
      result: { status: string };
    }>();
    const releaseCompletion = createDeferred();
    const exit = vi.fn();
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
    let completionCallCount = 0;
    mocks.recordHostedContainerRuntimeCompletionBestEffort.mockImplementation(
      async (input) => {
        completionCallCount += 1;
        if (completionCallCount !== 1) {
          return;
        }
        completionStarted.resolve(input);
        await releaseCompletion.promise;
      },
    );

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        exitScheduler: exit,
        prepareWorkspaceRestore: createTestHostedWorkspaceRestorePreparer(),
        processApi: { readFile },
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
    await closePartialHostedContainerPostRequest({
      bodyPrefix: '{"attemptId":"synthetic-private-wake-attempt","userId":"synthetic-private-member",',
      path: "/internal/runtime-wake?private=synthetic-private-query",
      port: address.port,
      server,
    });
    await waitForAssertion(() => {
      expect(exitWarnings()).toHaveLength(1);
    });
    expect(signal.aborted).toBe(false);

    request.close();
    await request.done;
    await waitForAssertion(() => {
      expect(exitWarnings()).toHaveLength(2);
    });
    expect(signal.aborted).toBe(false);

    finishInvocation.resolve();

    await expect(completionStarted.promise).resolves.toMatchObject({
      job: {
        request: {
          attemptId: "attempt_evt_response_close_after_accept",
        },
      },
      result: {
        status: "idle",
      },
    });
    const healthDuringCompletion = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });
    expect(healthDuringCompletion.status).toBe(200);
    // The finished job's recovery callback keeps lifetime work counted, but it
    // is the only settling work, so it no longer blocks the next admission.
    expect(healthDuringCompletion.json).toMatchObject({
      activeJobCount: 1,
      poisoned: false,
      settlingCompletionCallbackCount: 1,
    });
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.reportHostedContainerFatalBestEffort).not.toHaveBeenCalled();

    const whileCompleting = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_during_completion" })),
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
    });
    expect(whileCompleting.status).toBe(200);
    await whileCompleting.arrayBuffer();
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(2);
    expect(mocks.recordHostedContainerRuntimeCompletionBestEffort).toHaveBeenNthCalledWith(2, expect.objectContaining({
      job: expect.objectContaining({ request: expect.objectContaining({ attemptId: "attempt_evt_during_completion" }) }),
    }));
    // The first callback is still awaited, never abandoned.
    expect((await sendHostedContainerGetRequest({ path: "/health", port: address.port })).json).toMatchObject({
      activeJobCount: 1,
      settlingCompletionCallbackCount: 1,
    });
    releaseCompletion.resolve();
    await vi.waitFor(async () => {
      const health = await sendHostedContainerGetRequest({ path: "/health", port: address.port });
      expect(health.json).toMatchObject({ activeJobCount: 0, poisoned: false, settlingCompletionCallbackCount: 0 });
    });

    const nextInvocation = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_after_response_close" })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });
    expect(nextInvocation.status).toBe(200);
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(3);
    expect(
      mocks.recordHostedContainerRuntimeCompletionBestEffort,
    ).toHaveBeenCalledTimes(3);
    expect(exitWarnings()).toHaveLength(2);
    expect(exitWarnings()[0]?.details).toEqual({
      exitReason: "request.aborted",
      requestKind: "runtime-wake",
      workspaceAttemptId: false,
    });
    expect(exitWarnings()[1]).toMatchObject({
      component: "container",
      details: {
        exitReason: "response.closed",
        requestKind: "workspace-invocation",
        workspaceAttemptId: "attempt_evt_response_close_after_accept",
      },
      level: "warn",
      message: "Hosted container entrypoint exited because the response closed before completion.",
      phase: "failed",
    });
    expect(JSON.stringify(exitWarnings())).not.toContain("synthetic-private-");
  });

  it("aborts an accepted workspace invocation through the internal abort endpoint after its response closes", async () => {
    const exitWarnings = captureRequestExitWarnings();
    const invocationStarted = createDeferred<AbortSignal>();
    const invocationAborted = createDeferred();
    const stopWarmCodex = vi.fn(async () => undefined);
    const exit = vi.fn();
    let invocationCallCount = 0;
    mocks.runHostedWorkspaceInvocation.mockImplementation(
      async (_job, options) => {
        invocationCallCount += 1;
        if (invocationCallCount > 1) {
          return buildWorkspaceRunnerResult();
        }
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
        prepareWorkspaceRestore: createTestHostedWorkspaceRestorePreparer(),
        stopWarmCodex,
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
    request.close();
    await request.done;
    await waitForAssertion(() => {
      expect(exitWarnings()).toHaveLength(1);
    });
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
    expect(stopWarmCodex).toHaveBeenCalledTimes(1);
    expect(stopWarmCodex).toHaveBeenCalledWith("hosted-workspace-restore");

    const replacement = await fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation`,
      {
        body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_after_abort" })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(replacement.status).toBe(200);
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(2);
    expect(stopWarmCodex).toHaveBeenCalledTimes(2);
    expect(stopWarmCodex).toHaveBeenNthCalledWith(
      2,
      "hosted-workspace-restore",
    );
    expect(exitWarnings()).toHaveLength(1);
    expect(exitWarnings()[0]?.details).toEqual({
      exitReason: "response.closed",
      requestKind: "workspace-invocation",
      workspaceAttemptId: requestBody.job.request.attemptId,
    });
  });

  it("does not correlate an attempt from an incomplete workspace request body", async () => {
    const exitWarnings = captureRequestExitWarnings();
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        prepareWorkspaceRestore: createTestHostedWorkspaceRestorePreparer(),
      },
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }
    const requestBody = buildWorkspaceJobBody({ eventId: "synthetic-private-unparsed-attempt" });
    requestBody.job.request.userId = "synthetic-private-member";
    await closePartialHostedContainerPostRequest({
      bodyPrefix: JSON.stringify(requestBody).slice(0, -1),
      path: "/internal/workspace-invocation?private=synthetic-private-query",
      port: address.port,
      server,
    });

    await waitForAssertion(() => {
      expect(exitWarnings()).toHaveLength(1);
      expect(exitWarnings()[0]?.details).toEqual({
        exitReason: "request.aborted",
        requestKind: "workspace-invocation",
        workspaceAttemptId: false,
      });
    });
    expect(JSON.stringify(exitWarnings())).not.toContain("synthetic-private-");
    expect(mocks.runHostedWorkspaceInvocation).not.toHaveBeenCalled();
    await waitForAssertion(async () => {
      const health = await sendHostedContainerGetRequest({ path: "/health", port: address.port });
      expect(health.json).toMatchObject({ activeJobCount: 0, poisoned: false });
    });
    expect(exitWarnings()).toHaveLength(1);
  });

  it("releases a preempted invocation without waiting for heavy hydration", async () => {
    const hydration = createDeferred<never>();
    const restoreAbortObserved = createDeferred();
    const allowRestoreToSettle = createDeferred();
    const preparationStarted = createDeferred();
    const stopWarmCodex = vi.fn(async () => undefined);
    const prepareWorkspaceRestore = vi.fn(async (input: {
      signal: AbortSignal;
    }): Promise<HostedWorkspaceRestorePreparation> => {
      const promise = (async (): Promise<never> => {
        if (!input.signal.aborted) {
          await new Promise<void>((resolve) => {
            input.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        restoreAbortObserved.resolve();
        await allowRestoreToSettle.promise;
        throw input.signal.reason;
      })();
      void promise.catch(() => undefined);
      preparationStarted.resolve();
      return {
        adoptRuntimeAbortGuard: vi.fn(),
        phaseLogger: {
          close: vi.fn(),
          emit: vi.fn(),
          failOpenPhases: vi.fn(() => []),
        },
        promise,
        runtimePhaseStartedAt: "2026-08-27T15:00:00.000Z",
        vaultRoot: "/tmp/murph-entrypoint-abort-pending-hydration/durable/vault",
      };
    });
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        loadHeavyRuntime: () => hydration.promise,
        prepareWorkspaceRestore,
        stopWarmCodex,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const requestBody = buildWorkspaceJobBody({ eventId: "evt_abort_pending_hydration" });
    let invocationSettled = false;
    const invocation = fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation`,
      {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    void invocation.then(() => {
      invocationSettled = true;
    });
    await preparationStarted.promise;

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
    await restoreAbortObserved.promise;
    await Promise.resolve();
    expect(invocationSettled).toBe(false);
    expect((await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    })).json).toMatchObject({ activeJobCount: 1 });

    allowRestoreToSettle.resolve();
    await expect(invocation).resolves.toMatchObject({ status: 204 });
    expect((await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    })).json).toMatchObject({
      activeJobCount: 0,
      poisoned: false,
    });
    expect(mocks.runHostedWorkspaceInvocation).not.toHaveBeenCalled();
    expect(stopWarmCodex).toHaveBeenCalledTimes(1);
    expect(stopWarmCodex).toHaveBeenCalledWith("hosted-workspace-restore");
  });

  it("rejects replacement invocations until an aborted workspace invocation settles", async () => {
    const invocationStarted = createDeferred<AbortSignal>();
    const invocationAborted = createDeferred();
    const finishInvocation = createDeferred();
    const exit = vi.fn();
    let invocationCalls = 0;

    mocks.runHostedWorkspaceInvocation.mockImplementation(
      async (_job, options) => {
        invocationCalls += 1;
        if (invocationCalls > 1) {
          return buildWorkspaceRunnerResult();
        }

        const signal = options?.signal;
        if (!signal) {
          throw new Error("Expected hosted workspace invocation signal.");
        }

        invocationStarted.resolve(signal);
        if (!signal.aborted) {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        invocationAborted.resolve();
        await finishInvocation.promise;
        throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted.");
      },
    );

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        exitScheduler: exit,
        prepareWorkspaceRestore: createTestHostedWorkspaceRestorePreparer(),
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const requestBody = buildWorkspaceJobBody({ eventId: "evt_semantic_abort_drains" });
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
    expect(signal.aborted).toBe(true);

    const replacementWhileDraining = await fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation`,
      {
        body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_replacement_while_draining" })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(replacementWhileDraining.status).toBe(409);
    await expect(replacementWhileDraining.json()).resolves.toEqual({
      error: "Hosted runner is busy.",
    });

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

    const replacementAfterDrain = await fetch(
      `http://127.0.0.1:${address.port}/internal/workspace-invocation`,
      {
        body: JSON.stringify(buildWorkspaceJobBody({ eventId: "evt_replacement_after_drain" })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(replacementAfterDrain.status).toBe(200);
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(2);
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.reportHostedContainerFatalBestEffort).not.toHaveBeenCalled();
  });

  it("applies an abort that arrives before the matching workspace invocation is accepted", async () => {
    const exit = vi.fn();

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        exitScheduler: exit,
        prepareWorkspaceRestore: createTestHostedWorkspaceRestorePreparer(),
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
    expect(invocationResponse.status).toBe(204);

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
    expect(mocks.runHostedWorkspaceInvocation).not.toHaveBeenCalled();
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
        prepareWorkspaceRestore: createTestHostedWorkspaceRestorePreparer(),
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

});
