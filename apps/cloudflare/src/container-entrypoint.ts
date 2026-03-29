import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { runHostedExecutionJob, type HostedExecutionRunnerJobRequest } from "./node-runner.js";

export async function startHostedContainerEntrypoint(input: {
  controlToken: string | null;
  port?: number;
}): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    const requestAbort = createRequestAbortController(request, response);

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
        writeJsonResponse(response, 503, {
          error: "Hosted runner control token is not configured.",
        });
        return;
      }

      const authorization = request.headers.authorization ?? "";

      if (authorization !== `Bearer ${input.controlToken}`) {
        writeJsonResponse(response, 401, {
          error: "Unauthorized",
        });
        return;
      }

      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      let job: HostedExecutionRunnerJobRequest;

      try {
        job = parseHostedExecutionRunnerJobRequest(Buffer.concat(chunks));
      } catch (error) {
        console.warn("Hosted container entrypoint rejected the request body.", error);
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

      console.error("Hosted container entrypoint failed.", error);
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

function parseHostedExecutionRunnerJobRequest(payload: Uint8Array): HostedExecutionRunnerJobRequest {
  return requireJsonObject(
    JSON.parse(Buffer.from(payload).toString("utf8")),
  ) as unknown as HostedExecutionRunnerJobRequest;
}

function requireJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
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
