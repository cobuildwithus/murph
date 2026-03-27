import { createServer, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { runHostedExecutionJob, type HostedExecutionRunnerJobRequest } from "./node-runner.js";

export async function startHostedContainerEntrypoint(input: {
  controlToken: string | null;
  port?: number;
}): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
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

      const job = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as HostedExecutionRunnerJobRequest;
      const result = await runHostedExecutionJob(job);

      response.statusCode = 200;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(result));
    } catch (error) {
      writeJsonResponse(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
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
