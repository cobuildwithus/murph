import { describe, expect, it, vi } from "vitest";

import {
  destroyHostedExecutionContainer,
  invokeHostedExecutionContainerRunner,
  RunnerContainer,
} from "../src/runner-container.ts";

describe("RunnerContainer", () => {
  it("defaults idle retention to five minutes and accepts an env override", () => {
    expect(new RunnerContainer({} as never, {} as never).sleepAfter).toBe("5m");
    expect(
      new RunnerContainer(
        {} as never,
        {
          HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER: "9m",
        } as never,
      ).sleepAfter,
    ).toBe("9m");
  });

  it("starts the container, waits for the port, and forwards the runner request", async () => {
    const resultPayload = createRunnerResult();
    const { container, containerFetch, setOutboundByHosts, startAndWaitForPorts } = createContainerDouble({
      containerFetch: vi.fn(async () => new Response(JSON.stringify(resultPayload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })),
    });

    const response = await container.fetch(new Request("https://runner.internal/internal/invoke", {
      body: JSON.stringify({
        request: createRunnerRequest(),
        runnerEnvironment: {
          CUSTOM_API_KEY: "value",
        },
        timeoutMs: 12_345,
        userId: "member_123",
      }),
      headers: {
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(resultPayload);
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
          CUSTOM_API_KEY: "value",
          HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
          PORT: "8080",
        },
      },
    }));
    expect(setOutboundByHosts).toHaveBeenCalledWith({
      "commit.worker": {
        method: "commitWorker",
        params: {
          userId: "member_123",
        },
      },
      "device-sync.worker": {
        method: "deviceSyncWorker",
        params: {
          userId: "member_123",
        },
      },
      "artifacts.worker": {
        method: "artifactsWorker",
        params: {
          userId: "member_123",
        },
      },
      "outbox.worker": {
        method: "outboxWorker",
        params: {
          userId: "member_123",
        },
      },
      "side-effects.worker": {
        method: "outboxWorker",
        params: {
          userId: "member_123",
        },
      },
      "email.worker": {
        method: "emailWorker",
        params: {
          userId: "member_123",
        },
      },
      "share-pack.worker": {
        method: "sharePackWorker",
        params: {
          userId: "member_123",
        },
      },
    });
    expect(containerFetch).toHaveBeenCalledWith(
      "http://container/__internal/run",
      expect.objectContaining({
        body: JSON.stringify(createRunnerRequest()),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
      8080,
    );
  });

  it("caps readiness waits to the caller timeout budget when the budget is small", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble();

    const response = await container.fetch(new Request("https://runner.internal/internal/invoke", {
      body: JSON.stringify({
        request: createRunnerRequest("evt_short_budget"),
        runnerEnvironment: {},
        timeoutMs: 1_000,
        userId: "member_123",
      }),
      headers: {
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    }));

    expect(response.status).toBe(200);
    expect(startAndWaitForPorts).toHaveBeenCalledWith(expect.objectContaining({
      cancellationOptions: expect.objectContaining({
        instanceGetTimeoutMS: 1_000,
        portReadyTimeoutMS: 1_000,
      }),
    }));
  });

  it("rejects invoke requests when wrapper auth is missing", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    const response = await container.fetch(new Request("https://runner.internal/internal/invoke", {
      body: JSON.stringify({
        request: createRunnerRequest("evt_no_token"),
        runnerEnvironment: {},
        timeoutMs: 30_000,
        userId: "member_123",
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(containerFetch).not.toHaveBeenCalled();
  });

  it("fails invoke requests closed when the wrapper token is not configured", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "",
      },
    });

    const response = await container.fetch(new Request("https://runner.internal/internal/invoke", {
      body: JSON.stringify({
        request: createRunnerRequest("evt_no_wrapper_token"),
        runnerEnvironment: {},
        timeoutMs: 30_000,
        userId: "member_123",
      }),
      headers: {
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted runner control token is not configured.",
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

    const response = await container.fetch(new Request("https://runner.internal/internal/invoke", {
      body: JSON.stringify({
        request: "not-an-object",
        runnerEnvironment: [],
        timeoutMs: 0,
      }),
      headers: {
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "request must be a JSON object.",
    });
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

    const runningResponse = await running.container.fetch(
      new Request("https://runner.internal/internal/destroy", {
        headers: {
          authorization: "Bearer runner-token",
        },
        method: "POST",
      }),
    );
    const stoppedResponse = await stopped.container.fetch(
      new Request("https://runner.internal/internal/destroy", {
        headers: {
          authorization: "Bearer runner-token",
        },
        method: "POST",
      }),
    );

    expect(runningResponse.status).toBe(204);
    expect(stoppedResponse.status).toBe(204);
    expect(running.destroy).toHaveBeenCalledTimes(1);
    expect(stopped.destroy).not.toHaveBeenCalled();
  });

  it("posts the invoke envelope with the member routing key to the named runner container instance", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const getByName = vi.fn(() => ({ fetch }));

    await invokeHostedExecutionContainerRunner({
      request: createRunnerRequest("evt_namespace"),
      runnerContainerNamespace: { getByName },
      runnerControlToken: "runner-token",
      runnerEnvironment: {
        CUSTOM_API_KEY: "value",
      },
      timeoutMs: 45_000,
      userId: "member_123",
    });

    expect(getByName).toHaveBeenCalledWith("member_123");
    const request = fetch.mock.calls[0]?.[0] as Request;
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    expect(body).toEqual({
      request: createRunnerRequest("evt_namespace"),
      runnerEnvironment: {
        CUSTOM_API_KEY: "value",
      },
      timeoutMs: 45_000,
      userId: "member_123",
    });
    expect(request.headers.get("authorization")).toBe("Bearer runner-token");
  });

  it("fails before invoking the namespace when the runner control token is missing", async () => {
    const fetch = vi.fn();
    const getByName = vi.fn(() => ({ fetch }));

    await expect(
      invokeHostedExecutionContainerRunner({
        request: createRunnerRequest("evt_missing_token"),
        runnerContainerNamespace: { getByName },
        runnerControlToken: null,
        runnerEnvironment: {},
        timeoutMs: 45_000,
        userId: "member_123",
      }),
    ).rejects.toThrow(
      "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN must be configured for native hosted execution.",
    );

    expect(getByName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts destroy without a request body and skips null namespaces", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));

    await destroyHostedExecutionContainer({
      runnerContainerNamespace: {
        getByName() {
          return { fetch };
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

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer runner-token");
    await expect(request.text()).resolves.toBe("");
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

function createRunnerRequest(eventId = "evt_123") {
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
