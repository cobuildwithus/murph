import { Container, type StopParams } from "@cloudflare/containers";
import {
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
  type HostedExecutionStructuredLogDetails,
  type HostedExecutionStructuredLogDetailValue,
} from "@murphai/hosted-execution";
import { methodNotAllowed } from "./json.ts";
import { buildHostedRunnerSupervisorEnv } from "./runner-env.ts";
import {
  assertHostedExecutionRunnerJobResult,
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionRunnerJobInput,
  type HostedExecutionRunnerJobResult,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_HEALTH_URL = "http://container/health";
const RUNNER_CONTROL_HEALTH_URL = "http://container/internal/control-health";
const RUNNER_EXECUTE_URL = "http://container/internal/workspace-invocation";
const RUNNER_WAIT_INTERVAL_MS = 250;
const DEFAULT_RUNNER_READY_TIMEOUT_MS = 20_000;
const DEFAULT_RUNNER_DESTROY_TIMEOUT_MS = 5_000;
const DEFAULT_RUNNER_IDLE_CHECKPOINT_DELAY_MS = 300_000;
const RUNNER_DESTROY_STATUS_SAMPLE_LIMIT = 8;
const MIN_RUNNER_IDLE_TTL_MS = 1_000;
const RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 30_000;
const MIN_RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 250;
const RUNNER_CONTROL_TOKEN_STORAGE_KEY = "runner-container-control-token:v1";
const RUNNER_CONTROL_TOKEN_SCHEMA_VERSION = 1;
const WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE = "workspace invocation preempted";
const HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL_ENV =
  "HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL";

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
  signal?: AbortSignal;
  timeoutMs: number;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  abortBrowserVaultRefresh?(input: { attemptId: string; userId: string }): Promise<void>;
  abortWorkspaceInvocation?(input: { attemptId: string; userId: string }): Promise<void>;
  destroyInstance(): Promise<void>;
  invoke(input: HostedExecutionContainerInvokeRequest): Promise<HostedExecutionRunnerJobResult>;
  invokeIdleCheckpointIfWarm?(
    input: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedExecutionRunnerJobResult>;
  ownsInternalWorkerProxyToken(input: {
    attemptId?: string;
    leaseGeneration?: string;
    token: string;
    userId?: string;
  }): Promise<boolean>;
  refreshBrowserVaultReplica?(input: unknown): Promise<unknown>;
  smokeHealth(): Promise<HostedExecutionContainerSmokeHealthResult>;
}

export interface HostedExecutionContainerNamespaceLike {
  getByName(name: string): HostedExecutionContainerStubLike;
}

type RunnerContainerEnvironmentSource = Readonly<Record<string, unknown>>;
type RunnerContainerNameSource = Readonly<Record<string, unknown>>;

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

interface RunnerControlTokenRecord {
  schemaVersion: typeof RUNNER_CONTROL_TOKEN_SCHEMA_VERSION;
  token: string;
  updatedAt: number;
}

interface RunnerActiveOperationRecord {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
}

interface RunnerPendingIdleCheckpoint {
  checkpointNextWakeAt: string | null;
  job: HostedExecutionWorkspaceInvocationJobInput;
  timeoutMs: number;
  userId: string;
  workspaceVersion: string;
}

interface RunnerContainerUserRunnerStubLike {
  beginIdleCheckpointLease?(input: {
    userId: string;
    workspaceVersion: string;
  }): Promise<{
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion: string | null;
  }>;
  finishIdleCheckpointLease?(input: {
    attemptId: string;
    generation: string;
    nextWakeAt?: string | null;
    userId: string;
  }): Promise<{ completed: boolean }>;
}

export class RunnerContainer extends Container {
  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  sleepAfter = formatRunnerSleepAfter(readRunnerContainerIdleTtlMs({}));

  private readonly environment: RunnerContainerEnvironmentSource;
  private lifecycleLock: Promise<void> = Promise.resolve();
  private currentLogContext: RunnerContainerLogContext | null = null;
  private runnerControlToken: string | null = null;
  private pendingIdleCheckpoint: RunnerPendingIdleCheckpoint | null = null;
  private workspaceInvocationAbortController: AbortController | null = null;
  private workspaceInvocationActiveOperation: RunnerActiveOperationRecord | null = null;

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.environment = env;
    this.sleepAfter = formatRunnerSleepAfter(readRunnerContainerIdleTtlMs(env));
  }

  async invoke(
    payload: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedExecutionRunnerJobResult> {
    const input = parseHostedExecutionContainerInvokeInput(payload);
    return this.withLifecycleLock(async () =>
      this.invokeHostedExecution(input)
    );
  }

  async invokeIdleCheckpointIfWarm(
    payload: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedExecutionRunnerJobResult> {
    const input = parseHostedExecutionContainerInvokeInput(payload);
    return this.withLifecycleLock(async () =>
      this.invokeHostedExecution(input, { warmOnly: true })
    );
  }

  async destroyInstance(): Promise<void> {
    this.workspaceInvocationAbortController?.abort(new Error("workspace invocation container destroyed"));
    await this.stopWarmContainer();
  }

  async abortWorkspaceInvocation(input: { attemptId: string; userId: string }): Promise<void> {
    const active = this.workspaceInvocationActiveOperation;
    const abortController = this.workspaceInvocationAbortController;
    if (!active || !abortController) {
      return;
    }
    if (active.attemptId !== input.attemptId || active.userId !== input.userId) {
      return;
    }
    if (!abortController.signal.aborted) {
      abortController.abort(new Error(WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE));
    }
  }

  async refreshBrowserVaultReplica(_input?: unknown): Promise<never> {
    throw new Error("Hosted runner browser-vault refresh side path has been removed.");
  }

  async abortBrowserVaultRefresh(_input?: unknown): Promise<void> {
    return undefined;
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
    void input;
    return false;
  }

  override async onActivityExpired(): Promise<void> {
    await this.withLifecycleLock(async () => {
      const activeOperation = this.workspaceInvocationActiveOperation;
      if (activeOperation) {
        this.noteRunnerActivity("activity-expired-active-operation");
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            activeOperationKind: "workspace-invocation",
            lifecycleStage: "activity-expired-active-operation",
            workspaceAttemptId: activeOperation.attemptId,
          },
          message: "Hosted execution container activity expiry yielded to active runner operation.",
          phase: "container.ready",
          userId: activeOperation.userId,
        });
        return;
      }

      const pendingIdleCheckpoint = this.pendingIdleCheckpoint;
      try {
        if (pendingIdleCheckpoint) {
          await this.runPendingIdleCheckpoint(pendingIdleCheckpoint);
        }
      } catch (error) {
        this.pendingIdleCheckpoint = null;
        emitHostedExecutionStructuredLog({
          component: "container",
          details: buildRunnerContainerMetadataOnlyErrorDetails(error),
          level: "warn",
          message: "Hosted execution container skipped idle-shutdown checkpoint during activity expiry.",
          phase: "failed",
          userId: pendingIdleCheckpoint?.userId ?? this.currentLogContext?.userId,
        });
      } finally {
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            lifecycleStage: "activity-expired-fallback-cleanup",
          },
          message: "Hosted execution container activity expired; running fallback cleanup.",
          phase: "container.ready",
          userId: pendingIdleCheckpoint?.userId ?? this.currentLogContext?.userId,
        });
        await this.stopWarmContainer({ failClosed: false });
      }
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
    const abortedOperations = this.abortActiveOperationsForContainerStop(params);
    const stoppedDuringActiveWork = abortedOperations.workspaceInvocation;
    const cleanExit = params.exitCode === 0;
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        activeWorkspaceInvocationAborted: abortedOperations.workspaceInvocation,
        exitCode: params.exitCode,
        lifecycleStage: "onStop",
        runnerPort: RUNNER_PORT,
        stopReason: params.reason,
      },
      level: cleanExit && !stoppedDuringActiveWork ? "info" : "warn",
      message: stoppedDuringActiveWork
        ? "Hosted execution container stopped during active work."
        : cleanExit
        ? "Hosted execution container lifecycle hook reported stop."
        : "Hosted execution container lifecycle hook reported non-zero stop.",
      phase: cleanExit && !stoppedDuringActiveWork ? "container.ready" : "failed",
      userId: context?.userId,
    });
  }

  private abortActiveOperationsForContainerStop(params: {
    exitCode: number | null;
    reason: string;
  }): {
    workspaceInvocation: boolean;
  } {
    const activeWorkspaceOperation = this.workspaceInvocationActiveOperation;
    const workspaceInvocationAborted = abortRunnerContainerOperation(
      this.workspaceInvocationAbortController,
      new Error(
        `workspace invocation container stopped during active work (${params.reason}, exit ${params.exitCode})`,
      ),
    );

    return {
      workspaceInvocation: activeWorkspaceOperation !== null && workspaceInvocationAborted,
    };
  }

  override onError(error: unknown): never {
    const context = this.currentLogContext;
    const abortedOperations = this.abortActiveOperationsForContainerStop({
      exitCode: null,
      reason: "error",
    });
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        activeWorkspaceInvocationAborted: abortedOperations.workspaceInvocation,
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

    if (
      url.pathname === "/internal/workspace-invocation"
      || url.pathname === "/internal/browser-vault-refresh"
      || url.pathname === "/internal/destroy"
    ) {
      return methodNotAllowed();
    }

    return super.fetch(request);
  }

  private async invokeHostedExecution(
    input: HostedExecutionContainerInvokeInput,
    options: { warmOnly?: boolean } = {},
  ): Promise<HostedExecutionRunnerJobResult> {
    const routeUserId = readHostedExecutionRunnerJobUserId(input.job);
    const runtimeCallbackBaseUrl = readRunnerRuntimeCallbackBaseUrl(
      this.environment,
      routeUserId,
    );
    const logContext: RunnerContainerLogContext = {
      userId: routeUserId,
    };
    const activeOperation: RunnerActiveOperationRecord = {
      attemptId: input.job.request.attemptId,
      leaseGeneration: input.job.request.leaseGeneration,
      userId: routeUserId,
    };
    let completedSuccessfully = false;
    this.currentLogContext = logContext;
    const operationAbortController = new AbortController();
    this.workspaceInvocationAbortController = operationAbortController;
    let activeOperationAcquired = false;
    let cleanupWarmContainerOnFailure = false;
    let stopRunnerActivityRenewal: (() => void) | null = null;

    try {
      const startTime = Date.now();
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          hasRuntimeCallbackBaseUrl: runtimeCallbackBaseUrl !== null,
          readyTimeoutMs: readRunnerReadyTimeoutMs(this.environment),
          workspaceAttemptId: input.job.request.attemptId,
          workspaceLeaseGeneration: input.job.request.leaseGeneration,
          workspaceReason: input.job.request.reason,
          workspaceVersion: input.job.request.workspaceVersion,
          runnerIdleTtlMs: readRunnerContainerIdleTtlMs(this.environment),
          runnerPort: RUNNER_PORT,
          timeoutMs: input.timeoutMs,
        },
        message: "Hosted execution container invocation received.",
        phase: "container.starting",
        userId: routeUserId,
      });
      const runnerControlToken = options.warmOnly === true
        ? await this.openWarmContainerIfReady(input)
        : await this.ensureContainerReady(input);
      if (!runnerControlToken) {
        return {
          idleShutdownCheckpointSkipped: "container_not_warm",
          status: "idle",
        };
      }
      cleanupWarmContainerOnFailure = true;
      this.noteRunnerActivity("container-ready");
      throwIfRunnerContainerOperationAborted(operationAbortController.signal);

      const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - startTime));
      activeOperationAcquired = true;
      this.workspaceInvocationAbortController = operationAbortController;
      this.workspaceInvocationActiveOperation = activeOperation;
      stopRunnerActivityRenewal = this.startRunnerActivityRenewal();
      this.noteRunnerActivity("invoke-started");
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
      const requestSignal = combineRunnerContainerAbortSignals(
        operationAbortController.signal,
        AbortSignal.timeout(remainingTimeoutMs),
      );
      const runnerRequest = this.containerFetch(
        RUNNER_EXECUTE_URL,
        {
          body: JSON.stringify({
            internalWorkerProxyToken: null,
            job: input.job,
            localInternalProxyBaseUrl: null,
            runtimeCallbackBaseUrl,
          }),
          headers: {
            authorization: `Bearer ${runnerControlToken}`,
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
          signal: requestSignal,
        },
        RUNNER_PORT,
      );
      const stopWatcherAbortController = new AbortController();
      const stoppedContainer = watchWorkspaceRequestContainerStop({
        container: this,
        operationAbortController,
        signal: stopWatcherAbortController.signal,
        userId: routeUserId,
      });
      let response: Response;
      try {
        response = await raceRunnerContainerOperationAbort(
          Promise.race([runnerRequest, stoppedContainer]),
          requestSignal,
        );
      } finally {
        stopWatcherAbortController.abort();
        void stoppedContainer.catch(() => undefined);
      }
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
      this.rememberIdleCheckpointIfNeeded({
        input,
        result,
        userId: routeUserId,
      });
      completedSuccessfully = true;
      return result;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: buildRunnerContainerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted execution container failed.",
        phase: "failed",
        userId: routeUserId,
      });
      throw error;
    } finally {
      try {
        if (activeOperationAcquired) {
          const shouldKeepWarm = (
            completedSuccessfully
            || isWorkspaceInvocationPreemptedAbort(operationAbortController.signal.reason)
          );
          if (!shouldKeepWarm) {
            await this.stopWarmContainer({
              failClosed: true,
            });
          }
        } else if (cleanupWarmContainerOnFailure) {
          await this.stopWarmContainer({
            failClosed: true,
          });
        }
      } finally {
        stopRunnerActivityRenewal?.();
        this.noteRunnerActivity("invoke-finished");
        if (this.currentLogContext === logContext) {
          this.currentLogContext = null;
        }
        if (this.workspaceInvocationAbortController === operationAbortController) {
          this.workspaceInvocationAbortController = null;
        }
        if (this.workspaceInvocationActiveOperation === activeOperation) {
          this.workspaceInvocationActiveOperation = null;
        }
      }
    }
  }

  private rememberIdleCheckpointIfNeeded(input: {
    input: HostedExecutionContainerInvokeInput;
    result: HostedExecutionRunnerJobResult;
    userId: string;
  }): void {
    if (
      input.input.job.kind !== HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND
      || input.input.job.request.reason === "idle_shutdown_checkpoint"
    ) {
      return;
    }

    if (
      input.result.deferredCheckpointRequired === true
      && input.result.status !== "failed"
    ) {
      this.pendingIdleCheckpoint = {
        checkpointNextWakeAt: input.result.nextWakeAt ?? null,
        job: input.input.job,
        timeoutMs: input.input.timeoutMs,
        userId: input.userId,
        workspaceVersion: input.input.job.request.workspaceVersion,
      };
      return;
    }

    this.pendingIdleCheckpoint = null;
  }

  private async runPendingIdleCheckpoint(
    pending: RunnerPendingIdleCheckpoint,
  ): Promise<void> {
    const runnerControlToken = this.runnerControlToken ?? await this.readRunnerControlToken();
    if (!runnerControlToken) {
      this.pendingIdleCheckpoint = null;
      return;
    }

    let lease: {
      attemptId: string;
      generation: string;
    } | null = null;
    try {
      lease = await this.beginIdleCheckpointLease(pending);
    } catch (error) {
      this.pendingIdleCheckpoint = null;
      emitHostedExecutionStructuredLog({
        component: "container",
        details: buildRunnerContainerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted execution container could not begin idle-shutdown checkpoint lease.",
        phase: "failed",
        userId: pending.userId,
      });
      return;
    }
    if (!lease) {
      this.pendingIdleCheckpoint = null;
      return;
    }

    let nextWakeAt = pending.checkpointNextWakeAt;
    try {
      const result = await this.postRunnerRequest({
        job: {
          ...pending.job,
          request: {
            attemptId: lease.attemptId,
            checkpointNextWakeAt: pending.checkpointNextWakeAt,
            leaseGeneration: lease.generation,
            reason: "idle_shutdown_checkpoint",
            userId: pending.userId,
            workspaceVersion: pending.workspaceVersion,
          },
        },
        runnerControlToken,
        timeoutMs: pending.timeoutMs,
        userId: pending.userId,
      });
      nextWakeAt = result.nextWakeAt ?? pending.checkpointNextWakeAt;
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          idleShutdownCheckpointed: Boolean(result.idleShutdownCheckpointed),
          idleShutdownCheckpointSkipped: result.idleShutdownCheckpointSkipped ?? null,
          workspaceAttemptId: lease.attemptId,
        },
        message: "Hosted execution container ran pending idle-shutdown checkpoint.",
        phase: "checkpoint",
        userId: pending.userId,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: buildRunnerContainerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted execution container idle-shutdown checkpoint failed best-effort.",
        phase: "failed",
        userId: pending.userId,
      });
    } finally {
      this.pendingIdleCheckpoint = null;
      await this.finishIdleCheckpointLease({
        attemptId: lease.attemptId,
        generation: lease.generation,
        nextWakeAt,
        userId: pending.userId,
      }).catch((error) => {
        emitHostedExecutionStructuredLog({
          component: "container",
          details: buildRunnerContainerMetadataOnlyErrorDetails(error),
          level: "warn",
          message: "Hosted execution container could not finish idle-shutdown checkpoint lease.",
          phase: "failed",
          userId: pending.userId,
        });
      });
    }
  }

  private async postRunnerRequest(input: {
    job: HostedExecutionRunnerJobInput;
    runnerControlToken: string;
    timeoutMs: number;
    userId: string;
  }): Promise<HostedExecutionRunnerJobResult> {
    const runtimeCallbackBaseUrl = readRunnerRuntimeCallbackBaseUrl(
      this.environment,
      input.userId,
    );
    const response = await this.containerFetch(
      RUNNER_EXECUTE_URL,
      {
        body: JSON.stringify({
          internalWorkerProxyToken: null,
          job: input.job,
          localInternalProxyBaseUrl: null,
          runtimeCallbackBaseUrl,
        }),
        headers: {
          authorization: `Bearer ${input.runnerControlToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: AbortSignal.timeout(input.timeoutMs),
      },
      RUNNER_PORT,
    );
    if (!response.ok) {
      throw await classifyHostedRunnerContainerErrorResponse(response);
    }
    return assertHostedExecutionRunnerJobResult(await response.json(), input.job);
  }

  private async beginIdleCheckpointLease(input: RunnerPendingIdleCheckpoint): Promise<{
    attemptId: string;
    generation: string;
  } | null> {
    const stub = readRunnerContainerUserRunnerStub(this.environment, input.userId);
    const beginIdleCheckpointLease = stub?.beginIdleCheckpointLease;
    if (typeof beginIdleCheckpointLease !== "function") {
      emitHostedExecutionStructuredLog({
        component: "container",
        level: "warn",
        message: "Hosted execution container skipped idle-shutdown checkpoint because lease RPC is unavailable.",
        phase: "failed",
        userId: input.userId,
      });
      return null;
    }
    return await beginIdleCheckpointLease.call(stub, {
      userId: input.userId,
      workspaceVersion: input.workspaceVersion,
    });
  }

  private async finishIdleCheckpointLease(input: {
    attemptId: string;
    generation: string;
    nextWakeAt: string | null;
    userId: string;
  }): Promise<void> {
    const stub = readRunnerContainerUserRunnerStub(this.environment, input.userId);
    const finishIdleCheckpointLease = stub?.finishIdleCheckpointLease;
    if (typeof finishIdleCheckpointLease !== "function") {
      return;
    }
    await finishIdleCheckpointLease.call(stub, input);
  }

  private async ensureContainerReady(
    input: Pick<HostedExecutionContainerInvokeInput, "timeoutMs" | "userId">,
  ): Promise<string> {
    const readinessStartedAt = Date.now();
    const status = readContainerStatus(await this.getState());
    const readyTimeoutMs = readRunnerReadyTimeoutMs(this.environment);
    const warmRunnerControlToken = isRunnerContainerStopped(status)
      ? null
      : this.runnerControlToken ?? await this.readRunnerControlToken();

    if (!isRunnerContainerStopped(status) && warmRunnerControlToken) {
      try {
        this.runnerControlToken = warmRunnerControlToken;
        await assertRunnerHealthy(this, Math.min(input.timeoutMs, readyTimeoutMs));
        await assertRunnerControlAuthorized(
          this,
          warmRunnerControlToken,
          Math.min(input.timeoutMs, readyTimeoutMs),
        );
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
        return warmRunnerControlToken;
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
    this.runnerControlToken = runnerControlToken;
    await this.writeRunnerControlToken(runnerControlToken, { failClosed: true });

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
    await this.writeRunnerControlToken(runnerControlToken, { failClosed: true });

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

  private async openWarmContainerIfReady(
    input: Pick<HostedExecutionContainerInvokeInput, "timeoutMs" | "userId">,
  ): Promise<string | null> {
    const readinessStartedAt = Date.now();
    const status = readContainerStatus(await this.getState());
    const readyTimeoutMs = Math.min(input.timeoutMs, readRunnerReadyTimeoutMs(this.environment));
    const warmRunnerControlToken = isRunnerContainerStopped(status)
      ? null
      : this.runnerControlToken ?? await this.readRunnerControlToken();

    if (isRunnerContainerStopped(status) || !warmRunnerControlToken) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          readinessLatencyMs: Date.now() - readinessStartedAt,
          startMode: "warm-only",
          statusBeforeStart: status,
          warmControlTokenPresent: Boolean(warmRunnerControlToken),
        },
        message: "Hosted execution container skipped warm-only idle checkpoint because no warm shell is available.",
        phase: "container.ready",
        userId: input.userId,
      });
      return null;
    }

    try {
      this.runnerControlToken = warmRunnerControlToken;
      await assertRunnerHealthy(this, readyTimeoutMs);
      await assertRunnerControlAuthorized(this, warmRunnerControlToken, readyTimeoutMs);
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          readinessLatencyMs: Date.now() - readinessStartedAt,
          readinessTimeoutMs: readyTimeoutMs,
          startMode: "warm-only",
          statusBeforeStart: status,
        },
        message: "Hosted execution container is ready for warm-only idle checkpoint.",
        phase: "container.ready",
        userId: input.userId,
      });
      return warmRunnerControlToken;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          readinessLatencyMs: Date.now() - readinessStartedAt,
          readinessTimeoutMs: readyTimeoutMs,
          startMode: "warm-only",
          statusBeforeStart: status,
        },
        error,
        level: "warn",
        message: "Hosted execution container skipped warm-only idle checkpoint because warm health failed.",
        phase: "container.ready",
        userId: input.userId,
      });
      await this.stopWarmContainer({ failClosed: false });
      return null;
    }
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

  private async destroyIfRunning(input: {
    failClosed?: boolean;
  } = {}): Promise<boolean> {
    const failClosed = Boolean(input.failClosed);
    const context = this.currentLogContext;
    const destroyTimeoutMs = readRunnerDestroyTimeoutMs(this.environment);
    let statusBeforeDestroy: string | null = null;

    try {
      statusBeforeDestroy = await readRunnerContainerStatus(this);
      if (isRunnerContainerStopped(statusBeforeDestroy)) {
        return true;
      }
    } catch (error) {
      emitRunnerContainerLifecycleFailure({
        destroyLatencyMs: null,
        destroyTimeoutMs,
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
      return false;
    }

    const destroyStartedAt = Date.now();
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        destroyTimeoutMs,
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
        return true;
      }
      emitRunnerContainerLifecycleFailure({
        destroyLatencyMs: Date.now() - destroyStartedAt,
        destroyTimeoutMs,
        error,
        failClosed,
        context,
        message: "Hosted execution container destroy request failed.",
        statusBeforeDestroy,
        stage: "destroy",
      });
    }

    try {
      const stopWait = await waitForRunnerContainerStop(this, destroyTimeoutMs);
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          destroyLatencyMs: Date.now() - destroyStartedAt,
          destroyPollCount: stopWait.pollCount,
          destroyTimeoutMs,
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
      return true;
    } catch (error) {
      if (isMissingRunnerContainerError(error)) {
        return true;
      }
      emitRunnerContainerLifecycleFailure({
        destroyLatencyMs: Date.now() - destroyStartedAt,
        destroyTimeoutMs,
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
      return false;
    }
  }

  private async stopWarmContainer(input?: {
    failClosed?: boolean;
  }): Promise<void> {
    const failClosed = input?.failClosed ?? true;
    this.pendingIdleCheckpoint = null;
    const hadRunnerControlToken =
      this.runnerControlToken !== null || (await this.readRunnerControlToken()) !== null;
    if (hadRunnerControlToken) {
      this.runnerControlToken = null;
      await this.clearRunnerControlToken();
    }
    await this.destroyIfRunning({ failClosed });
  }

  private startRunnerActivityRenewal(): () => void {
    const idleTtlMs = readRunnerContainerIdleTtlMs(this.environment);
    const intervalMs = computeRunnerActivityRenewIntervalMs(idleTtlMs);
    const interval = setInterval(() => {
      this.noteRunnerActivity("invoke-heartbeat");
    }, intervalMs);

    return () => {
      clearInterval(interval);
    };
  }

  private noteRunnerActivity(stage: string): boolean {
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

  private async readRunnerControlToken(): Promise<string | null> {
    try {
      const value = await this.ctx.storage.get<unknown>(RUNNER_CONTROL_TOKEN_STORAGE_KEY);
      return parseRunnerControlTokenRecord(value)?.token ?? null;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "warn",
        message: "Hosted execution container could not read control token state.",
        phase: "container.ready",
        userId: this.currentLogContext?.userId,
      });
      return null;
    }
  }

  private async writeRunnerControlToken(
    token: string,
    input?: {
      failClosed?: boolean;
    },
  ): Promise<boolean> {
    const record: RunnerControlTokenRecord = {
      schemaVersion: RUNNER_CONTROL_TOKEN_SCHEMA_VERSION,
      token,
      updatedAt: Date.now(),
    };

    try {
      await this.ctx.storage.put(RUNNER_CONTROL_TOKEN_STORAGE_KEY, record);
      return true;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "warn",
        message: "Hosted execution container could not write control token state.",
        phase: "container.ready",
        userId: this.currentLogContext?.userId,
      });
      if (input?.failClosed) {
        throw new Error("Hosted runner container control token state could not be persisted.");
      }
      return false;
    }
  }

  private async clearRunnerControlToken(): Promise<void> {
    try {
      await this.ctx.storage.delete(RUNNER_CONTROL_TOKEN_STORAGE_KEY);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "warn",
        message: "Hosted execution container could not clear control token state.",
        phase: "container.ready",
        userId: this.currentLogContext?.userId,
      });
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

export class DeploySmokeRunnerContainer extends RunnerContainer {}

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

  const container = input.runnerContainerNamespace.getByName(input.runnerContainerName ?? jobUserId);
  const invocation = container.invoke({
    job: input.job,
    timeoutMs: input.timeoutMs,
    userId: jobUserId,
  });
  return input.signal
    ? await raceRunnerContainerOperationAbort(invocation, input.signal, async () => {
        if (isRunnerContainerAbortHardTimeout(input.signal?.reason)) {
          await container.destroyInstance().catch((error: unknown) => {
            emitHostedExecutionStructuredLog({
              component: "container",
              error,
              level: "warn",
              message: "Hosted runner could not destroy a timed-out invocation container.",
              phase: "failed",
              userId: jobUserId,
            });
          });
          return;
        }

        if (
          input.job.kind === HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND
          && container.abortWorkspaceInvocation
        ) {
          await container.abortWorkspaceInvocation({
            attemptId: input.job.request.attemptId,
            userId: jobUserId,
          }).catch((error: unknown) => {
            emitHostedExecutionStructuredLog({
              component: "container",
              error,
              level: "warn",
              message: "Hosted runner could not abort a preempted invocation request.",
              phase: "failed",
              userId: jobUserId,
            });
          });
          return;
        }

        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            abortWorkspaceInvocationSupported: Boolean(container.abortWorkspaceInvocation),
          },
          level: "warn",
          message: "Hosted runner left a preempted invocation request for lease fencing.",
          phase: "failed",
          userId: jobUserId,
        });
      })
    : await invocation;
}

export async function invokeHostedExecutionContainerRunnerIdleCheckpointIfWarm(
  input: HostedExecutionContainerRunnerInput & { job: HostedExecutionWorkspaceInvocationJobInput },
): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
export async function invokeHostedExecutionContainerRunnerIdleCheckpointIfWarm(
  input: HostedExecutionContainerRunnerInput,
): Promise<HostedExecutionRunnerJobResult>;
export async function invokeHostedExecutionContainerRunnerIdleCheckpointIfWarm(
  input: HostedExecutionContainerRunnerInput,
): Promise<HostedExecutionRunnerJobResult> {
  const jobUserId = readHostedExecutionRunnerJobUserId(input.job);
  if (input.userId !== jobUserId) {
    throw new TypeError("Hosted runner container route userId must match workspace job userId.");
  }

  const container = input.runnerContainerNamespace.getByName(input.runnerContainerName ?? jobUserId);
  if (!container.invokeIdleCheckpointIfWarm) {
    throw new Error("Hosted runner container does not support warm-only idle checkpoints.");
  }
  const invocation = container.invokeIdleCheckpointIfWarm({
    job: input.job,
    timeoutMs: input.timeoutMs,
    userId: jobUserId,
  });
  return input.signal
    ? await raceRunnerContainerOperationAbort(invocation, input.signal, async () => {
        if (!container.abortWorkspaceInvocation) {
          return;
        }
        await container.abortWorkspaceInvocation({
          attemptId: input.job.request.attemptId,
          userId: jobUserId,
        }).catch((error: unknown) => {
          emitHostedExecutionStructuredLog({
            component: "container",
            error,
            level: "warn",
            message: "Hosted runner could not abort a preempted warm-only invocation.",
            phase: "failed",
            userId: jobUserId,
          });
        });
      })
    : await invocation;
}

export async function refreshHostedExecutionContainerBrowserVaultReplica(_input?: unknown): Promise<never> {
  throw new Error("Hosted runner browser-vault refresh side path has been removed.");
}

async function raceRunnerContainerOperationAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onOperationAbort?: () => Promise<void>,
): Promise<T> {
  if (signal.aborted) {
    await onOperationAbort?.().catch(() => undefined);
    throwIfRunnerContainerOperationAborted(signal);
  }

  let removeAbortListener: () => void = () => undefined;
  const abortCleanup: {
    promise: Promise<void> | null;
  } = {
    promise: null,
  };
  const abort = new Promise<never>((_, reject) => {
    const onAbort = () => {
      abortCleanup.promise = onOperationAbort?.() ?? null;
      reject(signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([operation, abort]);
  } catch (error) {
    if (signal.aborted) {
      await abortCleanup.promise?.catch(() => undefined);
      void operation.catch(() => undefined);
    }
    throw error;
  } finally {
    removeAbortListener();
  }
}

function isWorkspaceInvocationPreemptedAbort(reason: unknown): boolean {
  return reason instanceof Error
    && reason.message === WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE;
}

function isRunnerContainerAbortHardTimeout(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "TimeoutError";
}

async function waitForRunnerContainerOperationCompletion(
  completion: Promise<void> | null,
  timeoutMs: number,
): Promise<boolean> {
  if (!completion) {
    return true;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      completion.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function throwIfRunnerContainerOperationAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
}

function abortRunnerContainerOperation(
  controller: AbortController | null,
  reason: Error,
): boolean {
  if (!controller || controller.signal.aborted) {
    return false;
  }

  controller.abort(reason);
  return true;
}

function combineRunnerContainerAbortSignals(
  first: AbortSignal,
  second: AbortSignal,
): AbortSignal {
  if (first.aborted) {
    return first;
  }

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  first.addEventListener("abort", () => abort(first), { once: true });
  second.addEventListener("abort", () => abort(second), { once: true });
  return controller.signal;
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

function readRunnerRuntimeCallbackBaseUrl(
  env: RunnerContainerEnvironmentSource,
  _userId: string,
): string | null {
  const configured = readOptionalRunnerContainerEnvString(
    env,
    HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL_ENV,
  );
  if (!configured) {
    return null;
  }

  return ensureTrailingSlash(new URL(configured)).toString();
}

function readRunnerContainerUserRunnerStub(
  env: RunnerContainerEnvironmentSource,
  userId: string,
): RunnerContainerUserRunnerStubLike | null {
  const namespace = env.USER_RUNNER;
  if (
    !namespace
    || typeof namespace !== "object"
    || typeof (namespace as { getByName?: unknown }).getByName !== "function"
  ) {
    return null;
  }

  return (namespace as {
    getByName(name: string): RunnerContainerUserRunnerStubLike;
  }).getByName(userId);
}

function ensureTrailingSlash(value: URL): URL {
  if (value.pathname.endsWith("/")) {
    return value;
  }
  const next = new URL(value.toString());
  next.pathname = `${next.pathname}/`;
  return next;
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

async function assertRunnerControlAuthorized(
  container: RunnerContainer,
  runnerControlToken: string,
  timeoutMs: number,
): Promise<void> {
  const response = await container.containerFetch(
    RUNNER_CONTROL_HEALTH_URL,
    {
      headers: {
        authorization: `Bearer ${runnerControlToken}`,
      },
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    },
    RUNNER_PORT,
  );

  if (!response.ok) {
    throw new Error(
      `Hosted runner container control health check returned HTTP ${response.status}.`,
    );
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

async function watchWorkspaceRequestContainerStop(input: {
  container: RunnerContainer;
  operationAbortController: AbortController;
  signal: AbortSignal;
  userId: string;
}): Promise<never> {
  const observedStatuses: string[] = [];
  let statusReadFailureLogged = false;
  while (!input.signal.aborted && !input.operationAbortController.signal.aborted) {
    await sleep(RUNNER_WAIT_INTERVAL_MS);
    if (input.signal.aborted || input.operationAbortController.signal.aborted) {
      break;
    }

    let status: string | null;
    try {
      status = await readRunnerContainerStatus(input.container);
    } catch (error) {
      if (!statusReadFailureLogged) {
        statusReadFailureLogged = true;
        emitHostedExecutionStructuredLog({
          component: "container",
          error,
          level: "warn",
          message: "Hosted execution container could not poll active request lifecycle status.",
          phase: "container.ready",
          userId: input.userId,
        });
      }
      continue;
    }

    appendObservedRunnerContainerStatus(observedStatuses, status);
    if (!isRunnerContainerStopped(status)) {
      continue;
    }

    const error = new Error(`workspace invocation container stopped during active work (${status})`);
    input.operationAbortController.abort(error);
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        lifecycleStage: "active-request-status-watch",
        observedStatuses,
        statusAfterStop: status,
      },
      error,
      level: "warn",
      message: "Hosted execution container stopped before workspace request settled.",
      phase: "failed",
      userId: input.userId,
    });
    throw error;
  }

  throw new DOMException("The container status watch was aborted.", "AbortError");
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

function readRunnerContainerIdleTtlMs(source: RunnerContainerEnvironmentSource): number {
  const raw = source.HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS;

  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RUNNER_IDLE_CHECKPOINT_DELAY_MS;
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

function computeRunnerActivityRenewIntervalMs(idleTtlMs: number): number {
  return Math.max(
    MIN_RUNNER_ACTIVITY_RENEW_INTERVAL_MS,
    Math.min(RUNNER_ACTIVITY_RENEW_INTERVAL_MS, Math.floor(idleTtlMs / 2)),
  );
}

function parseRunnerControlTokenRecord(value: unknown): RunnerControlTokenRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== RUNNER_CONTROL_TOKEN_SCHEMA_VERSION
    || typeof record.token !== "string"
    || record.token.length === 0
    || !isSafeNonNegativeInteger(record.updatedAt)
  ) {
    return null;
  }

  return {
    schemaVersion: RUNNER_CONTROL_TOKEN_SCHEMA_VERSION,
    token: record.token,
    updatedAt: record.updatedAt,
  };
}

function buildRunnerContainerMetadataOnlyErrorDetails(error: unknown): HostedExecutionStructuredLogDetails {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  if (!diagnostics) {
    return {};
  }

  return {
    detailsKeys: Object.keys(diagnostics).sort(),
    ...(typeof diagnostics.errorCode === "string" ? { errorCode: diagnostics.errorCode } : {}),
    ...(typeof diagnostics.errorCodeDetail === "string"
      ? { errorCodeDetail: diagnostics.errorCodeDetail }
      : {}),
    errorDetailPresent: typeof diagnostics.errorDetail === "string",
    ...(typeof diagnostics.errorMessage === "string" ? { errorMessage: diagnostics.errorMessage } : {}),
    ...(typeof diagnostics.errorName === "string" ? { errorName: diagnostics.errorName } : {}),
    ...(typeof diagnostics.errorStatus === "number" ? { errorStatus: diagnostics.errorStatus } : {}),
  };
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

function readRunnerDestroyTimeoutMs(source: RunnerContainerEnvironmentSource): number {
  const raw = source.HOSTED_EXECUTION_RUNNER_DESTROY_TIMEOUT_MS;

  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RUNNER_DESTROY_TIMEOUT_MS;
  }

  if (typeof raw !== "string") {
    throw new TypeError("HOSTED_EXECUTION_RUNNER_DESTROY_TIMEOUT_MS must be a string when configured.");
  }

  const parsed = readStrictPositiveIntegerEnv(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("HOSTED_EXECUTION_RUNNER_DESTROY_TIMEOUT_MS must be a positive integer.");
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
