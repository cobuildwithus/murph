import { describe, expect, it, vi } from "vitest";

import {
  destroyHostedExecutionContainer,
  invokeHostedExecutionContainerRunner,
  RunnerContainer,
} from "../src/runner-container.ts";

describe("RunnerContainer", () => {
  it("starts the container, waits for the port, forwards the runner request, and tears the container down after the run", async () => {
    const resultPayload = createRunnerResult();
    const { container, containerFetch, destroy, setOutboundByHosts, startAndWaitForPorts } = createContainerDouble({
      containerFetch: vi.fn(async () => new Response(JSON.stringify(resultPayload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })),
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status: "running",
      })),
    });

    const response = await container.invoke({
      job: {
        request: createRunnerRequest(),
      },
      runnerControlToken: "runner-token",
      timeoutMs: 12_345,
      userId: "member_123",
    });

    expect(response).toEqual(resultPayload);
    expect(startAndWaitForPorts).toHaveBeenCalledWith(expect.objectContaining({
      cancellationOptions: expect.objectContaining({
        instanceGetTimeoutMS: 12_345,
        portReadyTimeoutMS: 12_345,
        waitInterval: 250,
      }),
      ports: 8080,
      startOptions: {
        enableInternet: true,
        envVars: {
          HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
          PORT: "8080",
        },
      },
    }));
    expect(setOutboundByHosts).toHaveBeenCalledWith({
      "commit.worker": {
        method: "commitWorker",
        params: {
          internalWorkerProxyToken: expect.any(String),
          userId: "member_123",
        },
      },
      "device-sync.worker": {
        method: "deviceSyncWorker",
        params: {
          internalWorkerProxyToken: expect.any(String),
          userId: "member_123",
        },
      },
      "artifacts.worker": {
        method: "artifactsWorker",
        params: {
          internalWorkerProxyToken: expect.any(String),
          userId: "member_123",
        },
      },
      "side-effects.worker": {
        method: "sideEffectsWorker",
        params: {
          internalWorkerProxyToken: expect.any(String),
          userId: "member_123",
        },
      },
      "email.worker": {
        method: "emailWorker",
        params: {
          internalWorkerProxyToken: expect.any(String),
          userId: "member_123",
        },
      },
      "usage.worker": {
        method: "usageWorker",
        params: {
          internalWorkerProxyToken: expect.any(String),
          userId: "member_123",
        },
      },
    });
    expect(containerFetch).toHaveBeenCalledWith(
      "http://container/__internal/run",
      expect.objectContaining({
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
      8080,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
    const forwardedBody = JSON.parse(containerFetch.mock.calls[0]?.[1]?.body as string) as {
      request: ReturnType<typeof createRunnerRequest>;
      runtime: {
        internalWorkerProxyToken: string;
      };
    };
    expect(forwardedBody).toMatchObject({
      request: createRunnerRequest(),
      runtime: {
        internalWorkerProxyToken: expect.any(String),
      },
    });
  });

  it("forwards the hosted run context through the container invoke boundary", async () => {
    const { containerFetch, container } = createContainerDouble();
    const run = {
      attempt: 3,
      runId: "run_trace",
      startedAt: "2026-03-27T00:00:00.000Z",
    };

    const response = await container.invoke({
      job: {
        request: createRunnerRequest("evt_with_run", { run }),
      },
      runnerControlToken: "runner-token",
      timeoutMs: 12_345,
      userId: "member_123",
    });

    expect(response).toEqual(createRunnerResult());
    const forwardedBody = JSON.parse(containerFetch.mock.calls[0]?.[1]?.body as string) as {
      request?: {
        run?: typeof run;
      };
    };
    expect(forwardedBody.request?.run).toEqual(run);
  });

  it("caps readiness waits to the caller timeout budget when the budget is small", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble();

    const response = await container.invoke({
      job: {
        request: createRunnerRequest("evt_short_budget"),
      },
      runnerControlToken: "runner-token",
      timeoutMs: 1_000,
      userId: "member_123",
    });

    expect(response).toEqual(createRunnerResult());
    expect(startAndWaitForPorts).toHaveBeenCalledWith(expect.objectContaining({
      cancellationOptions: expect.objectContaining({
        instanceGetTimeoutMS: 1_000,
        portReadyTimeoutMS: 1_000,
      }),
    }));
  });

  it("keeps legacy internal HTTP invoke routes disabled", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    const response = await container.fetch(new Request("https://runner.internal/internal/invoke", {
      body: JSON.stringify({
        job: {
          request: createRunnerRequest("evt_no_token"),
        },
        timeoutMs: 30_000,
        userId: "member_123",
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    }));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(containerFetch).not.toHaveBeenCalled();
  });

  it("uses the per-run runner control token instead of requiring an env-configured wrapper token", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "",
      },
    });

    const response = await container.invoke({
      job: {
        request: createRunnerRequest("evt_per_run_token"),
      },
      runnerControlToken: "runner-token",
      timeoutMs: 30_000,
      userId: "member_123",
    });

    expect(response).toEqual(createRunnerResult());
    expect(startAndWaitForPorts).toHaveBeenCalledOnce();
    expect(containerFetch).toHaveBeenCalledOnce();
  });

  it("returns 405 for unsupported internal methods", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble();

    const invokeResponse = await container.fetch(
      new Request("https://runner.internal/internal/invoke", { method: "GET" }),
    );
    const destroyResponse = await container.fetch(
      new Request("https://runner.internal/internal/destroy", { method: "GET" }),
    );

    expect(invokeResponse.status).toBe(405);
    await expect(invokeResponse.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
    expect(destroyResponse.status).toBe(405);
    await expect(destroyResponse.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed invoke payloads", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble();

    await expect(container.invoke({
      job: "not-an-object" as never,
      runnerControlToken: "runner-token",
      timeoutMs: 0 as never,
      userId: "member_123",
    })).rejects.toThrow("Hosted assistant runtime job input must be an object.");
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("destroys running containers but skips stopped ones", async () => {
    const running = createContainerDouble({
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status: "running",
      })),
    });
    const stopped = createContainerDouble({
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status: "stopped",
      })),
    });

    await running.container.destroyInstance();
    await stopped.container.destroyInstance();

    expect(running.destroy).toHaveBeenCalledTimes(1);
    expect(stopped.destroy).not.toHaveBeenCalled();
  });

  it("posts the invoke envelope with the member routing key to the named runner container instance", async () => {
    const invoke = vi.fn(async () => createRunnerResult());
    const getByName = vi.fn(() => ({
      async destroyInstance() {},
      invoke,
    }));

    await invokeHostedExecutionContainerRunner({
      job: {
        request: createRunnerRequest("evt_namespace"),
      },
      runnerContainerNamespace: { getByName },
      runnerControlToken: "runner-token",
      timeoutMs: 45_000,
      userId: "member_123",
    });

    expect(getByName).toHaveBeenCalledWith("member_123");
    const body = invoke.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      job: {
        request: createRunnerRequest("evt_namespace"),
      },
      timeoutMs: 45_000,
      userId: "member_123",
    });
  });

  it("preserves extended runner request fields when the container is invoked over durable-object RPC", async () => {
    const { container, containerFetch } = createContainerDouble();
    const extendedRequest = {
      ...createRunnerRequest("evt_extended"),
      commit: {
        bundleRefs: {
          agentState: null,
          vault: null,
        },
      },
      resume: {
        committedResult: {
          result: {
            eventsHandled: 1,
            summary: "already committed",
          },
          sideEffects: [],
        },
      },
      run: {
        attempt: 2,
        runId: "run_123",
        startedAt: "2026-03-27T00:00:00.000Z",
      },
    };

    await container.invoke({
      job: {
        request: extendedRequest,
        runtime: {
          userEnv: {
            OPENAI_API_KEY: "sk-user",
          },
        },
      },
      runnerControlToken: "runner-token",
      timeoutMs: 30_000,
      userId: "member_123",
    });

    expect(containerFetch).toHaveBeenCalledTimes(1);
    const forwarded = JSON.parse(containerFetch.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      request: {
        commit: {
          bundleRefs: {
            agentState: null,
            vault: null,
          },
        },
        resume: {
          committedResult: {
            result: {
              eventsHandled: 1,
              summary: "already committed",
            },
            sideEffects: [],
          },
        },
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-03-27T00:00:00.000Z",
        },
      },
      runtime: {
        internalWorkerProxyToken: expect.any(String),
        userEnv: {
          OPENAI_API_KEY: "sk-user",
        },
      },
    });
  });

  it("fails before invoking the namespace when the runner control token is missing", async () => {
    const invoke = vi.fn();
    const getByName = vi.fn(() => ({
      async destroyInstance() {},
      invoke,
    }));

    await expect(
      invokeHostedExecutionContainerRunner({
        job: {
          request: createRunnerRequest("evt_missing_token"),
        },
        runnerContainerNamespace: { getByName },
        runnerControlToken: null,
        timeoutMs: 45_000,
        userId: "member_123",
      }),
    ).rejects.toThrow(
      "Hosted execution native runner control token is required.",
    );

    expect(getByName).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("destroys the named runner container instance and skips null namespaces", async () => {
    const destroyInstance = vi.fn(async () => {});

    await destroyHostedExecutionContainer({
      runnerContainerNamespace: {
        getByName() {
          return {
            destroyInstance,
            invoke: vi.fn(async () => createRunnerResult()),
          };
        },
      },
      runnerControlToken: "runner-token",
      userId: "member_123",
    });
    await destroyHostedExecutionContainer({
      runnerContainerNamespace: null,
      runnerControlToken: "runner-token",
      userId: "member_456",
    });

    expect(destroyInstance).toHaveBeenCalledTimes(1);
  });
});

function createContainerDouble(input: {
  containerFetch?: ReturnType<typeof vi.fn>;
  destroy?: ReturnType<typeof vi.fn>;
  env?: Record<string, unknown>;
  getState?: ReturnType<typeof vi.fn>;
  setOutboundByHosts?: ReturnType<typeof vi.fn>;
  startAndWaitForPorts?: ReturnType<typeof vi.fn>;
} = {}) {
  const container = new RunnerContainer({} as never, {
    HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
    ...(input.env ?? {}),
  } as never);
  const containerFetch = input.containerFetch ?? vi.fn(async () => new Response(JSON.stringify(
    createRunnerResult(),
  ), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  }));
  const destroy = input.destroy ?? vi.fn(async () => {});
  const getState = input.getState ?? vi.fn(async () => ({
    lastChange: Date.now(),
    status: "stopped",
  }));
  const setOutboundByHosts = input.setOutboundByHosts ?? vi.fn(async () => {});
  const startAndWaitForPorts = input.startAndWaitForPorts ?? vi.fn(async () => {});

  Object.assign(container, {
    containerFetch,
    destroy,
    getState,
    setOutboundByHosts,
    startAndWaitForPorts,
  });

  return {
    container,
    containerFetch,
    destroy,
    getState,
    setOutboundByHosts,
    startAndWaitForPorts,
  };
}

function createRunnerRequest(
  eventId = "evt_123",
  input: {
    run?: {
      attempt: number;
      runId: string;
      startedAt: string;
    };
  } = {},
) {
  return {
    bundles: {
      agentState: null,
      vault: null,
    },
    dispatch: {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId,
      occurredAt: "2026-03-27T00:00:00.000Z",
    },
    ...(input.run ? { run: input.run } : {}),
  };
}

function createRunnerResult() {
  return {
    bundles: {
      agentState: null,
      vault: null,
    },
    result: {
      eventsHandled: 1,
      summary: "ok",
    },
  };
}
