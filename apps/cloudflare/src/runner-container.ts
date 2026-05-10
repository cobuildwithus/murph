import { Container, type OutboundHandlerContext, type StopParams } from "@cloudflare/containers";
import {
  type HostedAssistantWorkspaceRuntimeJobResult,
  type HostedAssistantRuntimeConfig,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
  type HostedExecutionStructuredLogDetails,
  type HostedExecutionStructuredLogDetailValue,
} from "@murphai/hosted-execution";
import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
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
  buildRunnerBrowserVaultRefreshAttemptId,
  RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION,
} from "./runner-outbound/browser-vault-refresh-authority.ts";
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
const RUNNER_CONTROL_HEALTH_URL = "http://container/internal/control-health";
const RUNNER_EXECUTE_URL = "http://container/internal/workspace-invocation";
const RUNNER_BROWSER_VAULT_REFRESH_URL = "http://container/internal/browser-vault-refresh";
const RUNNER_WAIT_INTERVAL_MS = 250;
const DEFAULT_RUNNER_READY_TIMEOUT_MS = 20_000;
const DEFAULT_RUNNER_DESTROY_TIMEOUT_MS = 5_000;
const DEFAULT_RUNNER_IDLE_CHECKPOINT_DELAY_MS = 300_000;
const RUNNER_CONTAINER_IDLE_FALLBACK_GRACE_MS = 120_000;
const RUNNER_DESTROY_STATUS_SAMPLE_LIMIT = 8;
const OUTBOUND_HANDLER_INSTALL_RETRY_LIMIT = 5;
const OUTBOUND_HANDLER_INSTALL_RETRY_DELAY_MS = 250;
const MIN_RUNNER_IDLE_TTL_MS = 1_000;
const RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 30_000;
const MIN_RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 250;
const RUNNER_BROWSER_VAULT_REFRESH_PREEMPT_TIMEOUT_MS = 500;
const RUNNER_CONTROL_TOKEN_STORAGE_KEY = "runner-container-control-token:v1";
const RUNNER_CONTROL_TOKEN_SCHEMA_VERSION = 1;
const RUNNER_ACTIVE_OPERATION_STORAGE_KEY_PREFIX = "runner-container-active-operation:v1:";
const RUNNER_ACTIVE_OPERATION_SCHEMA_VERSION = 1;
const RUNNER_ACTIVE_OPERATION_EXPIRY_GRACE_MS = 5_000;

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

interface HostedExecutionContainerBrowserVaultRefreshRequest {
  attemptId: string;
  runtime: HostedAssistantRuntimeConfig;
  timeoutMs: number;
  userId: string;
}

type HostedExecutionContainerBrowserVaultRefreshResult =
  | {
      byteLength: number;
      replicaRef: HostedBrowserVaultReplicaRef;
      status: "published";
    }
  | {
      byteLength: number;
      maxBytes: number;
      status: "refresh_failed_too_large";
    }
  | {
      // Deploy-skew compatibility for older container shells. New live
      // refreshes emit only published, refresh_failed_too_large, or
      // publish_conflict.
      status: "already_fresh" | "publish_conflict" | "stale_source" | "workspace_missing";
    };

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
  destroyInstance(): Promise<void>;
  invoke(input: HostedExecutionContainerInvokeRequest): Promise<HostedExecutionRunnerJobResult>;
  ownsInternalWorkerProxyToken(input: {
    attemptId?: string;
    leaseGeneration?: string;
    token: string;
    userId?: string;
  }): Promise<boolean>;
  refreshBrowserVaultReplica?(
    input: HostedExecutionContainerBrowserVaultRefreshRequest,
  ): Promise<HostedExecutionContainerBrowserVaultRefreshResult>;
  smokeHealth(): Promise<HostedExecutionContainerSmokeHealthResult>;
}

export interface HostedExecutionContainerNamespaceLike {
  getByName(name: string): HostedExecutionContainerStubLike;
}

type RunnerOutboundHandlerContext = OutboundHandlerContext<{
  attemptId?: unknown;
  internalWorkerProxyToken?: unknown;
  leaseGeneration?: unknown;
  userId?: unknown;
} | undefined>;

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

type RunnerActiveOperationKind = "browser-vault-refresh" | "workspace-invocation";

interface RunnerActiveOperationRecord {
  attemptId: string;
  expiresAt: number;
  kind: RunnerActiveOperationKind;
  leaseGeneration: string;
  schemaVersion: typeof RUNNER_ACTIVE_OPERATION_SCHEMA_VERSION;
  startedAt: number;
  userId: string;
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
  sleepAfter = formatRunnerSleepAfter(readRunnerContainerIdleTtlMs({}));

  private readonly environment: RunnerContainerEnvironmentSource;
  private lifecycleLock: Promise<void> = Promise.resolve();
  private currentLogContext: RunnerContainerLogContext | null = null;
  private runnerControlToken: string | null = null;
  private runnerOutboundProxyState: RunnerOutboundProxyState | null = null;
  private installedRunnerOutboundProxyState: RunnerOutboundProxyState | null = null;
  private browserVaultRefreshAbortController: AbortController | null = null;
  private browserVaultRefreshCompletion: Promise<void> | null = null;
  private browserVaultRefreshAttemptId: string | null = null;
  private workspaceInvocationAbortController: AbortController | null = null;
  private readonly browserVaultRefreshAttemptUsers = new Map<string, string>();
  private readonly pendingBrowserVaultRefreshAborts = new Set<string>();

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.environment = env;
    this.sleepAfter = formatRunnerSleepAfter(readRunnerContainerIdleTtlMs(env));
  }

  async invoke(
    payload: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedExecutionRunnerJobResult> {
    const input = parseHostedExecutionContainerInvokeInput(payload);
    await this.preemptBrowserVaultRefreshForForegroundInvocation(input.userId);
    return this.withLifecycleLock(async () =>
      this.invokeHostedExecution(input)
    );
  }

  async destroyInstance(): Promise<void> {
    this.workspaceInvocationAbortController?.abort(new Error("workspace invocation container destroyed"));
    this.browserVaultRefreshAbortController?.abort(new Error("browser-vault refresh runner destroyed"));
    await this.stopWarmContainer();
  }

  async refreshBrowserVaultReplica(
    payload: HostedExecutionContainerBrowserVaultRefreshRequest,
  ): Promise<HostedExecutionContainerBrowserVaultRefreshResult> {
    const input = parseHostedExecutionContainerBrowserVaultRefreshInput(payload);
    this.browserVaultRefreshAttemptUsers.set(input.attemptId, input.userId);
    try {
      return await this.withLifecycleLock(async () =>
        this.invokeHostedBrowserVaultRefresh(input)
      );
    } finally {
      this.browserVaultRefreshAttemptUsers.delete(input.attemptId);
      this.pendingBrowserVaultRefreshAborts.delete(input.attemptId);
    }
  }

  async abortBrowserVaultRefresh(input: { attemptId: string; userId: string }): Promise<void> {
    if (this.currentLogContext?.userId && this.currentLogContext.userId !== input.userId) {
      return;
    }

    const abortController = this.browserVaultRefreshAbortController;
    if (!abortController || this.browserVaultRefreshAttemptId !== input.attemptId) {
      this.pendingBrowserVaultRefreshAborts.add(input.attemptId);
      return;
    }
    if (abortController.signal.aborted) {
      return;
    }

    abortController.abort(new Error("browser-vault refresh preempted"));
    await this.browserVaultRefreshCompletion;
  }

  private async preemptBrowserVaultRefreshForForegroundInvocation(userId: string): Promise<void> {
    for (const [attemptId, attemptUserId] of this.browserVaultRefreshAttemptUsers) {
      if (attemptUserId === userId) {
        this.pendingBrowserVaultRefreshAborts.add(attemptId);
      }
    }

    const abortController = this.browserVaultRefreshAbortController;
    if (!abortController) {
      return;
    }
    if (this.currentLogContext?.userId && this.currentLogContext.userId !== userId) {
      return;
    }
    if (!abortController.signal.aborted) {
      abortController.abort(new Error("browser-vault refresh preempted"));
    }
    const preempted = await waitForRunnerContainerOperationCompletion(
      this.browserVaultRefreshCompletion,
      RUNNER_BROWSER_VAULT_REFRESH_PREEMPT_TIMEOUT_MS,
    );
    if (preempted) {
      return;
    }

    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        preemptTimeoutMs: RUNNER_BROWSER_VAULT_REFRESH_PREEMPT_TIMEOUT_MS,
      },
      level: "warn",
      message: "Hosted execution container browser-vault refresh did not release promptly after foreground preemption.",
      phase: "container.ready",
      userId,
    });
    await this.stopWarmContainer({ failClosed: true });
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
      const now = Date.now();
      const activeOperations = await this.readRunnerActiveOperations();
      if (activeOperations === null) {
        this.noteRunnerActivity("activity-expired-active-operation");
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            lifecycleStage: "activity-expired-active-operation-read-failed",
          },
          level: "warn",
          message: "Hosted execution container activity expiry yielded because active operation state could not be read.",
          phase: "container.ready",
          userId: this.currentLogContext?.userId,
        });
        return;
      }

      const liveOperations = activeOperations
        .filter((operation) => operation.expiresAt > now)
        .sort(compareRunnerActiveOperationRecords);
      const staleOperations = activeOperations
        .filter((operation) => operation.expiresAt <= now)
        .sort(compareRunnerActiveOperationRecords);
      const activeOperation = liveOperations[0] ?? null;
      if (activeOperation) {
        this.noteRunnerActivity("activity-expired-active-operation");
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            activeOperationAgeMs: Math.max(0, now - activeOperation.startedAt),
            activeOperationCount: liveOperations.length,
            activeOperationExpiresInMs: Math.max(0, activeOperation.expiresAt - now),
            activeOperationKind: activeOperation.kind,
            lifecycleStage: "activity-expired-active-operation",
            workspaceAttemptId: activeOperation.attemptId,
          },
          message: "Hosted execution container activity expiry yielded to active runner operation.",
          phase: "container.ready",
          userId: activeOperation.userId,
        });
        return;
      }

      const staleOperation = staleOperations[0] ?? null;
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          ...(staleOperation
            ? {
                activeOperationAgeMs: Math.max(0, now - staleOperation.startedAt),
                activeOperationKind: staleOperation.kind,
                activeOperationStaleCount: staleOperations.length,
                activeOperationStaleMs: Math.max(0, now - staleOperation.expiresAt),
                workspaceAttemptId: staleOperation.attemptId,
              }
            : {}),
          lifecycleStage: "activity-expired-fallback-cleanup",
        },
        message: "Hosted execution container activity expired; running fallback cleanup.",
        phase: "container.ready",
        userId: staleOperation?.userId ?? this.currentLogContext?.userId,
      });
      await this.stopWarmContainer({ failClosed: false });
      for (const operation of staleOperations) {
        await this.clearRunnerActiveOperation(operation);
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
    const stoppedDuringActiveWork =
      abortedOperations.browserVaultRefresh || abortedOperations.workspaceInvocation;
    const cleanExit = params.exitCode === 0;
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        activeBrowserVaultRefreshAborted: abortedOperations.browserVaultRefresh,
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

  private abortActiveOperationsForContainerStop(params: StopParams): {
    browserVaultRefresh: boolean;
    workspaceInvocation: boolean;
  } {
    return {
      browserVaultRefresh: abortRunnerContainerOperation(
        this.browserVaultRefreshAbortController,
        new Error(
          `browser-vault refresh container stopped during active work (${params.reason}, exit ${params.exitCode})`,
        ),
      ),
      workspaceInvocation: abortRunnerContainerOperation(
        this.workspaceInvocationAbortController,
        new Error(
          `workspace invocation container stopped during active work (${params.reason}, exit ${params.exitCode})`,
        ),
      ),
    };
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
    const activeOperation = createRunnerActiveOperationRecord({
      attemptId: outboundProxyState.attemptId,
      kind: "workspace-invocation",
      leaseGeneration: outboundProxyState.leaseGeneration,
      timeoutMs: input.timeoutMs,
      userId: routeUserId,
    });
    let completedSuccessfully = false;
    this.currentLogContext = logContext;
    const operationAbortController = new AbortController();
    this.workspaceInvocationAbortController = operationAbortController;
    let activeOperationAcquired = false;
    let stopRunnerActivityRenewal: (() => void) | null = null;

    try {
      await this.writeRunnerActiveOperation(activeOperation);
      activeOperationAcquired = true;
      stopRunnerActivityRenewal = this.startRunnerActivityRenewal();
      this.noteRunnerActivity("invoke-started");
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
          runnerIdleTtlMs: readRunnerContainerIdleTtlMs(this.environment),
          runnerPort: RUNNER_PORT,
          timeoutMs: input.timeoutMs,
        },
        message: "Hosted execution container invocation received.",
        phase: "container.starting",
        userId: routeUserId,
      });
      const runnerControlToken = await this.ensureContainerReady(input);
      this.noteRunnerActivity("container-ready");
      throwIfRunnerContainerOperationAborted(operationAbortController.signal);
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
      const requestSignal = combineRunnerContainerAbortSignals(
        operationAbortController.signal,
        AbortSignal.timeout(remainingTimeoutMs),
      );
      const runnerRequest = this.containerFetch(
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
          const outboundProxyExpired = await this.expireOutboundProxyState(outboundProxyState);
          const shouldKeepWarm = completedSuccessfully && outboundProxyExpired;
          if (!shouldKeepWarm) {
            await this.stopWarmContainer({
              failClosed: true,
            });
          }
        }
      } finally {
        if (activeOperationAcquired) {
          await this.clearRunnerActiveOperation(activeOperation);
        }
        stopRunnerActivityRenewal?.();
        this.noteRunnerActivity("invoke-finished");
        if (this.currentLogContext === logContext) {
          this.currentLogContext = null;
        }
        if (this.workspaceInvocationAbortController === operationAbortController) {
          this.workspaceInvocationAbortController = null;
        }
      }
    }
  }

  private async invokeHostedBrowserVaultRefresh(
    input: HostedExecutionContainerBrowserVaultRefreshRequest,
  ): Promise<HostedExecutionContainerBrowserVaultRefreshResult> {
    const localInternalProxyBaseUrl = readOptionalRunnerContainerEnvString(
      this.environment,
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL_ENV,
    );
    const logContext: RunnerContainerLogContext = {
      userId: input.userId,
    };
    const outboundProxyState: RunnerOutboundProxyState = {
      attemptId: input.attemptId,
      leaseGeneration: RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION,
      token: createRunnerOutboundProxyToken(),
      userId: input.userId,
    };
    const activeOperation = createRunnerActiveOperationRecord({
      attemptId: outboundProxyState.attemptId,
      kind: "browser-vault-refresh",
      leaseGeneration: outboundProxyState.leaseGeneration,
      timeoutMs: input.timeoutMs,
      userId: input.userId,
    });
    const operationAbortController = new AbortController();
    let completeRefresh: () => void = () => undefined;
    this.browserVaultRefreshAbortController = operationAbortController;
    this.browserVaultRefreshAttemptId = input.attemptId;
    this.browserVaultRefreshCompletion = new Promise<void>((resolve) => {
      completeRefresh = resolve;
    });
    this.currentLogContext = logContext;
    let activeOperationAcquired = false;
    let stopRunnerActivityRenewal: (() => void) | null = null;

    try {
      if (this.pendingBrowserVaultRefreshAborts.delete(input.attemptId)) {
        operationAbortController.abort(new Error("browser-vault refresh preempted"));
      }
      throwIfRunnerContainerOperationAborted(operationAbortController.signal);
      await this.writeRunnerActiveOperation(activeOperation);
      activeOperationAcquired = true;
      stopRunnerActivityRenewal = this.startRunnerActivityRenewal();
      this.noteRunnerActivity("browser-vault-refresh-started");
      const startTime = Date.now();
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          hasLocalInternalProxyBaseUrl: localInternalProxyBaseUrl !== null,
          readyTimeoutMs: readRunnerReadyTimeoutMs(this.environment),
          runnerIdleTtlMs: readRunnerContainerIdleTtlMs(this.environment),
          runnerPort: RUNNER_PORT,
          timeoutMs: input.timeoutMs,
        },
        message: "Hosted execution container browser-vault refresh received.",
        phase: "container.starting",
        userId: input.userId,
      });
      const runnerControlToken = await this.ensureContainerReady(input);
      this.noteRunnerActivity("container-ready");
      throwIfRunnerContainerOperationAborted(operationAbortController.signal);
      this.runnerOutboundProxyState = outboundProxyState;
      await this.installOutboundHandlers(outboundProxyState);

      const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - startTime));
      throwIfRunnerContainerOperationAborted(operationAbortController.signal);
      const requestSignal = combineRunnerContainerAbortSignals(
        operationAbortController.signal,
        AbortSignal.timeout(remainingTimeoutMs),
      );
      const response = await raceRunnerContainerOperationAbort(
        this.containerFetch(
          RUNNER_BROWSER_VAULT_REFRESH_URL,
          {
            body: JSON.stringify({
              internalWorkerProxyToken: outboundProxyState.token,
              localInternalProxyBaseUrl: createChildLocalInternalProxyBaseUrl({
                localInternalProxyBaseUrl,
                userId: input.userId,
              }),
              runtime: input.runtime,
              userId: input.userId,
            }),
            headers: {
              authorization: `Bearer ${runnerControlToken}`,
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
            signal: requestSignal,
          },
          RUNNER_PORT,
        ),
        requestSignal,
      );
      this.noteRunnerActivity("browser-vault-refresh-response-received");

      if (!response.ok) {
        throw await classifyHostedRunnerContainerErrorResponse(response);
      }

      const result = parseHostedBrowserVaultRefreshContainerResult(await response.json());
      return result;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: buildRunnerContainerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted execution container browser-vault refresh failed.",
        phase: "failed",
        userId: input.userId,
      });
      throw error;
    } finally {
      try {
        if (activeOperationAcquired) {
          const outboundProxyExpired = await this.expireOutboundProxyState(outboundProxyState);
          if (!outboundProxyExpired) {
            await this.stopWarmContainer({
              failClosed: true,
            });
          }
        }
      } finally {
        if (activeOperationAcquired) {
          await this.clearRunnerActiveOperation(activeOperation);
        }
        stopRunnerActivityRenewal?.();
        this.noteRunnerActivity("browser-vault-refresh-finished");
        if (this.currentLogContext === logContext) {
          this.currentLogContext = null;
        }
        if (this.browserVaultRefreshAbortController === operationAbortController) {
          this.browserVaultRefreshAbortController = null;
        }
        if (this.browserVaultRefreshAttemptId === input.attemptId) {
          this.browserVaultRefreshAttemptId = null;
        }
        if (this.browserVaultRefreshCompletion) {
          this.browserVaultRefreshCompletion = null;
        }
        this.pendingBrowserVaultRefreshAborts.delete(input.attemptId);
        completeRefresh();
      }
    }
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
    await this.writeRunnerControlToken(runnerControlToken);

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
            attemptId: state.attemptId,
            internalWorkerProxyToken: state.token,
            leaseGeneration: state.leaseGeneration,
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
    const destroyTimeoutMs = readRunnerDestroyTimeoutMs(this.environment);
    let statusBeforeDestroy: string | null = null;

    try {
      statusBeforeDestroy = await readRunnerContainerStatus(this);
      if (isRunnerContainerStopped(statusBeforeDestroy)) {
        return;
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
      return;
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
        return;
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
    } catch (error) {
      if (isMissingRunnerContainerError(error)) {
        return;
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
    await this.clearRunnerControlToken();
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

  private async readRunnerActiveOperations(): Promise<RunnerActiveOperationRecord[] | null> {
    try {
      const values = await this.ctx.storage.list<unknown>({
        prefix: RUNNER_ACTIVE_OPERATION_STORAGE_KEY_PREFIX,
      });
      return Array.from(values.values())
        .map(parseRunnerActiveOperationRecord)
        .filter((record): record is RunnerActiveOperationRecord => record !== null);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "warn",
        message: "Hosted execution container failed to read active operation state.",
        phase: "container.ready",
        userId: this.currentLogContext?.userId,
      });
      return null;
    }
  }

  private async writeRunnerControlToken(token: string): Promise<void> {
    const record: RunnerControlTokenRecord = {
      schemaVersion: RUNNER_CONTROL_TOKEN_SCHEMA_VERSION,
      token,
      updatedAt: Date.now(),
    };

    try {
      await this.ctx.storage.put(RUNNER_CONTROL_TOKEN_STORAGE_KEY, record);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "warn",
        message: "Hosted execution container could not write control token state.",
        phase: "container.ready",
        userId: this.currentLogContext?.userId,
      });
    }
  }

  private async writeRunnerActiveOperation(record: RunnerActiveOperationRecord): Promise<void> {
    try {
      await this.ctx.storage.put(createRunnerActiveOperationStorageKey(record), record);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "warn",
        message: "Hosted execution container failed to write active operation state.",
        phase: "container.ready",
        userId: record.userId,
      });
      throw new Error("Hosted runner container active operation state could not be persisted.");
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

  private async clearRunnerActiveOperation(record: RunnerActiveOperationRecord): Promise<void> {
    try {
      const key = createRunnerActiveOperationStorageKey(record);
      const current = parseRunnerActiveOperationRecord(
        await this.ctx.storage.get<unknown>(key),
      );
      if (!current || !isSameRunnerActiveOperationRecord(current, record)) {
        return;
      }
      await this.ctx.storage.delete(key);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "warn",
        message: "Hosted execution container failed to clear active operation state.",
        phase: "container.ready",
        userId: record.userId,
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

  const container = input.runnerContainerNamespace.getByName(input.runnerContainerName ?? jobUserId);
  const invocation = container.invoke({
    job: input.job,
    timeoutMs: input.timeoutMs,
    userId: jobUserId,
  });
  return input.signal
    ? await raceRunnerContainerOperationAbort(invocation, input.signal, async () => {
        void container.destroyInstance().catch((error: unknown) => {
          emitHostedExecutionStructuredLog({
            component: "container",
            error,
            level: "warn",
            message: "Hosted runner could not destroy a preempted invocation container.",
            phase: "failed",
            userId: jobUserId,
          });
        });
      })
    : await invocation;
}

export async function refreshHostedExecutionContainerBrowserVaultReplica(input: {
  runnerContainerName?: string;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  runtime: HostedAssistantRuntimeConfig;
  signal?: AbortSignal;
  timeoutMs: number;
  userId: string;
}): Promise<HostedExecutionContainerBrowserVaultRefreshResult> {
  const container = input.runnerContainerNamespace.getByName(
    input.runnerContainerName ?? input.userId,
  );
  if (!container.refreshBrowserVaultReplica) {
    throw new Error("Hosted runner container does not support browser-vault refresh.");
  }
  if (input.signal) {
    throwIfRunnerContainerOperationAborted(input.signal);
  }
  if (input.signal && !container.abortBrowserVaultRefresh) {
    throw new Error("Hosted runner container does not support browser-vault refresh abort.");
  }

  const attemptId = buildRunnerBrowserVaultRefreshAttemptId(createRunnerOutboundProxyToken());
  const refresh = container.refreshBrowserVaultReplica({
    attemptId,
    runtime: input.runtime,
    timeoutMs: input.timeoutMs,
    userId: input.userId,
  });
  return input.signal
    ? await raceRunnerContainerOperationAbort(refresh, input.signal, async () => {
        await container.abortBrowserVaultRefresh?.({ attemptId, userId: input.userId });
      })
    : await refresh;
}

async function raceRunnerContainerOperationAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onOperationAbort?: () => Promise<void>,
): Promise<T> {
  throwIfRunnerContainerOperationAborted(signal);

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
      {
        proxyAttemptId: requireString(ctx.params?.attemptId, "ctx.params.attemptId"),
        proxyLeaseGeneration: requireString(
          ctx.params?.leaseGeneration,
          "ctx.params.leaseGeneration",
        ),
      },
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

function parseHostedExecutionContainerBrowserVaultRefreshInput(
  payload: {
    attemptId?: unknown;
    runtime?: unknown;
    timeoutMs?: unknown;
    userId?: unknown;
  },
): HostedExecutionContainerBrowserVaultRefreshRequest {
  return {
    attemptId: requireString(payload.attemptId, "payload.attemptId"),
    runtime: readHostedAssistantRuntimeConfig(payload.runtime),
    timeoutMs: readTimeoutMs(payload.timeoutMs, DEFAULT_RUNNER_READY_TIMEOUT_MS),
    userId: requireString(payload.userId, "payload.userId"),
  };
}

function readHostedAssistantRuntimeConfig(value: unknown): HostedAssistantRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("payload.runtime must be an object.");
  }

  return value as HostedAssistantRuntimeConfig;
}

function parseHostedBrowserVaultRefreshContainerResult(
  value: unknown,
): HostedExecutionContainerBrowserVaultRefreshResult {
  const record = requireRecord(value, "Hosted browser-vault refresh container result");
  const status = requireString(record.status, "Hosted browser-vault refresh container result.status");

  if (status === "published") {
    const replicaRef = parseHostedBrowserVaultReplicaRef(
      record.replicaRef,
      "Hosted browser-vault refresh container result.replicaRef",
    );
    if (!replicaRef) {
      throw new TypeError("Hosted browser-vault refresh container result.replicaRef must not be null.");
    }

    return {
      byteLength: requireNonNegativeNumber(
        record.byteLength,
        "Hosted browser-vault refresh container result.byteLength",
      ),
      replicaRef,
      status,
    };
  }

  if (status === "refresh_failed_too_large") {
    return {
      byteLength: requireNonNegativeNumber(
        record.byteLength,
        "Hosted browser-vault refresh container result.byteLength",
      ),
      maxBytes: requireNonNegativeNumber(
        record.maxBytes,
        "Hosted browser-vault refresh container result.maxBytes",
      ),
      status,
    };
  }

  if (
    status === "already_fresh"
    || status === "publish_conflict"
    || status === "stale_source"
    || status === "workspace_missing"
  ) {
    return {
      status,
    };
  }

  throw new TypeError(
    "Hosted browser-vault refresh container result.status must be published, refresh_failed_too_large, already_fresh, publish_conflict, stale_source, or workspace_missing.",
  );
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

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative number.`);
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
    return DEFAULT_RUNNER_IDLE_CHECKPOINT_DELAY_MS + RUNNER_CONTAINER_IDLE_FALLBACK_GRACE_MS;
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

  return parsed + RUNNER_CONTAINER_IDLE_FALLBACK_GRACE_MS;
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

function createRunnerActiveOperationRecord(input: {
  attemptId: string;
  kind: RunnerActiveOperationKind;
  leaseGeneration: string;
  timeoutMs: number;
  userId: string;
}): RunnerActiveOperationRecord {
  const startedAt = Date.now();
  return {
    attemptId: input.attemptId,
    expiresAt: startedAt + Math.max(1, input.timeoutMs) + RUNNER_ACTIVE_OPERATION_EXPIRY_GRACE_MS,
    kind: input.kind,
    leaseGeneration: input.leaseGeneration,
    schemaVersion: RUNNER_ACTIVE_OPERATION_SCHEMA_VERSION,
    startedAt,
    userId: input.userId,
  };
}

function createRunnerActiveOperationStorageKey(record: RunnerActiveOperationRecord): string {
  return `${RUNNER_ACTIVE_OPERATION_STORAGE_KEY_PREFIX}${encodeURIComponent(record.kind)}:${
    encodeURIComponent(record.attemptId)
  }:${encodeURIComponent(record.leaseGeneration)}:${record.startedAt}`;
}

function parseRunnerActiveOperationRecord(value: unknown): RunnerActiveOperationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== RUNNER_ACTIVE_OPERATION_SCHEMA_VERSION
    || !isRunnerActiveOperationKind(record.kind)
    || typeof record.attemptId !== "string"
    || record.attemptId.length === 0
    || typeof record.leaseGeneration !== "string"
    || record.leaseGeneration.length === 0
    || typeof record.userId !== "string"
    || record.userId.length === 0
    || !isSafeNonNegativeInteger(record.startedAt)
    || !isSafeNonNegativeInteger(record.expiresAt)
    || record.expiresAt <= record.startedAt
  ) {
    return null;
  }

  return {
    attemptId: record.attemptId,
    expiresAt: record.expiresAt,
    kind: record.kind,
    leaseGeneration: record.leaseGeneration,
    schemaVersion: RUNNER_ACTIVE_OPERATION_SCHEMA_VERSION,
    startedAt: record.startedAt,
    userId: record.userId,
  };
}

function isRunnerActiveOperationKind(value: unknown): value is RunnerActiveOperationKind {
  return value === "browser-vault-refresh" || value === "workspace-invocation";
}

function isSameRunnerActiveOperationRecord(
  left: RunnerActiveOperationRecord,
  right: RunnerActiveOperationRecord,
): boolean {
  return left.attemptId === right.attemptId
    && left.kind === right.kind
    && left.leaseGeneration === right.leaseGeneration
    && left.startedAt === right.startedAt
    && left.userId === right.userId;
}

function compareRunnerActiveOperationRecords(
  left: RunnerActiveOperationRecord,
  right: RunnerActiveOperationRecord,
): number {
  return left.startedAt - right.startedAt
    || left.expiresAt - right.expiresAt
    || left.kind.localeCompare(right.kind)
    || left.attemptId.localeCompare(right.attemptId);
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
