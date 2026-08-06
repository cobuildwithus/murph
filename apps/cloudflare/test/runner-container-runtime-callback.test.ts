import { describe, expect, it, vi } from "vitest";

import {
  RunnerContainer,
} from "../src/runner-container.js";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "../src/hosted-runtime-architecture.js";
import type {
  HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.js";

describe("RunnerContainer internal runtime dispatch", () => {
  it("reports completion only after the exact container operation is inactive", async () => {
    let container!: RunnerContainer;
    let activeFenceAtReceipt: Awaited<
      ReturnType<RunnerContainer["readActiveRuntimeUserFence"]>
    > | null = null;
    const recordRuntimeCompletionFromContainer = vi.fn(async () => {
      activeFenceAtReceipt = await container.readActiveRuntimeUserFence();
      return { completed: true };
    });
    const environment = {
      USER_RUNNER: {
        getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
      },
    };
    ({ container } = createActivityExpiryContainerDouble({ environment }));

    const result = await container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });

    expect(result).toMatchObject({ status: "idle" });
    expect(recordRuntimeCompletionFromContainer).toHaveBeenCalledOnce();
    expect(recordRuntimeCompletionFromContainer).toHaveBeenCalledWith({
      attemptId: "attempt_member_123",
      generation: "11",
      result: expect.objectContaining({ status: "idle" }),
      userId: "member_123",
    });
    expect(activeFenceAtReceipt).toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("preserves a completed result when the completion receipt fails", async () => {
    const recordRuntimeCompletionFromContainer = vi.fn(async () => {
      throw new Error("completion receipt unavailable");
    });
    const { container } = createActivityExpiryContainerDouble({
      environment: {
        USER_RUNNER: {
          getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
        },
      },
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({ status: "idle" });
    expect(recordRuntimeCompletionFromContainer).toHaveBeenCalledOnce();
  });

  it("bounds a non-settling completion receipt and consumes its late rejection", async () => {
    vi.useFakeTimers();
    let rejectReceipt!: (error: unknown) => void;
    const receipt = new Promise<{ completed: boolean }>((_resolve, reject) => {
      rejectReceipt = reject;
    });
    const recordRuntimeCompletionFromContainer = vi.fn(() => receipt);
    const { container } = createActivityExpiryContainerDouble({
      environment: {
        USER_RUNNER: {
          getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
        },
      },
    });

    try {
      const invocation = container.invoke({
        job: createWorkspaceRunnerJob("member_123"),
        timeoutMs: 5_000,
        userId: "member_123",
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(recordRuntimeCompletionFromContainer).toHaveBeenCalledOnce();
      await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
        active: false,
        reason: "no_active_runtime",
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(invocation).resolves.toMatchObject({ status: "idle" });

      rejectReceipt(new Error("late completion receipt failure"));
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report an invocation that fails in the container", async () => {
    const recordRuntimeCompletionFromContainer = vi.fn(async () => ({
      completed: true,
    }));
    const { container } = createActivityExpiryContainerDouble({
      environment: {
        USER_RUNNER: {
          getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
        },
      },
      invocationStatus: 500,
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).rejects.toThrow();
    expect(recordRuntimeCompletionFromContainer).not.toHaveBeenCalled();
  });

  it("posts workspace jobs without active-operation storage", async () => {
    const storage = createContainerStorageDouble();
    const startAndWaitForPorts = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});
    const containerFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      return new Response(JSON.stringify(createRunnerResult({
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
    } as never, {} as never);
    Object.assign(container, {
      containerFetch,
      destroy,
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      })),
      startAndWaitForPorts,
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({
      status: "idle",
    });

    const requestBody = readPostedRunnerBody(containerFetch, 0);
    expect(requestBody).toMatchObject({
      hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
      job: {
        kind: "workspace-invocation",
      },
    });
    expect([...storage.values.keys()].some((key) => key.includes("active-operation"))).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("early activity expiry renews the warm shell without dispatching a checkpoint job", async () => {
    const renewActivityTimeout = vi.fn();
    const { container, containerFetch, destroy } = createActivityExpiryContainerDouble({
      renewActivityTimeout,
      resultOverrides: {
        nextWakeAt: "2026-04-27T00:10:00.000Z",
      },
    });

    await container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });
    containerFetch.mockClear();
    renewActivityTimeout.mockClear();

    await expect(container.onActivityExpired()).resolves.toBeUndefined();

    expect(countPostedRunnerRequests(containerFetch)).toBe(0);
    expect(destroy).not.toHaveBeenCalled();
    expect(renewActivityTimeout).toHaveBeenCalledTimes(1);
  });

  it("activity expiry cleans up when the platform timeout cannot be renewed", async () => {
    const { container, containerFetch, destroy } = createActivityExpiryContainerDouble();

    await container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });
    containerFetch.mockClear();

    await expect(container.onActivityExpired()).resolves.toBeUndefined();

    expect(countPostedRunnerRequests(containerFetch)).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

function createWorkspaceRunnerJob(userId: string): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: "workspace-invocation",
    request: {
      attemptId: `attempt_${userId}`,
      leaseGeneration: "11",
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

function createActivityExpiryContainerDouble(input: {
  environment?: ConstructorParameters<typeof RunnerContainer>[1];
  invocationStatus?: number;
  renewActivityTimeout?: ReturnType<typeof vi.fn>;
  resultOverrides?: Record<string, unknown>;
} = {}) {
  const storage = createContainerStorageDouble();
  const destroy = vi.fn(async () => {});
  const containerFetch = vi.fn(async (url: string) => {
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify(createRunnerHealthResult()), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    }

    return new Response(JSON.stringify(createRunnerResult(input.resultOverrides)), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: input.invocationStatus ?? 200,
    });
  });
  let status: "running" | "stopped" = "stopped";
  const container = new RunnerContainer({
    storage,
  } as never, input.environment ?? {});
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
    ...(input.renewActivityTimeout
      ? { renewActivityTimeout: input.renewActivityTimeout }
      : {}),
    startAndWaitForPorts: vi.fn(async () => {
      status = "running";
    }),
  });

  return {
    container,
    containerFetch,
    destroy,
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

function createRunnerHealthResult(): Record<string, unknown> {
  return {
    activeJobCount: 0,
    conversationWarmActivityCompletedAtEpochMs: null,
    hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    ok: true,
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
