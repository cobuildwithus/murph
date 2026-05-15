import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionRunnerJobInput,
} from "./runner-job-transport.ts";
import {
  readHostedExecutionChildRuntimeDiagnosticMetadata,
  readHostedRunnerChildFirstCompletionKind,
  readHostedRunnerChildOutputMarkers,
} from "./runner-child-diagnostics.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "./runner-outbound/headers.ts";
import type {
  RunnerRuntimeWriteFenceToken,
} from "./runner-outbound/write-fence.ts";

const HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const HOSTED_CONTAINER_ACTIVE_DIAGNOSTIC_INTERVAL_MS = 15_000;
const HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_PATH =
  "/internal/deploy-openai-intercept-smoke";
const HOSTED_CONTAINER_RUNTIME_WAKE_PATH = "/internal/runtime-wake";
const HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_TIMEOUT_MS = 120_000;
const HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_MODEL = "gpt-5.4-mini";
const HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_API_KEY_SENTINEL =
  "__cloudflare_injected__";
const HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH =
  "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV = {
  attemptId: "MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID",
  boundUserId: "MURPH_HOSTED_CODEX_BOUND_USER_ID",
  leaseGeneration: "MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION",
  workspaceVersion: "MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION",
} as const;

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
let hostedContainerNodeRunnerLoader: Promise<typeof import("./node-runner.js")> | null = null;

interface HostedContainerRuntimeOptions {
  exitScheduler?: () => void;
  loadNodeRunner?: () => Promise<typeof import("./node-runner.js")>;
  loadRuntimeContracts?:
    () => Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>;
  processApi?: Partial<HostedContainerProcessApi>;
  processIsolation?: boolean;
  runOpenAiInterceptSmoke?: (
    options: { authority: HostedContainerRuntimeAuthority; signal: AbortSignal },
  ) => Promise<HostedContainerOpenAiInterceptSmokeResult>;
}

interface HostedContainerRuntimeDependencies {
  exitScheduler: () => void;
  loadNodeRunner: () => Promise<typeof import("./node-runner.js")>;
  loadRuntimeContracts:
    () => Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>;
  processApi: HostedContainerProcessApi;
  processIsolation: boolean;
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
  constructor(message: string) {
    super(message);
    this.name = "HostedRunnerShellIsolationError";
  }
}

class HostedContainerRequestBodyTooLargeError extends RangeError {
  constructor(limitBytes: number) {
    super(`Hosted container runner request body exceeds ${limitBytes} bytes.`);
    this.name = "HostedContainerRequestBodyTooLargeError";
  }
}

interface HostedContainerProcessState {
  ppid: number | null;
  state: string | null;
  uid: number | null;
}

interface HostedContainerProcessSnapshot {
  pids: Set<number>;
  rootUid: number | null;
}

export async function startHostedContainerEntrypoint(input: {
  port?: number;
  runtime?: HostedContainerRuntimeOptions;
}): Promise<ReturnType<typeof createServer>> {
  const runtime = resolveHostedContainerRuntimeDependencies(input.runtime);
  let activeHostedRunnerJobCount = 0;
  let activeRuntimeWake: (() => boolean) | null = null;
  let activeRuntimeWakeAttemptId: string | null = null;
  const server = createServer(async (request, response) => {
    response.setHeader("connection", "close");
    const requestAbort = createRequestAbortController(request, response);
    let claimedRunnerSlot = false;
    let runtimeWakeForRequest: (() => boolean) | null = null;
    let job: HostedExecutionRunnerJobInput | null = null;
    let stopActiveJobDiagnostics: (() => void) | null = null;

    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const runnerBundle = await readHostedRunnerBundleManifestSummary(runtime.processApi);
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
          ok: true,
          service: "cloudflare-hosted-runner-node",
          ...(runnerBundle ? { runnerBundle } : {}),
        }));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === HOSTED_CONTAINER_RUNTIME_WAKE_PATH) {
        discardUnreadRequestBody(request);
        const wake = activeRuntimeWake;
        const accepted = wake?.() === true;
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            activeHostedRunnerJobCount,
            activeRuntimeWakePresent: wake !== null,
            runtimeWakeAccepted: accepted,
            workspaceAttemptId: activeRuntimeWakeAttemptId,
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
        response.statusCode = 204;
        response.end();
        return;
      }

      const isOpenAiInterceptSmokeRequest =
        request.method === "POST" && requestUrl.pathname === HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_PATH;
      const isWorkspaceInvocationRequest =
        request.method === "POST" && requestUrl.pathname === "/internal/workspace-invocation";

      if (!isWorkspaceInvocationRequest && !isOpenAiInterceptSmokeRequest) {
        discardUnreadRequestBody(request);
        response.statusCode = 404;
        response.end("Not found");
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
      stopActiveJobDiagnostics = startHostedContainerActiveJobDiagnostics({
        job,
        processApi: runtime.processApi,
      });

      const result = await runHostedWorkspaceInvocationWithProcessIsolation(job, runtime, {
        onChildReadyForRuntimeWake(sendWake) {
          activeRuntimeWake = sendWake;
          activeRuntimeWakeAttemptId = job
            ? readHostedContainerWorkspaceAttemptId(job)
            : null;
          runtimeWakeForRequest = sendWake;
          emitHostedExecutionStructuredLog({
            component: "container",
            details: {
              activeHostedRunnerJobCount,
              activeRuntimeWakePresent: true,
              workspaceAttemptId: activeRuntimeWakeAttemptId,
            },
            message: "Hosted container child reported runtime wake readiness.",
            phase: "wake.running",
            userId: null,
          });
        },
        signal: requestAbort.signal,
      });

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
        runtime.exitScheduler();
      }
      const classified = classifyRunnerJobError(error);
      writeJsonResponse(response, classified.statusCode, classified.payload);
    } finally {
      stopActiveJobDiagnostics?.();
      if (runtimeWakeForRequest && activeRuntimeWake === runtimeWakeForRequest) {
        activeRuntimeWake = null;
        activeRuntimeWakeAttemptId = null;
      }
      if (claimedRunnerSlot) {
        activeHostedRunnerJobCount = Math.max(0, activeHostedRunnerJobCount - 1);
      }
      requestAbort.cleanup();
    }
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

  void runtime.loadNodeRunner().catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "container",
      error,
      level: "error",
      message: "Hosted runner runtime preload failed.",
      phase: "failed",
    });
  });

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

function resolveHostedContainerRuntimeDependencies(
  runtime: HostedContainerRuntimeOptions | undefined,
): HostedContainerRuntimeDependencies {
  return {
    loadNodeRunner: createCachedHostedContainerLoader(
      runtime?.loadNodeRunner ?? loadHostedContainerNodeRunner,
    ),
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
    runOpenAiInterceptSmoke:
      runtime?.runOpenAiInterceptSmoke ?? runHostedContainerOpenAiInterceptSmoke,
  };
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
      authority: input.authority,
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
    `env_http_headers = { "${HOSTED_RUNNER_BOUND_USER_ID_HEADER}" = "${HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV.boundUserId}", "${HOSTED_RUNTIME_ATTEMPT_ID_HEADER}" = "${HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV.attemptId}", "${HOSTED_RUNTIME_LEASE_GENERATION_HEADER}" = "${HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV.leaseGeneration}", "${HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER}" = "${HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV.workspaceVersion}" }`,
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
  authority: HostedContainerRuntimeAuthority;
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
  authority: HostedContainerRuntimeAuthority;
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
    [HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV.attemptId]: input.authority.attemptId,
    [HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV.boundUserId]: input.authority.userId,
    [HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV.leaseGeneration]: input.authority.leaseGeneration,
    [HOSTED_CONTAINER_SMOKE_CODEX_AUTHORITY_ENV.workspaceVersion]: input.authority.workspaceVersion,
    NODE_EXTRA_CA_CERTS:
      process.env.NODE_EXTRA_CA_CERTS ?? HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH,
    OPENAI_API_KEY: HOSTED_CONTAINER_OPENAI_INTERCEPT_SMOKE_API_KEY_SENTINEL,
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
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
): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  const firstPass = await listUnexpectedHostedContainerProcessIds(process.pid, processApi, baseline);
  if (firstPass.length === 0) {
    return;
  }

  for (const pid of firstPass) {
    try {
      processApi.kill(pid, "SIGKILL");
    } catch {
      // Re-check after the cleanup pass.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 25));

  const secondPass = await listUnexpectedHostedContainerProcessIds(process.pid, processApi, baseline);
  if (secondPass.length > 0) {
    throw new HostedRunnerShellIsolationError(
      `Hosted runner shell still has unexpected live processes after cleanup: ${secondPass.join(", ")}.`,
    );
  }
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

async function readHostedContainerProcessState(
  pid: number,
  processApi: HostedContainerProcessApi,
): Promise<HostedContainerProcessState> {
  let ppid: number | null = null;
  let state: string | null = null;
  let uid: number | null = null;

  try {
    const stat = await processApi.readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(") ");

    if (commandEnd !== -1 && commandEnd + 2 < stat.length) {
      const remainder = stat.slice(commandEnd + 2).trim();
      const [stateRaw, ppidRaw] = remainder.split(/\s+/u, 2);
      const parsedPpid = Number.parseInt(ppidRaw ?? "", 10);

      ppid = Number.isInteger(parsedPpid) ? parsedPpid : null;
      state = typeof stateRaw === "string" && stateRaw.length > 0 ? stateRaw : null;
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

  return { ppid, state, uid };
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
    const childProcess = readHostedContainerRecordProperty(rawDetails, "childProcess");
    if (childProcess) {
      details.childProcess = buildHostedContainerChildProcessMetadata(childProcess);
    }
    for (const [key, value] of Object.entries(
      readHostedExecutionChildRuntimeDiagnosticMetadata(rawDetails),
    )) {
      details[key] = value;
    }
    details.errorDetailPresent = hasNonEmptyHostedContainerString(rawDetails.errorDetail);
  }

  return Object.keys(details).length > 0 ? details : null;
}

function buildHostedContainerChildProcessMetadata(
  childProcess: Record<string, unknown>,
): HostedExecutionStructuredLogDetails {
  const metadata: HostedExecutionStructuredLogDetails = {
    abortedByParent: childProcess.abortedByParent === true,
    abortReasonMessagePresent: hasNonEmptyHostedContainerString(childProcess.abortReasonMessage),
    runtimeWakeReady: childProcess.runtimeWakeReady === true,
    stderrTailPresent: hasNonEmptyHostedContainerString(childProcess.stderrTail),
    stdoutTailPresent: hasNonEmptyHostedContainerString(childProcess.stdoutTail),
  };
  const exitCode = childProcess.exitCode;
  if (typeof exitCode === "number" || exitCode === null) {
    metadata.exitCode = exitCode;
  }

  const signal = readHostedContainerSafeSignal(childProcess.signal);
  if (signal !== undefined) {
    metadata.signal = signal;
  }

  const abortReasonName = readHostedContainerSafeCode(childProcess.abortReasonName);
  if (abortReasonName) {
    metadata.abortReasonName = abortReasonName;
  }

  const firstCompletionKind = readHostedRunnerChildFirstCompletionKind(
    childProcess.firstCompletionKind,
  );
  if (firstCompletionKind) {
    metadata.firstCompletionKind = firstCompletionKind;
  }

  const stderrTailLineCount = readHostedContainerSafeInteger(childProcess.stderrTailLineCount);
  if (stderrTailLineCount !== null) {
    metadata.stderrTailLineCount = stderrTailLineCount;
  }

  const stdoutTailLineCount = readHostedContainerSafeInteger(childProcess.stdoutTailLineCount);
  if (stdoutTailLineCount !== null) {
    metadata.stdoutTailLineCount = stdoutTailLineCount;
  }

  const stderrTailMarkers = readHostedRunnerChildOutputMarkers(
    childProcess.stderrTailMarkers,
  );
  if (stderrTailMarkers) {
    metadata.stderrTailMarkers = stderrTailMarkers;
  }

  const stdoutTailMarkers = readHostedRunnerChildOutputMarkers(
    childProcess.stdoutTailMarkers,
  );
  if (stdoutTailMarkers) {
    metadata.stdoutTailMarkers = stdoutTailMarkers;
  }

  return metadata;
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

function readHostedContainerSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function readHostedContainerSafeSignal(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return readHostedContainerSafeCode(value) ?? undefined;
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
): Promise<HostedRunnerBundleManifestSummary | null> {
  let raw: string;

  try {
    raw = await processApi.readFile(
      path.join(process.cwd(), ".murph-runner-bundle-manifest.json"),
      "utf8",
    );
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
    onChildReadyForRuntimeWake?: (sendWake: () => boolean) => void;
    signal?: AbortSignal;
  },
): Promise<Awaited<ReturnType<typeof import("./node-runner.js")["runHostedWorkspaceInvocation"]>>> {
  const nodeRunner = await runtime.loadNodeRunner();
  return await nodeRunner.runHostedWorkspaceInvocation(input, options);
}

async function runHostedWorkspaceInvocationWithProcessIsolation(
  input: HostedExecutionRunnerJobInput,
  runtime: HostedContainerRuntimeDependencies,
  options?: {
    onChildReadyForRuntimeWake?: (sendWake: () => boolean) => void;
    signal?: AbortSignal;
  },
): Promise<Awaited<ReturnType<typeof import("./node-runner.js")["runHostedWorkspaceInvocation"]>>> {
  const processBaseline = runtime.processIsolation
    ? await snapshotHostedContainerProcesses(process.pid, runtime.processApi)
    : null;

  try {
    return await runHostedWorkspaceInvocation(input, runtime, options);
  } finally {
    if (processBaseline) {
      await enforceHostedContainerProcessIsolation(runtime.processApi, processBaseline);
    }
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

async function loadHostedContainerNodeRunner(): Promise<typeof import("./node-runner.js")> {
  hostedContainerNodeRunnerLoader ??= import("./node-runner.js");
  return await hostedContainerNodeRunnerLoader;
}
