import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  type HostedAssistantRuntimeJobInput,
} from "@murphai/assistant-runtime";
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
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
  HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER,
} from "./internal-hosts.ts";

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
let hostedContainerRunnerRuntimeLoader:
  | Promise<{
    assistantRuntime: typeof import("@murphai/assistant-runtime");
    nodeRunner: typeof import("./node-runner.js");
  }>
  | null = null;

interface HostedContainerRuntimeOptions {
  exitScheduler?: () => void;
  fetchImpl?: typeof fetch;
  processApi?: Partial<HostedContainerProcessApi>;
  processIsolation?: boolean;
}

interface HostedContainerRuntimeDependencies {
  exitScheduler: () => void;
  fetchImpl: typeof fetch;
  processApi: HostedContainerProcessApi;
  processIsolation: boolean;
}

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
  let activeInternalWorkerProxyToken: string | null = null;
  let internalWorkerProxyBaseUrl: string | null = null;
  const server = createServer(async (request, response) => {
    const requestAbort = createRequestAbortController(request, response);
    let claimedRunnerSlot = false;
    let job: HostedAssistantRuntimeJobInput | null = null;
    let internalWorkerProxyToken: string | null = null;

    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner-node" }));
        return;
      }

      if (requestUrl.pathname.startsWith(HOSTED_CONTAINER_INTERNAL_WORKER_PROXY_PREFIX)) {
        await handleHostedContainerInternalWorkerProxyRequest({
          activeInternalWorkerProxyToken,
          fetchImpl: runtime.fetchImpl,
          request,
          requestUrl,
          response,
        });
        return;
      }

      if (
        request.method !== "POST"
        || (requestUrl.pathname !== "/__internal/run" && requestUrl.pathname !== "/internal/run")
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
        const parsed = await parseHostedExecutionContainerRunRequest(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        );
        job = parsed.job;
        internalWorkerProxyToken = parsed.internalWorkerProxyToken;
        activeInternalWorkerProxyToken = internalWorkerProxyToken;
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "container",
          error,
          level: "warn",
          message: "Hosted container entrypoint rejected the request body.",
          phase: "failed",
        });
        const classified = classifyRequestDecodeError(error);
        writeJsonResponse(response, classified.statusCode, {
          error: classified.message,
        });
        return;
      }

      emitHostedExecutionStructuredLog({
        component: "container",
        details: {
          forwardedEnvKeyCount: Object.keys(job.runtime?.forwardedEnv ?? {}).length,
          resumeFromCommit: Boolean(job.request.resume?.committedResult),
          userEnvKeyCount: Object.keys(job.runtime?.userEnv ?? {}).length,
        },
        dispatch: job.request.dispatch,
        message: "Hosted container entrypoint accepted runner job.",
        phase: "dispatch.running",
        run: job.request.run ?? null,
      });

      const result = await runHostedExecutionJob(job, {
        internalWorkerProxyBaseUrl,
        internalWorkerProxyToken,
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
        dispatch: job.request.dispatch,
        message: "Hosted container entrypoint completed runner job.",
        phase: "dispatch.running",
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
        dispatch: typeof job === "object" && job ? job.request.dispatch : null,
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
        activeInternalWorkerProxyToken = null;
      }
      if (claimedRunnerSlot) {
        activeHostedRunnerJobCount = Math.max(0, activeHostedRunnerJobCount - 1);
      }
      requestAbort.cleanup();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 8080, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Hosted container entrypoint failed to resolve its listening TCP port.");
  }
  internalWorkerProxyBaseUrl = `http://127.0.0.1:${address.port}${HOSTED_CONTAINER_INTERNAL_WORKER_PROXY_PREFIX}`;

  return server;
}

const HOSTED_CONTAINER_INTERNAL_WORKER_PROXY_PREFIX = "/__internal/worker-proxy/";
const HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL_ENV =
  "HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL";

async function handleHostedContainerInternalWorkerProxyRequest(input: {
  activeInternalWorkerProxyToken: string | null;
  fetchImpl: typeof fetch;
  request: IncomingMessage;
  requestUrl: URL;
  response: ServerResponse;
}): Promise<void> {
  const proxied = parseHostedContainerInternalWorkerProxyTarget(input.requestUrl);

  if (!proxied) {
    writeJsonResponse(input.response, 404, {
      error: "Not found",
    });
    return;
  }

  if (!input.activeInternalWorkerProxyToken) {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        host: proxied.host,
        method: input.request.method ?? "GET",
        path: proxied.path,
      },
      level: "warn",
      message: "Hosted container internal worker proxy rejected a request without an active run.",
      phase: "failed",
    });
    writeJsonResponse(input.response, 503, {
      error: "Hosted runner proxy is not active.",
    });
    return;
  }

  const providedToken = input.request.headers[HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER];
  const normalizedProvidedToken = Array.isArray(providedToken) ? providedToken[0] : providedToken;

  if (
    !normalizedProvidedToken
    || !timingSafeEquals(normalizedProvidedToken, input.activeInternalWorkerProxyToken)
  ) {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        host: proxied.host,
        method: input.request.method ?? "GET",
        path: proxied.path,
      },
      level: "warn",
      message: "Hosted container internal worker proxy rejected an unauthorized request.",
      phase: "failed",
    });
    writeJsonResponse(input.response, 401, {
      error: "Unauthorized",
    });
    return;
  }

  const body = await readHostedContainerRequestBody(input.request);
  const requestHeaders = new Headers();

  for (const [key, value] of Object.entries(input.request.headers)) {
    if (value === undefined) {
      continue;
    }
    if (!shouldForwardHostedContainerProxyRequestHeader(key)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        requestHeaders.append(key, entry);
      }
      continue;
    }
    requestHeaders.set(key, value);
  }

  const upstream = resolveHostedContainerInternalWorkerProxyUpstream(proxied);
  requestHeaders.set(HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER, proxied.host);
  if (upstream.preserveHostHeader) {
    requestHeaders.set("host", proxied.host);
  }

  emitHostedExecutionStructuredLog({
    component: "container",
    details: {
      host: proxied.host,
      method: input.request.method ?? "GET",
      path: proxied.path,
      search: proxied.search,
      upstreamRewritten: upstream.rewritten ? "true" : "false",
      upstreamUrl: upstream.url.toString(),
    },
    message: "Hosted container internal worker proxy forwarding request.",
    phase: "side-effects.draining",
  });

  try {
    const upstreamResponse = await input.fetchImpl(upstream.url, {
      body:
        canHttpRequestCarryBody(input.request.method) && body
          ? new Uint8Array(body)
          : undefined,
      headers: requestHeaders,
      method: input.request.method,
    });
    input.response.statusCode = upstreamResponse.status;
    const responseBytes = Buffer.from(await upstreamResponse.arrayBuffer());
    upstreamResponse.headers.forEach((value, key) => {
      if (shouldForwardHostedContainerProxyResponseHeader(key)) {
        input.response.setHeader(key, value);
      }
    });
    input.response.setHeader("content-length", String(responseBytes.byteLength));
    input.response.end(responseBytes);

    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        host: proxied.host,
        method: input.request.method ?? "GET",
        path: proxied.path,
        search: proxied.search,
        status: String(upstreamResponse.status),
        upstreamRewritten: upstream.rewritten ? "true" : "false",
        upstreamUrl: upstream.url.toString(),
      },
      message: "Hosted container internal worker proxy completed request.",
      phase: "side-effects.draining",
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        host: proxied.host,
        method: input.request.method ?? "GET",
        path: proxied.path,
        search: proxied.search,
        upstreamRewritten: upstream.rewritten ? "true" : "false",
        upstreamUrl: upstream.url.toString(),
      },
      error,
      level: "warn",
      message: "Hosted container internal worker proxy failed.",
      phase: "failed",
    });
    writeJsonResponse(input.response, 502, {
      detail: readHostedContainerProxyErrorDetail(error),
      error: "Hosted runner internal proxy failed.",
    });
  }
}

function shouldForwardHostedContainerProxyRequestHeader(name: string): boolean {
  switch (name.toLowerCase()) {
    case "connection":
    case "content-length":
    case "host":
    case "keep-alive":
    case "proxy-authenticate":
    case "proxy-authorization":
    case "te":
    case "trailer":
    case "transfer-encoding":
    case "upgrade":
      return false;
    default:
      return true;
  }
}

function shouldForwardHostedContainerProxyResponseHeader(name: string): boolean {
  switch (name.toLowerCase()) {
    case "connection":
    case "content-encoding":
    case "content-length":
    case "keep-alive":
    case "proxy-authenticate":
    case "proxy-authorization":
    case "te":
    case "trailer":
    case "transfer-encoding":
    case "upgrade":
      return false;
    default:
      return true;
  }
}

function readHostedContainerProxyErrorDetail(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;

  while (current !== null && current !== undefined && depth < 4) {
    if (current instanceof Error) {
      const name = current.name.trim();
      const message = current.message.trim();
      const summary = [name, message].filter((part) => part.length > 0).join(": ");
      if (summary.length > 0) {
        parts.push(summary);
      }
      current = "cause" in current ? current.cause : null;
      depth += 1;
      continue;
    }

    const fallback = String(current).trim();
    if (fallback.length > 0) {
      parts.push(fallback);
    }
    break;
  }

  return parts.length > 0
    ? parts.join(" <- ")
    : "Unknown upstream proxy error.";
}

function parseHostedContainerInternalWorkerProxyTarget(
  requestUrl: URL,
): {
  host: string;
  path: string;
  search: string;
  url: URL;
} | null {
  const suffix = requestUrl.pathname.slice(HOSTED_CONTAINER_INTERNAL_WORKER_PROXY_PREFIX.length);
  if (!suffix) {
    return null;
  }

  const slashIndex = suffix.indexOf("/");
  const encodedHost = slashIndex === -1 ? suffix : suffix.slice(0, slashIndex);
  const path = slashIndex === -1 ? "/" : suffix.slice(slashIndex);
  let host: string;

  try {
    host = decodeURIComponent(encodedHost);
  } catch {
    return null;
  }

  if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(host)) {
    return null;
  }

  const url = new URL(`http://${host}${path}`);
  url.search = requestUrl.search;

  return {
    host,
    path: url.pathname,
    search: url.search,
    url,
  };
}

function buildHostedContainerInternalWorkerProxyUrl(baseUrl: string, targetUrl: URL): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const proxied = new URL(
    `${encodeURIComponent(targetUrl.hostname)}${targetUrl.pathname}`,
    normalizedBase,
  );
  proxied.search = targetUrl.search;
  return proxied;
}

function resolveHostedContainerInternalWorkerProxyUpstream(input: {
  host: string;
  path: string;
  search: string;
  url: URL;
}): {
  preserveHostHeader: boolean;
  rewritten: boolean;
  url: URL;
} {
  const configuredBaseUrl = process.env[HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL_ENV]?.trim();
  if (!configuredBaseUrl) {
    return {
      preserveHostHeader: false,
      rewritten: false,
      url: input.url,
    };
  }

  let upstreamBaseUrl: URL;
  try {
    upstreamBaseUrl = new URL(configuredBaseUrl);
  } catch {
    throw new TypeError(
      `${HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL_ENV} must be an absolute URL.`,
    );
  }

  if (upstreamBaseUrl.protocol !== "http:" && upstreamBaseUrl.protocol !== "https:") {
    throw new TypeError(
      `${HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL_ENV} must use http or https.`,
    );
  }
  if (!isHostedContainerLocalProxyHostname(upstreamBaseUrl.hostname)) {
    throw new TypeError(
      `${HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL_ENV} must target a local loopback host.`,
    );
  }

  const upstreamUrl = new URL(input.path, ensureTrailingSlash(upstreamBaseUrl));
  upstreamUrl.search = input.search;

  return {
    preserveHostHeader: true,
    rewritten: true,
    url: upstreamUrl,
  };
}

function isHostedContainerLocalProxyHostname(value: string): boolean {
  return value === "127.0.0.1"
    || value === "localhost"
    || value === "::1"
    || value === "host.docker.internal";
}

function ensureTrailingSlash(value: URL): URL {
  if (value.pathname.endsWith("/")) {
    return value;
  }

  const next = new URL(value.toString());
  next.pathname = `${next.pathname}/`;
  return next;
}

async function parseHostedExecutionContainerRunRequest(value: unknown): Promise<{
  internalWorkerProxyToken: string | null;
  job: HostedAssistantRuntimeJobInput;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted container runner request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const { assistantRuntime } = await loadHostedContainerRunnerRuntime();

  return {
    internalWorkerProxyToken: readNullableString(
      record.internalWorkerProxyToken,
      "Hosted container runner request.internalWorkerProxyToken",
    ),
    job: assistantRuntime.parseHostedAssistantRuntimeJobInput(record.job),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

  await startHostedContainerEntrypoint({
    controlToken: readControlTokenFromEnv(process.env),
    port,
    runtime: {
      processIsolation: true,
    },
  });

  await new Promise(() => {});
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

async function readHostedContainerRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
}

function canHttpRequestCarryBody(method: string | undefined): boolean {
  return method !== "GET" && method !== "HEAD";
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

function createRequestAbortController(
  request: IncomingMessage,
  response: ServerResponse,
): {
  cleanup: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("Hosted runner request aborted before completion."));
    }
  };
  const handleResponseClose = () => {
    if (!response.writableEnded) {
      abort();
    }
  };

  request.once("aborted", abort);
  response.once("close", handleResponseClose);

  return {
    cleanup: () => {
      request.off("aborted", abort);
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
  message: string;
  statusCode: number;
} {
  if (error instanceof SyntaxError) {
    return {
      message: "Invalid JSON.",
      statusCode: 400,
    };
  }

  if (error instanceof TypeError || error instanceof RangeError || error instanceof URIError) {
    return {
      message: "Invalid request.",
      statusCode: 400,
    };
  }

  return {
    message: "Internal error.",
    statusCode: 500,
  };
}

async function runHostedExecutionJob(
  input: HostedAssistantRuntimeJobInput,
  options?: {
    internalWorkerProxyBaseUrl?: string | null;
    internalWorkerProxyToken?: string | null;
    signal?: AbortSignal;
  },
): Promise<Awaited<ReturnType<typeof import("./node-runner.js")["runHostedExecutionJob"]>>> {
  const runtime = await loadHostedContainerRunnerRuntime();
  return await runtime.nodeRunner.runHostedExecutionJob(input, options);
}

async function loadHostedContainerRunnerRuntime(): Promise<{
  assistantRuntime: typeof import("@murphai/assistant-runtime");
  nodeRunner: typeof import("./node-runner.js");
}> {
  hostedContainerRunnerRuntimeLoader ??= Promise.all([
    import("@murphai/assistant-runtime"),
    import("./node-runner.js"),
  ]).then(([assistantRuntime, nodeRunner]) => ({
    assistantRuntime,
    nodeRunner,
  }));

  return await hostedContainerRunnerRuntimeLoader;
}

function isHostedAssistantConfigurationError(
  error: unknown,
): error is Error & { code?: string | null } {
  return error instanceof Error && error.name === "HostedAssistantConfigurationError";
}
