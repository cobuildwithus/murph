import { Container, type StopParams } from "@cloudflare/containers";
import type {
  CloudflareHostedControlRuntimeShellPrewarmSource,
} from "@murphai/cloudflare-hosted-control/client";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
  summarizeHostedExecutionErrorCode,
  type HostedExecutionStructuredLogDetails,
  type HostedExecutionStructuredLogDetailValue,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY,
  isHostedRuntimeFailurePhaseCode,
  type HostedRuntimeFailurePhaseCode,
  type HostedWorkspaceInvocationProcessingMode,
} from "@murphai/hosted-execution/runtime-control";
import { methodNotAllowed } from "./json.ts";
import {
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "./runner-egress-intercept.ts";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "./hosted-runtime-architecture.ts";
import {
  buildHostedRunnerContainerCaEnv,
} from "./runner-container-ca-env.ts";
import {
  HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
} from "./runner-container-error-codes.ts";
import {
  readHostedRunnerContainerIdentity,
  resolveHostedExecutionRunnerContainerName as resolveHostedExecutionRunnerContainerNameFromIdentity,
  type HostedRunnerContainerIdentitySource,
} from "./hosted-runner-container-identity.js";
import {
  assertHostedExecutionRunnerJobResult,
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionRunnerJobInput,
  type HostedExecutionRunnerJobResult,
} from "./runner-job-transport.ts";
import {
  buildHostedRuntimeOrchestrationLatencyHeaders,
  sanitizeHostedRuntimeOrchestrationLatencyDiagnostics,
  type HostedRuntimeOrchestrationLatencyDiagnostics,
} from "./orchestration-latency-diagnostics.ts";
import type {
  WorkerActiveRuntimeUserFenceResult,
  WorkerUserRunnerNamespaceLike,
} from "./worker-contracts.ts";

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_HEALTH_URL = "http://container/health";
const RUNNER_EXECUTE_URL = "http://container/internal/workspace-invocation";
const RUNNER_ABORT_WORKSPACE_INVOCATION_URL =
  "http://container/internal/workspace-invocation/abort";
const RUNNER_CODEX_SHELL_SMOKE_URL =
  "http://container/internal/deploy-codex-shell-smoke";
const RUNNER_LIVE_MODEL_TURN_SMOKE_URL =
  "http://container/internal/deploy-live-model-turn-smoke";
const RUNNER_DIRECT_R2_PRESIGNED_PUT_SMOKE_URL =
  "http://container/internal/direct-r2-presigned-put-smoke";
// Covers the container-side 60s codex exec budget plus boot/dispatch margin.
const RUNNER_LIVE_MODEL_TURN_SMOKE_MIN_TIMEOUT_MS = 90_000;
const RUNNER_RUNTIME_WAKE_URL = "http://container/internal/runtime-wake";
const RUNNER_WAIT_INTERVAL_MS = 250;
const RUNNER_STOPPED_REQUEST_SETTLE_MS = 1_000;
const RUNNER_DESTROY_SETTLE_TIMEOUT_MS = 5_000;
const DEFAULT_RUNNER_READY_TIMEOUT_MS = 90_000;
const DEFAULT_RUNNER_ABORT_WORKSPACE_INVOCATION_TIMEOUT_MS = 1_000;
const DEFAULT_RUNNER_ACTIVE_LIVENESS_TIMEOUT_MS = 1_000;
const DEFAULT_RUNNER_RUNTIME_WAKE_TIMEOUT_MS = 5_000;
const RUNNER_RUNTIME_COMPLETION_RECEIPT_TIMEOUT_MS = 1_000;
const RUNNER_RECENT_READINESS_PROOF_MAX_AGE_MS = 5_000;
const RUNNER_READINESS_ABORT_SETTLEMENT_TIMEOUT_MS = 5_000;
const RUNNER_METADATA_RESPONSE_BODY_MAX_BYTES = 64 * 1024;
const RUNNER_METADATA_RESPONSE_BODY_DRAIN_TIMEOUT_MS = 5_000;
const RUNNER_TRANSPORT_FAILURE_DETAIL_MAX_CHARS = 1_024;
const HOSTED_RUNNER_CONTAINER_SAFE_ERROR_MESSAGES = new Set([
  "Hosted bundle archive validation failed.",
  "Hosted execution authorization failed.",
  "Hosted execution configuration is invalid.",
  "Hosted execution rejected an invalid request.",
  "Hosted execution runtime failed.",
  "Hosted execution timed out.",
  "Hosted runner is shutting down.",
  "Invalid request.",
  "Request body too large.",
]);
const DEFAULT_RUNNER_IDLE_TTL_MS = 300_000;
const MIN_RUNNER_IDLE_TTL_MS = 1_000;
const MIN_RUNNER_LIFECYCLE_REEVALUATION_MS = 1_000;
const RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 30_000;
const MIN_RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 250;
const WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE = "workspace invocation preempted";
const BASE_RUNNER_CONTAINER_ENV_VARS = {
  ...buildHostedRunnerContainerCaEnv(),
  PORT: String(RUNNER_PORT),
} as const;

class HostedRunnerContainerArchitectureMismatchError extends Error {
  readonly actualVersion: string | null;
  readonly expectedVersion: string;

  constructor(input: { actualVersion: string | null; expectedVersion: string }) {
    super("Hosted runner container architecture version mismatch.");
    this.name = "HostedRunnerContainerArchitectureMismatchError";
    this.actualVersion = input.actualVersion;
    this.expectedVersion = input.expectedVersion;
  }
}

class HostedRunnerContainerBundleMismatchError extends Error {
  constructor() {
    super("Hosted runner container bundle fingerprint mismatch.");
    this.name = "HostedRunnerContainerBundleMismatchError";
  }
}

class HostedRunnerContainerPoisonedError extends Error {
  readonly lastCleanupStatus: string | null;

  constructor(input: { lastCleanupStatus: string | null }) {
    super("Hosted runner container is poisoned.");
    this.name = "HostedRunnerContainerPoisonedError";
    this.lastCleanupStatus = input.lastCleanupStatus;
  }
}

class HostedRunnerContainerMetadataResponseError extends Error {
  readonly code = "runner_http_error";
  readonly details: HostedExecutionStructuredLogDetails;
  readonly statusCode: number;

  constructor(input: {
    details: HostedExecutionStructuredLogDetails;
    statusCode: number;
  }) {
    super(`Hosted runner container returned HTTP ${input.statusCode} with non-JSON metadata response.`);
    this.name = "HostedRunnerContainerMetadataResponseError";
    this.details = input.details;
    this.statusCode = input.statusCode;
  }
}

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

class HostedRunnerContainerShuttingDownError extends Error {
  readonly code = HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE;
  readonly details: HostedExecutionStructuredLogDetails | null;
  readonly statusCode: number;

  constructor(input: {
    details: HostedExecutionStructuredLogDetails | null;
    message: string;
    statusCode: number;
  }) {
    super(input.message);
    this.details = input.details;
    this.name = "HostedRunnerContainerShuttingDownError";
    this.statusCode = input.statusCode;
  }
}

class RunnerContainerShellPrewarmSupersededError extends Error {
  constructor() {
    super("Hosted runner shell prewarm was superseded by authoritative readiness.");
    this.name = "RunnerContainerShellPrewarmSupersededError";
  }
}

class RunnerContainerCleanupUnsettledError extends Error {
  constructor(cause: unknown) {
    super("Hosted runner container cleanup did not settle before its deadline.", { cause });
    this.name = "RunnerContainerCleanupUnsettledError";
  }
}

interface HostedExecutionContainerInvokeRequest {
  job: HostedExecutionRunnerJobInput;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  timeoutMs?: number | null;
  userId: string;
}

type HostedExecutionContainerInvokeInput = HostedExecutionContainerInvokeRequest;

export interface RunnerContainerEnsureReadyForProcessingInput {
  timeoutMs: number;
  userId: string;
}

export type RunnerContainerEnsureReadyForProcessingResult =
  | {
      action?: "already_warm" | "started";
      kind: "ready";
      shellPrewarmObservation?: RunnerContainerShellPrewarmObservation;
    }
  | {
      action?: never;
      kind: "cleanup_unsettled";
      shellPrewarmObservation?: never;
    };

export interface RunnerContainerShellPrewarmObservation {
  firstHintAtEpochMs: number;
  hintCount: number;
  finishedAtEpochMs?: number;
  operationElapsedMs?: number;
  outcome?: RunnerContainerShellPrewarmOutcome;
  source: CloudflareHostedControlRuntimeShellPrewarmSource | "unknown";
}

export type RunnerContainerShellPrewarmOutcome =
  | "cold_start_observed"
  | "failed"
  | "start_issued_warm"
  | "superseded";

export interface RunnerContainerBeginShellPrewarmInput
  extends RunnerContainerEnsureReadyForProcessingInput {
  source?: CloudflareHostedControlRuntimeShellPrewarmSource;
}

export type RunnerContainerPrewarmShellResult =
  | {
      action: "start_issued";
      kind: "started";
    }
  | {
      action: "superseded";
      kind: "superseded";
    };

export interface RunnerContainerBeginShellPrewarmResult {
  accepted: true;
}

interface HostedExecutionContainerRunnerInput {
  job: HostedExecutionRunnerJobInput;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  runnerContainerName?: string;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  signal?: AbortSignal;
  timeoutMs?: number | null;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  abortWorkspaceInvocation?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<RunnerWorkspaceInvocationAbortStatus>;
  destroyInstance(): Promise<void>;
  ensureReadyForProcessing?(
    input: RunnerContainerEnsureReadyForProcessingInput,
  ): Promise<RunnerContainerEnsureReadyForProcessingResult>;
  beginShellPrewarm?(
    input: RunnerContainerBeginShellPrewarmInput,
  ): Promise<RunnerContainerBeginShellPrewarmResult>;
  prewarmShell?(
    input: RunnerContainerEnsureReadyForProcessingInput,
  ): Promise<RunnerContainerPrewarmShellResult>;
  ensureProcessing?(input: RunnerContainerEnsureProcessingInput): Promise<RunnerContainerEnsureProcessingResult>;
  invoke(input: HostedExecutionContainerInvokeRequest): Promise<HostedExecutionRunnerJobResult>;
  readActiveRuntimeUserFence?(): Promise<WorkerActiveRuntimeUserFenceResult>;
  smokeHealth(input?: HostedExecutionContainerSmokeHealthInput): Promise<HostedExecutionContainerSmokeHealthResult>;
  wakeRuntime?(input: RunnerRuntimeWakeInput): Promise<RunnerRuntimeWakeResult>;
}

export interface HostedExecutionContainerNamespaceLike {
  get?(id: unknown): HostedExecutionContainerStubLike;
  getByName(name: string): HostedExecutionContainerStubLike;
  idFromString?(id: string): unknown;
}

type RunnerContainerEnvironmentSource = Readonly<Record<string, unknown>> & {
  USER_RUNNER?: WorkerUserRunnerNamespaceLike;
};
type RunnerContainerNameSource = HostedRunnerContainerIdentitySource;

interface RunnerContainerLogContext {
  userId: string;
}

interface RunnerContainerShellPrewarmOperation {
  abortController: AbortController;
  coldStartAlreadyObserved: boolean;
  observed: boolean;
  result: Promise<RunnerContainerPrewarmShellResult>;
  startedAtMs: number;
}

interface RunnerContainerReadinessProof {
  checkedAtMs: number;
  stopGeneration: number;
  userId: string;
}

type RunnerContainerReadinessObservation =
  | "cold-start-ready"
  | "deploy-smoke-ready";

interface RunnerContainerCurrentStart {
  pendingUntilMs: number | null;
  readyObservedBy: RunnerContainerReadinessObservation | null;
  startedAtMs: number;
}

export type RunnerWorkspaceInvocationAbortStatus =
  | "accepted"
  | "failed"
  | "inactive"
  | "queued"
  | "stale";

type RunnerWorkspaceInvocationAbortPostStatus =
  Exclude<RunnerWorkspaceInvocationAbortStatus, "inactive">;

type RunnerContainerDestroyReason =
  | "activity-expired"
  | "cold-start-failure"
  | "deploy-smoke-cleanup"
  | "deploy-smoke-recycle"
  | "destroy-instance"
  | "invoke-failure"
  | "readiness-failure"
  | "warm-health-failed"
  | "warm-invalidated";

interface RunnerContainerDestroyRequestRecord {
  failClosed: boolean;
  reason: RunnerContainerDestroyReason;
  requestedAtMs: number;
  statusBeforeDestroy: string | null;
}

interface HostedExecutionContainerSmokeHealthResult {
  codexShell?: {
    cliSurfaceContractBytes: number | null;
    cliSurfaceHotPathProofCount: number | null;
    client: string | null;
    murphPathBytes: number | null;
    noteAddBytes: number | null;
    stderrBytes: number | null;
    vaultCliLlmsBytes: number | null;
    vaultCliPathBytes: number | null;
    vaultShowBytes: number | null;
  } | null;
  directR2PresignedPut?: {
    byteLength: number | null;
    durationMs: number | null;
    ok: boolean;
    payloadSha256: string | null;
    responseBodyBytes: number | null;
    status: number | null;
  } | null;
  liveModelTurn?: {
    durationMs: number | null;
    egressGrantConsumed: boolean | null;
    model: string | null;
    stdoutBytes: number | null;
  } | null;
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

interface HostedExecutionContainerSmokeHealthInput {
  directR2PresignedPut?: {
    byteLength?: number;
    presignedPutUrl: string;
    tlsCaCertificatePem?: string;
  };
  liveModelTurn?: {
    model: string;
  };
}

interface RunnerActivityTimeoutRenewable {
  renewActivityTimeout(): void;
}

interface RunnerContainerHealth {
  activeJobCount: number;
  conversationWarmActivityCompletedAtEpochMs: number | null | undefined;
}

interface RunnerWorkspaceInvocationOperation {
  abortController: AbortController;
  abortEndpointReady: boolean;
  abortResult: Promise<RunnerWorkspaceInvocationAbortStatus> | null;
  attemptId: string;
  leaseGeneration: string;
  processingMode: RunnerRuntimeProcessingMode;
  requiresFailClosedStopReason:
    | "cleanup_failed"
    | "transport_uncertain"
    | null;
  result: Promise<HostedExecutionRunnerJobResult> | null;
  userId: string;
}

interface RunnerWorkspaceInvocationNoPointerAbort {
  attemptId: string;
  leaseGeneration: string;
  result: Promise<RunnerWorkspaceInvocationAbortStatus>;
  userId: string;
}

type RunnerRuntimeProcessingMode = HostedWorkspaceInvocationProcessingMode;

function createRunnerWorkspaceInvocationOperation(
  input: HostedExecutionContainerInvokeInput,
): RunnerWorkspaceInvocationOperation {
  return {
    abortController: new AbortController(),
    abortEndpointReady: false,
    abortResult: null,
    attemptId: input.job.request.attemptId,
    leaseGeneration: input.job.request.leaseGeneration,
    processingMode:
      normalizeRunnerRuntimeProcessingMode(input.job.request.processingMode),
    requiresFailClosedStopReason: null,
    result: null,
    userId: readHostedExecutionRunnerJobUserId(input.job),
  };
}

function runnerWorkspaceInvocationOperationMatches(
  operation: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  },
  input: {
    attemptId: string;
    leaseGeneration: string;
  },
  userId: string,
): boolean {
  return operation.attemptId === input.attemptId
    && operation.leaseGeneration === input.leaseGeneration
    && operation.userId === userId;
}

function createActiveRuntimeUserFence(
  operation: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  },
): WorkerActiveRuntimeUserFenceResult {
  return {
    active: true,
    attemptId: operation.attemptId,
    leaseGeneration: operation.leaseGeneration,
    userId: operation.userId,
  };
}

export interface RunnerRuntimeWakeInput {
  attemptId: string;
  leaseGeneration: string;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  processingMode?: RunnerRuntimeProcessingMode | null;
  userId: string;
}

export type RunnerRuntimeWakeResult =
  | { action: "already_running" | "woken"; kind: "accepted" }
  | {
      kind: "not-wakeable";
      reason: "no-active-child";
    }
  | {
      kind: "unknown";
      reason:
        | "active-child-rejected"
        | "container-rpc-error"
        | "container-rpc-timeout"
        | "missing-container-binding"
        | "missing-wake-method";
    };

export interface RunnerContainerEnsureProcessingInput {
  activeRuntime?: RunnerRuntimeWakeInput | null;
  invoke?: HostedExecutionContainerInvokeRequest | null;
  userId: string;
}

// Durable Object RPC does not preserve custom own properties on thrown Errors,
// so phase-bearing generic failures cross this seam as an explicitly bounded value.
export interface RunnerContainerProcessingFailure {
  errorCodeDetail: string | null;
  runtimeFailurePhaseCode: HostedRuntimeFailurePhaseCode;
  status: number | null;
}

export type RunnerContainerEnsureProcessingResult =
  | {
      action: "already_running" | "restarted" | "started" | "woken";
      kind: "accepted";
      result?: HostedExecutionRunnerJobResult;
    }
  | {
      failure: RunnerContainerProcessingFailure;
      kind: "failed";
    }
  | {
      kind: "start-required";
      reason: "no-active-child";
    }
  | {
      kind: "wake-unconfirmed";
      reason: Extract<RunnerRuntimeWakeResult, { kind: "unknown" }>["reason"];
    };

export class RunnerContainer extends Container {
  defaultPort = RUNNER_PORT;
  enableInternet = true;
  envVars: Record<string, string> = { ...BASE_RUNNER_CONTAINER_ENV_VARS };
  interceptHttps = true;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  sleepAfter = formatRunnerSleepAfter(readRunnerContainerIdleTtlMs({}));

  protected readonly environment: RunnerContainerEnvironmentSource;
  private lifecycleLock: Promise<void> = Promise.resolve();
  private lifecycleLockPendingCount = 0;
  private currentContainerStart: RunnerContainerCurrentStart | null = null;
  private currentLogContext: RunnerContainerLogContext | null = null;
  private lastActivityExpiryAtMs: number | null = null;
  private lastActivityObservedAtMs: number | null = null;
  private lastActivityObservedStage: string | null = null;
  private lastDestroyRequest: RunnerContainerDestroyRequestRecord | null = null;
  private recentReadinessProof: RunnerContainerReadinessProof | null = null;
  private shellPrewarmObservation: RunnerContainerShellPrewarmObservation | null = null;
  private shellPrewarmOperation: RunnerContainerShellPrewarmOperation | null = null;
  private stopGeneration = 0;
  private stopObservers = new Set<() => void>();
  private warmShellInvalidatedByUnsettledDestroy = false;
  private pointerlessWakeBlockingLifecycleCount = 0;
  private workspaceInvocationOperations: RunnerWorkspaceInvocationOperation[] = [];
  private workspaceInvocationNoPointerAbort:
    RunnerWorkspaceInvocationNoPointerAbort | null = null;
  private containerInteractionGeneration = 0;

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.environment = env;
    this.envVars = buildRunnerContainerEnvVars();
    this.sleepAfter = formatRunnerSleepAfter(
      readRunnerContainerLifecycleReevaluationMs(env),
    );
  }

  async invoke(
    payload: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedExecutionRunnerJobResult> {
    this.noteContainerInteraction();
    const input = parseHostedExecutionContainerInvokeInput(payload);
    const routeUserId = readHostedExecutionRunnerJobUserId(input.job);
    if (
      this.workspaceInvocationNoPointerAbort
      && runnerWorkspaceInvocationOperationMatches(
        this.workspaceInvocationNoPointerAbort,
        input.job.request,
        routeUserId,
      )
    ) {
      throw new Error(WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE);
    }
    const existingOperation = this.workspaceInvocationOperations.find((operation) =>
      runnerWorkspaceInvocationOperationMatches(
        operation,
        input.job.request,
        routeUserId,
      )
    );
    if (existingOperation) {
      if (!existingOperation.result) {
        throw new Error("Hosted runner invocation result was not registered.");
      }
      return await existingOperation.result;
    }
    const operation = createRunnerWorkspaceInvocationOperation(input);
    const currentOperation = this.readWorkspaceInvocationOperation();
    if (
      currentOperation?.abortResult
      || currentOperation?.abortController.signal.aborted
    ) {
      operation.abortController.abort(
        new Error(WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE),
      );
    }
    const result = this.withLifecycleLock(async () => {
      if (operation.abortController.signal.aborted) {
        this.removeWorkspaceInvocationOperation(operation);
        throwIfRunnerContainerOperationAborted(
          operation.abortController.signal,
        );
      }
      if (this.readWorkspaceInvocationOperation() !== operation) {
        this.removeWorkspaceInvocationOperation(operation);
        throw new Error(
          "Hosted runner container still has an active workspace invocation.",
        );
      }
      return await this.invokeHostedExecution(input, operation);
    }, {
      // The exact operation is registered synchronously before lifecycle
      // admission, so pointerless blocking is reserved for lifecycle work
      // that has no invocation owner.
      blockPointerlessWake: false,
    });
    operation.result = result;
    this.workspaceInvocationOperations.push(operation);
    const completedResult = await result;
    if (this.readWorkspaceInvocationOperation() !== operation) {
      await this.recordRuntimeCompletionBestEffort({
        attemptId: input.job.request.attemptId,
        generation: input.job.request.leaseGeneration,
        result: completedResult,
        userId: routeUserId,
      });
    }
    return completedResult;
  }

  private async recordRuntimeCompletionBestEffort(input: {
    attemptId: string;
    generation: string;
    result: HostedExecutionRunnerJobResult;
    userId: string;
  }): Promise<void> {
    try {
      const userRunner = this.environment.USER_RUNNER?.getByName(input.userId);
      if (!userRunner?.recordRuntimeCompletionFromContainer) {
        return;
      }
      const receipt = userRunner.recordRuntimeCompletionFromContainer(input).then(
        () => ({ kind: "completed" as const }),
        (error: unknown) => ({ error, kind: "failed" as const }),
      );
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        receipt,
        new Promise<{ kind: "timed_out" }>((resolve) => {
          timeoutId = setTimeout(
            () => resolve({ kind: "timed_out" }),
            RUNNER_RUNTIME_COMPLETION_RECEIPT_TIMEOUT_MS,
          );
        }),
      ]);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (outcome.kind === "completed") {
        return;
      }
      const error = outcome.kind === "failed"
        ? outcome.error
        : new Error("Hosted runner container completion receipt timed out.");
      throw error;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner.container",
        details: {
          ...buildHostedExecutionSafeErrorDiagnostics(error),
          workspaceAttemptId: input.attemptId,
        },
        level: "warn",
        message:
          "Hosted runner container completion receipt failed; preserving completed result.",
        phase: "checkpoint",
        userId: input.userId,
      });
    }
  }

  async destroyInstance(): Promise<void> {
    this.noteContainerInteraction();
    this.shellPrewarmObservation = null;
    this.supersedeShellPrewarm();
    const operationsAtDestroy = [...this.workspaceInvocationOperations];
    for (const operation of operationsAtDestroy) {
      if (!operation.abortController.signal.aborted) {
        operation.abortController.abort(
          new Error("workspace invocation container destroyed"),
        );
      }
    }
    try {
      await this.withLifecycleLock(async () =>
        this.stopWarmContainer({
          reason: "destroy-instance",
        })
      );
    } catch (error) {
      for (const operation of operationsAtDestroy) {
        if (this.workspaceInvocationOperations.includes(operation)) {
          operation.requiresFailClosedStopReason = "cleanup_failed";
        }
      }
      throw error;
    }
    for (const operation of operationsAtDestroy) {
      this.removeWorkspaceInvocationOperation(operation);
    }
  }

  async readActiveRuntimeUserFence(): Promise<WorkerActiveRuntimeUserFenceResult> {
    this.noteContainerInteraction();
    const abortInProgress = this.workspaceInvocationNoPointerAbort;
    if (abortInProgress) {
      return createActiveRuntimeUserFence(abortInProgress);
    }
    const active = this.readWorkspaceInvocationOperation();
    if (!active) {
      const status = await readRunnerContainerStatus(this);
      if (
        this.warmShellInvalidatedByUnsettledDestroy
        && !isRunnerContainerStopped(status)
      ) {
        throw new Error(
          "Hosted runner container has an unsettled fail-closed stop.",
        );
      }
      if (isRunnerContainerStopped(status)) {
        this.warmShellInvalidatedByUnsettledDestroy = false;
      }
      if (!isRunnerContainerStopped(status)) {
        const activeInContainer = await this.readWorkspaceInvocationActiveFromHealth();
        if (activeInContainer) {
          throw new Error("Hosted runner container health still reports active workspace work.");
        }
      }
      return this.finishInactiveRuntimeFenceRead();
    }

    if (active.abortResult) {
      return createActiveRuntimeUserFence(active);
    }
    if (active.requiresFailClosedStopReason === "cleanup_failed") {
      const status = await readRunnerContainerStatus(this);
      if (this.workspaceInvocationPriorityOwnerChanged(active)) {
        return this.finishInactiveRuntimeFenceRead();
      }
      if (isRunnerContainerStopped(status)) {
        this.warmShellInvalidatedByUnsettledDestroy = false;
        this.clearPreservedWorkspaceInvocationActiveOperation(active);
        return this.finishInactiveRuntimeFenceRead();
      }
      return createActiveRuntimeUserFence(active);
    }
    if (active.requiresFailClosedStopReason === "transport_uncertain") {
      const status = await readRunnerContainerStatus(this);
      if (this.workspaceInvocationPriorityOwnerChanged(active)) {
        return this.finishInactiveRuntimeFenceRead();
      }
      if (isRunnerContainerStopped(status)) {
        this.warmShellInvalidatedByUnsettledDestroy = false;
        this.clearPreservedWorkspaceInvocationActiveOperation(active);
        return this.finishInactiveRuntimeFenceRead();
      }
    }

    return createActiveRuntimeUserFence(active);
  }

  async ensureReadyForProcessing(
    payload: RunnerContainerEnsureReadyForProcessingInput,
  ): Promise<RunnerContainerEnsureReadyForProcessingResult> {
    this.noteContainerInteraction();
    const input = parseRunnerContainerEnsureReadyForProcessingInput(payload);
    const shellPrewarmObservation = this.shellPrewarmObservation;
    this.shellPrewarmObservation = null;
    const supersededShellPrewarm = this.supersedeShellPrewarm();
    // Start the wall-clock deadline before lifecycle-lock admission. A queued
    // readiness request must not receive a fresh timeout after its caller-side
    // guard has already elapsed.
    const readinessSignal = AbortSignal.timeout(input.timeoutMs);
    let lifecycleLockAcquired = false;
    let cleanupSettlementTimedOut = false;
    const readiness = this.withLifecycleLock(async () => {
      lifecycleLockAcquired = true;
      throwIfRunnerContainerOperationAborted(readinessSignal);
      const logContext: RunnerContainerLogContext = {
        userId: input.userId,
      };
      this.currentLogContext = logContext;
      try {
        let action: "already_warm" | "started";
        try {
          action = await this.ensureContainerReady(
            input,
            readinessSignal,
            {
              completeSupersededShellPrewarm: supersededShellPrewarm,
              surfaceCleanupUnsettled: true,
            },
          );
        } catch (error) {
          if (error instanceof RunnerContainerCleanupUnsettledError) {
            return { kind: "cleanup_unsettled" as const };
          }
          throw error;
        }
        return {
          action,
          kind: "ready" as const,
          ...(shellPrewarmObservation === null
            ? {}
            : { shellPrewarmObservation: { ...shellPrewarmObservation } }),
        };
      } finally {
        if (this.currentLogContext === logContext) {
          this.currentLogContext = null;
        }
      }
    });
    try {
      return await raceRunnerContainerOperationAbort(
        readiness,
        readinessSignal,
        async () => {
          if (!lifecycleLockAcquired) {
            return;
          }
          // Once lifecycle work starts, ensureContainerReady owns any
          // fail-closed stop it initiated. Give that bounded stop time to
          // settle before the caller decides whether the write fence can be
          // cleared or preserved.
          const settled = await waitForRunnerContainerOperationSettlement(
            readiness,
            RUNNER_READINESS_ABORT_SETTLEMENT_TIMEOUT_MS,
          );
          cleanupSettlementTimedOut = !settled;
          return settled ? "use_operation_outcome" : undefined;
        },
      );
    } catch (error) {
      if (cleanupSettlementTimedOut) {
        return { kind: "cleanup_unsettled" };
      }
      throw error;
    }
  }

  /**
   * Issues only the platform container start command. The ordinary processing
   * owner later performs port and health readiness before invoking workspace
   * work; this hint never reads a workspace or creates a runtime fence.
   */
  async beginShellPrewarm(
    payload: RunnerContainerBeginShellPrewarmInput,
  ): Promise<RunnerContainerBeginShellPrewarmResult> {
    this.noteContainerInteraction();
    const input = parseRunnerContainerBeginShellPrewarmInput(payload);
    const existingObservation = this.shellPrewarmObservation;
    if (existingObservation) {
      existingObservation.hintCount = Math.min(
        Number.MAX_SAFE_INTEGER,
        existingObservation.hintCount + 1,
      );
      return { accepted: true };
    }
    const observation = this.recordShellPrewarmHint(input.source);
    const operation = this.getOrBeginShellPrewarm(input);
    this.observeShellPrewarmOperation({
      observation,
      operation,
      userId: input.userId,
    });
    return { accepted: true };
  }

  async prewarmShell(
    payload: RunnerContainerEnsureReadyForProcessingInput,
  ): Promise<RunnerContainerPrewarmShellResult> {
    this.noteContainerInteraction();
    const input = parseRunnerContainerEnsureReadyForProcessingInput(payload);
    return await this.getOrBeginShellPrewarm(input).result;
  }

  private getOrBeginShellPrewarm(
    input: RunnerContainerEnsureReadyForProcessingInput,
  ): RunnerContainerShellPrewarmOperation {
    const existing = this.shellPrewarmOperation;
    if (existing) {
      return existing;
    }

    const abortController = new AbortController();
    const startedAtMs = Date.now();
    const coldStartAlreadyObserved = this.currentContainerStart !== null;
    let retainForAuthoritativeReadiness = false;
    const result = this.withLifecycleLock(
      async (): Promise<RunnerContainerPrewarmShellResult> => {
        const signal = combineRunnerContainerAbortSignals(
          abortController.signal,
          AbortSignal.timeout(input.timeoutMs),
        );
        try {
          throwIfRunnerContainerOperationAborted(signal);
          const logContext: RunnerContainerLogContext = {
            userId: input.userId,
          };
          this.currentLogContext = logContext;
          try {
            await this.start(undefined, {
              portToCheck: RUNNER_PORT,
              signal,
            });
            return { action: "start_issued", kind: "started" };
          } finally {
            if (this.currentLogContext === logContext) {
              this.currentLogContext = null;
            }
          }
        } catch (error) {
          if (
            abortController.signal.reason
              instanceof RunnerContainerShellPrewarmSupersededError
          ) {
            return { action: "superseded", kind: "superseded" };
          }
          // start() can issue the platform command before a later wait fails.
          // Preserve that uncertain attempt so authoritative readiness finishes
          // the canonical lifecycle path instead of trusting warm health alone.
          retainForAuthoritativeReadiness = true;
          throw error;
        }
      },
      {
        blockPointerlessWake: false,
      },
    );
    const operation: RunnerContainerShellPrewarmOperation = {
      abortController,
      coldStartAlreadyObserved,
      observed: false,
      result,
      startedAtMs,
    };
    this.shellPrewarmOperation = operation;
    void result.finally(() => {
      if (
        this.shellPrewarmOperation === operation
        && !retainForAuthoritativeReadiness
      ) {
        this.shellPrewarmOperation = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  async abortWorkspaceInvocation(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<RunnerWorkspaceInvocationAbortStatus> {
    this.noteContainerInteraction();
    const existingAbort = this.workspaceInvocationNoPointerAbort;
    if (existingAbort) {
      if (
        runnerWorkspaceInvocationOperationMatches(
          existingAbort,
          input,
          input.userId,
        )
      ) {
        return await existingAbort.result;
      }
      return "stale";
    }
    const active = this.readWorkspaceInvocationOperation();
    if (!active) {
      const result = this.abortWorkspaceInvocationWithoutLocalPointer(input);
      const abortOperation: RunnerWorkspaceInvocationNoPointerAbort = {
        ...input,
        result,
      };
      this.workspaceInvocationNoPointerAbort = abortOperation;
      try {
        return await result;
      } finally {
        if (this.workspaceInvocationNoPointerAbort === abortOperation) {
          this.workspaceInvocationNoPointerAbort = null;
        }
      }
    }
    if (
      !runnerWorkspaceInvocationOperationMatches(active, input, input.userId)
    ) {
      return "stale";
    }
    if (active.abortResult) {
      return await active.abortResult;
    }
    for (const queuedOperation of this.workspaceInvocationOperations.slice(1)) {
      if (!queuedOperation.abortController.signal.aborted) {
        queuedOperation.abortController.abort(
          new Error(WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE),
        );
      }
    }
    const abortResult = this.abortRegisteredWorkspaceInvocation(active, input);
    active.abortResult = abortResult;
    const result = await abortResult;
    if (
      result === "failed"
      && active.abortResult === abortResult
    ) {
      active.abortResult = null;
    }
    return result;
  }

  private async abortRegisteredWorkspaceInvocation(
    active: RunnerWorkspaceInvocationOperation,
    input: {
      attemptId: string;
      leaseGeneration: string;
      userId: string;
    },
  ): Promise<RunnerWorkspaceInvocationAbortStatus> {
    const retryingCleanupFailure =
      active.requiresFailClosedStopReason === "cleanup_failed";
    if (active.abortEndpointReady) {
      await this.postWorkspaceInvocationAbort(input);
    }
    if (!active.abortController.signal.aborted) {
      active.abortController.abort(
        new Error(WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE),
      );
    }
    if (!active.result) {
      return "failed";
    }
    await active.result.catch(() => undefined);
    if (this.readWorkspaceInvocationOperation() !== active) {
      return "accepted";
    }
    if (
      active.requiresFailClosedStopReason === "cleanup_failed"
      && !retryingCleanupFailure
    ) {
      return "failed";
    }
    if (active.requiresFailClosedStopReason) {
      try {
        await this.withLifecycleLock(async () =>
          await this.stopWarmContainer({
            failClosed: true,
            reason: "invoke-failure",
          })
        );
      } catch {
        active.requiresFailClosedStopReason = "cleanup_failed";
        return "failed";
      }
    }
    if (this.warmShellInvalidatedByUnsettledDestroy) {
      active.requiresFailClosedStopReason = "cleanup_failed";
      return "failed";
    }
    this.workspaceInvocationOperations =
      this.workspaceInvocationOperations.filter((operation) =>
        operation !== active
        && !operation.abortController.signal.aborted
      );
    return "accepted";
  }

  async ensureProcessing(input: RunnerContainerEnsureProcessingInput): Promise<RunnerContainerEnsureProcessingResult> {
    this.noteContainerInteraction();
    assertRunnerContainerEnsureProcessingUserIds(input);
    let startAction: Extract<RunnerContainerEnsureProcessingResult, { kind: "accepted" }>["action"] = "started";
    if (input.activeRuntime) {
      const wake = await this.wakeRuntime(input.activeRuntime);
      if (wake.kind === "accepted") {
        return {
          action: wake.action,
          kind: "accepted",
        };
      }

      if (wake.kind === "unknown") {
        return {
          kind: "wake-unconfirmed",
          reason: wake.reason,
        };
      }

      if (!input.invoke) {
        return {
          kind: "start-required",
          reason: "no-active-child",
        };
      }
      startAction = "restarted";
    }

    if (!input.invoke) {
      return {
        kind: "start-required",
        reason: "no-active-child",
      };
    }

    try {
      return {
        action: startAction,
        kind: "accepted",
        result: await this.invoke(input.invoke),
      };
    } catch (error) {
      if (error instanceof HostedRunnerContainerShuttingDownError) {
        return {
          kind: "start-required",
          reason: "no-active-child",
        };
      }
      const failure = buildRunnerContainerProcessingFailure(error);
      if (failure) {
        return {
          failure,
          kind: "failed",
        };
      }
      throw error;
    }
  }

  async wakeRuntime(input: RunnerRuntimeWakeInput): Promise<RunnerRuntimeWakeResult> {
    this.noteContainerInteraction();
    const interactionGeneration = this.containerInteractionGeneration;
    const destroyRequestAtWakeStart = this.lastDestroyRequest;
    const stopGenerationAtWakeStart = this.stopGeneration;
    if (this.workspaceInvocationNoPointerAbort) {
      return { kind: "unknown", reason: "active-child-rejected" };
    }
    const active = this.readWorkspaceInvocationOperation();
    if (
      active
      && (
        active.userId !== input.userId
        || active.attemptId !== input.attemptId
        || active.leaseGeneration !== input.leaseGeneration
        || (
          input.processingMode !== undefined
          && active.processingMode !== normalizeRunnerRuntimeProcessingMode(input.processingMode)
        )
      )
    ) {
      return { kind: "unknown", reason: "active-child-rejected" };
    }

    if (
      active
      && (
        active.abortResult
        || (
          active.abortController.signal.aborted
          && active.requiresFailClosedStopReason !== "cleanup_failed"
        )
      )
    ) {
      return { kind: "unknown", reason: "active-child-rejected" };
    }

    if (
      this.warmShellInvalidatedByUnsettledDestroy
      && active?.requiresFailClosedStopReason !== "cleanup_failed"
    ) {
      return { kind: "unknown", reason: "active-child-rejected" };
    }

    if (active?.requiresFailClosedStopReason === "cleanup_failed") {
      const status = await readRunnerContainerStatus(this);
      if (
        this.workspaceInvocationPriorityOwnerChanged(active)
      ) {
        return { kind: "unknown", reason: "active-child-rejected" };
      }
      if (isRunnerContainerStopped(status)) {
        this.warmShellInvalidatedByUnsettledDestroy = false;
        this.clearPreservedWorkspaceInvocationActiveOperation(active);
        if (this.workspaceInvocationCoordinationChanged(null)) {
          return { kind: "unknown", reason: "active-child-rejected" };
        }
        return { kind: "not-wakeable", reason: "no-active-child" };
      }
      if (await this.settleExactWorkspaceInvocationForWake(input)) {
        return { kind: "not-wakeable", reason: "no-active-child" };
      }
      return { kind: "unknown", reason: "active-child-rejected" };
    }

    if (active?.requiresFailClosedStopReason === "transport_uncertain") {
      const status = await readRunnerContainerStatus(this);
      if (
        this.workspaceInvocationCoordinationChanged(active)
      ) {
        return { kind: "unknown", reason: "active-child-rejected" };
      }
      if (isRunnerContainerStopped(status)) {
        this.warmShellInvalidatedByUnsettledDestroy = false;
        this.clearPreservedWorkspaceInvocationActiveOperation(active);
        if (this.workspaceInvocationCoordinationChanged(null)) {
          return { kind: "unknown", reason: "active-child-rejected" };
        }
        return { kind: "not-wakeable", reason: "no-active-child" };
      }
    }

    if (active && !active.abortEndpointReady) {
      return { kind: "unknown", reason: "active-child-rejected" };
    }

    if (!active && this.pointerlessWakeBlockingLifecycleCount > 0) {
      return { kind: "unknown", reason: "active-child-rejected" };
    }

    if (!active && this.isPlatformContainerDefinitelyStopped()) {
      return { kind: "not-wakeable", reason: "no-active-child" };
    }

    this.noteRunnerActivity("runtime-wake");
    try {
      const runtimeWakeSignal = AbortSignal.timeout(DEFAULT_RUNNER_RUNTIME_WAKE_TIMEOUT_MS);
      const response = await this.containerFetch(
        RUNNER_RUNTIME_WAKE_URL,
        {
          body: JSON.stringify(input),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
          signal: runtimeWakeSignal,
        },
      );
      const acceptedHeader = response.headers.get("x-runtime-wake-accepted");
      const accepted = acceptedHeader === "1";
      const explicitlyRejected = acceptedHeader === "0";
      const absent = response.headers.get("x-runtime-wake-absent") === "1";
      const identityChecked =
        response.headers.get("x-runtime-wake-identity-checked") === "1";
      const mismatch = response.headers.get("x-runtime-wake-mismatch") === "1";
      const pending = response.headers.get("x-runtime-wake-pending") === "1";
      await drainRunnerContainerMetadataResponseBody(response, {
        signal: runtimeWakeSignal,
      });
      const acceptedWithoutIdentityProof =
        response.ok && accepted && !active && !identityChecked;
      let legacyNoActiveChild = false;
      if (
        response.ok
        && !active
        && explicitlyRejected
        && !accepted
        && !absent
        && !identityChecked
        && !mismatch
      ) {
        try {
          legacyNoActiveChild = !(await this.readWorkspaceInvocationActiveFromHealth());
        } catch {
          legacyNoActiveChild = false;
        }
      }
      if (!response.ok || !accepted || acceptedWithoutIdentityProof) {
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            runtimeWakeAccepted: accepted,
            runtimeWakeAbsent: absent,
            runtimeWakeIdentityChecked: identityChecked,
            runtimeWakeLegacyNoActiveChild: legacyNoActiveChild,
            runtimeWakeMismatch: mismatch,
            runtimeWakeStatus: response.status,
            workspaceAttemptId: input.attemptId,
          },
          level: "warn",
          message: "Hosted execution container runtime wake was not accepted by a verified active child.",
          phase: "scheduled",
          userId: input.userId,
        });
      }
      if (acceptedWithoutIdentityProof) {
        return { kind: "unknown", reason: "container-rpc-error" };
      }
      if (
        (
          !active
          && (
            this.containerInteractionGeneration !== interactionGeneration
            || this.lastDestroyRequest !== destroyRequestAtWakeStart
            || this.stopGeneration !== stopGenerationAtWakeStart
          )
        )
        || this.workspaceInvocationCoordinationChanged(active)
      ) {
        return { kind: "unknown", reason: "active-child-rejected" };
      }
      if (response.ok && accepted) {
        if (!active) {
          this.noteContainerInteraction();
        }
        return { action: pending ? "already_running" : "woken", kind: "accepted" };
      }
      if (response.ok && (absent || legacyNoActiveChild)) {
        if (active) {
          if (
            absent
            && active.requiresFailClosedStopReason === "transport_uncertain"
          ) {
            if (await this.settleExactWorkspaceInvocationForWake(input)) {
              return { kind: "not-wakeable", reason: "no-active-child" };
            }
          }
          return { kind: "unknown", reason: "active-child-rejected" };
        }
        return { kind: "not-wakeable", reason: "no-active-child" };
      }
      return { kind: "unknown", reason: "active-child-rejected" };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          workspaceAttemptId: input.attemptId,
        },
        error,
        level: "warn",
        message: "Hosted execution container runtime wake failed best-effort.",
        phase: "scheduled",
        userId: input.userId,
      });
      if (
        error instanceof DOMException
        && error.name === "TimeoutError"
      ) {
        return { kind: "unknown", reason: "container-rpc-timeout" };
      }
      return { kind: "unknown", reason: "container-rpc-error" };
    }
  }

  private isPlatformContainerDefinitelyStopped(): boolean {
    return this.ctx.container?.running === false;
  }

  private isPlatformContainerDefinitelyRunning(): boolean {
    return this.ctx.container?.running === true;
  }

  async smokeHealth(input: HostedExecutionContainerSmokeHealthInput = {}): Promise<HostedExecutionContainerSmokeHealthResult> {
    this.noteContainerInteraction();
    return await this.withLifecycleLock(async () => {
      const readyTimeoutMs = readRunnerReadyTimeoutMs(this.environment);
      let smokeStartAttempted = false;
      let destroyAlreadyRequestedForRecycle = false;

      try {
        const destroyRequestBeforeRecycle = this.lastDestroyRequest;
        const containerSettledForSmoke = await this.stopWarmContainer({
          failClosed: false,
          reason: "deploy-smoke-recycle",
        });
        destroyAlreadyRequestedForRecycle = destroyRequestBeforeRecycle !== null
          || this.lastDestroyRequest !== destroyRequestBeforeRecycle;
        if (!containerSettledForSmoke) {
          // If recycle failed before it could request destroy, make one
          // cleanup attempt. If destroy was already requested, avoid issuing a
          // duplicate destroy while the platform may still be settling it.
          if (!destroyAlreadyRequestedForRecycle) {
            await this.stopWarmContainer({
              failClosed: false,
              reason: "deploy-smoke-cleanup",
            });
          }
          throw new Error("Hosted runner container smoke could not recycle the existing shell.");
        }
        smokeStartAttempted = true;
        await this.ensureSmokeContainerReady(readyTimeoutMs, {
          forceColdStart: true,
        });
        const smokeSignal = AbortSignal.timeout(readyTimeoutMs);
        const response = await this.containerFetch(
          RUNNER_HEALTH_URL,
          {
            signal: smokeSignal,
          },
        );
        const payload = await readRunnerContainerMetadataJsonObject(response, {
          signal: smokeSignal,
        });

        if (!response.ok || payload.ok !== true) {
          throw new Error(`Hosted runner container smoke health failed with HTTP ${response.status}.`);
        }
        const architectureVersion = typeof payload.hostedRuntimeArchitectureVersion === "string"
          ? payload.hostedRuntimeArchitectureVersion
          : null;
        if (architectureVersion !== HOSTED_RUNTIME_ARCHITECTURE_VERSION) {
          throw new HostedRunnerContainerArchitectureMismatchError({
            actualVersion: architectureVersion,
            expectedVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
          });
        }
        if (payload.poisoned === true) {
          throw new HostedRunnerContainerPoisonedError({
            lastCleanupStatus: typeof payload.lastCleanupStatus === "string"
              ? payload.lastCleanupStatus
              : null,
          });
        }
        const runnerBundle = parseRunnerContainerSmokeBundle(payload.runnerBundle);

        const codexShell = await this.smokeCodexShell(readyTimeoutMs);
        const directR2PresignedPut = input.directR2PresignedPut
          ? await this.smokeDirectR2PresignedPut(readyTimeoutMs, input.directR2PresignedPut)
          : undefined;
        let liveModelTurn: HostedExecutionContainerSmokeHealthResult["liveModelTurn"] | undefined;
        if (input.liveModelTurn) {
          liveModelTurn = await this.smokeLiveModelTurn(readyTimeoutMs, input.liveModelTurn);
        }

        return {
          codexShell,
          ...(directR2PresignedPut === undefined ? {} : { directR2PresignedPut }),
          ...(liveModelTurn === undefined ? {} : { liveModelTurn }),
          ok: true,
          runnerBundle,
          service: typeof payload.service === "string" ? payload.service : null,
          status: response.status,
        };
      } finally {
        if (smokeStartAttempted) {
          await this.stopWarmContainer({
            failClosed: false,
            reason: "deploy-smoke-cleanup",
          });
        }
      }
    });
  }

  private async smokeCodexShell(
    readyTimeoutMs: number,
  ): Promise<NonNullable<HostedExecutionContainerSmokeHealthResult["codexShell"]>> {
    const smokeSignal = AbortSignal.timeout(readyTimeoutMs);
    const response = await this.containerFetch(
      RUNNER_CODEX_SHELL_SMOKE_URL,
      {
        method: "POST",
        signal: smokeSignal,
      },
    );
    const payload = await readRunnerContainerMetadataJsonObject(response, {
      signal: smokeSignal,
    });
    if (!response.ok || payload.ok !== true) {
      // The container reports content-free smoke diagnostics; carry them so
      // deploy failures stay debuggable through the worker layer.
      const smokeErrorMessage = typeof payload.smokeErrorMessage === "string"
        ? ` ${payload.smokeErrorMessage.slice(0, 512)}`
        : "";
      throw new Error(
        `Hosted runner container Codex shell smoke failed with HTTP ${response.status}.${smokeErrorMessage}`,
      );
    }
    const result = readRunnerContainerMetadataRecordProperty(payload.codexShell);
    return {
      cliSurfaceContractBytes: typeof result.cliSurfaceContractBytes === "number"
        ? result.cliSurfaceContractBytes
        : null,
      cliSurfaceHotPathProofCount: typeof result.cliSurfaceHotPathProofCount === "number"
        ? result.cliSurfaceHotPathProofCount
        : null,
      client: typeof result.client === "string" ? result.client : null,
      murphPathBytes: typeof result.murphPathBytes === "number" ? result.murphPathBytes : null,
      noteAddBytes: typeof result.noteAddBytes === "number" ? result.noteAddBytes : null,
      stderrBytes: typeof result.stderrBytes === "number" ? result.stderrBytes : null,
      vaultCliLlmsBytes: typeof result.vaultCliLlmsBytes === "number" ? result.vaultCliLlmsBytes : null,
      vaultCliPathBytes: typeof result.vaultCliPathBytes === "number" ? result.vaultCliPathBytes : null,
      vaultShowBytes: typeof result.vaultShowBytes === "number" ? result.vaultShowBytes : null,
    };
  }

  protected async smokeLiveModelTurn(
    _readyTimeoutMs: number,
    _input: NonNullable<HostedExecutionContainerSmokeHealthInput["liveModelTurn"]>,
  ): Promise<NonNullable<HostedExecutionContainerSmokeHealthResult["liveModelTurn"]>> {
    throw new Error(
      "Hosted runner live model turn smoke is only supported by deploy smoke containers.",
    );
  }

  private async smokeDirectR2PresignedPut(
    readyTimeoutMs: number,
    input: NonNullable<HostedExecutionContainerSmokeHealthInput["directR2PresignedPut"]>,
  ): Promise<NonNullable<HostedExecutionContainerSmokeHealthResult["directR2PresignedPut"]>> {
    const smokeSignal = AbortSignal.timeout(Math.max(
      readyTimeoutMs,
      300_000,
    ));
    const response = await this.containerFetch(
      RUNNER_DIRECT_R2_PRESIGNED_PUT_SMOKE_URL,
      {
        body: JSON.stringify({
          ...(typeof input.byteLength === "number" ? { byteLength: input.byteLength } : {}),
          presignedPutUrl: input.presignedPutUrl,
          ...(typeof input.tlsCaCertificatePem === "string"
            ? { tlsCaCertificatePem: input.tlsCaCertificatePem }
            : {}),
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: smokeSignal,
      },
    );
    const payload = await readRunnerContainerMetadataJsonObject(response, {
      signal: smokeSignal,
    });

    if (!response.ok || payload.ok !== true) {
      throw new Error(`Hosted runner direct R2 presigned PUT smoke failed with HTTP ${response.status}.`);
    }

    const result = readRunnerContainerMetadataRecordProperty(payload.directR2PresignedPut);
    return {
      byteLength: typeof result.byteLength === "number" ? result.byteLength : null,
      durationMs: typeof result.durationMs === "number" ? result.durationMs : null,
      ok: result.ok === true,
      payloadSha256: typeof result.payloadSha256 === "string" ? result.payloadSha256 : null,
      responseBodyBytes: typeof result.responseBodyBytes === "number"
        ? result.responseBodyBytes
        : null,
      status: typeof result.status === "number" ? result.status : null,
    };
  }

  override async onActivityExpired(): Promise<void> {
    const interactionGenerationAtExpiry = this.containerInteractionGeneration;
    await this.withLifecycleLock(async () => {
      if (
        this.lifecycleLockPendingCount > 1
        || this.containerInteractionGeneration !== interactionGenerationAtExpiry
      ) {
        this.renewPlatformActivityTimeout("activity-expired-interaction-race");
        return;
      }
      const activeOperation = this.readWorkspaceInvocationOperation();
      if (activeOperation) {
        this.lastActivityExpiryAtMs = Date.now();
        this.renewPlatformActivityTimeout("activity-expired-active-operation");
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            activeOperationKind: "workspace-invocation",
            ...this.buildLifecycleDiagnosticDetails(),
            lifecycleStage: "activity-expired-active-operation",
            workspaceAttemptId: activeOperation.attemptId,
          },
          message: "Hosted execution container activity expiry yielded to active runner operation.",
          phase: "container.ready",
          userId: activeOperation.userId,
        });
        return;
      }

      const lastActivityObservedAtMs = this.lastActivityObservedAtMs;
      if (
        lastActivityObservedAtMs !== null
        && Date.now() - lastActivityObservedAtMs
          < readRunnerContainerLifecycleReevaluationMs(this.environment)
      ) {
        this.lastActivityExpiryAtMs = Date.now();
        if (this.renewPlatformActivityTimeout()) {
          emitHostedExecutionStructuredLog({
            component: "container",
            details: {
              ...this.buildLifecycleDiagnosticDetails(),
              lifecycleStage: "activity-expired-early-renew",
            },
            message:
              "Hosted execution container activity expiry arrived before the idle TTL elapsed; renewing.",
            phase: "container.ready",
            userId: this.currentLogContext?.userId,
          });
          return;
        }
      }

      const activityExpiryAtMs = Date.now();
      this.lastActivityExpiryAtMs = activityExpiryAtMs;
      let status: string | null;
      try {
        status = await readRunnerContainerStatusWithTimeout(
          this,
          RUNNER_DESTROY_SETTLE_TIMEOUT_MS,
        );
      } catch (error) {
        this.logLifecycleCleanupFailure(
          "Hosted execution container could not verify lifecycle state during activity expiry.",
          error,
        );
        this.renewPlatformActivityTimeout("activity-expired-status-unavailable");
        return;
      }
      if (isRunnerContainerStopped(status)) {
        return;
      }

      let health: RunnerContainerHealth;
      try {
        health = await this.readWorkspaceInvocationHealth();
      } catch (error) {
        this.logLifecycleCleanupFailure(
          "Hosted execution container could not verify runner health during activity expiry.",
          error,
        );
        this.renewPlatformActivityTimeout("activity-expired-health-unavailable");
        return;
      }
      if (health.activeJobCount > 0) {
        this.renewPlatformActivityTimeout("activity-expired-active-child");
        return;
      }
      if (
        this.lifecycleLockPendingCount > 1
        || this.containerInteractionGeneration !== interactionGenerationAtExpiry
      ) {
        this.renewPlatformActivityTimeout("activity-expired-interaction-race");
        return;
      }
      const conversationWarmActivityCompletedAtEpochMs =
        health.conversationWarmActivityCompletedAtEpochMs;
      if (
        conversationWarmActivityCompletedAtEpochMs !== null
        && conversationWarmActivityCompletedAtEpochMs !== undefined
        && conversationWarmActivityCompletedAtEpochMs
          > activityExpiryAtMs - readRunnerContainerIdleTtlMs(this.environment)
      ) {
        this.renewPlatformActivityTimeout("activity-expired-conversation-warm");
        return;
      }

      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          ...this.buildLifecycleDiagnosticDetails(),
          lifecycleStage: "activity-expired-cleanup",
        },
        message: "Hosted execution container activity expired; running cleanup.",
        phase: "container.ready",
        userId: this.currentLogContext?.userId,
      });
      const destroyed = await this.stopWarmContainer({
        expectedInteractionGeneration: interactionGenerationAtExpiry,
        failClosed: false,
        reason: "activity-expired",
      });
      if (
        !destroyed
        || this.containerInteractionGeneration !== interactionGenerationAtExpiry
      ) {
        this.renewPlatformActivityTimeout("activity-expired-cleanup-retained");
      }
    }, { blockPointerlessWake: false });
  }

  override onStart(): void {
    this.recordContainerStartIssued(
      Date.now(),
      readRunnerReadyTimeoutMs(this.environment),
      false,
    );
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
    const lifecycleDetails = this.buildLifecycleDiagnosticDetails();
    const stopClassification = classifyRunnerContainerStop({
      activeWorkspaceInvocationPresent: this.workspaceInvocationOperations.length > 0,
      cleanExit,
      destroyRequestPresent: this.lastDestroyRequest !== null,
      idleTtlDeltaMs: readNullableNumber(lifecycleDetails.idleTtlDeltaMs),
    });
    const stopAppliedToCurrentGeneration = !(
      this.isPlatformContainerDefinitelyRunning()
      && this.currentContainerStart !== null
    )
      && this.recordCurrentContainerStopped();
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        ...lifecycleDetails,
        exitCode: params.exitCode,
        lifecycleStage: "onStop",
        runnerPort: RUNNER_PORT,
        stopAppliedToCurrentGeneration,
        stopClassification,
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
    this.clearRecentReadinessProof();
    this.clearCurrentContainerPendingWindow();
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        activeWorkspaceInvocationPresent: this.workspaceInvocationOperations.length > 0,
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

  override async fetch(_request: Request): Promise<Response> {
    return methodNotAllowed();
  }

  private async invokeHostedExecution(
    input: HostedExecutionContainerInvokeInput,
    operation: RunnerWorkspaceInvocationOperation,
  ): Promise<HostedExecutionRunnerJobResult> {
    // Dispatch latency stamps (epoch ms, this DO's clock). Sent as headers on
    // the runner POST so the latency trace can split DO dispatch work from
    // Cloudflare container scheduling inside the temporal->runner-accept gap.
    const dispatchInvokeReceivedAtEpochMs = Date.now();
    const routeUserId = operation.userId;
    const logContext: RunnerContainerLogContext = {
      userId: routeUserId,
    };
    let completedSuccessfully = false;
    this.currentLogContext = logContext;
    let activeOperationAcquired = false;
    let cleanupWarmContainerOnFailure = false;
    let invokeFailure: unknown = null;
    let preserveActiveOperationAfterTransportFailure = false;
    let stopRunnerActivityRenewal: (() => void) | null = null;
    const operationAbortController = operation.abortController;
    operation.abortEndpointReady = false;
    operation.requiresFailClosedStopReason = null;

    try {
      throwIfRunnerContainerOperationAborted(operationAbortController.signal);
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          readyTimeoutMs: readRunnerReadyTimeoutMs(this.environment),
          workspaceAttemptId: input.job.request.attemptId,
          workspaceLeaseGeneration: input.job.request.leaseGeneration,
          workspaceVersion: input.job.request.workspaceVersion,
          runnerIdleTtlMs: readRunnerContainerIdleTtlMs(this.environment),
          runnerPort: RUNNER_PORT,
          readinessTimeoutMs: input.timeoutMs ?? null,
        },
        message: "Hosted execution container invocation received.",
        phase: "container.starting",
        userId: routeUserId,
      });
      const dispatchContainerEnsureReadyStartedAtEpochMs = Date.now();
      await this.ensureContainerReady(input, operationAbortController.signal);
      this.clearRecentReadinessProof();
      cleanupWarmContainerOnFailure = true;
      this.noteRunnerActivity("container-ready");
      throwIfRunnerContainerOperationAborted(operationAbortController.signal);

      activeOperationAcquired = true;
      operation.abortEndpointReady = true;
      stopRunnerActivityRenewal = this.startRunnerActivityRenewal();
      this.noteRunnerActivity("invoke-started");
      this.noteRunnerActivity("runner-request-starting");
      emitHostedExecutionStructuredLog({
        component: "container",
        message: "Hosted execution container sending runner request.",
        phase: "container.ready",
        userId: routeUserId,
      });
      const runnerRequest = this.containerFetch(
        RUNNER_EXECUTE_URL,
        {
          body: JSON.stringify({
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            job: input.job,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
            ...buildHostedRuntimeOrchestrationLatencyHeaders(input.orchestration),
            "x-dispatch-invoke-received-at-ms": String(dispatchInvokeReceivedAtEpochMs),
            "x-dispatch-container-ensure-ready-started-at-ms": String(
              dispatchContainerEnsureReadyStartedAtEpochMs,
            ),
          },
          method: "POST",
          signal: operationAbortController.signal,
        },
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
          operationAbortController.signal,
        );
      } catch (error) {
        if (!operationAbortController.signal.aborted) {
          preserveActiveOperationAfterTransportFailure = true;
        }
        throw error;
      } finally {
        stopWatcherAbortController.abort();
        void stoppedContainer.catch(() => undefined);
      }
      this.noteRunnerActivity("runner-response-received");

      if (!response.ok) {
        const runnerError = await classifyHostedRunnerContainerErrorResponse(response);
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            responseOk: false,
            responseStatus: response.status,
            ...buildRunnerContainerMetadataOnlyErrorDetails(runnerError),
          },
          message: "Hosted execution container received runner response.",
          phase: "container.ready",
          userId: routeUserId,
        });
        throw runnerError;
      }

      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          responseOk: true,
          responseStatus: response.status,
        },
        message: "Hosted execution container received runner response.",
        phase: "container.ready",
        userId: routeUserId,
      });

      let responsePayload: unknown;
      try {
        responsePayload = await response.json();
      } catch (error) {
        if (!operationAbortController.signal.aborted) {
          preserveActiveOperationAfterTransportFailure = true;
        }
        throw error;
      }
      const result = assertHostedExecutionRunnerJobResult(responsePayload, input.job);
      completedSuccessfully = true;
      return result;
    } catch (error) {
      invokeFailure = error;
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          activeOperationAcquired,
          runnerFailureKind: preserveActiveOperationAfterTransportFailure
            ? "runner_transport_failure"
            : operationAbortController.signal.aborted
              ? "operation_abort"
              : "runner_error",
          runnerOperationAbortSignalAborted: operationAbortController.signal.aborted,
          runnerTransportFailurePreservedActiveOperation:
            preserveActiveOperationAfterTransportFailure,
          workspaceAttemptId: input.job.request.attemptId,
          workspaceLeaseGeneration: input.job.request.leaseGeneration,
          ...this.buildLifecycleDiagnosticDetails(),
          ...buildRunnerContainerTransportFailureDetails(
            error,
            preserveActiveOperationAfterTransportFailure,
          ),
          ...buildRunnerContainerMetadataOnlyErrorDetails(error),
        },
        level: "warn",
        message: "Hosted execution container failed.",
        phase: "failed",
        userId: routeUserId,
      });
      throw error;
    } finally {
      let cleanupSettled = false;
      try {
        if (activeOperationAcquired) {
          if (!completedSuccessfully) {
            if (!preserveActiveOperationAfterTransportFailure) {
              await this.stopWarmContainer({
                failClosed: !(invokeFailure instanceof HostedRunnerContainerShuttingDownError),
                reason: "invoke-failure",
              });
            }
          }
        } else if (cleanupWarmContainerOnFailure) {
          await this.stopWarmContainer({
            failClosed: true,
            reason: "readiness-failure",
          });
        }
        cleanupSettled = true;
      } finally {
        stopRunnerActivityRenewal?.();
        this.noteRunnerActivity("invoke-finished");
        if (this.currentLogContext === logContext) {
          this.currentLogContext = null;
        }
        if (preserveActiveOperationAfterTransportFailure) {
          operation.requiresFailClosedStopReason = "transport_uncertain";
        } else if (!cleanupSettled) {
          operation.requiresFailClosedStopReason = "cleanup_failed";
        } else {
          operation.abortEndpointReady = false;
          operation.requiresFailClosedStopReason = null;
          if (!operation.abortResult) {
            this.removeWorkspaceInvocationOperation(operation);
          }
        }
      }
    }
  }

  private async readWorkspaceInvocationActiveFromHealth(): Promise<boolean> {
    return (await this.readWorkspaceInvocationHealth()).activeJobCount > 0;
  }

  private async readWorkspaceInvocationHealth(): Promise<RunnerContainerHealth> {
    const signal = AbortSignal.timeout(DEFAULT_RUNNER_ACTIVE_LIVENESS_TIMEOUT_MS);
    const response = await this.containerFetch(RUNNER_HEALTH_URL, {
      method: "GET",
      signal,
    });
    const payload = await readRunnerContainerMetadataJsonObject(response, { signal });
    if (!response.ok) {
      throw new Error(`Hosted runner container health returned HTTP ${response.status}.`);
    }
    if (
      typeof payload.activeJobCount !== "number"
      || !Number.isFinite(payload.activeJobCount)
      || payload.activeJobCount < 0
    ) {
      throw new Error("Hosted runner container health did not include a valid active job count.");
    }
    const conversationWarmActivityCompletedAtEpochMs =
      payload.conversationWarmActivityCompletedAtEpochMs;
    if (
      conversationWarmActivityCompletedAtEpochMs !== undefined
      && conversationWarmActivityCompletedAtEpochMs !== null
      && (
        typeof conversationWarmActivityCompletedAtEpochMs !== "number"
        || !Number.isSafeInteger(conversationWarmActivityCompletedAtEpochMs)
        || conversationWarmActivityCompletedAtEpochMs < 0
      )
    ) {
      throw new Error(
        "Hosted runner container health did not include a valid conversation warm activity watermark.",
      );
    }
    return {
      activeJobCount: payload.activeJobCount,
      conversationWarmActivityCompletedAtEpochMs,
    };
  }

  private readWorkspaceInvocationOperation():
    RunnerWorkspaceInvocationOperation | null {
    return this.workspaceInvocationOperations[0] ?? null;
  }

  private readWorkspaceInvocationCoordination(): {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  } | null {
    return this.workspaceInvocationNoPointerAbort
      ?? this.readWorkspaceInvocationOperation();
  }

  private finishInactiveRuntimeFenceRead():
    WorkerActiveRuntimeUserFenceResult {
    const coordination = this.readWorkspaceInvocationCoordination();
    if (coordination) {
      return createActiveRuntimeUserFence(coordination);
    }
    if (this.warmShellInvalidatedByUnsettledDestroy) {
      throw new Error(
        "Hosted runner container has an unsettled fail-closed stop.",
      );
    }
    return { active: false, reason: "no_active_runtime" };
  }

  private workspaceInvocationCoordinationChanged(
    observedOperation: RunnerWorkspaceInvocationOperation | null,
  ): boolean {
    return this.workspaceInvocationNoPointerAbort !== null
      || this.warmShellInvalidatedByUnsettledDestroy
      || this.readWorkspaceInvocationOperation() !== observedOperation
      || (
        observedOperation !== null
        && (
          observedOperation.abortResult !== null
          || observedOperation.abortController.signal.aborted
        )
      );
  }

  private workspaceInvocationPriorityOwnerChanged(
    observedOperation: RunnerWorkspaceInvocationOperation,
  ): boolean {
    return this.workspaceInvocationNoPointerAbort !== null
      || this.readWorkspaceInvocationOperation() !== observedOperation;
  }

  private removeWorkspaceInvocationOperation(
    operation: RunnerWorkspaceInvocationOperation,
  ): void {
    const operationIndex = this.workspaceInvocationOperations.indexOf(operation);
    if (operationIndex >= 0) {
      this.workspaceInvocationOperations.splice(operationIndex, 1);
    }
  }

  private clearPreservedWorkspaceInvocationActiveOperation(
    active: RunnerWorkspaceInvocationOperation,
  ): void {
    if (
      this.readWorkspaceInvocationOperation() !== active
      || active.abortResult
    ) {
      return;
    }
    active.abortEndpointReady = false;
    active.requiresFailClosedStopReason = null;
    this.removeWorkspaceInvocationOperation(active);
  }

  private async abortWorkspaceInvocationWithoutLocalPointer(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<RunnerWorkspaceInvocationAbortStatus> {
    return await this.withLifecycleLock(async () => {
      const abortStatus = await this.postWorkspaceInvocationAbort(input);
      if (abortStatus === "stale") {
        return "stale";
      }
      await this.stopWarmContainer({
        failClosed: true,
        reason: "invoke-failure",
      });
      return "accepted";
    });
  }

  private async settleExactWorkspaceInvocationForWake(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<boolean> {
    const abortStatus = await this.abortWorkspaceInvocation(input);
    return (
      abortStatus === "accepted"
      || abortStatus === "inactive"
    ) && !this.workspaceInvocationCoordinationChanged(null);
  }

  private async postWorkspaceInvocationAbort(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<RunnerWorkspaceInvocationAbortPostStatus> {
    try {
      const response = await this.containerFetch(
        RUNNER_ABORT_WORKSPACE_INVOCATION_URL,
        {
          body: JSON.stringify(input),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
          signal: AbortSignal.timeout(DEFAULT_RUNNER_ABORT_WORKSPACE_INVOCATION_TIMEOUT_MS),
        },
      );
      await drainRunnerContainerMetadataResponseBody(response).catch(() => undefined);
      if (!response.ok) {
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            abortStatus: response.status,
            workspaceAttemptId: input.attemptId,
            workspaceLeaseGeneration: input.leaseGeneration,
          },
          level: "warn",
          message: "Hosted execution container rejected the workspace invocation abort request.",
          phase: "failed",
          userId: input.userId,
        });
        return "failed";
      }
      const abortStatus = response.headers.get("x-workspace-invocation-abort-status");
      if (
        abortStatus === "accepted"
        || abortStatus === "queued"
        || abortStatus === "stale"
      ) {
        return abortStatus;
      }
      return "accepted";
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          workspaceAttemptId: input.attemptId,
          workspaceLeaseGeneration: input.leaseGeneration,
        },
        error,
        level: "warn",
        message: "Hosted execution container failed to post workspace invocation abort request.",
        phase: "failed",
        userId: input.userId,
      });
      return "failed";
    }
  }

  private async ensureContainerReady(
    input: Pick<HostedExecutionContainerInvokeInput, "timeoutMs" | "userId">,
    operationAbortSignal: AbortSignal,
    options: {
      completeSupersededShellPrewarm?: boolean;
      surfaceCleanupUnsettled?: boolean;
    } = {},
  ): Promise<"already_warm" | "started"> {
    const readinessStartedAt = Date.now();
    const initialState = await this.getState();
    const status = readContainerStatus(initialState);
    const readyTimeoutMs = readRunnerReadyTimeoutMs(this.environment);
    const readinessBudgetMs = input.timeoutMs ?? readyTimeoutMs;
    throwIfRunnerContainerOperationAborted(operationAbortSignal);

    if (isRunnerContainerStopped(status)) {
      this.recordCurrentContainerStopped();
      this.warmShellInvalidatedByUnsettledDestroy = false;
    } else if (this.warmShellInvalidatedByUnsettledDestroy) {
      this.clearRecentReadinessProof();
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          readinessLatencyMs: Date.now() - readinessStartedAt,
          startMode: "warm",
          statusBeforeStart: status,
        },
        level: "warn",
        message: "Hosted execution container warm shell was invalidated; destroying before reuse.",
        phase: "container.starting",
        userId: input.userId,
      });
      if (options.surfaceCleanupUnsettled) {
        await this.stopWarmContainerForReadiness({
          cause: new Error("Hosted runner warm shell was invalidated by unsettled cleanup."),
          failClosed: true,
          reason: "warm-invalidated",
        });
      } else {
        await this.stopWarmContainer({
          failClosed: true,
          reason: "warm-invalidated",
        });
      }
    } else if (
      !isRunnerContainerStopped(status)
      && !options.completeSupersededShellPrewarm
    ) {
      this.observeRecentPlatformStart(initialState, readyTimeoutMs);
      if (isRunnerContainerRunning(status)) {
        const recentReadinessProof = this.readRecentReadinessProof(
          Date.now(),
          input.userId,
        );
        if (recentReadinessProof) {
          emitHostedExecutionStructuredLog({
            component: "container",
            details: {
              readinessLatencyMs: Date.now() - readinessStartedAt,
              readinessProofAgeMs: recentReadinessProof.ageMs,
              readinessProofMaxAgeMs: RUNNER_RECENT_READINESS_PROOF_MAX_AGE_MS,
              readinessProofReused: true,
              startMode: "warm",
              statusBeforeStart: status,
            },
            message: "Hosted execution container is ready.",
            phase: "container.ready",
            userId: input.userId,
          });
          return "already_warm";
        }
      } else {
        this.clearRecentReadinessProof();
      }
      const readinessTimeoutMs = Math.min(readinessBudgetMs, readyTimeoutMs);
      try {
        await assertRunnerHealthy(
          this,
          readinessTimeoutMs,
          this.environment,
          operationAbortSignal,
        );
        this.recordRecentReadinessProof(input.userId);
        this.recordContainerReady("cold-start-ready", initialState);
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            readinessLatencyMs: Date.now() - readinessStartedAt,
            readinessTimeoutMs,
            startMode: "warm",
            statusBeforeStart: status,
          },
          message: "Hosted execution container is ready.",
          phase: "container.ready",
          userId: input.userId,
        });
        return "already_warm";
      } catch (error) {
        const pendingColdStart = this.readPendingColdStart({
          error,
          maxAgeMs: readyTimeoutMs,
          operationAbortSignal,
          state: initialState,
        });
        if (pendingColdStart) {
          this.logPendingColdStart({
            ageMs: pendingColdStart.ageMs,
            maxAgeMs: readyTimeoutMs,
            readinessStartedAtMs: readinessStartedAt,
            readinessTimeoutMs,
            statusBeforeStart: status,
            userId: input.userId,
          });
          throw error;
        }
        this.clearCurrentContainerPendingWindow();
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            readinessLatencyMs: Date.now() - readinessStartedAt,
            readinessTimeoutMs,
            startMode: "warm",
            statusBeforeStart: status,
          },
          error,
          level: "warn",
          message: "Hosted execution container warm health check failed; restarting shell.",
          phase: "container.starting",
          userId: input.userId,
        });
        if (options.surfaceCleanupUnsettled) {
          await this.stopWarmContainerForReadiness({
            cause: error,
            failClosed: true,
            reason: "warm-health-failed",
          });
        } else {
          await this.stopWarmContainer({
            reason: "warm-health-failed",
          });
        }
      }
    }
    throwIfRunnerContainerOperationAborted(operationAbortSignal);

    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        readinessPollIntervalMs: RUNNER_WAIT_INTERVAL_MS,
        readinessTimeoutMs: Math.min(
          Math.max(1, readinessBudgetMs - (Date.now() - readinessStartedAt)),
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

    const remainingTimeoutMs = Math.max(1, readinessBudgetMs - (Date.now() - readinessStartedAt));
    const readinessTimeoutMs = Math.min(remainingTimeoutMs, readyTimeoutMs);

    const coldStartWaitStartedAtMs = Date.now();
    const currentStart = this.recordContainerStartIssued(
      coldStartWaitStartedAtMs,
      readyTimeoutMs,
      true,
    );
    try {
      await this.startAndWaitForPorts({
        cancellationOptions: {
          abort: combineRunnerContainerAbortSignals(
            operationAbortSignal,
            AbortSignal.timeout(readinessTimeoutMs),
          ),
          instanceGetTimeoutMS: readinessTimeoutMs,
          portReadyTimeoutMS: readinessTimeoutMs,
          waitInterval: RUNNER_WAIT_INTERVAL_MS,
        },
      });
      this.clearCurrentContainerPendingWindow();
      await assertRunnerHealthy(
        this,
        readinessTimeoutMs,
        this.environment,
        operationAbortSignal,
      );
      this.recordRecentReadinessProof(input.userId);
      this.recordContainerReady("cold-start-ready", undefined, currentStart);
    } catch (error) {
      const pendingColdStart = this.readPendingColdStart({
        error,
        maxAgeMs: readyTimeoutMs,
        operationAbortSignal,
        state: {
          lastChange: currentStart.startedAtMs,
          status: "running",
        },
      });
      if (pendingColdStart) {
        this.logPendingColdStart({
          ageMs: pendingColdStart.ageMs,
          maxAgeMs: readyTimeoutMs,
          readinessStartedAtMs: readinessStartedAt,
          readinessTimeoutMs,
          statusBeforeStart: status,
          userId: input.userId,
        });
        throw error;
      }
      this.clearCurrentContainerPendingWindow();
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
      if (options.surfaceCleanupUnsettled) {
        await this.stopWarmContainerForReadiness({
          cause: error,
          failClosed: false,
          reason: "cold-start-failure",
        });
      } else {
        await this.stopWarmContainer({
          failClosed: false,
          reason: "cold-start-failure",
        }).catch(() => undefined);
      }
      throw error;
    }

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

    return "started";
  }

  private readPendingColdStart(input: {
    error: unknown;
    maxAgeMs: number;
    operationAbortSignal: AbortSignal;
    state: unknown;
  }): { ageMs: number } | null {
    const currentStart = this.currentContainerStart;
    if (
      isRunnerContainerFatalReadinessError(input.error)
      || currentStart === null
      || currentStart.readyObservedBy !== null
      || currentStart.pendingUntilMs === null
      || (
        input.operationAbortSignal.aborted
        && !isRunnerContainerAbortHardTimeout(input.operationAbortSignal.reason)
      )
    ) {
      return null;
    }
    const nowMs = Date.now();
    const recentStart = readRecentContainerStart(
      input.state,
      nowMs,
      input.maxAgeMs,
    );
    if (!recentStart) {
      return null;
    }
    if (nowMs > currentStart.pendingUntilMs) {
      return null;
    }
    return {
      ageMs: Math.max(0, nowMs - currentStart.startedAtMs),
    };
  }

  private logPendingColdStart(input: {
    ageMs: number;
    maxAgeMs: number;
    readinessStartedAtMs: number;
    readinessTimeoutMs: number;
    statusBeforeStart: string | null;
    userId: string;
  }): void {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        pendingColdStartAgeMs: input.ageMs,
        pendingColdStartMaxAgeMs: input.maxAgeMs,
        readinessLatencyMs: Date.now() - input.readinessStartedAtMs,
        readinessPollIntervalMs: RUNNER_WAIT_INTERVAL_MS,
        readinessTimeoutMs: input.readinessTimeoutMs,
        runnerPort: RUNNER_PORT,
        startMode: "cold-pending",
        statusBeforeStart: input.statusBeforeStart,
      },
      level: "warn",
      message: "Hosted execution container cold start is still pending after the caller readiness budget.",
      phase: "container.starting",
      userId: input.userId,
    });
  }

  private async ensureSmokeContainerReady(
    timeoutMs: number,
    options: {
      forceColdStart?: boolean;
    } = {},
  ): Promise<void> {
    if (!options.forceColdStart) {
      const state = await this.getState();
      const status = readContainerStatus(state);
      if (!isRunnerContainerStopped(status)) {
        await assertRunnerHealthy(this, timeoutMs, this.environment);
        this.recordContainerReady("deploy-smoke-ready", state);
        return;
      }
      this.recordCurrentContainerStopped();
    }

    const currentStart = this.recordContainerStartIssued(
      Date.now(),
      timeoutMs,
      true,
    );
    await this.startAndWaitForPorts({
      cancellationOptions: {
        abort: AbortSignal.timeout(timeoutMs),
        instanceGetTimeoutMS: timeoutMs,
        portReadyTimeoutMS: timeoutMs,
        waitInterval: RUNNER_WAIT_INTERVAL_MS,
      },
    });
    this.recordContainerReady("deploy-smoke-ready", undefined, currentStart);
  }

  private async destroyIfRunning(input: {
    cleanupDeadlineAtMs?: number;
    expectedInteractionGeneration?: number;
    failClosed?: boolean;
    reason: RunnerContainerDestroyReason;
  }): Promise<boolean> {
    const failClosed = Boolean(input.failClosed);
    const context = this.currentLogContext;
    const statusDeadlineAtMs = input.cleanupDeadlineAtMs
      ?? Date.now() + RUNNER_DESTROY_SETTLE_TIMEOUT_MS;
    let statusBeforeDestroy: string | null = null;

    try {
      statusBeforeDestroy = await readRunnerContainerStatusWithTimeout(
        this,
        Math.max(1, statusDeadlineAtMs - Date.now()),
      );
      if (
        isRunnerContainerStopped(statusBeforeDestroy)
        && !this.isPlatformContainerDefinitelyRunning()
      ) {
        this.recordCurrentContainerStopped();
        return true;
      }
    } catch (error) {
      emitRunnerContainerLifecycleFailure({
        destroyLatencyMs: null,
        error,
        failClosed,
        context,
        message: "Hosted execution container failed while checking its lifecycle state.",
        statusBeforeDestroy,
        stage: "status",
      });
      if (failClosed) {
        throw new Error("Hosted runner container failed to destroy cleanly.", { cause: error });
      }
      return false;
    }

    if (
      input.expectedInteractionGeneration !== undefined
      && this.containerInteractionGeneration !== input.expectedInteractionGeneration
    ) {
      return true;
    }

    const destroyStartedAt = Date.now();
    const stopGenerationBeforeDestroy = this.stopGeneration;
    this.lastDestroyRequest = {
      failClosed,
      reason: input.reason,
      requestedAtMs: destroyStartedAt,
      statusBeforeDestroy,
    };
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        failClosed,
        ...this.buildLifecycleDiagnosticDetails(),
        lifecycleStage: "destroy-requested",
        statusBeforeDestroy,
      },
      message: "Hosted execution container destroy requested.",
      phase: "container.ready",
      userId: context?.userId,
    });

    if (
      input.expectedInteractionGeneration !== undefined
      && this.containerInteractionGeneration !== input.expectedInteractionGeneration
    ) {
      return true;
    }
    this.pointerlessWakeBlockingLifecycleCount += 1;
    try {
      const destroyRequest = this.destroy().then(
        () => ({ kind: "destroy-resolved" as const }),
        (error: unknown) => ({ error, kind: "destroy-rejected" as const }),
      );
      const destroySettle = this.waitForDestroyedContainerStopped({
        ...(input.cleanupDeadlineAtMs === undefined
          ? {}
          : { cleanupDeadlineAtMs: input.cleanupDeadlineAtMs }),
        destroyStartedAt,
        failClosed,
        statusBeforeDestroy,
        stopGenerationBeforeDestroy,
      }).then(
        (settled) => ({ kind: "settle-finished" as const, settled }),
        (error: unknown) => ({ error, kind: "settle-rejected" as const }),
      );
      const firstDestroyOutcome = await Promise.race([
        destroyRequest,
        destroySettle,
      ]);

      if (firstDestroyOutcome.kind === "destroy-rejected") {
        const error = firstDestroyOutcome.error;
        if (isSettledRunnerContainerDestroyRaceError(error)) {
          return true;
        }
        emitRunnerContainerLifecycleFailure({
          destroyLatencyMs: Date.now() - destroyStartedAt,
          error,
          failClosed,
          context,
          message: "Hosted execution container destroy request failed.",
          statusBeforeDestroy,
          stage: "destroy",
        });
        if (failClosed) {
          throw new Error("Hosted runner container failed to destroy cleanly.", { cause: error });
        }
        return false;
      }

      const settledOutcome = firstDestroyOutcome.kind === "destroy-resolved"
        ? await destroySettle
        : firstDestroyOutcome;
      if (settledOutcome.kind === "settle-rejected") {
        if (failClosed) {
          throw settledOutcome.error;
        }
        return false;
      }

      const settled = settledOutcome.settled;
      if (!settled.ok) {
        return false;
      }
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          destroyLatencyMs: Date.now() - destroyStartedAt,
          destroySettleLatencyMs: settled.settleLatencyMs,
          destroySettleTimeoutMs: RUNNER_DESTROY_SETTLE_TIMEOUT_MS,
          failClosed,
          lifecycleStage: "destroyed",
          observedStatusesAfterDestroy: settled.observedStatuses,
          settleReason: settled.settleReason,
          statusAfterDestroy: settled.statusAfterDestroy,
          stopObservedAfterDestroy: settled.stopObservedAfterDestroy,
          statusBeforeDestroy,
        },
        message: "Hosted execution container destroy completed.",
        phase: "container.ready",
        userId: context?.userId,
      });
      return true;
    } finally {
      this.pointerlessWakeBlockingLifecycleCount -= 1;
    }
  }

  private async waitForDestroyedContainerStopped(input: {
    cleanupDeadlineAtMs?: number;
    destroyStartedAt: number;
    failClosed: boolean;
    statusBeforeDestroy: string | null;
    stopGenerationBeforeDestroy: number;
  }): Promise<
    | {
        ok: true;
        observedStatuses: string[];
        settleReason: "onStop" | "status";
        settleLatencyMs: number;
        statusAfterDestroy: string | null;
        stopObservedAfterDestroy: boolean;
      }
    | {
        ok: false;
      }
  > {
    const context = this.currentLogContext;
    const cleanupDeadlineAtMs = input.cleanupDeadlineAtMs
      ?? Date.now() + RUNNER_DESTROY_SETTLE_TIMEOUT_MS;
    const observedStatuses: string[] = [];
    let lastError: unknown = null;
    let statusAfterDestroy: string | null = null;

    while (true) {
      if (this.stopGeneration > input.stopGenerationBeforeDestroy) {
        return {
          ok: true,
          observedStatuses,
          settleLatencyMs: Date.now() - input.destroyStartedAt,
          settleReason: "onStop",
          statusAfterDestroy,
          stopObservedAfterDestroy: true,
        };
      }

      let remainingMs = cleanupDeadlineAtMs - Date.now();
      if (remainingMs <= 0) {
        const error = lastError
          ? new Error("Hosted runner container did not report stopped after destroy.", {
              cause: lastError,
            })
          : new Error("Hosted runner container did not report stopped after destroy.");
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            destroyLatencyMs: Date.now() - input.destroyStartedAt,
            destroySettleTimeoutMs: RUNNER_DESTROY_SETTLE_TIMEOUT_MS,
            failClosed: input.failClosed,
            lifecycleStage: "destroy-settle",
            observedStatusesAfterDestroy: observedStatuses,
            statusAfterDestroy,
            statusBeforeDestroy: input.statusBeforeDestroy,
          },
          error,
          level: input.failClosed ? "error" : "warn",
          message: "Hosted execution container destroy did not settle to stopped.",
          phase: "failed",
          userId: context?.userId,
        });
        if (input.failClosed) {
          throw error;
        }
        return { ok: false };
      }

      try {
        statusAfterDestroy = await readRunnerContainerStatusWithTimeout(
          this,
          Math.min(RUNNER_WAIT_INTERVAL_MS, remainingMs),
        );
        appendObservedRunnerContainerStatus(observedStatuses, statusAfterDestroy);
        if (
          isRunnerContainerStopped(statusAfterDestroy)
          && !this.isPlatformContainerDefinitelyRunning()
        ) {
          this.recordCurrentContainerStopped();
          return {
            ok: true,
            observedStatuses,
            settleReason: "status",
            settleLatencyMs: Date.now() - input.destroyStartedAt,
            statusAfterDestroy,
            stopObservedAfterDestroy: this.stopGeneration > input.stopGenerationBeforeDestroy,
          };
        }
      } catch (error) {
        lastError = error;
        appendObservedRunnerContainerStatus(observedStatuses, "status_error");
      }

      remainingMs = cleanupDeadlineAtMs - Date.now();
      if (remainingMs <= 0) {
        continue;
      }
      await this.waitForStopOrDelay(
        input.stopGenerationBeforeDestroy,
        Math.min(RUNNER_WAIT_INTERVAL_MS, remainingMs),
      );
    }
  }

  private async stopWarmContainer(input?: {
    cleanupDeadlineAtMs?: number;
    expectedInteractionGeneration?: number;
    failClosed?: boolean;
    reason?: RunnerContainerDestroyReason;
  }): Promise<boolean> {
    this.clearRecentReadinessProof();
    const failClosed = input?.failClosed ?? true;
    const reason = input?.reason ?? "destroy-instance";
    let destroyed: boolean;
    try {
      destroyed = await this.destroyIfRunning({
        ...(input?.cleanupDeadlineAtMs === undefined
          ? {}
          : { cleanupDeadlineAtMs: input.cleanupDeadlineAtMs }),
        ...(input?.expectedInteractionGeneration === undefined
          ? {}
          : { expectedInteractionGeneration: input.expectedInteractionGeneration }),
        failClosed,
        reason,
      });
    } catch (error) {
      this.warmShellInvalidatedByUnsettledDestroy = true;
      throw error;
    }
    if (destroyed) {
      this.warmShellInvalidatedByUnsettledDestroy = false;
    } else {
      this.warmShellInvalidatedByUnsettledDestroy = true;
    }
    return destroyed;
  }

  private async stopWarmContainerForReadiness(input: {
    cause: unknown;
    failClosed: boolean;
    reason: RunnerContainerDestroyReason;
  }): Promise<void> {
    const cleanupDeadlineAtMs = Date.now() + RUNNER_DESTROY_SETTLE_TIMEOUT_MS;
    try {
      const settled = await this.stopWarmContainer({
        cleanupDeadlineAtMs,
        failClosed: input.failClosed,
        reason: input.reason,
      });
      if (settled) {
        return;
      }
    } catch (error) {
      if (error instanceof RunnerContainerCleanupUnsettledError) {
        throw error;
      }
      throw new RunnerContainerCleanupUnsettledError(error);
    }
    throw new RunnerContainerCleanupUnsettledError(input.cause);
  }

  private async waitForStopOrDelay(
    observedStopGeneration: number,
    delayMs: number,
  ): Promise<void> {
    if (this.stopGeneration > observedStopGeneration) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        this.stopObservers.delete(finish);
        resolve();
      };
      this.stopObservers.add(finish);
      timeout = setTimeout(finish, delayMs);
      if (this.stopGeneration > observedStopGeneration) {
        finish();
      }
    });
  }

  private resolveStopObservers(): void {
    const observers = [...this.stopObservers];
    this.stopObservers.clear();
    for (const observer of observers) {
      observer();
    }
  }

  private startRunnerActivityRenewal(): () => void {
    const lifecycleReevaluationMs =
      readRunnerContainerLifecycleReevaluationMs(this.environment);
    const intervalMs = computeRunnerActivityRenewIntervalMs(
      lifecycleReevaluationMs,
    );
    const interval = setInterval(() => {
      this.noteRunnerActivity("invoke-heartbeat");
    }, intervalMs);

    return () => {
      clearInterval(interval);
    };
  }

  protected noteRunnerActivity(stage: string): boolean {
    if (!this.renewPlatformActivityTimeout(stage)) {
      return false;
    }

    this.recordContainerActivityObserved(stage);
    return true;
  }

  private renewPlatformActivityTimeout(stage = "activity-expired-early-renew"): boolean {
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

  private observeRecentPlatformStart(
    state: unknown,
    maxAgeMs: number,
  ): RunnerContainerCurrentStart | null {
    if (this.currentContainerStart) {
      return this.currentContainerStart;
    }
    const recentStart = readRecentContainerStart(state, Date.now(), maxAgeMs);
    const startedAtMs = readContainerLastChangeMs(state);
    if (!recentStart || startedAtMs === null) {
      return null;
    }
    return this.recordContainerStartIssued(startedAtMs, maxAgeMs, false);
  }

  private recordContainerStartIssued(
    startedAtMs: number,
    maxAgeMs: number,
    replaceReadyStart: boolean,
  ): RunnerContainerCurrentStart {
    const existing = this.currentContainerStart;
    if (
      existing
      && (!replaceReadyStart || existing.readyObservedBy === null)
    ) {
      this.recordContainerActivityObserved("onStart");
      this.lastActivityExpiryAtMs = null;
      this.lastDestroyRequest = null;
      return existing;
    }
    const currentStart: RunnerContainerCurrentStart = {
      pendingUntilMs: startedAtMs + maxAgeMs,
      readyObservedBy: null,
      startedAtMs,
    };
    this.currentContainerStart = currentStart;
    this.recordContainerActivityObserved("onStart");
    this.lastActivityExpiryAtMs = null;
    this.lastDestroyRequest = null;
    return currentStart;
  }

  private recordContainerReady(
    observedBy: RunnerContainerReadinessObservation,
    state?: unknown,
    expectedStart?: RunnerContainerCurrentStart,
  ): void {
    if (
      expectedStart
      && this.currentContainerStart !== expectedStart
    ) {
      return;
    }
    const startedAtMs = this.currentContainerStart?.startedAtMs
      ?? readContainerLastChangeMs(state)
      ?? Date.now();
    this.currentContainerStart = {
      pendingUntilMs: null,
      readyObservedBy: observedBy,
      startedAtMs,
    };
    this.recordContainerActivityObserved(observedBy);
    this.lastActivityExpiryAtMs = null;
    this.lastDestroyRequest = null;
  }

  private clearCurrentContainerPendingWindow(): void {
    if (this.currentContainerStart) {
      this.currentContainerStart.pendingUntilMs = null;
    }
  }

  private recordCurrentContainerStopped(): boolean {
    const currentGenerationObserved = this.currentContainerStart !== null
      || this.recentReadinessProof !== null
      || this.lastDestroyRequest !== null
      || this.stopObservers.size > 0;
    if (!currentGenerationObserved) {
      return false;
    }
    this.stopGeneration += 1;
    this.currentContainerStart = null;
    this.clearRecentReadinessProof();
    this.warmShellInvalidatedByUnsettledDestroy = false;
    this.shellPrewarmObservation = null;
    this.lastActivityExpiryAtMs = null;
    this.lastActivityObservedAtMs = null;
    this.lastActivityObservedStage = null;
    this.lastDestroyRequest = null;
    this.resolveStopObservers();
    return true;
  }

  private recordContainerActivityObserved(stage: string): void {
    this.lastActivityObservedAtMs = Date.now();
    this.lastActivityObservedStage = stage;
  }

  private noteContainerInteraction(): void {
    this.containerInteractionGeneration += 1;
  }

  private logLifecycleCleanupFailure(message: string, error: unknown): void {
    emitHostedExecutionStructuredLog({
      component: "container",
      error,
      level: "warn",
      message,
      phase: "container.ready",
      userId: this.currentLogContext?.userId,
    });
  }

  private buildLifecycleDiagnosticDetails(): HostedExecutionStructuredLogDetails {
    const nowMs = Date.now();
    const runnerIdleTtlMs = readRunnerContainerIdleTtlMs(this.environment);
    const containerUptimeMs = readElapsedMs(
      this.currentContainerStart?.startedAtMs ?? null,
      nowMs,
    );
    const destroyRequestAgeMs = readElapsedMs(this.lastDestroyRequest?.requestedAtMs ?? null, nowMs);
    const lastActivityExpiryAgeMs = readElapsedMs(this.lastActivityExpiryAtMs, nowMs);
    const lastActivityObservedAgeMs = readElapsedMs(this.lastActivityObservedAtMs, nowMs);

    return {
      activeWorkspaceInvocationPresent: this.workspaceInvocationOperations.length > 0,
      containerStartObservedBy: this.currentContainerStart?.readyObservedBy
        ?? (this.currentContainerStart ? "onStart" : null),
      containerUptimeMs,
      destroyRequestAgeMs,
      destroyRequestFailClosed: this.lastDestroyRequest?.failClosed ?? null,
      destroyRequestPresent: this.lastDestroyRequest !== null,
      destroyRequestReason: this.lastDestroyRequest?.reason ?? null,
      destroyRequestStatusBeforeDestroy: this.lastDestroyRequest?.statusBeforeDestroy ?? null,
      idleTtlDeltaMs: lastActivityObservedAgeMs === null ? null : lastActivityObservedAgeMs - runnerIdleTtlMs,
      lastActivityExpiryAgeMs,
      lastActivityObservedAgeMs,
      lastActivityObservedStage: this.lastActivityObservedStage,
      runnerIdleTtlMs,
      sleepAfter: String(this.sleepAfter),
      warmShellInvalidatedByUnsettledDestroy: this.warmShellInvalidatedByUnsettledDestroy,
    };
  }

  private async withLifecycleLock<T>(
    work: () => Promise<T>,
    options: {
      blockPointerlessWake?: boolean;
    } = {},
  ): Promise<T> {
    const blockPointerlessWake = options.blockPointerlessWake ?? true;
    this.lifecycleLockPendingCount += 1;
    if (blockPointerlessWake) {
      this.pointerlessWakeBlockingLifecycleCount += 1;
    }
    const run = async (): Promise<T> => {
      try {
        return await work();
      } finally {
        this.lifecycleLockPendingCount -= 1;
        if (blockPointerlessWake) {
          this.pointerlessWakeBlockingLifecycleCount -= 1;
        }
      }
    };
    const next = this.lifecycleLock.then(run, run);
    this.lifecycleLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private supersedeShellPrewarm(): boolean {
    const operation = this.shellPrewarmOperation;
    if (!operation) {
      return false;
    }
    this.shellPrewarmOperation = null;
    if (!operation.abortController.signal.aborted) {
      operation.abortController.abort(
        new RunnerContainerShellPrewarmSupersededError(),
      );
    }
    return true;
  }

  private recordShellPrewarmHint(
    source: CloudflareHostedControlRuntimeShellPrewarmSource | undefined,
  ): RunnerContainerShellPrewarmObservation {
    const hintedAtMs = Date.now();
    const observation: RunnerContainerShellPrewarmObservation = {
      firstHintAtEpochMs: hintedAtMs,
      hintCount: 1,
      source: source ?? "unknown",
    };
    this.shellPrewarmObservation = observation;
    return observation;
  }

  private observeShellPrewarmOperation(input: {
    observation: RunnerContainerShellPrewarmObservation;
    operation: RunnerContainerShellPrewarmOperation;
    userId: string;
  }): void {
    if (input.operation.observed) {
      return;
    }
    input.operation.observed = true;
    void input.operation.result.then(
      (result) => {
        const finishedAtMs = Date.now();
        const coldStartObserved = result.action === "start_issued"
          && !input.operation.coldStartAlreadyObserved
          && this.currentContainerStart !== null;
        input.observation.outcome = result.action === "superseded"
          ? "superseded"
          : coldStartObserved
          ? "cold_start_observed"
          : "start_issued_warm";
        input.observation.finishedAtEpochMs = finishedAtMs;
        const elapsedMs = Math.max(
          0,
          finishedAtMs - input.operation.startedAtMs,
        );
        input.observation.operationElapsedMs = elapsedMs;
        queueMicrotask(() => {
          emitHostedExecutionStructuredLog({
            component: "runner.container",
            details: {
              shellPrewarmColdStartObserved: coldStartObserved,
              shellPrewarmElapsedMs: elapsedMs,
              shellPrewarmHintCountAtCompletion: input.observation.hintCount,
              shellPrewarmOutcome: result.action,
              shellPrewarmSource: input.observation.source,
            },
            message: "Hosted runner shell prewarm operation completed.",
            phase: "container.starting",
            userId: input.userId,
          });
        });
      },
      (error: unknown) => {
        const finishedAtMs = Date.now();
        input.observation.outcome = "failed";
        input.observation.finishedAtEpochMs = finishedAtMs;
        const elapsedMs = Math.max(
          0,
          finishedAtMs - input.operation.startedAtMs,
        );
        input.observation.operationElapsedMs = elapsedMs;
        queueMicrotask(() => {
          emitHostedExecutionStructuredLog({
            component: "runner.container",
            details: {
              ...buildHostedExecutionSafeErrorDiagnostics(error),
              shellPrewarmElapsedMs: elapsedMs,
              shellPrewarmHintCountAtCompletion: input.observation.hintCount,
              shellPrewarmOutcome: "failed",
              shellPrewarmSource: input.observation.source,
            },
            error,
            level: "warn",
            message: "Hosted runner shell prewarm failed after acceptance.",
            phase: "failed",
            userId: input.userId,
          });
        });
      },
    );
  }

  private recordRecentReadinessProof(userId: string): void {
    this.recentReadinessProof = {
      checkedAtMs: Date.now(),
      stopGeneration: this.stopGeneration,
      userId,
    };
  }

  private clearRecentReadinessProof(): void {
    this.recentReadinessProof = null;
  }

  private readRecentReadinessProof(nowMs: number, userId: string): { ageMs: number } | null {
    const proof = this.recentReadinessProof;
    if (!proof || proof.stopGeneration !== this.stopGeneration || proof.userId !== userId) {
      this.clearRecentReadinessProof();
      return null;
    }

    const ageMs = nowMs - proof.checkedAtMs;
    if (ageMs < 0 || ageMs > RUNNER_RECENT_READINESS_PROOF_MAX_AGE_MS) {
      this.clearRecentReadinessProof();
      return null;
    }

    return { ageMs };
  }
}

function readElapsedMs(startedAtMs: number | null, nowMs: number): number | null {
  return startedAtMs === null ? null : Math.max(0, nowMs - startedAtMs);
}

function readNullableNumber(value: HostedExecutionStructuredLogDetailValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classifyRunnerContainerStop(input: {
  activeWorkspaceInvocationPresent: boolean;
  cleanExit: boolean;
  destroyRequestPresent: boolean;
  idleTtlDeltaMs: number | null;
}): string {
  if (input.activeWorkspaceInvocationPresent) {
    return input.cleanExit ? "active-operation-clean-stop" : "active-operation-nonzero-stop";
  }

  if (input.destroyRequestPresent) {
    return input.cleanExit ? "requested-clean-stop" : "requested-nonzero-stop";
  }

  if (input.idleTtlDeltaMs !== null && Math.abs(input.idleTtlDeltaMs) <= 15_000) {
    return input.cleanExit
      ? "unrequested-near-idle-ttl-clean-stop"
      : "unrequested-near-idle-ttl-nonzero-stop";
  }

  return input.cleanExit ? "unrequested-clean-stop" : "unrequested-nonzero-stop";
}

export class DeploySmokeRunnerContainer extends RunnerContainer {
  private liveModelTurnSmokeFence: {
    expiresAtMs: number;
    model: string;
    remainingRequests: number;
  } | null = null;

  // Worker-side half of the deploy-smoke live model turn. The container runs
  // `codex exec` with the injected-credential placeholder; while the fence
  // below is open, the Worker egress intercept authorizes this container's
  // api.openai.com egress and injects the real Worker-owned OPENAI_API_KEY.
  // The raw key never travels to the container and never appears in logs.
  protected override async smokeLiveModelTurn(
    readyTimeoutMs: number,
    input: NonNullable<HostedExecutionContainerSmokeHealthInput["liveModelTurn"]>,
  ): Promise<NonNullable<HostedExecutionContainerSmokeHealthResult["liveModelTurn"]>> {
    const apiKey = this.environment.OPENAI_API_KEY;
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new Error(
        "Hosted runner live model turn smoke requires the OPENAI_API_KEY Worker secret.",
      );
    }
    const smokeTimeoutMs = Math.max(
      readyTimeoutMs,
      RUNNER_LIVE_MODEL_TURN_SMOKE_MIN_TIMEOUT_MS,
    );
    const smokeSignal = AbortSignal.timeout(smokeTimeoutMs);
    this.liveModelTurnSmokeFence = {
      expiresAtMs: Date.now() + smokeTimeoutMs,
      model: input.model,
      remainingRequests: 1,
    };
    try {
      const response = await this.containerFetch(
        RUNNER_LIVE_MODEL_TURN_SMOKE_URL,
        {
          method: "POST",
          signal: smokeSignal,
        },
      );
      const payload = await readRunnerContainerMetadataJsonObject(response, {
        signal: smokeSignal,
      });
      if (!response.ok || payload.ok !== true) {
        // The container reports content-free smoke diagnostics; carry them so
        // deploy failures stay debuggable through the worker layer.
        const smokeErrorMessage = typeof payload.smokeErrorMessage === "string"
          ? ` ${payload.smokeErrorMessage.slice(0, 512)}`
          : "";
        throw new Error(
          `Hosted runner container live model turn smoke failed with HTTP ${response.status}.${smokeErrorMessage}`,
        );
      }
      const result = readRunnerContainerMetadataRecordProperty(payload.liveModelTurn);
      const egressGrantConsumed = this.liveModelTurnSmokeFence?.remainingRequests === 0;
      if (!egressGrantConsumed) {
        throw new Error(
          "Hosted runner container live model turn smoke did not consume the Worker egress grant.",
        );
      }
      return {
        durationMs: typeof result.durationMs === "number" ? result.durationMs : null,
        egressGrantConsumed,
        model: typeof result.model === "string" ? result.model : null,
        stdoutBytes: typeof result.stdoutBytes === "number" ? result.stdoutBytes : null,
      };
    } finally {
      this.liveModelTurnSmokeFence = null;
    }
  }

  // Queried by the Worker egress intercept to authorize exactly one
  // deploy-smoke OpenAI request while smokeLiveModelTurn is in flight, with an
  // expiry bound in case the smoke request hangs. The active read consumes the
  // fence so loops or unexpected retries cannot keep using the Worker key.
  async readDeploySmokeLiveModelTurnFence(): Promise<{
    active: boolean;
    model?: string;
  }> {
    const fence = this.liveModelTurnSmokeFence;
    if (
      !fence
      || Date.now() >= fence.expiresAtMs
      || fence.remainingRequests <= 0
    ) {
      return {
        active: false,
      };
    }
    fence.remainingRequests -= 1;
    return {
      active: true,
      model: fence.model,
    };
  }
}

registerHostedRunnerContainerOutboundInterception(RunnerContainer);
registerHostedRunnerContainerOutboundInterception(DeploySmokeRunnerContainer);

function registerHostedRunnerContainerOutboundInterception(
  containerClass: typeof RunnerContainer,
): void {
  const outboundByHostSetter = Object.getOwnPropertyDescriptor(Container, "outboundByHost")?.set;

  // A static catch-all outbound handler makes Cloudflare Containers intercept all
  // HTTPS destinations. Keep interception host-specific so direct R2 uploads stay
  // on the container's internet path instead of the Worker request body path.
  if (outboundByHostSetter) {
    outboundByHostSetter.call(containerClass, HOSTED_RUNNER_OUTBOUND_BY_HOST);
    return;
  }

  const legacyContainerClass = containerClass as typeof RunnerContainer & {
    outboundByHost: typeof HOSTED_RUNNER_OUTBOUND_BY_HOST;
  };
  legacyContainerClass.outboundByHost = HOSTED_RUNNER_OUTBOUND_BY_HOST;
}

export async function invokeHostedExecutionContainerRunner(
  input: HostedExecutionContainerRunnerInput,
): Promise<HostedExecutionRunnerJobResult> {
  const jobUserId = readHostedExecutionRunnerJobUserId(input.job);
  if (input.userId !== jobUserId) {
    throw new TypeError("Hosted runner container route userId must match workspace job userId.");
  }

  const container = input.runnerContainerNamespace.getByName(input.runnerContainerName ?? jobUserId);
  const invokeRequest: HostedExecutionContainerInvokeRequest = {
    job: input.job,
    ...(input.orchestration ? { orchestration: input.orchestration } : {}),
    ...(input.timeoutMs === undefined || input.timeoutMs === null
      ? {}
      : { timeoutMs: input.timeoutMs }),
    userId: jobUserId,
  };
  const invocation = invokeRunnerContainerProcessing(container, invokeRequest);
  return input.signal
    ? await raceRunnerContainerOperationAbort(invocation, input.signal, async () => {
        if (isRunnerContainerAbortHardTimeout(input.signal?.reason)) {
          void container.destroyInstance().catch((error: unknown) => {
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
            leaseGeneration: input.job.request.leaseGeneration,
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

export async function refreshHostedExecutionContainerBrowserVaultReplica(_input?: unknown): Promise<never> {
  throw new Error("Hosted runner browser-vault refresh side path has been removed.");
}

async function raceRunnerContainerOperationAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onOperationAbort?: () => Promise<"use_operation_outcome" | undefined | void>,
): Promise<T> {
  if (signal.aborted) {
    const abortDisposition = await onOperationAbort?.().catch(() => undefined);
    if (abortDisposition === "use_operation_outcome") {
      return await operation;
    }
    throwIfRunnerContainerOperationAborted(signal);
  }

  let removeAbortListener: () => void = () => undefined;
  const abortCleanup: {
    promise: Promise<"use_operation_outcome" | undefined | void> | null;
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
      const abortDisposition = await abortCleanup.promise?.catch(() => undefined);
      if (abortDisposition === "use_operation_outcome") {
        return await operation;
      }
      void operation.catch(() => undefined);
    }
    throw error;
  } finally {
    removeAbortListener();
  }
}

async function waitForRunnerContainerOperationSettlement(
  operation: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      operation.then(
        () => true as const,
        () => true as const,
      ),
      timeout,
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function isRunnerContainerAbortHardTimeout(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "TimeoutError";
}

function isRunnerContainerFatalReadinessError(error: unknown): boolean {
  return error instanceof HostedRunnerContainerArchitectureMismatchError
    || error instanceof HostedRunnerContainerBundleMismatchError
    || error instanceof HostedRunnerContainerPoisonedError;
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

function combineRunnerContainerAbortSignals(
  first: AbortSignal,
  second: AbortSignal,
): AbortSignal {
  if (first.aborted) {
    return first;
  }
  if (second.aborted) {
    return second;
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
  let responseJsonParseFailed = false;

  try {
    payload = await response.clone().json() as {
      code?: unknown;
      error?: unknown;
    };
  } catch {
    payload = null;
    responseJsonParseFailed = true;
  }

  const code = typeof payload?.code === "string" && payload.code.trim().length > 0
    ? payload.code
    : null;
  const responseMetadata = payload
    ? {}
    : buildHostedRunnerContainerNonJsonResponseMetadata(response);
  const details = sanitizeHostedExecutionStructuredLogDetails({
    ...buildHostedRunnerContainerPayloadDetailsMetadata(payload?.details),
    ...(responseJsonParseFailed ? { responseJsonParseFailed } : {}),
    ...responseMetadata,
  });
  const safePayloadMessage = readHostedRunnerContainerSafePayloadMessage(payload?.error)
    ?? summarizeHostedRunnerContainerErrorCode(code);
  const message = safePayloadMessage
    ? formatHostedRunnerContainerErrorMessage({
        code,
        details,
        message: safePayloadMessage,
        status: response.status,
      })
    : `Hosted runner container returned HTTP ${response.status}.`;
  const payloadErrorName = typeof payload?.errorName === "string" && payload.errorName.trim().length > 0
    ? payload.errorName.trim()
    : null;
  const codeErrorName = readHostedExecutionErrorNameForCode(code);
  const errorName = codeErrorName && (!payloadErrorName || payloadErrorName === "Error")
    ? codeErrorName
    : payloadErrorName ?? codeErrorName;

  if (response.status === 503 && code === HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE) {
    return new HostedRunnerContainerShuttingDownError({
      details,
      message,
      statusCode: response.status,
    });
  }

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

function buildHostedRunnerContainerPayloadDetailsMetadata(
  details: unknown,
): HostedExecutionStructuredLogDetails {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }

  const record = details as Record<string, unknown>;
  const metadata: HostedExecutionStructuredLogDetails = {
    payloadDetailsPresent: true,
  };
  const errorCodeDetail = readHostedRunnerContainerSafeCode(record.errorCodeDetail);
  if (errorCodeDetail) {
    metadata.errorCodeDetail = errorCodeDetail;
  }
  const runtimeFailurePhaseCode =
    record[HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY];
  if (isHostedRuntimeFailurePhaseCode(runtimeFailurePhaseCode)) {
    metadata[HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY] =
      runtimeFailurePhaseCode;
  }
  if (hasNonEmptyHostedRunnerContainerString(record.errorDetail)) {
    metadata.errorDetailPresent = true;
  }
  if (hasNonEmptyHostedRunnerContainerString(record.errorCause)) {
    metadata.errorCausePresent = true;
  }
  if (Array.isArray(record.stackPreview) && record.stackPreview.length > 0) {
    metadata.stackPreviewPresent = true;
  }

  const errorStatus = record.errorStatus;
  if (
    typeof errorStatus === "number"
    && Number.isInteger(errorStatus)
    && errorStatus >= 100
    && errorStatus <= 599
  ) {
    metadata.errorStatus = errorStatus;
  }

  for (const [key, value] of Object.entries(readHostedRunnerContainerResponseMetadata(record))) {
    metadata[key] = value;
  }

  return metadata;
}

function readHostedRunnerContainerResponseMetadata(
  record: Record<string, unknown>,
): HostedExecutionStructuredLogDetails {
  const metadata: HostedExecutionStructuredLogDetails = {};
  if (typeof record.responseJsonParseFailed === "boolean") {
    metadata.responseJsonParseFailed = record.responseJsonParseFailed;
  }
  if (typeof record.responseBodyPreviewOmitted === "boolean") {
    metadata.responseBodyPreviewOmitted = record.responseBodyPreviewOmitted;
  }
  if (typeof record.responseBodyPresent === "boolean") {
    metadata.responseBodyPresent = record.responseBodyPresent;
  }
  if (typeof record.responseContentLengthBytes === "number" && Number.isSafeInteger(record.responseContentLengthBytes)) {
    metadata.responseContentLengthBytes = record.responseContentLengthBytes;
  }
  const responseContentType = readHostedRunnerContainerSafeContentType(record.responseContentType);
  if (responseContentType) {
    metadata.responseContentType = responseContentType;
  }

  return metadata;
}

function readHostedRunnerContainerSafePayloadMessage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return HOSTED_RUNNER_CONTAINER_SAFE_ERROR_MESSAGES.has(normalized)
    ? normalized
    : null;
}

function summarizeHostedRunnerContainerErrorCode(code: string | null): string | null {
  return code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
    ? summarizeHostedExecutionErrorCode("configuration_error")
    : summarizeHostedExecutionErrorCode(code);
}

function readHostedRunnerContainerSafeCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(normalized) ? normalized : null;
}

function readHostedRunnerContainerSafeContentType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u
    .test(normalized)
    ? normalized
    : null;
}

function hasNonEmptyHostedRunnerContainerString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function buildHostedRunnerContainerNonJsonResponseMetadata(
  response: Response,
): HostedExecutionStructuredLogDetails {
  const metadata: HostedExecutionStructuredLogDetails = {
    responseBodyPreviewOmitted: true,
  };
  const contentLengthBytes = readHostedRunnerContainerContentLengthBytes(response);
  if (contentLengthBytes !== null) {
    metadata.responseContentLengthBytes = contentLengthBytes;
    metadata.responseBodyPresent = contentLengthBytes > 0;
  }

  const contentType = readHostedRunnerContainerContentType(response);
  if (contentType) {
    metadata.responseContentType = contentType;
  }

  return metadata;
}

function readHostedRunnerContainerContentLengthBytes(response: Response): number | null {
  const raw = response.headers.get("content-length")?.trim();
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readHostedRunnerContainerContentType(response: Response): string | null {
  const raw = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!raw) {
    return null;
  }

  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u
    .test(raw)
    ? raw
    : null;
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
  const transportedCodeDetail = input.details?.errorCodeDetail;
  const code = readHostedRunnerContainerDiagnosticFragment(
    isHostedRuntimeFailurePhaseCode(transportedCodeDetail)
      ? input.code ?? undefined
      : transportedCodeDetail ?? input.code ?? undefined,
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

function emitRunnerContainerLifecycleFailure(input: {
  context: RunnerContainerLogContext | null;
  destroyLatencyMs: number | null;
  error: unknown;
  failClosed: boolean;
  message: string;
  statusBeforeDestroy: string | null;
  stage: "destroy" | "status";
}): void {
  emitHostedExecutionStructuredLog({
    component: "container",
    details: {
      destroyLatencyMs: input.destroyLatencyMs,
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

async function invokeRunnerContainerProcessing(
  container: HostedExecutionContainerStubLike,
  invokeRequest: HostedExecutionContainerInvokeRequest,
): Promise<HostedExecutionRunnerJobResult> {
  if (!container.ensureProcessing) {
    return await container.invoke(invokeRequest);
  }

  const ensure = async () =>
    await container.ensureProcessing!({
      invoke: invokeRequest,
      userId: invokeRequest.userId,
    });

  const ensured = await ensure();
  if (ensured.kind === "accepted" && ensured.result) {
    return ensured.result;
  }
  if (ensured.kind === "failed") {
    throw createRunnerContainerProcessingFailureError(ensured.failure);
  }
  if (ensured.kind === "start-required" && ensured.reason === "no-active-child") {
    const retried = await ensure();
    if (retried.kind === "accepted" && retried.result) {
      return retried.result;
    }
    if (retried.kind === "failed") {
      throw createRunnerContainerProcessingFailureError(retried.failure);
    }
    throw new Error(
      `Hosted runner container replacement retry returned ${retried.kind} without invoking work.`,
    );
  }

  throw new Error(`Hosted runner container ensureProcessing returned ${ensured.kind} without invoking work.`);
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
  return resolveHostedExecutionRunnerContainerNameFromIdentity(input);
}

export function resolveHostedExecutionRunnerUserIdFromContainerName(input: {
  containerName: string;
  source: RunnerContainerNameSource;
}): string {
  return readHostedRunnerContainerIdentity(input)?.userId ?? input.containerName.trim();
}

function assertRunnerContainerEnsureProcessingUserIds(
  input: RunnerContainerEnsureProcessingInput,
): void {
  if (input.activeRuntime && input.activeRuntime.userId !== input.userId) {
    throw new TypeError("Hosted runner container ensureProcessing activeRuntime userId must match input userId.");
  }

  if (!input.invoke) {
    return;
  }

  if (input.invoke.userId !== input.userId) {
    throw new TypeError("Hosted runner container ensureProcessing invoke userId must match input userId.");
  }

  const jobUserId = readHostedExecutionRunnerJobUserId(input.invoke.job);
  if (jobUserId !== input.userId) {
    throw new TypeError("Hosted runner container ensureProcessing job userId must match input userId.");
  }
}

function normalizeRunnerRuntimeProcessingMode(
  value: unknown,
): RunnerRuntimeProcessingMode {
  return value === "inbox_media_retention" || value === "system_mailbox"
    ? value
    : "default";
}

function parseRunnerContainerEnsureReadyForProcessingInput(
  payload: RunnerContainerEnsureReadyForProcessingInput,
): RunnerContainerEnsureReadyForProcessingInput {
  return {
    timeoutMs: readTimeoutMs(payload.timeoutMs, DEFAULT_RUNNER_READY_TIMEOUT_MS),
    userId: requireString(payload.userId, "payload.userId"),
  };
}

function parseRunnerContainerBeginShellPrewarmInput(
  payload: RunnerContainerBeginShellPrewarmInput,
): RunnerContainerBeginShellPrewarmInput {
  const input = parseRunnerContainerEnsureReadyForProcessingInput(payload);
  if (
    payload.source !== undefined
    && payload.source !== "linq-instant-start"
    && payload.source !== "linq-typing-started"
  ) {
    throw new TypeError("payload.source must be a supported shell-prewarm source.");
  }
  return {
    ...input,
    ...(payload.source === undefined ? {} : { source: payload.source }),
  };
}

function parseHostedExecutionContainerInvokeInput(
  payload: {
    job?: unknown;
    orchestration?: unknown;
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
    orchestration: sanitizeHostedRuntimeOrchestrationLatencyDiagnostics(payload.orchestration),
    timeoutMs: readOptionalTimeoutMs(payload.timeoutMs),
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

function readOptionalTimeoutMs(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return readTimeoutMs(value, DEFAULT_RUNNER_READY_TIMEOUT_MS);
}

async function assertRunnerHealthy(
  container: RunnerContainer,
  timeoutMs: number,
  environment: RunnerContainerEnvironmentSource,
  signal?: AbortSignal,
): Promise<void> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const abortSignal = signal
    ? combineRunnerContainerAbortSignals(signal, timeoutSignal)
    : timeoutSignal;
  const response = await container.containerFetch(
    RUNNER_HEALTH_URL,
    {
      method: "GET",
      signal: abortSignal,
    },
  );

  const responseOk = response.ok;
  const payload = await readRunnerContainerMetadataJsonObject(response, {
    signal: abortSignal,
  });

  if (!responseOk) {
    throw new Error(`Hosted runner container health check returned HTTP ${response.status}.`);
  }
  const actualVersion = typeof payload.hostedRuntimeArchitectureVersion === "string"
    ? payload.hostedRuntimeArchitectureVersion
    : null;
  if (actualVersion !== HOSTED_RUNTIME_ARCHITECTURE_VERSION) {
    throw new HostedRunnerContainerArchitectureMismatchError({
      actualVersion,
      expectedVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    });
  }
  const expectedBundleIdentity = readHostedRunnerExpectedBundleIdentity(environment);
  const runnerBundle = readRunnerContainerMetadataRecordProperty(payload.runnerBundle);
  if (
    expectedBundleIdentity
    && (
      runnerBundle.bundleFingerprint !== expectedBundleIdentity.bundleFingerprint
      || runnerBundle.sourceFingerprint !== expectedBundleIdentity.sourceFingerprint
    )
  ) {
    throw new HostedRunnerContainerBundleMismatchError();
  }
  if (payload.poisoned === true) {
    throw new HostedRunnerContainerPoisonedError({
      lastCleanupStatus: typeof payload.lastCleanupStatus === "string"
        ? payload.lastCleanupStatus
        : null,
    });
  }
}

function readHostedRunnerExpectedBundleIdentity(
  environment: RunnerContainerEnvironmentSource,
): { bundleFingerprint: string; sourceFingerprint: string } | null {
  const bundleFingerprint = readOptionalEnvironmentString(
    environment.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT,
  );
  const sourceFingerprint = readOptionalEnvironmentString(
    environment.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT,
  );
  if (!bundleFingerprint && !sourceFingerprint) {
    return null;
  }
  if (!bundleFingerprint || !sourceFingerprint) {
    throw new TypeError(
      "Hosted runner bundle and source fingerprints must be configured together.",
    );
  }
  return { bundleFingerprint, sourceFingerprint };
}

function readOptionalEnvironmentString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function readRunnerContainerMetadataJsonObject(
  response: Response,
  options: { signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  const text = await readRunnerContainerMetadataResponseText(response, options);
  if (!text.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new HostedRunnerContainerMetadataResponseError({
      details: sanitizeHostedExecutionStructuredLogDetails({
        errorStatus: response.status,
        responseJsonParseFailed: true,
        responseStatus: response.status,
        ...buildHostedRunnerContainerNonJsonResponseMetadata(response),
      }) ?? {
        errorStatus: response.status,
        responseJsonParseFailed: true,
        responseStatus: response.status,
      },
      statusCode: response.status,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Runner container metadata response body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function readRunnerContainerMetadataRecordProperty(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function readRunnerContainerMetadataResponseText(
  response: Response,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const body = response.body;
  if (body === null || response.bodyUsed) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  const drainTimeoutSignal = AbortSignal.timeout(RUNNER_METADATA_RESPONSE_BODY_DRAIN_TIMEOUT_MS);
  const drainSignal = options.signal
    ? combineRunnerContainerAbortSignals(options.signal, drainTimeoutSignal)
    : drainTimeoutSignal;
  await body.pipeTo(new WritableStream<Uint8Array>({
    write(chunk) {
      bytesRead += chunk.byteLength;
      if (bytesRead > RUNNER_METADATA_RESPONSE_BODY_MAX_BYTES) {
        throw new Error("Runner container metadata response body exceeded the drain limit.");
      }
      chunks.push(chunk);
    },
  }), {
    signal: drainSignal,
  });
  return new TextDecoder().decode(concatRunnerContainerMetadataChunks(chunks, bytesRead));
}

function concatRunnerContainerMetadataChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function drainRunnerContainerMetadataResponseBody(
  response: Response,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const body = response.body;
  if (body === null || response.bodyUsed) {
    return;
  }

  // Cloudflare Containers decrements containerFetch in-flight activity after small metadata bodies are drained.
  let bytesRead = 0;
  const drainTimeoutSignal = AbortSignal.timeout(RUNNER_METADATA_RESPONSE_BODY_DRAIN_TIMEOUT_MS);
  const drainSignal = options.signal
    ? combineRunnerContainerAbortSignals(options.signal, drainTimeoutSignal)
    : drainTimeoutSignal;
  await body.pipeTo(new WritableStream<Uint8Array>({
    write(chunk) {
      bytesRead += chunk.byteLength;
      if (bytesRead > RUNNER_METADATA_RESPONSE_BODY_MAX_BYTES) {
        throw new Error("Runner container metadata response body exceeded the drain limit.");
      }
    },
  }), {
    signal: drainSignal,
  });
}

function readContainerStatus(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const status = (state as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function readContainerLastChangeMs(state: unknown): number | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const lastChange = (state as { lastChange?: unknown }).lastChange;
  return typeof lastChange === "number" && Number.isFinite(lastChange)
    ? lastChange
    : null;
}

function readRecentContainerStart(
  state: unknown,
  nowMs: number,
  maxAgeMs: number,
): { ageMs: number } | null {
  const status = readContainerStatus(state);
  if (status !== "running" && status !== "healthy") {
    return null;
  }
  const lastChangeMs = readContainerLastChangeMs(state);
  if (lastChangeMs === null) {
    return null;
  }
  const ageMs = nowMs - lastChangeMs;
  return ageMs >= 0 && ageMs <= maxAgeMs ? { ageMs } : null;
}

function isRunnerContainerStopped(status: string | null): boolean {
  return status === "stopped" || status === "stopped_with_code";
}

function isRunnerContainerRunning(status: string | null): boolean {
  return status === "running";
}

async function watchWorkspaceRequestContainerStop(input: {
  container: RunnerContainer;
  operationAbortController: AbortController;
  signal: AbortSignal;
  userId: string;
}): Promise<never> {
  const observedStatuses: string[] = [];
  let stoppedFirstObservedAt: number | null = null;
  let stoppedStatus: string | null = null;
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
    const stopped = isRunnerContainerStopped(status);
    if (!stopped) {
      stoppedFirstObservedAt = null;
      stoppedStatus = null;
      continue;
    }

    const now = Date.now();
    stoppedFirstObservedAt ??= now;
    stoppedStatus ??= status;
    if ((now - stoppedFirstObservedAt) < RUNNER_STOPPED_REQUEST_SETTLE_MS) {
      continue;
    }

    const error = new Error(`workspace invocation container stopped during active work (${stoppedStatus})`);
    input.operationAbortController.abort(error);
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        lifecycleStage: "active-request-status-watch",
        observedStatuses,
        statusAfterStop: stoppedStatus,
        stoppedSettleMs: now - stoppedFirstObservedAt,
        stoppedSettleThresholdMs: RUNNER_STOPPED_REQUEST_SETTLE_MS,
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

function appendObservedRunnerContainerStatus(
  statuses: string[],
  status: string | null,
): void {
  const normalized = status ?? "unknown";
  if (statuses.at(-1) === normalized) {
    return;
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

async function readRunnerContainerStatusWithTimeout(
  container: RunnerContainer,
  timeoutMs: number,
): Promise<string | null> {
  const statusRead = readRunnerContainerStatus(container);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      statusRead,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Hosted runner container status read timed out."));
        }, Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    void statusRead.catch(() => undefined);
  }
}

function readRunnerContainerIdleTtlMs(source: RunnerContainerEnvironmentSource): number {
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

function readRunnerContainerLifecycleReevaluationMs(
  source: RunnerContainerEnvironmentSource,
): number {
  const raw = source.HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS;
  if (raw === undefined || raw === null || raw === "") {
    return readRunnerContainerIdleTtlMs(source);
  }
  if (typeof raw !== "string") {
    throw new TypeError(
      "HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS must be a string when configured.",
    );
  }
  const parsed = readStrictPositiveIntegerEnv(raw);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < MIN_RUNNER_LIFECYCLE_REEVALUATION_MS
  ) {
    throw new TypeError(
      "HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS must be an integer "
      + `greater than or equal to ${MIN_RUNNER_LIFECYCLE_REEVALUATION_MS}.`,
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

function buildRunnerContainerMetadataOnlyErrorDetails(error: unknown): HostedExecutionStructuredLogDetails {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  if (!diagnostics) {
    return {};
  }

  return {
    detailsKeys: Object.keys(diagnostics).sort(),
    ...buildRunnerContainerResponseMetadataDetails(error),
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

function buildRunnerContainerTransportFailureDetails(
  error: unknown,
  preservedActiveOperation: boolean,
): HostedExecutionStructuredLogDetails {
  if (!preservedActiveOperation) {
    return {};
  }

  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  const diagnosticText = readHostedRunnerContainerDiagnosticFragment(
    diagnostics?.errorDetail ?? diagnostics?.errorMessage,
    { redactEnvKeys: true },
  );
  if (!diagnosticText) {
    return {
      runnerTransportFailureErrorDetailPresent: false,
    };
  }

  return {
    runnerTransportFailureErrorDetail:
      diagnosticText.slice(0, RUNNER_TRANSPORT_FAILURE_DETAIL_MAX_CHARS),
    runnerTransportFailureErrorDetailPresent: true,
    runnerTransportFailureErrorDetailTruncated:
      diagnosticText.length > RUNNER_TRANSPORT_FAILURE_DETAIL_MAX_CHARS,
  };
}

function buildRunnerContainerResponseMetadataDetails(error: unknown): HostedExecutionStructuredLogDetails {
  const details = readRunnerContainerErrorDetails(error);
  if (!details) {
    return {};
  }

  return {
    runnerResponseDetailsKeys: Object.keys(details).sort(),
  };
}

function readRunnerContainerErrorDetails(error: unknown): HostedExecutionStructuredLogDetails | null {
  if (!(error instanceof Error) || !("details" in error)) {
    return null;
  }

  return sanitizeHostedExecutionStructuredLogDetails(
    (error as { details?: unknown }).details as HostedExecutionStructuredLogDetails | null | undefined,
  );
}

function buildRunnerContainerProcessingFailure(
  error: unknown,
): RunnerContainerProcessingFailure | null {
  const code = deriveHostedExecutionErrorCode(error);
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  const details = readRunnerContainerErrorDetails(error);
  const transportedCodeDetail = readHostedRunnerContainerSafeCode(
    details?.errorCodeDetail,
  );
  const explicitPhase =
    details?.[HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY];
  const runtimeFailurePhaseCode = isHostedRuntimeFailurePhaseCode(explicitPhase)
    ? explicitPhase
    : isHostedRuntimeFailurePhaseCode(transportedCodeDetail)
    ? transportedCodeDetail
    : null;
  if (code !== "runtime_error" || !runtimeFailurePhaseCode) {
    return null;
  }
  const errorCodeDetail = transportedCodeDetail
    && !isHostedRuntimeFailurePhaseCode(transportedCodeDetail)
    ? transportedCodeDetail
    : null;
  return {
    errorCodeDetail,
    runtimeFailurePhaseCode,
    status: readHostedRunnerContainerDiagnosticStatus(diagnostics),
  };
}

function createRunnerContainerProcessingFailureError(
  failure: RunnerContainerProcessingFailure,
): Error {
  const errorCodeDetail = readHostedRunnerContainerSafeCode(
    failure.errorCodeDetail,
  );
  const runtimeFailurePhaseCode = isHostedRuntimeFailurePhaseCode(
    failure.runtimeFailurePhaseCode,
  )
    ? failure.runtimeFailurePhaseCode
    : null;
  const status = typeof failure.status === "number"
    && Number.isInteger(failure.status)
    && failure.status >= 100
    && failure.status <= 599
    ? failure.status
    : null;
  const details = sanitizeHostedExecutionStructuredLogDetails({
    ...(errorCodeDetail
      ? { errorCodeDetail }
      : {}),
    ...(runtimeFailurePhaseCode
      ? {
          [HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY]:
            runtimeFailurePhaseCode,
        }
      : {}),
  });
  const message = joinHostedRunnerContainerErrorFragments([
    summarizeHostedExecutionErrorCode("runtime_error")
      ?? "Hosted execution runtime failed.",
    `Code: ${errorCodeDetail ?? "runtime_error"}`,
    ...(status === null ? [] : [`Status: ${status}`]),
  ]);
  const error = Object.assign(new Error(message), {
    code: "runtime_error",
    ...(details ? { details } : {}),
    ...(status === null
      ? {}
      : {
          status,
          statusCode: status,
        }),
  });
  return error;
}

function buildRunnerContainerEnvVars(): Record<string, string> {
  return {
    ...BASE_RUNNER_CONTAINER_ENV_VARS,
  };
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

function isMissingRunnerContainerError(error: unknown): boolean {
  const message = readErrorMessage(error);
  return message !== null && message.includes("No such container");
}

function isSettledRunnerContainerDestroyRaceError(error: unknown): boolean {
  return isMissingRunnerContainerError(error);
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
