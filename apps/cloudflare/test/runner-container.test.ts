import { describe, expect, it, vi } from "vitest";

import {
  destroyHostedExecutionContainer,
  invokeHostedExecutionContainerRunner,
  RunnerContainer,
} from "../src/runner-container.ts";

describe("RunnerContainer", () => {
  it("reuses a warm per-user shell across back-to-back invocations", async () => {
    const setAlarm = vi.fn(async () => {});
    const deleteAlarm = vi.fn(async () => {});
    const { container, containerFetch, destroy, setOutboundByHosts, startAndWaitForPorts } =
      createContainerDouble({
        state: {
          storage: {
            deleteAlarm,
            setAlarm,
          },
        },
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            return new Response(JSON.stringify({ ok: true }), {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            });
          }

          return new Response(JSON.stringify(createRunnerResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }),
      });

    const firstResponse = await container.invoke({
      job: {
        request: createRunnerRequest(),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    const secondResponse = await container.invoke({
      job: {
        request: createRunnerRequest("evt_second"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    expect(firstResponse).toEqual(createRunnerResult());
    expect(secondResponse).toEqual(createRunnerResult());
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    expect(setAlarm).toHaveBeenCalledTimes(2);
    expect(deleteAlarm.mock.calls.length).toBeGreaterThanOrEqual(2);

    const coldStartToken =
      startAndWaitForPorts.mock.calls[0]?.[0]?.startOptions?.envVars?.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN;
    expect(typeof coldStartToken).toBe("string");
    expect(coldStartToken).toBeTruthy();

    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/__internal/run")
    );
    expect(executeCalls).toHaveLength(2);
    expect(executeCalls[0]?.[1]).toMatchObject({
      headers: {
        authorization: `Bearer ${coldStartToken}`,
      },
    });
    expect(executeCalls[1]?.[1]).toMatchObject({
      headers: {
        authorization: `Bearer ${coldStartToken}`,
      },
    });

    const outboundTokens = setOutboundByHosts.mock.calls.map(([mapping]) =>
      readRunnerProxyToken(mapping as Record<string, unknown>)
    );
    expect(outboundTokens).toHaveLength(4);
    expect(outboundTokens[0]).not.toBe(outboundTokens[1]);
    expect(outboundTokens[1]).not.toBe(outboundTokens[2]);
    expect(outboundTokens[2]).not.toBe(outboundTokens[3]);
  });

  it("destroys the warm shell on idle alarm and cold-starts the next run", async () => {
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      state: {
        storage: {
          async deleteAlarm() {},
          async setAlarm() {},
        },
      },
    });

    await container.invoke({
      job: {
        request: createRunnerRequest(),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    const firstToken =
      startAndWaitForPorts.mock.calls[0]?.[0]?.startOptions?.envVars?.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN;

    await container.alarm();
    expect(destroy).toHaveBeenCalledTimes(1);

    await container.invoke({
      job: {
        request: createRunnerRequest("evt_after_alarm"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    const secondToken =
      startAndWaitForPorts.mock.calls[1]?.[0]?.startOptions?.envVars?.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN;

    expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
    expect(firstToken).not.toBe(secondToken);
  });

  it("destroys an already-running shell with ambiguous supervisor state before reusing it", async () => {
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
      state: {
        storage: {
          async deleteAlarm() {},
          async setAlarm() {},
        },
      },
    });

    await container.invoke({
      job: {
        request: createRunnerRequest("evt_restart_ambiguous_shell"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy.mock.invocationCallOrder[0]).toBeLessThan(
      startAndWaitForPorts.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("uses the remaining caller timeout budget when a warm-shell health check fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));

    try {
      let healthFailures = 0;
      const { container, startAndWaitForPorts } = createContainerDouble({
        state: {
          storage: {
            async deleteAlarm() {},
            async setAlarm() {},
          },
        },
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            healthFailures += 1;
            vi.setSystemTime(new Date("2026-04-08T00:00:02.500Z"));
            return new Response(JSON.stringify({ error: "stale shell" }), {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 503,
            });
          }

          return new Response(JSON.stringify(createRunnerResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }),
      });

      await container.invoke({
        job: {
          request: createRunnerRequest("evt_initial_warm"),
        },
        timeoutMs: 5_000,
        userId: "member_123",
      });

      await container.invoke({
        job: {
          request: createRunnerRequest("evt_restart_after_failed_health"),
        },
        timeoutMs: 5_000,
        userId: "member_123",
      });

      expect(healthFailures).toBe(1);
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
      expect(startAndWaitForPorts.mock.calls[1]?.[0]).toMatchObject({
        cancellationOptions: expect.objectContaining({
          instanceGetTimeoutMS: 2_500,
          portReadyTimeoutMS: 2_500,
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps readiness waits to the caller timeout budget when the budget is small", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble({
      state: {
        storage: {
          async deleteAlarm() {},
          async setAlarm() {},
        },
      },
    });

    const response = await container.invoke({
      job: {
        request: createRunnerRequest("evt_short_budget"),
      },
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
      timeoutMs: 0 as never,
      userId: "member_123",
    })).rejects.toThrow("Hosted assistant runtime job input must be an object.");
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("destroys running containers but skips stopped ones", async () => {
    const running = createContainerDouble({
      initialStatus: "running",
    });
    const stopped = createContainerDouble({
      initialStatus: "stopped",
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
    const { container, containerFetch } = createContainerDouble({
      state: {
        storage: {
          async deleteAlarm() {},
          async setAlarm() {},
        },
      },
    });
    const extendedRequest = {
      ...createRunnerRequest("evt_extended"),
      commit: {
        bundleRef: null,
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
      timeoutMs: 30_000,
      userId: "member_123",
    });

    const executeCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/__internal/run")
    );
    expect(executeCall).toBeTruthy();
    const forwarded = JSON.parse(executeCall?.[1]?.body as string) as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      internalWorkerProxyToken: expect.any(String),
      job: {
        request: {
          commit: {
            bundleRef: null,
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
          userEnv: {
            OPENAI_API_KEY: "sk-user",
          },
        },
      },
    });
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
      userId: "member_123",
    });
    await destroyHostedExecutionContainer({
      runnerContainerNamespace: null,
      userId: "member_456",
    });

    expect(destroyInstance).toHaveBeenCalledTimes(1);
  });
});

function createContainerDouble(input: {
  containerFetch?: ReturnType<typeof vi.fn>;
  destroy?: ReturnType<typeof vi.fn>;
  env?: Record<string, unknown>;
  initialStatus?: "running" | "stopped" | "stopped_with_code";
  setOutboundByHosts?: ReturnType<typeof vi.fn>;
  startAndWaitForPorts?: ReturnType<typeof vi.fn>;
  state?: Record<string, unknown>;
} = {}) {
  let currentStatus = input.initialStatus ?? "stopped";
  const container = new RunnerContainer(input.state ?? {} as never, {
    ...(input.env ?? {}),
  } as never);
  const containerFetch = input.containerFetch ?? vi.fn(async (url: string) => {
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    }

    return new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    });
  });
  const destroy = input.destroy ?? vi.fn(async () => {
    currentStatus = "stopped";
  });
  const getState = vi.fn(async () => ({
    lastChange: Date.now(),
    status: currentStatus,
  }));
  const setOutboundByHosts = input.setOutboundByHosts ?? vi.fn(async () => {});
  const startAndWaitForPorts = input.startAndWaitForPorts ?? vi.fn(async () => {
    currentStatus = "running";
  });

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

function readRunnerProxyToken(mapping: Record<string, unknown>): string | null {
  const firstEntry = Object.values(mapping)[0] as {
    params?: {
      internalWorkerProxyToken?: string;
    };
  } | undefined;
  return firstEntry?.params?.internalWorkerProxyToken ?? null;
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
    bundle: null,
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
    bundle: null,
    result: {
      eventsHandled: 1,
      summary: "ok",
    },
  };
}
