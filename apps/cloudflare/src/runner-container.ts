import { Container, type StopParams } from "@cloudflare/containers";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
  summarizeHostedExecutionErrorCode,
  type HostedExecutionStructuredLogDetails,
  type HostedExecutionStructuredLogDetailValue,
} from "@murphai/hosted-execution";
import { methodNotAllowed } from "./json.ts";
import {
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "./runner-egress-intercept.ts";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "./hosted-runtime-architecture.ts";
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
import type {
  WorkerActiveRuntimeUserFenceResult,
} from "./worker-contracts.ts";

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_HEALTH_URL = "http://container/health";
const RUNNER_EXECUTE_URL = "http://container/internal/workspace-invocation";
const RUNNER_CODEX_SHELL_SMOKE_URL =
  "http://container/internal/deploy-codex-shell-smoke";
const RUNNER_DIRECT_R2_PRESIGNED_PUT_SMOKE_URL =
  "http://container/internal/direct-r2-presigned-put-smoke";
const RUNNER_RUNTIME_WAKE_URL = "http://container/internal/runtime-wake";
const RUNNER_WAIT_INTERVAL_MS = 250;
const RUNNER_STOPPED_REQUEST_SETTLE_MS = 1_000;
const RUNNER_DESTROY_SETTLE_TIMEOUT_MS = 5_000;
const DEFAULT_RUNNER_READY_TIMEOUT_MS = 20_000;
const DEFAULT_RUNNER_RUNTIME_WAKE_TIMEOUT_MS = 5_000;
const RUNNER_RECENT_READINESS_PROOF_MAX_AGE_MS = 5_000;
const RUNNER_METADATA_RESPONSE_BODY_MAX_BYTES = 64 * 1024;
const RUNNER_METADATA_RESPONSE_BODY_DRAIN_TIMEOUT_MS = 5_000;
const HOSTED_RUNNER_CONTAINER_SAFE_ERROR_MESSAGES = new Set([
  "Hosted bundle archive validation failed.",
  "Hosted execution authorization failed.",
  "Hosted execution configuration is invalid.",
  "Hosted execution rejected an invalid request.",
  "Hosted execution runtime failed.",
  "Hosted execution timed out.",
  "Invalid request.",
  "Request body too large.",
]);
const DEFAULT_RUNNER_IDLE_TTL_MS = 300_000;
const MIN_RUNNER_IDLE_TTL_MS = 1_000;
const DEFAULT_RUNNER_RECYCLE_AFTER_SUCCESS_COUNT = 25;
const RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 30_000;
const MIN_RUNNER_ACTIVITY_RENEW_INTERVAL_MS = 250;
const WORKSPACE_INVOCATION_PREEMPTED_ABORT_MESSAGE = "workspace invocation preempted";
const CLOUDFLARE_CONTAINERS_CA_CERT_PATH =
  "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

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

interface HostedExecutionContainerInvokeRequest {
  job: HostedExecutionRunnerJobInput;
  timeoutMs?: number | null;
  userId: string;
}

type HostedExecutionContainerInvokeInput = HostedExecutionContainerInvokeRequest;

export interface RunnerContainerEnsureReadyForProcessingInput {
  timeoutMs: number;
  userId: string;
}

export interface RunnerContainerEnsureReadyForProcessingResult {
  action?: "already_warm" | "started";
  kind: "ready";
}

interface HostedExecutionContainerRunnerInput {
  job: HostedExecutionRunnerJobInput;
  runnerContainerName?: string;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  signal?: AbortSignal;
  timeoutMs?: number | null;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  abortWorkspaceInvocation?(input: { attemptId: string; userId: string }): Promise<void>;
  destroyInstance(): Promise<void>;
  ensureReadyForProcessing?(
    input: RunnerContainerEnsureReadyForProcessingInput,
  ): Promise<RunnerContainerEnsureReadyForProcessingResult>;
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

type RunnerContainerEnvironmentSource = Readonly<Record<string, unknown>>;
type RunnerContainerNameSource = HostedRunnerContainerIdentitySource;

interface RunnerContainerLogContext {
  userId: string;
}

interface RunnerContainerReadinessProof {
  checkedAtMs: number;
  stopGeneration: number;
  userId: string;
}

type RunnerContainerStartObservation =
  | "cold-start-ready"
  | "deploy-smoke-ready"
  | "onStart";

type RunnerContainerDestroyReason =
  | "activity-expired"
  | "cold-start-failure"
  | "deploy-smoke-cleanup"
  | "deploy-smoke-recycle"
  | "destroy-instance"
  | "invoke-failure"
  | "readiness-failure"
  | "success-recycle"
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
}

interface RunnerActivityTimeoutRenewable {
  renewActivityTimeout(): void;
}

interface RunnerActiveOperationRecord {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
}

export interface RunnerRuntimeWakeInput {
  attemptId: string;
  leaseGeneration: string;
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

export type RunnerContainerEnsureProcessingResult =
  | {
      action: "already_running" | "restarted" | "started" | "woken";
      kind: "accepted";
      result?: HostedExecutionRunnerJobResult;
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
  envVars = {
    CODEX_CA_CERTIFICATE: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
    CURL_CA_BUNDLE: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
    NODE_EXTRA_CA_CERTS: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
    PORT: String(RUNNER_PORT),
    REQUESTS_CA_BUNDLE: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
    SSL_CERT_FILE: CLOUDFLARE_CONTAINERS_CA_CERT_PATH,
  };
  interceptHttps = true;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  sleepAfter = formatRunnerSleepAfter(readRunnerContainerIdleTtlMs({}));

  private readonly environment: RunnerContainerEnvironmentSource;
  private lifecycleLock: Promise<void> = Promise.resolve();
  private lifecycleLockPendingCount = 0;
  private containerStartedAtMs: number | null = null;
  private containerStartObservedBy: RunnerContainerStartObservation | null = null;
  private currentLogContext: RunnerContainerLogContext | null = null;
  private lastActivityExpiryAtMs: number | null = null;
  private lastActivityObservedAtMs: number | null = null;
  private lastActivityObservedStage: string | null = null;
  private lastDestroyRequest: RunnerContainerDestroyRequestRecord | null = null;
  private recentReadinessProof: RunnerContainerReadinessProof | null = null;
  private stopGeneration = 0;
  private stopObservers = new Set<() => void>();
  private successfulWarmInvocationCount = 0;
  private warmShellInvalidatedByUnsettledDestroy = false;
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

  async destroyInstance(): Promise<void> {
    this.workspaceInvocationAbortController?.abort(new Error("workspace invocation container destroyed"));
    await this.withLifecycleLock(async () => {
      await this.stopWarmContainer({
        reason: "destroy-instance",
      });
    });
  }

  async readActiveRuntimeUserFence(): Promise<WorkerActiveRuntimeUserFenceResult> {
    const active = this.workspaceInvocationActiveOperation;
    return active
      ? {
          active: true,
          attemptId: active.attemptId,
          leaseGeneration: active.leaseGeneration,
          userId: active.userId,
        }
      : { active: false, reason: "no_active_runtime" };
  }

  async ensureReadyForProcessing(
    payload: RunnerContainerEnsureReadyForProcessingInput,
  ): Promise<RunnerContainerEnsureReadyForProcessingResult> {
    const input = parseRunnerContainerEnsureReadyForProcessingInput(payload);
    return await this.withLifecycleLock(async () => {
      const logContext: RunnerContainerLogContext = {
        userId: input.userId,
      };
      this.currentLogContext = logContext;
      try {
        const action = await this.ensureContainerReady(
          input,
          AbortSignal.timeout(input.timeoutMs),
        );
        return { action, kind: "ready" };
      } finally {
        if (this.currentLogContext === logContext) {
          this.currentLogContext = null;
        }
      }
    });
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

  async ensureProcessing(input: RunnerContainerEnsureProcessingInput): Promise<RunnerContainerEnsureProcessingResult> {
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

    return {
      action: startAction,
      kind: "accepted",
      result: await this.invoke(input.invoke),
    };
  }

  async wakeRuntime(input: RunnerRuntimeWakeInput): Promise<RunnerRuntimeWakeResult> {
    const active = this.workspaceInvocationActiveOperation;
    if (
      !active
      || active.userId !== input.userId
      || active.attemptId !== input.attemptId
      || active.leaseGeneration !== input.leaseGeneration
    ) {
      return { kind: "not-wakeable", reason: "no-active-child" };
    }

    this.noteRunnerActivity("runtime-wake");
    try {
      const runtimeWakeSignal = AbortSignal.timeout(DEFAULT_RUNNER_RUNTIME_WAKE_TIMEOUT_MS);
      const response = await this.containerFetch(
        RUNNER_RUNTIME_WAKE_URL,
        {
          method: "POST",
          signal: runtimeWakeSignal,
        },
      );
      const accepted = response.headers.get("x-runtime-wake-accepted") === "1";
      const pending = response.headers.get("x-runtime-wake-pending") === "1";
      await drainRunnerContainerMetadataResponseBody(response, {
        signal: runtimeWakeSignal,
      });
      if (!response.ok || !accepted) {
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            runtimeWakeAccepted: accepted,
            runtimeWakeStatus: response.status,
            workspaceAttemptId: active.attemptId,
          },
          level: "warn",
          message: "Hosted execution container runtime wake was not accepted by the active child.",
          phase: "scheduled",
          userId: input.userId,
        });
      }
      if (response.ok && accepted) {
        return { action: pending ? "already_running" : "woken", kind: "accepted" };
      }
      return { kind: "unknown", reason: "active-child-rejected" };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          workspaceAttemptId: active.attemptId,
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

  async smokeHealth(input: HostedExecutionContainerSmokeHealthInput = {}): Promise<HostedExecutionContainerSmokeHealthResult> {
    return await this.withLifecycleLock(async () => {
      const readyTimeoutMs = readRunnerReadyTimeoutMs(this.environment);
      let smokeStartAttempted = false;

      try {
        const containerSettledForSmoke = await this.stopWarmContainer({
          failClosed: false,
          reason: "deploy-smoke-recycle",
        });
        if (!containerSettledForSmoke) {
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

        const codexShell = await this.smokeCodexShell(readyTimeoutMs);
        const directR2PresignedPut = input.directR2PresignedPut
          ? await this.smokeDirectR2PresignedPut(readyTimeoutMs, input.directR2PresignedPut)
          : undefined;

        return {
          codexShell,
          ...(directR2PresignedPut === undefined ? {} : { directR2PresignedPut }),
          ok: true,
          runnerBundle: parseRunnerContainerSmokeBundle(payload.runnerBundle),
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
    await this.withLifecycleLock(async () => {
      const activeOperation = this.workspaceInvocationActiveOperation;
      if (activeOperation) {
        this.lastActivityExpiryAtMs = Date.now();
        this.noteRunnerActivity("activity-expired-active-operation");
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
          < readRunnerContainerIdleTtlMs(this.environment)
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

      this.lastActivityExpiryAtMs = Date.now();
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
      await this.stopWarmContainer({
        failClosed: false,
        reason: "activity-expired",
      });
    });
  }

  override onStart(): void {
    this.recordContainerStartObserved("onStart");
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
      activeWorkspaceInvocationPresent: this.workspaceInvocationActiveOperation !== null,
      cleanExit,
      destroyRequestPresent: this.lastDestroyRequest !== null,
      idleTtlDeltaMs: readNullableNumber(lifecycleDetails.idleTtlDeltaMs),
    });
    this.stopGeneration += 1;
    this.clearRecentReadinessProof();
    this.successfulWarmInvocationCount = 0;
    this.warmShellInvalidatedByUnsettledDestroy = false;
    this.resolveStopObservers();
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        ...lifecycleDetails,
        exitCode: params.exitCode,
        lifecycleStage: "onStop",
        runnerPort: RUNNER_PORT,
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
    this.containerStartedAtMs = null;
    this.containerStartObservedBy = null;
    this.lastActivityExpiryAtMs = null;
    this.lastActivityObservedAtMs = null;
    this.lastActivityObservedStage = null;
    this.lastDestroyRequest = null;
  }

  override onError(error: unknown): never {
    const context = this.currentLogContext;
    this.clearRecentReadinessProof();
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        activeWorkspaceInvocationPresent: this.workspaceInvocationActiveOperation !== null,
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
  ): Promise<HostedExecutionRunnerJobResult> {
    // Dispatch latency stamps (epoch ms, this DO's clock). Sent as headers on
    // the runner POST so the latency trace can split DO dispatch work from
    // Cloudflare container scheduling inside the temporal->runner-accept gap.
    const dispatchInvokeReceivedAtEpochMs = Date.now();
    const routeUserId = readHostedExecutionRunnerJobUserId(input.job);
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
    let activeOperationAcquired = false;
    let cleanupWarmContainerOnFailure = false;
    let stopRunnerActivityRenewal: (() => void) | null = null;
    this.workspaceInvocationAbortController = operationAbortController;
    this.workspaceInvocationActiveOperation = activeOperation;

    try {
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
          if (!completedSuccessfully) {
            await this.stopWarmContainer({
              failClosed: true,
              reason: "invoke-failure",
            });
          } else if (this.recordSuccessfulWarmInvocationShouldRecycle()) {
            emitHostedExecutionStructuredLog({
              component: "container",
              details: {
                recycleAfterSuccessCount:
                  readRunnerContainerRecycleAfterSuccessCount(this.environment),
                successfulWarmInvocationCount: this.successfulWarmInvocationCount,
              },
              message: "Hosted execution container reached warm success recycle limit.",
              phase: "container.ready",
              userId: routeUserId,
            });
            await this.stopWarmContainer({
              failClosed: true,
              reason: "success-recycle",
            });
          }
        } else if (cleanupWarmContainerOnFailure) {
          await this.stopWarmContainer({
            failClosed: true,
            reason: "readiness-failure",
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

  private async ensureContainerReady(
    input: Pick<HostedExecutionContainerInvokeInput, "timeoutMs" | "userId">,
    operationAbortSignal: AbortSignal,
  ): Promise<"already_warm" | "started"> {
    const readinessStartedAt = Date.now();
    const status = readContainerStatus(await this.getState());
    const readyTimeoutMs = readRunnerReadyTimeoutMs(this.environment);
    const readinessBudgetMs = input.timeoutMs ?? readyTimeoutMs;
    throwIfRunnerContainerOperationAborted(operationAbortSignal);

    if (isRunnerContainerStopped(status)) {
      this.clearRecentReadinessProof();
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
      await this.stopWarmContainer({
        failClosed: true,
        reason: "warm-invalidated",
      });
    } else if (!isRunnerContainerStopped(status)) {
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
          operationAbortSignal,
        );
        this.recordRecentReadinessProof(input.userId);
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
        await this.stopWarmContainer({
          reason: "warm-health-failed",
        });
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
      await assertRunnerHealthy(this, readinessTimeoutMs, operationAbortSignal);
      this.recordRecentReadinessProof(input.userId);
      this.recordContainerStartObserved("cold-start-ready");
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
      await this.stopWarmContainer({
        failClosed: false,
        reason: "cold-start-failure",
      }).catch(() => undefined);
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

  private async ensureSmokeContainerReady(
    timeoutMs: number,
    options: {
      forceColdStart?: boolean;
    } = {},
  ): Promise<void> {
    if (!options.forceColdStart) {
      const status = readContainerStatus(await this.getState());
      if (!isRunnerContainerStopped(status)) {
        await assertRunnerHealthy(this, timeoutMs);
        return;
      }
    }

    await this.startAndWaitForPorts({
      cancellationOptions: {
        abort: AbortSignal.timeout(timeoutMs),
        instanceGetTimeoutMS: timeoutMs,
        portReadyTimeoutMS: timeoutMs,
        waitInterval: RUNNER_WAIT_INTERVAL_MS,
      },
    });
    this.recordContainerStartObserved("deploy-smoke-ready");
  }

  private async destroyIfRunning(input: {
    failClosed?: boolean;
    reason: RunnerContainerDestroyReason;
  }): Promise<boolean> {
    const failClosed = Boolean(input.failClosed);
    const context = this.currentLogContext;
    let statusBeforeDestroy: string | null = null;

    try {
      statusBeforeDestroy = await readRunnerContainerStatusWithTimeout(
        this,
        RUNNER_DESTROY_SETTLE_TIMEOUT_MS,
      );
      if (isRunnerContainerStopped(statusBeforeDestroy)) {
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

    const destroyRequest = this.destroy().then(
      () => ({ kind: "destroy-resolved" as const }),
      (error: unknown) => ({ error, kind: "destroy-rejected" as const }),
    );
    const destroySettle = this.waitForDestroyedContainerStopped({
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
  }

  private async waitForDestroyedContainerStopped(input: {
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
    const deadlineMs = Date.now() + RUNNER_DESTROY_SETTLE_TIMEOUT_MS;
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

      let remainingMs = deadlineMs - Date.now();
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
        if (isRunnerContainerStopped(statusAfterDestroy)) {
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

      remainingMs = deadlineMs - Date.now();
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
    failClosed?: boolean;
    reason?: RunnerContainerDestroyReason;
  }): Promise<boolean> {
    this.clearRecentReadinessProof();
    const failClosed = input?.failClosed ?? true;
    const reason = input?.reason ?? "destroy-instance";
    let destroyed: boolean;
    try {
      destroyed = await this.destroyIfRunning({ failClosed, reason });
    } catch (error) {
      this.successfulWarmInvocationCount = 0;
      this.warmShellInvalidatedByUnsettledDestroy = true;
      throw error;
    }
    if (destroyed) {
      this.successfulWarmInvocationCount = 0;
      this.warmShellInvalidatedByUnsettledDestroy = false;
    } else {
      this.successfulWarmInvocationCount = 0;
      this.warmShellInvalidatedByUnsettledDestroy = true;
    }
    return destroyed;
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

  private recordSuccessfulWarmInvocationShouldRecycle(): boolean {
    this.successfulWarmInvocationCount += 1;
    return this.successfulWarmInvocationCount
      >= readRunnerContainerRecycleAfterSuccessCount(this.environment);
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

  private recordContainerStartObserved(observedBy: RunnerContainerStartObservation): void {
    if (this.containerStartedAtMs === null) {
      this.containerStartedAtMs = Date.now();
      this.containerStartObservedBy = observedBy;
    }
    this.recordContainerActivityObserved(observedBy);
    this.lastActivityExpiryAtMs = null;
    this.lastDestroyRequest = null;
  }

  private recordContainerActivityObserved(stage: string): void {
    this.lastActivityObservedAtMs = Date.now();
    this.lastActivityObservedStage = stage;
  }

  private buildLifecycleDiagnosticDetails(): HostedExecutionStructuredLogDetails {
    const nowMs = Date.now();
    const runnerIdleTtlMs = readRunnerContainerIdleTtlMs(this.environment);
    const containerUptimeMs = readElapsedMs(this.containerStartedAtMs, nowMs);
    const destroyRequestAgeMs = readElapsedMs(this.lastDestroyRequest?.requestedAtMs ?? null, nowMs);
    const lastActivityExpiryAgeMs = readElapsedMs(this.lastActivityExpiryAtMs, nowMs);
    const lastActivityObservedAgeMs = readElapsedMs(this.lastActivityObservedAtMs, nowMs);

    return {
      activeWorkspaceInvocationPresent: this.workspaceInvocationActiveOperation !== null,
      containerStartObservedBy: this.containerStartObservedBy,
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
      successfulWarmInvocationCount: this.successfulWarmInvocationCount,
      warmShellInvalidatedByUnsettledDestroy: this.warmShellInvalidatedByUnsettledDestroy,
    };
  }

  private async withLifecycleLock<T>(work: () => Promise<T>): Promise<T> {
    this.lifecycleLockPendingCount += 1;
    const run = async (): Promise<T> => {
      try {
        return await work();
      } finally {
        this.lifecycleLockPendingCount -= 1;
      }
    };
    const next = this.lifecycleLock.then(run, run);
    this.lifecycleLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
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

export class DeploySmokeRunnerContainer extends RunnerContainer {}

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

  const ensured = await container.ensureProcessing({
    invoke: invokeRequest,
    userId: invokeRequest.userId,
  });
  if (ensured.kind === "accepted" && ensured.result) {
    return ensured.result;
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

function parseRunnerContainerEnsureReadyForProcessingInput(
  payload: RunnerContainerEnsureReadyForProcessingInput,
): RunnerContainerEnsureReadyForProcessingInput {
  return {
    timeoutMs: readTimeoutMs(payload.timeoutMs, DEFAULT_RUNNER_READY_TIMEOUT_MS),
    userId: requireString(payload.userId, "payload.userId"),
  };
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
  if (payload.poisoned === true) {
    throw new HostedRunnerContainerPoisonedError({
      lastCleanupStatus: typeof payload.lastCleanupStatus === "string"
        ? payload.lastCleanupStatus
        : null,
    });
  }
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

function readRunnerContainerRecycleAfterSuccessCount(
  source: RunnerContainerEnvironmentSource,
): number {
  const raw = source.HOSTED_EXECUTION_RUNNER_RECYCLE_AFTER_SUCCESS_COUNT;

  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RUNNER_RECYCLE_AFTER_SUCCESS_COUNT;
  }

  if (typeof raw !== "string") {
    throw new TypeError(
      "HOSTED_EXECUTION_RUNNER_RECYCLE_AFTER_SUCCESS_COUNT must be a string when configured.",
    );
  }

  const parsed = readStrictPositiveIntegerEnv(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(
      "HOSTED_EXECUTION_RUNNER_RECYCLE_AFTER_SUCCESS_COUNT must be a positive integer.",
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
