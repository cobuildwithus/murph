import { Container, type OutboundHandlerContext, type StopParams } from "@cloudflare/containers";
import {
  computeHostedRunElapsedMs,
  parseHostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  createRuntimeTimerSyntheticWake,
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
  type HostedRuntimeEvent,
  type HostedExecutionStructuredLogDetails,
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

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_HEALTH_URL = "http://container/health";
const RUNNER_EXECUTE_URL = "http://container/internal/run";
const RUNNER_WAIT_INTERVAL_MS = 250;
const DEFAULT_RUNNER_READY_TIMEOUT_MS = 20_000;
const RUNNER_DESTROY_TIMEOUT_MS = 5_000;
const DEFAULT_RUNNER_IDLE_TTL_MS = 300_000;
const RUNNER_DESTROY_STATUS_SAMPLE_LIMIT = 8;
const OUTBOUND_HANDLER_INSTALL_RETRY_LIMIT = 5;
const OUTBOUND_HANDLER_INSTALL_RETRY_DELAY_MS = 250;
const MIN_RUNNER_IDLE_TTL_MS = 1_000;

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
  job: HostedAssistantRuntimeJobInput;
  timeoutMs: number;
  userId: string;
}

type HostedExecutionContainerInvokeInput = HostedExecutionContainerInvokeRequest;

interface HostedExecutionContainerRunnerInput {
  job: HostedAssistantRuntimeJobInput;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  timeoutMs: number;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  destroyInstance(): Promise<void>;
  invoke(input: HostedExecutionContainerInvokeRequest): Promise<HostedAssistantRuntimeJobResult>;
  ownsInternalWorkerProxyToken(input: {
    attempt?: number;
    runId?: string;
    token: string;
    userId?: string;
  }): Promise<boolean>;
}

export interface HostedExecutionContainerNamespaceLike {
  getByName(name: string): HostedExecutionContainerStubLike;
}

type RunnerOutboundHandlerContext = OutboundHandlerContext<{
  internalWorkerProxyToken?: unknown;
  runAttempt?: unknown;
  runId?: unknown;
  userId?: unknown;
} | undefined>;

type RunnerContainerEnvironmentSource = Readonly<Record<string, unknown>>;

interface RunnerContainerLogContext {
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  userId: string;
  wake: HostedRuntimeEvent;
}

interface RunnerContainerStopWaitResult {
  lastStatus: string | null;
  observedStatuses: string[];
  pollCount: number;
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

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.environment = env;
    this.sleepAfter = formatRunnerSleepAfter(readRunnerIdleTtlMs(env));
  }

  async invoke(
    payload: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedAssistantRuntimeJobResult> {
    return this.withLifecycleLock(async () =>
      this.invokeHostedExecution(parseHostedExecutionContainerInvokeInput(payload))
    );
  }

  async destroyInstance(): Promise<void> {
    await this.withLifecycleLock(async () => {
      await this.stopWarmContainer();
    });
  }

  async ownsInternalWorkerProxyToken(input: {
    attempt?: number;
    runId?: string;
    token: string;
    userId?: string;
  }): Promise<boolean> {
    return isRunnerOutboundProxyStateMatch(this.runnerOutboundProxyState, input);
  }

  override async onActivityExpired(): Promise<void> {
    await this.withLifecycleLock(async () => {
      await this.stopWarmContainer({ failClosed: false });
    });
  }

  override onStart(): void {
    const context = this.currentLogContext;
    emitHostedExecutionStructuredLog({
      component: "container",
      wake: context?.wake,
      details: {
        ...buildRunnerContainerContextDetails(context),
        lifecycleStage: "onStart",
        runnerPort: RUNNER_PORT,
        sleepAfter: String(this.sleepAfter),
      },
      message: "Hosted execution container lifecycle hook reported start.",
      phase: "container.ready",
      run: context?.run,
      userId: context?.userId,
    });
  }

  override onStop(params: StopParams): void {
    const context = this.currentLogContext;
    const cleanExit = params.exitCode === 0;
    emitHostedExecutionStructuredLog({
      component: "container",
      wake: context?.wake,
      details: {
        ...buildRunnerContainerContextDetails(context),
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
      run: context?.run,
      userId: context?.userId,
    });
  }

  override onError(error: unknown): never {
    const context = this.currentLogContext;
    emitHostedExecutionStructuredLog({
      component: "container",
      wake: context?.wake,
      details: {
        ...buildRunnerContainerContextDetails(context),
        lifecycleStage: "onError",
        runnerPort: RUNNER_PORT,
      },
      error,
      message: "Hosted execution container lifecycle hook reported an error.",
      phase: "failed",
      run: context?.run,
      userId: context?.userId,
    });
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/run" || url.pathname === "/internal/destroy") {
      return methodNotAllowed();
    }

    return super.fetch(request);
  }

  private async invokeHostedExecution(
    input: HostedExecutionContainerInvokeInput,
  ): Promise<HostedAssistantRuntimeJobResult> {
    const wake = resolveHostedRunnerRequestWake(input.job.request);
    const run = input.job.request.run ?? null;
    const localInternalProxyBaseUrl = readOptionalRunnerContainerEnvString(
      this.environment,
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL_ENV,
    );
    const routeUserId = input.job.request.runDrain.userId;
    const runIdentity = resolveRunnerOutboundRunIdentity(input.job);
    const logContext: RunnerContainerLogContext = {
      run,
      userId: routeUserId,
      wake,
    };
    const outboundProxyState: RunnerOutboundProxyState = {
      attempt: runIdentity.attempt,
      runId: runIdentity.runId,
      token: createRunnerOutboundProxyToken(),
      userId: routeUserId,
    };
    let keepWarm = false;
    this.currentLogContext = logContext;

    try {
      const startTime = Date.now();
      emitHostedExecutionStructuredLog({
        component: "container",
        wake,
        details: {
          hasLocalInternalProxyBaseUrl: localInternalProxyBaseUrl !== null,
          readyTimeoutMs: readRunnerReadyTimeoutMs(this.environment),
          runDrainEventCount: input.job.request.runDrain.events.length,
          runDrainResumeFinalize: input.job.request.runDrain.resumeFinalize === true,
          runDrainTriggerKind: input.job.request.runDrain.triggerKind,
          runElapsedMs: computeHostedRunElapsedMs(run),
          runnerIdleTtlMs: readRunnerIdleTtlMs(this.environment),
          runnerPort: RUNNER_PORT,
          timeoutMs: input.timeoutMs,
          wakeKind: wake.kind,
        },
        message: "Hosted execution container invocation received.",
        phase: "container.starting",
        run,
        userId: routeUserId,
      });
      const runnerControlToken = await this.ensureContainerReady(input);
      this.runnerOutboundProxyState = outboundProxyState;
      await this.installOutboundHandlers(outboundProxyState, {
        wake,
        run,
      });

      const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - startTime));
      emitHostedExecutionStructuredLog({
        component: "container",
        wake,
        details: {
          remainingTimeoutMs,
          runElapsedMs: computeHostedRunElapsedMs(run),
        },
        message: "Hosted execution container sending runner request.",
        phase: "container.ready",
        run,
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
      emitHostedExecutionStructuredLog({
        component: "container",
        wake,
        details: {
          responseStatus: response.status,
          runElapsedMs: computeHostedRunElapsedMs(run),
        },
        message: "Hosted execution container received runner response.",
        phase: "container.ready",
        run,
        userId: routeUserId,
      });

      if (!response.ok) {
        throw await classifyHostedRunnerContainerErrorResponse(response);
      }

      const result = (await response.json()) as HostedAssistantRuntimeJobResult;
      keepWarm = true;
      return result;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        wake,
        error,
        details: {
          runElapsedMs: computeHostedRunElapsedMs(run),
        },
        message: "Hosted execution container failed.",
        phase: "failed",
        run,
        userId: routeUserId,
      });
      throw error;
    } finally {
      try {
        const outboundProxyExpired = await this.expireOutboundProxyState(outboundProxyState, {
          run,
          wake,
        });
        if (!outboundProxyExpired) {
          keepWarm = false;
        }

        const shouldDestroy = !keepWarm;

        if (shouldDestroy) {
          await this.stopWarmContainer();
        }
      } finally {
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
    const wake = resolveHostedRunnerRequestWake(input.job.request);
    const run = input.job.request.run ?? null;
    const status = readContainerStatus(await this.getState());
    const readyTimeoutMs = readRunnerReadyTimeoutMs(this.environment);

    if (!isRunnerContainerStopped(status) && this.runnerControlToken) {
      try {
        await assertRunnerHealthy(this, Math.min(input.timeoutMs, readyTimeoutMs));
        emitHostedExecutionStructuredLog({
          component: "container",
          wake,
          details: {
            readinessLatencyMs: Date.now() - readinessStartedAt,
            readinessTimeoutMs: Math.min(input.timeoutMs, readyTimeoutMs),
            runElapsedMs: computeHostedRunElapsedMs(run),
            startMode: "warm",
            statusBeforeStart: status,
          },
          message: "Hosted execution container is ready.",
          phase: "container.ready",
          run,
          userId: input.userId,
        });
        return this.runnerControlToken;
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "container",
          wake,
          details: {
            readinessLatencyMs: Date.now() - readinessStartedAt,
            readinessTimeoutMs: Math.min(input.timeoutMs, readyTimeoutMs),
            runElapsedMs: computeHostedRunElapsedMs(run),
            startMode: "warm",
            statusBeforeStart: status,
          },
          error,
          level: "warn",
          message: "Hosted execution container warm health check failed; restarting shell.",
          phase: "container.starting",
          run,
          userId: input.userId,
        });
        await this.stopWarmContainer();
      }
    } else if (!isRunnerContainerStopped(status)) {
      emitHostedExecutionStructuredLog({
        component: "container",
        wake,
        details: {
          runElapsedMs: computeHostedRunElapsedMs(run),
          startMode: "cold",
          statusBeforeStart: status,
        },
        level: "warn",
        message: "Hosted execution container found a running shell without a control token; destroying before cold start.",
        phase: "container.starting",
        run,
        userId: input.userId,
      });
      await this.stopWarmContainer();
    }

    emitHostedExecutionStructuredLog({
      component: "container",
      wake,
      details: {
        readinessPollIntervalMs: RUNNER_WAIT_INTERVAL_MS,
        readinessTimeoutMs: Math.min(
          Math.max(1, input.timeoutMs - (Date.now() - readinessStartedAt)),
          readyTimeoutMs,
        ),
        runElapsedMs: computeHostedRunElapsedMs(run),
        runnerPort: RUNNER_PORT,
        startMode: "cold",
        statusBeforeStart: status,
      },
      message: "Hosted execution container starting.",
      phase: "container.starting",
      run,
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
          }),
        },
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        wake,
        details: {
          readinessLatencyMs: Date.now() - readinessStartedAt,
          readinessPollIntervalMs: RUNNER_WAIT_INTERVAL_MS,
          readinessTimeoutMs,
          runElapsedMs: computeHostedRunElapsedMs(run),
          runnerPort: RUNNER_PORT,
          startMode: "cold",
          statusBeforeStart: status,
        },
        error,
        level: "error",
        message: "Hosted execution container failed to start or listen.",
        phase: "container.starting",
        run,
        userId: input.userId,
      });
      throw error;
    }
    this.runnerControlToken = runnerControlToken;

    emitHostedExecutionStructuredLog({
      component: "container",
      wake,
      details: {
        readinessLatencyMs: Date.now() - readinessStartedAt,
        readinessPollIntervalMs: RUNNER_WAIT_INTERVAL_MS,
        readinessTimeoutMs,
        runElapsedMs: computeHostedRunElapsedMs(run),
        runnerPort: RUNNER_PORT,
        startMode: "cold",
        statusBeforeStart: status,
      },
      message: "Hosted execution container is ready.",
      phase: "container.ready",
      run,
      userId: input.userId,
    });

    return runnerControlToken;
  }

  private async installOutboundHandlers(
    state: RunnerOutboundProxyState,
    input: {
      wake: HostedRuntimeEvent;
      run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
    },
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
            runAttempt: state.attempt,
            runId: state.runId,
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
            wake: input.wake,
            details: {
              outboundHandlerInstallAttempt: attempt,
              outboundHandlerInstallRetryCount: attempt - 1,
              runElapsedMs: computeHostedRunElapsedMs(input.run),
            },
            message: "Hosted execution container outbound handlers recovered after retry.",
            phase: "container.ready",
            run: input.run,
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
          wake: input.wake,
          details: {
            outboundHandlerInstallAttempt: attempt,
            outboundHandlerInstallRetryDelayMs: OUTBOUND_HANDLER_INSTALL_RETRY_DELAY_MS,
            runElapsedMs: computeHostedRunElapsedMs(input.run),
          },
          error,
          level: "warn",
          message:
            "Hosted execution container outbound handler installation hit a transient sidecar error; retrying.",
          phase: "container.ready",
          run: input.run,
        });
        await sleep(OUTBOUND_HANDLER_INSTALL_RETRY_DELAY_MS);
      }
    }
  }

  private async expireOutboundProxyState(
    state: RunnerOutboundProxyState,
    input: {
      wake: HostedRuntimeEvent;
      run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
    },
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
        wake: input.wake,
        details: {
          runElapsedMs: computeHostedRunElapsedMs(input.run),
        },
        error,
        level: "error",
        message: "Hosted execution container failed to expire outbound handlers.",
        phase: "failed",
        run: input.run,
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
    let destroyError: unknown = null;

    emitHostedExecutionStructuredLog({
      component: "container",
      wake: context?.wake,
      details: {
        ...buildRunnerContainerContextDetails(context),
        destroyTimeoutMs: RUNNER_DESTROY_TIMEOUT_MS,
        failClosed,
        lifecycleStage: "destroy-requested",
        statusBeforeDestroy,
      },
      message: "Hosted execution container destroy requested.",
      phase: "container.ready",
      run: context?.run,
      userId: context?.userId,
    });

    try {
      await this.destroy();
    } catch (error) {
      if (isMissingRunnerContainerError(error)) {
        return;
      }
      destroyError = error;
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
        wake: context?.wake,
        details: {
          ...buildRunnerContainerContextDetails(context),
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
        run: context?.run,
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

    if (destroyError) {
      return;
    }
  }

  private async stopWarmContainer(input: {
    failClosed?: boolean;
  } = {
    failClosed: true,
  }): Promise<void> {
    this.runnerControlToken = null;
    this.runnerOutboundProxyState = null;
    this.installedRunnerOutboundProxyState = null;
    await this.destroyIfRunning(input);
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
  input: HostedExecutionContainerRunnerInput,
): Promise<HostedAssistantRuntimeJobResult> {
  const jobUserId = input.job.request.runDrain.userId;
  if (input.userId !== jobUserId) {
    throw new TypeError("Hosted runner container route userId must match job runDrain.userId.");
  }

  return input.runnerContainerNamespace.getByName(jobUserId).invoke({
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

  const message = typeof payload?.error === "string" && payload.error.trim().length > 0
    ? payload.error
    : responseBodyPreview
      ? `Hosted runner container returned HTTP ${response.status}: ${responseBodyPreview.slice(0, 200)}`
      : `Hosted runner container returned HTTP ${response.status}.`;
  const code = typeof payload?.code === "string" && payload.code.trim().length > 0
    ? payload.code
    : null;
  const details = sanitizeHostedExecutionStructuredLogDetails({
    ...(payload?.details && typeof payload.details === "object" && !Array.isArray(payload.details)
      ? payload.details as HostedExecutionStructuredLogDetails
      : {}),
    ...(responseBodyPreview ? { responseBodyPreview } : {}),
  });
  const errorName = typeof payload?.errorName === "string" && payload.errorName.trim().length > 0
    ? payload.errorName.trim()
    : readHostedExecutionErrorNameForCode(code);

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
    wake: input.context?.wake,
    details: {
      ...buildRunnerContainerContextDetails(input.context),
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
    run: input.context?.run,
    userId: input.context?.userId,
  });
}

function buildRunnerContainerContextDetails(
  context: RunnerContainerLogContext | null | undefined,
): HostedExecutionStructuredLogDetails {
  return context?.run
    ? { runElapsedMs: computeHostedRunElapsedMs(context.run) }
    : {};
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
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  userId: string;
}): Promise<void> {
  if (!input.runnerContainerNamespace) {
    return;
  }

  try {
    await input.runnerContainerNamespace.getByName(input.userId).destroyInstance();
  } catch {
    // best-effort cleanup only
  }
}

function parseHostedExecutionContainerInvokeInput(
  payload: {
    job?: unknown;
    timeoutMs?: unknown;
    userId?: unknown;
  },
): HostedExecutionContainerInvokeInput {
  const job = parseHostedAssistantRuntimeJobInput(payload.job);
  const userId = requireString(payload.userId, "payload.userId");

  if (userId !== job.request.runDrain.userId) {
    throw new TypeError("Hosted runner container invoke userId must match job runDrain.userId.");
  }

  return {
    job,
    timeoutMs: readTimeoutMs(payload.timeoutMs, DEFAULT_RUNNER_READY_TIMEOUT_MS),
    userId,
  };
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

function resolveHostedRunnerRequestWake(
  request: HostedAssistantRuntimeJobInput["request"],
): HostedRuntimeEvent {
  const [firstEvent] = request.runDrain.events;
  return firstEvent?.wake ?? createRuntimeTimerSyntheticWake(request.runDrain);
}

interface RunnerOutboundProxyState {
  attempt: number;
  runId: string;
  token: string;
  userId: string;
}

function resolveRunnerOutboundRunIdentity(
  job: HostedAssistantRuntimeJobInput,
): Pick<RunnerOutboundProxyState, "attempt" | "runId"> {
  const runId = job.request.run.runId;

  if (runId !== job.request.runDrain.runId) {
    throw new TypeError("Hosted runner job run.runId must match runDrain.runId.");
  }

  return {
    attempt: job.request.run.attempt,
    runId,
  };
}

function isSameRunnerOutboundProxyState(
  left: RunnerOutboundProxyState | null,
  right: RunnerOutboundProxyState | null,
): boolean {
  return left !== null
    && right !== null
    && left.attempt === right.attempt
    && left.runId === right.runId
    && left.token === right.token
    && left.userId === right.userId;
}

function isRunnerOutboundProxyStateMatch(
  state: RunnerOutboundProxyState | null,
  input: {
    attempt?: number;
    runId?: string;
    token: string;
    userId?: string;
  },
): boolean {
  return state !== null
    && state.token === input.token
    && (input.userId === undefined || state.userId === input.userId)
    && (input.runId === undefined || state.runId === input.runId)
    && (input.attempt === undefined || state.attempt === input.attempt);
}

function formatRunnerSleepAfter(idleTtlMs: number): `${number}s` {
  return `${Math.max(1, Math.ceil(idleTtlMs / 1_000))}s`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function readHostedExecutionErrorNameForCode(code: string | null): string | null {
  switch (code) {
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
