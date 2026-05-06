import { Container, type OutboundHandlerContext, type StopParams } from "@cloudflare/containers";
import {
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
  type HostedExecutionStructuredLogDetails,
  type HostedExecutionStructuredLogDetailValue,
} from "@murphai/hosted-execution";
import {
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "./internal-hosts.ts";
import { methodNotAllowed } from "./json.ts";
import {
  buildLocalInternalProxyRouteBaseUrl,
} from "./local-internal-proxy-route.ts";
import { buildHostedRunnerSupervisorEnv } from "./runner-env.ts";
import { handleRunnerOutboundRequest, type RunnerOutboundEnvironmentSource } from "./runner-outbound.ts";
import {
  assertHostedExecutionRunnerJobResult,
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionRunnerJobInput,
  type HostedExecutionRunnerJobResult,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_HEALTH_URL = "http://container/health";
const RUNNER_EXECUTE_URL = "http://container/internal/workspace-invocation";
const RUNNER_WAIT_INTERVAL_MS = 250;
const DEFAULT_RUNNER_READY_TIMEOUT_MS = 20_000;
const RUNNER_DESTROY_TIMEOUT_MS = 5_000;
const DEFAULT_RUNNER_IDLE_TTL_MS = 300_000;
const RUNNER_DESTROY_STATUS_SAMPLE_LIMIT = 8;
const OUTBOUND_HANDLER_INSTALL_RETRY_LIMIT = 5;
const OUTBOUND_HANDLER_INSTALL_RETRY_DELAY_MS = 250;
const MIN_RUNNER_IDLE_TTL_MS = 1_000;
const RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 30_000;
const MIN_RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 250;

export class HostedExecutionConfigurationError extends Error {
  readonly code: string | null;
  readonly details: HostedExecutionStructuredLogDetails | null;
  readonly statusCode: number | null;

  constructor(
    message: string,
    code: string | null = null,
    options: {
      details?: HostedExecutionStructuredLogDetails | null;
      statusCode?: number | null;
    } = {},
  ) {
    super(message);
    this.code = code;
    this.details = options.details ?? null;
    this.name = "HostedExecutionConfigurationError";
    this.statusCode = options.statusCode ?? null;
  }
}

interface HostedExecutionContainerInvokeRequest {
  job: HostedExecutionRunnerJobInput;
  timeoutMs: number;
  userId: string;
}

type HostedExecutionContainerInvokeInput = HostedExecutionContainerInvokeRequest;

interface HostedExecutionContainerRunnerInput {
  job: HostedExecutionRunnerJobInput;
  runnerContainerName?: string;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  timeoutMs: number;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  destroyInstance(): Promise<void>;
  invoke(input: HostedExecutionContainerInvokeRequest): Promise<HostedExecutionRunnerJobResult>;
  ownsInternalWorkerProxyToken(input: {
    attemptId?: string;
    leaseGeneration?: string;
    token: string;
    userId?: string;
  }): Promise<boolean>;
  smokeHealth(): Promise<HostedExecutionContainerSmokeHealthResult>;
}

export interface HostedExecutionContainerNamespaceLike {
  getByName(name: string): HostedExecutionContainerStubLike;
}

type RunnerOutboundHandlerContext = OutboundHandlerContext<{
  internalWorkerProxyToken?: unknown;
  userId?: unknown;
} | undefined>;

type RunnerContainerEnvironmentSource = Readonly<Record<string, unknown>>;
type RunnerContainerNameSource = Readonly<{ CF_VERSION_METADATA?: unknown }>;

interface RunnerContainerLogContext {
  userId: string;
}

interface RunnerContainerStopWaitResult {
  lastStatus: string | null;
  observedStatuses: string[];
  pollCount: number;
}

interface HostedExecutionContainerSmokeHealthResult {
  ok: boolean;
  runnerBundle: {
    buildSkipped?: boolean;
    bundleFingerprint?: string;
    generatedAt?: string;
    schemaVersion?: number;
    sourceFingerprint?: string;
  } | null;
  service: string | null;
  status: number;
}

interface RunnerActivityTimeoutRenewable {
  renewActivityTimeout(): void;
}

// Cloudflare rolls Worker code ahead of container instances, so keep the
// worker/container outbound contract to one stable handler method.
const RUNNER_OUTBOUND_HANDLER_METHOD = "internalWorkerProxy";

const RUNNER_OUTBOUND_HOSTS = Object.values(CLOUDFLARE_HOSTED_RUNTIME_HOSTS);
const HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL_ENV =
  "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL";

export class RunnerContainer extends Container {
  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  sleepAfter = formatRunnerSleepAfter(DEFAULT_RUNNER_IDLE_TTL_MS);

  private readonly environment: RunnerContainerEnvironmentSource;
  private lifecycleLock: Promise<void> = Promise.resolve();
  private currentLogContext: RunnerContainerLogContext | null = null;
  private runnerControlToken: string | null = null;
  private runnerOutboundProxyState: RunnerOutboundProxyState | null = null;
  private installedRunnerOutboundProxyState: RunnerOutboundProxyState | null = null;
  private activeInvocationCount = 0;
  private lastRunnerActivityAt = 0;

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.environment = env;
    this.sleepAfter = formatRunnerSleepAfter(readRunnerIdleTtlMs(env));
  }

  async invoke(
    payload: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedExecutionRunnerJobResult> {
    return this.withLifecycleLock(async () =>
      this.invokeHostedExecution(parseHostedExecutionContainerInvokeInput(payload))
    );
  }

  async destroyInstance(): Promise<void> {
    await this.withLifecycleLock(async () => {
      await this.stopWarmContainer();
    });
  }

  async smokeHealth(): Promise<HostedExecutionContainerSmokeHealthResult> {
    return await this.withLifecycleLock(async () => {
      const readyTimeoutMs = readRunnerReadyTimeoutMs(this.environment);

      try {
        await this.stopWarmContainer({ failClosed: false });
        await this.ensureSmokeContainerReady(readyTimeoutMs);
        const response = await this.containerFetch(
          RUNNER_HEALTH_URL,
          {
            signal: AbortSignal.timeout(readyTimeoutMs),
          },
          RUNNER_PORT,
        );
        const payload = await response.json() as {
          ok?: unknown;
          runnerBundle?: unknown;
          service?: unknown;
        };

        if (!response.ok || payload.ok !== true) {
          throw new Error(`Hosted runner container smoke health failed with HTTP ${response.status}.`);
        }

        return {
          ok: true,
          runnerBundle: parseRunnerContainerSmokeBundle(payload.runnerBundle),
          service: typeof payload.service === "string" ? payload.service : null,
          status: response.status,
        };
      } finally {
        await this.stopWarmContainer({ failClosed: false });
      }
    });
  }

  async ownsInternalWorkerProxyToken(input: {
    attemptId?: string;
    leaseGeneration?: string;
    token: string;
    userId?: string;
  }): Promise<boolean> {
    return isRunnerOutboundProxyStateMatch(this.runnerOutboundProxyState, input);
  }

  override async onActivityExpired(): Promise<void> {
    await this.withLifecycleLock(async () => {
      const idleTtlMs = readRunnerIdleTtlMs(this.environment);
      const idleElapsedMs = this.lastRunnerActivityAt > 0
        ? Math.max(0, Date.now() - this.lastRunnerActivityAt)
        : null;

      if (this.activeInvocationCount > 0 || (idleElapsedMs !== null && idleElapsedMs < idleTtlMs)) {
        const activityTimeoutRenewed = this.noteRunnerActivity("activity-expired-stale");
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            activeInvocationCount: this.activeInvocationCount,
            activityTimeoutRenewed,
            idleElapsedMs,
            runnerIdleTtlMs: idleTtlMs,
          },
          message: "Hosted execution container activity expiry was stale; keeping warm shell.",
          phase: "container.ready",
          userId: this.currentLogContext?.userId,
        });
        return;
      }

      await this.stopWarmContainer({ failClosed: false });
    });
  }

  override onStart(): void {
    const context = this.currentLogContext;
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        lifecycleStage: "onStart",
        runnerPort: RUNNER_PORT,
        sleepAfter: String(this.sleepAfter),
      },
      message: "Hosted execution container lifecycle hook reported start.",
      phase: "container.ready",
      userId: context?.userId,
    });
  }

  override onStop(params: StopParams): void {
    const context = this.currentLogContext;
    const cleanExit = params.exitCode === 0;
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        exitCode: params.exitCode,
        lifecycleStage: "onStop",
        runnerPort: RUNNER_PORT,
        stopReason: params.reason,
      },
      level: cleanExit ? "info" : "warn",
      message: cleanExit
        ? "Hosted execution container lifecycle hook reported stop."
        : "Hosted execution container lifecycle hook reported non-zero stop.",
      phase: cleanExit ? "container.ready" : "failed",
      userId: context?.userId,
    });
  }

  override onError(error: unknown): never {
    const context = this.currentLogContext;
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        lifecycleStage: "onError",
        runnerPort: RUNNER_PORT,
      },
      error,
      message: "Hosted execution container lifecycle hook reported an error.",
      phase: "failed",
      userId: context?.userId,
    });
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/workspace-invocation" || url.pathname === "/internal/destroy") {
      return methodNotAllowed();
    }

    return super.fetch(request);
  }

  private async invokeHostedExecution(
    input: HostedExecutionContainerInvokeInput,
  ): Promise<HostedExecutionRunnerJobResult> {
    const localInternalProxyBaseUrl = readOptionalRunnerContainerEnvString(
      this.environment,
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL_ENV,
    );
    const routeUserId = readHostedExecutionRunnerJobUserId(input.job);
    const logContext: RunnerContainerLogContext = {
      userId: routeUserId,
    };
    const outboundProxyState: RunnerOutboundProxyState = {
      attemptId: input.job.request.attemptId,
      leaseGeneration: input.job.request.leaseGeneration,
      token: createRunnerOutboundProxyToken(),
      userId: routeUserId,
    };
    let completedSuccessfully = false;
    this.currentLogContext = logContext;
    this.activeInvocationCount += 1;
    const stopRunnerActivityRenewal = this.startRunnerActivityRenewal();
    this.noteRunnerActivity("invoke-started");

    try {
      const startTime = Date.now();
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          hasLocalInternalProxyBaseUrl: localInternalProxyBaseUrl !== null,
          readyTimeoutMs: readRunnerReadyTimeoutMs(this.environment),
          workspaceAttemptId: input.job.request.attemptId,
          workspaceLeaseGeneration: input.job.request.leaseGeneration,
          workspaceReason: input.job.request.reason,
          workspaceVersion: input.job.request.workspaceVersion,
          runnerIdleTtlMs: readRunnerIdleTtlMs(this.environment),
          runnerPort: RUNNER_PORT,
          timeoutMs: input.timeoutMs,
        },
        message: "Hosted execution container invocation received.",
        phase: "container.starting",
        userId: routeUserId,
      });
      const runnerControlToken = await this.ensureContainerReady(input);
      this.noteRunnerActivity("container-ready");
      this.runnerOutboundProxyState = outboundProxyState;
      await this.installOutboundHandlers(outboundProxyState);

      const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - startTime));
      this.noteRunnerActivity("runner-request-starting");
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          remainingTimeoutMs,
        },
        message: "Hosted execution container sending runner request.",
        phase: "container.ready",
        userId: routeUserId,
      });
      const response = await this.containerFetch(
        RUNNER_EXECUTE_URL,
        {
          body: JSON.stringify({
            internalWorkerProxyToken: outboundProxyState.token,
            localInternalProxyBaseUrl: createChildLocalInternalProxyBaseUrl({
              localInternalProxyBaseUrl,
              userId: routeUserId,
            }),
            job: input.job,
          }),
          headers: {
            authorization: `Bearer ${runnerControlToken}`,
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
          signal: AbortSignal.timeout(remainingTimeoutMs),
        },
        RUNNER_PORT,
      );
      this.noteRunnerActivity("runner-response-received");
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          responseStatus: response.status,
        },
        message: "Hosted execution container received runner response.",
        phase: "container.ready",
        userId: routeUserId,
      });

      if (!response.ok) {
        throw await classifyHostedRunnerContainerErrorResponse(response);
      }

      const responsePayload = await response.json();
      const result = assertHostedExecutionRunnerJobResult(responsePayload, input.job);
      completedSuccessfully = true;
      return result;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        message: "Hosted execution container failed.",
        phase: "failed",
        userId: routeUserId,
      });
      throw error;
    } finally {
      try {
        const outboundProxyExpired = await this.expireOutboundProxyState(outboundProxyState);
        const shouldKeepWarm = completedSuccessfully && outboundProxyExpired;
        if (!shouldKeepWarm) {
          await this.stopWarmContainer({
            failClosed: true,
          });
        }
      } finally {
        this.noteRunnerActivity("invoke-finished");
        stopRunnerActivityRenewal();
        this.activeInvocationCount = Math.max(0, this.activeInvocationCount - 1);
        if (this.currentLogContext === logContext) {
          this.currentLogContext = null;
        }
      }
    }
  }

  private async ensureContainerReady(
    input: HostedExecutionContainerInvokeInput,
  ): Promise<string> {
    const readinessStartedAt = Date.now();
    const status = readContainerStatus(await this.getState());
    const readyTimeoutMs = readRunnerReadyTimeoutMs(this.environment);

    if (!isRunnerContainerStopped(status) && this.runnerControlToken) {
      try {
        await assertRunnerHealthy(this, Math.min(input.timeoutMs, readyTimeoutMs));
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            readinessLatencyMs: Date.now() - readinessStartedAt,
            readinessTimeoutMs: Math.min(input.timeoutMs, readyTimeoutMs),
            startMode: "warm",
            statusBeforeStart: status,
          },
          message: "Hosted execution container is ready.",
          phase: "container.ready",
          userId: input.userId,
        });
        return this.runnerControlToken;
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            readinessLatencyMs: Date.now() - readinessStartedAt,
            readinessTimeoutMs: Math.min(input.timeoutMs, readyTimeoutMs),
            startMode: "warm",
            statusBeforeStart: status,
          },
          error,
          level: "warn",
          message: "Hosted execution container warm health check failed; restarting shell.",
          phase: "container.starting",
          userId: input.userId,
        });
        await this.stopWarmContainer();
      }
    } else if (!isRunnerContainerStopped(status)) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          startMode: "cold",
          statusBeforeStart: status,
        },
        level: "warn",
        message: "Hosted execution container found a running shell without a control token; destroying before cold start.",
        phase: "container.starting",
        userId: input.userId,
      });
      await this.stopWarmContainer();
    }

    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        readinessPollIntervalMs: RUNNER_WAIT_INTERVAL_MS,
        readinessTimeoutMs: Math.min(
          Math.max(1, input.timeoutMs - (Date.now() - readinessStartedAt)),
          readyTimeoutMs,
        ),
        runnerPort: RUNNER_PORT,
        startMode: "cold",
        statusBeforeStart: status,
      },
      message: "Hosted execution container starting.",
      phase: "container.starting",
      userId: input.userId,
    });

    const runnerControlToken = crypto.randomUUID();
    const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - readinessStartedAt));
    const readinessTimeoutMs = Math.min(remainingTimeoutMs, readyTimeoutMs);
    try {
      await this.startAndWaitForPorts({
        cancellationOptions: {
          abort: AbortSignal.timeout(readinessTimeoutMs),
          instanceGetTimeoutMS: readinessTimeoutMs,
          portReadyTimeoutMS: readinessTimeoutMs,
          waitInterval: RUNNER_WAIT_INTERVAL_MS,
        },
        ports: RUNNER_PORT,
        startOptions: {
          enableInternet: true,
          envVars: buildHostedRunnerSupervisorEnv({
            port: RUNNER_PORT,
            runnerControlToken,
          }),
        },
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          readinessLatencyMs: Date.now() - readinessStartedAt,
          readinessPollIntervalMs: RUNNER_WAIT_INTERVAL_MS,
          readinessTimeoutMs,
          runnerPort: RUNNER_PORT,
          startMode: "cold",
          statusBeforeStart: status,
        },
        error,
        level: "error",
        message: "Hosted execution container failed to start or listen.",
        phase: "container.starting",
        userId: input.userId,
      });
      throw error;
    }
    this.runnerControlToken = runnerControlToken;

    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        readinessLatencyMs: Date.now() - readinessStartedAt,
        readinessPollIntervalMs: RUNNER_WAIT_INTERVAL_MS,
        readinessTimeoutMs,
        runnerPort: RUNNER_PORT,
        startMode: "cold",
        statusBeforeStart: status,
      },
      message: "Hosted execution container is ready.",
      phase: "container.ready",
      userId: input.userId,
    });

    return runnerControlToken;
  }

  private async ensureSmokeContainerReady(timeoutMs: number): Promise<void> {
    const status = readContainerStatus(await this.getState());

    if (!isRunnerContainerStopped(status)) {
      await assertRunnerHealthy(this, timeoutMs);
      return;
    }

    await this.startAndWaitForPorts({
      cancellationOptions: {
        abort: AbortSignal.timeout(timeoutMs),
        instanceGetTimeoutMS: timeoutMs,
        portReadyTimeoutMS: timeoutMs,
        waitInterval: RUNNER_WAIT_INTERVAL_MS,
      },
      ports: RUNNER_PORT,
      startOptions: {
        enableInternet: true,
        envVars: buildHostedRunnerSupervisorEnv({
          port: RUNNER_PORT,
        }),
      },
    });
  }

  private async installOutboundHandlers(
    state: RunnerOutboundProxyState,
  ): Promise<void> {
    if (isSameRunnerOutboundProxyState(this.installedRunnerOutboundProxyState, state)) {
      return;
    }

    const mapping = Object.fromEntries(
      RUNNER_OUTBOUND_HOSTS.map((host) => [
        host,
        {
          method: RUNNER_OUTBOUND_HANDLER_METHOD,
          params: {
            internalWorkerProxyToken: state.token,
            userId: state.userId,
          },
        },
      ]),
    );

    for (let attempt = 1; attempt <= OUTBOUND_HANDLER_INSTALL_RETRY_LIMIT; attempt += 1) {
      try {
        await this.setOutboundByHosts(mapping);
        if (attempt > 1) {
          emitHostedExecutionStructuredLog({
            component: "container",
            details: {
              outboundHandlerInstallAttempt: attempt,
              outboundHandlerInstallRetryCount: attempt - 1,
            },
            message: "Hosted execution container outbound handlers recovered after retry.",
            phase: "container.ready",
          });
        }
        this.installedRunnerOutboundProxyState = state;
        return;
      } catch (error) {
        if (
          attempt >= OUTBOUND_HANDLER_INSTALL_RETRY_LIMIT
          || !isTransientOutboundHandlerInstallError(error)
        ) {
          throw error;
        }

        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            outboundHandlerInstallAttempt: attempt,
            outboundHandlerInstallRetryDelayMs: OUTBOUND_HANDLER_INSTALL_RETRY_DELAY_MS,
          },
          error,
          level: "warn",
          message:
            "Hosted execution container outbound handler installation hit a transient sidecar error; retrying.",
          phase: "container.ready",
        });
        await sleep(OUTBOUND_HANDLER_INSTALL_RETRY_DELAY_MS);
      }
    }
  }

  private async expireOutboundProxyState(
    state: RunnerOutboundProxyState,
  ): Promise<boolean> {
    if (isSameRunnerOutboundProxyState(this.runnerOutboundProxyState, state)) {
      this.runnerOutboundProxyState = null;
    }

    if (!isSameRunnerOutboundProxyState(this.installedRunnerOutboundProxyState, state)) {
      return true;
    }

    try {
      await this.setOutboundByHosts({});
      this.installedRunnerOutboundProxyState = null;
      return true;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "error",
        message: "Hosted execution container failed to expire outbound handlers.",
        phase: "failed",
      });
      return false;
    }
  }

  private async destroyIfRunning(input: {
    failClosed?: boolean;
  } = {}): Promise<void> {
    const failClosed = Boolean(input.failClosed);
    const context = this.currentLogContext;
    let statusBeforeDestroy: string | null = null;

    try {
      statusBeforeDestroy = await readRunnerContainerStatus(this);
      if (isRunnerContainerStopped(statusBeforeDestroy)) {
        return;
      }
    } catch (error) {
      emitRunnerContainerLifecycleFailure({
        destroyLatencyMs: null,
        destroyTimeoutMs: RUNNER_DESTROY_TIMEOUT_MS,
        error,
        failClosed,
        context,
        message: "Hosted execution container failed while checking its lifecycle state.",
        statusBeforeDestroy,
        stage: "status",
      });
      if (failClosed) {
        throw new Error("Hosted runner container failed to destroy cleanly.");
      }
      return;
    }

    const destroyStartedAt = Date.now();
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        destroyTimeoutMs: RUNNER_DESTROY_TIMEOUT_MS,
        failClosed,
        lifecycleStage: "destroy-requested",
        statusBeforeDestroy,
      },
      message: "Hosted execution container destroy requested.",
      phase: "container.ready",
      userId: context?.userId,
    });

    try {
      await this.destroy();
    } catch (error) {
      if (isMissingRunnerContainerError(error)) {
        return;
      }
      emitRunnerContainerLifecycleFailure({
        destroyLatencyMs: Date.now() - destroyStartedAt,
        destroyTimeoutMs: RUNNER_DESTROY_TIMEOUT_MS,
        error,
        failClosed,
        context,
        message: "Hosted execution container destroy request failed.",
        statusBeforeDestroy,
        stage: "destroy",
      });
    }

    try {
      const stopWait = await waitForRunnerContainerStop(this, RUNNER_DESTROY_TIMEOUT_MS);
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          destroyLatencyMs: Date.now() - destroyStartedAt,
          destroyPollCount: stopWait.pollCount,
          destroyTimeoutMs: RUNNER_DESTROY_TIMEOUT_MS,
          failClosed,
          lifecycleStage: "stopped",
          observedStatuses: stopWait.observedStatuses,
          statusAfterDestroy: stopWait.lastStatus,
          statusBeforeDestroy,
        },
        message: "Hosted execution container destroy confirmed stopped.",
        phase: "container.ready",
        userId: context?.userId,
      });
    } catch (error) {
      if (isMissingRunnerContainerError(error)) {
        return;
      }
      emitRunnerContainerLifecycleFailure({
        destroyLatencyMs: Date.now() - destroyStartedAt,
        destroyTimeoutMs: RUNNER_DESTROY_TIMEOUT_MS,
        error,
        failClosed,
        context,
        message: "Hosted execution container destroy did not stop the shell.",
        statusBeforeDestroy,
        stage: "wait-for-stop",
      });
      if (failClosed) {
        throw new Error("Hosted runner container failed to destroy cleanly.");
      }
      return;
    }
  }

  private async stopWarmContainer(input?: {
    failClosed?: boolean;
  }): Promise<void> {
    const failClosed = input?.failClosed ?? true;
    this.runnerControlToken = null;
    this.runnerOutboundProxyState = null;
    this.installedRunnerOutboundProxyState = null;
    await this.destroyIfRunning({ failClosed });
  }

  private startRunnerActivityRenewal(): () => void {
    const idleTtlMs = readRunnerIdleTtlMs(this.environment);
    const intervalMs = Math.max(
      MIN_RUNNER_ACTIVITY_RENEW_INTERVAL_MS,
      Math.min(RUNNER_ACTIVITY_RENEW_INTERVAL_MS, Math.floor(idleTtlMs / 2)),
    );
    const interval = setInterval(() => {
      this.noteRunnerActivity("invoke-heartbeat");
    }, intervalMs);

    return () => {
      clearInterval(interval);
    };
  }

  private noteRunnerActivity(stage: string): boolean {
    this.lastRunnerActivityAt = Date.now();
    const renewActivityTimeout =
      (this as RunnerContainer & Partial<RunnerActivityTimeoutRenewable>).renewActivityTimeout;

    if (typeof renewActivityTimeout !== "function") {
      return false;
    }

    try {
      renewActivityTimeout.call(this);
      return true;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          activityStage: stage,
        },
        error,
        level: "warn",
        message: "Hosted execution container failed to renew activity timeout.",
        phase: "container.ready",
        userId: this.currentLogContext?.userId,
      });
      return false;
    }
  }

  private async withLifecycleLock<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lifecycleLock.then(work, work);
    this.lifecycleLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

RunnerContainer.outboundHandlers = {
  [RUNNER_OUTBOUND_HANDLER_METHOD]: createRunnerOutboundHandler(),
};

export async function invokeHostedExecutionContainerRunner(
  input: HostedExecutionContainerRunnerInput & { job: HostedExecutionWorkspaceInvocationJobInput },
): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
export async function invokeHostedExecutionContainerRunner(
  input: HostedExecutionContainerRunnerInput,
): Promise<HostedExecutionRunnerJobResult>;
export async function invokeHostedExecutionContainerRunner(
  input: HostedExecutionContainerRunnerInput,
): Promise<HostedExecutionRunnerJobResult> {
  const jobUserId = readHostedExecutionRunnerJobUserId(input.job);
  if (input.userId !== jobUserId) {
    throw new TypeError("Hosted runner container route userId must match workspace job userId.");
  }

  return input.runnerContainerNamespace.getByName(input.runnerContainerName ?? jobUserId).invoke({
    job: input.job,
    timeoutMs: input.timeoutMs,
    userId: jobUserId,
  });
}

async function classifyHostedRunnerContainerErrorResponse(
  response: Response,
): Promise<Error> {
  let payload: {
    code?: unknown;
    details?: unknown;
    error?: unknown;
    errorName?: unknown;
  } | null = null;
  let responseBodyPreview: string | null = null;

  try {
    payload = await response.clone().json() as {
      code?: unknown;
      error?: unknown;
    };
  } catch {
    payload = null;
  }

  if (!payload) {
    try {
      const raw = await response.clone().text();
      const trimmed = raw.trim();
      responseBodyPreview = trimmed.length > 0 ? trimmed.slice(0, 500) : null;
    } catch {
      responseBodyPreview = null;
    }
  }

  const code = typeof payload?.code === "string" && payload.code.trim().length > 0
    ? payload.code
    : null;
  const details = sanitizeHostedExecutionStructuredLogDetails({
    ...(payload?.details && typeof payload.details === "object" && !Array.isArray(payload.details)
      ? payload.details as HostedExecutionStructuredLogDetails
      : {}),
    ...(responseBodyPreview ? { responseBodyPreview } : {}),
  });
  const message = typeof payload?.error === "string" && payload.error.trim().length > 0
    ? formatHostedRunnerContainerErrorMessage({
        code,
        details,
        message: payload.error,
        status: response.status,
      })
    : responseBodyPreview
      ? `Hosted runner container returned HTTP ${response.status}: ${responseBodyPreview.slice(0, 200)}`
      : `Hosted runner container returned HTTP ${response.status}.`;
  const payloadErrorName = typeof payload?.errorName === "string" && payload.errorName.trim().length > 0
    ? payload.errorName.trim()
    : null;
  const codeErrorName = readHostedExecutionErrorNameForCode(code);
  const errorName = codeErrorName && (!payloadErrorName || payloadErrorName === "Error")
    ? codeErrorName
    : payloadErrorName ?? codeErrorName;

  if (response.status === 503) {
    return new HostedExecutionConfigurationError(message, code, {
      details,
      statusCode: response.status,
    });
  }

  const error = new Error(message) as Error & {
    code?: string | null;
    details?: HostedExecutionStructuredLogDetails | null;
    status?: number;
    statusCode?: number;
  };
  if (code) {
    error.code = code;
  }
  if (details) {
    error.details = details;
  }
  if (errorName) {
    error.name = errorName;
  }
  error.status = response.status;
  error.statusCode = response.status;
  return error;
}

function formatHostedRunnerContainerErrorMessage(input: {
  code: string | null;
  details: HostedExecutionStructuredLogDetails | null;
  message: string;
  status: number;
}): string {
  const fragments = [input.message];
  const detail = readHostedRunnerContainerDiagnosticFragment(input.details?.errorDetail, {
    redactEnvKeys: true,
  });
  const cause = readHostedRunnerContainerDiagnosticFragment(input.details?.errorCause, {
    redactEnvKeys: true,
  });
  const code = readHostedRunnerContainerDiagnosticFragment(
    input.details?.errorCodeDetail ?? input.code,
    { redactEnvKeys: false },
  );

  if (detail) {
    fragments.push(`Detail: ${detail}`);
  }
  if (cause) {
    fragments.push(`Cause: ${cause}`);
  }
  if (code) {
    fragments.push(`Code: ${code}`);
  }
  fragments.push(`Status: ${readHostedRunnerContainerDiagnosticStatus(input.details) ?? input.status}`);

  return joinHostedRunnerContainerErrorFragments(fragments);
}

function readHostedRunnerContainerDiagnosticFragment(
  value: HostedExecutionStructuredLogDetailValue | undefined,
  options: {
    redactEnvKeys: boolean;
  },
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = sanitizeHostedExecutionStructuredLogText(value);
  return sanitized && options.redactEnvKeys
    ? redactHostedRunnerContainerInlineEnvKeys(sanitized)
    : sanitized;
}

function readHostedRunnerContainerDiagnosticStatus(
  details: HostedExecutionStructuredLogDetails | null,
): number | null {
  const status = details?.errorStatus;
  return typeof status === "number"
    && Number.isInteger(status)
    && status >= 100
    && status <= 599
    ? status
    : null;
}

function joinHostedRunnerContainerErrorFragments(
  fragments: readonly string[],
): string {
  const joined: string[] = [];

  for (const fragment of fragments) {
    const normalized = sanitizeHostedExecutionStructuredLogText(fragment);
    if (!normalized) {
      continue;
    }

    const fragmentWithPeriod = normalized.endsWith(".") ? normalized : `${normalized}.`;
    if (joined.some((existing) => hostedRunnerContainerFragmentsOverlap(existing, fragmentWithPeriod))) {
      continue;
    }

    joined.push(fragmentWithPeriod);
  }

  return joined.join(" ");
}

function redactHostedRunnerContainerInlineEnvKeys(value: string): string {
  return value
    .replace(
      /\bruntime\.(userEnv|forwardedEnv|platformEnv)\.[A-Z][A-Z0-9_]{1,127}\b/gu,
      "runtime.$1.[redacted-env-key]",
    )
    .replace(
      /\b[A-Z][A-Z0-9_]{0,127}(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSCODE|COOKIE|SET_COOKIE|ENCRYPTION_KEY)\b/gu,
      "[redacted-env-key]",
    );
}

function hostedRunnerContainerFragmentsOverlap(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();

  return normalizedLeft.length > 0
    && normalizedRight.length > 0
    && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft));
}

function createRunnerOutboundHandler() {
  return async (
    request: Request,
    env: unknown,
    ctx: RunnerOutboundHandlerContext,
  ): Promise<Response> => {
    return handleRunnerOutboundRequest(
      request,
      env as RunnerOutboundEnvironmentSource,
      requireString(ctx.params?.userId, "ctx.params.userId"),
      requireString(
        ctx.params?.internalWorkerProxyToken,
        "ctx.params.internalWorkerProxyToken",
      ),
    );
  };
}

function readOptionalRunnerContainerEnvString(
  env: RunnerContainerEnvironmentSource,
  key: string,
): string | null {
  const value = env[key];
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function createRunnerOutboundProxyToken(): string {
  return crypto.randomUUID();
}

function emitRunnerContainerLifecycleFailure(input: {
  context: RunnerContainerLogContext | null;
  destroyLatencyMs: number | null;
  destroyTimeoutMs: number;
  error: unknown;
  failClosed: boolean;
  message: string;
  statusBeforeDestroy: string | null;
  stage: "destroy" | "status" | "wait-for-stop";
}): void {
  emitHostedExecutionStructuredLog({
    component: "container",
    details: {
      destroyLatencyMs: input.destroyLatencyMs,
      destroyTimeoutMs: input.destroyTimeoutMs,
      failClosed: input.failClosed,
      lifecycleStage: input.stage,
      statusBeforeDestroy: input.statusBeforeDestroy,
    },
    error: input.error,
    level: input.failClosed ? "error" : "warn",
    message: input.message,
    phase: "failed",
    userId: input.context?.userId,
  });
}

function createChildLocalInternalProxyBaseUrl(input: {
  localInternalProxyBaseUrl: string | null;
  userId: string;
}): string | null {
  if (!input.localInternalProxyBaseUrl) {
    return null;
  }

  return buildLocalInternalProxyRouteBaseUrl({
    baseUrl: input.localInternalProxyBaseUrl,
    userId: input.userId,
  });
}

export async function destroyHostedExecutionContainer(input: {
  runnerContainerName?: string;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  userId: string;
}): Promise<{
  attempted: boolean;
  errorCode: string | null;
  ok: boolean;
}> {
  if (!input.runnerContainerNamespace) {
    return {
      attempted: false,
      errorCode: null,
      ok: true,
    };
  }

  try {
    await input.runnerContainerNamespace.getByName(input.runnerContainerName ?? input.userId).destroyInstance();
    return {
      attempted: true,
      errorCode: null,
      ok: true,
    };
  } catch (error) {
    // best-effort cleanup only
    return {
      attempted: true,
      errorCode: error instanceof Error && error.name ? error.name : "UnknownError",
      ok: false,
    };
  }
}

export function resolveHostedExecutionRunnerContainerName(input: {
  source: RunnerContainerNameSource;
  userId: string;
}): string {
  const workerVersionSegment = readRunnerContainerWorkerVersionSegment(input.source);
  return workerVersionSegment
    ? `${input.userId}--v-${workerVersionSegment}`
    : input.userId;
}

function readRunnerContainerWorkerVersionSegment(source: RunnerContainerNameSource): string | null {
  const metadata = source.CF_VERSION_METADATA;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const versionId = (metadata as { id?: unknown }).id;
  return typeof versionId === "string"
    ? sanitizeRunnerContainerNameSegment(versionId)
    : null;
}

function sanitizeRunnerContainerNameSegment(value: string): string | null {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : null;
}

function parseHostedExecutionContainerInvokeInput(
  payload: {
    job?: unknown;
    timeoutMs?: unknown;
    userId?: unknown;
  },
): HostedExecutionContainerInvokeInput {
  const job = parseHostedExecutionRunnerJobInput(payload.job);
  const userId = requireString(payload.userId, "payload.userId");
  const jobUserId = readHostedExecutionRunnerJobUserId(job);

  if (userId !== jobUserId) {
    throw new TypeError("Hosted runner container invoke userId must match workspace job userId.");
  }

  return {
    job,
    timeoutMs: readTimeoutMs(payload.timeoutMs, DEFAULT_RUNNER_READY_TIMEOUT_MS),
    userId,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readTimeoutMs(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new TypeError("timeoutMs must be a positive number.");
  }

  return Math.trunc(value);
}

async function assertRunnerHealthy(
  container: RunnerContainer,
  timeoutMs: number,
): Promise<void> {
  const response = await container.containerFetch(
    RUNNER_HEALTH_URL,
    {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    },
    RUNNER_PORT,
  );

  if (!response.ok) {
    throw new Error(`Hosted runner container health check returned HTTP ${response.status}.`);
  }
}

function readContainerStatus(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const status = (state as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function isRunnerContainerStopped(status: string | null): boolean {
  return status === "stopped" || status === "stopped_with_code";
}

async function waitForRunnerContainerStop(
  container: RunnerContainer,
  timeoutMs: number,
): Promise<RunnerContainerStopWaitResult> {
  const deadline = Date.now() + timeoutMs;
  const observedStatuses: string[] = [];
  let lastStatus: string | null = null;
  let pollCount = 0;

  while (Date.now() <= deadline) {
    pollCount += 1;
    lastStatus = await readRunnerContainerStatus(container);
    appendObservedRunnerContainerStatus(observedStatuses, lastStatus);
    if (isRunnerContainerStopped(lastStatus)) {
      return {
        lastStatus,
        observedStatuses,
        pollCount,
      };
    }
    await sleep(RUNNER_WAIT_INTERVAL_MS);
  }

  throw new HostedRunnerContainerStopTimeoutError({
    lastStatus,
    observedStatuses,
    pollCount,
    timeoutMs,
  });
}

class HostedRunnerContainerStopTimeoutError extends Error {
  readonly details: HostedExecutionStructuredLogDetails;

  constructor(input: RunnerContainerStopWaitResult & {
    timeoutMs: number;
  }) {
    super("Hosted runner container destroy did not stop the shell.");
    this.name = "HostedRunnerContainerStopTimeoutError";
    this.details = {
      destroyPollCount: input.pollCount,
      destroyTimeoutMs: input.timeoutMs,
      observedStatuses: input.observedStatuses,
      statusAfterDestroy: input.lastStatus,
    };
  }
}

function appendObservedRunnerContainerStatus(
  statuses: string[],
  status: string | null,
): void {
  const normalized = status ?? "unknown";
  if (statuses.at(-1) === normalized) {
    return;
  }

  if (statuses.length >= RUNNER_DESTROY_STATUS_SAMPLE_LIMIT) {
    statuses.shift();
  }
  statuses.push(normalized);
}

async function readRunnerContainerStatus(
  container: RunnerContainer,
): Promise<string | null> {
  try {
    return readContainerStatus(await container.getState());
  } catch (error) {
    if (isMissingRunnerContainerError(error)) {
      return "stopped";
    }
    throw error;
  }
}

function readRunnerIdleTtlMs(source: RunnerContainerEnvironmentSource): number {
  const raw = source.HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS;

  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RUNNER_IDLE_TTL_MS;
  }

  if (typeof raw !== "string") {
    throw new TypeError("HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS must be a string when configured.");
  }

  const parsed = readStrictPositiveIntegerEnv(raw);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_RUNNER_IDLE_TTL_MS) {
    throw new TypeError(
      `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS must be an integer greater than or equal to ${MIN_RUNNER_IDLE_TTL_MS}.`,
    );
  }

  return parsed;
}

function readRunnerReadyTimeoutMs(source: RunnerContainerEnvironmentSource): number {
  const raw = source.HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS;

  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RUNNER_READY_TIMEOUT_MS;
  }

  if (typeof raw !== "string") {
    throw new TypeError("HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS must be a string when configured.");
  }

  const parsed = readStrictPositiveIntegerEnv(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS must be a positive integer.");
  }

  return parsed;
}

function readStrictPositiveIntegerEnv(raw: string): number {
  if (!/^[0-9]+$/u.test(raw)) {
    return Number.NaN;
  }

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function isTransientOutboundHandlerInstallError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    "Updating sidecar egress port failed",
    "Connecting to container port through proxy-everything failed",
    "Monitoring container failed with: 404",
  ].some((needle) => error.message.includes(needle));
}

function isMissingRunnerContainerError(error: unknown): boolean {
  const message = readErrorMessage(error);
  return message !== null && message.includes("No such container");
}

function readErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    const message = error.trim();
    return message.length > 0 ? message : null;
  }

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      const normalized = message.trim();
      return normalized.length > 0 ? normalized : null;
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : null;
  }

  return null;
}

function parseRunnerContainerSmokeBundle(
  value: unknown,
): HostedExecutionContainerSmokeHealthResult["runnerBundle"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    ...(typeof record.buildSkipped === "boolean" ? { buildSkipped: record.buildSkipped } : {}),
    ...(typeof record.bundleFingerprint === "string" ? { bundleFingerprint: record.bundleFingerprint } : {}),
    ...(typeof record.generatedAt === "string" ? { generatedAt: record.generatedAt } : {}),
    ...(typeof record.schemaVersion === "number" ? { schemaVersion: record.schemaVersion } : {}),
    ...(typeof record.sourceFingerprint === "string" ? { sourceFingerprint: record.sourceFingerprint } : {}),
  };
}

interface RunnerOutboundProxyState {
  attemptId: string;
  leaseGeneration: string;
  token: string;
  userId: string;
}

function isSameRunnerOutboundProxyState(
  left: RunnerOutboundProxyState | null,
  right: RunnerOutboundProxyState | null,
): boolean {
  return left !== null
    && right !== null
    && left.attemptId === right.attemptId
    && left.leaseGeneration === right.leaseGeneration
    && left.token === right.token
    && left.userId === right.userId;
}

function isRunnerOutboundProxyStateMatch(
  state: RunnerOutboundProxyState | null,
  input: {
    attemptId?: string;
    leaseGeneration?: string;
    token: string;
    userId?: string;
  },
): boolean {
  return state !== null
    && state.token === input.token
    && (input.attemptId === undefined || state.attemptId === input.attemptId)
    && (input.leaseGeneration === undefined || state.leaseGeneration === input.leaseGeneration)
    && (input.userId === undefined || state.userId === input.userId);
}

function formatRunnerSleepAfter(idleTtlMs: number): `${number}s` {
  return `${Math.max(1, Math.ceil(idleTtlMs / 1_000))}s`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function readHostedExecutionErrorNameForCode(code: string | null): string | null {
  switch (code) {
    case "bundle_archive_validation_error":
      return "HostedBundleArchiveValidationError";
    case "configuration_error":
      return "HostedExecutionConfigurationError";
    case "range_error":
      return "RangeError";
    case "reference_error":
      return "ReferenceError";
    case "syntax_error":
      return "SyntaxError";
    case "type_error":
      return "TypeError";
    case "uri_error":
      return "URIError";
    default:
      return null;
  }
}
