import {
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostedAssistantConfigurationError } from "@murphai/operator-config/hosted-assistant-config";
import {
  attachHostedRuntimeFailurePhaseCode,
} from "@murphai/hosted-execution/runtime-control";

type MockSpawnedProcess = EventEmitter & {
  kill: () => boolean;
  stderr: EventEmitter;
  stdin: {
    end: (chunk?: string | Uint8Array) => void;
  };
  stdout: EventEmitter;
};

type SpawnMock = (
  command: string,
  args?: readonly string[],
  options?: Readonly<{
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: readonly string[];
  }>,
) => MockSpawnedProcess;

const mocks = vi.hoisted(() => ({
  drainHostedRuntimeDeferredUsageCompletionsBestEffort: vi.fn(async () => undefined),
  emitHostedExecutionStructuredLog: vi.fn(),
  registerStopWarmCodexAppServer: vi.fn(),
  registerWaitForWarmCodexBackgroundWork: vi.fn(),
  runHostedWorkspaceInvocation: vi.fn(),
  spawn: vi.fn<SpawnMock>(),
  stopWarmCodexAppServer: vi.fn(),
  waitForWarmCodexBackgroundWork: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("../src/hosted-workspace-invocation.js", async () => {
  const actual = await vi.importActual<typeof import("../src/hosted-workspace-invocation.js")>(
    "../src/hosted-workspace-invocation.js",
  );
  return {
    ...actual,
    runHostedWorkspaceInvocation: mocks.runHostedWorkspaceInvocation,
  };
});

vi.mock("@murphai/assistant-engine/codex-lifecycle", () => ({
  registerStopWarmCodexAppServer: mocks.registerStopWarmCodexAppServer,
  registerWaitForWarmCodexBackgroundWork:
    mocks.registerWaitForWarmCodexBackgroundWork,
  stopWarmCodexAppServer: mocks.stopWarmCodexAppServer,
  waitForWarmCodexBackgroundWork: mocks.waitForWarmCodexBackgroundWork,
}));

vi.mock("@murphai/assistant-runtime/hosted-invocation", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-runtime/hosted-invocation")>(
    "@murphai/assistant-runtime/hosted-invocation",
  );
  return {
    ...actual,
    drainHostedRuntimeDeferredUsageCompletionsBestEffort:
      mocks.drainHostedRuntimeDeferredUsageCompletionsBestEffort,
  };
});

import {
  classifyRunnerJobError,
  createRequestAbortController,
  resolveHostedContainerCodexSmokeHomeRoot,
  startHostedContainerEntrypoint,
} from "../src/container-entrypoint.js";
import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
} from "../src/deploy-smoke-live-model.js";
import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";
import { HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE } from "../src/runner-container-error-codes.js";
import { HostedRuntimeControlPlaneFetchError } from "../src/runtime-platform/control-plane-fetch.js";
import * as hostedInvocation from "../src/hosted-workspace-invocation.js";

const servers: Array<Awaited<ReturnType<typeof startHostedContainerEntrypoint>>> = [];
const nativeFetch = globalThis.fetch;
const hostedContainerRunRequestBodyLimitBytes = 8 * 1024 * 1024;
const TEST_SNAPSHOT_PATH_HASH_SECRET = "a".repeat(64);

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = nativeFetch;
  mocks.drainHostedRuntimeDeferredUsageCompletionsBestEffort.mockResolvedValue(undefined);
  mocks.runHostedWorkspaceInvocation.mockResolvedValue(buildWorkspaceRunnerResult());
  mocks.spawn.mockReset();
  mocks.stopWarmCodexAppServer.mockResolvedValue(undefined);
  mocks.waitForWarmCodexBackgroundWork.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = nativeFetch;
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

interface ClassifiedRunnerPayload {
  code?: string;
  details?: {
    errorCodeDetail?: string;
    errorDetail?: string;
    stackPreview?: string[];
  };
  error?: string;
  errorName?: string;
}

async function sendHostedContainerJsonRequest(input: {
  authorization?: string;
  body: string;
  headers?: Record<string, string>;
  path: string;
  port: number;
}): Promise<{ headers: IncomingHttpHeaders; json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        ...(input.authorization ? { authorization: input.authorization } : {}),
        ...(input.headers ?? {}),
        "connection": "close",
        "content-type": "application/json; charset=utf-8",
      },
      host: "127.0.0.1",
      method: "POST",
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
          headers: response.headers,
          json: bodyText.length > 0 ? JSON.parse(bodyText) : null,
          status: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);
    request.write(input.body);
    request.end();
  });
}

async function sendHostedContainerGetRequest(input: {
  path: string;
  port: number;
}): Promise<{ json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        "connection": "close",
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

async function sendHostedContainerDeclaredLengthRequest(input: {
  authorization?: string;
  contentLength: number;
  path: string;
  port: number;
}): Promise<{ json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        ...(input.authorization ? { authorization: input.authorization } : {}),
        "connection": "close",
        "content-length": String(input.contentLength),
        "content-type": "application/json; charset=utf-8",
      },
      host: "127.0.0.1",
      method: "POST",
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

async function sendHostedContainerChunkedRequest(input: {
  authorization?: string;
  chunks: string[];
  path: string;
  port: number;
}): Promise<{ json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        ...(input.authorization ? { authorization: input.authorization } : {}),
        "connection": "close",
        "content-type": "application/json; charset=utf-8",
      },
      host: "127.0.0.1",
      method: "POST",
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
    for (const chunk of input.chunks) {
      request.write(chunk);
    }
    request.end();
  });
}

function buildJobBody(input: {
  wake: {
    event: Record<string, unknown>;
    eventId: string;
    occurredAt: string;
  };
}) {
  const userId = typeof input.wake.event.userId === "string" ? input.wake.event.userId : "u1";

  return {
    hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    job: {
      kind: "workspace-invocation",
      request: {
        attemptId: `attempt_${input.wake.eventId}`,
        leaseGeneration: "1",
        userId,
        workspaceVersion: "0",
      },
    },
  };
}

function buildWorkspaceRunnerResult() {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle" as const,
  };
}

function buildWorkspaceJobBody() {
  return {
    hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    job: {
      kind: "workspace-invocation",
      request: {
        attemptId: "attempt_container_workspace",
        leaseGeneration: "8",
        userId: "u_container_workspace",
        workspaceVersion: "5",
      },
      runtime: {
        forwardedEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-test",
        },
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

describe("startHostedContainerEntrypoint", () => {
  it("serves a lightweight health endpoint", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });

    expect(response).toMatchObject({
      status: 200,
    });
    expect(response.json).toMatchObject({
      activeJobCount: 0,
      conversationWarmActivityCompletedAtEpochMs: null,
      hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
      ok: true,
      poisoned: false,
      service: "cloudflare-hosted-runner-node",
    });
  });

  it("publishes settled conversation warmth in health", async () => {
    mocks.runHostedWorkspaceInvocation.mockImplementationOnce(async (_job, options) => {
      options.onConversationActivityObserved?.();
      return buildWorkspaceRunnerResult();
    });
    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    await sendHostedContainerJsonRequest({
      body: JSON.stringify(buildWorkspaceJobBody()),
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    const health = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });
    const healthJson = requireRecord(health.json, "health response");
    const completedAtEpochMs = healthJson
      .conversationWarmActivityCompletedAtEpochMs;
    expect(Number.isSafeInteger(completedAtEpochMs)).toBe(true);
    expect(healthJson).toMatchObject({
      conversationWarmActivityCompletedAtEpochMs: completedAtEpochMs,
    });

    await sendHostedContainerJsonRequest({
      body: JSON.stringify(buildWorkspaceJobBody()),
      path: "/internal/workspace-invocation",
      port: address.port,
    });
    const healthAfterMaintenance = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });
    expect(healthAfterMaintenance.json).toMatchObject({
      conversationWarmActivityCompletedAtEpochMs: completedAtEpochMs,
    });
  });

  it("starts conversation warmth when the observed invocation settles", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const observedAtEpochMs = Date.parse("2026-07-22T13:00:00.000Z");
      const settledAtEpochMs = observedAtEpochMs + 300_000;
      const activityObserved = createDeferred();
      const releaseInvocation = createDeferred();
      mocks.runHostedWorkspaceInvocation.mockImplementationOnce(async (_job, options) => {
        options.onConversationActivityObserved?.();
        activityObserved.resolve();
        await releaseInvocation.promise;
        return buildWorkspaceRunnerResult();
      });
      vi.setSystemTime(observedAtEpochMs);
      const server = await startHostedContainerEntrypoint({ port: 0 });
      servers.push(server);
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const invocationPromise = sendHostedContainerJsonRequest({
        body: JSON.stringify(buildWorkspaceJobBody()),
        path: "/internal/workspace-invocation",
        port: address.port,
      });
      await activityObserved.promise;

      const healthWhileRunning = await sendHostedContainerGetRequest({
        path: "/health",
        port: address.port,
      });
      expect(healthWhileRunning.json).toMatchObject({
        activeJobCount: 1,
        conversationWarmActivityCompletedAtEpochMs: null,
      });

      vi.setSystemTime(settledAtEpochMs);
      releaseInvocation.resolve();
      await invocationPromise;

      const healthAfterSettlement = await sendHostedContainerGetRequest({
        path: "/health",
        port: address.port,
      });
      expect(healthAfterSettlement.json).toMatchObject({
        activeJobCount: 0,
        conversationWarmActivityCompletedAtEpochMs: settledAtEpochMs,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles conversation warmth when the invocation fails after observation", async () => {
    mocks.runHostedWorkspaceInvocation.mockImplementationOnce(async (_job, options) => {
      options.onConversationActivityObserved?.();
      throw new Error("synthetic invocation failure");
    });
    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const invocation = await sendHostedContainerJsonRequest({
      body: JSON.stringify(buildWorkspaceJobBody()),
      path: "/internal/workspace-invocation",
      port: address.port,
    });
    expect(invocation.status).toBe(500);
    const health = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });
    const healthJson = requireRecord(health.json, "health response");
    expect(Number.isSafeInteger(
      healthJson.conversationWarmActivityCompletedAtEpochMs,
    )).toBe(true);
  });

  it("drains deferred usage completions before clean shutdown exit", async () => {
    const drainStarted = createDeferred();
    const releaseDrain = createDeferred();
    mocks.drainHostedRuntimeDeferredUsageCompletionsBestEffort.mockImplementationOnce(
      async () => {
        drainStarted.resolve();
        await releaseDrain.promise;
      },
    );
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerJsonRequest({
      body: JSON.stringify(buildWorkspaceJobBody()),
      path: "/internal/workspace-invocation",
      port: address.port,
    });
    expect(response.status).toBe(200);

    process.emit("SIGTERM", "SIGTERM");

    await drainStarted.promise;
    expect(exit).not.toHaveBeenCalled();

    const lateResponse = await sendHostedContainerJsonRequest({
      body: JSON.stringify(buildWorkspaceJobBody()),
      path: "/internal/workspace-invocation",
      port: address.port,
    });
    expect(lateResponse).toMatchObject({
      json: {
        code: HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
        error: "Hosted runner is shutting down.",
      },
      status: 503,
    });
    expect(mocks.runHostedWorkspaceInvocation).toHaveBeenCalledTimes(1);

    releaseDrain.resolve();
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    const serverIndex = servers.indexOf(server);
    if (serverIndex !== -1) {
      servers.splice(serverIndex, 1);
    }
  });

  it("advertises absent for runtime wakes after shutdown only when no runner work is active", async () => {
    const drainStarted = createDeferred();
    const releaseDrain = createDeferred();
    mocks.drainHostedRuntimeDeferredUsageCompletionsBestEffort.mockImplementationOnce(async () => {
      drainStarted.resolve();
      await releaseDrain.promise;
    });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    try {
      process.emit("SIGTERM", "SIGTERM");
      await drainStarted.promise;

      const lateWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
        body: JSON.stringify({
          attemptId: "attempt_evt_runtime_wake_shutdown_idle",
          leaseGeneration: "1",
          userId: "u1",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(lateWake.status).toBe(204);
      expect(lateWake.headers.get("x-runtime-wake-accepted")).toBe("0");
      expect(lateWake.headers.get("x-runtime-wake-absent")).toBe("1");
    } finally {
      releaseDrain.resolve();
    }

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    const serverIndex = servers.indexOf(server);
    if (serverIndex !== -1) {
      servers.splice(serverIndex, 1);
    }
  });

  it("rejects active runtime wakes after shutdown starts without advertising absence", async () => {
    const invocationReady = createDeferred();
    const releaseInvocation = createDeferred();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const observedRuntime = {
      shutdownSignal: null as AbortSignal | null,
    };
    let runtimeWakeCount = 0;
    vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockImplementation(
      async (_job, options) => {
        observedRuntime.shutdownSignal = options?.shutdownSignal ?? null;
        options?.onRuntimeWakeReady?.(() => {
          runtimeWakeCount += 1;
          return true;
        });
        invocationReady.resolve();
        await releaseInvocation.promise;
        return buildWorkspaceRunnerResult();
      },
    );
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const invocation = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_runtime_wake_shutdown",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    await invocationReady.promise;
    expect(observedRuntime.shutdownSignal?.aborted).toBe(false);
    process.emit("SIGTERM", "SIGTERM");
    expect(observedRuntime.shutdownSignal?.aborted).toBe(true);

    const lateWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      body: JSON.stringify({
        attemptId: "attempt_evt_runtime_wake_shutdown",
        leaseGeneration: "1",
        userId: "u1",
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });
    releaseInvocation.resolve();
    const invocationResponse = await invocation;

    expect(lateWake.status).toBe(204);
    expect(lateWake.headers.get("x-runtime-wake-accepted")).toBe("0");
    expect(lateWake.headers.get("x-runtime-wake-absent")).toBeNull();
    expect(runtimeWakeCount).toBe(0);
    expect(invocationResponse.status).toBe(200);
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    const serverIndex = servers.indexOf(server);
    if (serverIndex !== -1) {
      servers.splice(serverIndex, 1);
    }
  });

  it("rejects runtime wakes when shutdown starts while the wake body is being read", async () => {
    const invocationReady = createDeferred();
    const releaseInvocation = createDeferred();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    let runtimeWakeCount = 0;
    vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockImplementation(
      async (_job, options) => {
        options?.onRuntimeWakeReady?.(() => {
          runtimeWakeCount += 1;
          return true;
        });
        invocationReady.resolve();
        await releaseInvocation.promise;
        return buildWorkspaceRunnerResult();
      },
    );
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const invocation = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_runtime_wake_shutdown_body",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    await invocationReady.promise;
    const lateWakeResponse = new Promise<{
      headers: Record<string, string | string[] | undefined>;
      json: unknown;
      status: number;
    }>((resolve, reject) => {
      const request = httpRequest({
        headers: {
          connection: "close",
          "content-type": "application/json; charset=utf-8",
        },
        host: "127.0.0.1",
        method: "POST",
        path: "/internal/runtime-wake",
        port: address.port,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          resolve({
            headers: response.headers,
            json: bodyText.length > 0 ? JSON.parse(bodyText) : null,
            status: response.statusCode ?? 0,
          });
        });
      });
      request.on("error", reject);
      request.write("{\"attemptId\":\"attempt_evt_runtime_wake_shutdown_body\",");
      setTimeout(() => {
        process.emit("SIGTERM", "SIGTERM");
        request.end("\"leaseGeneration\":\"1\",\"userId\":\"u1\"}");
      }, 25);
    });

    const lateWake = await lateWakeResponse;
    releaseInvocation.resolve();
    const invocationResponse = await invocation;

    expect(lateWake.status).toBe(204);
    expect(lateWake.headers["x-runtime-wake-accepted"]).toBe("0");
    expect(lateWake.headers["x-runtime-wake-absent"]).toBeUndefined();
    expect(lateWake.json).toBeNull();
    expect(runtimeWakeCount).toBe(0);
    expect(invocationResponse.status).toBe(200);
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    const serverIndex = servers.indexOf(server);
    if (serverIndex !== -1) {
      servers.splice(serverIndex, 1);
    }
  });

  it("uses the default hosted process-lifetime shutdown hooks when the server closes", async () => {
    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);

    mocks.stopWarmCodexAppServer.mockClear();
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
    const serverIndex = servers.indexOf(server);
    if (serverIndex !== -1) {
      servers.splice(serverIndex, 1);
    }

    expect(mocks.stopWarmCodexAppServer).toHaveBeenCalledTimes(1);
    expect(mocks.stopWarmCodexAppServer).toHaveBeenCalledWith("container-server-close");
  });

  it("accepts runtime wakes only after the active invocation reports readiness", async () => {
    const invocationStarted = createDeferred();
    const allowInvocationReady = createDeferred();
    const invocationReady = createDeferred();
    const releaseInvocation = createDeferred();
    let runtimeWakeCount = 0;
    const runtimeWakeNotifications: unknown[] = [];
    const pendingWakeAcceptedAtEpochMs = 1_777_010_000_000;
    const secondPendingWakeAcceptedAtEpochMs = pendingWakeAcceptedAtEpochMs + 1_000;
    const runtimeReadyAtEpochMs = pendingWakeAcceptedAtEpochMs + 5_000;
    const firstWakeAcceptedAtEpochMs = runtimeReadyAtEpochMs + 1_000;
    const secondWakeAcceptedAtEpochMs = firstWakeAcceptedAtEpochMs + 1_000;
    let nowEpochMs = pendingWakeAcceptedAtEpochMs;
    vi.spyOn(Date, "now").mockImplementation(() => nowEpochMs);
    const runnerSpy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockImplementation(
      async (_job, options) => {
        invocationStarted.resolve();
        await allowInvocationReady.promise;
        options?.onRuntimeWakeReady?.((notification) => {
          runtimeWakeCount += 1;
          runtimeWakeNotifications.push(structuredClone(notification ?? null));
          return true;
        });
        invocationReady.resolve();
        await releaseInvocation.promise;
        return buildWorkspaceRunnerResult();
      },
    );

    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const idleWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    expect(idleWake.status).toBe(204);
    expect(idleWake.headers.get("x-runtime-wake-accepted")).toBe("0");

    const invocation = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_runtime_wake_ready",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    await invocationStarted.promise;
    const pendingWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      body: JSON.stringify({
        attemptId: "attempt_evt_runtime_wake_ready",
        leaseGeneration: "1",
        orchestration: {
          activeWakeStartedAtEpochMs: 1_777_009_999_950,
          cloudflareRouteReceivedAtEpochMs: 1_777_009_999_900,
        },
        userId: "u1",
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });
    nowEpochMs = secondPendingWakeAcceptedAtEpochMs;
    const secondPendingWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    nowEpochMs = runtimeReadyAtEpochMs;
    allowInvocationReady.resolve();
    await invocationReady.promise;

    nowEpochMs = firstWakeAcceptedAtEpochMs;
    const firstWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    nowEpochMs = secondWakeAcceptedAtEpochMs;
    const secondWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    releaseInvocation.resolve();
    const invocationResponse = await invocation;

    expect(pendingWake.status).toBe(204);
    expect(pendingWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(pendingWake.headers.get("x-runtime-wake-identity-checked")).toBe("1");
    expect(pendingWake.headers.get("x-runtime-wake-pending")).toBe("1");
    expect(secondPendingWake.status).toBe(204);
    expect(secondPendingWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(secondPendingWake.headers.get("x-runtime-wake-pending")).toBe("1");
    expect(firstWake.status).toBe(204);
    expect(secondWake.status).toBe(204);
    expect(firstWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(secondWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(runtimeWakeCount).toBe(3);
    expect(runtimeWakeNotifications).toEqual([
      {
        notifiedAtEpochMs: pendingWakeAcceptedAtEpochMs,
        orchestration: {
          activeWakeAccepted: true,
          activeWakeFinishedAtEpochMs: pendingWakeAcceptedAtEpochMs,
          activeWakeStartedAtEpochMs: 1_777_009_999_950,
          cloudflareRouteReceivedAtEpochMs: 1_777_009_999_900,
        },
      },
      { notifiedAtEpochMs: firstWakeAcceptedAtEpochMs },
      { notifiedAtEpochMs: secondWakeAcceptedAtEpochMs },
    ]);
    expect(invocationResponse.status).toBe(200);
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    const logInputs = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input);
    expect(logInputs).toContainEqual(expect.objectContaining({
      details: {
        activeHostedRunnerJobCount: 1,
        activeRuntimeWakePresent: true,
        pendingRuntimeWakeDelivered: true,
        workspaceAttemptId: "attempt_evt_runtime_wake_ready",
      },
      message: "Hosted container invocation reported runtime wake readiness.",
      userId: null,
    }));
    expect(logInputs
      .filter((input) =>
        input.message === "Hosted container entrypoint handled runtime wake request."
      )
      .map((input) => input.details)).toEqual([
        {
          activeHostedRunnerJobCount: 0,
          activeRuntimeWakePending: false,
          activeRuntimeWakePresent: false,
          runtimeWakeAccepted: false,
          runtimeWakeAbsent: false,
          runtimeWakeMismatch: false,
          runtimeWakePending: false,
          workspaceAttemptId: null,
          workspacePendingAttemptId: null,
        },
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePending: true,
          activeRuntimeWakePresent: false,
          runtimeWakeAccepted: true,
          runtimeWakeAbsent: false,
          runtimeWakeMismatch: false,
          runtimeWakePending: true,
          workspaceAttemptId: null,
          workspacePendingAttemptId: "attempt_evt_runtime_wake_ready",
        },
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePending: true,
          activeRuntimeWakePresent: false,
          runtimeWakeAccepted: true,
          runtimeWakeAbsent: false,
          runtimeWakeMismatch: false,
          runtimeWakePending: true,
          workspaceAttemptId: null,
          workspacePendingAttemptId: "attempt_evt_runtime_wake_ready",
        },
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePending: false,
          activeRuntimeWakePresent: true,
          runtimeWakeAccepted: true,
          runtimeWakeAbsent: false,
          runtimeWakeMismatch: false,
          runtimeWakePending: false,
          workspaceAttemptId: "attempt_evt_runtime_wake_ready",
          workspacePendingAttemptId: "attempt_evt_runtime_wake_ready",
        },
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePending: false,
          activeRuntimeWakePresent: true,
          runtimeWakeAccepted: true,
          runtimeWakeAbsent: false,
          runtimeWakeMismatch: false,
          runtimeWakePending: false,
          workspaceAttemptId: "attempt_evt_runtime_wake_ready",
          workspacePendingAttemptId: "attempt_evt_runtime_wake_ready",
        },
      ]);
  });

  it("requires exact runtime wake identity before waking an active invocation", async () => {
    const invocationReady = createDeferred();
    const releaseInvocation = createDeferred();
    let runtimeWakeCount = 0;
    vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockImplementation(
      async (_job, options) => {
        options?.onRuntimeWakeReady?.(() => {
          runtimeWakeCount += 1;
          return true;
        });
        invocationReady.resolve();
        await releaseInvocation.promise;
        return buildWorkspaceRunnerResult();
      },
    );

    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const invocation = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_runtime_wake_identity",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    await invocationReady.promise;

    const staleWakeRequests = [
      {
        attemptId: "attempt_stale",
        leaseGeneration: "1",
        userId: "u1",
      },
      {
        attemptId: "attempt_evt_runtime_wake_identity",
        leaseGeneration: "2",
        userId: "u1",
      },
      {
        attemptId: "attempt_evt_runtime_wake_identity",
        leaseGeneration: "1",
        userId: "u2",
      },
    ];
    const staleWakes: Response[] = [];
    for (const wakeRequest of staleWakeRequests) {
      staleWakes.push(await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
        body: JSON.stringify(wakeRequest),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }));
    }
    const matchingWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      body: JSON.stringify({
        attemptId: "attempt_evt_runtime_wake_identity",
        leaseGeneration: "1",
        userId: "u1",
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });
    releaseInvocation.resolve();
    const invocationResponse = await invocation;

    for (const staleWake of staleWakes) {
      expect(staleWake.status).toBe(204);
      expect(staleWake.headers.get("x-runtime-wake-accepted")).toBe("0");
      expect(staleWake.headers.get("x-runtime-wake-identity-checked")).toBeNull();
      expect(staleWake.headers.get("x-runtime-wake-mismatch")).toBe("1");
    }
    expect(matchingWake.status).toBe(204);
    expect(matchingWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(matchingWake.headers.get("x-runtime-wake-identity-checked")).toBe("1");
    expect(matchingWake.headers.get("x-runtime-wake-mismatch")).toBeNull();
    expect(runtimeWakeCount).toBe(1);
    expect(invocationResponse.status).toBe(200);
  });

  it("does not mark runtime wakes accepted when the active invocation cannot consume them", async () => {
    const invocationReady = createDeferred();
    const releaseInvocation = createDeferred();
    let invocationCanReceiveWake = false;
    vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockImplementation(
      async (_job, options) => {
        options?.onRuntimeWakeReady?.(() => invocationCanReceiveWake);
        invocationReady.resolve();
        await releaseInvocation.promise;
        return buildWorkspaceRunnerResult();
      },
    );

    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const invocation = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_runtime_wake_disconnected",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    await invocationReady.promise;

    const rejectedWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    invocationCanReceiveWake = true;
    const acceptedWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    releaseInvocation.resolve();
    const invocationResponse = await invocation;

    expect(rejectedWake.status).toBe(204);
    expect(rejectedWake.headers.get("x-runtime-wake-accepted")).toBe("0");
    expect(acceptedWake.status).toBe(204);
    expect(acceptedWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(invocationResponse.status).toBe(200);
    expect(mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .filter((input) =>
        input.message === "Hosted container entrypoint handled runtime wake request."
      )
      .map((input) => input.details)).toEqual([
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePending: false,
          activeRuntimeWakePresent: true,
          runtimeWakeAccepted: false,
          runtimeWakeAbsent: false,
          runtimeWakeMismatch: false,
          runtimeWakePending: false,
          workspaceAttemptId: "attempt_evt_runtime_wake_disconnected",
          workspacePendingAttemptId: "attempt_evt_runtime_wake_disconnected",
        },
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePending: false,
          activeRuntimeWakePresent: true,
          runtimeWakeAccepted: true,
          runtimeWakeAbsent: false,
          runtimeWakeMismatch: false,
          runtimeWakePending: false,
          workspaceAttemptId: "attempt_evt_runtime_wake_disconnected",
          workspacePendingAttemptId: "attempt_evt_runtime_wake_disconnected",
        },
      ]);
  });

  it("includes runner bundle metadata on the health endpoint when the manifest is present", async () => {
    const readFile = vi.fn(async (filePath: string) => {
      expect(filePath.endsWith(".murph-runner-bundle-manifest.json")).toBe(true);
      return JSON.stringify({
        buildSkipped: false,
        bundleFingerprint: "bundle-fingerprint",
        generatedAt: "2026-04-24T00:00:00.000Z",
        schemaVersion: 2,
        sourceFingerprint: "source-fingerprint",
      });
    });
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        processApi: {
          readFile,
        },
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });

    expect(response).toMatchObject({ status: 200 });
    expect(response.json).toMatchObject({
      ok: true,
      runnerBundle: {
        buildSkipped: false,
        bundleFingerprint: "bundle-fingerprint",
        generatedAt: "2026-04-24T00:00:00.000Z",
        schemaVersion: 2,
        sourceFingerprint: "source-fingerprint",
      },
      service: "cloudflare-hosted-runner-node",
    });

    const secondResponse = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.json).toMatchObject({
      ok: true,
      runnerBundle: {
        bundleFingerprint: "bundle-fingerprint",
        sourceFingerprint: "source-fingerprint",
      },
    });
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("runs the managed-container Codex shell smoke through the app-server hook", async () => {
    const runCodexShellSmoke = vi.fn(async () => ({
      client: "codex-app-server" as const,
      cliSurfaceContractBytes: 37282,
      cliSurfaceHotPathProofCount: 4,
      murphPathBytes: 28,
      noteAddBytes: 128,
      stderrBytes: 0,
      vaultCliLlmsBytes: 4096,
      vaultCliPathBytes: 32,
      vaultShowBytes: 256,
    }));
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runCodexShellSmoke,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerJsonRequest({
      body: "",
      path: "/internal/deploy-codex-shell-smoke",
      port: address.port,
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      codexShell: {
        client: "codex-app-server",
        cliSurfaceContractBytes: 37282,
        cliSurfaceHotPathProofCount: 4,
        murphPathBytes: 28,
        noteAddBytes: 128,
        stderrBytes: 0,
        vaultCliLlmsBytes: 4096,
        vaultCliPathBytes: 32,
        vaultShowBytes: 256,
      },
      ok: true,
    });
    expect(runCodexShellSmoke).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });

  it("surfaces content-free Codex shell smoke failure diagnostics", async () => {
    const runCodexShellSmoke = vi.fn(async () => {
      throw new Error(
        "Hosted Codex shell smoke assistant CLI surface contract was missing hot-path schemas. proofCount=1",
      );
    });
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runCodexShellSmoke,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerJsonRequest({
      body: "",
      path: "/internal/deploy-codex-shell-smoke",
      port: address.port,
    });

    expect(response.status).toBe(500);
    expect(response.json).toEqual({
      error: "Hosted Codex shell smoke failed.",
      ok: false,
      smokeErrorMessage:
        "Hosted Codex shell smoke assistant CLI surface contract was missing hot-path schemas. proofCount=1",
    });
  });

  it("runs the managed-container live model turn smoke through the codex exec hook", async () => {
    const runLiveModelTurnSmoke = vi.fn(async () => ({
      durationMs: 1_234,
      model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
      stdoutBytes: 2_048,
    }));
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runLiveModelTurnSmoke,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerJsonRequest({
      body: "",
      path: "/internal/deploy-live-model-turn-smoke",
      port: address.port,
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      liveModelTurn: {
        durationMs: 1_234,
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
        stdoutBytes: 2_048,
      },
      ok: true,
    });
    expect(runLiveModelTurnSmoke).toHaveBeenCalledWith({
      model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
      signal: expect.any(AbortSignal),
    });
  });

  it("passes the managed-container live model turn smoke prompt through codex exec stdin", async () => {
    const smokeHomeParent = await mkdtemp(path.join(
      path.sep,
      "var",
      "tmp",
      "murph-codex-smoke-home-",
    ));
    const previousHostedHome = process.env.HOSTED_HOME;
    let codexConfigToml = "";
    const stdinChunks: string[] = [];
    process.env.HOSTED_HOME = smokeHomeParent;
    mocks.spawn.mockImplementationOnce((_command, _args, options) => {
      const codexHome = options?.env?.CODEX_HOME;
      if (!codexHome) {
        throw new Error("Expected deploy live-turn smoke to pass CODEX_HOME.");
      }
      codexConfigToml = readFileSync(path.join(codexHome, "config.toml"), "utf8");
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const process = new EventEmitter();
      const spawnedProcess = Object.assign(process, {
        kill: vi.fn(() => true),
        stderr,
        stdin: {
          end: vi.fn((chunk?: string | Uint8Array) => {
            if (typeof chunk === "string") {
              stdinChunks.push(chunk);
            } else if (chunk instanceof Uint8Array) {
              stdinChunks.push(Buffer.from(chunk).toString("utf8"));
            }
            queueMicrotask(() => {
              stdout.emit("data", `${JSON.stringify({
                item: {
                  text: DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
                  type: "agent_message",
                },
                type: "item.completed",
              })}\n`);
              spawnedProcess.emit("close", 0, null);
            });
          }),
        },
        stdout,
      });
      return spawnedProcess;
    });

    try {
      const server = await startHostedContainerEntrypoint({ port: 0 });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await sendHostedContainerJsonRequest({
        body: "",
        path: "/internal/deploy-live-model-turn-smoke",
        port: address.port,
      });

      expect(response.status).toBe(200);
      expect(response.json).toMatchObject({
        liveModelTurn: {
          model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
        },
        ok: true,
      });
      expect(stdinChunks).toEqual([DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT]);
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      const spawnCall = mocks.spawn.mock.calls.at(0);
      expect(spawnCall).toBeDefined();
      if (!spawnCall) {
        throw new Error("Expected codex exec spawn call.");
      }
      expect(spawnCall[0]).toBe("codex");
      expect(spawnCall[1]).toEqual([
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-",
      ]);
      expect(spawnCall[2]).toEqual(expect.objectContaining({
        cwd: expect.stringMatching(/vault$/u),
        stdio: ["pipe", "pipe", "pipe"],
      }));
      expect(codexConfigToml).toContain('model_provider = "hosted-shell-smoke"');
      expect(codexConfigToml).toContain('env_key = "OPENAI_API_KEY"');
      expect(codexConfigToml).toContain('wire_api = "responses"');
      expect(codexConfigToml).toContain("requires_openai_auth = false");
      expect(codexConfigToml).toContain("supports_websockets = false");
      expect(codexConfigToml).toContain("request_max_retries = 4");
      expect(codexConfigToml).toContain("stream_max_retries = 5");
      expect(codexConfigToml).toContain("multi_agent_v2 = true");
      expectCodexConfigDisablesLoginShellAtTopLevel(codexConfigToml);
    } finally {
      if (previousHostedHome === undefined) {
        delete process.env.HOSTED_HOME;
      } else {
        process.env.HOSTED_HOME = previousHostedHome;
      }
      await rm(smokeHomeParent, {
        force: true,
        recursive: true,
      });
    }
  });

  it("extracts redacted JSONL stdout diagnostics when live model turn smoke exits nonzero", async () => {
    const smokeHomeParent = await mkdtemp(path.join(
      path.sep,
      "var",
      "tmp",
      "murph-codex-smoke-home-",
    ));
    const previousHostedHome = process.env.HOSTED_HOME;
    const stdinChunks: string[] = [];
    process.env.HOSTED_HOME = smokeHomeParent;
    mocks.spawn.mockImplementationOnce(() => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const process = new EventEmitter();
      const spawnedProcess = Object.assign(process, {
        kill: vi.fn(() => true),
        stderr,
        stdin: {
          end: vi.fn((chunk?: string | Uint8Array) => {
            if (typeof chunk === "string") {
              stdinChunks.push(chunk);
            } else if (chunk instanceof Uint8Array) {
              stdinChunks.push(Buffer.from(chunk).toString("utf8"));
            }
            queueMicrotask(() => {
              stdout.emit("data", "plain text should be ignored\n");
              stdout.emit("data", `${JSON.stringify({
                error: {
                  message:
                    `unsupported hosted search api_key=<VALUE> sk-proj-${"a".repeat(24)} échoué`,
                },
                type: "error",
              })}\n`);
              stdout.emit("data", `${JSON.stringify({
                message:
                  `fallback message id_token=<VALUE> eyJ${"b".repeat(12)}.${"c".repeat(12)}.${"d".repeat(12)}`,
                type: "error",
              })}\n`);
              stderr.emit("data", "short stderr clue\n");
              spawnedProcess.emit("close", 1, null);
            });
          }),
        },
        stdout,
      });
      return spawnedProcess;
    });

    try {
      const server = await startHostedContainerEntrypoint({ port: 0 });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await sendHostedContainerJsonRequest({
        body: "",
        path: "/internal/deploy-live-model-turn-smoke",
        port: address.port,
      });

      expect(response.status).toBe(500);
      expect(response.json).toMatchObject({
        error: "Hosted live model turn smoke failed.",
        ok: false,
      });
      const smokeErrorMessage = (response.json as { smokeErrorMessage?: unknown }).smokeErrorMessage;
      expect(typeof smokeErrorMessage).toBe("string");
      expect(smokeErrorMessage).toContain("stdoutExcerpt");
      expect(smokeErrorMessage).toContain("unsupported hosted search");
      expect(smokeErrorMessage).toContain("fallback message");
      expect(smokeErrorMessage).toContain("api_key=<REDACTED>");
      expect(smokeErrorMessage).toContain("id_token=<REDACTED>");
      expect(smokeErrorMessage).toContain("short stderr clue");
      expect(smokeErrorMessage).not.toContain("<VALUE>");
      expect(smokeErrorMessage).not.toContain("sk-proj-");
      expect(smokeErrorMessage).not.toContain("eyJ");
      expect(smokeErrorMessage).not.toContain("échoué");
      expect(smokeErrorMessage).not.toContain("plain text should be ignored");
      expect((smokeErrorMessage as string).length).toBeLessThanOrEqual(512);
      expect(stdinChunks).toEqual([DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT]);
    } finally {
      if (previousHostedHome === undefined) {
        delete process.env.HOSTED_HOME;
      } else {
        process.env.HOSTED_HOME = previousHostedHome;
      }
      await rm(smokeHomeParent, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps deploy-smoke Codex home outside the system temporary directory", () => {
    const hostedHome = path.join(path.sep, "home", "runner", ".murph");
    const runnerHome = path.join(path.sep, "home", "runner");

    expect(resolveHostedContainerCodexSmokeHomeRoot({
      HOME: path.join(tmpdir(), "hosted-codex-shell-smoke-home"),
      HOSTED_HOME: hostedHome,
    })).toBe(path.join(hostedHome, ".codex-deploy-smoke"));
    expect(resolveHostedContainerCodexSmokeHomeRoot({
      HOME: runnerHome,
    })).toBe(path.join(runnerHome, ".codex-deploy-smoke"));
  });

  it("rejects deploy-smoke Codex home parents under the system temporary directory", () => {
    expect(() => resolveHostedContainerCodexSmokeHomeRoot({
      HOME: path.join(tmpdir(), "hosted-codex-shell-smoke-home"),
      HOSTED_HOME: "relative-hosted-home",
    })).toThrow(
      "Hosted Codex shell smoke CODEX_HOME parent must not be under the system temporary directory.",
    );
  });

  it("surfaces capped ASCII-only live model turn smoke failure diagnostics", async () => {
    const runLiveModelTurnSmoke = vi.fn(async () => {
      throw new Error(
        `Hosted live model turn smoke codex exec exited with 1. stdoutExcerpt="unsupported tool ${"y".repeat(600)}" stderrExcerpt="quota éxhausted ${"x".repeat(600)}"`,
      );
    });
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runLiveModelTurnSmoke,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerJsonRequest({
      body: "",
      path: "/internal/deploy-live-model-turn-smoke",
      port: address.port,
    });

    expect(response.status).toBe(500);
    expect(response.json).toMatchObject({
      error: "Hosted live model turn smoke failed.",
      ok: false,
    });
    const smokeErrorMessage = (response.json as { smokeErrorMessage?: unknown }).smokeErrorMessage;
    expect(typeof smokeErrorMessage).toBe("string");
    expect(smokeErrorMessage).toContain("codex exec exited with 1");
    expect(smokeErrorMessage).toContain("stdoutExcerpt");
    expect(smokeErrorMessage).not.toContain("é");
    expect((smokeErrorMessage as string).length).toBeLessThanOrEqual(512);
  });

  it("runs the managed-container direct R2 presigned PUT smoke through the container network", async () => {
    const runDirectR2PresignedPutSmoke = vi.fn(async () => ({
      byteLength: 4096,
      durationMs: 12,
      ok: true,
      payloadSha256: "a".repeat(64),
      responseBodyBytes: 2,
      status: 200,
    }));
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runDirectR2PresignedPutSmoke,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerJsonRequest({
      body: JSON.stringify({
        byteLength: 4096,
        presignedPutUrl:
          "https://example-account.r2.cloudflarestorage.com/test-bucket/snapshot.enc?X-Amz-Signature=test",
      }),
      path: "/internal/direct-r2-presigned-put-smoke",
      port: address.port,
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      directR2PresignedPut: {
        byteLength: 4096,
        durationMs: 12,
        ok: true,
        payloadSha256: "a".repeat(64),
        responseBodyBytes: 2,
        status: 200,
      },
      ok: true,
    });
    expect(runDirectR2PresignedPutSmoke).toHaveBeenCalledWith({
      byteLength: 4096,
      presignedPutUrl:
        "https://example-account.r2.cloudflarestorage.com/test-bucket/snapshot.enc?X-Amz-Signature=test",
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects the removed legacy internal run alias", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/__internal/run`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_removed_alias",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("does not expose the removed browser-vault refresh side path", async () => {
    const runWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runWorkspaceInvocation,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/browser-vault-refresh`, {
      body: "{]",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
    expect(runWorkspaceInvocation).not.toHaveBeenCalled();
  });

  it("does not expose the removed warm-shell health side route", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/control-health`);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("logs a structured listen failure when the container cannot start", async () => {
    await expect(startHostedContainerEntrypoint({
      port: -1,
    })).rejects.toThrow();

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          port: -1,
        }),
        level: "error",
        message: "Hosted container entrypoint failed to start listening.",
        phase: "failed",
      }),
    );
  });

  it("returns a stable invalid JSON error for malformed invocation requests", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: "{]",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "syntax_error",
      details: {
        errorDetail: expect.stringContaining("Expected property name or '}'"),
      },
      error: "Invalid JSON.",
      errorName: "SyntaxError",
    });
  });

  it("rejects oversized invocation requests before parsing JSON", async () => {
    const runnerSpy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerDeclaredLengthRequest({
      contentLength: hostedContainerRunRequestBodyLimitBytes + 1,
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    expect(response.status).toBe(413);
    expect(response.json).toEqual({
      code: "request_body_too_large",
      error: "Request body too large.",
    });
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("rejects oversized invocation requests while receiving the body", async () => {
    const runnerSpy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerChunkedRequest({
      chunks: [
        " ".repeat(hostedContainerRunRequestBodyLimitBytes),
        " ",
      ],
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    expect(response.status).toBe(413);
    expect(response.json).toEqual({
      code: "request_body_too_large",
      error: "Request body too large.",
    });
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("decodes invocation requests without bearer-token auth", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: "{]",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "syntax_error",
      error: "Invalid JSON.",
    });
  });

  it("parses requests through hosted runtime contracts before direct invocation", async () => {
    const requestBody = buildJobBody({
      wake: {
        event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u_loader_split" },
        eventId: "evt_loader_split",
        occurredAt: "2026-04-21T12:00:00.000Z",
      },
    });
    const actualContractsModule =
      await vi.importActual<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>(
        "@murphai/assistant-runtime/hosted-runtime-contracts",
      );
    const parsedJob =
      actualContractsModule.parseHostedAssistantWorkspaceRuntimeJobInput(requestBody.job);
    const parseHostedAssistantWorkspaceRuntimeJobInput = vi.fn(() => parsedJob);
    const contractsModule = {
      ...actualContractsModule,
      parseHostedAssistantWorkspaceRuntimeJobInput,
    };
    const loadRuntimeContracts = vi.fn(async () => contractsModule);
    const runWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runWorkspaceInvocation,
        loadRuntimeContracts,
      },
    });
    servers.push(server);

    expect(runWorkspaceInvocation).not.toHaveBeenCalled();
    expect(loadRuntimeContracts).not.toHaveBeenCalled();

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(requestBody),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(loadRuntimeContracts).toHaveBeenCalledTimes(1);
    expect(runWorkspaceInvocation).toHaveBeenCalledTimes(1);
    expect(parseHostedAssistantWorkspaceRuntimeJobInput).toHaveBeenCalledWith(requestBody.job);
    expect(runWorkspaceInvocation).toHaveBeenCalledWith(
      {
        ...parsedJob,
        kind: "workspace-invocation",
      },
      expect.objectContaining({
        supervisorEnv: expect.any(Object),
      }),
    );
  });

  it("parses workspace-invocation requests through the workspace contract before direct invocation", async () => {
    const baseRequestBody = buildWorkspaceJobBody();
    const requestBody = {
      ...baseRequestBody,
      job: {
        ...baseRequestBody.job,
        diagnostics: {
          workspaceSnapshotPathHashSecret: TEST_SNAPSHOT_PATH_HASH_SECRET,
        },
      },
    };
    const actualContractsModule =
      await vi.importActual<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>(
        "@murphai/assistant-runtime/hosted-runtime-contracts",
      );
    const parsedJob =
      actualContractsModule.parseHostedAssistantWorkspaceRuntimeJobInput(requestBody.job);
    const parseHostedAssistantWorkspaceRuntimeJobInput = vi.fn(() => parsedJob);
    const contractsModule = {
      ...actualContractsModule,
      parseHostedAssistantWorkspaceRuntimeJobInput,
    };
    const runWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runWorkspaceInvocation,
        loadRuntimeContracts: vi.fn(async () => contractsModule),
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(requestBody),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(parseHostedAssistantWorkspaceRuntimeJobInput).toHaveBeenCalledWith(requestBody.job);
    expect(runWorkspaceInvocation).toHaveBeenCalledWith(
      {
        diagnostics: {
          workspaceSnapshotPathHashSecret: TEST_SNAPSHOT_PATH_HASH_SECRET,
        },
        ...parsedJob,
        kind: "workspace-invocation",
      },
      expect.objectContaining({
        supervisorEnv: expect.any(Object),
      }),
    );
  });

  it("rejects malformed workspace snapshot diagnostics keys before direct invocation", async () => {
    const runHostedWorkspaceInvocation = vi
      .spyOn(hostedInvocation, "runHostedWorkspaceInvocation")
      .mockResolvedValue(buildWorkspaceRunnerResult());

    try {
      const baseRequestBody = buildWorkspaceJobBody();
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify({
          ...baseRequestBody,
          job: {
            ...baseRequestBody.job,
            diagnostics: {
              workspaceSnapshotPathHashSecret: "diagnostic-secret",
            },
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "type_error",
        details: {
          errorDetail: expect.stringContaining(
            "workspaceSnapshotPathHashSecret must be a 64-character lowercase hexadecimal derived diagnostics key",
          ),
        },
        error: "Invalid request.",
        errorName: "TypeError",
      });
      expect(runHostedWorkspaceInvocation).not.toHaveBeenCalled();
    } finally {
      runHostedWorkspaceInvocation.mockRestore();
    }
  });

  it("rejects stale architecture-version requests before direct invocation", async () => {
    const runHostedWorkspaceInvocation = vi
      .spyOn(hostedInvocation, "runHostedWorkspaceInvocation")
      .mockResolvedValue(buildWorkspaceRunnerResult());

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const requestBody = {
        ...buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_architecture_mismatch",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        }),
        hostedRuntimeArchitectureVersion: "legacy-child-v0",
      };
      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        actualVersion: "legacy-child-v0",
        code: "runtime_architecture_mismatch",
        error: "Hosted runtime architecture mismatch.",
        expectedVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
      });
      expect(runHostedWorkspaceInvocation).not.toHaveBeenCalled();
    } finally {
      runHostedWorkspaceInvocation.mockRestore();
    }
  });

  it("keeps startup health independent from direct invocation loading", async () => {
    const runWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runWorkspaceInvocation,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });

    expect(runWorkspaceInvocation).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner-node",
    });
  });

  it("forwards the hosted runner job, abort signal, and frozen supervisor env into direct invocation", async () => {
    const runnerSpy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_direct_proxy_token_only",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(runnerSpy).toHaveBeenCalledTimes(1);
      const options = runnerSpy.mock.calls[0]?.[1];
      expect(options?.onRuntimeWakeReady).toEqual(expect.any(Function));
      expect(options?.runnerJobAcceptedAt).toEqual(expect.any(String));
      expect(options?.signal).toEqual(expect.any(AbortSignal));
      expect(options?.supervisorEnv).toBeDefined();
      expect(Object.isFrozen(options?.supervisorEnv)).toBe(true);
    } finally {
      runnerSpy.mockRestore();
    }
  });

  it("attaches a numeric nodeStartupMs to the first (cold) invocation only and null thereafter", async () => {
    const runnerSpy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const sendInvocation = async (eventId: string) =>
        await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
          body: JSON.stringify(buildJobBody({
            wake: {
              event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
              eventId,
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
          })),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        });

      const first = await sendInvocation("evt_cold_node_startup_1");
      expect(first.status).toBe(200);
      const second = await sendInvocation("evt_warm_node_startup_2");
      expect(second.status).toBe(200);

      expect(runnerSpy).toHaveBeenCalledTimes(2);

      // The first (cold) invocation observes the node-startup span captured in the
      // server.listen callback: a non-negative finite number.
      const coldOptions = runnerSpy.mock.calls[0]?.[1];
      expect(typeof coldOptions?.nodeStartupMs).toBe("number");
      expect(Number.isFinite(coldOptions?.nodeStartupMs as number)).toBe(true);
      expect(coldOptions?.nodeStartupMs as number).toBeGreaterThanOrEqual(0);

      // A warm process predates its message, so its startup is not attributable to
      // that turn: the pending cold value is consumed once and reset to null.
      const warmOptions = runnerSpy.mock.calls[1]?.[1];
      expect(warmOptions?.nodeStartupMs ?? null).toBeNull();
    } finally {
      runnerSpy.mockRestore();
    }
  });

  it("parses x-dispatch-* headers into options.dispatch and drops invalid values", async () => {
    const runnerSpy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const sendInvocation = async (eventId: string, dispatchHeaders: Record<string, string>) =>
        await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
          body: JSON.stringify(buildJobBody({
            wake: {
              event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
              eventId,
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
          })),
          headers: {
            "content-type": "application/json; charset=utf-8",
            ...dispatchHeaders,
          },
          method: "POST",
        });

      // Both stamps valid: parsed into options.dispatch as epoch-ms integers.
      const both = await sendInvocation("evt_dispatch_headers_valid", {
        "x-dispatch-container-ensure-ready-started-at-ms": "1777000000050",
        "x-dispatch-invoke-received-at-ms": "1777000000000",
      });
      expect(both.status).toBe(200);

      // Invalid stamps are diagnostics-only and must be dropped per value: the
      // non-numeric stamp disappears while the valid one survives, and the job
      // itself is never failed by a bad header.
      const partial = await sendInvocation("evt_dispatch_headers_partial", {
        "x-dispatch-container-ensure-ready-started-at-ms": "1777000000050",
        "x-dispatch-invoke-received-at-ms": "not-a-number",
      });
      expect(partial.status).toBe(200);

      // All invalid (non-numeric, negative): no dispatch object at all.
      const invalid = await sendInvocation("evt_dispatch_headers_invalid", {
        "x-dispatch-container-ensure-ready-started-at-ms": "-5",
        "x-dispatch-invoke-received-at-ms": "soon",
      });
      expect(invalid.status).toBe(200);

      // Absent headers: no dispatch object either.
      const absent = await sendInvocation("evt_dispatch_headers_absent", {});
      expect(absent.status).toBe(200);

      expect(runnerSpy).toHaveBeenCalledTimes(4);
      expect(runnerSpy.mock.calls[0]?.[1]?.dispatch).toEqual({
        containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
        invokeReceivedAtEpochMs: 1_777_000_000_000,
      });
      expect(runnerSpy.mock.calls[1]?.[1]?.dispatch).toEqual({
        containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
      });
      expect(runnerSpy.mock.calls[2]?.[1]?.dispatch ?? null).toBeNull();
      expect(runnerSpy.mock.calls[3]?.[1]?.dispatch ?? null).toBeNull();
    } finally {
      runnerSpy.mockRestore();
    }
  });

  it("returns a stable invalid request error when the run body is not an object", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(["not-an-object"]),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "type_error",
      details: {
        errorDetail: "Hosted container runner request must be an object.",
      },
      error: "Invalid request.",
      errorName: "TypeError",
    });
  });

  it("surfaces the failing nested request field when the hosted runtime job payload is malformed", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify({
        ...buildJobBody({
          wake: {
            event: {
              kind: "member.activated",
              memberChannels: {
                email: false,
                linq: false,
                telegram: false,
              },
              userId: "member_123",
            },
            eventId: "evt_bad_nested_field",
            occurredAt: "2026-04-01T00:00:00.000Z",
          },
        }),
        job: {
          ...buildJobBody({
            wake: {
              event: {
                kind: "member.activated",
                memberChannels: {
                  email: false,
                  linq: false,
                  telegram: false,
                },
                userId: "member_123",
              },
              eventId: "evt_bad_nested_field",
              occurredAt: "2026-04-01T00:00:00.000Z",
            },
          }).job,
          runtime: {
            userEnv: {
              OPENAI_API_KEY: 123,
            },
          },
        },
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "type_error",
      details: {
        errorDetail: expect.stringContaining("config.userEnv.OPENAI_API_KEY must be a string"),
      },
      error: "Invalid request.",
      errorName: "TypeError",
    });
  });

  it("surfaces safe downstream runtime TypeError diagnostics after request decoding succeeds", async () => {
    const spy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockRejectedValue(
      new TypeError("missing hosted runtime config"),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_type_error",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "type_error",
        details: {
          detailsPresent: false,
          errorMessagePresent: true,
          errorName: "TypeError",
          stackPresent: true,
        },
        error: "Hosted execution runtime failed.",
        errorName: "TypeError",
      });
      expect(JSON.stringify(payload)).not.toContain("missing hosted runtime config");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not promote legacy child-shaped diagnostics at the direct invocation boundary", async () => {
    const hiddenChildDetails = "hidden child detail";
    const spy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockRejectedValue(
      Object.assign(new Error("hidden direct runtime failure message"), {
        details: {
          childProcess: {
            abortedByParent: false,
            abortReasonMessage: hiddenChildDetails,
            exitCode: 1,
            stderrTail: hiddenChildDetails,
            stdoutTail: hiddenChildDetails,
          },
          childRuntimeErrorCode: "invalid_request",
          childRuntimeStage: "runtime.in-process",
          errorDetail: hiddenChildDetails,
        },
      }),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_legacy_child_details",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as Record<string, unknown>;
      expect(payload).toMatchObject({
        code: "runtime_error",
        details: {
          detailsKeys: [
            "childProcess",
            "childRuntimeErrorCode",
            "childRuntimeStage",
            "errorDetail",
          ],
          errorDetailPresent: true,
          errorMessagePresent: true,
          errorName: "Error",
          stackPresent: true,
        },
        error: "Hosted execution runtime failed.",
        errorName: "Error",
      });
      const details = payload.details as Record<string, unknown>;
      expect(details).not.toHaveProperty("childProcess");
      expect(details).not.toHaveProperty("childRuntimeErrorCode");
      expect(details).not.toHaveProperty("childRuntimeStage");
      const serializedPayload = JSON.stringify(payload);
      expect(serializedPayload).not.toContain("hidden direct runtime failure message");
      expect(serializedPayload).not.toContain(hiddenChildDetails);

      const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
        .map(([input]) => input)
        .find((input) => input.message === "Hosted container entrypoint failed a runner job.");
      expect(failureLogInput).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          detailsKeys: [
            "childProcess",
            "childRuntimeErrorCode",
            "childRuntimeStage",
            "errorDetail",
          ],
          errorDetailPresent: true,
        }),
        userId: null,
      }));
      const failureLogDetails = failureLogInput?.details as Record<string, unknown> | undefined;
      expect(failureLogDetails).not.toHaveProperty("childProcess");
      expect(failureLogDetails).not.toHaveProperty("childRuntimeErrorCode");
      expect(failureLogDetails).not.toHaveProperty("childRuntimeStage");
      const serializedFailureLog = JSON.stringify(failureLogInput);
      expect(serializedFailureLog).not.toContain("hidden direct runtime failure message");
      expect(serializedFailureLog).not.toContain(hiddenChildDetails);
    } finally {
      spy.mockRestore();
    }
  });

  it("redacts downstream runtime secrets while surfacing safe failure diagnostics", async () => {
    const spy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockRejectedValue(
      new Error("Authorization: Bearer placeholder for ops@example.com OPENAI_API_KEY=placeholder"),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_secret_error",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "authorization_error",
        details: {
          detailsPresent: false,
          errorMessagePresent: true,
          errorName: "Error",
          stackPresent: true,
        },
        error: "Hosted execution authorization failed.",
        errorName: "Error",
      });
      const serializedPayload = JSON.stringify(payload);
      expect(serializedPayload).not.toContain("placeholder");
      expect(serializedPayload).not.toContain("ops@example.com");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns safe configuration error details from the inner hosted runtime", async () => {
    const spy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockRejectedValue(
      new HostedAssistantConfigurationError(
        "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        "Hosted assistant defaults are missing.",
      ),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_config_error",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(503);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        details: {
          detailsPresent: false,
          errorCodeDetail: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
          errorMessagePresent: true,
          stackPresent: true,
        },
        error: "Hosted execution configuration is invalid.",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("passes the workspace-invocation context through request parsing into the node runner", async () => {
    const spy = vi.spyOn(hostedInvocation, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const requestBody = buildWorkspaceJobBody();
      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            attemptId: "attempt_container_workspace",
            leaseGeneration: "8",
            userId: "u_container_workspace",
            workspaceVersion: "5",
          }),
        }),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects concurrent invocation requests inside one warm container shell", async () => {
    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const firstRequest: {
      finish: () => void;
      responsePromise: Promise<{ json: unknown; status: number }>;
    } = (() => {
      let request!: ClientRequest;
      const responsePromise = new Promise<{ json: unknown; status: number }>((resolve, reject) => {
        const initializedRequest = httpRequest({
          headers: {
            connection: "close",
            "content-type": "application/json; charset=utf-8",
          },
          host: "127.0.0.1",
          method: "POST",
          path: "/internal/workspace-invocation",
          port: address.port,
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
        request = initializedRequest;
        initializedRequest.on("error", reject);
        initializedRequest.write("{");
      });
      return {
        finish: () => {
          request.end();
        },
        responsePromise,
      };
    })();

    const secondResponse = await sendHostedContainerJsonRequest({
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_busy",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      path: "/internal/workspace-invocation",
      port: address.port,
    });
    expect(secondResponse.status).toBe(409);
    expect(secondResponse.json).toEqual({
      error: "Hosted runner is busy.",
    });

    firstRequest.finish();
    const firstResponse = await firstRequest.responsePromise;
    expect(firstResponse.status).toBe(400);
    expect(firstResponse.json).toMatchObject({
      code: "syntax_error",
      details: {
        errorDetail: expect.stringContaining("Expected property name or '}'"),
      },
      error: "Invalid JSON.",
      errorName: "SyntaxError",
    });
  });

  it("observes response close separately from request abort", async () => {
    const request = new EventEmitter();
    const response = new EventEmitter() as EventEmitter & { writableEnded: boolean };
    response.writableEnded = false;

    const controller = createRequestAbortController(request, response);

    response.emit("close");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(Error);
    expect((controller.signal.reason as Error).message).toMatch(/response closed before completion/u);
    expect(controller.requestSignal.aborted).toBe(false);
    expect(controller.responseClosed()).toBe(true);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          exitReason: "response.closed",
        }),
        level: "warn",
        message: "Hosted container entrypoint exited because the response closed before completion.",
        phase: "failed",
      }),
    );

    controller.cleanup();
  });

});

describe("classifyRunnerJobError", () => {
  it("returns a configuration failure payload for hosted assistant config errors", () => {
    const classified = classifyRunnerJobError(
      new HostedAssistantConfigurationError(
        "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        "Hosted assistant defaults are missing.",
      ),
    );

    expect(classified).toMatchObject({
      payload: {
        code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        details: {
          detailsPresent: false,
          errorCodeDetail: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
          errorMessagePresent: true,
          stackPresent: true,
        },
        error: "Hosted execution configuration is invalid.",
      },
      statusCode: 503,
    });
  });

  it("surfaces safe generic runner failure metadata", () => {
    const classified = classifyRunnerJobError(new Error("boom"));

    expect(classified).toMatchObject({
      payload: {
        code: "runtime_error",
        details: {
          detailsPresent: false,
          errorMessagePresent: true,
          errorName: "Error",
          stackPresent: true,
        },
        error: "Hosted execution runtime failed.",
        errorName: "Error",
      },
      statusCode: 500,
    });
    expect(JSON.stringify(classified.payload)).not.toContain("boom");
  });

  it("transports a phase alongside a generic control-plane failure code", () => {
    const fetchFailure = new HostedRuntimeControlPlaneFetchError({
      cause: new TypeError("hidden control-plane transport failure"),
      description: "Hosted workspace snapshot",
      signalState: {
        callerSignalAborted: false,
        requestSignalAborted: false,
        timeoutMs: 5_000,
        timeoutSignalAborted: false,
      },
    });
    const wrappedFailure = Object.assign(
      new Error("hidden snapshot wrapper at /private/workspace/vault", {
        cause: fetchFailure,
      }),
      { code: "EACCES" },
    );
    attachHostedRuntimeFailurePhaseCode(
      wrappedFailure,
      "workspace.checkpoint.idle_compact",
    );

    const classified = classifyRunnerJobError(wrappedFailure);

    expect(classified).toMatchObject({
      payload: {
        code: "runtime_error",
        details: {
          errorCodeDetail: "EACCES",
          runtimeFailurePhaseCode:
            "runtime_phase:workspace.checkpoint.idle_compact",
        },
        error: "Hosted execution runtime failed.",
      },
      statusCode: 500,
    });
    expect(JSON.stringify(classified.payload)).not.toContain(
      "hidden control-plane transport failure",
    );
    expect(JSON.stringify(classified.payload)).not.toContain("hidden snapshot wrapper");
    expect(JSON.stringify(classified.payload)).not.toContain("/private/workspace/vault");
  });

  it("surfaces bundle-validation failures with their dedicated code and safe properties", () => {
    const classified = classifyRunnerJobError(
      Object.assign(new Error("Hosted bundle archive is invalid."), {
        code: "bundle_archive_validation_error",
        details: {
          bundleArchiveOperation: "runner-input",
          bundleRefPresent: false,
        },
        name: "HostedBundleArchiveValidationError",
        operation: "runner-input",
      }),
    );

    expect(classified).toMatchObject({
      payload: {
        code: "bundle_archive_validation_error",
        details: {
          detailsKeys: ["bundleArchiveOperation", "bundleRefPresent"],
          detailsPresent: true,
          errorCodeDetail: "bundle_archive_validation_error",
          errorMessagePresent: true,
          stackPresent: true,
        },
        error: "Hosted bundle archive validation failed.",
        errorName: "HostedBundleArchiveValidationError",
      },
      statusCode: 500,
    });
  });
});

function expectCodexConfigDisablesLoginShellAtTopLevel(config: string): void {
  expect(config.match(/^allow_login_shell\s*=/gmu)).toEqual(["allow_login_shell ="]);
  expect(config).toMatch(/^allow_login_shell = false$/mu);

  const loginShellIndex = config.indexOf("allow_login_shell = false");
  const firstSectionIndex = config.search(/^\[/mu);
  expect(firstSectionIndex === -1 || loginShellIndex < firstSectionIndex).toBe(true);
}
