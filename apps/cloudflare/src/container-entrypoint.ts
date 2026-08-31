import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  summarizeHostedExecutionError,
  summarizeHostedExecutionErrorCode,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  stopWarmCodexAppServer,
  waitForWarmCodexBackgroundWork,
} from "@murphai/assistant-engine/codex-lifecycle";
import {
  HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY,
  readHostedRuntimeFailurePhaseCode,
  type HostedWorkspaceInvocationProcessingMode,
} from "@murphai/hosted-execution/runtime-control";
import {
  startHostedContainerCpuWatchdog,
  type HostedContainerCpuWatchdogProcessApi,
} from "./container-cpu-watchdog.ts";
import {
  HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS,
  reportHostedContainerFatalBestEffort,
  type HostedContainerFatalStage,
} from "./container-fatal-report.ts";
import type {
  HostedContainerHeavyRuntime,
  HostedContainerHeavyRuntimeCore,
} from "./container-entrypoint-heavy-runtime.ts";
import type {
  HostedWorkspaceRestorePreparation,
} from "@murphai/assistant-runtime/hosted-workspace-restore-preparation";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "./hosted-runtime-architecture.ts";
import {
  HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
} from "./runner-container-error-codes.ts";
import {
  parseHostedExecutionRunnerJobInput,
  type HostedExecutionRunnerJobInput,
} from "./runner-job-transport.ts";
import {
  readHostedRuntimeOrchestrationLatencyHeaders,
  sanitizeHostedRuntimeOrchestrationLatencyDiagnostics,
  type HostedRuntimeOrchestrationLatencyDiagnostics,
} from "./orchestration-latency-diagnostics.ts";

// Module-evaluation timestamp approximates process start; subtracting the
// elapsed process uptime recovers the true process-start wall clock so the
// node-startup span includes any pre-module-evaluation runtime. Pure in-memory,
// computed once at port-listen and only attached to the first (cold) invocation.
const HOSTED_CONTAINER_PROCESS_START_MS = Date.now() - Math.round(process.uptime() * 1000);

const HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const HOSTED_CONTAINER_RUNTIME_WAKE_REQUEST_BODY_LIMIT_BYTES = 16 * 1024;
const HOSTED_CONTAINER_ACTIVE_DIAGNOSTIC_INTERVAL_MS = 15_000;
const HOSTED_CONTAINER_CODEX_SHELL_SMOKE_PATH =
  "/internal/deploy-codex-shell-smoke";
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_SMOKE_PATH =
  "/internal/direct-r2-presigned-put-smoke";
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_PATH =
  "/internal/deploy-live-model-turn-smoke";
const HOSTED_CONTAINER_WORKSPACE_INVOCATION_ABORT_PATH =
  "/internal/workspace-invocation/abort";
const HOSTED_CONTAINER_RUNTIME_WAKE_PATH = "/internal/runtime-wake";
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_DEFAULT_BYTES = 150 * 1024 * 1024;
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_MAX_BYTES = 512 * 1024 * 1024;
const HOSTED_CONTAINER_SHUTDOWN_POST_SAFE_POINT_DRAIN_TIMEOUT_MS = 5_000;

interface HostedContainerProcessApi {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
}

// readdir is only part of the CPU watchdog's file-system surface; the
// entrypoint itself reads files but never scans directories.
const defaultHostedContainerProcessApi: HostedContainerProcessApi &
  HostedContainerCpuWatchdogProcessApi = {
  async readFile(path, encoding) {
    return await readFile(path, encoding);
  },
  async readlink(path) {
    return await readlink(path);
  },
  async readdir(path) {
    return await readdir(path, { encoding: "utf8", withFileTypes: true });
  },
};

const defaultHostedContainerExitScheduler = () => {
  process.exitCode = 1;
  setImmediate(() => {
    process.exit(1);
  });
};

// Set by the process-fatal handlers before their bounded fatal report runs.
// Module-level (not invocation closure state) so the request handler can
// reject new invocations during the short pre-exit window: a process Node
// deems unrecoverable must not accept work it would hard-kill mid-flight.
let hostedContainerProcessFatalObserved = false;
let hostedContainerFatalRuntimeDrain: (() => Promise<void>) | null = null;

interface HostedContainerStartupConfig {
  appRoot: string;
  hostedRuntimeArchitectureVersion: typeof HOSTED_RUNTIME_ARCHITECTURE_VERSION;
  runnerBundleManifestPath: string;
  supervisorEnv: Readonly<Record<string, string | undefined>>;
}

interface HostedContainerRuntimeOptions {
  exitScheduler?: () => void;
  loadHeavyRuntime?: () => Promise<HostedContainerHeavyRuntimeCore>;
  parseRunnerJobInput?: typeof parseHostedExecutionRunnerJobInput;
  prepareWorkspaceRestore?: (input: {
    job: HostedExecutionRunnerJobInput;
    signal: AbortSignal;
  }) => Promise<HostedWorkspaceRestorePreparation>;
  processApi?: Partial<HostedContainerProcessApi>;
  runWorkspaceInvocation?: HostedContainerHeavyRuntime["runWorkspaceInvocation"];
  runDirectR2PresignedPutSmoke?: HostedContainerHeavyRuntime["runDirectR2PresignedPutSmoke"];
  runCodexShellSmoke?: HostedContainerHeavyRuntime["runCodexShellSmoke"];
  runLiveModelTurnSmoke?: HostedContainerHeavyRuntime["runLiveModelTurnSmoke"];
  shutdownDrainTimeoutMs?: number;
  stopWarmCodex?: HostedContainerHeavyRuntime["stopWarmCodex"];
  waitForBackgroundAssistantWork?: HostedContainerHeavyRuntime["waitForBackgroundAssistantWork"];
}

interface HostedContainerRuntimeDependencies {
  exitScheduler: () => void;
  loadHeavyRuntime: () => Promise<HostedContainerHeavyRuntime>;
  parseRunnerJobInput: typeof parseHostedExecutionRunnerJobInput;
  prepareWorkspaceRestore: NonNullable<
    HostedContainerRuntimeOptions["prepareWorkspaceRestore"]
  >;
  processApi: HostedContainerProcessApi;
  shutdownDrainTimeoutMs: number;
  startupConfig: HostedContainerStartupConfig;
}

interface HostedContainerDirectR2PresignedPutSmokeRequest {
  byteLength: number;
  presignedPutUrl: string;
  tlsCaCertificatePem?: string;
}

interface HostedContainerWorkspaceInvocationAbortRequest {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
}

interface HostedRunnerBundleManifestSummary {
  buildSkipped?: boolean;
  bundleFingerprint?: string;
  generatedAt?: string;
  releaseSha?: string;
  schemaVersion?: number;
  sourceFingerprint?: string;
}

type HostedAbortEventListener = (...args: unknown[]) => void;

interface HostedAbortEmitterLike {
  off(eventName: string | symbol, listener: HostedAbortEventListener): unknown;
  once(eventName: string | symbol, listener: HostedAbortEventListener): unknown;
}

type HostedAbortRequestLike = HostedAbortEmitterLike;
type HostedAbortResponseLike = HostedAbortEmitterLike & {
  writableEnded: boolean;
};

class HostedContainerRequestBodyTooLargeError extends RangeError {
  constructor(limitBytes: number) {
    super(`Hosted container runner request body exceeds ${limitBytes} bytes.`);
    this.name = "HostedContainerRequestBodyTooLargeError";
  }
}

class HostedContainerArchitectureVersionMismatchError extends Error {
  readonly actualVersion: string | null;
  readonly expectedVersion: string;

  constructor(input: { actualVersion: string | null; expectedVersion: string }) {
    super("Hosted container runtime architecture version mismatch.");
    this.name = "HostedContainerArchitectureVersionMismatchError";
    this.actualVersion = input.actualVersion;
    this.expectedVersion = input.expectedVersion;
  }
}

interface HostedContainerRuntimeWakeRequest {
  attemptId: string;
  leaseGeneration: string;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  requestedProcessingMode?: HostedWorkspaceInvocationProcessingMode | null;
  userId: string;
}

type HostedContainerRuntimeWakeNotification = {
  notifiedAtEpochMs?: number | null;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  requestedProcessingMode?: HostedWorkspaceInvocationProcessingMode | null;
};

export async function startHostedContainerEntrypoint(input: {
  port?: number;
  runtime?: HostedContainerRuntimeOptions;
}): Promise<ReturnType<typeof createServer>> {
  const runtime = resolveHostedContainerRuntimeDependencies(input.runtime);
  const runnerBundle = await readHostedRunnerBundleManifestSummary(
    runtime.processApi,
    runtime.startupConfig.runnerBundleManifestPath,
  );
  const cloudflareRegion =
    runtime.startupConfig.supervisorEnv.CLOUDFLARE_REGION ?? null;
  const hostedWorkerReleaseId =
    runtime.startupConfig.supervisorEnv.HOSTED_EXECUTION_WORKER_RELEASE_ID ?? null;
  let containerTerminalExitScheduled = false;
  let hostedContainerTerminalFailureHandled = false;
  const poisonHostedContainerAndScheduleExitOnce = (
    error: unknown,
    message: string,
  ): void => {
    hostedContainerProcessFatalObserved = true;
    if (hostedContainerTerminalFailureHandled) {
      return;
    }
    hostedContainerTerminalFailureHandled = true;
    emitHostedExecutionStructuredLog({
      component: "container",
      error,
      level: "error",
      message,
      phase: "failed",
    });
    if (containerTerminalExitScheduled) {
      return;
    }
    containerTerminalExitScheduled = true;
    runtime.exitScheduler();
  };
  let heavyRuntimeHydrationPromise: Promise<HostedContainerHeavyRuntime> | null = null;
  let heavyRuntimeHydrationCompletedAtEpochMs: number | null = null;
  let heavyRuntimeHydrationStatus: "failed" | "pending" | "ready" = "pending";
  let codexShellPreflightCompletedAtEpochMs: number | null = null;
  let codexShellPreflightStatus: "failed" | "pending" | "ready" | "running" = "pending";
  const hydrateHeavyRuntime = (): Promise<HostedContainerHeavyRuntime> => {
    if (!heavyRuntimeHydrationPromise) {
      heavyRuntimeHydrationPromise = runtime.loadHeavyRuntime().then((heavyRuntime) => {
        heavyRuntimeHydrationCompletedAtEpochMs = Date.now();
        heavyRuntimeHydrationStatus = "ready";
        return heavyRuntime;
      });
      void heavyRuntimeHydrationPromise.catch((error) => {
        heavyRuntimeHydrationStatus = "failed";
        poisonHostedContainerAndScheduleExitOnce(
          error,
          "Hosted container entrypoint failed to hydrate the heavy runtime.",
        );
      });
    }
    return heavyRuntimeHydrationPromise;
  };
  const fatalRuntimeDrainOwner = async (): Promise<void> => {
    const heavyRuntime = await hydrateHeavyRuntime();
    await heavyRuntime.drainFatalRuntimeBestEffort({
      timeoutMs: HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS,
    });
  };
  let activeHostedRunnerJobCount = 0;
  let workspaceInvocationAcceptedCount = 0;
  let conversationWarmActivityCompletedAtEpochMs: number | null = null;
  let activeRuntimeWake: ((notification?: HostedContainerRuntimeWakeNotification) => boolean) | null = null;
  let activeRuntimeWakeAttemptId: string | null = null;
  let activeRuntimeWakeLeaseGeneration: string | null = null;
  let activeRuntimeWakeUserId: string | null = null;
  let activeRuntimeWakePending = false;
  let activeRuntimeWakePendingAttemptId: string | null = null;
  let activeRuntimeWakePendingLeaseGeneration: string | null = null;
  let activeRuntimeWakePendingNotifiedAtEpochMs: number | null = null;
  let activeRuntimeWakePendingOrchestration: HostedRuntimeOrchestrationLatencyDiagnostics | null = null;
  let activeRuntimeWakePendingRequestedProcessingMode:
    HostedWorkspaceInvocationProcessingMode | null = null;
  let activeRuntimeWakePendingUserId: string | null = null;
  let activeWorkspaceInvocationAbort: {
    abort: (reason: Error) => void;
    attemptId: string | null;
    leaseGeneration: string | null;
    userId: string;
  } | null = null;
  let pendingWorkspaceInvocationAbort: HostedContainerWorkspaceInvocationAbortRequest | null = null;
  // Node startup span (process start -> ready to accept). Computed once after the
  // port is listening and consumed by the FIRST (cold) invocation only; a warm
  // process predates its message so its startup is not attributable to that turn.
  let pendingColdNodeStartupMs: number | null = null;
  let serverListeningAtEpochMs: number | null = null;
  // During gradual deploys, active grace delays eligibility for rollout
  // replacement. Cloudflare then sends SIGTERM and allows up to 15 minutes
  // before SIGKILL.
  // Shutdown contract: finish the in-flight invocation (which checkpoints
  // immediately via the shutdown signal), then exit 0. New work arriving after
  // exit fails over to a replacement container through the platform's normal
  // container-stopped retry path.
  const containerShutdownController = new AbortController();
  const server = createServer(async (request, response) => {
    response.setHeader("connection", "close");
    const requestAbort = createRequestAbortController(request, response);
    // Once a workspace job is accepted, HTTP transport state is no longer the
    // owner of invocation lifetime. A closed caller connection means the caller
    // may miss the result; explicit aborts arrive through the internal abort
    // endpoint below.
    const invocationAbort = new AbortController();
    let claimedRunnerSlot = false;
    let conversationActivityObservedForInvocation = false;
    let conversationActivitySettled = false;
    let workspaceRestorePreparation: Promise<HostedWorkspaceRestorePreparation> | null = null;
    let runtimeWakeForRequest: ((notification?: HostedContainerRuntimeWakeNotification) => boolean) | null = null;
    let job: HostedExecutionRunnerJobInput | null = null;
    let stopActiveJobDiagnostics: (() => void) | null = null;
    let activeAbortRecord: {
      abort: (reason: Error) => void;
      attemptId: string | null;
      leaseGeneration: string | null;
      userId: string;
    } | null = null;
    const settleConversationActivity = () => {
      if (conversationActivitySettled) {
        return;
      }
      conversationActivitySettled = true;
      if (conversationActivityObservedForInvocation) {
        conversationWarmActivityCompletedAtEpochMs = Date.now();
      }
    };

    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
          activeJobCount: activeHostedRunnerJobCount,
          codexShellPreflightCompletedAtEpochMs,
          codexShellPreflightStatus,
          cloudflareRegion,
          conversationWarmActivityCompletedAtEpochMs,
          heavyRuntimeHydrationCompletedAtEpochMs,
          heavyRuntimeHydrationStatus,
          hostedRuntimeArchitectureVersion:
            runtime.startupConfig.hostedRuntimeArchitectureVersion,
          hostedWorkerReleaseId,
          ok: true,
          poisoned: hostedContainerProcessFatalObserved,
          processStartedAtEpochMs: HOSTED_CONTAINER_PROCESS_START_MS,
          service: "cloudflare-hosted-runner-node",
          ...(serverListeningAtEpochMs === null ? {} : {
            serverListeningAtEpochMs,
          }),
          ...(runnerBundle ? { runnerBundle } : {}),
          workspaceInvocationAcceptedCount,
        }));
        return;
      }

      if (hostedContainerProcessFatalObserved) {
        discardUnreadRequestBody(request);
        emitHostedExecutionStructuredLog({
          component: "container",
          level: "warn",
          message: "Hosted container entrypoint rejected an invocation after the container was poisoned.",
          phase: "failed",
        });
        writeJsonResponse(response, 503, {
          error: "Hosted runner container is poisoned.",
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === HOSTED_CONTAINER_RUNTIME_WAKE_PATH) {
        const rejectRuntimeWakeAfterShutdown = (): boolean => {
          if (!containerShutdownController.signal.aborted) {
            return false;
          }

          const advertiseAbsent =
            activeHostedRunnerJobCount === 0
            && activeRuntimeWake === null
            && !activeRuntimeWakePending
            && activeRuntimeWakePendingAttemptId === null
            && activeWorkspaceInvocationAbort === null;
          discardUnreadRequestBody(request);
          emitHostedExecutionStructuredLog({
            component: "container",
            details: {
              activeHostedRunnerJobCount,
              runtimeWakeAbsent: advertiseAbsent,
              workspaceAttemptId: activeRuntimeWakeAttemptId,
              workspacePendingAttemptId: activeRuntimeWakePendingAttemptId,
            },
            level: "warn",
            message: "Hosted container entrypoint rejected a runtime wake after shutdown started.",
            phase: "failed",
          });
          response.setHeader("x-runtime-wake-accepted", "0");
          if (advertiseAbsent) {
            response.setHeader("x-runtime-wake-absent", "1");
          }
          response.statusCode = 204;
          response.end();
          return true;
        };

        if (rejectRuntimeWakeAfterShutdown()) {
          return;
        }

        let wakeRequest: HostedContainerRuntimeWakeRequest | null;
        try {
          wakeRequest = await readHostedContainerRuntimeWakeRequest(request);
        } catch (error) {
          emitHostedExecutionStructuredLog({
            component: "container",
            error,
            level: "warn",
            message: "Hosted container entrypoint rejected the runtime wake request body.",
            phase: "failed",
          });
          const classified = classifyRequestDecodeError(error);
          writeJsonResponse(response, classified.statusCode, classified.payload);
          return;
        }
        if (rejectRuntimeWakeAfterShutdown()) {
          return;
        }
        const wake = activeRuntimeWake;
        const notifiedAtEpochMs = Date.now();
        let absent = false;
        let mismatch = false;
        let pending = false;
        let accepted = false;
        const acceptedWakeOrchestration = wakeRequest?.orchestration
          ? {
              ...wakeRequest.orchestration,
              activeWakeAccepted: true,
              activeWakeFinishedAtEpochMs: notifiedAtEpochMs,
            }
          : null;
        if (wakeRequest && wake !== null) {
          mismatch = !hostedContainerRuntimeWakeIdentityMatches(wakeRequest, {
            attemptId: activeRuntimeWakeAttemptId,
            leaseGeneration: activeRuntimeWakeLeaseGeneration,
            userId: activeRuntimeWakeUserId,
          });
          accepted = !mismatch && wake({
            ...(acceptedWakeOrchestration ? { orchestration: acceptedWakeOrchestration } : {}),
            notifiedAtEpochMs,
            ...(wakeRequest.requestedProcessingMode
              ? { requestedProcessingMode: wakeRequest.requestedProcessingMode }
              : {}),
          }) === true;
        } else if (!wakeRequest) {
          accepted = wake?.({ notifiedAtEpochMs }) === true;
        }
        if (
          !accepted
          && !mismatch
          && wake === null
          && activeRuntimeWakePendingAttemptId !== null
        ) {
          if (
            wakeRequest
            && !hostedContainerRuntimeWakeIdentityMatches(wakeRequest, {
              attemptId: activeRuntimeWakePendingAttemptId,
              leaseGeneration: activeRuntimeWakePendingLeaseGeneration,
              userId: activeRuntimeWakePendingUserId,
            })
          ) {
            mismatch = true;
          } else {
            if (!activeRuntimeWakePending) {
              activeRuntimeWakePendingNotifiedAtEpochMs = notifiedAtEpochMs;
              activeRuntimeWakePendingOrchestration = acceptedWakeOrchestration;
            } else if (!activeRuntimeWakePendingOrchestration && acceptedWakeOrchestration) {
              activeRuntimeWakePendingOrchestration = acceptedWakeOrchestration;
            }
            activeRuntimeWakePendingRequestedProcessingMode =
              wakeRequest?.requestedProcessingMode
              ?? activeRuntimeWakePendingRequestedProcessingMode;
            activeRuntimeWakePending = true;
            pending = true;
            accepted = true;
          }
        } else if (!accepted && !mismatch && wakeRequest && wake === null) {
          absent = activeRuntimeWakePendingAttemptId === null;
        }
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            activeHostedRunnerJobCount,
            activeRuntimeWakePending,
            activeRuntimeWakePresent: wake !== null,
            runtimeWakeAccepted: accepted,
            runtimeWakeAbsent: absent,
            runtimeWakeMismatch: mismatch,
            runtimeWakePending: pending,
            workspaceAttemptId: activeRuntimeWakeAttemptId,
            workspacePendingAttemptId: activeRuntimeWakePendingAttemptId,
          },
          message: "Hosted container entrypoint handled runtime wake request.",
          phase: "wake.running",
          userId: null,
        });
        if (accepted) {
          response.setHeader("x-runtime-wake-accepted", "1");
        } else {
          response.setHeader("x-runtime-wake-accepted", "0");
        }
        if (wakeRequest && accepted && !mismatch) {
          response.setHeader("x-runtime-wake-identity-checked", "1");
        }
        if (pending) {
          response.setHeader("x-runtime-wake-pending", "1");
        }
        if (absent) {
          response.setHeader("x-runtime-wake-absent", "1");
        }
        if (mismatch) {
          response.setHeader("x-runtime-wake-mismatch", "1");
        }
        response.statusCode = 204;
        response.end();
        return;
      }

      const isCodexShellSmokeRequest =
        request.method === "POST" && requestUrl.pathname === HOSTED_CONTAINER_CODEX_SHELL_SMOKE_PATH;
      const isLiveModelTurnSmokeRequest =
        request.method === "POST"
        && requestUrl.pathname === HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_PATH;
      const isDirectR2PresignedPutSmokeRequest =
        request.method === "POST"
        && requestUrl.pathname === HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_SMOKE_PATH;
      const isWorkspaceInvocationRequest =
        request.method === "POST" && requestUrl.pathname === "/internal/workspace-invocation";
      const isWorkspaceInvocationAbortRequest =
        request.method === "POST"
        && requestUrl.pathname === HOSTED_CONTAINER_WORKSPACE_INVOCATION_ABORT_PATH;

      if (
        !isWorkspaceInvocationRequest
        && !isWorkspaceInvocationAbortRequest
        && !isCodexShellSmokeRequest
        && !isLiveModelTurnSmokeRequest
        && !isDirectR2PresignedPutSmokeRequest
      ) {
        discardUnreadRequestBody(request);
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      if (isWorkspaceInvocationAbortRequest) {
        let abortRequest: HostedContainerWorkspaceInvocationAbortRequest;
        try {
          abortRequest = parseHostedContainerWorkspaceInvocationAbortRequest(
            JSON.parse(await readHostedContainerInvocationRequestBody(request)),
          );
        } catch (error) {
          emitHostedExecutionStructuredLog({
            component: "container",
            error,
            level: "warn",
            message: "Hosted container entrypoint rejected the workspace invocation abort request body.",
            phase: "failed",
          });
          const classified = classifyRequestDecodeError(error);
          writeJsonResponse(response, classified.statusCode, classified.payload);
          return;
        }

        const activeAbort = activeWorkspaceInvocationAbort;
        const accepted = activeAbort !== null
          && activeAbort.attemptId === abortRequest.attemptId
          && activeAbort.leaseGeneration === abortRequest.leaseGeneration
          && activeAbort.userId === abortRequest.userId;
        if (accepted) {
          activeAbort.abort(new Error("workspace invocation preempted"));
        } else if (activeAbort === null) {
          pendingWorkspaceInvocationAbort = abortRequest;
        }
        const queued = !accepted && activeAbort === null;
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            abortAccepted: accepted,
            abortQueued: queued,
            workspaceAttemptId: abortRequest.attemptId,
            workspaceLeaseGeneration: abortRequest.leaseGeneration,
          },
          level: accepted || queued ? "info" : "warn",
          message: accepted
            ? "Hosted container entrypoint accepted workspace invocation abort."
            : queued
              ? "Hosted container entrypoint queued workspace invocation abort."
              : "Hosted container entrypoint ignored stale workspace invocation abort.",
          phase: accepted || queued ? "wake.running" : "failed",
          userId: abortRequest.userId,
        });
        response.statusCode = 204;
        response.setHeader(
          "x-workspace-invocation-abort-status",
          accepted ? "accepted" : queued ? "queued" : "stale",
        );
        response.end();
        return;
      }

      if (containerShutdownController.signal.aborted) {
        discardUnreadRequestBody(request);
        emitHostedExecutionStructuredLog({
          component: "container",
          level: "warn",
          message: "Hosted container entrypoint rejected a runner request after shutdown started.",
          phase: "failed",
        });
        writeJsonResponse(response, 503, {
          code: HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
          error: "Hosted runner is shutting down.",
        });
        return;
      }

      if (isCodexShellSmokeRequest) {
        if (activeHostedRunnerJobCount > 0) {
          discardUnreadRequestBody(request);
          writeJsonResponse(response, 409, {
            error: "Hosted runner is busy.",
          });
          return;
        }
        activeHostedRunnerJobCount += 1;
        claimedRunnerSlot = true;
        codexShellPreflightStatus = "running";
        discardUnreadRequestBody(request);
        let heavyRuntime: HostedContainerHeavyRuntime | null = null;
        try {
          heavyRuntime = await hydrateHeavyRuntime();
          const result = await heavyRuntime.runCodexShellSmoke({
            signal: requestAbort.signal,
          });
          codexShellPreflightCompletedAtEpochMs = Date.now();
          codexShellPreflightStatus = "ready";
          writeJsonResponse(response, 200, {
            codexShell: result,
            ok: true,
          });
        } catch (error) {
          codexShellPreflightStatus = "failed";
          emitHostedExecutionStructuredLog({
            component: "container",
            error,
            level: "error",
            message: "Hosted container entrypoint failed the Codex shell smoke.",
            phase: "failed",
            userId: null,
          });
          if (requestAbort.signal.aborted || response.destroyed) {
            return;
          }
          // Deploy-smoke diagnostics are locally constructed and content-free
          // (labels, byte counts, proof counts), so surface the message
          // instead of the redacted generic error; otherwise smoke failures
          // are undebuggable from CI logs.
          writeJsonResponse(response, 500, {
            error: "Hosted Codex shell smoke failed.",
            ok: false,
            smokeErrorMessage: heavyRuntime
              ? error instanceof Error
                ? error.message
                : String(error)
              : "Hosted Codex shell smoke failed before runtime hydration.",
          });
        }
        return;
      }

      if (isLiveModelTurnSmokeRequest) {
        if (activeHostedRunnerJobCount > 0) {
          discardUnreadRequestBody(request);
          writeJsonResponse(response, 409, {
            error: "Hosted runner is busy.",
          });
          return;
        }
        activeHostedRunnerJobCount += 1;
        claimedRunnerSlot = true;
        discardUnreadRequestBody(request);
        let heavyRuntime: HostedContainerHeavyRuntime | null = null;
        try {
          heavyRuntime = await hydrateHeavyRuntime();
          const result = await heavyRuntime.runLiveModelTurnSmoke({
            model: heavyRuntime.deployLiveModelTurnSmokeModel,
            signal: requestAbort.signal,
          });
          writeJsonResponse(response, 200, {
            liveModelTurn: result,
            ok: true,
          });
        } catch (error) {
          emitHostedExecutionStructuredLog({
            component: "container",
            error,
            level: "error",
            message: "Hosted container entrypoint failed the live model turn smoke.",
            phase: "failed",
            userId: null,
          });
          if (requestAbort.signal.aborted || response.destroyed) {
            return;
          }
          // Live-turn smoke diagnostics carry locally constructed labels plus
          // capped, redacted Codex stdout/stderr excerpts so CI can show the
          // provider-side reason without dumping raw JSONL or credentials.
          writeJsonResponse(response, 500, {
            error: "Hosted live model turn smoke failed.",
            ok: false,
            smokeErrorMessage: heavyRuntime
              ? heavyRuntime.buildLiveModelTurnSmokeSafeText(
                  error instanceof Error ? error.message : String(error),
                )
              : "Hosted live model turn smoke failed before runtime hydration.",
          });
        }
        return;
      }

      if (isDirectR2PresignedPutSmokeRequest) {
        if (activeHostedRunnerJobCount > 0) {
          discardUnreadRequestBody(request);
          writeJsonResponse(response, 409, {
            error: "Hosted runner is busy.",
          });
          return;
        }
        activeHostedRunnerJobCount += 1;
        claimedRunnerSlot = true;
        let smokeRequest: HostedContainerDirectR2PresignedPutSmokeRequest;
        try {
          smokeRequest = parseHostedContainerDirectR2PresignedPutSmokeRequest(
            JSON.parse(await readHostedContainerInvocationRequestBody(request)),
          );
        } catch (error) {
          emitHostedExecutionStructuredLog({
            component: "container",
            error,
            level: "warn",
            message: "Hosted container entrypoint rejected the direct R2 presigned PUT smoke request body.",
            phase: "failed",
          });
          const classified = classifyRequestDecodeError(error);
          writeJsonResponse(response, classified.statusCode, classified.payload);
          return;
        }
        const heavyRuntime = await hydrateHeavyRuntime();
        const result = await heavyRuntime.runDirectR2PresignedPutSmoke({
          ...smokeRequest,
          signal: requestAbort.signal,
        });
        writeJsonResponse(response, 200, {
          directR2PresignedPut: result,
          ok: result.ok,
        });
        return;
      }

      if (activeHostedRunnerJobCount > 0) {
        discardUnreadRequestBody(request);
        emitHostedExecutionStructuredLog({
          component: "container",
          level: "warn",
          message: "Hosted container entrypoint rejected a concurrent invocation request.",
          phase: "failed",
        });
        writeJsonResponse(response, 409, {
          error: "Hosted runner is busy.",
        });
        return;
      }
      activeHostedRunnerJobCount += 1;
      claimedRunnerSlot = true;

      try {
        const requestBody: unknown = JSON.parse(await readHostedContainerInvocationRequestBody(request));
        const requestEnvelope = parseHostedExecutionContainerInvocationEnvelope(requestBody);
        job = runtime.parseRunnerJobInput(requestEnvelope.job);
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "container",
          error,
          level: "warn",
          message: "Hosted container entrypoint rejected the request body.",
          phase: "failed",
        });
        const classified = classifyRequestDecodeError(error);
        writeJsonResponse(response, classified.statusCode, classified.payload);
        return;
      }

      const runnerJobAcceptedAt = new Date().toISOString();
      workspaceInvocationAcceptedCount += 1;
      const coldNodeStartupMs = pendingColdNodeStartupMs;
      pendingColdNodeStartupMs = null;
      const orchestrationMilestones =
        readHostedRuntimeOrchestrationLatencyHeaders(request.headers);
      const dispatchMilestones = readHostedContainerDispatchMilestones(request);
      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          forwardedEnvKeyCount: Object.keys(job.runtime?.forwardedEnv ?? {}).length,
          runnerSecretKeyCount: Object.keys(job.runtime?.userEnv ?? {}).length,
        },
        message: "Hosted container entrypoint accepted runner job.",
        phase: "wake.running",
        userId: readHostedExecutionRunnerJobUserId(job),
      });
      activeRuntimeWakePendingAttemptId = readHostedContainerWorkspaceAttemptId(job);
      activeRuntimeWakePendingLeaseGeneration = readHostedContainerWorkspaceLeaseGeneration(job);
      activeRuntimeWakePendingUserId = readHostedExecutionRunnerJobUserId(job);
      activeAbortRecord = {
        abort(reason: Error) {
          if (!containerShutdownController.signal.aborted && !invocationAbort.signal.aborted) {
            invocationAbort.abort(reason);
          }
        },
        attemptId: readHostedContainerWorkspaceAttemptId(job),
        leaseGeneration: readHostedContainerWorkspaceLeaseGeneration(job),
        userId: readHostedExecutionRunnerJobUserId(job),
      };
      activeWorkspaceInvocationAbort = activeAbortRecord;
      if (
        pendingWorkspaceInvocationAbort
        && activeAbortRecord.attemptId === pendingWorkspaceInvocationAbort.attemptId
        && activeAbortRecord.leaseGeneration === pendingWorkspaceInvocationAbort.leaseGeneration
        && activeAbortRecord.userId === pendingWorkspaceInvocationAbort.userId
      ) {
        pendingWorkspaceInvocationAbort = null;
        activeAbortRecord.abort(new Error("workspace invocation preempted"));
      }
      stopActiveJobDiagnostics = startHostedContainerActiveJobDiagnostics({
        job,
        processApi: runtime.processApi,
      });

      workspaceRestorePreparation = runtime.prepareWorkspaceRestore({
        job,
        signal: invocationAbort.signal,
      });
      const heavyRuntimeHydration = hydrateHeavyRuntime();
      const preparedWorkspaceRestore = await workspaceRestorePreparation;
      const heavyRuntime = await raceHostedContainerInvocationAbort(
        heavyRuntimeHydration,
        invocationAbort.signal,
      );

      const result = await heavyRuntime.runWorkspaceInvocation(job, {
        onConversationActivityObserved() {
          conversationActivityObservedForInvocation = true;
        },
        onRuntimeWakeReady(sendWake) {
          activeRuntimeWake = sendWake;
          activeRuntimeWakeAttemptId = job
            ? readHostedContainerWorkspaceAttemptId(job)
            : null;
          activeRuntimeWakeLeaseGeneration = job
            ? readHostedContainerWorkspaceLeaseGeneration(job)
            : null;
          activeRuntimeWakeUserId = job
            ? readHostedExecutionRunnerJobUserId(job)
            : null;
          runtimeWakeForRequest = sendWake;
          const pendingWake = activeRuntimeWakePending;
          const pendingWakeNotifiedAtEpochMs = activeRuntimeWakePendingNotifiedAtEpochMs;
          const pendingWakeOrchestration = activeRuntimeWakePendingOrchestration;
          const pendingWakeRequestedProcessingMode =
            activeRuntimeWakePendingRequestedProcessingMode;
          activeRuntimeWakePending = false;
          activeRuntimeWakePendingNotifiedAtEpochMs = null;
          activeRuntimeWakePendingOrchestration = null;
          activeRuntimeWakePendingRequestedProcessingMode = null;
          emitHostedExecutionStructuredLog({
            component: "container",
            details: {
              activeHostedRunnerJobCount,
              activeRuntimeWakePresent: true,
              pendingRuntimeWakeDelivered: pendingWake
                ? sendWake({
                    ...(pendingWakeOrchestration
                      ? { orchestration: pendingWakeOrchestration }
                      : {}),
                    notifiedAtEpochMs: pendingWakeNotifiedAtEpochMs ?? undefined,
                    ...(pendingWakeRequestedProcessingMode
                      ? { requestedProcessingMode: pendingWakeRequestedProcessingMode }
                      : {}),
                  })
                : false,
              workspaceAttemptId: activeRuntimeWakeAttemptId,
            },
            message: "Hosted container invocation reported runtime wake readiness.",
            phase: "wake.running",
            userId: null,
          });
        },
        ...(coldNodeStartupMs === null ? {} : { nodeStartupMs: coldNodeStartupMs }),
        ...(dispatchMilestones ? { dispatch: dispatchMilestones } : {}),
        ...(orchestrationMilestones ? { orchestration: orchestrationMilestones } : {}),
        preparedWorkspaceRestore,
        runnerJobAcceptedAt,
        releaseSha: runnerBundle?.releaseSha ?? null,
        shutdownSignal: containerShutdownController.signal,
        signal: invocationAbort.signal,
        supervisorEnv: runtime.startupConfig.supervisorEnv,
        waitForBackgroundAssistantWork: heavyRuntime.waitForBackgroundAssistantWork,
      });

      if (requestAbort.signal.aborted || response.destroyed) {
        settleConversationActivity();
        return;
      }

      settleConversationActivity();

      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          resultPhase: readHostedExecutionRunnerResultPhase(result),
        },
        message: "Hosted container entrypoint completed runner job.",
        phase: "wake.running",
        userId: readHostedExecutionRunnerJobUserId(job),
      });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(result));
    } catch (caughtError) {
      let error = caughtError;
      if (job) {
        settleConversationActivity();
      }
      const responseUnavailable = requestAbort.signal.aborted || response.destroyed;

      if (
        invocationAbort.signal.aborted
        && error === invocationAbort.signal.reason
        && workspaceRestorePreparation
      ) {
        try {
          await (await workspaceRestorePreparation).promise;
        } catch (restoreError) {
          if (restoreError !== invocationAbort.signal.reason) {
            error = restoreError;
          }
        }
        if (error === invocationAbort.signal.reason) {
          if (!responseUnavailable) {
            response.statusCode = 204;
            response.end();
          }
          return;
        }
      }

      if (!responseUnavailable) {
        emitHostedExecutionStructuredLog({
          component: "container",
          details: buildHostedContainerRunnerJobErrorMetadata(error),
          level: "error",
          message: "Hosted container entrypoint failed a runner job.",
          phase: "failed",
          userId: null,
        });
      }
      if (responseUnavailable) {
        return;
      }
      const classified = classifyRunnerJobError(error);
      writeJsonResponse(response, classified.statusCode, classified.payload);
    } finally {
      if (job) {
        settleConversationActivity();
      }
      stopActiveJobDiagnostics?.();
      if (runtimeWakeForRequest && activeRuntimeWake === runtimeWakeForRequest) {
        activeRuntimeWake = null;
        activeRuntimeWakeAttemptId = null;
        activeRuntimeWakeLeaseGeneration = null;
        activeRuntimeWakeUserId = null;
      }
      if (
        job
        && activeRuntimeWakePendingAttemptId === readHostedContainerWorkspaceAttemptId(job)
      ) {
        activeRuntimeWakePending = false;
        activeRuntimeWakePendingAttemptId = null;
        activeRuntimeWakePendingLeaseGeneration = null;
        activeRuntimeWakePendingNotifiedAtEpochMs = null;
        activeRuntimeWakePendingOrchestration = null;
        activeRuntimeWakePendingRequestedProcessingMode = null;
        activeRuntimeWakePendingUserId = null;
      }
      if (
        activeAbortRecord
        && activeWorkspaceInvocationAbort === activeAbortRecord
      ) {
        activeWorkspaceInvocationAbort = null;
      }
      if (claimedRunnerSlot) {
        activeHostedRunnerJobCount = Math.max(0, activeHostedRunnerJobCount - 1);
      }
      requestAbort.cleanup();
      maybeExitAfterContainerShutdownDrain();
    }
  });

  server.once("close", () => {
    if (hostedContainerFatalRuntimeDrain === fatalRuntimeDrainOwner) {
      hostedContainerFatalRuntimeDrain = null;
    }
    const hydration = heavyRuntimeHydrationPromise;
    if (!hydration) {
      return;
    }
    void hydration.then(async (heavyRuntime) => {
      await stopWarmCodexWithLifecycleLog(heavyRuntime, {
        failureMessage: "Hosted container entrypoint failed to stop warm Codex on server close.",
        reason: "container-server-close",
      });
    }).catch(() => undefined);
  });

  let containerShutdownExitStarted = false;
  const maybeExitAfterContainerShutdownDrain = () => {
    if (
      !containerShutdownController.signal.aborted
      || activeHostedRunnerJobCount > 0
      || containerShutdownExitStarted
    ) {
      return;
    }
    containerShutdownExitStarted = true;
    void (async () => {
      let resolveShutdownDeadline!: () => void;
      const shutdownDeadline = new Promise<void>((resolve) => {
        resolveShutdownDeadline = resolve;
      });
      const issueCleanExitOnce = (): void => {
        if (containerTerminalExitScheduled) {
          return;
        }
        containerTerminalExitScheduled = true;
        process.exit(0);
      };
      const cleanExitBackstop = setTimeout(() => {
        issueCleanExitOnce();
        resolveShutdownDeadline();
      }, runtime.shutdownDrainTimeoutMs);
      cleanExitBackstop.unref();
      const hydration = heavyRuntimeHydrationPromise;
      const hydrationAndDrain = hydration
        ? hydration.then(
          async (heavyRuntime) => {
            await heavyRuntime.drainShutdownRuntimeBestEffort({
              timeoutMs: runtime.shutdownDrainTimeoutMs,
            });
          },
          () => undefined,
        ).catch(() => undefined)
        : Promise.resolve();
      await Promise.race([hydrationAndDrain, shutdownDeadline]);
      if (hostedContainerProcessFatalObserved) {
        server.close(() => {
          clearTimeout(cleanExitBackstop);
        });
        return;
      }
      emitHostedExecutionStructuredLog({
        component: "container",
        level: "warn",
        message: "Hosted container entrypoint drained after shutdown signal; exiting cleanly.",
        phase: "wake.running",
      });
      server.close(() => {
        clearTimeout(cleanExitBackstop);
        issueCleanExitOnce();
      });
    })();
  };
  const handleContainerShutdownSignal = () => {
    if (containerShutdownController.signal.aborted) {
      return;
    }
    emitHostedExecutionStructuredLog({
      component: "container",
      level: "warn",
      message: "Hosted container entrypoint received SIGTERM; requesting immediate idle checkpoint.",
      phase: "wake.running",
    });
    containerShutdownController.abort(
      new DOMException("Hosted container received SIGTERM.", "AbortError"),
    );
    maybeExitAfterContainerShutdownDrain();
  };
  // process.on, not once: repeated SIGTERMs (orchestrator retries, local
  // docker stop) must stay no-ops instead of restoring default termination
  // mid-checkpoint.
  process.on("SIGTERM", handleContainerShutdownSignal);
  server.once("close", () => {
    process.removeListener("SIGTERM", handleContainerShutdownSignal);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 8080, "0.0.0.0", () => {
      // Capture node-startup latency synchronously in the listen callback, before
      // the event loop can dispatch the first request handler, so a request that
      // races server startup still observes the cold nodeStartupMs. Heavy runtime
      // hydration starts only after this measurement and never changes readiness.
      serverListeningAtEpochMs = Date.now();
      pendingColdNodeStartupMs =
        serverListeningAtEpochMs - HOSTED_CONTAINER_PROCESS_START_MS;
      hydrateHeavyRuntime();
      hostedContainerFatalRuntimeDrain = fatalRuntimeDrainOwner;
      resolve();
    });
  }).catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        port: input.port ?? 8080,
      },
      error,
      level: "error",
      message: "Hosted container entrypoint failed to start listening.",
      phase: "failed",
    });
    throw error;
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    const error = new Error("Hosted container entrypoint failed to resolve its listening TCP port.");
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        port: input.port ?? 8080,
      },
      error,
      level: "error",
      message: error.message,
      phase: "failed",
    });
    throw error;
  }

  return server;
}

function parseHostedExecutionContainerInvocationEnvelope(
  value: unknown,
): { job: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted container runner request must be an object.");
  }

  const record = value as Record<string, unknown>;
  assertHostedContainerArchitectureVersion(record.hostedRuntimeArchitectureVersion);
  return { job: record.job };
}

if (isHostedContainerCliEntrypoint()) {
  void startHostedContainerEntrypointCli().catch(async (error) => {
    emitHostedExecutionStructuredLog({
      component: "container",
      error,
      level: "error",
      message: "Hosted container entrypoint failed to start.",
      phase: "failed",
    });
    await reportHostedContainerFatalBestEffort({
      error,
      stage: "entrypoint_start_failed",
    });
    process.exitCode = 1;
    setImmediate(() => {
      process.exit(1);
    });
  });
}

function isHostedContainerCliEntrypoint(): boolean {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

// Node's default for an uncaught exception or unhandled rejection is a stderr
// trace plus exit code 1 — exactly the unattributable `unrequested-nonzero-stop`
// container deaths observed in prod (2026-06-11 rollback incidents), because
// container stdout/stderr never reaches a queryable sink. These handlers keep
// the exit-1 contract but leave one durable worker-side fatal report first.
// CLI-only install: entrypoint unit tests must keep Node's default behavior.
function installHostedContainerProcessFatalHandlers(): void {
  let handlingFatalProcessError = false;
  const handleFatalProcessError =
    (stage: HostedContainerFatalStage) => (error: unknown) => {
      if (handlingFatalProcessError) {
        process.exit(1);
      }
      handlingFatalProcessError = true;
      hostedContainerProcessFatalObserved = true;
      emitHostedExecutionStructuredLog({
        component: "container",
        details: { stage },
        // Non-Error fatal values stay out of logs and reports entirely: the
        // raw value could hold anything, and the stage already locates the
        // failure class.
        error: error instanceof Error ? error : new Error("Non-Error process-fatal value."),
        level: "error",
        message: "Hosted container entrypoint hit a process-fatal error.",
        phase: "failed",
      });
      // Hard backstop in case the report fetch ignores its own timeout.
      setTimeout(() => {
        process.exit(1);
      }, HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS + 1_000).unref();
      // Flush queued runtime writes alongside the fatal report when the heavy
      // runtime has hydrated. Before listen there cannot be accepted assistant
      // work to drain, so the fatal report remains the only durable owner.
      const runtimeDrain = hostedContainerFatalRuntimeDrain;
      void Promise.allSettled([
        reportHostedContainerFatalBestEffort({ error, stage }),
        ...(runtimeDrain ? [runtimeDrain()] : []),
      ]).then(() => {
        process.exitCode = 1;
        process.exit(1);
      });
    };
  process.on("uncaughtException", handleFatalProcessError("uncaught_exception"));
  process.on("unhandledRejection", handleFatalProcessError("unhandled_rejection"));
}

async function startHostedContainerEntrypointCli(): Promise<void> {
  installHostedContainerProcessFatalHandlers();
  const port = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

  // Always-on CPU attribution sampler: the per-job diagnostic heartbeat only
  // observes active invocations, but production CPU burns have been observed
  // both at boot and on long-lived warm containers between jobs. Started
  // before entrypoint startup so manifest read, dependency resolution, and
  // listen are inside the first sampled interval. CLI-only on the real
  // process API: entrypoint unit tests inject sequenced processApi mocks that
  // the watchdog must not consume. Job-activity correlation comes from the
  // adjacent active-job heartbeat logs in the same stream.
  const stopCpuWatchdog = startHostedContainerCpuWatchdog({
    processApi: defaultHostedContainerProcessApi,
  });

  try {
    const server = await startHostedContainerEntrypoint({ port });
    server.once("close", stopCpuWatchdog);
  } catch (error) {
    stopCpuWatchdog();
    throw error;
  }
}

async function readHostedContainerInvocationRequestBody(
  request: IncomingMessage,
  limitBytes = HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES,
): Promise<string> {
  const declaredLength = readContentLengthBytes(request.headers["content-length"]);

  if (
    declaredLength !== null
    && declaredLength > limitBytes
  ) {
    throw new HostedContainerRequestBodyTooLargeError(limitBytes);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > limitBytes) {
      throw new HostedContainerRequestBodyTooLargeError(limitBytes);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function readContentLengthBytes(value: string | string[] | undefined): number | null {
  if (Array.isArray(value)) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

// Best-effort dispatch telemetry stamped by the Durable Object onto the runner
// POST headers. Invalid or absent values are dropped rather than failing the
// job; these stamps are diagnostics, not authority.
function readHostedContainerDispatchMilestones(
  request: IncomingMessage,
): { invokeReceivedAtEpochMs?: number; containerEnsureReadyStartedAtEpochMs?: number } | null {
  const invokeReceivedAtEpochMs = readDispatchEpochMs(
    request.headers["x-dispatch-invoke-received-at-ms"],
  );
  const containerEnsureReadyStartedAtEpochMs = readDispatchEpochMs(
    request.headers["x-dispatch-container-ensure-ready-started-at-ms"],
  );
  if (invokeReceivedAtEpochMs === null && containerEnsureReadyStartedAtEpochMs === null) {
    return null;
  }
  return {
    ...(invokeReceivedAtEpochMs === null ? {} : { invokeReceivedAtEpochMs }),
    ...(containerEnsureReadyStartedAtEpochMs === null ? {} : { containerEnsureReadyStartedAtEpochMs }),
  };
}

function readDispatchEpochMs(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function discardUnreadRequestBody(request: IncomingMessage): void {
  if (!request.readableEnded && !request.destroyed) {
    request.resume();
  }
}

function parseHostedContainerDirectR2PresignedPutSmokeRequest(
  value: unknown,
): HostedContainerDirectR2PresignedPutSmokeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Direct R2 presigned PUT smoke request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const presignedPutUrl = typeof record.presignedPutUrl === "string"
    ? record.presignedPutUrl.trim()
    : "";
  if (!presignedPutUrl) {
    throw new TypeError("Direct R2 presigned PUT smoke request requires presignedPutUrl.");
  }

  const parsedUrl = new URL(presignedPutUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new TypeError("Direct R2 presigned PUT smoke URL must use HTTP or HTTPS.");
  }

  const rawByteLength = Object.hasOwn(record, "byteLength")
    ? record.byteLength
    : HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_DEFAULT_BYTES;
  const byteLength = typeof rawByteLength === "number"
    ? rawByteLength
    : Number(rawByteLength);
  if (
    !Number.isSafeInteger(byteLength)
    || byteLength <= 0
    || byteLength > HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_MAX_BYTES
  ) {
    throw new RangeError("Direct R2 presigned PUT smoke byteLength is outside the supported range.");
  }

  const tlsCaCertificatePem = typeof record.tlsCaCertificatePem === "string"
    ? record.tlsCaCertificatePem.trim()
    : "";
  if (tlsCaCertificatePem && tlsCaCertificatePem.length > 8 * 1024) {
    throw new RangeError("Direct R2 presigned PUT smoke CA certificate is too large.");
  }

  return {
    byteLength,
    presignedPutUrl: parsedUrl.href,
    ...(tlsCaCertificatePem ? { tlsCaCertificatePem } : {}),
  };
}

function parseHostedContainerWorkspaceInvocationAbortRequest(
  value: unknown,
): HostedContainerWorkspaceInvocationAbortRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Workspace invocation abort request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const attemptId = typeof record.attemptId === "string"
    ? record.attemptId.trim()
    : "";
  const leaseGeneration = typeof record.leaseGeneration === "string"
    ? record.leaseGeneration.trim()
    : "";
  const userId = typeof record.userId === "string"
    ? record.userId.trim()
    : "";

  if (!attemptId) {
    throw new TypeError("Workspace invocation abort request requires attemptId.");
  }
  if (!leaseGeneration) {
    throw new TypeError("Workspace invocation abort request requires leaseGeneration.");
  }
  if (!userId) {
    throw new TypeError("Workspace invocation abort request requires userId.");
  }

  return {
    attemptId,
    leaseGeneration,
    userId,
  };
}

async function readHostedContainerRuntimeWakeRequest(
  request: IncomingMessage,
): Promise<HostedContainerRuntimeWakeRequest | null> {
  const body = (await readHostedContainerInvocationRequestBody(
    request,
    HOSTED_CONTAINER_RUNTIME_WAKE_REQUEST_BODY_LIMIT_BYTES,
  )).trim();
  if (!body) {
    return null;
  }

  return parseHostedContainerRuntimeWakeRequest(JSON.parse(body));
}

function parseHostedContainerRuntimeWakeRequest(
  value: unknown,
): HostedContainerRuntimeWakeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Runtime wake request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const attemptId = typeof record.attemptId === "string"
    ? record.attemptId.trim()
    : "";
  const leaseGeneration = typeof record.leaseGeneration === "string"
    ? record.leaseGeneration.trim()
    : "";
  const userId = typeof record.userId === "string"
    ? record.userId.trim()
    : "";

  if (!attemptId) {
    throw new TypeError("Runtime wake request requires attemptId.");
  }
  if (!leaseGeneration) {
    throw new TypeError("Runtime wake request requires leaseGeneration.");
  }
  if (!userId) {
    throw new TypeError("Runtime wake request requires userId.");
  }
  const requestedProcessingMode = readHostedContainerRequestedProcessingMode(
    record.requestedProcessingMode,
  );

  return {
    attemptId,
    leaseGeneration,
    orchestration: readHostedContainerRuntimeWakeOrchestration(record.orchestration),
    ...(requestedProcessingMode ? { requestedProcessingMode } : {}),
    userId,
  };
}

function readHostedContainerRequestedProcessingMode(
  value: unknown,
): HostedWorkspaceInvocationProcessingMode | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    value === "default"
    || value === "inbox_media_retention"
    || value === "system_mailbox"
  ) {
    return value;
  }
  throw new TypeError("Runtime wake request processing mode is unsupported.");
}

function readHostedContainerRuntimeWakeOrchestration(
  value: unknown,
): HostedRuntimeOrchestrationLatencyDiagnostics | null {
  return sanitizeHostedRuntimeOrchestrationLatencyDiagnostics(value);
}

function hostedContainerRuntimeWakeIdentityMatches(
  expected: HostedContainerRuntimeWakeRequest,
  actual: {
    attemptId: string | null;
    leaseGeneration: string | null;
    userId: string | null;
  },
): boolean {
  return actual.attemptId === expected.attemptId
    && actual.leaseGeneration === expected.leaseGeneration
    && actual.userId === expected.userId;
}

function readHostedExecutionRunnerResultPhase(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }

  const phase = (result as { phase?: unknown }).phase;
  return typeof phase === "string" ? phase : null;
}

function readHostedExecutionRunnerJobUserId(job: HostedExecutionRunnerJobInput): string {
  return job.request.userId;
}

function readHostedContainerWorkspaceAttemptId(
  job: HostedExecutionRunnerJobInput,
): string | null {
  return job.kind === "workspace-invocation" ? job.request.attemptId : null;
}

function readHostedContainerWorkspaceLeaseGeneration(
  job: HostedExecutionRunnerJobInput,
): string | null {
  return job.kind === "workspace-invocation" ? job.request.leaseGeneration : null;
}

function assertHostedContainerArchitectureVersion(value: unknown): void {
  const actualVersion = typeof value === "string" && value.trim().length > 0
    ? value
    : null;
  if (actualVersion === HOSTED_RUNTIME_ARCHITECTURE_VERSION) {
    return;
  }

  throw new HostedContainerArchitectureVersionMismatchError({
    actualVersion,
    expectedVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
  });
}

function resolveHostedContainerRuntimeDependencies(
  runtime: HostedContainerRuntimeOptions | undefined,
): HostedContainerRuntimeDependencies {
  const startupConfig = createHostedContainerStartupConfig();
  return {
    exitScheduler: runtime?.exitScheduler ?? defaultHostedContainerExitScheduler,
    loadHeavyRuntime: async () =>
      await loadConfiguredHostedContainerHeavyRuntime(runtime),
    parseRunnerJobInput:
      runtime?.parseRunnerJobInput ?? parseHostedExecutionRunnerJobInput,
    prepareWorkspaceRestore:
      runtime?.prepareWorkspaceRestore ?? prepareHostedContainerWorkspaceRestore,
    processApi: runtime?.processApi
      ? {
        ...defaultHostedContainerProcessApi,
        ...runtime.processApi,
      }
      : defaultHostedContainerProcessApi,
    shutdownDrainTimeoutMs:
      runtime?.shutdownDrainTimeoutMs
      ?? HOSTED_CONTAINER_SHUTDOWN_POST_SAFE_POINT_DRAIN_TIMEOUT_MS,
    startupConfig,
  };
}

async function loadConfiguredHostedContainerHeavyRuntime(
  runtime: HostedContainerRuntimeOptions | undefined,
): Promise<HostedContainerHeavyRuntime> {
  const heavyRuntime = await (runtime?.loadHeavyRuntime ?? loadHostedContainerHeavyRuntime)();

  return {
    ...heavyRuntime,
    runCodexShellSmoke: runtime?.runCodexShellSmoke ?? heavyRuntime.runCodexShellSmoke,
    runDirectR2PresignedPutSmoke:
      runtime?.runDirectR2PresignedPutSmoke ?? heavyRuntime.runDirectR2PresignedPutSmoke,
    runLiveModelTurnSmoke:
      runtime?.runLiveModelTurnSmoke ?? heavyRuntime.runLiveModelTurnSmoke,
    runWorkspaceInvocation:
      runtime?.runWorkspaceInvocation ?? heavyRuntime.runWorkspaceInvocation,
    stopWarmCodex: runtime?.stopWarmCodex ?? stopWarmCodexAppServer,
    waitForBackgroundAssistantWork:
      runtime?.waitForBackgroundAssistantWork
      ?? (async (signal) => await waitForWarmCodexBackgroundWork({ signal })),
  };
}

async function loadHostedContainerHeavyRuntime(): Promise<HostedContainerHeavyRuntimeCore> {
  const module = await import("./container-entrypoint-heavy-runtime.ts");
  return module.hostedContainerHeavyRuntime;
}

async function prepareHostedContainerWorkspaceRestore(input: {
  job: HostedExecutionRunnerJobInput;
  signal: AbortSignal;
}): Promise<HostedWorkspaceRestorePreparation> {
  const module = await import("./container-workspace-restore-preparation.ts");
  return await module.prepareHostedContainerWorkspaceRestore(input);
}

function createHostedContainerStartupConfig(): HostedContainerStartupConfig {
  const appRoot = process.cwd();
  const supervisorEnv = Object.freeze({ ...process.env });
  return Object.freeze({
    appRoot,
    hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    runnerBundleManifestPath: path.join(appRoot, ".murph-runner-bundle-manifest.json"),
    supervisorEnv,
  });
}

function raceHostedContainerInvocationAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function createRequestAbortController(
  request: HostedAbortRequestLike,
  response: HostedAbortResponseLike,
): {
  cleanup: () => void;
  requestSignal: AbortSignal;
  responseClosed: () => boolean;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const requestController = new AbortController();
  let exitLogged = false;
  let responseClosed = false;

  const emitRequestExitLog = (exitReason: "request.aborted" | "response.closed"): void => {
    if (exitLogged) {
      return;
    }
    exitLogged = true;

    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        exitReason,
      },
      level: "warn",
      message:
        exitReason === "response.closed"
          ? "Hosted container entrypoint exited because the response closed before completion."
          : "Hosted container entrypoint exited because the request aborted before completion.",
      phase: "failed",
    });
  };

  const abortRequest = () => {
    if (!requestController.signal.aborted) {
      const error = new Error("Hosted runner request aborted before completion.");
      emitRequestExitLog("request.aborted");
      requestController.abort(error);
      if (!controller.signal.aborted) {
        controller.abort(error);
      }
    }
  };

  const abortResponse = () => {
    if (!responseClosed) {
      responseClosed = true;
      const error = new Error("Hosted runner response closed before completion.");
      emitRequestExitLog("response.closed");
      if (!controller.signal.aborted) {
        controller.abort(error);
      }
    }
  };
  const handleRequestAbort = () => {
    abortRequest();
  };
  const handleResponseClose = () => {
    if (!response.writableEnded) {
      abortResponse();
    }
  };

  request.once("aborted", handleRequestAbort);
  response.once("close", handleResponseClose);

  return {
    cleanup: () => {
      request.off("aborted", handleRequestAbort);
      response.off("close", handleResponseClose);
    },
    requestSignal: requestController.signal,
    responseClosed: () => responseClosed,
    signal: controller.signal,
  };
}

export function classifyRunnerJobError(error: unknown): {
  payload: Record<string, unknown>;
  statusCode: number;
} {
  const details = buildHostedContainerRunnerJobErrorMetadata(error);
  const safeErrorName = readHostedExecutionSafeErrorName(error);

  if (isHostedAssistantConfigurationError(error)) {
    return {
      payload: {
        code: error.code,
        error: summarizeHostedExecutionErrorCode("configuration_error")
          ?? summarizeHostedExecutionError(error),
        ...(details ? { details } : {}),
      },
      statusCode: 503,
    };
  }

  return {
    payload: {
      code: deriveHostedExecutionErrorCode(error),
      error: summarizeHostedExecutionError(error),
      ...(details ? { details } : {}),
      ...(safeErrorName ? { errorName: safeErrorName } : {}),
    },
    statusCode: 500,
  };
}

function buildHostedContainerRunnerJobErrorMetadata(
  error: unknown,
): HostedExecutionStructuredLogDetails | null {
  const details: HostedExecutionStructuredLogDetails = {
    detailsPresent: hasHostedContainerOwnProperty(error, "details"),
    errorMessagePresent: error instanceof Error && error.message.trim().length > 0,
    stackPresent: error instanceof Error && typeof error.stack === "string" && error.stack.trim().length > 0,
  };
  const safeErrorName = readHostedExecutionSafeErrorName(error);
  if (safeErrorName) {
    details.errorName = safeErrorName;
  }
  const runtimeFailurePhaseCode = readHostedRuntimeFailurePhaseCode(error);
  if (runtimeFailurePhaseCode) {
    details[HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY] =
      runtimeFailurePhaseCode;
  }
  const errorCodeDetail = readHostedContainerSafeCodeProperty(error, "code")
    ?? readHostedContainerSafeCodeProperty(error, "errorCode");
  if (errorCodeDetail) {
    details.errorCodeDetail = errorCodeDetail;
  }

  const rawDetails = readHostedContainerErrorDetailsRecord(error);
  if (rawDetails) {
    details.detailsKeys = Object.keys(rawDetails).sort();
    details.errorDetailPresent = hasNonEmptyHostedContainerString(rawDetails.errorDetail);
  }

  return Object.keys(details).length > 0 ? details : null;
}

function readHostedContainerErrorDetailsRecord(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object" || !Object.prototype.hasOwnProperty.call(error, "details")) {
    return null;
  }

  return readHostedContainerRecordProperty(error as Record<string, unknown>, "details");
}

function readHostedContainerRecordProperty(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readHostedContainerSafeCodeProperty(error: unknown, key: string): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  return readHostedContainerSafeCode((error as Record<string, unknown>)[key]);
}

function readHostedContainerSafeCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(normalized) ? normalized : null;
}

function hasHostedContainerOwnProperty(error: unknown, key: string): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && Object.prototype.hasOwnProperty.call(error, key),
  );
}

function hasNonEmptyHostedContainerString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function classifyRequestDecodeError(error: unknown): {
  payload: Record<string, unknown>;
  statusCode: number;
} {
  if (error instanceof HostedContainerArchitectureVersionMismatchError) {
    return {
      payload: {
        actualVersion: error.actualVersion,
        code: "runtime_architecture_mismatch",
        error: "Hosted runtime architecture mismatch.",
        expectedVersion: error.expectedVersion,
      },
      statusCode: 409,
    };
  }

  if (error instanceof HostedContainerRequestBodyTooLargeError) {
    return {
      payload: {
        code: "request_body_too_large",
        error: "Request body too large.",
      },
      statusCode: 413,
    };
  }

  const details = buildHostedExecutionSafeErrorDetails(error);
  const errorName = readHostedExecutionSafeErrorName(error);

  if (error instanceof SyntaxError) {
    return {
      payload: {
        code: deriveHostedExecutionErrorCode(error),
        ...(details ? { details } : {}),
        error: "Invalid JSON.",
        ...(errorName ? { errorName } : {}),
      },
      statusCode: 400,
    };
  }

  if (error instanceof TypeError || error instanceof RangeError || error instanceof URIError) {
    return {
      payload: {
        code: deriveHostedExecutionErrorCode(error),
        ...(details ? { details } : {}),
        error: "Invalid request.",
        ...(errorName ? { errorName } : {}),
      },
      statusCode: 400,
    };
  }

  return {
    payload: {
      code: deriveHostedExecutionErrorCode(error),
      ...(details ? { details } : {}),
      error: "Internal error.",
      ...(errorName ? { errorName } : {}),
    },
    statusCode: 500,
  };
}

async function readHostedRunnerBundleManifestSummary(
  processApi: HostedContainerProcessApi,
  manifestPath: string,
): Promise<HostedRunnerBundleManifestSummary | null> {
  let raw: string;

  try {
    raw = await processApi.readFile(manifestPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const manifest = parsed as Record<string, unknown>;

  return {
    ...(typeof manifest.buildSkipped === "boolean" ? { buildSkipped: manifest.buildSkipped } : {}),
    ...(typeof manifest.bundleFingerprint === "string" ? { bundleFingerprint: manifest.bundleFingerprint } : {}),
    ...(typeof manifest.generatedAt === "string" ? { generatedAt: manifest.generatedAt } : {}),
    ...(typeof manifest.releaseSha === "string" ? { releaseSha: manifest.releaseSha } : {}),
    ...(typeof manifest.schemaVersion === "number" ? { schemaVersion: manifest.schemaVersion } : {}),
    ...(typeof manifest.sourceFingerprint === "string" ? { sourceFingerprint: manifest.sourceFingerprint } : {}),
  };
}

async function stopWarmCodexWithLifecycleLog(
  runtime: HostedContainerHeavyRuntime,
  input: {
    failureMessage?: string;
    reason: "container-server-close" | "workspace-invocation-abort";
  },
): Promise<void> {
  try {
    await runtime.stopWarmCodex(input.reason);
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        warmCodexStopReason: input.reason,
        warmCodexStopStatus: "completed",
      },
      level: "info",
      message: "Hosted container warm Codex stop completed.",
      phase: "wake.running",
      userId: null,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        ...buildHostedContainerRunnerJobErrorMetadata(error),
        warmCodexStopReason: input.reason,
        warmCodexStopStatus: "failed",
      },
      level: "warn",
      message: input.failureMessage ?? "Hosted container failed to stop warm Codex.",
      phase: "failed",
      userId: null,
    });
    throw error;
  }
}

function startHostedContainerActiveJobDiagnostics(input: {
  job: HostedExecutionRunnerJobInput;
  processApi: HostedContainerProcessApi;
}): () => void {
  let stopped = false;
  const userId = readHostedExecutionRunnerJobUserId(input.job);
  const emitSnapshot = (stage: string) => {
    void emitHostedContainerActiveJobDiagnosticSnapshot({
      job: input.job,
      processApi: input.processApi,
      stage,
      userId,
    });
  };

  emitSnapshot("active-job-started");
  const interval = setInterval(() => {
    emitSnapshot("active-job-heartbeat");
  }, HOSTED_CONTAINER_ACTIVE_DIAGNOSTIC_INTERVAL_MS);

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(interval);
    emitSnapshot("active-job-finished");
  };
}

async function emitHostedContainerActiveJobDiagnosticSnapshot(input: {
  job: HostedExecutionRunnerJobInput;
  processApi: HostedContainerProcessApi;
  stage: string;
  userId: string;
}): Promise<void> {
  const [memoryCurrentRaw, memoryMaxRaw] = await Promise.all([
    readOptionalHostedContainerProcessText(input.processApi, "/sys/fs/cgroup/memory.current"),
    readOptionalHostedContainerProcessText(input.processApi, "/sys/fs/cgroup/memory.max"),
  ]);
  const memoryUsage = process.memoryUsage();

  emitHostedExecutionStructuredLog({
    component: "container",
    details: {
      cgroupMemoryCurrentBytes: parseCgroupMemoryValue(memoryCurrentRaw),
      cgroupMemoryMaxBytes: parseCgroupMemoryValue(memoryMaxRaw),
      lifecycleStage: "entrypoint-active-job-diagnostic",
      processHeapUsedBytes: memoryUsage.heapUsed,
      processPid: process.pid,
      processRssBytes: memoryUsage.rss,
      stage: input.stage,
      workspaceAttemptId:
        input.job.kind === "workspace-invocation" ? input.job.request.attemptId : null,
      workspaceVersion:
        input.job.kind === "workspace-invocation" ? input.job.request.workspaceVersion : null,
    },
    message: "Hosted container entrypoint active job diagnostic.",
    phase: "wake.running",
    userId: input.userId,
  });
}

async function readOptionalHostedContainerProcessText(
  processApi: HostedContainerProcessApi,
  filePath: string,
): Promise<string | null> {
  try {
    return await processApi.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseCgroupMemoryValue(value: string | null): number | null {
  const normalized = value?.trim();
  if (!normalized || normalized === "max") {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isHostedAssistantConfigurationError(
  error: unknown,
): error is Error & { code?: string | null } {
  return error instanceof Error && error.name === "HostedAssistantConfigurationError";
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}
