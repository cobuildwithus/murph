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
  it("preserves a completed shell after an interaction races its durable completion notification", async () => {
    const containerDouble = createActivityExpiryContainerDouble();
    const { container } = containerDouble;

    const result = await container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });

    expect(result).toMatchObject({ status: "idle" });
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
    await container.onRuntimeCompletionRecorded({
      attemptId: "attempt_member_123",
      leaseGeneration: "11",
      userId: "member_123",
    });
    expect(containerDouble.destroy).not.toHaveBeenCalled();
  });

  it("stops a terminal shell only after durable completion notification and does not double-destroy", async () => {
    const { container, destroy } = createActivityExpiryContainerDouble({
      destroyImplementation: async () => {},
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({ status: "idle" });
    expect(destroy).not.toHaveBeenCalled();

    await container.onRuntimeCompletionRecorded({
      attemptId: "attempt_member_123",
      leaseGeneration: "11",
      userId: "member_123",
    });

    expect(destroy).toHaveBeenCalledOnce();

    await expect(container.onActivityExpired()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("stops a terminal shell when durable completion wins the outer response race", async () => {
    const invocationResponse = createDeferred<Response>();
    const { container, containerFetch, destroy } = createActivityExpiryContainerDouble({
      invocationResponse: invocationResponse.promise,
    });
    const invocation = container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });
    await vi.waitFor(() => {
      expect(containerFetch).toHaveBeenCalled();
    });

    const completionNotification = container.onRuntimeCompletionRecorded({
      attemptId: "attempt_member_123",
      leaseGeneration: "11",
      userId: "member_123",
    });
    invocationResponse.resolve(new Response(
      JSON.stringify(createRunnerResult()),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      },
    ));

    await expect(invocation).resolves.toMatchObject({ status: "idle" });
    await expect(completionNotification).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "completion notification arrives before foreground readiness",
      order: ["completion", "readiness"] as const,
    },
    {
      name: "foreground readiness arrives before the completion notification",
      order: ["readiness", "completion"] as const,
    },
  ])("preserves a shell when $name", async ({ order }) => {
    const invocationResponse = createDeferred<Response>();
    const { container, containerFetch, destroy } = createActivityExpiryContainerDouble({
      invocationResponse: invocationResponse.promise,
    });
    const invocation = container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    });
    await vi.waitFor(() => {
      expect(containerFetch).toHaveBeenCalled();
    });

    const operations = order.map((operation) =>
      operation === "completion"
        ? container.onRuntimeCompletionRecorded({
            attemptId: "attempt_member_123",
            leaseGeneration: "11",
            userId: "member_123",
          })
        : container.ensureReadyForProcessing({
            timeoutMs: 5_000,
            userId: "member_123",
          })
    );
    invocationResponse.resolve(new Response(
      JSON.stringify(createRunnerResult()),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      },
    ));

    await expect(invocation).resolves.toMatchObject({ status: "idle" });
    await expect(Promise.all(operations)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "ready" }),
      ]),
    );
    expect(destroy).not.toHaveBeenCalled();
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
    const { container, destroy } = createActivityExpiryContainerDouble({
      environment: {
        HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
      },
      resultOverrides,
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({ status: "idle" });

    await container.onRuntimeCompletionRecorded({
      attemptId: "attempt_member_123",
      leaseGeneration: "11",
      userId: "member_123",
    });
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
    const { container, destroy } = createActivityExpiryContainerDouble({
      healthResult,
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({ status: "idle" });

    await container.onRuntimeCompletionRecorded({
      attemptId: "attempt_member_123",
      leaseGeneration: "11",
      userId: "member_123",
    });
    expect(destroy).not.toHaveBeenCalled();
  });

  it("retries terminal cleanup on the lifecycle timer after container status is uncertain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const startedAtMs = Date.parse("2026-08-19T23:00:00.000Z");
      vi.setSystemTime(startedAtMs);
      const { container, destroy } = createActivityExpiryContainerDouble({
        environment: {
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
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
      await container.onRuntimeCompletionRecorded({
        attemptId: "attempt_member_123",
        leaseGeneration: "11",
        userId: "member_123",
      });
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
      const { container, destroy } = createActivityExpiryContainerDouble({
        environment: {
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
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
      await container.onRuntimeCompletionRecorded({
        attemptId: "attempt_member_123",
        leaseGeneration: "11",
        userId: "member_123",
      });
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
      const { container, destroy } = createActivityExpiryContainerDouble({
        destroyImplementation: async () => {
          destroyAttempt += 1;
          if (destroyAttempt === 1) {
            throw new Error("destroy unavailable");
          }
        },
        environment: {
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
        },
        renewActivityTimeout: vi.fn(),
      });

      await expect(container.invoke({
        job: createWorkspaceRunnerJob("member_123"),
        timeoutMs: 5_000,
        userId: "member_123",
      })).resolves.toMatchObject({ status: "idle" });
      await container.onRuntimeCompletionRecorded({
        attemptId: "attempt_member_123",
        leaseGeneration: "11",
        userId: "member_123",
      });
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

  it("does not clean up a terminal shell after a stale completion notification", async () => {
    const { container, destroy } = createActivityExpiryContainerDouble();

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_123"),
      timeoutMs: 5_000,
      userId: "member_123",
    })).resolves.toMatchObject({ status: "idle" });

    await container.onRuntimeCompletionRecorded({
      attemptId: "attempt_member_123",
      leaseGeneration: "999",
      userId: "member_123",
    });
    expect(destroy).not.toHaveBeenCalled();
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
  invocationResponse?: Promise<Response>;
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
    if (input.invocationResponse) {
      return await input.invocationResponse;
    }
    return new Response(JSON.stringify(createRunnerResult(input.resultOverrides)), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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
