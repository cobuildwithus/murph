import type { HostedWorkspaceInvocationResult } from "@murphai/hosted-execution/runtime-control";
import { buildHostedExecutionStructuredLogRecord } from "@murphai/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  destroyHostedExecutionContainer,
  HostedExecutionConfigurationError,
  DeploySmokeRunnerContainer,
  type HostedExecutionContainerStubLike,
  invokeHostedExecutionContainerRunner,
  resolveHostedExecutionRunnerContainerName,
  RunnerContainer,
} from "../src/runner-container.ts";
import {
  handleHostedRunnerOpenInternetOutbound,
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "../src/runner-egress-intercept.ts";

const RUNNER_CALLBACK_BASE_URL = "https://runner-callback.example.test/";
const CLOUDFLARE_CONTAINERS_CA_CERT_PATH =
  "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const EXPECTED_RUNNER_CONTAINER_ENV = {
  CODEX_CA_CERTIFICATE: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
  CURL_CA_BUNDLE: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
  NODE_EXTRA_CA_CERTS: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
  PORT: "8080",
  REQUESTS_CA_BUNDLE: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
  SSL_CERT_FILE: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

describe("RunnerContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers outbound interception through Cloudflare Containers accessors", () => {
    expect(RunnerContainer.outbound).toBe(handleHostedRunnerOpenInternetOutbound);
    expect(RunnerContainer.outboundByHost).toBe(HOSTED_RUNNER_OUTBOUND_BY_HOST);
    expect(DeploySmokeRunnerContainer.outbound).toBe(handleHostedRunnerOpenInternetOutbound);
    expect(DeploySmokeRunnerContainer.outboundByHost).toBe(HOSTED_RUNNER_OUTBOUND_BY_HOST);
  });

  it("reuses a successful per-user shell for back-to-back invocations", async () => {
    const { container, containerFetch, destroy, startAndWaitForPorts } =
      createContainerDouble({
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
        kind: "workspace-invocation",
        request: createRunnerRequest(),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    const secondResponse = await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_second"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    expect(firstResponse).toEqual(createRunnerResult());
    expect(secondResponse).toEqual(createRunnerResult());
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();

    expect(container.envVars).toEqual(EXPECTED_RUNNER_CONTAINER_ENV);

    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls).toHaveLength(2);
    expect(String(executeCalls[0]?.[0])).toBe("http://container/internal/workspace-invocation");

    const firstBody = JSON.parse(executeCalls[0]?.[1]?.body as string);
    const secondBody = JSON.parse(executeCalls[1]?.[1]?.body as string);
    expect(Object.keys(firstBody).sort()).toEqual(["job"]);
    expect(Object.keys(secondBody).sort()).toEqual(["job"]);
  });

  it("posts a payloadless runtime wake to the active workspace invocation", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "1",
            },
            status: 204,
          });
        }

        runnerRequestStarted.resolve();
        return await runnerResponse.promise;
      }),
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest(),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    await runnerRequestStarted.promise;

    await expect(container.wakeRuntime({ userId: "member_123" })).resolves.toEqual({
      accepted: true,
    });

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    await expect(invocation).resolves.toEqual(createRunnerResult());
    const wakeCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    );
    expect(wakeCall?.[1]).toMatchObject({
      method: "POST",
    });
    expect(wakeCall?.[1]?.body).toBeUndefined();
  });

  it("starts a managed shell for deploy smoke health and stops it afterward", async () => {
    const { container, containerFetch, destroy, startAndWaitForPorts } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        expect(url).toBe("http://container/health");
        return new Response(JSON.stringify({
          ok: true,
          runnerBundle: {
            buildSkipped: false,
            bundleFingerprint: "bundle-fingerprint",
            generatedAt: "2026-04-24T00:00:00.000Z",
            schemaVersion: 2,
            sourceFingerprint: "source-fingerprint",
          },
          service: "cloudflare-hosted-runner-node",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }),
    });

    const result = await container.smokeHealth();

    expect(result).toEqual({
      ok: true,
      runnerBundle: {
        buildSkipped: false,
        bundleFingerprint: "bundle-fingerprint",
        generatedAt: "2026-04-24T00:00:00.000Z",
        schemaVersion: 2,
        sourceFingerprint: "source-fingerprint",
      },
      service: "cloudflare-hosted-runner-node",
      status: 200,
    });
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(containerFetch).toHaveBeenCalledTimes(1);
    expect(container.envVars).toEqual(EXPECTED_RUNNER_CONTAINER_ENV);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("can extend deploy smoke to run a Codex OpenAI intercept probe", async () => {
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            ok: true,
            service: "cloudflare-hosted-runner-node",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        expect(url).toBe("http://container/internal/deploy-openai-intercept-smoke");
        return new Response(JSON.stringify({
          ok: true,
          openAiIntercept: {
            client: "codex",
            model: "gpt-5.4-mini",
            stderrBytes: 0,
            stdoutBytes: 256,
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }),
    });

    const result = await container.smokeHealth({
      openAiIntercept: true,
      openAiInterceptAuthority: {
        attemptId: "attempt_smoke",
        leaseGeneration: "17",
        userId: "member_smoke",
        workspaceVersion: "42",
      },
    });

    expect(result.openAiIntercept).toEqual({
      client: "codex",
      model: "gpt-5.4-mini",
      stderrBytes: 0,
      stdoutBytes: 256,
    });
    expect(containerFetch).toHaveBeenCalledTimes(2);
    const smokeCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/deploy-openai-intercept-smoke")
    );
    expect(smokeCall).toBeTruthy();
    const headers = new Headers(smokeCall?.[1]?.headers);
    expect(headers.get("x-hosted-runner-bound-user-id")).toBe("member_smoke");
    expect(headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_smoke");
    expect(headers.get("x-hosted-runtime-lease-generation")).toBe("17");
    expect(headers.get("x-hosted-runtime-workspace-version")).toBe("42");
  });

  it("recycles any warm deploy smoke shell before checking container health", async () => {
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
    });

    await container.smokeHealth();

    expect(destroy).toHaveBeenCalledTimes(2);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("starts the container without operator-only control-plane secrets in supervisor env", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble({
      env: {
        HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "public-pem",
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: '{"kty":"EC"}',
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-loopback-token",
        HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL: "http://host.docker.internal:8787",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://host.docker.internal:4010/.well-known/jwks",
        HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
        HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "cobuildwithus",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "web:v3",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: '{"kty":"EC","d":"secret"}',
      },
    });

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_local_proxy_upstream"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(container.envVars).toEqual(EXPECTED_RUNNER_CONTAINER_ENV);
    expect(container.envVars).not.toHaveProperty("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK");
    expect(container.envVars).not.toHaveProperty("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK");
  });

  it("uses callback transport for container runtime requests", async () => {
    const { container, containerFetch } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "127.0.0.1",
      },
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_local_bridge_forwarding"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    const executeCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCall).toBeTruthy();
    if (!executeCall?.[1]?.body || typeof executeCall[1].body !== "string") {
      throw new Error("Expected the container double to forward a JSON request body.");
    }

    expect(JSON.parse(executeCall[1].body)).toMatchObject({
    });
  });

  it("sends only the callback runtime request payload to the child runner", async () => {
    let observedTopLevelKeys: string[] = [];
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (!init?.body || typeof init.body !== "string") {
          throw new Error("Expected JSON runner request body.");
        }
        const body = JSON.parse(init.body) as Record<string, unknown>;
        observedTopLevelKeys = Object.keys(body).sort();
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }),
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_active_proxy_token"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(observedTopLevelKeys).toEqual(["job"]);
  });

  it("uses activity expiry as fallback cleanup after warm reuse and cold-starts the next run", async () => {
    const { container, containerFetch, destroy, startAndWaitForPorts } =
      createContainerDouble();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-06T00:00:00.000Z"));
      await container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest(),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });
      expect(destroy).not.toHaveBeenCalled();
      vi.setSystemTime(new Date("2026-05-06T00:07:01.000Z"));
      await container.onActivityExpired();
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          message: "Hosted execution container activity expired; running cleanup.",
          phase: "container.ready",
        }),
      );

      await container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_after_alarm"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
      expect(destroy).toHaveBeenCalledTimes(1);
      const executeCalls = containerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/internal/workspace-invocation")
      );
      expect(executeCalls[0]?.[1]?.headers).toEqual({
        "content-type": "application/json; charset=utf-8",
      });
      expect(executeCalls[1]?.[1]?.headers).toEqual({
        "content-type": "application/json; charset=utf-8",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not renew or keep the warm shell when activity expiry fires after work completed", async () => {
    const renewActivityTimeout = vi.fn();
    const { container, containerFetch, destroy, startAndWaitForPorts } = createContainerDouble();
    Object.assign(container, {
      renewActivityTimeout,
    });

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_stale_activity_first"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    renewActivityTimeout.mockClear();

    await container.onActivityExpired();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(renewActivityTimeout).not.toHaveBeenCalled();

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_stale_activity_second"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls[0]?.[1]?.headers).toEqual({
      "content-type": "application/json; charset=utf-8",
    });
    expect(executeCalls[1]?.[1]?.headers).toEqual({
      "content-type": "application/json; charset=utf-8",
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        message: "Hosted execution container activity expired; running cleanup.",
        phase: "container.ready",
      }),
    );
  });

  it("renews the activity timeout during long runner invocations", async () => {
    vi.useFakeTimers();

    try {
      const renewActivityTimeout = vi.fn();
      let resolveInvocation!: () => void;
      let markRunnerRequestStarted!: () => void;
      const invocationReady = new Promise<void>((resolve) => {
        resolveInvocation = resolve;
      });
      const runnerRequestStarted = new Promise<void>((resolve) => {
        markRunnerRequestStarted = resolve;
      });
      const { container } = createContainerDouble({
        env: {
          HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1000",
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

          markRunnerRequestStarted();
          await invocationReady;
          return new Response(JSON.stringify(createRunnerResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }),
      });
      Object.assign(container, {
        renewActivityTimeout,
      });

      const invokePromise = container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_activity_renew"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });
      await runnerRequestStarted;
      await vi.advanceTimersByTimeAsync(1_250);
      resolveInvocation();

      await expect(invokePromise).resolves.toEqual(createRunnerResult());
      expect(renewActivityTimeout.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs container lifecycle stops without aborting active workspace invocations", async () => {
    let markRunnerRequestStarted!: () => void;
    const runnerRequestStarted = new Promise<void>((resolve) => {
      markRunnerRequestStarted = resolve;
    });
    let finishRunnerResponse!: (response: Response) => void;
    const runnerResponse = new Promise<Response>((resolve) => {
      finishRunnerResponse = resolve;
    });
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      markRunnerRequestStarted();
      return await runnerResponse;
    });
    const { container, destroy } = createContainerDouble({
      containerFetch,
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_container_stop_during_work"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    await runnerRequestStarted;

    container.onStop({ exitCode: 0, reason: "exit" });

    expect(destroy).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          activeWorkspaceInvocationPresent: true,
          lifecycleStage: "onStop",
        }),
        level: "info",
        message: "Hosted execution container lifecycle hook reported stop.",
        phase: "container.ready",
      }),
    );
    finishRunnerResponse(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("logs container lifecycle errors without aborting active workspace invocations", async () => {
    let markRunnerRequestStarted!: () => void;
    const runnerRequestStarted = new Promise<void>((resolve) => {
      markRunnerRequestStarted = resolve;
    });
    let finishRunnerResponse!: (response: Response) => void;
    const runnerResponse = new Promise<Response>((resolve) => {
      finishRunnerResponse = resolve;
    });
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      markRunnerRequestStarted();
      return await runnerResponse;
    });
    const { container, destroy } = createContainerDouble({
      containerFetch,
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_container_error_during_work"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    await runnerRequestStarted;

    expect(() => container.onError(new Error("runtime signalled the container to exit"))).toThrow(
      "runtime signalled the container to exit",
    );

    expect(destroy).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          activeWorkspaceInvocationPresent: true,
          lifecycleStage: "onError",
        }),
        message: "Hosted execution container lifecycle hook reported an error.",
        phase: "failed",
      }),
    );
    finishRunnerResponse(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("fails active workspace invocations when lifecycle status becomes stopped", async () => {
    let currentStatus: "running" | "stopped" | "stopped_with_code" = "stopped";
    let markRunnerRequestStarted!: () => void;
    const runnerRequestStarted = new Promise<void>((resolve) => {
      markRunnerRequestStarted = resolve;
    });
    const hangingRunnerResponse = new Promise<Response>(() => undefined);
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      markRunnerRequestStarted();
      return await hangingRunnerResponse;
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status: currentStatus,
    }));
    const startAndWaitForPorts = vi.fn(async () => {
      currentStatus = "running";
    });
    const { container, destroy } = createContainerDouble({
      containerFetch,
      getState,
      startAndWaitForPorts,
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_container_status_stop_during_work"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    await runnerRequestStarted;
    currentStatus = "stopped_with_code";

    await expect(invocation).rejects.toThrow("workspace invocation container stopped");
    expect(destroy).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          lifecycleStage: "active-request-status-watch",
          statusAfterStop: "stopped_with_code",
        }),
        level: "warn",
        message: "Hosted execution container stopped before workspace request settled.",
        phase: "failed",
      }),
    );
  });

  it("fails active workspace invocations when lifecycle status reports a missing shell", async () => {
    let currentStatus: "running" | "stopped" = "stopped";
    let statusMissing = false;
    let markRunnerRequestStarted!: () => void;
    const runnerRequestStarted = new Promise<void>((resolve) => {
      markRunnerRequestStarted = resolve;
    });
    const hangingRunnerResponse = new Promise<Response>(() => undefined);
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      markRunnerRequestStarted();
      return await hangingRunnerResponse;
    });
    const getState = vi.fn(async () => {
      if (statusMissing) {
        throw new Error("No such container");
      }
      return {
        lastChange: Date.now(),
        status: currentStatus,
      };
    });
    const startAndWaitForPorts = vi.fn(async () => {
      currentStatus = "running";
    });
    const { container, destroy } = createContainerDouble({
      containerFetch,
      getState,
      startAndWaitForPorts,
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_container_missing_during_work"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    await runnerRequestStarted;
    statusMissing = true;

    await expect(invocation).rejects.toThrow("workspace invocation container stopped");
    expect(destroy).not.toHaveBeenCalled();
  });

  it("keeps activity-expiry cleanup best-effort when destroy fails", async () => {
    const destroy = vi.fn(async () => {
      throw new Error("destroy failed");
    });
    const { container, startAndWaitForPorts } = createContainerDouble({
      destroy,
    });

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest(),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 421_000));
      const cleanupPromise = container.onActivityExpired();
      await vi.advanceTimersByTimeAsync(5_500);
      await expect(cleanupPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    expect(destroy).toHaveBeenCalled();
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          destroyLatencyMs: expect.any(Number),
          failClosed: false,
          lifecycleStage: "destroy",
          statusBeforeDestroy: "running",
        }),
        level: "warn",
        message: "Hosted execution container destroy request failed.",
        phase: "failed",
      }),
    );
  });

  it("reuses an already-running shell after plain health succeeds", async () => {
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_reuse_running_shell"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(destroy).not.toHaveBeenCalled();
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("reuses a surviving warm shell after plain health succeeds", async () => {
    const rehydratedContainerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      expect(url).toBe("http://container/internal/workspace-invocation");
      return new Response(JSON.stringify(createRunnerResult()), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const rehydrated = createContainerDouble({
      containerFetch: rehydratedContainerFetch,
      initialStatus: "running",
    });

    await expect(rehydrated.container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_reuse_surviving_warm_shell"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(rehydrated.destroy).not.toHaveBeenCalled();
    expect(rehydrated.startAndWaitForPorts).not.toHaveBeenCalled();
    expect(rehydratedContainerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    )).toBe(true);
  });

  it("aborts explicit destroy while a workspace invocation is cold-starting", async () => {
    const startAbortSignal = createDeferred<AbortSignal>();
    const startAborted = createDeferred<void>();
    let status: "running" | "stopped" = "stopped";
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const startAndWaitForPorts = vi.fn(async (options?: {
      cancellationOptions?: {
        abort?: unknown;
      };
    }) => {
      status = "running";
      const signal = options?.cancellationOptions?.abort;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Expected cold start to receive an abort signal.");
      }
      startAbortSignal.resolve(signal);
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          startAborted.resolve();
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error("workspace invocation cold start aborted"));
        }, { once: true });
      });
    });
    const { container } = createContainerDouble({
      destroy,
      getState,
      startAndWaitForPorts,
    });

    const invokeResultPromise = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_destroy_during_cold_start"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    const signal = await startAbortSignal.promise;
    expect(signal.aborted).toBe(false);

    const destroyPromise = container.destroyInstance();
    await startAborted.promise;

    await expect(invokeResultPromise).resolves.toMatchObject({
      message: "workspace invocation container destroyed",
    });
    await expect(destroyPromise).resolves.toBeUndefined();
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a cold shell when post-start health fails", async () => {
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ error: "not ready" }), {
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
    });
    const { container, destroy } = createContainerDouble({
      containerFetch,
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_cold_health_failure"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Hosted runner container health check returned HTTP 503.");

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    )).toBe(false);
  });

  it("aborts a preempted workspace invocation while cold-starting", async () => {
    const startAbortSignal = createDeferred<AbortSignal>();
    let status: "running" | "stopped" = "stopped";
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const startAndWaitForPorts = vi.fn(async (options?: {
      cancellationOptions?: {
        abort?: unknown;
      };
    }) => {
      status = "running";
      const signal = options?.cancellationOptions?.abort;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Expected cold start to receive an abort signal.");
      }
      startAbortSignal.resolve(signal);
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error("workspace invocation cold start aborted"));
        }, { once: true });
      });
    });
    const { container } = createContainerDouble({
      destroy,
      getState,
      startAndWaitForPorts,
    });
    const request = createRunnerRequest("evt_preempt_during_cold_start");

    const invokeResultPromise = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    const signal = await startAbortSignal.promise;
    expect(signal.aborted).toBe(false);
    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      userId: "member_123",
    })).resolves.toBeUndefined();

    await expect(invokeResultPromise).resolves.toMatchObject({
      message: "workspace invocation preempted",
    });
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("uses the remaining caller timeout budget when a warm-shell health check fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));

    try {
      let healthChecks = 0;
      const { container, startAndWaitForPorts } = createContainerDouble({
        initialStatus: "running",
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            healthChecks += 1;
            if (healthChecks === 1) {
              vi.setSystemTime(new Date("2026-04-08T00:00:02.500Z"));
            }
            return new Response(JSON.stringify(healthChecks === 1 ? { error: "stale shell" } : { ok: true }), {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: healthChecks === 1 ? 503 : 200,
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
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_restart_after_failed_health"),
        },
        timeoutMs: 5_000,
        userId: "member_123",
      });

      expect(healthChecks).toBe(2);
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
      expect(startAndWaitForPorts.mock.calls[0]?.[0]).toMatchObject({
        cancellationOptions: expect.objectContaining({
          instanceGetTimeoutMS: 2_500,
          portReadyTimeoutMS: 2_500,
        }),
      });
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          level: "warn",
          message: "Hosted execution container warm health check failed; restarting shell.",
          phase: "container.starting",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps readiness waits to the caller timeout budget when the budget is small", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble();

    const response = await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_short_budget"),
      },
      timeoutMs: 1_000,
      userId: "member_123",
    });

    expect(response).toEqual(createRunnerResult());
    const startOptions = startAndWaitForPorts.mock.calls[0]?.[0];
    expect(startOptions).toMatchObject({
      cancellationOptions: expect.objectContaining({
        abort: expect.any(AbortSignal),
        waitInterval: 250,
      }),
    });
    expect(startOptions?.cancellationOptions.instanceGetTimeoutMS).toBeLessThanOrEqual(1_000);
    expect(startOptions?.cancellationOptions.instanceGetTimeoutMS).toBeGreaterThan(0);
    expect(startOptions?.cancellationOptions.portReadyTimeoutMS).toBeLessThanOrEqual(1_000);
    expect(startOptions?.cancellationOptions.portReadyTimeoutMS).toBeGreaterThan(0);
  });

  it("emits workspace-invocation readiness timing in container logs", async () => {
    const { container } = createContainerDouble();

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_workspace_ready"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          readinessLatencyMs: expect.any(Number),
        }),
        message: "Hosted execution container is ready.",
        phase: "container.ready",
      }),
    );
  });

  it("aborts active workspace fetches on destroy so queued invokes are not blocked", async () => {
    const firstWorkspaceFetchStarted = createDeferred<void>();
    let workspaceFetchCount = 0;
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (!url.endsWith("/internal/workspace-invocation")) {
          return new Response(JSON.stringify(createRunnerResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        workspaceFetchCount += 1;
        if (workspaceFetchCount === 1) {
          firstWorkspaceFetchStarted.resolve();
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) {
            throw new Error("Expected workspace invocation fetch to include an abort signal.");
          }
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(signal.reason instanceof Error
                ? signal.reason
                : new Error("workspace invocation aborted"));
            }, { once: true });
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

    const activeInvoke = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_active_destroyed"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    }).catch((error: unknown) => error);
    await firstWorkspaceFetchStarted.promise;

    const queuedInvoke = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_queued_after_destroy"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    expect(workspaceFetchCount).toBe(1);
    await container.destroyInstance();
    await expect(activeInvoke).resolves.toBeInstanceOf(Error);
    await expect(queuedInvoke).resolves.toEqual(createRunnerResult());
    expect(workspaceFetchCount).toBe(2);
  });

  it("propagates safe configuration failures from the runner shell with the inner error code", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify({
          code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
          error: "Hosted assistant defaults are missing.",
          stack: "secret stack should not escape the parser",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 503,
        });
      }),
    });

    const thrown = await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_config_error"),
      },
      timeoutMs: 10_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(HostedExecutionConfigurationError);
    expect(thrown).toMatchObject({
      code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
      message:
        "Hosted assistant defaults are missing. Code: HOSTED_ASSISTANT_CONFIG_REQUIRED. Status: 503.",
      name: "HostedExecutionConfigurationError",
    });
    expect(String(thrown)).not.toContain("secret stack");
  });

  it("preserves invalid-request diagnostics from runner shell responses", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return createInvalidRunnerRequestResponse();
      }),
    });

    const thrown = await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_invalid_request_diagnostics"),
      },
      timeoutMs: 10_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      code: "type_error",
      details: {
        errorDetail:
          "Hosted assistant runtime job input runtime.userEnv.OPENAI_API_KEY must be a string.",
      },
      message:
        "Invalid request. Detail: Hosted assistant runtime job input runtime.userEnv.[redacted-env-key] must be a string. Code: type_error. Status: 400.",
      name: "TypeError",
      status: 400,
      statusCode: 400,
    });
    expect(requireObject(thrown, "runner error").details).toMatchObject({
      errorDetail:
        "Hosted assistant runtime job input runtime.userEnv.OPENAI_API_KEY must be a string.",
    });
    const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) => input?.message === "Hosted execution container failed.");
    if (!failureLogInput) {
      throw new Error("Expected container failure log input.");
    }
    expect(failureLogInput).toEqual(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          errorCode: "invalid_request",
          errorCodeDetail: "type_error",
          errorDetailPresent: true,
          errorMessage: "Hosted execution rejected an invalid request.",
          errorName: "TypeError",
          errorStatus: 400,
        }),
        level: "warn",
        message: "Hosted execution container failed.",
        phase: "failed",
        userId: "member_123",
      }),
    );
    expect(failureLogInput).not.toHaveProperty("error");
    expectRunnerContainerStructuredLogsToOmitInvalidRequestDetails();
  });

  it("bubbles runtime shell detail into the thrown container error message", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify({
          code: "runtime_error",
          details: {
            errorCodeDetail: "VAULT_FILE_MISSING",
            errorDetail: "Missing required file \"vault.json\".",
          },
          error: "Hosted execution runtime failed.",
          errorName: "Error",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 500,
        });
      }),
    });

    const thrown = await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_runtime_detail"),
      },
      timeoutMs: 10_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      code: "runtime_error",
      details: {
        errorCodeDetail: "VAULT_FILE_MISSING",
        errorDetail: "Missing required file \"vault.json\".",
      },
      message:
        "Hosted execution runtime failed. Detail: Missing required file \"vault.json\". Code: VAULT_FILE_MISSING. Status: 500.",
      name: "Error",
      status: 500,
      statusCode: 500,
    });
  });

  it("prefers sanitized inner runtime status over the container response status", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify({
          code: "runtime_error",
          details: {
            errorDetail: "Provider request was rate limited.",
            errorStatus: 429,
          },
          error: "Hosted execution runtime failed.",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 500,
        });
      }),
    });

    const thrown = await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_runtime_inner_status"),
      },
      timeoutMs: 10_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      details: {
        errorDetail: "Provider request was rate limited.",
        errorStatus: 429,
      },
      message:
        "Hosted execution runtime failed. Detail: Provider request was rate limited. Code: runtime_error. Status: 429.",
      status: 500,
      statusCode: 500,
    });
  });

  it("restores safe bundle-validation error names from runner shell error codes", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify({
          code: "bundle_archive_validation_error",
          details: {
            bundleArchiveOperation: "runner-input",
            bundleRefPresent: true,
          },
          error: "Hosted bundle archive validation failed.",
          errorName: "Error",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 500,
        });
      }),
    });

    const thrown = await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_bundle_validation_diagnostics"),
      },
      timeoutMs: 10_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      code: "bundle_archive_validation_error",
      details: {
        bundleArchiveOperation: "runner-input",
        bundleRefPresent: true,
      },
      message:
        "Hosted bundle archive validation failed. Code: bundle_archive_validation_error. Status: 500.",
      name: "HostedBundleArchiveValidationError",
      status: 500,
      statusCode: 500,
    });
  });

  it("keeps the canonical internal HTTP run route disabled", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    const response = await container.fetch(new Request("https://runner.internal/internal/workspace-invocation", {
      body: JSON.stringify({
        job: {
          kind: "workspace-invocation",
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
      new Request("https://runner.internal/internal/workspace-invocation", { method: "GET" }),
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
    })).rejects.toThrow("Hosted execution runner job input must be an object.");
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("cleans up on activity expiry without posting an idle checkpoint job", async () => {
    const containerFetch = vi.fn(async () => new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const destroy = vi.fn(async () => {});
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      initialStatus: "running",
    });

    await expect(container.onActivityExpired()).resolves.toBeUndefined();

    expect(containerFetch).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("waits for explicit destroy to resolve through the native container lifecycle", async () => {
    vi.useFakeTimers();

    try {
      let status: "running" | "destroying" | "stopped" = "running";
      const destroy = vi.fn(async () => {
        status = "destroying";
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        status = "stopped";
      });
      const getState = vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      }));
      const { container } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const destroyPromise = container.destroyInstance();
      await vi.advanceTimersByTimeAsync(300);

      await expect(destroyPromise).resolves.toBeUndefined();
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            destroyLatencyMs: expect.any(Number),
            failClosed: true,
            lifecycleStage: "destroyed",
            statusBeforeDestroy: "running",
          }),
          message: "Hosted execution container destroy completed.",
          phase: "container.ready",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns after destroy resolves without post-destroy status polling", async () => {
    vi.useFakeTimers();

    try {
      let status: "running" | "destroying" = "running";
      const destroy = vi.fn(async () => {
        status = "destroying";
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      });
      const getState = vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      }));
      const { container } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const destroyPromise = container.destroyInstance();
      await vi.advanceTimersByTimeAsync(300);

      await expect(destroyPromise).resolves.toBeUndefined();
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(getState).toHaveBeenCalledTimes(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            lifecycleStage: "destroyed",
            statusBeforeDestroy: "running",
          }),
          message: "Hosted execution container destroy completed.",
          phase: "container.ready",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when explicit destroy throws", async () => {
    const destroy = vi.fn(async () => {
      throw new Error("destroy failed");
    });
    const { container } = createContainerDouble({
      destroy,
      initialStatus: "running",
    });

    const thrown = await container.destroyInstance().catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain("Hosted runner container failed to destroy cleanly.");
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          failClosed: true,
          lifecycleStage: "destroy",
          statusBeforeDestroy: "running",
        }),
        message: "Hosted execution container destroy request failed.",
        phase: "failed",
      }),
    );
  });

  it("does best-effort cleanup on activity expiry when destroy throws", async () => {
    const destroy = vi.fn(async () => {
      throw new Error("destroy failed");
    });
    const { container } = createContainerDouble({
      destroy,
      initialStatus: "running",
    });

    vi.useFakeTimers();
    try {
      const cleanupPromise = container.onActivityExpired();
      await vi.advanceTimersByTimeAsync(5_500);
      await expect(cleanupPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("treats missing containers as already destroyed during explicit cleanup", async () => {
    const destroy = vi.fn(async () => {
      throw new Error(
        "Monitoring container failed with: 404 {\"message\":\"No such container: workerd-murph-hosted-RunnerContainer-abc\"}",
      );
    });
    const { container } = createContainerDouble({
      destroy,
      initialStatus: "running",
    });

    await expect(container.destroyInstance()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("treats missing containers as already destroyed even when the runtime throws a plain object", async () => {
    const destroy = vi.fn(async () => {
      throw {
        message: "Monitoring container failed with: 404 {\"message\":\"No such container: workerd-murph-hosted-RunnerContainer-abc\"}",
      };
    });
    const { container } = createContainerDouble({
      destroy,
      initialStatus: "running",
    });

    await expect(container.destroyInstance()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("treats missing containers as stopped when the status lookup races the destroy", async () => {
    const getState = vi.fn(async () => {
      throw new Error(
        "Monitoring container failed with: 404 {\"message\":\"No such container: workerd-murph-hosted-RunnerContainer-abc\"}",
      );
    });
    const { container, destroy } = createContainerDouble({
      destroy: vi.fn(async () => {
        throw new Error("destroy should not run once the shell is already gone");
      }),
      getState,
      initialStatus: "running",
    });

    await expect(container.destroyInstance()).resolves.toBeUndefined();
    expect(getState).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("fails closed before reuse when an unhealthy warm shell cannot be destroyed", async () => {
    const destroy = vi.fn(async () => {
      throw new Error("destroy failed");
    });
    const { container, startAndWaitForPorts } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
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
      destroy,
      initialStatus: "running",
    });

    vi.useFakeTimers();
    try {
      const invokeResultPromise = container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_destroy_failure"),
        },
        timeoutMs: 30_000,
        userId: "member_123",
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(11_000);
      const thrown = await invokeResultPromise;
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toContain("Hosted runner container failed to destroy cleanly.");
    } finally {
      vi.useRealTimers();
    }
    expect(destroy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("fails closed after a warm health failure whose destroy reports an already-stopping shell", async () => {
    vi.useFakeTimers();

    try {
      let status: "running" | "stopping" | "stopped" = "running";
      let healthChecks = 0;
      const destroy = vi.fn(async () => {
        status = "stopping";
        setTimeout(() => {
          status = "stopped";
        }, 250);
        throw new Error("container is already stopping");
      });
      const getState = vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      }));
      const startAndWaitForPortsMock = vi.fn(async () => {
        status = "running";
      });
      const { container, startAndWaitForPorts } = createContainerDouble({
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            healthChecks += 1;
            if (healthChecks > 1) {
              return new Response(JSON.stringify({ ok: true }), {
                headers: {
                  "content-type": "application/json; charset=utf-8",
                },
                status: 200,
              });
            }
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
        destroy,
        getState,
        startAndWaitForPorts: startAndWaitForPortsMock,
      });
      const invokePromise = container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_after_destroy_race"),
        },
        timeoutMs: 30_000,
        userId: "member_123",
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(600);

      const thrown = await invokePromise;
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toContain("Hosted runner container failed to destroy cleanly.");
      expect(healthChecks).toBe(1);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(startAndWaitForPorts).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aligns the container sleepAfter with the configured idle lifecycle", () => {
    const { container } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2500",
      },
    });

    expect(container.sleepAfter).toBe("3s");
  });

  it("rejects runner lifecycle env values with trailing junk", async () => {
    expect(() =>
      createContainerDouble({
        env: {
          HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2500abc",
        },
      })
    ).toThrow("HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS must be an integer");

    const { container } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "45000abc",
      },
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_bad_ready_timeout"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).rejects.toThrow("HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS must be a positive integer.");
  });

  it("defaults the warm container idle lifecycle to five minutes", () => {
    const { container } = createContainerDouble();

    expect(container.sleepAfter).toBe("300s");
  });

  it("renews activity before a workspace invocation reaches the runner shell", async () => {
    const renewActivityTimeout = vi.fn();
    const { container, containerFetch } = createContainerDouble();
    Object.assign(container, {
      renewActivityTimeout,
    });

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: {
          ...createRunnerRequest("evt_runtime_renew"),
          reason: "nudge",
        },
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    const executeCallIndex = containerFetch.mock.calls.findIndex(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCallIndex).toBeGreaterThanOrEqual(0);
    expect(renewActivityTimeout).toHaveBeenCalled();
    expect(renewActivityTimeout.mock.invocationCallOrder[0]).toBeLessThan(
      containerFetch.mock.invocationCallOrder[executeCallIndex] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("uses the configured readiness timeout when cold-starting the container shell", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "45000",
      },
    });

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_ready_timeout"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(startAndWaitForPorts.mock.calls[0]?.[0]?.cancellationOptions).toMatchObject({
      instanceGetTimeoutMS: 45_000,
      portReadyTimeoutMS: 45_000,
    });
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
    const getByName = vi.fn((_name: string): HostedExecutionContainerStubLike => ({
      async destroyInstance() {},
      invoke,
      async smokeHealth() {
        return {
          ok: true,
          runnerBundle: null,
          service: "cloudflare-hosted-runner-node",
          status: 200,
        };
      },
    }));

    await invokeHostedExecutionContainerRunner({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_namespace"),
      },
      runnerContainerNamespace: { getByName },
      timeoutMs: 45_000,
      userId: "member_123",
    });

    expect(getByName).toHaveBeenCalledWith("member_123");
    const firstCall = invoke.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the runner container stub to be invoked.");
    }
    const body = requireObject(firstCall.at(0), "Runner container invoke payload");
    expect(body).toMatchObject({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_namespace"),
      },
      timeoutMs: 45_000,
      userId: "member_123",
    });
  });

  it("uses an explicit runner container name without changing the job user identity", async () => {
    const invoke = vi.fn(async () => createRunnerResult());
    const getByName = vi.fn((_name: string): HostedExecutionContainerStubLike => ({
      async destroyInstance() {},
      invoke,
      async smokeHealth() {
        return {
          ok: true,
          runnerBundle: null,
          service: "cloudflare-hosted-runner-node",
          status: 200,
        };
      },
    }));

    await invokeHostedExecutionContainerRunner({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_namespace"),
      },
      runnerContainerName: "member_123--v-version-123",
      runnerContainerNamespace: { getByName },
      timeoutMs: 45_000,
      userId: "member_123",
    });

    expect(getByName).toHaveBeenCalledWith("member_123--v-version-123");
    const firstCall = invoke.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the runner container stub to be invoked.");
    }
    const body = requireObject(firstCall.at(0), "Runner container invoke payload");
    expect(body).toMatchObject({
      timeoutMs: 45_000,
      userId: "member_123",
    });
  });

  it("resolves runner container names from worker version metadata", () => {
    expect(resolveHostedExecutionRunnerContainerName({
      source: {
        CF_VERSION_METADATA: {
          id: " version/123 ",
        },
      },
      userId: "member_123",
    })).toBe("member_123--v-version-123");
  });

  it("falls back to the user id when worker version metadata is unavailable", () => {
    expect(resolveHostedExecutionRunnerContainerName({
      source: {},
      userId: "member_123",
    })).toBe("member_123");
    expect(resolveHostedExecutionRunnerContainerName({
      source: {
        CF_VERSION_METADATA: {
          id: "   ",
        },
      },
      userId: "member_123",
    })).toBe("member_123");
  });

  it("rejects mismatched route and job identities before selecting a container", async () => {
    const invoke = vi.fn(async () => createRunnerResult());
    const getByName = vi.fn((_name: string): HostedExecutionContainerStubLike => ({
      async destroyInstance() {},
      invoke,
      async smokeHealth() {
        return {
          ok: true,
          runnerBundle: null,
          service: "cloudflare-hosted-runner-node",
          status: 200,
        };
      },
    }));

    await expect(invokeHostedExecutionContainerRunner({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_namespace_mismatch"),
      },
      runnerContainerNamespace: { getByName },
      timeoutMs: 45_000,
      userId: "member_other",
    })).rejects.toThrow("route userId must match workspace job userId");

    expect(getByName).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects durable-object invoke payloads with mismatched route and job identities", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble();

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_invoke_mismatch"),
      },
      timeoutMs: 45_000,
      userId: "member_other",
    })).rejects.toThrow("invoke userId must match workspace job userId");

    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("rejects workspace-invocation route mismatches against the workspace job userId", async () => {
    const invoke = vi.fn(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    }));
    const getByName = vi.fn((_name: string): HostedExecutionContainerStubLike => ({
      async destroyInstance() {},
      invoke,
      async smokeHealth() {
        return {
          ok: true,
          runnerBundle: null,
          service: "cloudflare-hosted-runner-node",
          status: 200,
        };
      },
    }));

    await expect(invokeHostedExecutionContainerRunner({
      job: createWorkspaceRunnerJob("member_workspace_job"),
      runnerContainerNamespace: { getByName },
      timeoutMs: 45_000,
      userId: "member_other",
    })).rejects.toThrow("route userId must match workspace job userId");

    expect(getByName).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("forwards workspace-invocation jobs without run-drain fields to the container shell", async () => {
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify({
          nextWakeAt: null,
          redactedStatus: {
            importedCount: 0,
          },
          status: "idle",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }),
    });

    await expect(container.invoke({
      job: createWorkspaceRunnerJob("member_workspace_container"),
      timeoutMs: 45_000,
      userId: "member_workspace_container",
    })).resolves.toEqual({
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 0,
      },
      status: "idle",
    });

    const executeCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCall).toBeTruthy();
    if (!executeCall?.[1]?.body || typeof executeCall[1].body !== "string") {
      throw new Error("Expected the container double to forward a JSON request body.");
    }
    const forwarded = JSON.parse(executeCall[1].body) as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      job: {
        kind: "workspace-invocation",
        request: {
          attemptId: "attempt_member_workspace_container",
          leaseGeneration: "11",
          reason: "nudge",
          userId: "member_workspace_container",
          workspaceVersion: "6",
        },
      },
    });
    const forwardedJob = requireObject(
      requireObject(forwarded.job, "forwarded.job").request,
      "forwarded.job.request",
    );
    expect(forwardedJob).not.toHaveProperty("run");
    expect(forwardedJob).not.toHaveProperty("runDrain");
    expect(forwardedJob).not.toHaveProperty("runToken");
  });

  it("aborts foreground workspace helpers without destroying the warm shell", async () => {
    const abortController = new AbortController();
    const abortWorkspaceInvocation = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["abortWorkspaceInvocation"]>
    >(async () => {});
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(
      async () => new Promise<never>(() => {}),
    );
    const getByName = vi.fn((_name: string): HostedExecutionContainerStubLike => ({
      abortWorkspaceInvocation,
      destroyInstance,
      invoke,
      async smokeHealth() {
        return {
          ok: true,
          runnerBundle: null,
          service: "cloudflare-hosted-runner-node",
          status: 200,
        };
      },
    }));

    const job = createWorkspaceRunnerJob("member_foreground_abort");
    const invocation = invokeHostedExecutionContainerRunner({
      job,
      runnerContainerNamespace: { getByName },
      signal: abortController.signal,
      timeoutMs: 45_000,
      userId: "member_foreground_abort",
    });

    abortController.abort(new Error("stale local active invocation"));

    await expect(invocation).rejects.toThrow("stale local active invocation");
    expect(abortWorkspaceInvocation).toHaveBeenCalledWith({
      attemptId: job.request.attemptId,
      userId: "member_foreground_abort",
    });
    expect(destroyInstance).not.toHaveBeenCalled();
  });

  it("rejects explicit run-drain runner jobs at the container boundary", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble();

    await expect(container.invoke({
      job: {
        // @ts-expect-error Deliberately exercising the runtime parse boundary.
        kind: "run-drain",
        request: createRunnerRequest("evt_run_drain_rejected"),
      },
      timeoutMs: 45_000,
      userId: "member_123",
    })).rejects.toThrow("kind must be workspace-invocation");

    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("rejects legacy run fields on workspace-invocation requests", async () => {
    const { container, startAndWaitForPorts } = createContainerDouble();

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: {
          ...createRunnerRequest("evt_legacy_fields_rejected"),
          // @ts-expect-error Deliberately exercising the runtime parse boundary.
          run: {
            attempt: 1,
            runId: "run_legacy",
            startedAt: "2026-03-27T00:00:00.000Z",
          },
          runDrain: {},
        },
      },
      timeoutMs: 45_000,
      userId: "member_123",
    })).rejects.toThrow("request.run is no longer supported");

    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("preserves workspace-invocation request fields when the container is invoked over durable-object RPC", async () => {
    const { container, containerFetch } = createContainerDouble();
    const extendedRequest = {
      ...createRunnerRequest("evt_extended"),
      budget: {
        maxMailboxItems: 3,
      },
    };

    await container.invoke({
      job: {
        kind: "workspace-invocation",
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
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCall).toBeTruthy();
    if (!executeCall?.[1]?.body || typeof executeCall[1].body !== "string") {
      throw new Error("Expected the container double to forward a JSON request body.");
    }
    const forwarded = JSON.parse(executeCall[1].body) as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      job: {
        kind: "workspace-invocation",
        request: {
          attemptId: "attempt_evt_extended",
          budget: {
            maxMailboxItems: 3,
          },
          leaseGeneration: "11",
          reason: "nudge",
          userId: "member_123",
          workspaceVersion: "6",
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
    const getByName = vi.fn(() => ({
      destroyInstance,
      invoke: vi.fn(async () => createRunnerResult()),
      smokeHealth: vi.fn(async () => ({
        ok: true,
        runnerBundle: null,
        service: "cloudflare-hosted-runner-node",
        status: 200,
      })),
    } satisfies HostedExecutionContainerStubLike));

    await destroyHostedExecutionContainer({
      runnerContainerNamespace: {
        getByName,
      },
      userId: "member_123",
    });
    await destroyHostedExecutionContainer({
      runnerContainerName: "member_789--v-version-123",
      runnerContainerNamespace: {
        getByName,
      },
      userId: "member_789",
    });
    await destroyHostedExecutionContainer({
      runnerContainerNamespace: null,
      userId: "member_456",
    });

    expect(getByName).toHaveBeenNthCalledWith(1, "member_123");
    expect(getByName).toHaveBeenNthCalledWith(2, "member_789--v-version-123");
    expect(destroyInstance).toHaveBeenCalledTimes(2);
  });
});

function createContainerDouble(input: {
  containerFetch?: ReturnType<typeof vi.fn>;
  destroy?: ReturnType<typeof vi.fn>;
  env?: Record<string, unknown>;
  getState?: ReturnType<typeof vi.fn>;
  initialStatus?: "running" | "stopped" | "stopped_with_code";
  startAndWaitForPorts?: ReturnType<typeof vi.fn>;
  state?: Record<string, unknown>;
  } = {}) {
  let currentStatus = input.initialStatus ?? "stopped";
  const container = new RunnerContainer({
    storage: createContainerStorageDouble(),
    ...(input.state ?? {}),
  } as never, {
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
  const getState = input.getState ?? vi.fn(async () => ({
    lastChange: Date.now(),
    status: currentStatus,
  }));
  const startAndWaitForPorts = input.startAndWaitForPorts ?? vi.fn(async () => {
    currentStatus = "running";
  });

  Object.assign(container, {
    containerFetch,
    destroy,
    getState,
    startAndWaitForPorts,
  });

  return {
    container,
    containerFetch,
    destroy,
    getState,
    startAndWaitForPorts,
  };
}

interface ContainerStorageDouble {
  delete(key: string): Promise<boolean>;
  get<T>(key: string): Promise<T | undefined>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
}

function createContainerStorageDouble(overrides: Partial<ContainerStorageDouble> = {}): ContainerStorageDouble {
  const values = new Map<string, unknown>();

  return {
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
    ...overrides,
  };
}

function createInvalidRunnerRequestResponse(): Response {
  return new Response(JSON.stringify({
    code: "type_error",
    details: {
      errorDetail: "Hosted assistant runtime job input runtime.userEnv.OPENAI_API_KEY must be a string.",
    },
    error: "Invalid request.",
    errorName: "TypeError",
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 400,
  });
}

function expectRunnerContainerStructuredLogsToOmitInvalidRequestDetails(): void {
  const structuredLogs = mocks.emitHostedExecutionStructuredLog.mock.calls
    .map(([input]) => buildHostedExecutionStructuredLogRecord(input));
  const serializedLogs = JSON.stringify(structuredLogs);
  expect(serializedLogs).not.toContain("OPENAI_API_KEY");
  expect(serializedLogs).not.toContain("runtime.userEnv");
  for (const log of structuredLogs) {
    if (log.details) {
      expect(log.details).not.toHaveProperty("errorDetail");
    }
  }
}

function createDeferred<T>() {
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

function createRunnerRequest(eventId = "evt_123") {
  return {
    attemptId: `attempt_${eventId}`,
    leaseGeneration: "11",
    reason: "nudge" as const,
    userId: "member_123",
    workspaceVersion: "6",
  };
}

function createWorkspaceRunnerJob(userId: string) {
  return {
    kind: "workspace-invocation" as const,
    request: {
      attemptId: `attempt_${userId}`,
      budget: {
        maxMailboxItems: 5,
      },
      leaseGeneration: "11",
      reason: "nudge" as const,
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

function createRunnerResult(): HostedWorkspaceInvocationResult {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle",
  };
}
