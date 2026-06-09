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

  it("activity expiry destroys the warm shell without dispatching a checkpoint job", async () => {
    const storage = createContainerStorageDouble();
    const destroy = vi.fn(async () => {});
    const containerFetch = vi.fn(async (url: string) => {
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
    const container = new RunnerContainer({
      storage,
    } as never, {} as never);
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
