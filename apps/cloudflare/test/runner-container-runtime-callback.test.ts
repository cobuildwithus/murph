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
  it("reports completion only after the exact operation is inactive and preserves an interaction-raced shell", async () => {
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
    const containerDouble = createActivityExpiryContainerDouble({ environment });
    container = containerDouble.container;

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
    expect(containerDouble.destroy).not.toHaveBeenCalled();
  });

  it("stops a terminal shell only after completion settlement and does not double-destroy", async () => {
    const completionReceipt = createDeferred<{ completed: boolean }>();
    const events: string[] = [];
    const recordRuntimeCompletionFromContainer = vi.fn(async () => {
      events.push("completion-started");
      const receipt = await completionReceipt.promise;
      events.push("completion-settled");
      return receipt;
    });
    const { container, destroy } = createActivityExpiryContainerDouble({
      destroyImplementation: async () => {
        events.push("destroyed");
      },
      environment: {
        USER_RUNNER: {
          getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
        },
      },
    });

    const invocation = container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });
    await vi.waitFor(() => {
      expect(recordRuntimeCompletionFromContainer).toHaveBeenCalledOnce();
    });
    expect(destroy).not.toHaveBeenCalled();

    completionReceipt.resolve({ completed: true });
    await expect(invocation).resolves.toMatchObject({ status: "idle" });

    expect(events).toEqual([
      "completion-started",
      "completion-settled",
      "destroyed",
    ]);
    expect(destroy).toHaveBeenCalledOnce();

    await expect(container.onActivityExpired()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "an immediate recheck",
      resultOverrides: {
        immediateRecheckRequested: true,
      },
    },
    {
      name: "a wake inside the lifecycle horizon",
      resultOverrides: {
        nextWakeAt: new Date(Date.now() + 30_000).toISOString(),
      },
    },
  ])("keeps the warm shell for $name", async ({ resultOverrides }) => {
    const recordRuntimeCompletionFromContainer = vi.fn(async () => ({
      completed: true,
    }));
    const { container, destroy } = createActivityExpiryContainerDouble({
      environment: {
        HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
        USER_RUNNER: {
          getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
        },
      },
      resultOverrides,
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({ status: "idle" });

    expect(recordRuntimeCompletionFromContainer).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
  });

  it.each([
    "active child",
    "recent conversation warmth",
    "legacy child without a warmth watermark",
  ])("keeps the terminal shell for $name", async (name) => {
    const nowMs = Date.now();
    const healthResult = name === "active child"
      ? {
          ...createRunnerHealthResult(),
          activeJobCount: 1,
        }
      : name === "recent conversation warmth"
        ? {
            ...createRunnerHealthResult(),
            conversationWarmActivityCompletedAtEpochMs: nowMs,
          }
        : {
            activeJobCount: 0,
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
          };
    const recordRuntimeCompletionFromContainer = vi.fn(async () => ({
      completed: true,
    }));
    const { container, destroy } = createActivityExpiryContainerDouble({
      environment: {
        USER_RUNNER: {
          getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
        },
      },
      healthResult,
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({ status: "idle" });

    expect(destroy).not.toHaveBeenCalled();
  });

  it("retries terminal cleanup on the lifecycle timer after container status is uncertain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const startedAtMs = Date.parse("2026-08-19T23:00:00.000Z");
      vi.setSystemTime(startedAtMs);
      const recordRuntimeCompletionFromContainer = vi.fn(async () => ({
        completed: true,
      }));
      const { container, destroy } = createActivityExpiryContainerDouble({
        environment: {
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
          USER_RUNNER: {
            getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
          },
        },
        lifecycleStateResults: [
          { lastChange: startedAtMs, status: "starting" },
          { lastChange: startedAtMs, status: "running" },
        ],
        renewActivityTimeout: vi.fn(),
      });

      await expect(container.invoke({
        job: createWorkspaceRunnerJob("member_123"),
        timeoutMs: 5_000,
        userId: "member_123",
      })).resolves.toMatchObject({ status: "idle" });
      expect(destroy).not.toHaveBeenCalled();

      vi.setSystemTime(startedAtMs + 60_001);
      await expect(container.onActivityExpired()).resolves.toBeUndefined();
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries terminal cleanup on the lifecycle timer after runner health is uncertain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const startedAtMs = Date.parse("2026-08-20T00:00:00.000Z");
      vi.setSystemTime(startedAtMs);
      const recordRuntimeCompletionFromContainer = vi.fn(async () => ({
        completed: true,
      }));
      const { container, destroy } = createActivityExpiryContainerDouble({
        environment: {
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
          USER_RUNNER: {
            getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
          },
        },
        healthResults: [
          createRunnerHealthResult(),
          new Error("health unavailable"),
          createRunnerHealthResult(),
        ],
        renewActivityTimeout: vi.fn(),
      });

      await expect(container.invoke({
        job: createWorkspaceRunnerJob("member_123"),
        timeoutMs: 5_000,
        userId: "member_123",
      })).resolves.toMatchObject({ status: "idle" });
      expect(destroy).not.toHaveBeenCalled();

      vi.setSystemTime(startedAtMs + 60_001);
      await expect(container.onActivityExpired()).resolves.toBeUndefined();
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the lifecycle timer after a stop failure and does not double-destroy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const startedAtMs = Date.parse("2026-08-20T01:00:00.000Z");
      vi.setSystemTime(startedAtMs);
      let destroyAttempt = 0;
      const recordRuntimeCompletionFromContainer = vi.fn(async () => ({
        completed: true,
      }));
      const { container, destroy } = createActivityExpiryContainerDouble({
        destroyImplementation: async () => {
          destroyAttempt += 1;
          if (destroyAttempt === 1) {
            throw new Error("destroy unavailable");
          }
        },
        environment: {
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
          USER_RUNNER: {
            getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
          },
        },
        renewActivityTimeout: vi.fn(),
      });

      await expect(container.invoke({
        job: createWorkspaceRunnerJob("member_123"),
        timeoutMs: 5_000,
        userId: "member_123",
      })).resolves.toMatchObject({ status: "idle" });
      expect(destroy).toHaveBeenCalledOnce();

      vi.setSystemTime(startedAtMs + 60_001);
      await expect(container.onActivityExpired()).resolves.toBeUndefined();
      expect(destroy).toHaveBeenCalledTimes(2);

      await expect(container.onActivityExpired()).resolves.toBeUndefined();
      expect(destroy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not clean up a terminal shell after a stale completion receipt", async () => {
    const recordRuntimeCompletionFromContainer = vi.fn(async () => ({
      completed: false,
    }));
    const { container, destroy } = createActivityExpiryContainerDouble({
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
    expect(destroy).not.toHaveBeenCalled();
  });

  it("preserves a completed result when the completion receipt fails", async () => {
    const recordRuntimeCompletionFromContainer = vi.fn(async () => {
      throw new Error("completion receipt unavailable");
    });
    const { container, destroy } = createActivityExpiryContainerDouble({
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
    expect(destroy).not.toHaveBeenCalled();
  });

  it("bounds a non-settling completion receipt and consumes its late rejection", async () => {
    vi.useFakeTimers();
    let rejectReceipt!: (error: unknown) => void;
    const receipt = new Promise<{ completed: boolean }>((_resolve, reject) => {
      rejectReceipt = reject;
    });
    const recordRuntimeCompletionFromContainer = vi.fn(() => receipt);
    const { container, destroy } = createActivityExpiryContainerDouble({
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
      expect(destroy).not.toHaveBeenCalled();

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
  destroyImplementation?: () => Promise<void>;
  environment?: ConstructorParameters<typeof RunnerContainer>[1];
  healthResult?: Record<string, unknown>;
  healthResults?: Array<Error | Record<string, unknown>>;
  invocationStatus?: number;
  lifecycleStateResults?: Array<Error | Record<string, unknown>>;
  renewActivityTimeout?: ReturnType<typeof vi.fn>;
  resultOverrides?: Record<string, unknown>;
} = {}) {
  const storage = createContainerStorageDouble();
  const destroy = vi.fn(input.destroyImplementation ?? (async () => {}));
  let healthReadIndex = 0;
  let invocationCompleted = false;
  let lifecycleStateReadIndex = 0;
  const containerFetch = vi.fn(async (url: string) => {
    if (url.endsWith("/health")) {
      const configuredHealthResults = input.healthResults ?? [
        input.healthResult ?? createRunnerHealthResult(),
      ];
      const healthResult = configuredHealthResults[
        Math.min(healthReadIndex, configuredHealthResults.length - 1)
      ];
      healthReadIndex += 1;
      if (healthResult instanceof Error) {
        throw healthResult;
      }
      return new Response(JSON.stringify(healthResult), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    }

    invocationCompleted = true;
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
      await destroy();
      status = "stopped";
    }),
    getState: vi.fn(async () => {
      const configuredLifecycleState = invocationCompleted
        ? input.lifecycleStateResults?.[lifecycleStateReadIndex]
        : undefined;
      if (configuredLifecycleState !== undefined) {
        lifecycleStateReadIndex += 1;
        if (configuredLifecycleState instanceof Error) {
          throw configuredLifecycleState;
        }
        return configuredLifecycleState;
      }
      return {
        lastChange: Date.now(),
        status,
      };
    }),
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

function createDeferred<T>() {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
