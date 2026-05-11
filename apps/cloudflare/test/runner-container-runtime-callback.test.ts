import { describe, expect, it, vi } from "vitest";

import {
  RunnerContainer,
} from "../src/runner-container.js";
import type {
  HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.js";

describe("RunnerContainer runtime callback dispatch", () => {
  it("posts workspace jobs without installing outbound handlers or active-operation storage", async () => {
    const storage = createContainerStorageDouble();
    const setOutboundByHosts = vi.fn(async () => {});
    const startAndWaitForPorts = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});
    const containerFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health") || url.endsWith("/control-health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      return new Response(JSON.stringify(createRunnerResult({
        deferredCheckpointRequired: true,
        nextWakeAt: "2026-04-27T00:10:00.000Z",
      })), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    let status: "running" | "stopped" = "stopped";
    startAndWaitForPorts.mockImplementation(async () => {
      status = "running";
    });
    const container = new RunnerContainer({
      storage,
    } as never, {
      HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL: "https://worker.example.test",
    } as never);
    Object.assign(container, {
      containerFetch,
      destroy,
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      })),
      setOutboundByHosts,
      startAndWaitForPorts,
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({
      deferredCheckpointRequired: true,
      status: "idle",
    });

    const requestBody = readPostedRunnerBody(containerFetch, 0);
    expect(requestBody).toMatchObject({
      internalWorkerProxyToken: null,
      localInternalProxyBaseUrl: null,
      runtimeCallbackBaseUrl: "https://worker.example.test/",
    });
    expect(setOutboundByHosts).not.toHaveBeenCalled();
    expect([...storage.values.keys()].some((key) => key.includes("active-operation"))).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("runs a pending idle checkpoint from the activity-expired lifecycle hook", async () => {
    const beginIdleCheckpointLease = vi.fn(async () => ({
      attemptId: "checkpoint_attempt_123",
      generation: "12",
      userId: "member_123",
      workspaceVersion: "6",
    }));
    const finishIdleCheckpointLease = vi.fn(async () => ({
      completed: true,
    }));
    const storage = createContainerStorageDouble();
    const destroy = vi.fn(async () => {});
    const containerFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health") || url.endsWith("/control-health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      const body = JSON.parse(String(init?.body)) as { job?: { request?: { reason?: string } } };
      if (body.job?.request?.reason === "idle_shutdown_checkpoint") {
        return new Response(JSON.stringify(createRunnerResult({
          idleShutdownCheckpointed: true,
          nextWakeAt: "2026-04-27T00:20:00.000Z",
        })), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      return new Response(JSON.stringify(createRunnerResult({
        deferredCheckpointRequired: true,
        nextWakeAt: "2026-04-27T00:10:00.000Z",
      })), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    let status: "running" | "stopped" = "stopped";
    const container = new RunnerContainer({
      storage,
    } as never, {
      HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL: "https://worker.example.test",
      USER_RUNNER: {
        getByName: vi.fn(() => ({
          beginIdleCheckpointLease,
          finishIdleCheckpointLease,
        })),
      },
    } as never);
    Object.assign(container, {
      containerFetch,
      destroy: vi.fn(async () => {
        status = "stopped";
        await destroy();
      }),
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      })),
      startAndWaitForPorts: vi.fn(async () => {
        status = "running";
      }),
    });

    await container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });
    await container.onActivityExpired();

    const checkpointBody = readPostedRunnerBody(containerFetch, 1) as {
      job: {
        request: Record<string, unknown>;
      };
    } & Record<string, unknown>;
    expect(checkpointBody).toMatchObject({
      internalWorkerProxyToken: null,
      localInternalProxyBaseUrl: null,
      runtimeCallbackBaseUrl: "https://worker.example.test/",
    });
    expect(checkpointBody.job.request).toMatchObject({
      attemptId: "checkpoint_attempt_123",
      checkpointNextWakeAt: "2026-04-27T00:10:00.000Z",
      leaseGeneration: "12",
      reason: "idle_shutdown_checkpoint",
      userId: "member_123",
      workspaceVersion: "6",
    });
    expect(beginIdleCheckpointLease).toHaveBeenCalledWith({
      userId: "member_123",
      workspaceVersion: "6",
    });
    expect(finishIdleCheckpointLease).toHaveBeenCalledWith({
      attemptId: "checkpoint_attempt_123",
      generation: "12",
      nextWakeAt: "2026-04-27T00:20:00.000Z",
      userId: "member_123",
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("still shuts down when beginning the idle checkpoint lease fails", async () => {
    const beginIdleCheckpointLease = vi.fn(async () => {
      throw new Error("write fence already active");
    });
    const finishIdleCheckpointLease = vi.fn();
    const storage = createContainerStorageDouble();
    const destroy = vi.fn(async () => {});
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health") || url.endsWith("/control-health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      return new Response(JSON.stringify(createRunnerResult({
        deferredCheckpointRequired: true,
        nextWakeAt: "2026-04-27T00:10:00.000Z",
      })), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    let status: "running" | "stopped" = "stopped";
    const container = new RunnerContainer({
      storage,
    } as never, {
      HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL: "https://worker.example.test",
      USER_RUNNER: {
        getByName: vi.fn(() => ({
          beginIdleCheckpointLease,
          finishIdleCheckpointLease,
        })),
      },
    } as never);
    Object.assign(container, {
      containerFetch,
      destroy: vi.fn(async () => {
        status = "stopped";
        await destroy();
      }),
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      })),
      startAndWaitForPorts: vi.fn(async () => {
        status = "running";
      }),
    });

    await container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });
    await expect(container.onActivityExpired()).resolves.toBeUndefined();

    expect(beginIdleCheckpointLease).toHaveBeenCalledWith({
      userId: "member_123",
      workspaceVersion: "6",
    });
    expect(finishIdleCheckpointLease).not.toHaveBeenCalled();
    expect(countPostedRunnerRequests(containerFetch)).toBe(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("still shuts down when finishing the idle checkpoint lease fails", async () => {
    const beginIdleCheckpointLease = vi.fn(async () => ({
      attemptId: "checkpoint_attempt_123",
      generation: "12",
      userId: "member_123",
      workspaceVersion: "6",
    }));
    const finishIdleCheckpointLease = vi.fn(async () => {
      throw new Error("finish failed");
    });
    const storage = createContainerStorageDouble();
    const destroy = vi.fn(async () => {});
    const containerFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health") || url.endsWith("/control-health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      const body = JSON.parse(String(init?.body)) as { job?: { request?: { reason?: string } } };
      if (body.job?.request?.reason === "idle_shutdown_checkpoint") {
        return new Response(JSON.stringify(createRunnerResult({
          idleShutdownCheckpointed: true,
          nextWakeAt: "2026-04-27T00:20:00.000Z",
        })), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      return new Response(JSON.stringify(createRunnerResult({
        deferredCheckpointRequired: true,
        nextWakeAt: "2026-04-27T00:10:00.000Z",
      })), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    let status: "running" | "stopped" = "stopped";
    const container = new RunnerContainer({
      storage,
    } as never, {
      HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL: "https://worker.example.test",
      USER_RUNNER: {
        getByName: vi.fn(() => ({
          beginIdleCheckpointLease,
          finishIdleCheckpointLease,
        })),
      },
    } as never);
    Object.assign(container, {
      containerFetch,
      destroy: vi.fn(async () => {
        status = "stopped";
        await destroy();
      }),
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      })),
      startAndWaitForPorts: vi.fn(async () => {
        status = "running";
      }),
    });

    await container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });
    await expect(container.onActivityExpired()).resolves.toBeUndefined();

    expect(countPostedRunnerRequests(containerFetch)).toBe(2);
    expect(finishIdleCheckpointLease).toHaveBeenCalledWith({
      attemptId: "checkpoint_attempt_123",
      generation: "12",
      nextWakeAt: "2026-04-27T00:20:00.000Z",
      userId: "member_123",
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

function createWorkspaceRunnerJob(userId: string): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: "workspace-invocation",
    request: {
      attemptId: `attempt_${userId}`,
      leaseGeneration: "11",
      reason: "nudge",
      userId,
      workspaceVersion: "6",
    },
    runtime: {
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
    },
  };
}

function createRunnerResult(overrides: Record<string, unknown> = {}) {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle",
    ...overrides,
  };
}

function readPostedRunnerBody(
  containerFetch: ReturnType<typeof vi.fn>,
  requestIndex: number,
): Record<string, unknown> {
  const runnerRequests = containerFetch.mock.calls.filter(([url]) =>
    typeof url === "string" && url.endsWith("/workspace-invocation")
  );
  const call = runnerRequests[requestIndex];
  const init = call?.[1] as RequestInit | undefined;
  if (!init?.body) {
    throw new Error("Expected a runner invocation request body.");
  }
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function countPostedRunnerRequests(
  containerFetch: ReturnType<typeof vi.fn>,
): number {
  return containerFetch.mock.calls.filter(([url]) =>
    typeof url === "string" && url.endsWith("/workspace-invocation")
  ).length;
}

function createContainerStorageDouble() {
  const values = new Map<string, unknown>();
  return {
    values,
    async delete(key: string): Promise<boolean> {
      return values.delete(key);
    },
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
      return new Map(
        Array.from(values.entries())
          .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
          .map(([key, value]) => [key, value as T]),
      );
    },
    async put<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
  };
}
