import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  parseHostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobInput,
} from "@murphai/assistant-runtime";
import {
  HostedAssistantConfigurationError,
} from "@murphai/assistant-runtime/hosted-assistant-env";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import { runHostedExecutionJob } from "./node-runner.js";

let activeHostedRunnerJobCount = 0;

class HostedRunnerShellIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedRunnerShellIsolationError";
  }
}

export async function startHostedContainerEntrypoint(input: {
  controlToken: string | null;
  port?: number;
}): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    const requestAbort = createRequestAbortController(request, response);
    let claimedRunnerSlot = false;
    let job: HostedAssistantRuntimeJobInput | null = null;
    let internalWorkerProxyToken: string | null = null;

    try {
      if (request.method === "GET" && request.url === "/health") {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner-node" }));
        return;
      }

      if (request.method !== "POST" || request.url !== "/__internal/run") {
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
        const parsed = parseHostedExecutionContainerRunRequest(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        );
        job = parsed.job;
        internalWorkerProxyToken = parsed.internalWorkerProxyToken;
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

      const result = await runHostedExecutionJob(job, {
        internalWorkerProxyToken,
        signal: requestAbort.signal,
      });
      if (shouldSweepHostedContainerProcesses(input)) {
        await enforceHostedContainerProcessIsolation();
      }

      if (requestAbort.signal.aborted || response.destroyed) {
        return;
      }

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
        scheduleHostedContainerExit();
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
  });

  return server;
}

function parseHostedExecutionContainerRunRequest(value: unknown): {
  internalWorkerProxyToken: string | null;
  job: HostedAssistantRuntimeJobInput;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted container runner request must be an object.");
  }

  const record = value as Record<string, unknown>;

  return {
    internalWorkerProxyToken: readNullableString(
      record.internalWorkerProxyToken,
      "Hosted container runner request.internalWorkerProxyToken",
    ),
    job: parseHostedAssistantRuntimeJobInput(record.job),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

  await startHostedContainerEntrypoint({
    controlToken: readControlTokenFromEnv(process.env),
    port,
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

function shouldSweepHostedContainerProcesses(input: {
  controlToken: string | null;
}): boolean {
  return typeof input.controlToken === "string"
    && input.controlToken.length > 0
    && process.env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN === input.controlToken;
}

async function enforceHostedContainerProcessIsolation(): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  const firstPass = await listUnexpectedHostedContainerProcessIds();
  if (firstPass.length === 0) {
    return;
  }

  for (const pid of firstPass) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Re-check after the cleanup pass.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 25));

  const secondPass = await listUnexpectedHostedContainerProcessIds();
  if (secondPass.length > 0) {
    throw new HostedRunnerShellIsolationError(
      `Hosted runner shell still has unexpected live processes after cleanup: ${secondPass.join(", ")}.`,
    );
  }
}

async function listUnexpectedHostedContainerProcessIds(): Promise<number[]> {
  let entries;
  try {
    entries = await readdir("/proc", { encoding: "utf8", withFileTypes: true });
  } catch (error) {
    throw new HostedRunnerShellIsolationError(
      `Hosted runner shell could not inspect /proc for warm-container cleanup: ${String(error)}.`,
    );
  }

  const unexpected: number[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pid = Number.parseInt(entry.name, 10);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
      continue;
    }

    const processState = await readHostedContainerProcessState(pid);
    if (processState === "Z") {
      continue;
    }

    unexpected.push(pid);
  }

  return unexpected;
}

async function readHostedContainerProcessState(pid: number): Promise<string | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(") ");

    if (commandEnd === -1 || commandEnd + 2 >= stat.length) {
      return null;
    }

    return stat.charAt(commandEnd + 2);
  } catch {
    return null;
  }
}

function scheduleHostedContainerExit(): void {
  process.exitCode = 1;
  setImmediate(() => {
    process.exit(1);
  });
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
  if (error instanceof HostedAssistantConfigurationError) {
    return {
      payload: {
        code: error.code,
        error: error.message,
      },
      statusCode: 503,
    };
  }

  return {
    payload: {
      error: "Internal error.",
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
