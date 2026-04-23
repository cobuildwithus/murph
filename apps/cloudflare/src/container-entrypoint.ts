import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  type HostedAssistantRuntimeJobInput,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  createRuntimeTimerSyntheticWake,
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  summarizeHostedExecutionError,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";

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

export async function startHostedContainerEntrypoint(input: {
  controlToken: string | null;
  port?: number;
  runtime?: HostedContainerRuntimeOptions;
}): Promise<ReturnType<typeof createServer>> {
  const runtime = resolveHostedContainerRuntimeDependencies(input.runtime);
  let activeHostedRunnerJobCount = 0;
  const server = createServer(async (request, response) => {
    const requestAbort = createRequestAbortController(request, response);
    let claimedRunnerSlot = false;
    let job: HostedAssistantRuntimeJobInput | null = null;
    let internalWorkerProxyToken: string | null = null;
    let localBridge: HostedExecutionLocalBridgeConfig = {
      localInternalProxyBaseUrl: null,
    };

    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner-node" }));
        return;
      }

      if (
        request.method !== "POST"
        || requestUrl.pathname !== "/internal/run"
      ) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      if (!input.controlToken) {
        emitHostedExecutionStructuredLog({
          component: "container",
          level: "error",
          message: "Hosted container entrypoint is missing its control token.",
          phase: "failed",
        });
        writeJsonResponse(response, 503, {
          error: "Hosted runner control token is not configured.",
        });
        return;
      }

      const bearerToken = readBearerAuthorizationToken(request.headers.authorization);

      if (!bearerToken || !timingSafeEquals(bearerToken, input.controlToken)) {
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

      if (activeHostedRunnerJobCount > 0) {
        emitHostedExecutionStructuredLog({
          component: "container",
          level: "warn",
          message: "Hosted container entrypoint rejected a concurrent run request.",
          phase: "failed",
        });
        writeJsonResponse(response, 409, {
          error: "Hosted runner is busy.",
        });
        return;
      }
      activeHostedRunnerJobCount += 1;
      claimedRunnerSlot = true;

      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      try {
        const requestBody: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const parsed = await parseHostedExecutionContainerRunRequest(
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
        wake: resolveHostedContainerJobWake(job),
        message: "Hosted container entrypoint accepted runner job.",
        phase: "wake.running",
        run: job.request.run ?? null,
      });

      const result = await runHostedExecutionJob(job, runtime, {
        internalWorkerProxyToken,
        localInternalProxyBaseUrl: localBridge.localInternalProxyBaseUrl,
        signal: requestAbort.signal,
      });
      if (runtime.processIsolation) {
        await enforceHostedContainerProcessIsolation(runtime.processApi);
      }

      if (requestAbort.signal.aborted || response.destroyed) {
        return;
      }

      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          resultPhase: result.phase ?? null,
        },
        wake: resolveHostedContainerJobWake(job),
        message: "Hosted container entrypoint completed runner job.",
        phase: "wake.running",
        run: job.request.run ?? null,
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
        wake: typeof job === "object" && job ? resolveHostedContainerJobWake(job) : null,
        error,
        message: "Hosted container entrypoint failed a runner job.",
        phase: "failed",
        run: typeof job === "object" && job ? job.request.run ?? null : null,
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

  if (input.controlToken) {
    void runtime.loadNodeRunner().catch((error) => {
      emitHostedExecutionStructuredLog({
        component: "container",
        error,
        level: "error",
        message: "Hosted runner runtime preload failed.",
        phase: "failed",
      });
    });
  }

  return server;
}

function resolveHostedContainerJobWake(job: HostedAssistantRuntimeJobInput): HostedRuntimeEvent {
  const [firstEvent] = job.request.runDrain.events;
  return firstEvent?.wake ?? createRuntimeTimerSyntheticWake(job.request.runDrain);
}

async function parseHostedExecutionContainerRunRequest(
  value: unknown,
  runtime: HostedContainerRuntimeDependencies,
): Promise<{
  internalWorkerProxyToken: string | null;
  localBridge: HostedExecutionLocalBridgeConfig;
  job: HostedAssistantRuntimeJobInput;
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
    job: assistantRuntime.parseHostedAssistantRuntimeJobInput(record.job),
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
    && import.meta.url === pathToFileURL(process.argv[1]).href
    && Boolean(process.env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN?.trim());
}

async function startHostedContainerEntrypointCli(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

  await startHostedContainerEntrypoint({
    controlToken: readControlTokenFromEnv(process.env),
    port,
    runtime: {
      processIsolation: true,
    },
  });
}

function readControlTokenFromEnv(source: NodeJS.ProcessEnv): string | null {
  return normalizeOptionalString(source.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN);
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
): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  const firstPass = await listUnexpectedHostedContainerDescendantProcessIds(process.pid, processApi);
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

  const secondPass = await listUnexpectedHostedContainerDescendantProcessIds(process.pid, processApi);
  if (secondPass.length > 0) {
    throw new HostedRunnerShellIsolationError(
      `Hosted runner shell still has unexpected live processes after cleanup: ${secondPass.join(", ")}.`,
    );
  }
}

async function listUnexpectedHostedContainerDescendantProcessIds(
  rootPid: number,
  processApi: HostedContainerProcessApi,
): Promise<number[]> {
  let entries;
  try {
    entries = await processApi.readdir("/proc");
  } catch (error) {
    throw new HostedRunnerShellIsolationError(
      `Hosted runner shell could not inspect /proc for warm-container cleanup: ${String(error)}.`,
    );
  }

  const processStates = new Map<number, {
    ppid: number | null;
    state: string | null;
  }>();

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

  const unexpected: number[] = [];
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

      if (state.state === "Z") {
        continue;
      }

      unexpected.push(pid);
    }
  }

  return unexpected;
}

async function readHostedContainerProcessState(
  pid: number,
  processApi: HostedContainerProcessApi,
): Promise<{
  ppid: number | null;
  state: string | null;
}> {
  try {
    const stat = await processApi.readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(") ");

    if (commandEnd === -1 || commandEnd + 2 >= stat.length) {
      return { ppid: null, state: null };
    }

    const remainder = stat.slice(commandEnd + 2).trim();
    const [state, ppidRaw] = remainder.split(/\s+/u, 2);

    return {
      ppid: Number.isInteger(Number.parseInt(ppidRaw ?? "", 10))
        ? Number.parseInt(ppidRaw ?? "", 10)
        : null,
      state: typeof state === "string" && state.length > 0 ? state : null,
    };
  } catch {
    return { ppid: null, state: null };
  }
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

async function runHostedExecutionJob(
  input: HostedAssistantRuntimeJobInput,
  runtime: HostedContainerRuntimeDependencies,
  options?: {
    internalWorkerProxyToken?: string | null;
    localInternalProxyBaseUrl?: string | null;
    signal?: AbortSignal;
  },
): Promise<Awaited<ReturnType<typeof import("./node-runner.js")["runHostedExecutionJob"]>>> {
  const nodeRunner = await runtime.loadNodeRunner();
  return await nodeRunner.runHostedExecutionJob(input, options);
}

function isHostedAssistantConfigurationError(
  error: unknown,
): error is Error & { code?: string | null } {
  return error instanceof Error && error.name === "HostedAssistantConfigurationError";
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
