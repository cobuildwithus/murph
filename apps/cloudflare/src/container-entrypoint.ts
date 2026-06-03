import { createHash } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
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
import type {
  HostedExpectedCodexRootProcess,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedRunnerExecutablePath,
  HOSTED_RUNNER_EXECUTABLE_PATH,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  consumeHostedCliRuntimeBridgeOffInvocationViolation,
  stopHostedCliRuntimeBridge,
} from "@murphai/assistant-runtime/hosted-invocation";
import {
  snapshotExpectedHostedCodexRootProcess,
  stopHostedWarmCodexAppServer,
} from "@murphai/assistant-engine/hosted-codex-lifecycle";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "./hosted-runtime-architecture.ts";
import {
  runHostedWorkspaceInvocation as runHostedWorkspaceInvocationDirect,
} from "./hosted-workspace-invocation.ts";
import {
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionRunnerJobInput,
} from "./runner-job-transport.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "./runner-outbound/headers.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";
import type {
  RunnerRuntimeWriteFenceToken,
} from "./runner-outbound/write-fence.ts";

const HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const HOSTED_CONTAINER_ACTIVE_DIAGNOSTIC_INTERVAL_MS = 15_000;
const HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_PATH =
  "/internal/deploy-openai-intercept-smoke";
const HOSTED_CONTAINER_CODEX_SHELL_SMOKE_PATH =
  "/internal/deploy-codex-shell-smoke";
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_SMOKE_PATH =
  "/internal/direct-r2-presigned-put-smoke";
const HOSTED_CONTAINER_PROVIDER_EGRESS_ACTIVE_CONTAINER_PROBE_PATH =
  "/internal/provider-egress-active-container-probe";
const HOSTED_CONTAINER_RUNTIME_WAKE_PATH = "/internal/runtime-wake";
const HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_TIMEOUT_MS = 120_000;
const HOSTED_CONTAINER_CODEX_SHELL_SMOKE_TIMEOUT_MS = 45_000;
const HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_MODEL = "gpt-5.4-mini";
const HOSTED_CONTAINER_CODEX_SHELL_SMOKE_MODEL = "gpt-5.4-mini";
const HOSTED_CONTAINER_LINQ_DEFAULT_API_BASE_URL =
  "https://api.linqapp.com/api/partner/v3";
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_DEFAULT_BYTES = 150 * 1024 * 1024;
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_MAX_BYTES = 512 * 1024 * 1024;
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_CHUNK_BYTES = 1024 * 1024;
const HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_API_KEY_SENTINEL =
  "__cloudflare_injected__";
const HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH =
  "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

type HostedContainerRuntimeAuthority = RunnerRuntimeWriteFenceToken & {
  leaseGeneration: string;
  userId: string;
  workspaceVersion: string;
};

interface HostedContainerProcessDirectoryEntryLike {
  isDirectory(): boolean;
  name: string;
}

interface HostedContainerProcessApi {
  kill(pid: number, signal: NodeJS.Signals): void;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string): Promise<HostedContainerProcessDirectoryEntryLike[]>;
}

const defaultHostedContainerProcessApi: HostedContainerProcessApi = {
  kill(pid, signal) {
    process.kill(pid, signal);
  },
  async readFile(path, encoding) {
    return await readFile(path, encoding);
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
  consumeCliBridgeOffInvocationViolation?: () => Promise<boolean>;
  exitScheduler?: () => void;
  loadRuntimeContracts?:
    () => Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>;
  processApi?: Partial<HostedContainerProcessApi>;
  processIsolation?: boolean;
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
  stopCliRuntimeBridge?: (reason: string) => Promise<void>;
  snapshotExpectedCodexRootProcess?: () => Promise<HostedExpectedCodexRootProcess | null>;
  stopWarmCodex?: (reason: string) => Promise<void>;
  runOpenAiInterceptSmoke?: (
    options: { authority: HostedContainerRuntimeAuthority; signal: AbortSignal },
  ) => Promise<HostedContainerOpenAiInterceptSmokeResult>;
}

interface HostedContainerRuntimeDependencies {
  consumeCliBridgeOffInvocationViolation: () => Promise<boolean>;
  exitScheduler: () => void;
  loadRuntimeContracts:
    () => Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>;
  processApi: HostedContainerProcessApi;
  processIsolation: boolean;
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
  stopCliRuntimeBridge: (reason: string) => Promise<void>;
  snapshotExpectedCodexRootProcess: () => Promise<HostedExpectedCodexRootProcess | null>;
  stopWarmCodex: (reason: string) => Promise<void>;
  runOpenAiInterceptSmoke:
    (options: {
      authority: HostedContainerRuntimeAuthority;
      signal: AbortSignal;
    }) => Promise<HostedContainerOpenAiInterceptSmokeResult>;
}

interface HostedContainerOpenAiInterceptSmokeResult {
  client: "codex";
  model: string;
  stderrBytes: number;
  stdoutBytes: number;
}

interface HostedContainerCodexShellSmokeResult {
  client: "codex-app-server";
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

class HostedRunnerShellIsolationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HostedRunnerShellIsolationError";
  }
}

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

interface HostedContainerProcessState {
  commandLineDigest: string | null;
  ppid: number | null;
  processGroupId: number | null;
  startTimeTicksFromProcStat: string | null;
  state: string | null;
  uid: number | null;
}

interface HostedContainerProcessSnapshot {
  pids: Set<number>;
  rootUid: number | null;
}

interface HostedContainerProcessIsolationResult {
  killedExpectedCodexRoot: boolean;
  killedPids: number[];
}

type HostedContainerCleanupStatus = "not_run" | "passed" | "failed";

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
  let hostedContainerPoisoned = false;
  let lastCleanupStatus: HostedContainerCleanupStatus = "not_run";
  let activeRuntimeWake: (() => boolean) | null = null;
  let activeRuntimeWakeAttemptId: string | null = null;
  let activeRuntimeWakePending = false;
  let activeRuntimeWakePendingAttemptId: string | null = null;
  const server = createServer(async (request, response) => {
    response.setHeader("connection", "close");
    const requestAbort = createRequestAbortController(request, response);
    let claimedRunnerSlot = false;
    let runtimeWakeForRequest: (() => boolean) | null = null;
    let job: HostedExecutionRunnerJobInput | null = null;
    let stopActiveJobDiagnostics: (() => void) | null = null;
    let cleanupPassedForRequest = false;
    let directInvocationReturned = false;
    let resultDelivered = false;

    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
          activeJobCount: activeHostedRunnerJobCount,
          hostedRuntimeArchitectureVersion:
            runtime.startupConfig.hostedRuntimeArchitectureVersion,
          lastCleanupStatus,
          ok: true,
          poisoned: hostedContainerPoisoned,
          service: "cloudflare-hosted-runner-node",
          ...(runnerBundle ? { runnerBundle } : {}),
        }));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === HOSTED_CONTAINER_RUNTIME_WAKE_PATH) {
        discardUnreadRequestBody(request);
        const wake = activeRuntimeWake;
        let pending = false;
        let accepted = wake?.() === true;
        if (!accepted && wake === null && activeRuntimeWakePendingAttemptId !== null) {
          activeRuntimeWakePending = true;
          pending = true;
          accepted = true;
        }
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            activeHostedRunnerJobCount,
            activeRuntimeWakePending,
            activeRuntimeWakePresent: wake !== null,
            runtimeWakeAccepted: accepted,
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
        if (pending) {
          response.setHeader("x-runtime-wake-pending", "1");
        }
        response.statusCode = 204;
        response.end();
        return;
      }

      const isOpenAiInterceptSmokeRequest =
        request.method === "POST" && requestUrl.pathname === HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_PATH;
      const isCodexShellSmokeRequest =
        request.method === "POST" && requestUrl.pathname === HOSTED_CONTAINER_CODEX_SHELL_SMOKE_PATH;
      const isDirectR2PresignedPutSmokeRequest =
        request.method === "POST"
        && requestUrl.pathname === HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_SMOKE_PATH;
      const isProviderEgressActiveContainerProbeRequest =
        request.method === "POST"
        && requestUrl.pathname === HOSTED_CONTAINER_PROVIDER_EGRESS_ACTIVE_CONTAINER_PROBE_PATH;
      const isWorkspaceInvocationRequest =
        request.method === "POST" && requestUrl.pathname === "/internal/workspace-invocation";

      if (
        !isWorkspaceInvocationRequest
        && !isOpenAiInterceptSmokeRequest
        && !isCodexShellSmokeRequest
        && !isDirectR2PresignedPutSmokeRequest
        && !isProviderEgressActiveContainerProbeRequest
      ) {
        discardUnreadRequestBody(request);
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      if (isProviderEgressActiveContainerProbeRequest) {
        const boundUserId = readSingleHeaderValue(request, HOSTED_RUNNER_BOUND_USER_ID_HEADER);
        discardUnreadRequestBody(request);
        if (!boundUserId) {
          writeJsonResponse(response, 401, {
            error: "Hosted provider egress active-container probe requires a bound user.",
          });
          return;
        }
        const result = await runHostedContainerProviderEgressActiveContainerProbe({
          boundUserId,
          signal: requestAbort.signal,
        }).catch((error) => createHostedContainerProviderEgressProbeFailure(error));
        writeJsonResponse(response, result.ok === true ? 200 : 500, result);
        return;
      }

      if (isOpenAiInterceptSmokeRequest) {
        if (activeHostedRunnerJobCount > 0) {
          discardUnreadRequestBody(request);
          writeJsonResponse(response, 409, {
            error: "Hosted runner is busy.",
          });
          return;
        }
        activeHostedRunnerJobCount += 1;
        claimedRunnerSlot = true;
        const authority = readHostedContainerOpenAiInterceptSmokeAuthority(request);
        discardUnreadRequestBody(request);
        if (!authority) {
          writeJsonResponse(response, 401, {
            error: "Hosted OpenAI intercept smoke requires a runtime write fence.",
          });
          return;
        }
        const result = await runtime.runOpenAiInterceptSmoke({
          authority,
          signal: requestAbort.signal,
        });
        writeJsonResponse(response, 200, {
          ok: true,
          openAiIntercept: result,
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
        const result = await runtime.runCodexShellSmoke({
          signal: requestAbort.signal,
        });
        writeJsonResponse(response, 200, {
          codexShell: result,
          ok: true,
        });
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
      stopActiveJobDiagnostics = startHostedContainerActiveJobDiagnostics({
        job,
        processApi: runtime.processApi,
      });

      const result = await runHostedWorkspaceInvocationWithProcessIsolation(job, runtime, {
        onRuntimeWakeReady(sendWake) {
          activeRuntimeWake = sendWake;
          activeRuntimeWakeAttemptId = job
            ? readHostedContainerWorkspaceAttemptId(job)
            : null;
          runtimeWakeForRequest = sendWake;
          const pendingWake = activeRuntimeWakePending;
          activeRuntimeWakePending = false;
          emitHostedExecutionStructuredLog({
            component: "container",
            details: {
              activeHostedRunnerJobCount,
              activeRuntimeWakePresent: true,
              pendingRuntimeWakeDelivered: pendingWake ? sendWake() : false,
              workspaceAttemptId: activeRuntimeWakeAttemptId,
            },
            message: "Hosted container invocation reported runtime wake readiness.",
            phase: "wake.running",
            userId: null,
          });
        },
        onCleanupStatus(status) {
          lastCleanupStatus = status;
          cleanupPassedForRequest = status === "passed";
          if (status === "failed") {
            hostedContainerPoisoned = true;
          }
        },
        signal: requestAbort.signal,
      });
      directInvocationReturned = true;

      if (requestAbort.signal.aborted || response.destroyed) {
        return;
      }

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
      resultDelivered = true;
    } catch (error) {
      if (requestAbort.signal.aborted || response.destroyed) {
        return;
      }

      emitHostedExecutionStructuredLog({
        component: "container",
        details: buildHostedContainerRunnerJobErrorMetadata(error),
        level: "error",
        message: "Hosted container entrypoint failed a runner job.",
        phase: "failed",
        userId: null,
      });
      if (error instanceof HostedRunnerShellIsolationError) {
        hostedContainerPoisoned = true;
        runtime.exitScheduler();
      }
      const classified = classifyRunnerJobError(error);
      writeJsonResponse(response, classified.statusCode, classified.payload);
    } finally {
      if (
        job
        && !resultDelivered
        && (requestAbort.signal.aborted || response.destroyed)
        && !(directInvocationReturned && cleanupPassedForRequest)
      ) {
        hostedContainerPoisoned = true;
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            cleanupPassed: cleanupPassedForRequest,
            directInvocationReturned,
            resultDelivered,
          },
          level: "error",
          message: "Hosted container entrypoint poisoned after an ambiguous aborted runner job.",
          phase: "failed",
          userId: readHostedExecutionRunnerJobUserId(job),
        });
        runtime.exitScheduler();
      }
      stopActiveJobDiagnostics?.();
      if (runtimeWakeForRequest && activeRuntimeWake === runtimeWakeForRequest) {
        activeRuntimeWake = null;
        activeRuntimeWakeAttemptId = null;
      }
      if (
        job
        && activeRuntimeWakePendingAttemptId === readHostedContainerWorkspaceAttemptId(job)
      ) {
        activeRuntimeWakePending = false;
        activeRuntimeWakePendingAttemptId = null;
      }
      if (claimedRunnerSlot) {
        activeHostedRunnerJobCount = Math.max(0, activeHostedRunnerJobCount - 1);
      }
      requestAbort.cleanup();
    }
  });

  server.once("close", () => {
    void runtime.stopCliRuntimeBridge("container-server-close").catch((error) => {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: buildHostedContainerRunnerJobErrorMetadata(error),
        level: "warn",
        message: "Hosted container entrypoint failed to stop CLI runtime bridge on server close.",
        phase: "failed",
        userId: null,
      });
    });
    void runtime.stopWarmCodex("container-server-close").catch((error) => {
      emitHostedExecutionStructuredLog({
        component: "container",
        details: buildHostedContainerRunnerJobErrorMetadata(error),
        level: "warn",
        message: "Hosted container entrypoint failed to stop warm Codex on server close.",
        phase: "failed",
        userId: null,
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 8080, "0.0.0.0", () => resolve());
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
  void startHostedContainerEntrypointCli().catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "container",
      error,
      level: "error",
      message: "Hosted container entrypoint failed to start.",
      phase: "failed",
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

async function startHostedContainerEntrypointCli(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

  await startHostedContainerEntrypoint({
    port,
    runtime: {
      processIsolation: true,
    },
  });
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

function discardUnreadRequestBody(request: IncomingMessage): void {
  if (!request.readableEnded && !request.destroyed) {
    request.resume();
  }
}

function readHostedContainerOpenAiInterceptSmokeAuthority(
  request: IncomingMessage,
): HostedContainerRuntimeAuthority | null {
  const userId = readSingleHeaderValue(request, HOSTED_RUNNER_BOUND_USER_ID_HEADER);
  const attemptId = readSingleHeaderValue(request, HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
  const leaseGeneration = readSingleHeaderValue(
    request,
    HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  );
  const workspaceVersion = readSingleHeaderValue(
    request,
    HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  );

  if (!userId || !attemptId || !leaseGeneration || !workspaceVersion) {
    return null;
  }

  return {
    attemptId,
    leaseGeneration,
    userId,
    workspaceVersion,
  };
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

function readSingleHeaderValue(
  request: IncomingMessage,
  name: string,
): string | null {
  const value = request.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = typeof raw === "string" ? raw.trim() : "";
  return normalized.length > 0 ? normalized : null;
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
    consumeCliBridgeOffInvocationViolation:
      runtime?.consumeCliBridgeOffInvocationViolation
      ?? consumeHostedCliRuntimeBridgeOffInvocationViolation,
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
    processIsolation: runtime?.processIsolation ?? false,
    runWorkspaceInvocation: runtime?.runWorkspaceInvocation ?? runHostedWorkspaceInvocationDirect,
    startupConfig,
    runDirectR2PresignedPutSmoke:
      runtime?.runDirectR2PresignedPutSmoke ?? runHostedContainerDirectR2PresignedPutSmoke,
    runCodexShellSmoke:
      runtime?.runCodexShellSmoke ?? runHostedContainerCodexShellSmoke,
    stopCliRuntimeBridge:
      runtime?.stopCliRuntimeBridge ?? stopHostedCliRuntimeBridge,
    snapshotExpectedCodexRootProcess:
      runtime?.snapshotExpectedCodexRootProcess ?? snapshotExpectedHostedCodexRootProcess,
    stopWarmCodex:
      runtime?.stopWarmCodex ?? stopHostedWarmCodexAppServer,
    runOpenAiInterceptSmoke:
      runtime?.runOpenAiInterceptSmoke ?? runHostedContainerOpenAiInterceptSmoke,
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
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-shell-smoke-"));
  try {
    const codexHome = path.join(workspaceRoot, ".codex-smoke");
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
        formatVersion: 1,
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
      buildHostedContainerCodexShellSmokeConfig(),
      { mode: 0o600 },
    );

    return await runHostedContainerCodexShellAppServerProbe({
      codexHome,
      signal: input.signal,
      smokeVaultRoot,
    });
  } finally {
    await rm(workspaceRoot, {
      force: true,
      recursive: true,
    });
  }
}

function buildHostedContainerCodexShellSmokeConfig(): string {
  return [
    `model = ${JSON.stringify(HOSTED_CONTAINER_CODEX_SHELL_SMOKE_MODEL)}`,
    'model_provider = "hosted-shell-smoke"',
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "",
    '[model_providers."hosted-shell-smoke"]',
    'name = "OpenAI"',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    "request_max_retries = 0",
    "stream_max_retries = 0",
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

function buildHostedContainerCodexShellSmokeProcessEnv(input: {
  codexHome: string;
  smokeVaultRoot: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    CODEX_HOME: input.codexHome,
    HOME: path.dirname(input.smokeVaultRoot),
    OPENAI_API_KEY: "hosted-codex-shell-smoke-secret",
    PATH: buildHostedRunnerExecutablePath(process.env.PATH),
    TMPDIR: path.dirname(input.smokeVaultRoot),
    VAULT: input.smokeVaultRoot,
  };

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

async function runHostedContainerProviderEgressActiveContainerProbe(input: {
  boundUserId: string;
  signal: AbortSignal;
}): Promise<Record<string, unknown>> {
  const response = await fetch(createHostedContainerLinqPhoneNumbersUrl(), {
    headers: {
      authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
      [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: input.boundUserId,
    },
    method: "GET",
    signal: input.signal,
  });
  const body = await response.arrayBuffer();
  return {
    ok: true,
    probeOrigin: "container",
    providerRequestOk: response.ok,
    providerRequestStatus: response.status,
    responseBodyBytes: body.byteLength,
    runtimeAuthorityHeadersPresent: false,
    writeFenceValidationMode: "active_container",
  };
}

function createHostedContainerProviderEgressProbeFailure(error: unknown): Record<string, unknown> {
  const details = buildHostedExecutionSafeErrorDetails(error);
  const errorName = readHostedExecutionSafeErrorName(error);
  return {
    ok: false,
    probeOrigin: "container",
    providerRequestOk: false,
    providerRequestStatus: null,
    responseBodyBytes: null,
    runtimeAuthorityHeadersPresent: false,
    writeFenceValidationMode: "active_container",
    ...(details ? { details } : {}),
    error: summarizeHostedExecutionError(error),
    ...(errorName ? { errorName } : {}),
  };
}

function createHostedContainerLinqPhoneNumbersUrl(): URL {
  const url = new URL(HOSTED_CONTAINER_LINQ_DEFAULT_API_BASE_URL);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/phone_numbers`;
  url.search = "";
  url.hash = "";
  return url;
}

async function runHostedContainerOpenAiInterceptSmoke(input: {
  authority: HostedContainerRuntimeAuthority;
  signal: AbortSignal;
}): Promise<HostedContainerOpenAiInterceptSmokeResult> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-openai-intercept-smoke-"));
  try {
    const codexHome = path.join(workspaceRoot, ".codex-smoke");
    await mkdir(codexHome, {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(
      path.join(workspaceRoot, "README.md"),
      "Hosted OpenAI intercept smoke workspace.\n",
      "utf8",
    );
    await writeFile(
      path.join(codexHome, "config.toml"),
      buildHostedContainerOpenAiInterceptSmokeCodexConfig(),
      "utf8",
    );
    const result = await runHostedContainerOpenAiInterceptCodexProbe({
      codexHome,
      signal: input.signal,
      workspaceRoot,
    });
    return {
      client: "codex",
      model: HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_MODEL,
      stderrBytes: result.stderrBytes,
      stdoutBytes: result.stdoutBytes,
    };
  } finally {
    await rm(workspaceRoot, {
      force: true,
      recursive: true,
    });
  }
}

function buildHostedContainerOpenAiInterceptSmokeCodexConfig(): string {
  return [
    `model = ${JSON.stringify(HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_MODEL)}`,
    'model_provider = "hosted-openai"',
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    "",
    '[model_providers."hosted-openai"]',
    'name = "OpenAI"',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    "request_max_retries = 0",
    "stream_max_retries = 0",
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
  ].join("\n");
}

async function runHostedContainerOpenAiInterceptCodexProbe(input: {
  codexHome: string;
  signal: AbortSignal;
  workspaceRoot: string;
}): Promise<{ stderrBytes: number; stdoutBytes: number }> {
  return await new Promise((resolve, reject) => {
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    let abort: () => void = () => {};
    const child = spawn("codex", [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      "-C",
      input.workspaceRoot,
      "-a",
      "never",
      "-s",
      "read-only",
      "Reply exactly OK. Do not run tools or inspect files.",
    ], {
      env: buildHostedContainerOpenAiInterceptSmokeProcessEnv(input),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (error?: Error, result?: { stderrBytes: number; stdoutBytes: number }): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      input.signal.removeEventListener("abort", abort);
      if (error) {
        child.kill();
        reject(error);
        return;
      }
      resolve(result ?? { stderrBytes, stdoutBytes });
    };
    abort = (): void => {
      finish(new Error("Hosted OpenAI intercept smoke aborted."));
    };
    timeout = setTimeout(() => {
      finish(new Error("Hosted OpenAI intercept smoke timed out."));
    }, HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_TIMEOUT_MS);

    input.signal.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
    });
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish(undefined, { stderrBytes, stdoutBytes });
        return;
      }
      finish(new Error(
        `Hosted OpenAI intercept smoke Codex probe exited with ${code ?? signal ?? "unknown"}. `
          + `stdoutBytes=${stdoutBytes} stderrBytes=${stderrBytes}`,
      ));
    });
  });
}

function buildHostedContainerOpenAiInterceptSmokeProcessEnv(input: {
  codexHome: string;
  workspaceRoot: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    CODEX_CA_CERTIFICATE:
      process.env.CODEX_CA_CERTIFICATE ?? HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH,
    CODEX_HOME: input.codexHome,
    CURL_CA_BUNDLE:
      process.env.CURL_CA_BUNDLE ?? HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH,
    HOME: input.workspaceRoot,
    NODE_EXTRA_CA_CERTS:
      process.env.NODE_EXTRA_CA_CERTS ?? HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH,
    OPENAI_API_KEY: HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_API_KEY_SENTINEL,
    PATH: buildHostedRunnerExecutablePath(process.env.PATH),
    REQUESTS_CA_BUNDLE:
      process.env.REQUESTS_CA_BUNDLE ?? HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH,
    SSL_CERT_FILE:
      process.env.SSL_CERT_FILE ?? HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH,
    TMPDIR: input.workspaceRoot,
  };

  copyOptionalHostedContainerSmokeEnv(env, "ALL_PROXY");
  copyOptionalHostedContainerSmokeEnv(env, "CI");
  copyOptionalHostedContainerSmokeEnv(env, "COLORTERM");
  copyOptionalHostedContainerSmokeEnv(env, "FORCE_COLOR");
  copyOptionalHostedContainerSmokeEnv(env, "HTTP_PROXY");
  copyOptionalHostedContainerSmokeEnv(env, "HTTPS_PROXY");
  copyOptionalHostedContainerSmokeEnv(env, "LANG");
  copyOptionalHostedContainerSmokeEnv(env, "LC_ALL");
  copyOptionalHostedContainerSmokeEnv(env, "LC_CTYPE");
  copyOptionalHostedContainerSmokeEnv(env, "NO_PROXY");
  copyOptionalHostedContainerSmokeEnv(env, "NO_COLOR");
  copyOptionalHostedContainerSmokeEnv(env, "SSL_CERT_DIR");
  copyOptionalHostedContainerSmokeEnv(env, "TERM");
  copyOptionalHostedContainerSmokeEnv(env, "TEMP");
  copyOptionalHostedContainerSmokeEnv(env, "TMP");

  return env;
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

async function enforceHostedContainerProcessIsolation(
  processApi: HostedContainerProcessApi,
  baseline: HostedContainerProcessSnapshot,
  expectedCodexRoot: HostedExpectedCodexRootProcess | null,
): Promise<HostedContainerProcessIsolationResult> {
  if (process.platform === "win32") {
    return {
      killedExpectedCodexRoot: false,
      killedPids: [],
    };
  }

  const firstPass = await listUnexpectedHostedContainerProcessIds(
    process.pid,
    processApi,
    baseline,
    expectedCodexRoot,
  );
  if (firstPass.length === 0) {
    return {
      killedExpectedCodexRoot: false,
      killedPids: [],
    };
  }

  const killedExpectedCodexRoot =
    expectedCodexRoot !== null && firstPass.includes(expectedCodexRoot.pid);

  for (const pid of firstPass) {
    try {
      processApi.kill(pid, "SIGKILL");
    } catch {
      // Re-check after the cleanup pass.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 25));

  const secondPass = await listUnexpectedHostedContainerProcessIds(
    process.pid,
    processApi,
    baseline,
    expectedCodexRoot,
  );
  if (secondPass.length > 0) {
    throw new HostedRunnerShellIsolationError(
      `Hosted runner shell still has unexpected live processes after cleanup: ${secondPass.join(", ")}.`,
    );
  }

  return {
    killedExpectedCodexRoot,
    killedPids: firstPass,
  };
}

async function snapshotHostedContainerProcesses(
  rootPid: number,
  processApi: HostedContainerProcessApi,
): Promise<HostedContainerProcessSnapshot> {
  if (process.platform === "win32") {
    return {
      pids: new Set(),
      rootUid: null,
    };
  }

  const rootState = await readHostedContainerProcessState(rootPid, processApi);
  const processStates = await readHostedContainerProcessStates(rootPid, processApi);
  return {
    pids: new Set(processStates.keys()),
    rootUid: rootState.uid,
  };
}

async function readHostedContainerProcessStates(
  rootPid: number,
  processApi: HostedContainerProcessApi,
): Promise<Map<number, HostedContainerProcessState>> {
  let entries;
  try {
    entries = await processApi.readdir("/proc");
  } catch (error) {
    throw new HostedRunnerShellIsolationError(
      `Hosted runner shell could not inspect /proc for warm-container cleanup: ${String(error)}.`,
    );
  }

  const processStates = new Map<number, HostedContainerProcessState>();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pid = Number.parseInt(entry.name, 10);
    if (!Number.isInteger(pid) || pid <= 1 || pid === rootPid) {
      continue;
    }

    processStates.set(pid, await readHostedContainerProcessState(pid, processApi));
  }

  return processStates;
}

async function listUnexpectedHostedContainerProcessIds(
  rootPid: number,
  processApi: HostedContainerProcessApi,
  baseline: HostedContainerProcessSnapshot,
  expectedCodexRoot: HostedExpectedCodexRootProcess | null,
): Promise<number[]> {
  const processStates = await readHostedContainerProcessStates(rootPid, processApi);
  const descendantPids = new Set<number>();
  const frontier = [rootPid];
  const visited = new Set<number>(frontier);

  while (frontier.length > 0) {
    const currentPid = frontier.shift();
    if (currentPid === undefined) {
      break;
    }

    for (const [pid, state] of processStates) {
      if (state.ppid !== currentPid || visited.has(pid)) {
        continue;
      }

      visited.add(pid);
      frontier.push(pid);
      descendantPids.add(pid);
    }
  }

  const unexpected: number[] = [];
  for (const [pid, state] of processStates) {
    if (state.state === "Z") {
      continue;
    }

    if (isExpectedHostedCodexRootProcess(pid, state, expectedCodexRoot)) {
      continue;
    }

    if (descendantPids.has(pid)) {
      unexpected.push(pid);
      continue;
    }

    if (
      baseline.rootUid !== null
      && state.uid === baseline.rootUid
      && !baseline.pids.has(pid)
    ) {
      unexpected.push(pid);
    }
  }

  return unexpected.sort((left, right) => left - right);
}

function isExpectedHostedCodexRootProcess(
  pid: number,
  state: HostedContainerProcessState,
  expectedCodexRoot: HostedExpectedCodexRootProcess | null,
): boolean {
  if (!expectedCodexRoot || expectedCodexRoot.owner !== "codex-app-server") {
    return false;
  }

  if (pid !== expectedCodexRoot.pid) {
    return false;
  }

  if (state.commandLineDigest !== expectedCodexRoot.commandLineDigest) {
    return false;
  }

  if (
    expectedCodexRoot.processGroupId !== null
    && state.processGroupId !== expectedCodexRoot.processGroupId
  ) {
    return false;
  }

  if (
    state.startTimeTicksFromProcStat !== expectedCodexRoot.startTimeTicksFromProcStat
  ) {
    return false;
  }

  return expectedCodexRoot.uid === null || state.uid === expectedCodexRoot.uid;
}

async function readHostedContainerProcessState(
  pid: number,
  processApi: HostedContainerProcessApi,
): Promise<HostedContainerProcessState> {
  let commandLineDigest: string | null = null;
  let ppid: number | null = null;
  let processGroupId: number | null = null;
  let startTimeTicksFromProcStat: string | null = null;
  let state: string | null = null;
  let uid: number | null = null;

  try {
    commandLineDigest = createHash("sha256")
      .update(await processApi.readFile(`/proc/${pid}/cmdline`, "utf8"))
      .digest("hex");
  } catch {
    // Command line can disappear while /proc is being scanned.
  }

  try {
    const stat = await processApi.readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(") ");

    if (commandEnd !== -1 && commandEnd + 2 < stat.length) {
      const remainder = stat.slice(commandEnd + 2).trim();
      const statFields = remainder.split(/\s+/u);
      const [stateRaw, ppidRaw] = statFields;
      const parsedPpid = Number.parseInt(ppidRaw ?? "", 10);
      const parsedProcessGroupId = Number.parseInt(statFields[2] ?? "", 10);

      ppid = Number.isInteger(parsedPpid) ? parsedPpid : null;
      processGroupId = Number.isInteger(parsedProcessGroupId)
        ? parsedProcessGroupId
        : null;
      state = typeof stateRaw === "string" && stateRaw.length > 0 ? stateRaw : null;
      const startTimeRaw = statFields[19];
      startTimeTicksFromProcStat =
        typeof startTimeRaw === "string" && /^[0-9]+$/u.test(startTimeRaw)
          ? startTimeRaw
          : null;
    }
  } catch {
    // Processes can exit while /proc is being scanned.
  }

  try {
    uid = readHostedContainerProcessUid(
      await processApi.readFile(`/proc/${pid}/status`, "utf8"),
    );
  } catch {
    // UID is only needed for the daemonized-orphan cleanup path.
  }

  return {
    commandLineDigest,
    ppid,
    processGroupId,
    startTimeTicksFromProcStat,
    state,
    uid,
  };
}

function readHostedContainerProcessUid(status: string): number | null {
  const uidLine = status.split("\n").find((line) => line.startsWith("Uid:"));
  const uidRaw = uidLine?.trim().split(/\s+/u)[1];
  const uid = Number.parseInt(uidRaw ?? "", 10);
  return Number.isInteger(uid) && uid >= 0 ? uid : null;
}

export function createRequestAbortController(
  request: HostedAbortRequestLike,
  response: HostedAbortResponseLike,
): {
  cleanup: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  let exitLogged = false;

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

  const abort = (exitReason: "request.aborted" | "response.closed") => {
    if (!controller.signal.aborted) {
      emitRequestExitLog(exitReason);
      controller.abort(
        new Error(
          exitReason === "response.closed"
            ? "Hosted runner response closed before completion."
            : "Hosted runner request aborted before completion.",
        ),
      );
    }
  };
  const handleRequestAbort = () => {
    abort("request.aborted");
  };
  const handleResponseClose = () => {
    if (!response.writableEnded) {
      abort("response.closed");
    }
  };

  request.once("aborted", handleRequestAbort);
  response.once("close", handleResponseClose);

  return {
    cleanup: () => {
      request.off("aborted", handleRequestAbort);
      response.off("close", handleResponseClose);
    },
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

async function runHostedWorkspaceInvocation(
  input: HostedExecutionRunnerJobInput,
  runtime: HostedContainerRuntimeDependencies,
  options?: {
    onRuntimeWakeReady?: (sendWake: () => boolean) => void;
    signal?: AbortSignal;
  },
): Promise<Awaited<ReturnType<typeof runHostedWorkspaceInvocationDirect>>> {
  return await runtime.runWorkspaceInvocation(input, {
    onRuntimeWakeReady: options?.onRuntimeWakeReady,
    signal: options?.signal,
    supervisorEnv: runtime.startupConfig.supervisorEnv,
  });
}

async function runHostedWorkspaceInvocationWithProcessIsolation(
  input: HostedExecutionRunnerJobInput,
  runtime: HostedContainerRuntimeDependencies,
  options?: {
    onCleanupStatus?: (status: Exclude<HostedContainerCleanupStatus, "not_run">) => void;
    onRuntimeWakeReady?: (sendWake: () => boolean) => void;
    signal?: AbortSignal;
  },
): Promise<Awaited<ReturnType<typeof runHostedWorkspaceInvocationDirect>>> {
  await stopHostedWarmCodexAfterCliBridgeOffInvocationViolation(runtime, options);

  let processBaseline: HostedContainerProcessSnapshot | null = null;
  if (runtime.processIsolation) {
    try {
      processBaseline = await snapshotHostedContainerProcesses(process.pid, runtime.processApi);
    } catch (error) {
      options?.onCleanupStatus?.("failed");
      throw error;
    }
  }

  try {
    return await runHostedWorkspaceInvocation(input, runtime, options);
  } finally {
    await stopHostedWarmCodexAfterCliBridgeOffInvocationViolation(runtime, options);
    if (processBaseline) {
      try {
        const expectedCodexRoot = await runtime.snapshotExpectedCodexRootProcess();
        const cleanupResult = await enforceHostedContainerProcessIsolation(
          runtime.processApi,
          processBaseline,
          expectedCodexRoot,
        );
        if (cleanupResult.killedExpectedCodexRoot) {
          await runtime.stopWarmCodex("expected-root-rejected").catch(() => undefined);
        }
        options?.onCleanupStatus?.("passed");
      } catch (error) {
        await runtime.stopWarmCodex("process-isolation-failed").catch(() => undefined);
        options?.onCleanupStatus?.("failed");
        throw error;
      }
    }
  }
}

async function stopHostedWarmCodexAfterCliBridgeOffInvocationViolation(
  runtime: HostedContainerRuntimeDependencies,
  options?: {
    onCleanupStatus?: (status: Exclude<HostedContainerCleanupStatus, "not_run">) => void;
  },
): Promise<void> {
  const violationPending = await runtime.consumeCliBridgeOffInvocationViolation();
  if (!violationPending) {
    return;
  }

  try {
    await runtime.stopWarmCodex("cli-bridge-off-invocation-request");
  } catch (error) {
    options?.onCleanupStatus?.("failed");
    throw new HostedRunnerShellIsolationError(
      "Hosted container failed to stop warm Codex after an off-invocation CLI bridge request.",
      { cause: error },
    );
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
      workspaceReason:
        input.job.kind === "workspace-invocation" ? input.job.request.reason : null,
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
