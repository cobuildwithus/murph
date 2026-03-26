import { createServer } from "node:http";

import { runHostedExecutionJob, type HostedExecutionRunnerJobRequest } from "./node-runner.js";

export async function startHostedRunnerServer(input: {
  controlToken: string | null;
  port?: number;
}): Promise<ReturnType<typeof createServer>> {
  // The one-shot runner mutates process.env around execution, so jobs must not overlap.
  let runQueue = Promise.resolve<void>(undefined);

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

      if (input.controlToken) {
        const authorization = request.headers.authorization ?? "";

        if (authorization !== `Bearer ${input.controlToken}`) {
          response.statusCode = 401;
          response.end("Unauthorized");
          return;
        }
      }

      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const job = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HostedExecutionRunnerJobRequest;
      const result = await enqueueHostedRunnerJob(() => runHostedExecutionJob(job));

      response.statusCode = 200;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  function enqueueHostedRunnerJob<T>(job: () => Promise<T>): Promise<T> {
    const nextJob = runQueue.then(job, job);
    runQueue = nextJob.then(() => undefined, () => undefined);
    return nextJob;
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 8080, () => resolve());
  });

  return server;
}
