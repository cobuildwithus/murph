import { createHash } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import {
  CURRENT_VAULT_FORMAT_VERSION,
} from "@murphai/contracts";
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
  buildHostedRunnerExecutablePath,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNNER_EXECUTABLE_PATH,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY,
  readHostedRuntimeFailurePhaseCode,
} from "@murphai/hosted-execution/runtime-control";
import {
  drainHostedAssistantDeliveryControlPlaneWritesBestEffort,
  drainHostedRuntimeLogWritesBestEffort,
  drainHostedRuntimeDeferredUsageCompletionsBestEffort,
} from "@murphai/assistant-runtime/hosted-invocation";
import {
  stopWarmCodexAppServer,
  waitForWarmCodexBackgroundWork,
} from "@murphai/assistant-engine/codex-lifecycle";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";
import {
  startHostedContainerCpuWatchdog,
  type HostedContainerCpuWatchdogProcessApi,
} from "./container-cpu-watchdog.ts";
import {
  HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS,
  reportHostedContainerFatalBestEffort,
  type HostedContainerFatalStage,
} from "./container-fatal-report.ts";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "./hosted-runtime-architecture.ts";
import {
  HOSTED_RUNNER_CONTAINER_CA_ENV_KEYS,
} from "./runner-container-ca-env.ts";
import {
  HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE,
} from "./runner-container-error-codes.ts";
import {
  runHostedWorkspaceInvocation as runHostedWorkspaceInvocationDirect,
} from "./hosted-workspace-invocation.ts";
import {
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionRunnerJobInput,
} from "./runner-job-transport.ts";
import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
  readDeployLiveModelTurnSmokeCodexOutputText,
} from "./deploy-smoke-live-model.ts";
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
const HOSTED_CONTAINER_CODEX_SHELL_SMOKE_TIMEOUT_MS = 45_000;
const HOSTED_CONTAINER_CODEX_SHELL_SMOKE_MODEL = "gpt-5.6-terra";
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_TIMEOUT_MS = 60_000;
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDOUT_TAIL_MAX_CHARS = 16 * 1024;
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_ERROR_MESSAGE_MAX_CHARS = 512;
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDOUT_EXCERPT_MAX_CHARS = 220;
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDERR_EXCERPT_MAX_CHARS = 160;
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_DEFAULT_BYTES = 150 * 1024 * 1024;
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_MAX_BYTES = 512 * 1024 * 1024;
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_CHUNK_BYTES = 1024 * 1024;
const HOSTED_CONTAINER_SHUTDOWN_POST_SAFE_POINT_DRAIN_TIMEOUT_MS = 5_000;
const HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH =
  "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const HOSTED_CONTAINER_CODEX_SMOKE_HOME_DIRECTORY = ".codex-deploy-smoke";

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
let hostedContainerRuntimeContractsLoader:
  | Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>
  | null = null;

interface HostedContainerStartupConfig {
  appRoot: string;
  hostedRuntimeArchitectureVersion: typeof HOSTED_RUNTIME_ARCHITECTURE_VERSION;
  runnerBundleManifestPath: string;
  supervisorEnv: Readonly<Record<string, string | undefined>>;
}

interface HostedContainerRuntimeOptions {
  exitScheduler?: () => void;
  loadRuntimeContracts?:
    () => Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>;
  processApi?: Partial<HostedContainerProcessApi>;
  runWorkspaceInvocation?: typeof runHostedWorkspaceInvocationDirect;
  runDirectR2PresignedPutSmoke?: (
    options: {
      byteLength: number;
      presignedPutUrl: string;
      signal: AbortSignal;
      tlsCaCertificatePem?: string;
    },
  ) => Promise<HostedContainerDirectR2PresignedPutSmokeResult>;
  runCodexShellSmoke?: (
    options: { signal: AbortSignal },
  ) => Promise<HostedContainerCodexShellSmokeResult>;
  runLiveModelTurnSmoke?: (
    options: { model: string; signal: AbortSignal },
  ) => Promise<HostedContainerLiveModelTurnSmokeResult>;
  stopWarmCodex?: (reason: string) => Promise<void>;
  waitForBackgroundAssistantWork?: (signal: AbortSignal | null) => Promise<void>;
}

interface HostedContainerRuntimeDependencies {
  exitScheduler: () => void;
  loadRuntimeContracts:
    () => Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>;
  processApi: HostedContainerProcessApi;
  runWorkspaceInvocation: typeof runHostedWorkspaceInvocationDirect;
  startupConfig: HostedContainerStartupConfig;
  runDirectR2PresignedPutSmoke:
    (options: {
      byteLength: number;
      presignedPutUrl: string;
      signal: AbortSignal;
      tlsCaCertificatePem?: string;
    }) => Promise<HostedContainerDirectR2PresignedPutSmokeResult>;
  runCodexShellSmoke:
    (options: { signal: AbortSignal }) => Promise<HostedContainerCodexShellSmokeResult>;
  runLiveModelTurnSmoke:
    (options: { model: string; signal: AbortSignal }) => Promise<HostedContainerLiveModelTurnSmokeResult>;
  stopWarmCodex: (reason: string) => Promise<void>;
  waitForBackgroundAssistantWork: (signal: AbortSignal | null) => Promise<void>;
}

interface HostedContainerCodexShellSmokeResult {
  client: "codex-app-server";
  cliSurfaceContractBytes: number;
  cliSurfaceHotPathProofCount: number;
  murphPathBytes: number;
  noteAddBytes: number;
  stderrBytes: number;
  vaultCliLlmsBytes: number;
  vaultCliPathBytes: number;
  vaultShowBytes: number;
}

interface HostedContainerCodexCommandExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

interface HostedContainerLiveModelTurnSmokeResult {
  durationMs: number;
  model: string;
  stdoutBytes: number;
}

interface HostedContainerDirectR2PresignedPutSmokeResult {
  byteLength: number;
  durationMs: number;
  ok: boolean;
  payloadSha256: string;
  responseBodyBytes: number;
  status: number;
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
  userId: string;
}

type HostedContainerRuntimeWakeNotification = {
  notifiedAtEpochMs?: number | null;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
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
  let activeHostedRunnerJobCount = 0;
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
          conversationWarmActivityCompletedAtEpochMs,
          hostedRuntimeArchitectureVersion:
            runtime.startupConfig.hostedRuntimeArchitectureVersion,
          ok: true,
          poisoned: hostedContainerProcessFatalObserved,
          service: "cloudflare-hosted-runner-node",
          ...(runnerBundle ? { runnerBundle } : {}),
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
        discardUnreadRequestBody(request);
        try {
          const result = await runtime.runCodexShellSmoke({
            signal: requestAbort.signal,
          });
          writeJsonResponse(response, 200, {
            codexShell: result,
            ok: true,
          });
        } catch (error) {
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
            smokeErrorMessage: error instanceof Error
              ? error.message
              : String(error),
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
        try {
          const result = await runtime.runLiveModelTurnSmoke({
            model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
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
            smokeErrorMessage: buildHostedContainerLiveModelTurnSmokeSafeText(
              error instanceof Error ? error.message : String(error),
            ),
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
        const result = await runtime.runDirectR2PresignedPutSmoke({
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
        const parsed = await parseHostedExecutionContainerInvocationRequest(
          requestBody,
          runtime,
        );
        job = parsed.job;
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

      const result = await runtime.runWorkspaceInvocation(job, {
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
          activeRuntimeWakePending = false;
          activeRuntimeWakePendingNotifiedAtEpochMs = null;
          activeRuntimeWakePendingOrchestration = null;
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
        runnerJobAcceptedAt,
        shutdownSignal: containerShutdownController.signal,
        signal: invocationAbort.signal,
        supervisorEnv: runtime.startupConfig.supervisorEnv,
        waitForBackgroundAssistantWork: runtime.waitForBackgroundAssistantWork,
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
    } catch (error) {
      if (job) {
        settleConversationActivity();
      }
      const responseUnavailable = requestAbort.signal.aborted || response.destroyed;

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
      if (claimedRunnerSlot && invocationAbort.signal.aborted) {
        try {
          await stopWarmCodexWithLifecycleLog(runtime, {
            failureMessage:
              "Hosted container entrypoint failed to stop warm Codex after invocation abort.",
            reason: "workspace-invocation-abort",
          });
        } catch {
          hostedContainerProcessFatalObserved = true;
          runtime.exitScheduler();
        }
      }
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
    void stopWarmCodexWithLifecycleLog(runtime, {
      failureMessage: "Hosted container entrypoint failed to stop warm Codex on server close.",
      reason: "container-server-close",
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
      await drainHostedRuntimeDeferredUsageCompletionsBestEffort({
        timeoutMs: HOSTED_CONTAINER_SHUTDOWN_POST_SAFE_POINT_DRAIN_TIMEOUT_MS,
      });
      emitHostedExecutionStructuredLog({
        component: "container",
        level: "warn",
        message: "Hosted container entrypoint drained after shutdown signal; exiting cleanly.",
        phase: "wake.running",
      });
      const cleanExitBackstop = setTimeout(() => {
        process.exit(0);
      }, 5_000);
      cleanExitBackstop.unref();
      server.close(() => {
        clearTimeout(cleanExitBackstop);
        process.exit(0);
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
      // races server startup still observes the cold nodeStartupMs.
      pendingColdNodeStartupMs = Date.now() - HOSTED_CONTAINER_PROCESS_START_MS;
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

async function parseHostedExecutionContainerInvocationRequest(
  value: unknown,
  runtime: HostedContainerRuntimeDependencies,
): Promise<{
  job: HostedExecutionRunnerJobInput;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted container runner request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const assistantRuntime = await runtime.loadRuntimeContracts();
  assertHostedContainerArchitectureVersion(record.hostedRuntimeArchitectureVersion);

  return {
    job: parseHostedExecutionRunnerJobInput(record.job, {
      parseWorkspaceJobInput: assistantRuntime.parseHostedAssistantWorkspaceRuntimeJobInput,
    }),
  };
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
      // Flush queued info-level runtime log writes alongside the fatal
      // report so the crash tail stays durable; the backstop above bounds
      // both. Neither promise ever rejects.
      void Promise.allSettled([
        reportHostedContainerFatalBestEffort({ error, stage }),
        drainHostedAssistantDeliveryControlPlaneWritesBestEffort(),
        drainHostedRuntimeLogWritesBestEffort(),
        drainHostedRuntimeDeferredUsageCompletionsBestEffort({
          closeActiveCaptures: true,
          timeoutMs: HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS,
        }),
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

  return {
    attemptId,
    leaseGeneration,
    orchestration: readHostedContainerRuntimeWakeOrchestration(record.orchestration),
    userId,
  };
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
    loadRuntimeContracts: createCachedHostedContainerLoader(
      runtime?.loadRuntimeContracts ?? loadHostedContainerRuntimeContracts,
    ),
    exitScheduler: runtime?.exitScheduler ?? defaultHostedContainerExitScheduler,
    processApi: runtime?.processApi
      ? {
        ...defaultHostedContainerProcessApi,
        ...runtime.processApi,
      }
      : defaultHostedContainerProcessApi,
    runWorkspaceInvocation: runtime?.runWorkspaceInvocation ?? runHostedWorkspaceInvocationDirect,
    startupConfig,
    runDirectR2PresignedPutSmoke:
      runtime?.runDirectR2PresignedPutSmoke ?? runHostedContainerDirectR2PresignedPutSmoke,
    runCodexShellSmoke:
      runtime?.runCodexShellSmoke ?? runHostedContainerCodexShellSmoke,
    runLiveModelTurnSmoke:
      runtime?.runLiveModelTurnSmoke ?? runHostedContainerLiveModelTurnSmoke,
    stopWarmCodex:
      runtime?.stopWarmCodex ?? stopWarmCodexAppServer,
    waitForBackgroundAssistantWork:
      runtime?.waitForBackgroundAssistantWork
      ?? ((signal) => waitForWarmCodexBackgroundWork({ signal })),
  };
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

async function runHostedContainerDirectR2PresignedPutSmoke(input: {
  byteLength: number;
  presignedPutUrl: string;
  signal: AbortSignal;
  tlsCaCertificatePem?: string;
}): Promise<HostedContainerDirectR2PresignedPutSmokeResult> {
  const startedAt = Date.now();
  const payload = createHostedContainerDeterministicPayloadStream(input.byteLength);
  const response = await putHostedContainerDirectR2SmokePayload({
    byteLength: input.byteLength,
    payload: payload.stream,
    presignedPutUrl: input.presignedPutUrl,
    signal: input.signal,
    tlsCaCertificatePem: input.tlsCaCertificatePem,
  });
  return {
    byteLength: input.byteLength,
    durationMs: Date.now() - startedAt,
    ok: response.status >= 200 && response.status < 300,
    payloadSha256: payload.readSha256(),
    responseBodyBytes: response.bodyBytes,
    status: response.status,
  };
}

function createHostedContainerDeterministicPayloadStream(byteLength: number): {
  readSha256: () => string;
  stream: Readable;
} {
  const hash = createHash("sha256");
  let offset = 0;
  let digest: string | null = null;
  const stream = new Readable({
    read() {
      if (offset >= byteLength) {
        digest = hash.digest("hex");
        this.push(null);
        return;
      }

      const chunkLength = Math.min(
        HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_CHUNK_BYTES,
        byteLength - offset,
      );
      const chunk = Buffer.allocUnsafe(chunkLength);
      for (let index = 0; index < chunkLength; index += 1) {
        chunk[index] = (offset + index) & 0xff;
      }
      offset += chunkLength;
      hash.update(chunk);
      this.push(chunk);
    },
  });

  return {
    readSha256() {
      if (digest === null) {
        throw new Error("Direct R2 presigned PUT smoke payload digest was read before upload completed.");
      }
      return digest;
    },
    stream,
  };
}

async function putHostedContainerDirectR2SmokePayload(input: {
  byteLength: number;
  payload: Readable;
  presignedPutUrl: string;
  signal: AbortSignal;
  tlsCaCertificatePem?: string;
}): Promise<{ bodyBytes: number; status: number }> {
  const url = new URL(input.presignedPutUrl);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: { bodyBytes: number; status: number }): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.signal.removeEventListener("abort", abort);
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? { bodyBytes: 0, status: 0 });
    };
    const abort = (): void => {
      clientRequest.destroy(new Error("Direct R2 presigned PUT smoke aborted."));
    };
    const clientRequest = request(url, {
      ...(input.tlsCaCertificatePem ? { ca: input.tlsCaCertificatePem } : {}),
      headers: {
        "content-length": String(input.byteLength),
        "content-type": "application/octet-stream",
        "if-none-match": "*",
      },
      method: "PUT",
      signal: input.signal,
    }, (response) => {
      let bodyBytes = 0;
      response.on("data", (chunk) => {
        bodyBytes += Buffer.byteLength(chunk);
      });
      response.once("error", finish);
      response.once("end", () => {
        finish(undefined, {
          bodyBytes,
          status: response.statusCode ?? 0,
        });
      });
      response.resume();
    });

    input.signal.addEventListener("abort", abort, { once: true });
    clientRequest.once("error", finish);
    input.payload.once("error", finish);
    input.payload.pipe(clientRequest);
  });
}

async function runHostedContainerCodexShellSmoke(input: {
  signal: AbortSignal;
}): Promise<HostedContainerCodexShellSmokeResult> {
  return await withHostedContainerCodexSmokeWorkspace(
    HOSTED_CONTAINER_CODEX_SHELL_SMOKE_MODEL,
    async (workspace) =>
      await runHostedContainerCodexShellAppServerProbe({
        ...workspace,
        signal: input.signal,
      }),
  );
}

// The live model turn is deliberately a single non-interactive `codex exec`
// subprocess with exit-code semantics. Codex app-server RPC plumbing is
// already proven by the Codex shell smoke and the hosted-local E2E gates;
// the only boundary this step closes is real OpenAI auth/quota/network for
// one deployed model turn, so it stays as small as possible.
//
// The codex subprocess receives only the well-known injected-credential
// placeholder: managed-container egress to api.openai.com is intercepted by
// the Worker, which authorizes the deploy-smoke live-turn fence and injects
// the real Worker-owned OPENAI_API_KEY upstream, the same egress path
// production turns use. The raw key never enters the container.
async function runHostedContainerLiveModelTurnSmoke(input: {
  model: string;
  signal: AbortSignal;
}): Promise<HostedContainerLiveModelTurnSmokeResult> {
  return await withHostedContainerCodexSmokeWorkspace(input.model, async (workspace) =>
    await new Promise((resolve, reject) => {
      const startedAtMs = Date.now();
      let stdoutBytes = 0;
      let stdoutTail = "";
      let stderrBuffer = "";
      let settled = false;
      let timeout: NodeJS.Timeout | null = null;
      let abort: () => void = () => {};
      const child = spawn("codex", [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-",
      ], {
        cwd: workspace.smokeVaultRoot,
        env: buildHostedContainerCodexShellSmokeProcessEnv({
          ...workspace,
          liveProviderEgress: true,
        }),
        stdio: ["pipe", "pipe", "pipe"],
      });

      const finish = (error: Error | null, result?: HostedContainerLiveModelTurnSmokeResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        input.signal.removeEventListener("abort", abort);
        child.kill();
        if (error) {
          reject(error);
          return;
        }
        resolve(result ?? {
          durationMs: Date.now() - startedAtMs,
          model: input.model,
          stdoutBytes,
        });
      };

      abort = (): void => {
        finish(new Error("Hosted live model turn smoke aborted."));
      };
      timeout = setTimeout(() => {
        finish(new Error(
          "Hosted live model turn smoke timed out after "
            + `${HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_TIMEOUT_MS}ms. `
            + `stderrExcerpt=${JSON.stringify(buildHostedContainerLiveModelTurnSmokeSafeText(stderrBuffer))}`,
        ));
      }, HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_TIMEOUT_MS);
      input.signal.addEventListener("abort", abort, { once: true });

      child.stdout?.on("data", (chunk) => {
        const text = String(chunk);
        stdoutBytes += Buffer.byteLength(text);
        stdoutTail = `${stdoutTail}${text}`.slice(
          -HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDOUT_TAIL_MAX_CHARS,
        );
      });
      child.stderr?.on("data", (chunk) => {
        // Keep only a bounded prefix; the excerpt is re-capped on use.
        if (stderrBuffer.length < 4_096) {
          stderrBuffer += String(chunk);
        }
      });
      child.once("error", (error) => {
        finish(new Error(
          `Hosted live model turn smoke failed to spawn codex exec. ${error.message}`,
        ));
      });
      child.once("close", (code, signal) => {
        if (code === 0) {
          const outputText = readDeployLiveModelTurnSmokeCodexOutputText(stdoutTail);
          if (outputText !== DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT) {
            finish(new Error(
              "Hosted live model turn smoke did not return the expected output. "
                + `stdoutBytes=${stdoutBytes} `
                + `outputText=${JSON.stringify(buildHostedContainerLiveModelTurnSmokeSafeText(outputText ?? ""))}`,
            ));
            return;
          }
          finish(null, {
            durationMs: Date.now() - startedAtMs,
            model: input.model,
            stdoutBytes,
          });
          return;
        }
        finish(new Error(
          `Hosted live model turn smoke codex exec exited with ${code ?? signal ?? "unknown"}. `
            + `stdoutBytes=${stdoutBytes} `
            + `stderrExcerpt=${JSON.stringify(buildHostedContainerLiveModelTurnSmokeSafeText(
              stderrBuffer,
              HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDERR_EXCERPT_MAX_CHARS,
            ))} `
            + `stdoutExcerpt=${JSON.stringify(buildHostedContainerLiveModelTurnSmokeStdoutSafeText(stdoutTail))}`,
        ));
      });
      child.stdin?.end(DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT);
    }));
}

// Smoke failure text may embed Codex stdout/stderr. Keep only bounded,
// printable diagnostic text and scrub obvious credential shapes before the
// message leaves the container.
function buildHostedContainerLiveModelTurnSmokeSafeText(
  value: string,
  maxChars = HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_ERROR_MESSAGE_MAX_CHARS,
): string {
  return value
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s"',}]+/giu, "$1<REDACTED>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer <REDACTED>")
    .replace(
      /((?:api|auth|access|refresh|id)?[_-]?(?:token|secret|password|private[_-]?jwk|key)\s*[:=]\s*)[^\s"',}]+/giu,
      "$1<REDACTED>",
    )
    .replace(/\b(?:sk|pk|rk)-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gu, "<REDACTED>")
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_]{8,}\b/gu, "<REDACTED>")
    .replace(/\bwhsec[_-][A-Za-z0-9_-]{8,}\b/gu, "<REDACTED>")
    .replace(/\bgh[opsru]_[A-Za-z0-9_]{16,}\b/gu, "<REDACTED>")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{16,}\b/gu, "<REDACTED>")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu, "<REDACTED>")
    .replace(/[^\x20-\x7e]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxChars);
}

function buildHostedContainerLiveModelTurnSmokeStdoutSafeText(value: string): string {
  const extractedText = value
    .split(/\r?\n/gu)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return "";
        }
        const record = parsed as Record<string, unknown>;
        if (typeof record.message === "string") {
          return record.message;
        }
        const error = record.error;
        if (error && typeof error === "object" && !Array.isArray(error)) {
          const errorRecord = error as Record<string, unknown>;
          return typeof errorRecord.message === "string" ? errorRecord.message : "";
        }
      } catch {
        return "";
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .join(" ");
  return buildHostedContainerLiveModelTurnSmokeSafeText(
    extractedText,
    HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDOUT_EXCERPT_MAX_CHARS,
  );
}

async function withHostedContainerCodexSmokeWorkspace<T>(
  model: string,
  run: (workspace: { codexHome: string; smokeVaultRoot: string }) => Promise<T>,
): Promise<T> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-shell-smoke-"));
  let codexWorkspaceRoot: string | null = null;
  try {
    const codexSmokeHomeRoot = resolveHostedContainerCodexSmokeHomeRoot();
    await mkdir(codexSmokeHomeRoot, {
      mode: 0o700,
      recursive: true,
    });
    await chmod(codexSmokeHomeRoot, 0o700);
    codexWorkspaceRoot = await mkdtemp(path.join(
      codexSmokeHomeRoot,
      "hosted-codex-shell-smoke-",
    ));
    const codexHome = path.join(codexWorkspaceRoot, ".codex-smoke");
    const smokeVaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(codexHome, {
      mode: 0o700,
      recursive: true,
    });
    await chmod(codexHome, 0o700);
    await mkdir(smokeVaultRoot, {
      mode: 0o700,
      recursive: true,
    });
    await chmod(smokeVaultRoot, 0o700);
    await writeFile(
      path.join(smokeVaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-05-22T00:00:00.000Z",
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Hosted Codex Shell Smoke",
        vaultId: "vault_01JY0000000000000000000000",
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(smokeVaultRoot, "CORE.md"),
      [
        "---",
        "schemaVersion: hv/core@v1",
        "vaultId: vault_01JY0000000000000000000000",
        "title: Hosted Codex Shell Smoke",
        "---",
        "# Hosted Codex Shell Smoke",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(codexHome, "config.toml"),
      buildHostedContainerCodexShellSmokeConfig(model),
      { mode: 0o600 },
    );

    return await run({
      codexHome,
      smokeVaultRoot,
    });
  } finally {
    await Promise.all([
      rm(workspaceRoot, {
        force: true,
        recursive: true,
      }),
      ...(codexWorkspaceRoot ? [rm(codexWorkspaceRoot, {
        force: true,
        recursive: true,
      })] : []),
    ]);
  }
}

export function resolveHostedContainerCodexSmokeHomeRoot(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const base = normalizeAbsoluteHostedContainerPath(source.HOSTED_HOME)
    ?? normalizeAbsoluteHostedContainerPath(source.HOME)
    ?? normalizeAbsoluteHostedContainerPath(homedir());
  if (!base) {
    throw new Error("Hosted Codex shell smoke requires an absolute runner home directory.");
  }
  const smokeHomeRoot = path.join(base, HOSTED_CONTAINER_CODEX_SMOKE_HOME_DIRECTORY);
  if (isPathInside(smokeHomeRoot, tmpdir())) {
    throw new Error("Hosted Codex shell smoke CODEX_HOME parent must not be under the system temporary directory.");
  }
  return smokeHomeRoot;
}

function normalizeAbsoluteHostedContainerPath(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || !path.isAbsolute(normalized)) {
    return null;
  }
  return path.resolve(normalized);
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function buildHostedContainerCodexShellSmokeConfig(model: string): string {
  const modelCatalogJson = readHostedCodexModelCatalogJsonPath();

  return [
    `model = ${JSON.stringify(model)}`,
    ...(modelCatalogJson
      ? [`model_catalog_json = ${JSON.stringify(modelCatalogJson)}`]
      : []),
    'model_provider = "hosted-shell-smoke"',
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "check_for_update_on_startup = false",
    // Mirror the hosted runtime config: non-login shells so the smoke probe
    // exercises the same PATH semantics as production turns.
    "allow_login_shell = false",
    "",
    "[features]",
    "plugins = false",
    "multi_agent_v2 = true",
    "",
    '[model_providers."hosted-shell-smoke"]',
    'name = "OpenAI"',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    "supports_websockets = false",
    "request_max_retries = 4",
    "stream_max_retries = 5",
    "",
    "[skills]",
    "include_instructions = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    "[history]",
    'persistence = "none"',
    "",
    "[shell_environment_policy]",
    'inherit = "all"',
    'include_only = ["PATH", "VAULT", "HOME", "CODEX_HOME", "TMPDIR"]',
    "",
    "[shell_environment_policy.set]",
    `PATH = ${JSON.stringify(HOSTED_RUNNER_EXECUTABLE_PATH)}`,
    "",
  ].join("\n");
}

function readHostedCodexModelCatalogJsonPath(): string | null {
  const value = process.env[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

async function runHostedContainerCodexShellAppServerProbe(input: {
  codexHome: string;
  signal: AbortSignal;
  smokeVaultRoot: string;
}): Promise<HostedContainerCodexShellSmokeResult> {
  return await new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBytes = 0;
    let settled = false;
    let nextRequestId = 1;
    let timeout: NodeJS.Timeout | null = null;
    let abort: () => void = () => {};
    const pending = new Map<number, {
      label: string;
      reject: (error: Error) => void;
      resolve: (value: Record<string, unknown>) => void;
    }>();
    const child = spawn("codex", ["app-server"], {
      cwd: input.smokeVaultRoot,
      env: buildHostedContainerCodexShellSmokeProcessEnv(input),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (error?: Error, result?: HostedContainerCodexShellSmokeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      input.signal.removeEventListener("abort", abort);
      for (const request of pending.values()) {
        request.reject(error ?? new Error("Hosted Codex shell smoke stopped."));
      }
      pending.clear();
      try {
        child.stdin.end();
      } catch {
        // Best-effort cleanup for a diagnostic-only smoke process.
      }
      child.kill();
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? {
        client: "codex-app-server",
        cliSurfaceContractBytes: 0,
        cliSurfaceHotPathProofCount: 0,
        murphPathBytes: 0,
        noteAddBytes: 0,
        stderrBytes,
        vaultCliLlmsBytes: 0,
        vaultCliPathBytes: 0,
        vaultShowBytes: 0,
      });
    };

    const fail = (error: Error): void => {
      finish(error);
    };

    abort = (): void => {
      fail(new Error("Hosted Codex shell smoke aborted."));
    };
    timeout = setTimeout(() => {
      fail(new Error(`Hosted Codex shell smoke timed out. stderrBytes=${stderrBytes}`));
    }, HOSTED_CONTAINER_CODEX_SHELL_SMOKE_TIMEOUT_MS);

    input.signal.addEventListener("abort", abort, { once: true });
    child.stderr?.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
    });
    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          fail(new Error("Hosted Codex shell smoke app-server emitted malformed JSON."));
          return;
        }
        const message = readHostedContainerCodexRpcMessage(parsed);
        if (typeof message.id !== "number") {
          continue;
        }
        const request = pending.get(message.id);
        if (!request) {
          continue;
        }
        pending.delete(message.id);
        if (message.error !== undefined) {
          request.reject(new Error(
            `Hosted Codex shell smoke request failed for ${request.label}. `
              + `errorBytes=${Buffer.byteLength(JSON.stringify(message.error), "utf8")}`,
          ));
          continue;
        }
        request.resolve(message);
      }
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (!settled) {
        fail(new Error(
          `Hosted Codex shell smoke app-server exited early with ${code ?? signal ?? "unknown"}. `
            + `stderrBytes=${stderrBytes}`,
        ));
      }
    });

    const sendRequest = (
      label: string,
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const id = nextRequestId;
      nextRequestId += 1;
      return new Promise((requestResolve, requestReject) => {
        pending.set(id, {
          label,
          reject: requestReject,
          resolve: requestResolve,
        });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
          if (!error) {
            return;
          }
          pending.delete(id);
          requestReject(error);
          fail(new Error(`Hosted Codex shell smoke failed to write ${label}.`));
        });
      });
    };

    const sendNotification = (method: string, params: Record<string, unknown>): void => {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    };

    const execCommand = async (
      label: string,
      command: readonly string[],
    ): Promise<HostedContainerCodexCommandExecResult> => {
      const message = await sendRequest(label, "command/exec", {
        command,
        timeoutMs: 15_000,
      });
      const result = readHostedContainerCodexCommandExecResult(message.result);
      if (result.exitCode !== 0) {
        throw new Error(
          `Hosted Codex shell smoke command failed for ${label}. `
            + `exitCode=${result.exitCode} stdoutBytes=${Buffer.byteLength(result.stdout, "utf8")} `
            + `stderrBytes=${Buffer.byteLength(result.stderr, "utf8")}`,
        );
      }
      return result;
    };

    void (async () => {
      await sendRequest("initialize", "initialize", {
        clientInfo: {
          name: "hosted-codex-shell-smoke",
          version: "1",
        },
      });
      sendNotification("initialized", {});
      const environmentProbe = readHostedContainerCodexShellEnvironmentProbe(
        (await execCommand("environment-probe", [
          "node",
          "-e",
          buildHostedContainerCodexShellEnvironmentProbeScript(),
          input.smokeVaultRoot,
        ])).stdout,
      );
      const vaultCliLlms = await execCommand("vault-cli-llms", [
        "vault-cli",
        "--llms",
        "--format",
        "json",
      ]);
      const cliSurface = await runHostedContainerCliSurfaceContractSmoke();
      const vaultShow = await execCommand("vault-show", [
        "vault-cli",
        "vault",
        "show",
        "--format",
        "json",
      ]);
      const noteAdd = await execCommand("event-note-add", [
        "vault-cli",
        "event",
        "note",
        "add",
        "--note",
        "Hosted deploy smoke note",
        "--format",
        "json",
      ]);
      finish(undefined, {
        client: "codex-app-server",
        cliSurfaceContractBytes: cliSurface.contractBytes,
        cliSurfaceHotPathProofCount: cliSurface.hotPathProofCount,
        murphPathBytes: environmentProbe.murphPathBytes,
        noteAddBytes: Buffer.byteLength(noteAdd.stdout, "utf8"),
        stderrBytes,
        vaultCliLlmsBytes: Buffer.byteLength(vaultCliLlms.stdout, "utf8"),
        vaultCliPathBytes: environmentProbe.vaultCliPathBytes,
        vaultShowBytes: Buffer.byteLength(vaultShow.stdout, "utf8"),
      });
    })().catch((error: unknown) => {
      fail(error instanceof Error ? error : new Error("Hosted Codex shell smoke failed."));
    });
  });
}

async function runHostedContainerCliSurfaceContractSmoke(): Promise<{
  contractBytes: number;
  hotPathProofCount: number;
}> {
  // Deploy-smoke-only modules: loaded lazily so the cold-boot job path never
  // pays their module-evaluation cost.
  const [
    { readHostedAssistantCliSurfaceBootstrapContext },
    {
      HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
      countAssistantCliSurfaceHotPathProofs,
    },
  ] = await Promise.all([
    import("@murphai/assistant-runtime/hosted-assistant-bootstrap"),
    import("./hosted-runner-smoke-contract.ts"),
  ]);
  const contract = await readHostedAssistantCliSurfaceBootstrapContext();
  if (!contract) {
    throw new Error("Hosted Codex shell smoke assistant CLI surface contract was missing.");
  }

  const hotPathProofCount = countAssistantCliSurfaceHotPathProofs(contract);
  if (hotPathProofCount < HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT) {
    throw new Error(
      `Hosted Codex shell smoke assistant CLI surface contract was missing hot-path schemas. proofCount=${hotPathProofCount}`,
    );
  }

  return {
    contractBytes: Buffer.byteLength(contract, "utf8"),
    hotPathProofCount,
  };
}

function buildHostedContainerCodexShellSmokeProcessEnv(input: {
  codexHome: string;
  liveProviderEgress?: boolean;
  smokeVaultRoot: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    CODEX_HOME: input.codexHome,
    HOME: path.dirname(input.smokeVaultRoot),
    // The live-turn smoke sends the well-known injected-credential
    // placeholder so the Worker egress intercept swaps in the real key,
    // exactly like production turns. The app-server shell smoke keeps a
    // local-only fake instead, proving no provider credential reaches its
    // command env.
    OPENAI_API_KEY: input.liveProviderEgress
      ? HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL
      : "hosted-codex-shell-smoke-secret",
    PATH: buildHostedRunnerExecutablePath(process.env.PATH),
    TMPDIR: path.dirname(input.smokeVaultRoot),
    VAULT: input.smokeVaultRoot,
  };

  if (input.liveProviderEgress) {
    // codex must trust the Cloudflare container egress-interception CA to
    // reach api.openai.com through the Worker.
    for (const key of HOSTED_RUNNER_CONTAINER_CA_ENV_KEYS) {
      copyOptionalHostedContainerSmokeEnv(env, key);
    }
  }
  copyOptionalHostedContainerSmokeEnv(env, "CI");
  copyOptionalHostedContainerSmokeEnv(env, "COLORTERM");
  copyOptionalHostedContainerSmokeEnv(env, "FORCE_COLOR");
  copyOptionalHostedContainerSmokeEnv(env, "LANG");
  copyOptionalHostedContainerSmokeEnv(env, "LC_ALL");
  copyOptionalHostedContainerSmokeEnv(env, "LC_CTYPE");
  copyOptionalHostedContainerSmokeEnv(env, "NO_COLOR");
  copyOptionalHostedContainerSmokeEnv(env, "TERM");
  return env;
}

function buildHostedContainerCodexShellEnvironmentProbeScript(): string {
  return `
const fs = require("node:fs");
const path = require("node:path");
const expectedVaultRoot = process.argv[1];
function findExecutable(name) {
  const pathValue = process.env.PATH || "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}
process.stdout.write(JSON.stringify({
  murphPathBytes: Buffer.byteLength(findExecutable("murph"), "utf8"),
  providerCredentialPresent: Boolean(process.env.OPENAI_API_KEY),
  vaultCliPathBytes: Buffer.byteLength(findExecutable("vault-cli"), "utf8"),
  vaultRootInherited: process.env.VAULT === expectedVaultRoot,
}));
`;
}

function readHostedContainerCodexShellEnvironmentProbe(stdout: string): {
  murphPathBytes: number;
  vaultCliPathBytes: number;
} {
  const record = readHostedContainerJsonObject(stdout, "Hosted Codex shell environment probe");
  const murphPathBytes = readHostedContainerPositiveNumber(
    record.murphPathBytes,
    "Hosted Codex shell environment probe.murphPathBytes",
  );
  const vaultCliPathBytes = readHostedContainerPositiveNumber(
    record.vaultCliPathBytes,
    "Hosted Codex shell environment probe.vaultCliPathBytes",
  );
  if (record.vaultRootInherited !== true) {
    throw new Error("Hosted Codex shell smoke did not inherit VAULT.");
  }
  if (record.providerCredentialPresent === true) {
    throw new Error("Hosted Codex shell smoke leaked provider credentials into command env.");
  }
  return {
    murphPathBytes,
    vaultCliPathBytes,
  };
}

function readHostedContainerCodexRpcMessage(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted Codex shell smoke RPC message must be an object.");
  }
  return value as Record<string, unknown>;
}

function readHostedContainerCodexCommandExecResult(
  value: unknown,
): HostedContainerCodexCommandExecResult {
  const record = readHostedContainerRecord(value, "Hosted Codex command result");
  const exitCode = record.exitCode;
  const stdout = record.stdout;
  const stderr = record.stderr;
  if (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode)) {
    throw new TypeError("Hosted Codex command result.exitCode must be an integer.");
  }
  if (typeof stdout !== "string") {
    throw new TypeError("Hosted Codex command result.stdout must be a string.");
  }
  if (typeof stderr !== "string") {
    throw new TypeError("Hosted Codex command result.stderr must be a string.");
  }
  return {
    exitCode,
    stderr,
    stdout,
  };
}

function readHostedContainerJsonObject(
  value: string,
  label: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SyntaxError(`${label} was not valid JSON.`);
  }
  return readHostedContainerRecord(parsed, label);
}

function readHostedContainerRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readHostedContainerPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive number.`);
  }
  return value;
}

function copyOptionalHostedContainerSmokeEnv(
  target: NodeJS.ProcessEnv,
  name: string,
): void {
  const value = process.env[name];
  if (typeof value === "string" && value.length > 0) {
    target[name] = value;
  }
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
    ...(typeof manifest.schemaVersion === "number" ? { schemaVersion: manifest.schemaVersion } : {}),
    ...(typeof manifest.sourceFingerprint === "string" ? { sourceFingerprint: manifest.sourceFingerprint } : {}),
  };
}

async function stopWarmCodexWithLifecycleLog(
  runtime: HostedContainerRuntimeDependencies,
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

function createCachedHostedContainerLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let loader: Promise<T> | null = null;

  return async () => {
    loader ??= load();
    return await loader;
  };
}

async function loadHostedContainerRuntimeContracts(): Promise<
  typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")
> {
  hostedContainerRuntimeContractsLoader ??=
    import("@murphai/assistant-runtime/hosted-runtime-contracts");
  return await hostedContainerRuntimeContractsLoader;
}
