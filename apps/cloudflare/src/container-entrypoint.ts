import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  summarizeHostedExecutionError,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionRunnerJobInput,
} from "./runner-job-transport.ts";

const HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN_ENV = "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN";
const HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

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
  fetchImpl?: typeof fetch;
  loadNodeRunner?: () => Promise<typeof import("./node-runner.js")>;
  loadRuntimeContracts?:
    () => Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>;
  processApi?: Partial<HostedContainerProcessApi>;
  processIsolation?: boolean;
}

interface HostedContainerRuntimeDependencies {
  exitScheduler: () => void;
  fetchImpl: typeof fetch;
  loadNodeRunner: () => Promise<typeof import("./node-runner.js")>;
  loadRuntimeContracts:
    () => Promise<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>;
  processApi: HostedContainerProcessApi;
  processIsolation: boolean;
}

interface HostedExecutionLocalBridgeConfig {
  localInternalProxyBaseUrl: string | null;
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
  controlToken: string | null;
  port?: number;
  runtime?: HostedContainerRuntimeOptions;
}): Promise<ReturnType<typeof createServer>> {
  const runtime = resolveHostedContainerRuntimeDependencies(input.runtime);
  const controlToken = normalizeOptionalString(input.controlToken);
  let activeHostedRunnerJobCount = 0;
  const server = createServer(async (request, response) => {
    response.setHeader("connection", "close");
    const requestAbort = createRequestAbortController(request, response);
    let claimedRunnerSlot = false;
    let job: HostedExecutionRunnerJobInput | null = null;
    let internalWorkerProxyToken: string | null = null;
    let localBridge: HostedExecutionLocalBridgeConfig = {
      localInternalProxyBaseUrl: null,
    };

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

      const isControlHealthRequest =
        request.method === "GET" && requestUrl.pathname === "/internal/control-health";
      const isWorkspaceInvocationRequest =
        request.method === "POST" && requestUrl.pathname === "/internal/workspace-invocation";

      if (!isControlHealthRequest && !isWorkspaceInvocationRequest) {
        discardUnreadRequestBody(request);
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const bearerToken = readBearerAuthorizationToken(request.headers.authorization);

      if (!controlToken) {
        discardUnreadRequestBody(request);
        emitHostedExecutionStructuredLog({
          component: "container",
          level: "error",
          message: "Hosted container entrypoint is missing its startup control token.",
          phase: "failed",
        });
        writeJsonResponse(response, 401, {
          error: "Unauthorized",
        });
        return;
      }

      if (controlToken && (!bearerToken || !timingSafeEquals(bearerToken, controlToken))) {
        discardUnreadRequestBody(request);
        emitHostedExecutionStructuredLog({
          component: "container",
          level: "warn",
          message: "Hosted container entrypoint rejected an unauthorized request.",
          phase: "failed",
        });
        writeJsonResponse(response, 401, {
          error: "Unauthorized",
        });
        return;
      }

      if (isControlHealthRequest) {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
          ok: true,
          service: "cloudflare-hosted-runner-node",
        }));
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
        internalWorkerProxyToken = parsed.internalWorkerProxyToken;
        localBridge = parsed.localBridge;
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

      const result = await runHostedWorkspaceInvocationWithProcessIsolation(job, runtime, {
        internalWorkerProxyToken,
        localInternalProxyBaseUrl: localBridge.localInternalProxyBaseUrl,
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
        error,
        message: "Hosted container entrypoint failed a runner job.",
        phase: "failed",
        userId: typeof job === "object" && job ? readHostedExecutionRunnerJobUserId(job) : null,
      });
      if (error instanceof HostedRunnerShellIsolationError) {
        runtime.exitScheduler();
      }
      const classified = classifyRunnerJobError(error);
      writeJsonResponse(response, classified.statusCode, classified.payload);
    } finally {
      if (claimedRunnerSlot) {
        activeHostedRunnerJobCount = Math.max(0, activeHostedRunnerJobCount - 1);
      }
      requestAbort.cleanup();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 8080, () => resolve());
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
  internalWorkerProxyToken: string | null;
  localBridge: HostedExecutionLocalBridgeConfig;
  job: HostedExecutionRunnerJobInput;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted container runner request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const assistantRuntime = await runtime.loadRuntimeContracts();

  return {
    internalWorkerProxyToken: readNullableString(
      record.internalWorkerProxyToken,
      "Hosted container runner request.internalWorkerProxyToken",
    ),
    localBridge: {
      localInternalProxyBaseUrl: readNullableString(
        record.localInternalProxyBaseUrl,
        "Hosted container runner request.localInternalProxyBaseUrl",
      ),
    },
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
  const controlToken = process.env[HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN_ENV] ?? null;
  delete process.env[HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN_ENV];

  await startHostedContainerEntrypoint({
    controlToken,
    port,
    runtime: {
      processIsolation: true,
    },
  });
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return normalizeOptionalString(value);
}

function readBearerAuthorizationToken(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("Bearer ")) {
    return null;
  }

  const token = trimmed.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function readHostedContainerInvocationRequestBody(request: IncomingMessage): Promise<string> {
  const declaredLength = readContentLengthBytes(request.headers["content-length"]);

  if (
    declaredLength !== null
    && declaredLength > HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES
  ) {
    throw new HostedContainerRequestBodyTooLargeError(
      HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES,
    );
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES) {
      throw new HostedContainerRequestBodyTooLargeError(
        HOSTED_CONTAINER_RUN_REQUEST_BODY_LIMIT_BYTES,
      );
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

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
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

function readHostedExecutionRunnerResultPhase(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }

  const phase = (result as { phase?: unknown }).phase;
  return typeof phase === "string" ? phase : null;
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
    fetchImpl: runtime?.fetchImpl ?? fetch,
    processApi: runtime?.processApi
      ? {
        ...defaultHostedContainerProcessApi,
        ...runtime.processApi,
      }
      : defaultHostedContainerProcessApi,
    processIsolation: runtime?.processIsolation ?? false,
  };
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
  const details = buildHostedExecutionSafeErrorDetails(error);

  if (isHostedAssistantConfigurationError(error)) {
    return {
      payload: {
        code: error.code,
        error: error.message,
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
      ...(readHostedExecutionSafeErrorName(error)
        ? { errorName: readHostedExecutionSafeErrorName(error) }
        : {}),
    },
    statusCode: 500,
  };
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
    internalWorkerProxyToken?: string | null;
    localInternalProxyBaseUrl?: string | null;
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
    internalWorkerProxyToken?: string | null;
    localInternalProxyBaseUrl?: string | null;
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
