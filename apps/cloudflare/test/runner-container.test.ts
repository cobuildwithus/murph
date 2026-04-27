import type { HostedWorkspaceInvocationResult } from "@murphai/hosted-execution/runtime-control";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  type HostedExecutionContainerStubLike,
  invokeHostedExecutionContainerRunner,
  RunnerContainer,
} from "../src/runner-container.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "../src/internal-hosts.ts";

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

  it("destroys each successful per-user shell and cold-starts back-to-back invocations", async () => {
    const { container, containerFetch, destroy, setOutboundByHosts, startAndWaitForPorts } =
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
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(2);

    const supervisorEnv = startAndWaitForPorts.mock.calls[0]?.[0]?.startOptions?.envVars;
    expect(supervisorEnv).toMatchObject({
      PORT: "8080",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: expect.any(String),
    });

    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls).toHaveLength(2);
    expect(String(executeCalls[0]?.[0])).toBe("http://container/internal/workspace-invocation");
    const firstAuthorization = readAuthorizationHeader(executeCalls[0]?.[1]?.headers);
    const secondAuthorization = readAuthorizationHeader(executeCalls[1]?.[1]?.headers);
    expect(firstAuthorization).toBe(
      `Bearer ${supervisorEnv?.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN}`,
    );
    expect(secondAuthorization).toMatch(/^Bearer .+/u);
    expect(secondAuthorization).not.toBe(firstAuthorization);

    const outboundTokens = setOutboundByHosts.mock.calls
      .map(([mapping]) => readRunnerProxyToken(mapping as Record<string, unknown>))
      .filter((token): token is string => token !== null);
    expect(outboundTokens).toHaveLength(2);
    expect(outboundTokens[0]).toBeTruthy();
    expect(outboundTokens[1]).toBeTruthy();
    expect(outboundTokens[0]).not.toBe(outboundTokens[1]);

    const outboundMethods = setOutboundByHosts.mock.calls
      .map(([mapping]) => readRunnerMethodsByHost(mapping as Record<string, unknown>))
      .filter((methods) => Object.keys(methods).length > 0);
    const expectedOutboundMethods = Object.fromEntries(
      Object.values(CLOUDFLARE_HOSTED_RUNTIME_HOSTS).map((host) => [host, "internalWorkerProxy"]),
    );
    expect(outboundMethods).toHaveLength(2);
    expect(outboundMethods).toEqual([expectedOutboundMethods, expectedOutboundMethods]);

    const outboundAssignments = setOutboundByHosts.mock.calls
      .map(([mapping]) => readRunnerOutboundAssignments(mapping as Record<string, unknown>))
      .filter((assignment) => Object.keys(assignment).length > 0);
    expect(outboundAssignments).toHaveLength(2);
    for (const assignment of outboundAssignments) {
      expect(Object.keys(assignment).sort()).toEqual(
        Object.values(CLOUDFLARE_HOSTED_RUNTIME_HOSTS).sort(),
      );
      for (const value of Object.values(assignment)) {
        expect(value).toMatchObject({
          internalWorkerProxyToken: expect.any(String),
          method: "internalWorkerProxy",
          userId: "member_123",
        });
        expect(value).not.toHaveProperty("runAttempt");
        expect(value).not.toHaveProperty("runId");
      }
    }
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
    expect(startAndWaitForPorts.mock.calls[0]?.[0]?.startOptions?.envVars).toEqual({
      PORT: "8080",
    });
    expect(readAuthorizationHeader(containerFetch.mock.calls[0]?.[1]?.headers)).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
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
        HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: '{"kty":"EC"}',
        HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: '{"kty":"EC","x":"pub","y":"pub"}',
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-loopback-token",
        HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL: "http://host.docker.internal:8787",
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
        HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: '{"kty":"EC","x":"recovery","y":"recovery"}',
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://host.docker.internal:4010/.well-known/jwks",
        HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
        HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "cobuildwithus",
        HOSTED_WAKE_ENCRYPTION_KEY: "hosted-mailbox-key",
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
    const envVars = startAndWaitForPorts.mock.calls[0]?.[0]?.startOptions?.envVars ?? {};
    expect(envVars).toMatchObject({
      PORT: "8080",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: expect.any(String),
    });
    expect(envVars).not.toHaveProperty("HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK");
    expect(envVars).not.toHaveProperty("HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY");
    expect(envVars).not.toHaveProperty("HOSTED_WAKE_ENCRYPTION_KEY");
    expect(envVars).not.toHaveProperty("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK");
  });

  it("keeps operator secrets out of supervisor procfs env", async () => {
    if (!existsSync("/proc/self/environ")) {
      return;
    }

    const { container, startAndWaitForPorts } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "automation-private-jwk",
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-envelope-key",
        HOSTED_WAKE_ENCRYPTION_KEY: "wake-encryption-key",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
        OPENAI_API_KEY: "model-api-key",
      },
    });

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_procfs_supervisor_env"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    const envVars = startAndWaitForPorts.mock.calls[0]?.[0]?.startOptions?.envVars;
    if (!envVars) {
      throw new Error("Expected runner supervisor env vars.");
    }
    const procEnv = await readParentProcEnvironmentFromChild(envVars);

    expect(procEnv).not.toContain("HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK");
    expect(procEnv).not.toContain("HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY");
    expect(procEnv).not.toContain("HOSTED_WAKE_ENCRYPTION_KEY");
    expect(procEnv).not.toContain("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK");
    expect(procEnv).not.toContain("OPENAI_API_KEY");
  });

  it("passes the local internal bridge config through each runner request when configured", async () => {
    const { container, containerFetch } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
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
      localInternalProxyBaseUrl:
        "http://127.0.0.1:8787/__murph/local-internal-proxy/users/member_123/",
    });
  });

  it("accepts only the active workspace proxy token and expires it after completion", async () => {
    let activeToken: string | null = null;
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
        const body = JSON.parse(init.body) as { internalWorkerProxyToken?: unknown };
        activeToken =
          typeof body.internalWorkerProxyToken === "string"
            ? body.internalWorkerProxyToken
            : null;
        expect(activeToken).toBeTruthy();
        expect(await container.ownsInternalWorkerProxyToken({
          attemptId: "attempt_evt_active_proxy_token",
          leaseGeneration: "11",
          token: activeToken ?? "",
          userId: "member_123",
        })).toBe(true);
        expect(await container.ownsInternalWorkerProxyToken({
          attemptId: "attempt_evt_active_proxy_token",
          leaseGeneration: "11",
          token: activeToken ?? "",
          userId: "member_other",
        })).toBe(false);
        expect(await container.ownsInternalWorkerProxyToken({
          attemptId: "stale_attempt",
          leaseGeneration: "11",
          token: activeToken ?? "",
          userId: "member_123",
        })).toBe(false);

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

    expect(activeToken).toBeTruthy();
    expect(await container.ownsInternalWorkerProxyToken({
      token: activeToken ?? "",
      userId: "member_123",
    })).toBe(false);
  });

  it("retries transient outbound handler installation failures before giving up", async () => {
    const setOutboundByHosts = vi
      .fn()
      .mockRejectedValueOnce(new Error("Updating sidecar egress port failed with: 404"))
      .mockRejectedValueOnce(new Error("Connecting to container port through proxy-everything failed"))
      .mockResolvedValue(undefined);
    const { container, startAndWaitForPorts } = createContainerDouble({
      setOutboundByHosts,
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_retry_outbound_handlers"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(setOutboundByHosts).toHaveBeenCalledTimes(4);
    expect(setOutboundByHosts.mock.calls[3]?.[0]).toEqual({});
  });

  it("registers exactly one stable outbound handler method for the runner boundary", () => {
    expect(Object.keys(RunnerContainer.outboundHandlers ?? {})).toEqual([
      "internalWorkerProxy",
    ]);
  });

  it("does not route generic loopback hosts through the outbound handler", async () => {
    const { container, setOutboundByHosts } = createContainerDouble();

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_loopback_proxy"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    const mapping = setOutboundByHosts.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(mapping).toBeDefined();
    expect(readRunnerMethodsByHost(mapping ?? {})).not.toHaveProperty("::1");
    expect(readRunnerMethodsByHost(mapping ?? {})).not.toHaveProperty("127.0.0.1");
    expect(readRunnerMethodsByHost(mapping ?? {})).not.toHaveProperty("localhost");
  });

  it("keeps activity expiry idempotent after post-run teardown and cold-starts the next run", async () => {
    const { container, containerFetch, destroy, setOutboundByHosts, startAndWaitForPorts } =
      createContainerDouble();

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest(),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    const firstExecuteCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    const firstToken = readAuthorizationHeader(firstExecuteCall?.[1]?.headers);

    expect(destroy).toHaveBeenCalledTimes(1);
    await container.onActivityExpired();
    expect(destroy).toHaveBeenCalledTimes(1);

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_alarm"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    const secondToken = readAuthorizationHeader(executeCalls[1]?.[1]?.headers);
    const outboundTokens = setOutboundByHosts.mock.calls
      .map(([mapping]) => readRunnerProxyToken(mapping as Record<string, unknown>))
      .filter((token): token is string => token !== null);

    expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(firstToken).not.toBe(secondToken);
    expect(outboundTokens).toHaveLength(2);
    expect(outboundTokens[0]).toBeTruthy();
    expect(outboundTokens[1]).toBeTruthy();
    expect(outboundTokens[0]).not.toBe(outboundTokens[1]);
  });

  it("does not reuse a successful shell when best-effort teardown fails", async () => {
    vi.useFakeTimers();

    try {
      let status: "running" | "stopped" = "stopped";
      const destroy = vi.fn(async () => {
        if (destroy.mock.calls.length === 1) {
          status = "running";
          throw new Error("transient destroy failure");
        }
        status = "stopped";
      });
      const getState = vi.fn(async () => ({
        lastChange: Date.now(),
        status,
      }));
      const startAndWaitForPorts = vi.fn(async () => {
        status = "running";
      });
      const { container, containerFetch } = createContainerDouble({
        destroy,
        getState,
        startAndWaitForPorts,
      });

      const firstInvoke = container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_teardown_failure_first"),
        },
        timeoutMs: 30_000,
        userId: "member_123",
      });
      await vi.advanceTimersByTimeAsync(5_500);
      await expect(firstInvoke).resolves.toEqual(createRunnerResult());

      await expect(container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_teardown_failure_second"),
        },
        timeoutMs: 30_000,
        userId: "member_123",
      })).resolves.toEqual(createRunnerResult());

      const executeCalls = containerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/internal/workspace-invocation")
      );
      const firstAuthorization = readAuthorizationHeader(executeCalls[0]?.[1]?.headers);
      const secondAuthorization = readAuthorizationHeader(executeCalls[1]?.[1]?.headers);

      expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
      expect(destroy).toHaveBeenCalledTimes(3);
      expect(firstAuthorization).toMatch(/^Bearer .+/u);
      expect(secondAuthorization).toMatch(/^Bearer .+/u);
      expect(secondAuthorization).not.toBe(firstAuthorization);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          level: "warn",
          message: "Hosted execution container destroy request failed.",
          phase: "failed",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
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
          destroyTimeoutMs: 5_000,
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

  it("destroys an already-running shell with ambiguous supervisor state before cold start", async () => {
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
    });

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_restart_ambiguous_shell"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });

    expect(destroy).toHaveBeenCalledTimes(2);
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
        initialStatus: "running",
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
      Object.assign(container, {
        runnerControlToken: "stale-control-token",
      });

      await container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_restart_after_failed_health"),
        },
        timeoutMs: 5_000,
        userId: "member_123",
      });

      expect(healthFailures).toBe(1);
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
      ports: 8080,
      startOptions: {
        enableInternet: true,
        envVars: expect.objectContaining({
          PORT: "8080",
        }),
      },
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
      message: "Hosted assistant defaults are missing.",
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
      message: "Invalid request.",
      name: "TypeError",
      status: 400,
      statusCode: 400,
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
      message: "Hosted bundle archive validation failed.",
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

  it("waits for explicit destroy to settle through the stopping state", async () => {
    vi.useFakeTimers();

    try {
      let status: "running" | "stopping" | "stopped" = "running";
      const destroy = vi.fn(async () => {
        status = "stopping";
        setTimeout(() => {
          status = "stopped";
        }, 250);
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
            destroyTimeoutMs: 5_000,
            failClosed: true,
            lifecycleStage: "stopped",
            statusBeforeDestroy: "running",
          }),
          message: "Hosted execution container destroy confirmed stopped.",
          phase: "container.ready",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts explicit destroy races when the shell is already stopping and still settles", async () => {
    vi.useFakeTimers();

    try {
      let status: "running" | "stopping" | "stopped" = "running";
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
      const { container } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const destroyPromise = container.destroyInstance();
      await vi.advanceTimersByTimeAsync(300);

      await expect(destroyPromise).resolves.toBeUndefined();
      expect(destroy).toHaveBeenCalledTimes(1);
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

    vi.useFakeTimers();
    try {
      const destroyResultPromise = container.destroyInstance().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);
      const thrown = await destroyResultPromise;
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toContain("Hosted runner container failed to destroy cleanly.");
    } finally {
      vi.useRealTimers();
    }
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("records status samples when a destroy request does not stop the shell", async () => {
    vi.useFakeTimers();

    try {
      const destroy = vi.fn(async () => {});
      const getState = vi.fn(async () => ({
        lastChange: Date.now(),
        status: "running",
      }));
      const { container } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const destroyPromise = container.destroyInstance().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);

      const thrown = await destroyPromise;
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toContain("Hosted runner container failed to destroy cleanly.");
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            destroyTimeoutMs: 5_000,
            failClosed: true,
            lifecycleStage: "wait-for-stop",
            statusBeforeDestroy: "running",
          }),
          error: expect.objectContaining({
            details: expect.objectContaining({
              destroyPollCount: expect.any(Number),
              observedStatuses: ["running"],
              statusAfterDestroy: "running",
            }),
          }),
          message: "Hosted execution container destroy did not stop the shell.",
          phase: "failed",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
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

  it("fails closed before reuse when destroying an ambiguous warm shell throws", async () => {
    const destroy = vi.fn(async () => {
      throw new Error("destroy failed");
    });
    const { container, startAndWaitForPorts } = createContainerDouble({
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

  it("cold-starts after a warm health failure whose destroy races with an already-stopping shell", async () => {
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
      Object.assign(container, {
        runnerControlToken: "stale-control-token",
      });

      const invokePromise = container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_after_destroy_race"),
        },
        timeoutMs: 30_000,
        userId: "member_123",
      });
      await vi.advanceTimersByTimeAsync(600);

      await expect(invokePromise).resolves.toEqual(createRunnerResult());
      expect(healthChecks).toBe(1);
      expect(destroy).toHaveBeenCalledTimes(2);
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps the configured idle TTL onto the container sleepAfter lifecycle", () => {
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

  it("defaults the warm container idle TTL to five minutes", () => {
    const { container } = createContainerDouble();

    expect(container.sleepAfter).toBe("300s");
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
      async ownsInternalWorkerProxyToken() {
        return false;
      },
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

  it("rejects mismatched route and job identities before selecting a container", async () => {
    const invoke = vi.fn(async () => createRunnerResult());
    const getByName = vi.fn((_name: string): HostedExecutionContainerStubLike => ({
      async destroyInstance() {},
      invoke,
      async ownsInternalWorkerProxyToken() {
        return false;
      },
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
      async ownsInternalWorkerProxyToken() {
        return false;
      },
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
    const { container, containerFetch, setOutboundByHosts } = createContainerDouble({
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
      internalWorkerProxyToken: expect.any(String),
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

    const outboundAssignments = setOutboundByHosts.mock.calls
      .map(([mapping]) => readRunnerOutboundAssignments(mapping as Record<string, unknown>))
      .filter((assignment) => Object.keys(assignment).length > 0);
    expect(outboundAssignments).toHaveLength(1);
    for (const value of Object.values(outboundAssignments[0] ?? {})) {
      expect(value).toMatchObject({
        internalWorkerProxyToken: expect.any(String),
        method: "internalWorkerProxy",
        userId: "member_workspace_container",
      });
      expect(value).not.toHaveProperty("runAttempt");
      expect(value).not.toHaveProperty("runId");
    }
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
      internalWorkerProxyToken: expect.any(String),
      localInternalProxyBaseUrl: null,
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

    await destroyHostedExecutionContainer({
      runnerContainerNamespace: {
        getByName() {
          return {
            destroyInstance,
            invoke: vi.fn(async () => createRunnerResult()),
            ownsInternalWorkerProxyToken: vi.fn(async () => false),
            smokeHealth: vi.fn(async () => ({
              ok: true,
              runnerBundle: null,
              service: "cloudflare-hosted-runner-node",
              status: 200,
            })),
          } satisfies HostedExecutionContainerStubLike;
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
  getState?: ReturnType<typeof vi.fn>;
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
  const getState = input.getState ?? vi.fn(async () => ({
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

function readRunnerMethodsByHost(
  mapping: Record<string, unknown>,
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(mapping).map(([host, value]) => {
      const method =
        typeof value === "object" && value !== null && "method" in value
          ? (value as { method?: unknown }).method
          : null;
      return [host, typeof method === "string" ? method : null];
    }),
  );
}

function readRunnerOutboundAssignments(
  mapping: Record<string, unknown>,
): Record<
  string,
  {
    internalWorkerProxyToken: string | null;
    method: string | null;
    userId: string | null;
  }
> {
  return Object.fromEntries(
    Object.entries(mapping).map(([host, value]) => {
      const assignment =
        typeof value === "object" && value !== null ? (value as {
          method?: unknown;
          params?: {
            internalWorkerProxyToken?: unknown;
            userId?: unknown;
          };
        }) : undefined;

      return [
        host,
        {
          internalWorkerProxyToken:
            typeof assignment?.params?.internalWorkerProxyToken === "string"
              ? assignment.params.internalWorkerProxyToken
              : null,
          method: typeof assignment?.method === "string" ? assignment.method : null,
          userId: typeof assignment?.params?.userId === "string" ? assignment.params.userId : null,
        },
      ];
    }),
  );
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

function readAuthorizationHeader(headers: HeadersInit | undefined): string | null {
  if (headers instanceof Headers) {
    return headers.get("authorization");
  }

  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === "authorization");
    return match?.[1] ?? null;
  }

  const record = headers as Record<string, string | undefined> | undefined;
  const value = record?.authorization ?? record?.Authorization;
  return typeof value === "string" ? value : null;
}

async function readParentProcEnvironmentFromChild(
  parentEnv: Record<string, string>,
): Promise<string> {
  const parentScript = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', \"const fs = require('node:fs'); process.stdout.write(fs.readFileSync('/proc/' + process.ppid + '/environ', 'utf8'));\"], { stdio: ['ignore', 'pipe', 'inherit'] });",
    "child.stdout.pipe(process.stdout);",
    "child.on('exit', (code) => process.exit(code ?? 1));",
  ].join("\n");

  const child = spawn(process.execPath, ["-e", parentScript], {
    env: parentEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(
      Buffer.concat(stderrChunks).toString("utf8")
        || `Proc env probe exited with ${exitCode ?? "unknown"}.`,
    );
  }

  return Buffer.concat(stdoutChunks).toString("utf8");
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
