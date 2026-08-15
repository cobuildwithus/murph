import {
  HOSTED_RUNTIME_ORCHESTRATION_LATENCY_DIAGNOSTICS_HEADER,
  type HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionStructuredLogRecord,
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
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
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "../src/runner-egress-intercept.ts";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "../src/hosted-runtime-architecture.ts";
import {
  buildHostedRunnerContainerCaEnv,
} from "../src/runner-container-ca-env.ts";
import {
  HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
} from "../src/runner-container-error-codes.ts";
import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
} from "../src/deploy-smoke-live-model.ts";
import {
  buildHostedRunnerRedactedErrorJson,
} from "../src/user-runner/diagnostics.ts";

const RUNNER_CALLBACK_BASE_URL = "https://runner-callback.example.test/";
const HOSTED_CONTAINER_CPU_WATCHDOG_FINGERPRINT_DERIVATION_CONTEXT =
  "murph:hosted-container-cpu-watchdog-fingerprint:v1";
const HOSTED_CONTAINER_CPU_WATCHDOG_FINGERPRINT_SECRET_ENV_NAME =
  "HOSTED_CONTAINER_CPU_WATCHDOG_FINGERPRINT_SECRET";
const EXPECTED_RUNNER_CONTAINER_ENV = {
  ...buildHostedRunnerContainerCaEnv(),
  PORT: "8080",
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

  it("registers host-specific outbound interception through Cloudflare Containers accessors", () => {
    expect(RunnerContainer.outbound).toBeUndefined();
    expect(RunnerContainer.outboundByHost).toBe(HOSTED_RUNNER_OUTBOUND_BY_HOST);
    expect(DeploySmokeRunnerContainer.outbound).toBeUndefined();
    expect(DeploySmokeRunnerContainer.outboundByHost).toBe(HOSTED_RUNNER_OUTBOUND_BY_HOST);
  });

  it("keeps deploy-smoke live-model egress grants off the production runner container", () => {
    const { container } = createContainerDouble();

    expect("readDeploySmokeLiveModelTurnFence" in container).toBe(false);
  });

  it("does not pass Worker fingerprint secrets to the container startup env", () => {
    const { container } = createContainerDouble({
      env: {
        HOSTED_AI_USAGE_REPORTING_SECRET: "fixture-usage-reporting-secret",
        HOSTED_LOG_FINGERPRINT_SECRET: "fixture-log-fingerprint-secret",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "fixture-provider-egress-signing-secret",
      },
    });

    expect(container.envVars).toEqual(EXPECTED_RUNNER_CONTAINER_ENV);
    expect(container.envVars).not.toHaveProperty("HOSTED_LOG_FINGERPRINT_SECRET");
    expect(container.envVars).not.toHaveProperty("HOSTED_AI_USAGE_REPORTING_SECRET");
    expect(container.envVars).not.toHaveProperty(
      "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET",
    );
  });

  it("does not derive CPU watchdog startup env from blank log fingerprint config", () => {
    const { container } = createContainerDouble({
      env: {
        HOSTED_AI_USAGE_REPORTING_SECRET: "fixture-usage-reporting-secret",
        HOSTED_LOG_FINGERPRINT_SECRET: "   ",
      },
    });

    expect(container.envVars).toEqual(EXPECTED_RUNNER_CONTAINER_ENV);
    expect(container.envVars).not.toHaveProperty("HOSTED_LOG_FINGERPRINT_SECRET");
    expect(JSON.stringify(container.envVars)).not.toContain("fixture-usage-reporting-secret");
  });

  it("reuses a successful per-user shell for back-to-back invocations", async () => {
    const { container, containerFetch, destroy, startAndWaitForPorts } =
      createContainerDouble({
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            return new Response(JSON.stringify(createRunnerHealthResult()), {
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
    expect(Object.keys(firstBody).sort()).toEqual([
      "hostedRuntimeArchitectureVersion",
      "job",
    ]);
    expect(Object.keys(secondBody).sort()).toEqual([
      "hostedRuntimeArchitectureVersion",
      "job",
    ]);
    expect(firstBody.hostedRuntimeArchitectureVersion).toBe(HOSTED_RUNTIME_ARCHITECTURE_VERSION);
    expect(secondBody.hostedRuntimeArchitectureVersion).toBe(HOSTED_RUNTIME_ARCHITECTURE_VERSION);
  });

  it("recycles a warm v1 shell before posting v2 provider-credential jobs", async () => {
    const healthChecks: string[] = [];
    const { container, containerFetch, destroy, startAndWaitForPorts } =
      createContainerDouble({
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            healthChecks.push(url);
            const version = healthChecks.length === 1
              ? "hosted-direct-v1"
              : HOSTED_RUNTIME_ARCHITECTURE_VERSION;
            return new Response(JSON.stringify({
              hostedRuntimeArchitectureVersion: version,
              ok: true,
            }), {
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
        initialStatus: "running",
      });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_recycle_v1_runtime"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(healthChecks).toHaveLength(2);

    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls).toHaveLength(1);
    const body = JSON.parse(executeCalls[0]?.[1]?.body as string);
    expect(body.hostedRuntimeArchitectureVersion).toBe(HOSTED_RUNTIME_ARCHITECTURE_VERSION);
  });

  it("does not recycle a healthy warm shell by successful invocation count", async () => {
    const { container, destroy, startAndWaitForPorts } = createContainerDouble();

    for (let index = 1; index <= 101; index += 1) {
      await expect(container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest(`evt_no_success_recycle_${index}`),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      })).resolves.toEqual(createRunnerResult());
      expect(destroy).not.toHaveBeenCalled();
    }

    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("posts an exact runtime wake to the active workspace invocation", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
              "x-runtime-wake-identity-checked": "1",
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
      orchestration: {
        freshStartInvocationAcceptedAtEpochMs: 1_777_000_000_090,
        replacedStaleFence: true,
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    await runnerRequestStarted.promise;

    await expect(container.wakeRuntime({
      attemptId: "attempt_evt_123",
      leaseGeneration: "11",
      orchestration: {
        activeWakeStartedAtEpochMs: 1_777_000_000_100,
        cloudflareRouteReceivedAtEpochMs: 1_777_000_000_050,
      },
      userId: "member_123",
    })).resolves.toEqual({
      action: "woken",
      kind: "accepted",
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
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });
    expect(JSON.parse(String(wakeCall?.[1]?.body))).toEqual({
      attemptId: "attempt_evt_123",
      leaseGeneration: "11",
      orchestration: {
        activeWakeStartedAtEpochMs: 1_777_000_000_100,
        cloudflareRouteReceivedAtEpochMs: 1_777_000_000_050,
      },
      userId: "member_123",
    });
    const runnerCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    const runnerHeaders = new Headers(runnerCall?.[1]?.headers);
    expect(JSON.parse(
      runnerHeaders.get(HOSTED_RUNTIME_ORCHESTRATION_LATENCY_DIAGNOSTICS_HEADER) ?? "",
    )).toEqual({
      freshStartInvocationAcceptedAtEpochMs: 1_777_000_000_090,
      replacedStaleFence: true,
    });
  });

  it("wakes the exact active invocation with an existing queued successor", async () => {
    const activeRequestStarted = createDeferred<void>();
    const activeResponse = createDeferred<Response>();
    let executeCallCount = 0;
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
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
            "x-runtime-wake-identity-checked": "1",
          },
          status: 204,
        });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        executeCallCount += 1;
        if (executeCallCount === 1) {
          activeRequestStarted.resolve(undefined);
          return await activeResponse.promise;
        }
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });
    const activeRequest = createRunnerRequest("evt_wake_active_before_queued");
    const activeInvocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: activeRequest,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await activeRequestStarted.promise;
    const queuedInvocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_queued_during_active_wake"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });

    await expect(container.wakeRuntime({
      attemptId: activeRequest.attemptId,
      leaseGeneration: activeRequest.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      action: "woken",
      kind: "accepted",
    });

    activeResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(activeInvocation).resolves.toEqual(createRunnerResult());
    await expect(queuedInvocation).resolves.toEqual(createRunnerResult());
  });

  it("keeps an exact wake accepted when a successor queues during the request", async () => {
    const activeRequestStarted = createDeferred<void>();
    const activeResponse = createDeferred<Response>();
    const wakeRequestStarted = createDeferred<void>();
    const wakeResponse = createDeferred<Response>();
    let executeCallCount = 0;
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        wakeRequestStarted.resolve(undefined);
        return await wakeResponse.promise;
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        executeCallCount += 1;
        if (executeCallCount === 1) {
          activeRequestStarted.resolve(undefined);
          return await activeResponse.promise;
        }
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });
    const activeRequest = createRunnerRequest("evt_wake_before_successor_queues");
    const activeInvocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: activeRequest,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await activeRequestStarted.promise;

    const wake = container.wakeRuntime({
      attemptId: activeRequest.attemptId,
      leaseGeneration: activeRequest.leaseGeneration,
      userId: "member_123",
    });
    await wakeRequestStarted.promise;
    const queuedInvocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_queued_during_wake_request"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    expect(executeCallCount).toBe(1);

    wakeResponse.resolve(new Response(null, {
      headers: {
        "x-runtime-wake-accepted": "1",
        "x-runtime-wake-identity-checked": "1",
      },
      status: 204,
    }));
    await expect(wake).resolves.toEqual({
      action: "woken",
      kind: "accepted",
    });

    activeResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(activeInvocation).resolves.toEqual(createRunnerResult());
    await expect(queuedInvocation).resolves.toEqual(createRunnerResult());
  });

  it("keeps an exact wake unconfirmed until the runner endpoint is ready", async () => {
    const readinessHealthStarted = createDeferred<void>();
    const releaseReadinessHealth = createDeferred<void>();
    const request = createRunnerRequest("evt_wake_during_readiness");
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        readinessHealthStarted.resolve(undefined);
        await releaseReadinessHealth.promise;
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await readinessHealthStarted.promise;

    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(false);

    releaseReadinessHealth.resolve(undefined);
    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("keeps an exact wake unconfirmed while child admission is pending", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const request = createRunnerRequest("evt_wake_during_child_admission");
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        return new Response(null, {
          headers: {
            "x-runtime-wake-absent": "1",
            "x-runtime-wake-accepted": "0",
          },
          status: 204,
        });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        runnerRequestStarted.resolve(undefined);
        return await runnerResponse.promise;
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await runnerRequestStarted.promise;

    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(true);

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("posts an exact runtime wake when the outer active-operation pointer is missing", async () => {
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "1",
              "x-runtime-wake-identity-checked": "1",
            },
            status: 204,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      action: "woken",
      kind: "accepted",
    });

    const wakeCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    );
    expect(JSON.parse(String(wakeCall?.[1]?.body))).toEqual({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    });
  });

  it("still probes the exact child when invocation ownership is lost mid-call", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const request = createRunnerRequest("evt_wake_after_owner_loss");
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
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
            "x-runtime-wake-identity-checked": "1",
          },
          status: 204,
        });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        runnerRequestStarted.resolve(undefined);
        return await runnerResponse.promise;
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await runnerRequestStarted.promise;
    Object.assign(container, {
      workspaceInvocationOperations: [],
    });

    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      action: "woken",
      kind: "accepted",
    });
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(true);

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("short-circuits a wake probe when platform truth says a pointerless shell is stopped", async () => {
    const { container, containerFetch, getState, startAndWaitForPorts } =
      createContainerDouble({
        containerFetch: vi.fn(async (url: string) => {
          throw new Error(`Unexpected runner request URL: ${url}`);
        }),
        initialStatus: "running",
        platformRunning: false,
      });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer_stopped_shell",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });

    expect(containerFetch).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("still probes a pointerless shell when platform truth says it is running", async () => {
    const { container, containerFetch, startAndWaitForPorts } =
      createContainerDouble({
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/internal/runtime-wake")) {
            return new Response(null, {
              headers: {
                "x-runtime-wake-absent": "1",
                "x-runtime-wake-accepted": "0",
              },
              status: 204,
            });
          }

          throw new Error(`Unexpected runner request URL: ${url}`);
        }),
        initialStatus: "stopped",
        platformRunning: true,
      });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer_running_shell",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });

    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(true);
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("rejects a delayed pointerless wake after an exact abort settles", async () => {
    const wakeRequestStarted = createDeferred<void>();
    const wakeResponse = createDeferred<Response>();
    const request = createRunnerRequest("evt_pointerless_wake_abort_aba");
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/internal/runtime-wake")) {
        wakeRequestStarted.resolve(undefined);
        return await wakeResponse.promise;
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container, destroy } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    const wake = container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    await wakeRequestStarted.promise;
    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("accepted");

    wakeResponse.resolve(new Response(null, {
      headers: {
        "x-runtime-wake-accepted": "1",
        "x-runtime-wake-identity-checked": "1",
      },
      status: 204,
    }));
    await expect(wake).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("keeps a pointerless wake unconfirmed during lifecycle work", async () => {
    const destroyStarted = createDeferred<void>();
    const releaseDestroy = createDeferred<void>();
    let status: "running" | "stopped" = "running";
    const destroy = vi.fn(async () => {
      destroyStarted.resolve(undefined);
      await releaseDestroy.promise;
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const containerFetch = vi.fn(async (url: string) => {
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });

    const destroyResult = container.destroyInstance();
    await destroyStarted.promise;
    await expect(container.wakeRuntime({
      attemptId: "attempt_pointerless_during_destroy",
      leaseGeneration: "1",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    expect(containerFetch).not.toHaveBeenCalled();

    releaseDestroy.resolve(undefined);
    await expect(destroyResult).resolves.toBeUndefined();
  });

  it("rejects a delayed pointerless wake after activity expiry destroys the shell", async () => {
    const wakeStarted = createDeferred<void>();
    const wakeResponse = createDeferred<Response>();
    let status: "running" | "stopped" = "running";
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        wakeStarted.resolve(undefined);
        return await wakeResponse.promise;
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });

    const wake = container.wakeRuntime({
      attemptId: "attempt_pointerless_before_expiry",
      leaseGeneration: "1",
      userId: "member_123",
    });
    await wakeStarted.promise;
    await expect(container.onActivityExpired()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledOnce();

    wakeResponse.resolve(new Response(null, {
      headers: {
        "x-runtime-wake-accepted": "1",
        "x-runtime-wake-identity-checked": "1",
      },
      status: 204,
    }));
    await expect(wake).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
  });

  it("keeps active-operation identity rejection ahead of the stopped-shell short-circuit", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        runnerRequestStarted.resolve();
        return await runnerResponse.promise;
      }),
      platformRunning: false,
    });

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_active_op_platform_stopped"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    await runnerRequestStarted.promise;

    await expect(container.wakeRuntime({
      attemptId: "attempt_stale",
      leaseGeneration: "10",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });

    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(false);

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("does not trust an identity-blind accepted wake when the outer active-operation pointer is missing", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "1",
            },
            status: 204,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "container-rpc-error",
    });
  });

  it("treats a legacy identity-blind rejected wake as no active child when health reports idle", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "0",
            },
            status: 204,
          });
        }
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            ...createRunnerHealthResult(),
            activeJobCount: 0,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });
  });

  it("does not use the legacy health fallback when the wake response omits the accepted header", async () => {
    let healthCallCount = 0;
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            status: 204,
          });
        }
        if (url.endsWith("/health")) {
          healthCallCount += 1;
          return new Response(JSON.stringify({
            ...createRunnerHealthResult(),
            activeJobCount: 0,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    expect(healthCallCount).toBe(0);
  });

  it("keeps legacy active-count liveness authoritative when warmth metadata is absent", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "0",
            },
            status: 204,
          });
        }
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            activeJobCount: 1,
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
  });

  it("keeps a legacy identity-blind rejected wake unconfirmed when health is unavailable", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "0",
            },
            status: 204,
          });
        }
        if (url.endsWith("/health")) {
          throw new Error("health probe unavailable");
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
  });

  it("keeps a legacy identity-blind rejected wake unconfirmed when health omits active job count", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "0",
            },
            status: 204,
          });
        }
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            conversationWarmActivityCompletedAtEpochMs: null,
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
  });

  it("keeps a legacy identity-blind rejected wake unconfirmed when health is malformed", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "0",
            },
            status: 204,
          });
        }
        if (url.endsWith("/health")) {
          return new Response("not-json", {
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
  });

  it("keeps a legacy identity-blind rejected wake unconfirmed when health reports a nonnumeric active job count", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "0",
            },
            status: 204,
          });
        }
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            ...createRunnerHealthResult(),
            activeJobCount: "0",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
  });

  it("keeps a legacy identity-blind rejected wake unconfirmed when health reports a negative active job count", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-accepted": "0",
            },
            status: 204,
          });
        }
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            ...createRunnerHealthResult(),
            activeJobCount: -1,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected runner request URL: ${url}`);
      }),
    });

    await expect(container.wakeRuntime({
      attemptId: "attempt_lost_pointer",
      leaseGeneration: "12",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
  });

  it("ensureProcessing wakes the exact active child without starting a replacement", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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

    await expect(container.ensureProcessing({
      activeRuntime: {
        attemptId: "attempt_evt_123",
        leaseGeneration: "11",
        userId: "member_123",
      },
      userId: "member_123",
    })).resolves.toEqual({
      action: "woken",
      kind: "accepted",
    });

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());

    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls).toHaveLength(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("reports already_running when the active child records a pending wake", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
              "x-runtime-wake-pending": "1",
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

    await expect(container.ensureProcessing({
      activeRuntime: {
        attemptId: "attempt_evt_123",
        leaseGeneration: "11",
        userId: "member_123",
      },
      userId: "member_123",
    })).resolves.toEqual({
      action: "already_running",
      kind: "accepted",
    });

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("ensureProcessing starts work when no active child can be woken", async () => {
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (url.endsWith("/internal/runtime-wake")) {
          return new Response(null, {
            headers: {
              "x-runtime-wake-absent": "1",
              "x-runtime-wake-accepted": "0",
            },
            status: 204,
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

    await expect(container.ensureProcessing({
      activeRuntime: {
        attemptId: "attempt_missing",
        leaseGeneration: "11",
        userId: "member_123",
      },
      invoke: {
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_replacement"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      },
      userId: "member_123",
    })).resolves.toEqual({
      action: "restarted",
      kind: "accepted",
      result: createRunnerResult(),
    });

    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls).toHaveLength(1);
  });

  it("ensureProcessing treats runner shutdown rejection as replacement-required", async () => {
    const { container, containerFetch, destroy } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        return new Response(JSON.stringify({
          code: HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
          error: "Hosted runner is shutting down.",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 503,
        });
      }),
    });

    await expect(container.ensureProcessing({
      invoke: {
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_shutdown_replacement_required"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      },
      userId: "member_123",
    })).resolves.toEqual({
      kind: "start-required",
      reason: "no-active-child",
    });

    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls).toHaveLength(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("ensureReadyForProcessing starts and health-checks without invoking workspace work", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "started",
      kind: "ready",
    });

    expect(startAndWaitForPorts).toHaveBeenCalledOnce();
    const healthCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/health")
    );
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(healthCalls).toHaveLength(1);
    expect(executeCalls).toHaveLength(0);
  });

  it("starts the readiness deadline before lifecycle-lock admission", async () => {
    const firstDeadline = new AbortController();
    const queuedDeadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout")
      .mockImplementation((timeoutMs) =>
        timeoutMs === 1_000 ? queuedDeadline.signal : firstDeadline.signal
      );
    const firstHealthStarted = createDeferred<void>();
    const releaseFirstHealth = createDeferred<void>();
    let healthCalls = 0;
    const containerFetch = vi.fn(async (url: string) => {
      if (!url.endsWith("/health")) {
        throw new Error(`Unexpected runner request URL: ${url}`);
      }
      healthCalls += 1;
      firstHealthStarted.resolve(undefined);
      await releaseFirstHealth.promise;
      return new Response(JSON.stringify(createRunnerHealthResult()), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    const first = container.ensureReadyForProcessing({
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await firstHealthStarted.promise;
    const queued = container.ensureReadyForProcessing({
      timeoutMs: 1_000,
      userId: "member_123",
    });
    queuedDeadline.abort(new DOMException("Timed out", "TimeoutError"));

    await expect(queued).rejects.toMatchObject({ name: "TimeoutError" });
    expect(healthCalls).toBe(1);
    releaseFirstHealth.resolve(undefined);
    await expect(first).resolves.toMatchObject({ kind: "ready" });
    await Promise.resolve();
    expect(healthCalls).toBe(1);
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(timeout).toHaveBeenCalledWith(1_000);
    timeout.mockRestore();
  });

  it("waits for in-lock fail-closed cleanup after readiness aborts", async () => {
    const readinessDeadline = new AbortController();
    const originalAbortSignalTimeout = AbortSignal.timeout;
    const timeout = vi.spyOn(AbortSignal, "timeout")
      .mockImplementationOnce(() => readinessDeadline.signal)
      .mockImplementation((timeoutMs) => originalAbortSignalTimeout(timeoutMs));
    const startObserved = createDeferred<void>();
    const destroySettlement = createDeferred<void>();
    let status: "running" | "stopped" = "stopped";
    const startAndWaitForPorts = vi.fn(async (input: {
      cancellationOptions: { abort: AbortSignal };
    }) => {
      status = "running";
      startObserved.resolve(undefined);
      await new Promise<never>((_, reject) => {
        input.cancellationOptions.abort.addEventListener("abort", () => {
          reject(input.cancellationOptions.abort.reason);
        }, { once: true });
      });
    });
    const destroy = vi.fn(async () => {
      await destroySettlement.promise;
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const { container } = createContainerDouble({
      destroy,
      getState,
      initialStatus: "stopped",
      startAndWaitForPorts,
    });

    const readiness = container.ensureReadyForProcessing({
      timeoutMs: 15_000,
      userId: "member_123",
    });
    let settled = false;
    void readiness.finally(() => {
      settled = true;
    }).catch(() => undefined);
    await startObserved.promise;
    readinessDeadline.abort(new DOMException("Timed out", "TimeoutError"));
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    destroySettlement.resolve(undefined);
    await expect(readiness).rejects.toMatchObject({ name: "TimeoutError" });
    expect(settled).toBe(true);
    timeout.mockRestore();
  });

  it("reports unsettled warm-invalidated cleanup to readiness callers", async () => {
    const destroy = vi.fn(async () => {
      throw new Error("destroy failed");
    });
    const { container } = createContainerDouble({
      destroy,
      initialStatus: "running",
    });
    Object.assign(container, {
      warmShellInvalidatedByUnsettledDestroy: true,
    });

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 15_000,
      userId: "member_123",
    })).resolves.toEqual({ kind: "cleanup_unsettled" });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("reports unsettled warm-health-failure cleanup to readiness callers", async () => {
    const readinessDeadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout")
      .mockImplementation(() => readinessDeadline.signal);
    const healthObserved = createDeferred<void>();
    const destroy = vi.fn(async () => {
      throw new Error("destroy failed");
    });
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (!url.endsWith("/health")) {
          throw new Error(`Unexpected runner request URL: ${url}`);
        }
        healthObserved.resolve(undefined);
        return new Response(JSON.stringify({ error: "stale shell" }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 503,
        });
      }),
      destroy,
      initialStatus: "running",
    });

    try {
      const readiness = container.ensureReadyForProcessing({
        timeoutMs: 15_000,
        userId: "member_123",
      });
      await healthObserved.promise;
      readinessDeadline.abort(new DOMException("Timed out", "TimeoutError"));

      await expect(readiness).resolves.toEqual({ kind: "cleanup_unsettled" });
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      timeout.mockRestore();
    }
  });

  it("shares one cleanup deadline across a slow status read and destroy settlement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const readinessDeadline = new AbortController();
    const queuedReadinessDeadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout")
      .mockImplementationOnce(() => readinessDeadline.signal)
      .mockImplementation(() => queuedReadinessDeadline.signal);
    const startObserved = createDeferred<void>();
    const queuedHealthStarted = createDeferred<number>();
    let queuedHealthStartedAt: number | null = null;
    const cleanupStatus = createDeferred<{
      lastChange: number;
      status: "running";
    }>();
    let secondDestroyRequested = false;
    let stateReads = 0;
    const getState = vi.fn(() => {
      stateReads += 1;
      if (secondDestroyRequested) {
        return Promise.resolve({
          lastChange: Date.now(),
          status: "stopped" as const,
        });
      }
      if (stateReads === 1) {
        return Promise.resolve({
          lastChange: Date.now(),
          status: "stopped" as const,
        });
      }
      if (stateReads === 2) {
        return cleanupStatus.promise;
      }
      return Promise.resolve({
        lastChange: Date.now(),
        status: "running" as const,
      });
    });
    let startCalls = 0;
    const startAndWaitForPorts = vi.fn(async (input: {
      cancellationOptions: { abort: AbortSignal };
    }) => {
      startCalls += 1;
      if (startCalls > 1) {
        return;
      }
      startObserved.resolve(undefined);
      await new Promise<never>((_, reject) => {
        input.cancellationOptions.abort.addEventListener("abort", () => {
          reject(input.cancellationOptions.abort.reason);
        }, { once: true });
      });
    });
    let destroyCalls = 0;
    const destroy = vi.fn(() => {
      destroyCalls += 1;
      if (destroyCalls === 1) {
        return new Promise<void>(() => undefined);
      }
      secondDestroyRequested = true;
      return Promise.resolve();
    });
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (!url.endsWith("/health")) {
          throw new Error(`Unexpected runner request URL: ${url}`);
        }
        queuedHealthStartedAt = Date.now();
        queuedHealthStarted.resolve(queuedHealthStartedAt);
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }),
      destroy,
      getState,
      initialStatus: "stopped",
      startAndWaitForPorts,
    });

    try {
      const readiness = container.ensureReadyForProcessing({
        timeoutMs: 15_000,
        userId: "member_123",
      });
      await startObserved.promise;
      readinessDeadline.abort(new DOMException("Timed out", "TimeoutError"));
      await Promise.resolve();
      await Promise.resolve();
      expect(getState).toHaveBeenCalledTimes(2);
      const queuedReadiness = container.ensureReadyForProcessing({
        timeoutMs: 30_000,
        userId: "member_123",
      });
      let queuedReadinessSettled = false;
      void queuedReadiness.then(
        () => {
          queuedReadinessSettled = true;
        },
        () => {
          queuedReadinessSettled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(4_000);
      cleanupStatus.resolve({
        lastChange: Date.now(),
        status: "running",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(destroy).toHaveBeenCalledOnce();
      expect(queuedHealthStartedAt).toBeNull();
      expect(queuedReadinessSettled).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(readiness).resolves.toEqual({ kind: "cleanup_unsettled" });
      expect(Date.now()).toBe(Date.parse("2026-04-27T00:00:05.000Z"));
      await expect(queuedHealthStarted.promise).resolves.toBe(
        Date.parse("2026-04-27T00:00:05.000Z"),
      );
      await expect(queuedReadiness).resolves.toEqual({
        action: "started",
        kind: "ready",
      });
      expect(destroy).toHaveBeenCalledTimes(2);
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it("prewarmShell issues startup without waiting for ports or invoking workspace work", async () => {
    const neverSettlingStateRead = new Promise<never>(() => undefined);
    const getState = vi.fn(() => neverSettlingStateRead);
    const { container, containerFetch, start, startAndWaitForPorts } =
      createContainerDouble({ getState });

    await expect(container.prewarmShell({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "start_issued",
      kind: "started",
    });

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]?.[1]).toMatchObject({
      portToCheck: 8080,
      signal: expect.any(AbortSignal),
    });
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(containerFetch).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
  });

  it("prewarmShell delegates the already-running fast path to Container.start", async () => {
    const { container, getState, start, startAndWaitForPorts } =
      createContainerDouble({ initialStatus: "running" });

    await expect(container.prewarmShell({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "start_issued",
      kind: "started",
    });

    expect(start).toHaveBeenCalledOnce();
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
  });

  it("acknowledges repeated shell hints before startup and reports one causal observation", async () => {
    const releaseStart = createDeferred<void>();
    const start = vi.fn(async () => {
      await releaseStart.promise;
    });
    const { container, containerFetch, getState } = createContainerDouble({
      initialStatus: "running",
      start,
    });

    await expect(container.beginShellPrewarm({
      source: "linq-typing-started",
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({ accepted: true });
    await expect(container.beginShellPrewarm({
      source: "linq-typing-started",
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({ accepted: true });

    expect(start).toHaveBeenCalledOnce();
    expect(getState).not.toHaveBeenCalled();
    expect(containerFetch).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner shell prewarm operation completed.",
      }),
    );

    container.onStart();
    releaseStart.resolve(undefined);
    await vi.waitFor(() =>
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            shellPrewarmColdStartObserved: true,
            shellPrewarmHintCountAtCompletion: 2,
            shellPrewarmOutcome: "start_issued",
            shellPrewarmSource: "linq-typing-started",
          }),
          message: "Hosted runner shell prewarm operation completed.",
        }),
      )
    );

    await expect(container.beginShellPrewarm({
      source: "linq-typing-started",
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({ accepted: true });
    expect(start).toHaveBeenCalledOnce();

    const readiness = await container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    });
    expect(readiness).toMatchObject({
      action: "already_warm",
      kind: "ready",
      shellPrewarmObservation: {
        firstHintAtEpochMs: expect.any(Number),
        finishedAtEpochMs: expect.any(Number),
        hintCount: 3,
        operationElapsedMs: expect.any(Number),
        outcome: "cold_start_observed",
        source: "linq-typing-started",
      },
    });
    expect(JSON.stringify(readiness.shellPrewarmObservation))
      .not.toContain("member_123");

    const completionInputs = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .filter((input) =>
        input.message === "Hosted runner shell prewarm operation completed."
      );
    expect(completionInputs).toHaveLength(1);
    expect(JSON.stringify(
      completionInputs.map((input) => buildHostedExecutionStructuredLogRecord(input)),
    )).not.toContain("member_123");
  });

  it("reuses a completed shell prewarm through ordinary health readiness", async () => {
    const { container, start, startAndWaitForPorts } = createContainerDouble();

    await expect(container.prewarmShell({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "start_issued",
      kind: "started",
    });
    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "already_warm",
      kind: "ready",
    });

    expect(start).toHaveBeenCalledOnce();
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
  });

  it("finishes canonical readiness after an uncertain shell prewarm failure", async () => {
    const start = vi.fn(async () => {
      throw new Error("platform start wait failed after command issue");
    });
    const { container, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
      start,
    });

    await expect(container.beginShellPrewarm({
      source: "linq-typing-started",
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({ accepted: true });
    await vi.waitFor(() =>
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            shellPrewarmOutcome: "failed",
            shellPrewarmSource: "linq-typing-started",
          }),
          message: "Hosted runner shell prewarm failed after acceptance.",
        }),
      )
    );
    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toMatchObject({
      action: "started",
      kind: "ready",
      shellPrewarmObservation: {
        hintCount: 1,
        outcome: "failed",
        source: "linq-typing-started",
      },
    });

    expect(start).toHaveBeenCalledOnce();
    expect(startAndWaitForPorts).toHaveBeenCalledOnce();
  });

  it("lets authoritative readiness supersede a stalled shell prewarm", async () => {
    const startEntered = createDeferred<void>();
    const start = vi.fn(async (
      _startOptions: unknown,
      waitOptions?: { signal?: AbortSignal },
    ) => {
      const signal = waitOptions?.signal;
      if (!signal) {
        throw new Error("Expected shell prewarm to carry an abort signal.");
      }
      startEntered.resolve();
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
    const { container, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
      start,
    });

    const firstPrewarm = container.prewarmShell({
      timeoutMs: 20_000,
      userId: "member_123",
    });
    await startEntered.promise;
    const duplicatePrewarm = container.prewarmShell({
      timeoutMs: 20_000,
      userId: "member_123",
    });
    const authoritativeReadiness = container.ensureReadyForProcessing({
      timeoutMs: 8_000,
      userId: "member_123",
    });

    await expect(firstPrewarm).resolves.toEqual({
      action: "superseded",
      kind: "superseded",
    });
    await expect(duplicatePrewarm).resolves.toEqual({
      action: "superseded",
      kind: "superseded",
    });
    await expect(authoritativeReadiness).resolves.toEqual({
      action: "started",
      kind: "ready",
    });
    expect(start).toHaveBeenCalledOnce();
    expect(startAndWaitForPorts).toHaveBeenCalledOnce();
  });

  it("attributes a superseded accepted hint to the authoritative readiness trace", async () => {
    const startEntered = createDeferred<void>();
    const start = vi.fn(async (
      _startOptions: unknown,
      waitOptions?: { signal?: AbortSignal },
    ) => {
      const signal = waitOptions?.signal;
      if (!signal) {
        throw new Error("Expected shell prewarm to carry an abort signal.");
      }
      startEntered.resolve(undefined);
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
    const { container, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
      start,
    });

    await expect(container.beginShellPrewarm({
      source: "linq-typing-started",
      timeoutMs: 20_000,
      userId: "member_123",
    })).resolves.toEqual({ accepted: true });
    await startEntered.promise;

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 8_000,
      userId: "member_123",
    })).resolves.toMatchObject({
      action: "started",
      kind: "ready",
      shellPrewarmObservation: {
        hintCount: 1,
        outcome: "superseded",
        source: "linq-typing-started",
      },
    });
    expect(startAndWaitForPorts).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            shellPrewarmColdStartObserved: false,
            shellPrewarmOutcome: "superseded",
            shellPrewarmSource: "linq-typing-started",
          }),
        }),
      )
    );
  });

  it("acknowledges shell registration before exact-target destruction supersedes it", async () => {
    const startEntered = createDeferred<void>();
    const startAborted = createDeferred<void>();
    const start = vi.fn(async (
      _startOptions: unknown,
      waitOptions?: { signal?: AbortSignal },
    ) => {
      const signal = waitOptions?.signal;
      if (!signal) {
        throw new Error("Expected shell prewarm to carry an abort signal.");
      }
      startEntered.resolve();
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => {
          startAborted.resolve(undefined);
          reject(signal.reason);
        }, { once: true });
      });
    });
    const { container, destroy } = createContainerDouble({
      initialStatus: "running",
      start,
    });

    await expect(container.beginShellPrewarm({
      timeoutMs: 20_000,
      userId: "member_123",
    })).resolves.toEqual({ accepted: true });
    await startEntered.promise;
    const destruction = container.destroyInstance();

    await startAborted.promise;
    await expect(destruction).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("reuses immediate startup readiness proof for the following workspace invocation", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "started",
      kind: "ready",
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_startup_confirm"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    const healthCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/health")
    );
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(healthCalls).toHaveLength(1);
    expect(executeCalls).toHaveLength(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          readinessProofReused: true,
        }),
        message: "Hosted execution container is ready.",
        phase: "container.ready",
      }),
    );
  });

  it("keeps reused readiness-only proof available for the following workspace invocation", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "started",
      kind: "ready",
    });
    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "already_warm",
      kind: "ready",
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_reused_readiness_confirm"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    const healthCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/health")
    );
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(healthCalls).toHaveLength(1);
    expect(executeCalls).toHaveLength(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("clears reused readiness proof after a workspace invocation accepts it", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "started",
      kind: "ready",
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_startup_confirm"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "already_warm",
      kind: "ready",
    });

    const healthCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/health")
    );
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(healthCalls).toHaveLength(2);
    expect(executeCalls).toHaveLength(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("does not reuse readiness proof across users", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "started",
      kind: "ready",
    });

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_456",
    })).resolves.toEqual({
      action: "already_warm",
      kind: "ready",
    });

    const healthCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/health")
    );
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(healthCalls).toHaveLength(2);
    expect(executeCalls).toHaveLength(0);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("falls back to warm health when startup readiness proof is stale", async () => {
    let nowMs = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    try {
      const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

      await expect(container.ensureReadyForProcessing({
        timeoutMs: 7_500,
        userId: "member_123",
      })).resolves.toEqual({
        action: "started",
        kind: "ready",
      });

      nowMs += 5_001;
      await expect(container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_after_stale_startup_confirm"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      })).resolves.toEqual(createRunnerResult());

      const healthCalls = containerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/health")
      );
      const executeCalls = containerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/internal/workspace-invocation")
      );
      expect(healthCalls).toHaveLength(2);
      expect(executeCalls).toHaveLength(1);
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("measures readiness proof age after container state is read", async () => {
    let currentStatus = "stopped";
    let nowMs = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    try {
      const getState = vi.fn(async () => {
        if (getState.mock.calls.length === 2) {
          nowMs += 5_001;
        }
        return {
          lastChange: nowMs,
          status: currentStatus,
        };
      });
      const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
        getState,
        startAndWaitForPorts: vi.fn(async () => {
          currentStatus = "running";
        }),
      });

      await expect(container.ensureReadyForProcessing({
        timeoutMs: 7_500,
        userId: "member_123",
      })).resolves.toEqual({
        action: "started",
        kind: "ready",
      });

      await expect(container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_after_slow_state_read"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      })).resolves.toEqual(createRunnerResult());

      const healthCalls = containerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/health")
      );
      const executeCalls = containerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/internal/workspace-invocation")
      );
      expect(healthCalls).toHaveLength(2);
      expect(executeCalls).toHaveLength(1);
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("does not reuse readiness proof for transitional container status", async () => {
    let currentStatus = "stopped";
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
      getState: vi.fn(async () => ({
        lastChange: Date.now(),
        status: currentStatus,
      })),
      startAndWaitForPorts: vi.fn(async () => {
        currentStatus = "running";
      }),
    });

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "started",
      kind: "ready",
    });

    currentStatus = "stopping";
    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_transitional_status"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    const healthCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/health")
    );
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(healthCalls).toHaveLength(2);
    expect(executeCalls).toHaveLength(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("falls back to warm health after lifecycle error clears startup readiness proof", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "started",
      kind: "ready",
    });

    expect(() => container.onError(new Error("synthetic lifecycle failure"))).toThrow(
      "synthetic lifecycle failure",
    );

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_lifecycle_error"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    const healthCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/health")
    );
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(healthCalls).toHaveLength(2);
    expect(executeCalls).toHaveLength(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("falls back to warm health after a container stop invalidates startup readiness proof", async () => {
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble();

    await expect(container.ensureReadyForProcessing({
      timeoutMs: 7_500,
      userId: "member_123",
    })).resolves.toEqual({
      action: "started",
      kind: "ready",
    });

    container.onStop({ exitCode: 0, reason: "exit" });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_container_stop"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    const healthCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/health")
    );
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(healthCalls).toHaveLength(2);
    expect(executeCalls).toHaveLength(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
  });

  it("ensureProcessing rejects mismatched user identities before waking or starting work", async () => {
    const { container, containerFetch } = createContainerDouble();

    await expect(container.ensureProcessing({
      activeRuntime: {
        attemptId: "attempt_evt_123",
        leaseGeneration: "11",
        userId: "member_other",
      },
      userId: "member_123",
    })).rejects.toThrow(/activeRuntime userId must match input userId/u);

    await expect(container.ensureProcessing({
      invoke: {
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_replacement"),
        },
        timeoutMs: 60_000,
        userId: "member_other",
      },
      userId: "member_123",
    })).rejects.toThrow(/invoke userId must match input userId/u);

    await expect(container.ensureProcessing({
      invoke: {
        job: {
          kind: "workspace-invocation",
          request: {
            ...createRunnerRequest("evt_replacement"),
            userId: "member_other",
          },
        },
        timeoutMs: 60_000,
        userId: "member_123",
      },
      userId: "member_123",
    })).rejects.toThrow(/job userId must match input userId/u);

    expect(containerFetch).not.toHaveBeenCalled();
  });

  it("does not wake a runtime child whose attempt or generation differs from the requested fence", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
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

    await expect(container.wakeRuntime({
      attemptId: "attempt_stale",
      leaseGeneration: "10",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });

    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(false);

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("drains non-empty runtime wake responses before returning", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const wakeResponse = new Response(JSON.stringify({ accepted: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-runtime-wake-accepted": "1",
      },
      status: 202,
    });
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/runtime-wake")) {
          return wakeResponse;
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

    await expect(container.wakeRuntime({
      attemptId: "attempt_evt_123",
      leaseGeneration: "11",
      userId: "member_123",
    })).resolves.toEqual({
      action: "woken",
      kind: "accepted",
    });
    expect(wakeResponse.bodyUsed).toBe(true);

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("does not accept legacy runtime wake body shape without hard-cut headers", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const wakeResponse = new Response(JSON.stringify({ accepted: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 202,
    });
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/runtime-wake")) {
          return wakeResponse;
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

    await expect(container.wakeRuntime({
      attemptId: "attempt_evt_123",
      leaseGeneration: "11",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    expect(wakeResponse.bodyUsed).toBe(true);

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    await expect(invocation).resolves.toEqual(createRunnerResult());
  });

  it("rejects runtime wakes when metadata response draining times out", async () => {
    vi.useFakeTimers();

    try {
      const runnerRequestStarted = createDeferred<void>();
      const runnerResponse = createDeferred<Response>();
      const wakeResponse = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("pending"));
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-runtime-wake-accepted": "1",
        },
        status: 202,
      });
      const { container } = createContainerDouble({
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            return new Response(JSON.stringify(createRunnerHealthResult()), {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            });
          }

          if (url.endsWith("/internal/runtime-wake")) {
            return wakeResponse;
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

      const wake = container.wakeRuntime({
        attemptId: "attempt_evt_123",
        leaseGeneration: "11",
        userId: "member_123",
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(wake).resolves.toEqual({
        kind: "unknown",
        reason: "container-rpc-timeout",
      });

      runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }));

      await expect(invocation).resolves.toEqual(createRunnerResult());
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a managed shell for deploy smoke health and stops it afterward", async () => {
    const { container, containerFetch, destroy, startAndWaitForPorts } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
          return new Response(JSON.stringify({
            codexShell: createCodexShellSmokeResult(),
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        expect(url).toBe("http://container/health");
        return new Response(JSON.stringify({
          hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
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
      codexShell: createCodexShellSmokeResult(),
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
    expect(containerFetch).toHaveBeenCalledTimes(2);
    expect(container.envVars).toEqual(EXPECTED_RUNNER_CONTAINER_ENV);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("can extend deploy smoke to run a direct R2 presigned PUT probe", async () => {
    const presignedPutUrl =
      "https://example-account.r2.cloudflarestorage.com/test-bucket/snapshot.enc?X-Amz-Signature=test";
    const { container, containerFetch } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
            service: "cloudflare-hosted-runner-node",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
          return new Response(JSON.stringify({
            codexShell: createCodexShellSmokeResult(),
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        expect(url).toBe("http://container/internal/direct-r2-presigned-put-smoke");
        return new Response(JSON.stringify({
          directR2PresignedPut: {
            byteLength: 4096,
            durationMs: 8,
            ok: true,
            payloadSha256: "b".repeat(64),
            responseBodyBytes: 2,
            status: 200,
          },
          ok: true,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }),
    });

    const result = await container.smokeHealth({
      directR2PresignedPut: {
        byteLength: 4096,
        presignedPutUrl,
      },
    });

    expect(result.directR2PresignedPut).toEqual({
      byteLength: 4096,
      durationMs: 8,
      ok: true,
      payloadSha256: "b".repeat(64),
      responseBodyBytes: 2,
      status: 200,
    });
    expect(result.codexShell).toEqual(createCodexShellSmokeResult());
    expect(containerFetch).toHaveBeenCalledTimes(3);
    const smokeCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/direct-r2-presigned-put-smoke")
    );
    expect(JSON.parse(smokeCall?.[1]?.body as string)).toEqual({
      byteLength: 4096,
      presignedPutUrl,
    });
  });

  it("can extend deploy smoke to run a live model turn probe behind the egress fence", async () => {
    let fenceActiveDuringTurn: boolean | null = null;
    let secondFenceReadDuringTurn: { active: boolean; model?: string } | null = null;
    let containerRef: DeploySmokeRunnerContainer | null = null;
    const { container, containerFetch } = createDeploySmokeContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
            service: "cloudflare-hosted-runner-node",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
          return new Response(JSON.stringify({
            codexShell: createCodexShellSmokeResult(),
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        expect(url).toBe("http://container/internal/deploy-live-model-turn-smoke");
        const firstFenceRead = await containerRef?.readDeploySmokeLiveModelTurnFence();
        fenceActiveDuringTurn = firstFenceRead?.active ?? null;
        expect(firstFenceRead).toEqual({
          active: true,
          model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
        });
        secondFenceReadDuringTurn = await containerRef?.readDeploySmokeLiveModelTurnFence() ?? null;
        return new Response(JSON.stringify({
          liveModelTurn: {
            durationMs: 1_234,
            model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
            stdoutBytes: 2_048,
          },
          ok: true,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }),
      env: {
        OPENAI_API_KEY: "openai-worker-secret",
      },
    });
    containerRef = container;

    await expect(container.readDeploySmokeLiveModelTurnFence()).resolves.toEqual({
      active: false,
    });

    const result = await container.smokeHealth({
      liveModelTurn: {
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
      },
    });

    expect(result.liveModelTurn).toEqual({
      durationMs: 1_234,
      egressGrantConsumed: true,
      model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
      stdoutBytes: 2_048,
    });
    expect(result.codexShell).toEqual(createCodexShellSmokeResult());
    expect(fenceActiveDuringTurn).toBe(true);
    expect(secondFenceReadDuringTurn).toEqual({
      active: false,
    });
    await expect(container.readDeploySmokeLiveModelTurnFence()).resolves.toEqual({
      active: false,
    });
    expect(containerFetch).toHaveBeenCalledTimes(3);
    const smokeCall = containerFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/internal/deploy-live-model-turn-smoke")
    );
    expect(smokeCall?.[1]?.body).toBeUndefined();
  });

  it("fails a live model turn smoke that does not consume the egress fence", async () => {
    const { container } = createDeploySmokeContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
            service: "cloudflare-hosted-runner-node",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
          return new Response(JSON.stringify({
            codexShell: createCodexShellSmokeResult(),
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-live-model-turn-smoke")) {
          return new Response(JSON.stringify({
            liveModelTurn: {
              durationMs: 1_234,
              model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
              stdoutBytes: 2_048,
            },
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected deploy smoke URL: ${url}`);
      }),
      env: {
        OPENAI_API_KEY: "openai-worker-secret",
      },
    });

    const error = await container.smokeHealth({
      liveModelTurn: {
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Hosted runner container live model turn smoke did not consume the Worker egress grant.",
    );
    await expect(container.readDeploySmokeLiveModelTurnFence()).resolves.toEqual({
      active: false,
    });
  });

  it("skips the live model turn smoke entirely when the input flag is absent", async () => {
    const { container, containerFetch } = createContainerDouble({
      env: {
        OPENAI_API_KEY: "openai-worker-secret",
      },
    });

    const result = await container.smokeHealth();

    expect(result.liveModelTurn).toBeUndefined();
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/deploy-live-model-turn-smoke")
    )).toBe(false);
  });

  it("forwards content-free live model turn smoke diagnostics from the container", async () => {
    const { container, destroy } = createDeploySmokeContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
            service: "cloudflare-hosted-runner-node",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
          return new Response(JSON.stringify({
            codexShell: createCodexShellSmokeResult(),
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-live-model-turn-smoke")) {
          return new Response(JSON.stringify({
            error: "Hosted live model turn smoke failed.",
            ok: false,
            smokeErrorMessage:
              "Hosted live model turn smoke codex exec exited with 1. stdoutBytes=0 stderrExcerpt=\"insufficient_quota\"",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 500,
          });
        }

        throw new Error(`Unexpected deploy smoke URL: ${url}`);
      }),
      env: {
        OPENAI_API_KEY: "openai-worker-secret",
      },
    });

    const error = await container.smokeHealth({
      liveModelTurn: {
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Hosted runner container live model turn smoke failed with HTTP 500. "
        + "Hosted live model turn smoke codex exec exited with 1. stdoutBytes=0 stderrExcerpt=\"insufficient_quota\"",
    );
    await expect(container.readDeploySmokeLiveModelTurnFence()).resolves.toEqual({
      active: false,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("fails the live model turn smoke before contacting the container when OPENAI_API_KEY is missing", async () => {
    const { container, containerFetch } = createDeploySmokeContainerDouble();

    const error = await container.smokeHealth({
      liveModelTurn: {
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Hosted runner live model turn smoke requires the OPENAI_API_KEY Worker secret.",
    );
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/deploy-live-model-turn-smoke")
    )).toBe(false);
  });

  it.each([
    {
      label: "health",
      failingUrlSuffix: "/health",
      smokeInput: {},
    },
    {
      label: "Codex shell",
      failingUrlSuffix: "/internal/deploy-codex-shell-smoke",
      smokeInput: {},
    },
    {
      label: "direct R2",
      failingUrlSuffix: "/internal/direct-r2-presigned-put-smoke",
      smokeInput: {
        directR2PresignedPut: {
          byteLength: 4096,
          presignedPutUrl:
            "https://example-account.r2.cloudflarestorage.com/test-bucket/snapshot.enc?X-Amz-Signature=sensitive-signature",
        },
      },
    },
  ])("reports non-JSON deploy smoke $label responses as sanitized metadata errors", async ({
    failingUrlSuffix,
    smokeInput,
  }) => {
    const sensitiveBody = "Failed with sensitive-signature and private diagnostic text";
    const { container, destroy } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith(failingUrlSuffix)) {
          return new Response(sensitiveBody, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
            status: 503,
          });
        }

        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
            service: "cloudflare-hosted-runner-node",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
          return new Response(JSON.stringify({
            codexShell: createCodexShellSmokeResult(),
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected deploy smoke URL: ${url}`);
      }),
    });

    const error = await container.smokeHealth(smokeInput).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      details: expect.objectContaining({
        errorStatus: 503,
        responseBodyPreviewOmitted: true,
        responseContentType: "text/plain",
        responseJsonParseFailed: true,
        responseStatus: 503,
      }),
      message: "Hosted runner container returned HTTP 503 with non-JSON metadata response.",
      name: "HostedRunnerContainerMetadataResponseError",
      statusCode: 503,
    });
    expect(JSON.stringify(error)).not.toContain("sensitive-signature");
    expect(JSON.stringify(error)).not.toContain("private diagnostic text");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("forwards content-free Codex shell smoke diagnostics from the container", async () => {
    const { container, destroy } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
            service: "cloudflare-hosted-runner-node",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
          return new Response(JSON.stringify({
            error: "Hosted Codex shell smoke failed.",
            ok: false,
            smokeErrorMessage:
              "Hosted Codex shell smoke assistant CLI surface contract was missing hot-path schemas. proofCount=1",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 500,
          });
        }

        throw new Error(`Unexpected deploy smoke URL: ${url}`);
      }),
    });

    const error = await container.smokeHealth().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Hosted runner container Codex shell smoke failed with HTTP 500. "
        + "Hosted Codex shell smoke assistant CLI surface contract was missing hot-path schemas. proofCount=1",
    );
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

  it("does not run deploy smoke cleanup when pre-smoke recycle never settles", async () => {
    vi.useFakeTimers();

    try {
      const destroy = vi.fn(async () => {});
      const getState = vi.fn(async () => ({
        lastChange: Date.now(),
        status: "running",
      }));
      const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const smokeResult = container.smokeHealth().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);

      await expect(smokeResult).resolves.toMatchObject({
        message: "Hosted runner container smoke could not recycle the existing shell.",
      });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(startAndWaitForPorts).not.toHaveBeenCalled();
      expect(containerFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still attempts deploy smoke cleanup when pre-smoke recycle fails before destroy is requested", async () => {
    vi.useFakeTimers();

    try {
      let status: "running" | "stopped" = "running";
      let statusReadCount = 0;
      const destroy = vi.fn(async () => {
        status = "stopped";
      });
      const getState = vi.fn(async () => {
        statusReadCount += 1;
        if (statusReadCount === 1) {
          await new Promise<void>(() => undefined);
        }

        return {
          lastChange: Date.now(),
          status,
        };
      });
      const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const smokeResult = container.smokeHealth().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);

      await expect(smokeResult).resolves.toMatchObject({
        message: "Hosted runner container smoke could not recycle the existing shell.",
      });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(startAndWaitForPorts).not.toHaveBeenCalled();
      expect(containerFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not duplicate destroy when retry fails while prior recycle destroy is unsettled", async () => {
    vi.useFakeTimers();

    try {
      let hangNextStatusRead = false;
      const destroy = vi.fn(async () => {});
      const getState = vi.fn(async () => {
        if (hangNextStatusRead) {
          await new Promise<void>(() => undefined);
        }

        return {
          lastChange: Date.now(),
          status: "running",
        };
      });
      const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const firstSmokeResult = container.smokeHealth().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);
      await expect(firstSmokeResult).resolves.toMatchObject({
        message: "Hosted runner container smoke could not recycle the existing shell.",
      });
      expect(destroy).toHaveBeenCalledTimes(1);

      hangNextStatusRead = true;
      const secondSmokeResult = container.smokeHealth().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);

      await expect(secondSmokeResult).resolves.toMatchObject({
        message: "Hosted runner container smoke could not recycle the existing shell.",
      });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(startAndWaitForPorts).not.toHaveBeenCalled();
      expect(containerFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cold-starts deploy smoke after recycle even when status still reports running", async () => {
    let containerRef: RunnerContainer | null = null;
    const destroy = vi.fn(async () => {
      containerRef?.onStop({ exitCode: 137, reason: "runtime_signal" });
    });
    let healthChecks = 0;
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status: "running",
    }));
    const { container, containerFetch, startAndWaitForPorts } = createContainerDouble({
      destroy,
      getState,
      initialStatus: "running",
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          healthChecks += 1;
          return new Response(JSON.stringify({
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
            runnerBundle: {
              buildSkipped: false,
              bundleFingerprint: "bundle-fingerprint",
              sourceFingerprint: "source-fingerprint",
            },
            service: "cloudflare-hosted-runner-node",
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
          return new Response(JSON.stringify({
            codexShell: createCodexShellSmokeResult(),
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        throw new Error(`Unexpected deploy smoke URL: ${url}`);
      }),
    });
    containerRef = container;

    await expect(container.smokeHealth()).resolves.toMatchObject({
      ok: true,
      runnerBundle: {
        bundleFingerprint: "bundle-fingerprint",
        sourceFingerprint: "source-fingerprint",
      },
    });

    expect(destroy).toHaveBeenCalledTimes(2);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(healthChecks).toBe(1);
    expect(containerFetch).toHaveBeenCalledTimes(2);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          lifecycleStage: "destroyed",
          settleReason: "onStop",
          stopObservedAfterDestroy: true,
        }),
        message: "Hosted execution container destroy completed.",
        phase: "container.ready",
      }),
    );
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
      hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    });
  });

  it("sends only the callback runtime request payload to the child runner", async () => {
    let observedTopLevelKeys: string[] = [];
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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

    expect(observedTopLevelKeys).toEqual([
      "hostedRuntimeArchitectureVersion",
      "job",
    ]);
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
          details: expect.objectContaining({
            activeWorkspaceInvocationPresent: false,
            containerStartObservedBy: "cold-start-ready",
            containerUptimeMs: 421_000,
            destroyRequestPresent: false,
            idleTtlDeltaMs: 121_000,
            lastActivityExpiryAgeMs: 0,
            lifecycleStage: "activity-expired-cleanup",
            runnerIdleTtlMs: 300_000,
          }),
          message: "Hosted execution container activity expired; running cleanup.",
          phase: "container.ready",
        }),
      );
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            destroyRequestFailClosed: false,
            destroyRequestPresent: true,
            destroyRequestReason: "activity-expired",
            destroyRequestStatusBeforeDestroy: "running",
            failClosed: false,
            lifecycleStage: "destroy-requested",
          }),
          message: "Hosted execution container destroy requested.",
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
        "x-dispatch-container-ensure-ready-started-at-ms": expect.stringMatching(/^\d+$/),
        "x-dispatch-invoke-received-at-ms": expect.stringMatching(/^\d+$/),
      });
      expect(executeCalls[1]?.[1]?.headers).toEqual({
        "content-type": "application/json; charset=utf-8",
        "x-dispatch-container-ensure-ready-started-at-ms": expect.stringMatching(/^\d+$/),
        "x-dispatch-invoke-received-at-ms": expect.stringMatching(/^\d+$/),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records activity-expiry diagnostics while yielding to active workspace work", async () => {
    vi.useFakeTimers();

    try {
      const renewActivityTimeout = vi.fn();
      const { container, destroy } = createContainerDouble({
        initialStatus: "running",
      });

      vi.setSystemTime(new Date("2026-06-04T04:10:00.000Z"));
      container.onStart();
      Object.assign(container, {
        renewActivityTimeout,
        workspaceInvocationOperations: [{
          attemptId: "attempt_evt_activity_expiry_active",
          leaseGeneration: "11",
          processingMode: "default",
          userId: "member_123",
        }],
      });
      vi.clearAllMocks();

      vi.setSystemTime(new Date("2026-06-04T04:13:45.000Z"));
      await container.onActivityExpired();

      expect(destroy).not.toHaveBeenCalled();
      expect(renewActivityTimeout).toHaveBeenCalledOnce();
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            activeOperationKind: "workspace-invocation",
            activeWorkspaceInvocationPresent: true,
            containerStartObservedBy: "onStart",
            containerUptimeMs: 225_000,
            destroyRequestPresent: false,
            idleTtlDeltaMs: -75_000,
            lastActivityExpiryAgeMs: 0,
            lifecycleStage: "activity-expired-active-operation",
            runnerIdleTtlMs: 300_000,
            workspaceAttemptId: "attempt_evt_activity_expiry_active",
          }),
          message: "Hosted execution container activity expiry yielded to active runner operation.",
          phase: "container.ready",
          userId: "member_123",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews and keeps the warm shell when activity expiry fires before idle TTL", async () => {
    vi.useFakeTimers();

    try {
      const renewActivityTimeout = vi.fn();
      const { container, containerFetch, destroy, startAndWaitForPorts } =
        createContainerDouble();
      Object.assign(container, {
        renewActivityTimeout,
      });

      vi.setSystemTime(new Date("2026-06-04T03:56:40.000Z"));
      await container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_recent_activity_first"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
      renewActivityTimeout.mockClear();

      vi.setSystemTime(new Date("2026-06-04T03:56:42.000Z"));
      await container.onActivityExpired();
      expect(destroy).not.toHaveBeenCalled();
      expect(renewActivityTimeout).toHaveBeenCalledTimes(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            activeWorkspaceInvocationPresent: false,
            idleTtlDeltaMs: -298_000,
            lifecycleStage: "activity-expired-early-renew",
            runnerIdleTtlMs: 300_000,
          }),
          message:
            "Hosted execution container activity expiry arrived before the idle TTL elapsed; renewing.",
          phase: "container.ready",
        }),
      );

      await container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_recent_activity_second"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
      const executeCalls = containerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/internal/workspace-invocation")
      );
      expect(executeCalls[0]?.[1]?.headers).toEqual({
        "content-type": "application/json; charset=utf-8",
        "x-dispatch-container-ensure-ready-started-at-ms": expect.stringMatching(/^\d+$/),
        "x-dispatch-invoke-received-at-ms": expect.stringMatching(/^\d+$/),
      });
      expect(executeCalls[1]?.[1]?.headers).toEqual({
        "content-type": "application/json; charset=utf-8",
        "x-dispatch-container-ensure-ready-started-at-ms": expect.stringMatching(/^\d+$/),
        "x-dispatch-invoke-received-at-ms": expect.stringMatching(/^\d+$/),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up when early activity-expiry renewal throws", async () => {
    vi.useFakeTimers();

    try {
      const renewActivityTimeout = vi.fn();
      const { container, destroy } = createContainerDouble();
      Object.assign(container, {
        renewActivityTimeout,
      });

      vi.setSystemTime(new Date("2026-06-04T03:56:40.000Z"));
      await container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_recent_activity_before_throw"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });

      renewActivityTimeout.mockImplementation(() => {
        throw new Error("activity timeout renewal failed");
      });
      vi.clearAllMocks();

      vi.setSystemTime(new Date("2026-06-04T03:56:42.000Z"));
      await container.onActivityExpired();

      expect(renewActivityTimeout).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            activityStage: "activity-expired-early-renew",
          }),
          level: "warn",
          message: "Hosted execution container failed to renew activity timeout.",
          phase: "container.ready",
        }),
      );
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            idleTtlDeltaMs: -298_000,
            lifecycleStage: "activity-expired-cleanup",
            runnerIdleTtlMs: 300_000,
          }),
          message: "Hosted execution container activity expired; running cleanup.",
          phase: "container.ready",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
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
          HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1200000",
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "1000",
        },
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            return new Response(JSON.stringify(createRunnerHealthResult()), {
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
        return new Response(JSON.stringify(createRunnerHealthResult()), {
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
          stopClassification: "active-operation-clean-stop",
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

  it("classifies unrequested non-zero stops near the idle TTL", () => {
    vi.useFakeTimers();

    try {
      const { container } = createContainerDouble();
      vi.setSystemTime(new Date("2026-06-04T03:51:50.000Z"));
      container.onStart();
      vi.clearAllMocks();

      vi.setSystemTime(new Date("2026-06-04T03:56:42.000Z"));
      container.onStop({ exitCode: 1, reason: "exit" });

      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            containerStartObservedBy: "onStart",
            containerUptimeMs: 292_000,
            destroyRequestPresent: false,
            exitCode: 1,
            idleTtlDeltaMs: -8_000,
            lifecycleStage: "onStop",
            runnerIdleTtlMs: 300_000,
            sleepAfter: "300s",
            stopClassification: "unrequested-near-idle-ttl-nonzero-stop",
            stopReason: "exit",
          }),
          level: "warn",
          message: "Hosted execution container lifecycle hook reported non-zero stop.",
          phase: "failed",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies unrequested stops from last activity instead of process uptime", async () => {
    vi.useFakeTimers();

    try {
      const renewActivityTimeout = vi.fn();
      const { container } = createContainerDouble({
        initialStatus: "running",
      });
      Object.assign(container, {
        renewActivityTimeout,
      });
      vi.setSystemTime(new Date("2026-06-04T03:51:50.000Z"));
      container.onStart();
      vi.clearAllMocks();

      vi.setSystemTime(new Date("2026-06-04T03:56:40.000Z"));
      await container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_recent_activity"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });
      expect(renewActivityTimeout).toHaveBeenCalled();
      vi.clearAllMocks();

      vi.setSystemTime(new Date("2026-06-04T03:56:42.000Z"));
      container.onStop({ exitCode: 1, reason: "exit" });

      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            containerUptimeMs: 292_000,
            idleTtlDeltaMs: -298_000,
            lastActivityObservedAgeMs: 2_000,
            lastActivityObservedStage: "invoke-finished",
            lifecycleStage: "onStop",
            stopClassification: "unrequested-nonzero-stop",
          }),
          level: "warn",
          message: "Hosted execution container lifecycle hook reported non-zero stop.",
          phase: "failed",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("records explicit destroy requests in stop diagnostics", async () => {
    vi.useFakeTimers();

    try {
      let containerRef: RunnerContainer | null = null;
      const destroy = vi.fn(async () => {
        containerRef?.onStop({ exitCode: 137, reason: "runtime_signal" });
      });
      const { container } = createContainerDouble({
        destroy,
        initialStatus: "running",
      });
      containerRef = container;

      vi.setSystemTime(new Date("2026-06-04T04:00:00.000Z"));
      container.onStart();
      vi.clearAllMocks();

      vi.setSystemTime(new Date("2026-06-04T04:00:10.000Z"));
      await container.destroyInstance();

      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            containerUptimeMs: 10_000,
            destroyRequestFailClosed: true,
            destroyRequestPresent: true,
            destroyRequestReason: "destroy-instance",
            destroyRequestStatusBeforeDestroy: "running",
            exitCode: 137,
            lifecycleStage: "onStop",
            stopClassification: "requested-nonzero-stop",
          }),
          level: "warn",
          message: "Hosted execution container lifecycle hook reported non-zero stop.",
          phase: "failed",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
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
        return new Response(JSON.stringify(createRunnerHealthResult()), {
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
    vi.useFakeTimers();

    try {
      let currentStatus: "running" | "stopped" | "stopped_with_code" = "stopped";
      let markRunnerRequestStarted!: () => void;
      const runnerRequestStarted = new Promise<void>((resolve) => {
        markRunnerRequestStarted = resolve;
      });
      const hangingRunnerResponse = new Promise<Response>(() => undefined);
      const containerFetch = vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
      const assertion = expect(invocation).rejects.toThrow("workspace invocation container stopped");
      await runnerRequestStarted;
      currentStatus = "stopped_with_code";
      await vi.advanceTimersByTimeAsync(1_500);

      await assertion;
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a runner response that arrives just after lifecycle status becomes stopped", async () => {
    vi.useFakeTimers();

    try {
      let currentStatus: "running" | "stopped" | "stopped_with_code" = "stopped";
      let markRunnerRequestStarted!: () => void;
      const runnerRequestStarted = new Promise<void>((resolve) => {
        markRunnerRequestStarted = resolve;
      });
      const runnerResponse = createDeferred<Response>();
      const containerFetch = vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        markRunnerRequestStarted();
        return await runnerResponse.promise;
      });
      const getState = vi.fn(async () => ({
        lastChange: Date.now(),
        status: currentStatus,
      }));
      const startAndWaitForPorts = vi.fn(async () => {
        currentStatus = "running";
      });
      const { container } = createContainerDouble({
        containerFetch,
        getState,
        startAndWaitForPorts,
      });

      const invocation = container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_container_status_stop_response_race"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });
      const assertion = expect(invocation).resolves.toEqual(createRunnerResult());
      await runnerRequestStarted;

      currentStatus = "stopped_with_code";
      setTimeout(() => {
        runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        }));
      }, 251);
      await vi.advanceTimersByTimeAsync(251);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails active workspace invocations when lifecycle status reports a missing shell", async () => {
    vi.useFakeTimers();

    try {
      let currentStatus: "running" | "stopped" = "stopped";
      let statusMissing = false;
      let markRunnerRequestStarted!: () => void;
      const runnerRequestStarted = new Promise<void>((resolve) => {
        markRunnerRequestStarted = resolve;
      });
      const hangingRunnerResponse = new Promise<Response>(() => undefined);
      const containerFetch = vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
      const assertion = expect(invocation).rejects.toThrow("workspace invocation container stopped");
      await runnerRequestStarted;
      statusMissing = true;
      await vi.advanceTimersByTimeAsync(1_500);

      await assertion;
      expect(destroy).not.toHaveBeenCalled();
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
        return new Response(JSON.stringify(createRunnerHealthResult()), {
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
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("accepted");

    await expect(invokeResultPromise).resolves.toMatchObject({
      message: "workspace invocation preempted",
    });
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a warm shell after preempting an active workspace invocation", async () => {
    const runnerRequestSignal = createDeferred<AbortSignal>();
    const destroyStarted = createDeferred<void>();
    const allowDestroyToSettle = createDeferred<void>();
    let status: "running" | "stopped" = "running";
    let executeCallCount = 0;
    const destroy = vi.fn(async () => {
      destroyStarted.resolve();
      await allowDestroyToSettle.promise;
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const containerFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (url.endsWith("/internal/workspace-invocation/abort")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          attemptId: request.attemptId,
          leaseGeneration: request.leaseGeneration,
          userId: "member_123",
        });
        return new Response(null, { status: 204 });
      }

      if (!url.endsWith("/internal/workspace-invocation")) {
        throw new Error(`Unexpected runner request URL: ${url}`);
      }

      executeCallCount += 1;
      if (executeCallCount > 1) {
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Expected active invocation request to receive an abort signal.");
      }
      runnerRequestSignal.resolve(signal);
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error("workspace invocation request aborted"));
        }, { once: true });
      });
    });
    const { container, startAndWaitForPorts } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_preempt_active_warm_shell");
    const invokeResultPromise = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    const signal = await runnerRequestSignal.promise;
    expect(signal.aborted).toBe(false);
    const queuedInvokeResults = [
      "evt_first_queued_behind_preempted_warm_shell",
      "evt_second_queued_behind_preempted_warm_shell",
    ].map((eventId) =>
      container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest(eventId),
        },
        timeoutMs: 30_000,
        userId: "member_123",
      }).catch((error: unknown) => error)
    );
    let abortSettled = false;
    const abortResult = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    void abortResult.then(
      () => {
        abortSettled = true;
      },
      () => {
        abortSettled = true;
      },
    );

    await destroyStarted.promise;
    expect(abortSettled).toBe(false);
    allowDestroyToSettle.resolve();
    await expect(abortResult).resolves.toBe("accepted");

    const replacementResult = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_immediate_foreground_replacement"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await expect(invokeResultPromise).resolves.toMatchObject({
      message: "workspace invocation preempted",
    });
    for (const queuedInvokeResult of queuedInvokeResults) {
      await expect(queuedInvokeResult).resolves.toMatchObject({
        message: "workspace invocation preempted",
      });
    }
    await expect(replacementResult).resolves.toEqual(createRunnerResult());
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/workspace-invocation/abort")
    )).toBe(true);
    expect(containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    )).toHaveLength(2);
    expect(startAndWaitForPorts).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent exact aborts until their child request settles", async () => {
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    const abortRequestStarted = createDeferred<void>();
    const abortResponse = createDeferred<Response>();
    const recordRuntimeCompletionFromContainer = vi.fn(async () => ({
      completed: true,
    }));
    let executeCallCount = 0;
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        abortRequestStarted.resolve(undefined);
        return await abortResponse.promise;
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        executeCallCount += 1;
        if (executeCallCount === 1) {
          runnerRequestStarted.resolve(undefined);
          return await runnerResponse.promise;
        }
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      env: {
        USER_RUNNER: {
          getByName: vi.fn(() => ({ recordRuntimeCompletionFromContainer })),
        },
      },
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_registered_abort_settlement");

    const invocation = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await runnerRequestStarted.promise;
    const abortResult = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    await abortRequestStarted.promise;
    const coalescedAbortResult = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    let coalescedAbortSettled = false;
    void coalescedAbortResult.then(
      () => {
        coalescedAbortSettled = true;
      },
      () => {
        coalescedAbortSettled = true;
      },
    );

    await Promise.resolve();
    expect(coalescedAbortSettled).toBe(false);
    expect(containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation/abort")
    )).toHaveLength(1);

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invocation).resolves.toEqual(createRunnerResult());
    expect(recordRuntimeCompletionFromContainer).not.toHaveBeenCalled();
    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());
    const canceledSuccessor = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_registered_abort_successor"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    await Promise.resolve();
    expect(executeCallCount).toBe(1);
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });

    abortResponse.resolve(new Response(null, { status: 204 }));
    await expect(Promise.all([
      abortResult,
      coalescedAbortResult,
    ])).resolves.toEqual(["accepted", "accepted"]);
    expect(recordRuntimeCompletionFromContainer).not.toHaveBeenCalled();
    await expect(canceledSuccessor).resolves.toMatchObject({
      message: "workspace invocation preempted",
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_registered_abort"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());
    expect(executeCallCount).toBe(2);
  });

  it("preserves failed preemption until platform stop is observed", async () => {
    const runnerRequestSignal = createDeferred<AbortSignal>();
    let status: "running" | "stopped" = "running";
    const destroy = vi.fn(async () => {
      throw new Error("destroy did not settle");
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const containerFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }

      if (!url.endsWith("/internal/workspace-invocation")) {
        throw new Error(`Unexpected runner request URL: ${url}`);
      }

      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Expected active invocation request to receive an abort signal.");
      }
      runnerRequestSignal.resolve(signal);
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error("workspace invocation request aborted"));
        }, { once: true });
      });
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_preempt_unsettled_warm_shell");
    const invokeResult = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    await runnerRequestSignal.promise;
    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("failed");
    await expect(invokeResult).resolves.toMatchObject({
      message: "Hosted runner container failed to destroy cleanly.",
    });
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });

    status = "stopped";
    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("accepted");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("retries failed invocation cleanup from the next exact wake", async () => {
    let destroyAttempts = 0;
    let status: "running" | "stopped" = "running";
    const destroy = vi.fn(async () => {
      destroyAttempts += 1;
      if (destroyAttempts === 1) {
        throw new Error("destroy did not settle");
      }
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        throw new Error("Cleanup retry must settle before runtime wake.");
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        return createInvalidRunnerRequestResponse();
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_cleanup_retry_from_exact_wake");

    const invokeError = await container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);
    expect(invokeError).toBeInstanceOf(Error);
    expect(destroy).toHaveBeenCalledOnce();
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });

    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(false);
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("keeps exact active liveness while preserved cleanup fails concurrently", async () => {
    const preservedStatusStarted = createDeferred<void>();
    const releasePreservedStatus = createDeferred<void>();
    let deferNextStatus = false;
    const destroy = vi.fn(async () => {
      throw new Error("destroy did not settle");
    });
    const getState = vi.fn(async () => {
      if (deferNextStatus) {
        deferNextStatus = false;
        preservedStatusStarted.resolve(undefined);
        await releasePreservedStatus.promise;
      }
      return {
        lastChange: Date.now(),
        status: "running" as const,
      };
    });
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          activeJobCount: 0,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        throw new Error("Network connection lost");
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest(
      "evt_preserved_liveness_during_failed_cleanup",
    );

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    deferNextStatus = true;
    const liveness = container.readActiveRuntimeUserFence();
    await preservedStatusStarted.promise;
    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("failed");
    releasePreservedStatus.resolve(undefined);

    await expect(liveness).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
  });

  it("ignores health zero until an absent wake settles the exact stop", async () => {
    let healthProbeFails = false;
    let status: "running" | "stopped" = "running";
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        if (healthProbeFails) {
          throw new Error("health probe unavailable");
        }
        return new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          activeJobCount: 0,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (url.endsWith("/internal/runtime-wake")) {
        return new Response(null, {
          headers: {
            "x-runtime-wake-absent": "1",
            "x-runtime-wake-accepted": "0",
          },
          status: 204,
        });
      }

      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }

      if (!url.endsWith("/internal/workspace-invocation")) {
        throw new Error(`Unexpected runner request URL: ${url}`);
      }

      throw new Error("Network connection lost");
    });
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const { container, startAndWaitForPorts } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_response_lost_after_accept");

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) => input?.message === "Hosted execution container failed.");
    expect(failureLogInput).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          activeOperationAcquired: true,
          activeWorkspaceInvocationPresent: true,
          errorDetailPresent: true,
          errorMessage: "Hosted execution runtime failed.",
          runnerFailureKind: "runner_transport_failure",
          runnerOperationAbortSignalAborted: false,
          runnerTransportFailureErrorDetail: "Network connection lost",
          runnerTransportFailureErrorDetailPresent: true,
          runnerTransportFailureErrorDetailTruncated: false,
          runnerTransportFailurePreservedActiveOperation: true,
          workspaceAttemptId: request.attemptId,
          workspaceLeaseGeneration: request.leaseGeneration,
        }),
        level: "warn",
        message: "Hosted execution container failed.",
        phase: "failed",
        userId: "member_123",
      }),
    );
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });

    healthProbeFails = true;
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });

    const callsBeforeStaleWake = containerFetch.mock.calls.length;
    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });
    expect(containerFetch.mock.calls.slice(callsBeforeStaleWake).some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(true);
    expect(containerFetch.mock.calls.slice(callsBeforeStaleWake).some(([url]) =>
      String(url).endsWith("/internal/workspace-invocation/abort")
    )).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("clears a transport-uncertain operation after explicit destroy settles", async () => {
    let status: "running" | "stopped" = "running";
    let workspaceFetchCount = 0;
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        workspaceFetchCount += 1;
        if (workspaceFetchCount === 1) {
          throw new Error("Network connection lost");
        }
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const startAndWaitForPorts = vi.fn(async () => {
      status = "running";
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
      startAndWaitForPorts,
    });
    const firstRequest = createRunnerRequest(
      "evt_transport_uncertain_before_destroy",
    );

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: firstRequest,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    await expect(container.destroyInstance()).resolves.toBeUndefined();
    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_after_transport_uncertain_destroy"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(destroy).toHaveBeenCalledOnce();
    expect(startAndWaitForPorts).toHaveBeenCalledOnce();
    expect(workspaceFetchCount).toBe(2);
  });

  it("retries a failed explicit destroy from the next exact wake", async () => {
    let destroyAttempts = 0;
    let status: "running" | "stopped" = "running";
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        throw new Error("Destroy retry must settle before runtime wake.");
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        throw new Error("Network connection lost");
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {
      destroyAttempts += 1;
      if (destroyAttempts === 1) {
        throw new Error("destroy did not settle");
      }
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_failed_destroy_exact_retry");

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    await expect(container.destroyInstance()).rejects.toThrow(
      "Hosted runner container failed to destroy cleanly.",
    );
    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });
    expect(destroy).toHaveBeenCalledTimes(2);
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("does not let a delayed stale abort stop a replacement shell", async () => {
    const abortRequestStarted = createDeferred<void>();
    const abortResponse = createDeferred<Response>();
    const replacementRequestStarted = createDeferred<void>();
    const replacementResponse = createDeferred<Response>();
    let status: "running" | "stopped" = "running";
    let workspaceFetchCount = 0;
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        abortRequestStarted.resolve(undefined);
        return await abortResponse.promise;
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        workspaceFetchCount += 1;
        if (workspaceFetchCount === 1) {
          throw new Error("Network connection lost");
        }
        replacementRequestStarted.resolve(undefined);
        return await replacementResponse.promise;
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const startAndWaitForPorts = vi.fn(async () => {
      status = "running";
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
      startAndWaitForPorts,
    });
    const staleRequest = createRunnerRequest("evt_delayed_abort_before_destroy");

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: staleRequest,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    const staleAbort = container.abortWorkspaceInvocation({
      attemptId: staleRequest.attemptId,
      leaseGeneration: staleRequest.leaseGeneration,
      userId: "member_123",
    });
    await abortRequestStarted.promise;
    await expect(container.destroyInstance()).resolves.toBeUndefined();

    const replacement = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_replacement_after_delayed_abort"),
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await replacementRequestStarted.promise;

    abortResponse.resolve(new Response(null, { status: 204 }));
    await expect(staleAbort).resolves.toBe("accepted");
    expect(destroy).toHaveBeenCalledOnce();

    replacementResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(replacement).resolves.toEqual(createRunnerResult());
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("serializes preserved invocation cleanup with lifecycle work", async () => {
    const readinessHealthStarted = createDeferred<void>();
    const releaseReadinessHealth = createDeferred<void>();
    let healthCallCount = 0;
    let status: "running" | "stopped" = "running";
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        healthCallCount += 1;
        if (healthCallCount === 2) {
          readinessHealthStarted.resolve(undefined);
          await releaseReadinessHealth.promise;
        }
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        throw new Error("Network connection lost");
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_serialized_preserved_cleanup");

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    const readiness = container.ensureReadyForProcessing({
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await readinessHealthStarted.promise;
    const abortResult = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });

    await Promise.resolve();
    expect(destroy).not.toHaveBeenCalled();
    releaseReadinessHealth.resolve(undefined);
    await expect(readiness).resolves.toEqual({
      action: "already_warm",
      kind: "ready",
    });
    await expect(abortResult).resolves.toBe("accepted");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("does not report inactive liveness from a missing local pointer while health reports active work", async () => {
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          activeJobCount: 1,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    await expect(container.readActiveRuntimeUserFence()).rejects.toThrow(
      "Hosted runner container health still reports active workspace work.",
    );
  });

  it.each(["accepted", "queued", "failed"] as const)(
    "destroys the child after a %s no-pointer abort result",
    async (abortStatus) => {
      const request = createRunnerRequest(`evt_missing_pointer_${abortStatus}_abort`);
      const containerFetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/internal/workspace-invocation/abort")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            attemptId: request.attemptId,
            leaseGeneration: request.leaseGeneration,
            userId: "member_123",
          });
          if (abortStatus === "failed") {
            return new Response(null, { status: 503 });
          }
          return new Response(null, {
            headers: {
              "x-workspace-invocation-abort-status": abortStatus,
            },
            status: 204,
          });
        }
        throw new Error(`Unexpected runner request URL: ${url}`);
      });
      const { container, destroy } = createContainerDouble({
        containerFetch,
        initialStatus: "running",
      });

      await expect(container.abortWorkspaceInvocation({
        attemptId: request.attemptId,
        leaseGeneration: request.leaseGeneration,
        userId: "member_123",
      })).resolves.toBe("accepted");
      expect(containerFetch).toHaveBeenCalledOnce();
      expect(destroy).toHaveBeenCalledOnce();
    },
  );

  it("requires exact abort and observed stop when control-plane status is stale", async () => {
    const request = createRunnerRequest("evt_missing_pointer_stale_stopped_status");
    const containerFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          attemptId: request.attemptId,
          leaseGeneration: request.leaseGeneration,
          userId: "member_123",
        });
        return new Response(null, { status: 503 });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {});
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      initialStatus: "stopped",
      platformRunning: true,
    });

    let abortSettled = false;
    const abort = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    }).finally(() => {
      abortSettled = true;
    });

    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
    expect(containerFetch).toHaveBeenCalledOnce();
    expect(abortSettled).toBe(false);

    container.onStop({ exitCode: 0, reason: "exit" });
    await expect(abort).resolves.toBe("accepted");
  });

  it("preserves a newer child when a no-pointer abort is stale", async () => {
    const request = createRunnerRequest("evt_missing_pointer_stale_abort");
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, {
          headers: {
            "x-workspace-invocation-abort-status": "stale",
          },
          status: 204,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container, destroy } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("stale");
    expect(destroy).not.toHaveBeenCalled();
  });

  it("serializes no-pointer abort recovery before starting a replacement", async () => {
    const firstAbortStarted = createDeferred<void>();
    const firstAbortResponse = createDeferred<Response>();
    let status: "running" | "stopped" = "running";
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        firstAbortStarted.resolve();
        return await firstAbortResponse.promise;
      }
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const startAndWaitForPorts = vi.fn(async () => {
      status = "running";
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
      startAndWaitForPorts,
    });
    const staleRequest = createRunnerRequest("evt_missing_pointer_serialized_abort");
    const replacementRequest = createRunnerRequest("evt_replacement_after_abort");

    const firstAbort = container.abortWorkspaceInvocation({
      attemptId: staleRequest.attemptId,
      leaseGeneration: staleRequest.leaseGeneration,
      userId: "member_123",
    });
    await firstAbortStarted.promise;
    const secondAbort = container.abortWorkspaceInvocation({
      attemptId: staleRequest.attemptId,
      leaseGeneration: staleRequest.leaseGeneration,
      userId: "member_123",
    });
    const canceledRetry = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: staleRequest,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);
    const replacement = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: replacementRequest,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    const thirdAbort = container.abortWorkspaceInvocation({
      attemptId: staleRequest.attemptId,
      leaseGeneration: staleRequest.leaseGeneration,
      userId: "member_123",
    });

    await Promise.resolve();
    expect(containerFetch).toHaveBeenCalledTimes(1);
    expect(startAndWaitForPorts).not.toHaveBeenCalled();

    firstAbortResponse.resolve(new Response(null, { status: 503 }));

    await expect(firstAbort).resolves.toBe("accepted");
    await expect(secondAbort).resolves.toBe("accepted");
    await expect(thirdAbort).resolves.toBe("accepted");
    await expect(canceledRetry).resolves.toMatchObject({
      message: "workspace invocation preempted",
    });
    await expect(replacement).resolves.toEqual(createRunnerResult());
    expect(destroy).toHaveBeenCalledOnce();
    expect(startAndWaitForPorts).toHaveBeenCalledOnce();
  });

  it("keeps a no-pointer abort exact until fail-closed stop settles", async () => {
    const destroyStarted = createDeferred<void>();
    const releaseDestroy = createDeferred<void>();
    let status: "running" | "stopped" = "running";
    const request = createRunnerRequest("evt_no_pointer_abort_settlement");
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {
      destroyStarted.resolve(undefined);
      await releaseDestroy.promise;
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });

    const abortResult = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    await destroyStarted.promise;

    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });

    releaseDestroy.resolve(undefined);
    await expect(abortResult).resolves.toBe("accepted");
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("keeps failed no-pointer cleanup indeterminate until an exact retry settles", async () => {
    const secondDestroyStarted = createDeferred<void>();
    const releaseSecondDestroy = createDeferred<void>();
    let destroyAttempts = 0;
    let status: "running" | "stopped" = "running";
    const request = createRunnerRequest("evt_no_pointer_abort_retry");
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const destroy = vi.fn(async () => {
      destroyAttempts += 1;
      if (destroyAttempts === 2) {
        secondDestroyStarted.resolve(undefined);
        await releaseSecondDestroy.promise;
      }
      if (destroyAttempts <= 2) {
        throw new Error("destroy did not settle");
      }
      status = "stopped";
    });
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status,
    }));
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });

    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).rejects.toThrow("Hosted runner container failed to destroy cleanly.");
    await expect(container.readActiveRuntimeUserFence()).rejects.toThrow(
      "Hosted runner container has an unsettled fail-closed stop.",
    );
    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });

    const invokeResult = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);
    await secondDestroyStarted.promise;
    const registeredAbort = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    releaseSecondDestroy.resolve(undefined);
    await expect(invokeResult).resolves.toMatchObject({
      message: "Hosted runner container failed to destroy cleanly.",
    });
    await expect(registeredAbort).resolves.toBe("failed");

    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("accepted");
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("aborts coalesced exact queued system mailbox invocations before runner dispatch", async () => {
    const readinessHealthStarted = createDeferred<void>();
    const releaseReadinessHealth = createDeferred<void>();
    let holdFirstHealth = true;
    const request = {
      ...createRunnerRequest("evt_abort_queued_system_mailbox"),
      processingMode: "system_mailbox" as const,
    };
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        if (holdFirstHealth) {
          holdFirstHealth = false;
          readinessHealthStarted.resolve(undefined);
          await releaseReadinessHealth.promise;
        }
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, {
          headers: {
            "x-workspace-invocation-abort-status": "accepted",
          },
          status: 204,
        });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    const lockHolder = container.ensureReadyForProcessing({
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await readinessHealthStarted.promise;
    const invokeResult = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);
    const duplicateInvokeResult = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    }).catch((error: unknown) => error);
    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: `${request.leaseGeneration}-stale`,
      userId: "member_123",
    })).resolves.toBe("stale");
    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_other",
    })).resolves.toBe("stale");
    const abortResult = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    const executeCalls = () =>
      containerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/internal/workspace-invocation")
      );

    expect(executeCalls()).toHaveLength(0);
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      processingMode: "system_mailbox",
      userId: "member_123",
    })).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    releaseReadinessHealth.resolve(undefined);

    await expect(lockHolder).resolves.toEqual({
      action: "already_warm",
      kind: "ready",
    });
    await expect(abortResult).resolves.toBe("accepted");
    await expect(invokeResult).resolves.toMatchObject({
      message: "workspace invocation preempted",
    });
    await expect(duplicateInvokeResult).resolves.toMatchObject({
      message: "workspace invocation preempted",
    });
    expect(executeCalls()).toHaveLength(0);
  });

  it("reports inactive liveness from a missing local pointer only after running health is idle", async () => {
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          activeJobCount: 0,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });

    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("rechecks exact coordination before returning inactive liveness", async () => {
    const firstStatusStarted = createDeferred<void>();
    const releaseFirstStatus = createDeferred<void>();
    const runnerRequestStarted = createDeferred<void>();
    const runnerResponse = createDeferred<Response>();
    let statusReadCount = 0;
    const getState = vi.fn(async () => {
      statusReadCount += 1;
      if (statusReadCount === 1) {
        firstStatusStarted.resolve(undefined);
        await releaseFirstStatus.promise;
      }
      return {
        lastChange: Date.now(),
        status: "running",
      };
    });
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          activeJobCount: 0,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        runnerRequestStarted.resolve(undefined);
        return await runnerResponse.promise;
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_liveness_registered_during_probe");

    const liveness = container.readActiveRuntimeUserFence();
    await firstStatusStarted.promise;
    const invokeResult = container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await runnerRequestStarted.promise;
    releaseFirstStatus.resolve(undefined);

    await expect(liveness).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });

    runnerResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(invokeResult).resolves.toEqual(createRunnerResult());
  });

  it("rechecks the preserved owner after asynchronous liveness probes", async () => {
    const preservedProbesStarted = createDeferred<void>();
    const releasePreservedProbes = createDeferred<void>();
    const replacementRequestStarted = createDeferred<void>();
    const replacementResponse = createDeferred<Response>();
    let delayedProbeCount = 0;
    let delayedProbesRemaining = 0;
    let executeCallCount = 0;
    let status: "running" | "stopped" = "running";
    const getState = vi.fn(async () => {
      if (delayedProbesRemaining > 0) {
        delayedProbesRemaining -= 1;
        delayedProbeCount += 1;
        if (delayedProbeCount === 2) {
          preservedProbesStarted.resolve(undefined);
        }
        await releasePreservedProbes.promise;
      }
      return {
        lastChange: Date.now(),
        status,
      };
    });
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const startAndWaitForPorts = vi.fn(async () => {
      status = "running";
    });
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        throw new Error("A stale preserved owner must not reach runtime wake.");
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        executeCallCount += 1;
        if (executeCallCount === 1) {
          throw new Error("Network connection lost");
        }
        replacementRequestStarted.resolve(undefined);
        return await replacementResponse.promise;
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
      startAndWaitForPorts,
    });
    const staleRequest = createRunnerRequest("evt_preserved_owner_replaced");
    const replacementRequest = createRunnerRequest(
      "evt_preserved_owner_replacement",
    );

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: staleRequest,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    delayedProbesRemaining = 2;
    const liveness = container.readActiveRuntimeUserFence();
    const wake = container.wakeRuntime({
      attemptId: staleRequest.attemptId,
      leaseGeneration: staleRequest.leaseGeneration,
      userId: "member_123",
    });
    await preservedProbesStarted.promise;
    await expect(container.abortWorkspaceInvocation({
      attemptId: staleRequest.attemptId,
      leaseGeneration: staleRequest.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("accepted");

    const replacement = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: replacementRequest,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    });
    await replacementRequestStarted.promise;
    releasePreservedProbes.resolve(undefined);

    await expect(liveness).resolves.toEqual({
      active: true,
      attemptId: replacementRequest.attemptId,
      leaseGeneration: replacementRequest.leaseGeneration,
      userId: "member_123",
    });
    await expect(wake).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(false);

    replacementResponse.resolve(new Response(JSON.stringify(createRunnerResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    await expect(replacement).resolves.toEqual(createRunnerResult());
  });

  it("keeps wake unconfirmed when abort starts during preserved status", async () => {
    const preservedStatusStarted = createDeferred<void>();
    const releasePreservedStatus = createDeferred<void>();
    const abortRequestStarted = createDeferred<void>();
    const abortResponse = createDeferred<Response>();
    let deferNextStatus = false;
    let status: "running" | "stopped" = "running";
    const getState = vi.fn(async () => {
      if (deferNextStatus) {
        deferNextStatus = false;
        preservedStatusStarted.resolve(undefined);
        await releasePreservedStatus.promise;
      }
      return {
        lastChange: Date.now(),
        status,
      };
    });
    const destroy = vi.fn(async () => {
      status = "stopped";
    });
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        abortRequestStarted.resolve(undefined);
        return await abortResponse.promise;
      }
      if (url.endsWith("/internal/runtime-wake")) {
        throw new Error("An aborting preserved invocation must not be woken.");
      }
      if (url.endsWith("/internal/workspace-invocation")) {
        throw new Error("Network connection lost");
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_abort_during_preserved_health");

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    deferNextStatus = true;
    const wake = container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    await preservedStatusStarted.promise;
    const abortResult = container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });
    await abortRequestStarted.promise;
    releasePreservedStatus.resolve(undefined);

    await expect(wake).resolves.toEqual({
      kind: "unknown",
      reason: "active-child-rejected",
    });
    expect(containerFetch.mock.calls.some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(false);

    abortResponse.resolve(new Response(null, { status: 204 }));
    await expect(abortResult).resolves.toBe("accepted");
  });

  it("reports inactive liveness from a missing local pointer when the container is already gone", async () => {
    const containerFetch = vi.fn(async () => {
      throw new Error("health should not be probed for missing containers");
    });
    const { container } = createContainerDouble({
      containerFetch,
      getState: vi.fn(async () => {
        throw new Error("No such container");
      }),
    });

    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
    expect(containerFetch).not.toHaveBeenCalled();
  });

  it("clears preserved liveness when the accepted workspace container is gone", async () => {
    const { container, markContainerGone } =
      await createPreservedWorkspaceInvocationAfterLostResponse(
        "evt_response_lost_then_container_gone",
      );

    markContainerGone();
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("does not wake preserved liveness after the accepted workspace container is gone", async () => {
    const { container, containerFetch, markContainerGone, request } =
      await createPreservedWorkspaceInvocationAfterLostResponse(
        "evt_response_lost_then_wake_after_gone",
      );

    const callsBeforeWake = containerFetch.mock.calls.length;
    markContainerGone();
    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });
    expect(containerFetch.mock.calls.slice(callsBeforeWake).some(([url]) =>
      String(url).endsWith("/internal/runtime-wake")
    )).toBe(false);
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("destroys and clears preserved liveness when explicit abort is not delivered", async () => {
    let runnerResponseLost = false;
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          activeJobCount: runnerResponseLost ? 1 : 0,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(JSON.stringify({ error: "abort endpoint unavailable" }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 503,
        });
      }

      if (!url.endsWith("/internal/workspace-invocation")) {
        throw new Error(`Unexpected runner request URL: ${url}`);
      }

      runnerResponseLost = true;
      throw new Error("Network connection lost");
    });
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_abort_after_response_lost");

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();

    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("accepted");

    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("destroys and clears preserved liveness after explicit abort is accepted", async () => {
    let abortPosted = false;
    let runnerResponseLost = false;
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          activeJobCount: runnerResponseLost ? 1 : 0,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (url.endsWith("/internal/workspace-invocation/abort")) {
        abortPosted = true;
        return new Response(null, { status: 204 });
      }

      if (!url.endsWith("/internal/workspace-invocation")) {
        throw new Error(`Unexpected runner request URL: ${url}`);
      }

      runnerResponseLost = true;
      throw new Error("Network connection lost");
    });
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_abort_after_accepted_response_lost");

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Network connection lost");

    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();

    await expect(container.abortWorkspaceInvocation({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toBe("accepted");

    expect(abortPosted).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
  });

  it("converges an idle child after an accepted workspace response body is lost", async () => {
    let runnerBodyLost = false;
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          activeJobCount: runnerBodyLost ? 1 : 0,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (url.endsWith("/internal/runtime-wake")) {
        return new Response(null, {
          headers: {
            "x-runtime-wake-absent": "1",
            "x-runtime-wake-accepted": "0",
          },
          status: 204,
        });
      }

      if (url.endsWith("/internal/workspace-invocation/abort")) {
        return new Response(null, { status: 204 });
      }

      if (!url.endsWith("/internal/workspace-invocation")) {
        throw new Error(`Unexpected runner request URL: ${url}`);
      }

      runnerBodyLost = true;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("Response body lost"));
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });
    const request = createRunnerRequest("evt_response_body_lost_after_accept");

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request,
      },
      timeoutMs: 30_000,
      userId: "member_123",
    })).rejects.toThrow("Response body lost");

    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) => input?.message === "Hosted execution container failed.");
    expect(failureLogInput).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          activeOperationAcquired: true,
          activeWorkspaceInvocationPresent: true,
          errorDetailPresent: true,
          errorMessage: "Hosted execution runtime failed.",
          runnerFailureKind: "runner_transport_failure",
          runnerOperationAbortSignalAborted: false,
          runnerTransportFailureErrorDetail: "Response body lost",
          runnerTransportFailureErrorDetailPresent: true,
          runnerTransportFailureErrorDetailTruncated: false,
          runnerTransportFailurePreservedActiveOperation: true,
          workspaceAttemptId: request.attemptId,
          workspaceLeaseGeneration: request.leaseGeneration,
        }),
        level: "warn",
        message: "Hosted execution container failed.",
        phase: "failed",
        userId: "member_123",
      }),
    );
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: true,
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    });

    await expect(container.wakeRuntime({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: "member_123",
    })).resolves.toEqual({
      kind: "not-wakeable",
      reason: "no-active-child",
    });
    expect(destroy).toHaveBeenCalledOnce();
    await expect(container.readActiveRuntimeUserFence()).resolves.toEqual({
      active: false,
      reason: "no_active_runtime",
    });
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
            return new Response(JSON.stringify(healthChecks === 1 ? { error: "stale shell" } : createRunnerHealthResult()), {
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

  it("waits for a destroyed warm shell to report stopped before cold restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));

    try {
      const settleRunningObserved = createDeferred<void>();
      let healthChecks = 0;
      let statusReads = 0;
      const getState = vi.fn(async () => {
        statusReads += 1;
        if (statusReads === 3) {
          settleRunningObserved.resolve();
          return {
            lastChange: Date.now(),
            status: "running",
          };
        }

        return {
          lastChange: Date.now(),
          status: statusReads < 3 ? "running" : "stopped",
        };
      });
      const { container, destroy, startAndWaitForPorts } = createContainerDouble({
        destroy: vi.fn(async () => {}),
        getState,
        initialStatus: "running",
        startAndWaitForPorts: vi.fn(async () => {}),
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            healthChecks += 1;
            return new Response(JSON.stringify(healthChecks === 1 ? { error: "stale shell" } : createRunnerHealthResult()), {
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

      const invokePromise = container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_wait_for_destroy_settle"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });

      await settleRunningObserved.promise;
      expect(startAndWaitForPorts).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(250);
      await expect(invokePromise).resolves.toEqual(createRunnerResult());

      expect(destroy).toHaveBeenCalledTimes(1);
      expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
      const destroyCompletedLog = mocks.emitHostedExecutionStructuredLog.mock.calls
        .map(([log]) => log)
        .find((log) => log.message === "Hosted execution container destroy completed.");
      expect(destroyCompletedLog?.details).toEqual(expect.objectContaining({
        destroySettleTimeoutMs: 5_000,
        lifecycleStage: "destroyed",
        observedStatusesAfterDestroy: ["running", "stopped"],
        statusAfterDestroy: "stopped",
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports non-JSON warm health responses as sanitized metadata errors", async () => {
    let healthChecks = 0;
    const { container, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          healthChecks += 1;
          if (healthChecks === 1) {
            return new Response("Failed to connect to local container transport", {
              headers: {
                "content-type": "text/plain; charset=utf-8",
              },
              status: 503,
            });
          }

          return new Response(JSON.stringify(createRunnerHealthResult()), {
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

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_non_json_warm_health"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(healthChecks).toBe(2);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    const warmFailureLog = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([log]) => log)
      .find((log) => log.message === "Hosted execution container warm health check failed; restarting shell.");
    expect(warmFailureLog?.error).toMatchObject({
      details: expect.objectContaining({
        errorStatus: 503,
        responseBodyPreviewOmitted: true,
        responseContentType: "text/plain",
        responseJsonParseFailed: true,
        responseStatus: 503,
      }),
      name: "HostedRunnerContainerMetadataResponseError",
      statusCode: 503,
    });
    expect(warmFailureLog?.error).toMatchObject({
      message: "Hosted runner container returned HTTP 503 with non-JSON metadata response.",
    });
    expect(JSON.stringify(warmFailureLog?.error)).not.toContain("Failed to connect");
  });

  it("restarts a warm shell when health reports it is poisoned", async () => {
    let healthChecks = 0;
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      initialStatus: "running",
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          healthChecks += 1;
          return new Response(JSON.stringify(
            healthChecks === 1
              ? {
                  ...createRunnerHealthResult(),
                  lastCleanupStatus: "failed",
                  poisoned: true,
                }
              : createRunnerHealthResult(),
          ), {
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

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_restart_after_poisoned_health"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(healthChecks).toBe(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        level: "warn",
        message: "Hosted execution container warm health check failed; restarting shell.",
        phase: "container.starting",
      }),
    );
  });

  it("restarts a warm shell with stale fingerprints before invoking user work", async () => {
    let healthChecks = 0;
    const events: string[] = [];
    const { container, destroy, startAndWaitForPorts } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "expected-bundle",
        HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "expected-source",
      },
      initialStatus: "running",
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          healthChecks += 1;
          events.push(healthChecks === 1 ? "health-stale" : "health-current");
          return new Response(JSON.stringify({
            ...createRunnerHealthResult(),
            runnerBundle: {
              bundleFingerprint: healthChecks === 1 ? "stale-bundle" : "expected-bundle",
              sourceFingerprint: healthChecks === 1 ? "stale-source" : "expected-source",
            },
          }), {
            headers: { "content-type": "application/json; charset=utf-8" },
            status: 200,
          });
        }
        events.push("invoke");
        return new Response(JSON.stringify(createRunnerResult()), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }),
    });

    await expect(container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_restart_after_stale_bundle"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(healthChecks).toBe(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["health-stale", "health-current", "invoke"]);
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

  it("aborts active and pre-registered queued workspace fetches on explicit destroy", async () => {
    const firstWorkspaceFetchStarted = createDeferred<void>();
    let workspaceFetchCount = 0;
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
        request: createRunnerRequest("evt_queued_before_destroy"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    expect(workspaceFetchCount).toBe(1);
    const destroyResult = container.destroyInstance();
    await expect(activeInvoke).resolves.toBeInstanceOf(Error);
    await expect(queuedInvoke).resolves.toMatchObject({
      message: "workspace invocation container destroyed",
    });
    await expect(destroyResult).resolves.toBeUndefined();
    const postDestroyInvoke = container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_queued_after_destroy"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });
    await expect(postDestroyInvoke).resolves.toEqual(createRunnerResult());
    expect(workspaceFetchCount).toBe(2);
  });

  it("propagates safe configuration failures from the runner shell with the inner error code", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
      name: "HostedExecutionConfigurationError",
    });
    expect(String(thrown)).toContain("HOSTED_ASSISTANT_CONFIG_REQUIRED");
    expect(String(thrown)).not.toContain("secret stack");
  });

  it("preserves invalid-request diagnostics from runner shell responses", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
        errorDetailPresent: true,
        payloadDetailsPresent: true,
      },
      message: "Invalid request. Code: type_error. Status: 400.",
      name: "TypeError",
      status: 400,
      statusCode: 400,
    });
    expect(requireObject(thrown, "runner error").details).toMatchObject({
      errorDetailPresent: true,
      payloadDetailsPresent: true,
    });
    expect(JSON.stringify(thrown)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(thrown)).not.toContain("runtime.userEnv");
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

  it("omits raw body previews from non-json runner failure responses", async () => {
    const hiddenBody = "hidden non-json runner body with provider text and OPENAI_API_KEY=placeholder";
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(hiddenBody, {
          headers: {
            "content-length": String(Buffer.byteLength(hiddenBody)),
            "content-type": "text/plain; charset=utf-8",
          },
          status: 500,
        });
      }),
    });

    const thrown = await container.ensureProcessing({
      invoke: {
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_non_json_failure"),
        },
        timeoutMs: 10_000,
        userId: "member_123",
      },
      userId: "member_123",
    }).catch((error: unknown) => error);

    expect(deriveHostedExecutionErrorCode(thrown)).toBe("runner_http_error");
    expect(thrown).toMatchObject({
      details: {
        responseBodyPresent: true,
        responseBodyPreviewOmitted: true,
        responseContentLengthBytes: Buffer.byteLength(hiddenBody),
        responseContentType: "text/plain",
        responseJsonParseFailed: true,
      },
      message: "Hosted runner container returned HTTP 500.",
      status: 500,
      statusCode: 500,
    });
    expect(JSON.stringify(thrown)).not.toContain(hiddenBody);
    expect(String(thrown)).not.toContain(hiddenBody);
    expect(String(thrown)).not.toContain("placeholder");

    const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) => input?.message === "Hosted execution container failed.");
    if (!failureLogInput) {
      throw new Error("Expected container failure log input.");
    }
    expect(failureLogInput).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          runnerResponseDetailsKeys: [
            "responseBodyPresent",
            "responseBodyPreviewOmitted",
            "responseContentLengthBytes",
            "responseContentType",
            "responseJsonParseFailed",
          ],
        }),
      }),
    );
    expect(JSON.stringify(failureLogInput)).not.toContain(hiddenBody);
    expect(JSON.stringify(failureLogInput)).not.toContain("placeholder");
  });

  it("preserves runtime phase detail through the thrown and persisted error shapes", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify({
          code: "runtime_error",
          details: {
            errorCodeDetail: "EACCES",
            errorDetail: "Missing required file \"vault.json\".",
            runtimeFailurePhaseCode:
              "runtime_phase:workspace.checkpoint.idle_compact",
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
        errorCodeDetail: "EACCES",
        errorDetailPresent: true,
        payloadDetailsPresent: true,
        runtimeFailurePhaseCode:
          "runtime_phase:workspace.checkpoint.idle_compact",
      },
      message: "Hosted execution runtime failed. Code: EACCES. Status: 500.",
      name: "Error",
      status: 500,
      statusCode: 500,
    });
    expect(deriveHostedExecutionErrorCode(thrown)).toBe("runtime_error");
    expect(buildHostedRunnerRedactedErrorJson(thrown)).toMatchObject({
      errorCode: "runtime_error",
      errorCodeDetail: "runtime_phase:workspace.checkpoint.idle_compact",
      safeErrorDetail:
        "Hosted execution runtime failed. Code: EACCES. Status: 500.",
    });
    expect(JSON.stringify(thrown)).not.toContain("vault.json");
  });

  it("does not promote legacy child-shaped runner response details into logs", async () => {
    const hiddenChildDetail = "hidden child detail";
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify({
          code: "runtime_error",
          details: {
            childRuntimeStage: "runtime.in-process",
            childProcess: {
              abortedByParent: false,
              abortReasonMessage: hiddenChildDetail,
              exitCode: 1,
              stderrTail: hiddenChildDetail,
              stdoutTail: hiddenChildDetail,
            },
            errorDetail: hiddenChildDetail,
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
        request: createRunnerRequest("evt_legacy_child_response_details"),
      },
      timeoutMs: 10_000,
      userId: "member_123",
    }).catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      code: "runtime_error",
      details: {
        errorDetailPresent: true,
        payloadDetailsPresent: true,
      },
      status: 500,
      statusCode: 500,
    });
    const serializedThrown = JSON.stringify(thrown);
    const thrownDetails = (thrown as { details?: Record<string, unknown> }).details;
    expect(thrownDetails).not.toHaveProperty("childProcess");
    expect(thrownDetails).not.toHaveProperty("childRuntimeStage");
    expect(serializedThrown).not.toContain(hiddenChildDetail);
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
          errorCode: "runtime_error",
          errorDetailPresent: true,
          errorMessage: "Hosted execution runtime failed.",
          errorName: "Error",
          errorStatus: 500,
          runnerResponseDetailsKeys: [
            "errorDetailPresent",
            "payloadDetailsPresent",
          ],
        }),
        level: "warn",
        message: "Hosted execution container failed.",
        phase: "failed",
        userId: "member_123",
      }),
    );

    expect(failureLogInput.details).not.toHaveProperty("runnerChildRuntimeStage");
    expect(failureLogInput.details).not.toHaveProperty("runnerChildStderrTailPresent");
    const serializedFailureLog = JSON.stringify(failureLogInput);
    expect(serializedFailureLog).not.toContain(hiddenChildDetail);
  });

  it("prefers sanitized inner runtime status over the container response status", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
        errorDetailPresent: true,
        errorStatus: 429,
        payloadDetailsPresent: true,
      },
      message: "Hosted execution runtime failed. Code: runtime_error. Status: 429.",
      status: 500,
      statusCode: 500,
    });
    expect(JSON.stringify(thrown)).not.toContain("Provider request was rate limited.");
  });

  it("restores safe bundle-validation error names from runner shell error codes", async () => {
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
        payloadDetailsPresent: true,
      },
      name: "HostedBundleArchiveValidationError",
      status: 500,
      statusCode: 500,
    });
    expect(String(thrown)).toContain("bundle_archive_validation_error");
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
    const containerFetch = vi.fn(async () => new Response(JSON.stringify(createRunnerHealthResult()), {
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

    expect(containerFetch).toHaveBeenCalledOnce();
    expect(containerFetch).toHaveBeenCalledWith(
      "http://container/health",
      expect.objectContaining({ method: "GET" }),
    );
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

  it("fails closed when destroy resolves but the container never reports stopped", async () => {
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

      const destroyPromise = container.destroyInstance().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);

      await expect(destroyPromise).resolves.toMatchObject({
        message: "Hosted runner container did not report stopped after destroy.",
      });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(getState.mock.calls.length).toBeGreaterThan(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            destroySettleTimeoutMs: 5_000,
            failClosed: true,
            lifecycleStage: "destroy-settle",
            observedStatusesAfterDestroy: ["destroying"],
            statusAfterDestroy: "destroying",
            statusBeforeDestroy: "running",
          }),
          level: "error",
          message: "Hosted execution container destroy did not settle to stopped.",
          phase: "failed",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when the destroy request itself never settles", async () => {
    vi.useFakeTimers();

    try {
      const destroy = vi.fn(async () => {
        await new Promise<void>(() => undefined);
      });
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

      await expect(destroyPromise).resolves.toMatchObject({
        message: "Hosted runner container did not report stopped after destroy.",
      });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(getState.mock.calls.length).toBeGreaterThan(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            destroySettleTimeoutMs: 5_000,
            failClosed: true,
            lifecycleStage: "destroy-settle",
            statusBeforeDestroy: "running",
          }),
          level: "error",
          message: "Hosted execution container destroy did not settle to stopped.",
          phase: "failed",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when the initial destroy status read never settles", async () => {
    vi.useFakeTimers();

    try {
      const destroy = vi.fn(async () => {});
      const getState = vi.fn(async () => {
        await new Promise<void>(() => undefined);
        return {
          lastChange: Date.now(),
          status: "running",
        };
      });
      const { container } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const destroyPromise = container.destroyInstance().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);

      await expect(destroyPromise).resolves.toMatchObject({
        message: "Hosted runner container failed to destroy cleanly.",
      });
      expect(destroy).not.toHaveBeenCalled();
      expect(getState).toHaveBeenCalledTimes(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            failClosed: true,
            lifecycleStage: "status",
          }),
          message: "Hosted execution container failed while checking its lifecycle state.",
          phase: "failed",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when destroy settle status reads never settle", async () => {
    vi.useFakeTimers();

    try {
      const destroy = vi.fn(async () => {});
      let statusReadCount = 0;
      const getState = vi.fn(async () => {
        statusReadCount += 1;
        if (statusReadCount === 1) {
          return {
            lastChange: Date.now(),
            status: "running",
          };
        }

        await new Promise<void>(() => undefined);
        return {
          lastChange: Date.now(),
          status: "destroying",
        };
      });
      const { container } = createContainerDouble({
        destroy,
        getState,
        initialStatus: "running",
      });

      const destroyPromise = container.destroyInstance().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);

      await expect(destroyPromise).resolves.toMatchObject({
        message: "Hosted runner container did not report stopped after destroy.",
      });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(getState.mock.calls.length).toBeGreaterThan(1);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          details: expect.objectContaining({
            destroySettleTimeoutMs: 5_000,
            failClosed: true,
            lifecycleStage: "destroy-settle",
            observedStatusesAfterDestroy: ["status_error"],
            statusAfterDestroy: null,
            statusBeforeDestroy: "running",
          }),
          level: "error",
          message: "Hosted execution container destroy did not settle to stopped.",
          phase: "failed",
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
    const renewActivityTimeout = vi.fn();
    const destroy = vi.fn(async () => {
      throw new Error("destroy failed");
    });
    const { container } = createContainerDouble({
      destroy,
      initialStatus: "running",
    });
    Object.assign(container, { renewActivityTimeout });

    vi.useFakeTimers();
    try {
      const cleanupPromise = container.onActivityExpired();
      await vi.advanceTimersByTimeAsync(5_500);
      await expect(cleanupPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(renewActivityTimeout).toHaveBeenCalledOnce();
  });

  it("fails closed before reusing a warm shell after best-effort cleanup does not settle", async () => {
    const destroy = vi.fn(async () => {});
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
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
    const getState = vi.fn(async () => ({
      lastChange: Date.now(),
      status: "running",
    }));
    const { container, startAndWaitForPorts } = createContainerDouble({
      containerFetch,
      destroy,
      getState,
      initialStatus: "running",
    });

    vi.useFakeTimers();
    try {
      const cleanupPromise = container.onActivityExpired();
      await vi.advanceTimersByTimeAsync(5_500);
      await expect(cleanupPromise).resolves.toBeUndefined();

      const invokeResult = container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_after_unsettled_best_effort_destroy"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_500);

      await expect(invokeResult).resolves.toMatchObject({
        message: "Hosted runner container did not report stopped after destroy.",
      });
    } finally {
      vi.useRealTimers();
    }

    expect(destroy).toHaveBeenCalledTimes(2);
    expect(containerFetch).toHaveBeenCalledOnce();
    expect(containerFetch).toHaveBeenCalledWith(
      "http://container/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(startAndWaitForPorts).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        message: "Hosted execution container warm shell was invalidated; destroying before reuse.",
        phase: "container.starting",
      }),
    );
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
              return new Response(JSON.stringify(createRunnerHealthResult()), {
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

  it("uses the short lifecycle cadence without shortening conversation warmth", () => {
    const { container } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1200000",
        HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
      },
    });

    expect(container.sleepAfter).toBe("60s");
  });

  it("cleans up maintenance-only work after the short lifecycle cadence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const startedAtMs = Date.parse("2026-07-22T09:00:00.000Z");
      vi.setSystemTime(startedAtMs);
      const renewActivityTimeout = vi.fn();
      const { container, destroy } = createContainerDouble({
        env: {
          HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1200000",
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
        },
      });
      Object.assign(container, { renewActivityTimeout });

      await container.invoke({
        job: {
          kind: "workspace-invocation",
          request: createRunnerRequest("evt_short_maintenance_cadence"),
        },
        timeoutMs: 60_000,
        userId: "member_123",
      });
      renewActivityTimeout.mockClear();

      vi.setSystemTime(startedAtMs + 60_001);
      await container.onActivityExpired();

      expect(renewActivityTimeout).not.toHaveBeenCalled();
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects runner lifecycle env values with trailing junk", async () => {
    expect(() =>
      createContainerDouble({
        env: {
          HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2500abc",
        },
      })
    ).toThrow("HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS must be an integer");

    expect(() =>
      createContainerDouble({
        env: {
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000abc",
        },
      })
    ).toThrow(
      "HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS must be an integer",
    );

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

  it("re-arms each conversation-warm expiry and destroys at the first check after the lease", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const activityAtMs = Date.parse("2026-07-22T12:00:00.000Z");
      let expiryArmed = true;
      const renewActivityTimeout = vi.fn(() => {
        expiryArmed = true;
      });
      const { container, destroy } = createContainerDouble({
        env: {
          HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1200000",
          HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
        },
        initialStatus: "running",
        containerFetch: vi.fn(async () => new Response(JSON.stringify({
          ...createRunnerHealthResult(),
          conversationWarmActivityCompletedAtEpochMs: activityAtMs,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        })),
      });
      Object.assign(container, { renewActivityTimeout });
      const deliverExpiryAt = async (nowMs: number) => {
        expect(expiryArmed).toBe(true);
        expiryArmed = false;
        vi.setSystemTime(nowMs);
        await container.onActivityExpired();
      };

      for (let minute = 1; minute < 20; minute += 1) {
        await deliverExpiryAt(activityAtMs + (minute * 60_000));
        expect(destroy).not.toHaveBeenCalled();
        expect(renewActivityTimeout).toHaveBeenCalledTimes(minute);
      }

      await deliverExpiryAt(activityAtMs + 1_200_000);

      expect(destroy).toHaveBeenCalledOnce();
      expect(renewActivityTimeout).toHaveBeenCalledTimes(19);
      expect(expiryArmed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys maintenance-only work at the first short-cadence expiry", async () => {
    const renewActivityTimeout = vi.fn();
    const { container, destroy } = createContainerDouble({
      env: {
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1200000",
        HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
      },
      initialStatus: "running",
    });
    Object.assign(container, { renewActivityTimeout });

    await container.onActivityExpired();

    expect(destroy).toHaveBeenCalledOnce();
    expect(renewActivityTimeout).not.toHaveBeenCalled();
  });

  it("destroys an idle legacy child that omits the optional warmth watermark", async () => {
    const renewActivityTimeout = vi.fn();
    const { container, destroy } = createContainerDouble({
      initialStatus: "running",
      containerFetch: vi.fn(async () => new Response(JSON.stringify({
        activeJobCount: 0,
        hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
        ok: true,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })),
    });
    Object.assign(container, { renewActivityTimeout });

    await container.onActivityExpired();

    expect(destroy).toHaveBeenCalledOnce();
    expect(renewActivityTimeout).not.toHaveBeenCalled();
  });

  it("re-arms cleanup when child health is unavailable", async () => {
    const renewActivityTimeout = vi.fn();
    const { container, destroy } = createContainerDouble({
      initialStatus: "running",
      containerFetch: vi.fn(async () => {
        throw new Error("health unavailable");
      }),
    });
    Object.assign(container, { renewActivityTimeout });

    await container.onActivityExpired();

    expect(destroy).not.toHaveBeenCalled();
    expect(renewActivityTimeout).toHaveBeenCalledOnce();
  });

  it("re-arms cleanup when container status is unavailable", async () => {
    const renewActivityTimeout = vi.fn();
    const { container, containerFetch, destroy } = createContainerDouble({
      initialStatus: "running",
      getState: vi.fn(async () => {
        throw new Error("status unavailable");
      }),
    });
    Object.assign(container, { renewActivityTimeout });

    await container.onActivityExpired();

    expect(containerFetch).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(renewActivityTimeout).toHaveBeenCalledOnce();
  });

  it("does not transfer conversation warmth to a replacement child", async () => {
    const storage = createContainerStorageDouble();
    const activityAtMs = Date.now();
    const warmChild = createContainerDouble({
      initialStatus: "running",
      storage,
      containerFetch: vi.fn(async () => new Response(JSON.stringify({
        ...createRunnerHealthResult(),
        conversationWarmActivityCompletedAtEpochMs: activityAtMs,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })),
    });
    const renewActivityTimeout = vi.fn();
    Object.assign(warmChild.container, { renewActivityTimeout });

    await warmChild.container.onActivityExpired();

    expect(warmChild.destroy).not.toHaveBeenCalled();
    expect(renewActivityTimeout).toHaveBeenCalledOnce();

    const replacement = createContainerDouble({
      initialStatus: "running",
      storage,
    });
    await replacement.container.onActivityExpired();

    expect(replacement.destroy).toHaveBeenCalledOnce();
    await expect(storage.list()).resolves.toEqual(new Map());
  });

  it("re-arms a field-less legacy child while it reports active work", async () => {
    const renewActivityTimeout = vi.fn();
    const { container, destroy } = createContainerDouble({
      initialStatus: "running",
      containerFetch: vi.fn(async () => new Response(JSON.stringify({
        activeJobCount: 1,
        hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
        ok: true,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })),
    });
    Object.assign(container, { renewActivityTimeout });

    await container.onActivityExpired();

    expect(destroy).not.toHaveBeenCalled();
    expect(renewActivityTimeout).toHaveBeenCalledOnce();
  });

  it("does not destroy when a runtime wake races the expiry health check", async () => {
    const healthStarted = createDeferred<void>();
    const releaseHealth = createDeferred<void>();
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        healthStarted.resolve();
        await releaseHealth.promise;
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        return new Response(null, {
          headers: {
            "x-runtime-wake-accepted": "1",
            "x-runtime-wake-identity-checked": "1",
          },
          status: 204,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const renewActivityTimeout = vi.fn();
    const { container, destroy } = createContainerDouble({
      containerFetch,
      initialStatus: "running",
    });
    Object.assign(container, { renewActivityTimeout });

    const expiry = container.onActivityExpired();
    await healthStarted.promise;
    const wake = container.wakeRuntime({
      attemptId: "attempt_racing_wake",
      leaseGeneration: "1",
      userId: "member_123",
    });
    releaseHealth.resolve();

    await expect(wake).resolves.toMatchObject({ kind: "accepted" });
    await expect(expiry).resolves.toBeUndefined();
    expect(destroy).not.toHaveBeenCalled();
    expect(renewActivityTimeout).toHaveBeenCalledTimes(2);
  });

  it("does not destroy when a runtime wake races the final status check", async () => {
    const finalStatusStarted = createDeferred<void>();
    const releaseFinalStatus = createDeferred<void>();
    let statusReadCount = 0;
    const getState = vi.fn(async () => {
      statusReadCount += 1;
      if (statusReadCount === 2) {
        finalStatusStarted.resolve();
        await releaseFinalStatus.promise;
      }
      return {
        lastChange: Date.now(),
        status: "running" as const,
      };
    });
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        return new Response(null, {
          headers: {
            "x-runtime-wake-accepted": "1",
            "x-runtime-wake-identity-checked": "1",
          },
          status: 204,
        });
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const renewActivityTimeout = vi.fn();
    const { container, destroy } = createContainerDouble({
      containerFetch,
      getState,
      initialStatus: "running",
    });
    Object.assign(container, { renewActivityTimeout });

    const expiry = container.onActivityExpired();
    await finalStatusStarted.promise;
    await expect(container.wakeRuntime({
      attemptId: "attempt_final_status_wake",
      leaseGeneration: "1",
      userId: "member_123",
    })).resolves.toMatchObject({ kind: "accepted" });
    releaseFinalStatus.resolve();

    await expect(expiry).resolves.toBeUndefined();
    expect(destroy).not.toHaveBeenCalled();
    expect(renewActivityTimeout).toHaveBeenCalledTimes(2);
  });

  it("does not destroy when a pointerless wake completes during the final status check", async () => {
    const wakeStarted = createDeferred<void>();
    const wakeResponse = createDeferred<Response>();
    const finalStatusStarted = createDeferred<void>();
    const releaseFinalStatus = createDeferred<void>();
    let statusReadCount = 0;
    const getState = vi.fn(async () => {
      statusReadCount += 1;
      if (statusReadCount === 2) {
        finalStatusStarted.resolve(undefined);
        await releaseFinalStatus.promise;
      }
      return {
        lastChange: Date.now(),
        status: "running" as const,
      };
    });
    const containerFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createRunnerHealthResult()), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.endsWith("/internal/runtime-wake")) {
        wakeStarted.resolve(undefined);
        return await wakeResponse.promise;
      }
      throw new Error(`Unexpected runner request URL: ${url}`);
    });
    const { container, destroy } = createContainerDouble({
      containerFetch,
      getState,
      initialStatus: "running",
    });

    const wake = container.wakeRuntime({
      attemptId: "attempt_wake_before_final_status",
      leaseGeneration: "1",
      userId: "member_123",
    });
    await wakeStarted.promise;
    const expiry = container.onActivityExpired();
    await finalStatusStarted.promise;

    wakeResponse.resolve(new Response(null, {
      headers: {
        "x-runtime-wake-accepted": "1",
        "x-runtime-wake-identity-checked": "1",
      },
      status: 204,
    }));
    await expect(wake).resolves.toMatchObject({ kind: "accepted" });
    releaseFinalStatus.resolve(undefined);

    await expect(expiry).resolves.toBeUndefined();
    expect(destroy).not.toHaveBeenCalled();
  });

  it.each([
    ["cold", "stopped"],
    ["warm", "running"],
  ] as const)("consumes readiness health responses for %s containers so they can become idle", async (
    _label,
    initialStatus,
  ) => {
    const healthResponse = new Response(JSON.stringify(createRunnerHealthResult()), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    });
    const { container } = createContainerDouble({
      containerFetch: vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return healthResponse;
        }

        return new Response(JSON.stringify(createRunnerResult()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }),
      initialStatus,
    });

    await container.invoke({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_health_body_consumed"),
      },
      timeoutMs: 60_000,
      userId: "member_123",
    });

    expect(healthResponse.bodyUsed).toBe(true);
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

  it("retries a prepared invocation once when the warm runner is shutting down", async () => {
    let workspaceInvocationCount = 0;
    const { container, containerFetch, destroy, startAndWaitForPorts } =
      createContainerDouble({
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            return new Response(JSON.stringify(createRunnerHealthResult()), {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            });
          }

          workspaceInvocationCount += 1;
          if (workspaceInvocationCount === 1) {
            return new Response(JSON.stringify({
              code: HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
              error: "Hosted runner is shutting down.",
            }), {
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
    const getByName = vi.fn((_name: string): HostedExecutionContainerStubLike => container);

    await expect(invokeHostedExecutionContainerRunner({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_shutdown_retry"),
      },
      runnerContainerNamespace: { getByName },
      timeoutMs: 45_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    expect(getByName).toHaveBeenCalledOnce();
    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls).toHaveLength(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(2);
  });

  it("keeps the shutdown replacement retry when warm cleanup rejects", async () => {
    let workspaceInvocationCount = 0;
    let stateReadCount = 0;
    const { container, containerFetch, destroy, startAndWaitForPorts } =
      createContainerDouble({
        destroy: vi.fn(async () => {
          throw new Error("destroy failed after runner shutdown");
        }),
        getState: vi.fn(async () => {
          stateReadCount += 1;
          return {
            lastChange: Date.now(),
            status: stateReadCount <= 2 ? "running" : "stopped",
          };
        }),
        startAndWaitForPorts: vi.fn(async () => {}),
        containerFetch: vi.fn(async (url: string) => {
          if (url.endsWith("/health")) {
            return new Response(JSON.stringify(createRunnerHealthResult()), {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            });
          }

          workspaceInvocationCount += 1;
          if (workspaceInvocationCount === 1) {
            return new Response(JSON.stringify({
              code: HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
              error: "Hosted runner is shutting down.",
            }), {
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
    const getByName = vi.fn((_name: string): HostedExecutionContainerStubLike => container);

    await expect(invokeHostedExecutionContainerRunner({
      job: {
        kind: "workspace-invocation",
        request: createRunnerRequest("evt_shutdown_retry_cleanup_rejects"),
      },
      runnerContainerNamespace: { getByName },
      timeoutMs: 45_000,
      userId: "member_123",
    })).resolves.toEqual(createRunnerResult());

    const executeCalls = containerFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/workspace-invocation")
    );
    expect(executeCalls).toHaveLength(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(startAndWaitForPorts).toHaveBeenCalledTimes(1);
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
          return new Response(JSON.stringify(createRunnerHealthResult()), {
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
    >(async () => "accepted");
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
      leaseGeneration: job.request.leaseGeneration,
      userId: "member_foreground_abort",
    });
    expect(destroyInstance).not.toHaveBeenCalled();
  });

  it("does not wait for timed-out container destroy cleanup before rejecting", async () => {
    const abortController = new AbortController();
    const abortWorkspaceInvocation = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["abortWorkspaceInvocation"]>
    >(async () => "accepted");
    const destroyInstance = vi.fn(async () => {
      await new Promise<void>(() => undefined);
    });
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

    const invocation = invokeHostedExecutionContainerRunner({
      job: createWorkspaceRunnerJob("member_hard_timeout"),
      runnerContainerNamespace: { getByName },
      signal: abortController.signal,
      timeoutMs: 45_000,
      userId: "member_hard_timeout",
    });

    abortController.abort(new DOMException("The operation timed out.", "TimeoutError"));

    await expect(invocation).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(destroyInstance).toHaveBeenCalledTimes(1);
    expect(abortWorkspaceInvocation).not.toHaveBeenCalled();
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

interface CreateContainerDoubleInput {
  containerClass?: typeof RunnerContainer;
  containerFetch?: ReturnType<typeof vi.fn>;
  destroy?: ReturnType<typeof vi.fn>;
  env?: Record<string, unknown>;
  getState?: ReturnType<typeof vi.fn>;
  initialStatus?: "running" | "stopped" | "stopped_with_code";
  platformRunning?: boolean;
  start?: ReturnType<typeof vi.fn>;
  storage?: ContainerStorageDouble;
  startAndWaitForPorts?: ReturnType<typeof vi.fn>;
  state?: Record<string, unknown>;
}

function createContainerDouble(input: CreateContainerDoubleInput = {}) {
  let currentStatus = input.initialStatus ?? "stopped";
  const platformContainer = input.platformRunning === undefined
    ? undefined
    : {
        get running(): boolean {
          return input.platformRunning === true;
        },
      };
  const ContainerClass = input.containerClass ?? RunnerContainer;
  const storage = input.storage ?? createContainerStorageDouble();
  const container = new ContainerClass({
    ...(platformContainer ? { container: platformContainer } : {}),
    storage,
    ...(input.state ?? {}),
  } as never, {
    ...(input.env ?? {}),
  } as never);
  const containerFetch = input.containerFetch ?? vi.fn(async (url: string) => {
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify(createRunnerHealthResult()), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    }

    if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
      return new Response(JSON.stringify({
        codexShell: createCodexShellSmokeResult(),
        ok: true,
      }), {
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
  const start = input.start ?? vi.fn(async () => {
    currentStatus = "running";
  });

  Object.assign(container, {
    containerFetch,
    destroy,
    getState,
    start,
    startAndWaitForPorts,
    storage,
  });

  return {
    container,
    containerFetch,
    destroy,
    getState,
    storage,
    start,
    startAndWaitForPorts,
  };
}

async function createPreservedWorkspaceInvocationAfterLostResponse(eventId: string) {
  let runnerResponseLost = false;
  let containerGone = false;
  const getState = vi.fn(async () => {
    if (containerGone) {
      throw new Error("No such container");
    }
    return {
      lastChange: Date.now(),
      status: "running",
    };
  });
  const containerFetch = vi.fn(async (url: string) => {
    if (url.endsWith("/health")) {
      if (containerGone) {
        throw new Error("No such container");
      }
      return new Response(JSON.stringify({
        ...createRunnerHealthResult(),
        activeJobCount: runnerResponseLost ? 1 : 0,
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    }

    if (!url.endsWith("/internal/workspace-invocation")) {
      throw new Error(`Unexpected runner request URL: ${url}`);
    }

    runnerResponseLost = true;
    throw new Error("Network connection lost");
  });
  const result = createContainerDouble({
    containerFetch,
    getState,
    initialStatus: "running",
  });
  const request = createRunnerRequest(eventId);

  await expect(result.container.invoke({
    job: {
      kind: "workspace-invocation",
      request,
    },
    timeoutMs: 30_000,
    userId: "member_123",
  })).rejects.toThrow("Network connection lost");

  expect(result.startAndWaitForPorts).not.toHaveBeenCalled();
  expect(result.destroy).not.toHaveBeenCalled();

  return {
    ...result,
    markContainerGone: () => {
      containerGone = true;
    },
    request,
  };
}

function createDeploySmokeContainerDouble(
  input: Omit<CreateContainerDoubleInput, "containerClass"> = {},
) {
  const result = createContainerDouble({
    ...input,
    containerClass: DeploySmokeRunnerContainer,
  });
  return {
    ...result,
    container: result.container as DeploySmokeRunnerContainer,
  };
}

function createCodexShellSmokeResult() {
  return {
    cliSurfaceContractBytes: 37282,
    cliSurfaceHotPathProofCount: 4,
    client: "codex-app-server",
    murphPathBytes: 28,
    noteAddBytes: 128,
    stderrBytes: 0,
    vaultCliLlmsBytes: 4096,
    vaultCliPathBytes: 32,
    vaultShowBytes: 256,
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

function createRunnerHealthResult(): Record<string, unknown> {
  return {
    activeJobCount: 0,
    conversationWarmActivityCompletedAtEpochMs: null,
    hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    ok: true,
  };
}
