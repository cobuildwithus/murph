import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  emitHostedExecutionStructuredLog,
  parseHostedExecutionRunnerRequest,
} from "@murph/hosted-execution";

import { requireJsonObject } from "./json.ts";
import { runHostedExecutionJob, type HostedExecutionRunnerJobRequest } from "./node-runner.js";

export async function startHostedContainerEntrypoint(input: {
  controlToken: string | null;
  port?: number;
}): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    const requestAbort = createRequestAbortController(request, response);
    let job: HostedExecutionRunnerJobRequest | null = null;

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

      const authorization = request.headers.authorization ?? "";

      if (authorization !== `Bearer ${input.controlToken}`) {
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

      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      try {
        job = parseHostedExecutionRunnerJobPayload(Buffer.concat(chunks));
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
        signal: requestAbort.signal,
      });

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
        dispatch: typeof job === "object" && job ? job.dispatch : null,
        error,
        message: "Hosted container entrypoint failed a runner job.",
        phase: "failed",
        run: typeof job === "object" && job ? job.run ?? null : null,
      });
      writeJsonResponse(response, 500, {
        error: "Internal error.",
      });
    } finally {
      requestAbort.cleanup();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 8080, () => resolve());
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

  await startHostedContainerEntrypoint({
    controlToken: process.env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN ?? null,
    port,
  });

  await new Promise(() => {});
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

function parseHostedExecutionRunnerJobPayload(payload: Uint8Array): HostedExecutionRunnerJobRequest {
  const record = requireJsonObject(
    JSON.parse(Buffer.from(payload).toString("utf8")),
  );
  parseHostedExecutionRunnerRequest({
    bundles: record.bundles,
    dispatch: record.dispatch,
    ...(record.run === undefined ? {} : { run: record.run }),
  });

  return record as unknown as HostedExecutionRunnerJobRequest;
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
