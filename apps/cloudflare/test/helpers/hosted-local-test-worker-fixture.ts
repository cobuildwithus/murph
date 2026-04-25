import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import type {
  HostedExecutionUserStatus,
  HostedExecutionWake,
  HostedRunAcquireRequest,
  HostedRunCommitRequest,
  HostedRunFinalizeRequest,
  HostedRunLogRequest,
  HostedRunLogRecord,
  HostedRunReleaseFinalizeRequest,
  HostedRunStatusRequest,
  HostedWakeCommitRequest,
  HostedWakeFetchRequest,
  HostedWakeFinalizeRequest,
  HostedWakeAppendResponse,
  HostedWakeQuarantineRequest,
  HostedWakeStatusRequest,
  HostedWakeTerminalRequest,
} from "@murphai/hosted-execution/contracts";

import { repoRoot } from "../../vitest.shared.js";
import type { R2BucketLike } from "../../src/bundle-store.js";
import {
  acquireTestHostedRun,
  armTestHostedRuntimeWake,
  appendTestHostedWake,
  commitTestHostedRun,
  commitTestHostedWakeCursor,
  fetchTestHostedWakeBatch,
  finalizeTestHostedRun,
  finalizeTestHostedWakeCursor,
  materializeTestHostedWakes,
  readTestHostedRunStatus,
  quarantineTestHostedWake,
  recordTestHostedRunLog,
  readTestHostedWakeStatus,
  releaseTestHostedRunFinalize,
  recordTestHostedWakeTerminal,
} from "../workers/test-hosted-wake-control.js";
import {
  sleep,
  terminateChildProcessAndWait,
  waitForHealthyHttpEndpoint,
} from "../../../../scripts/dev-hosted-local/runtime.ts";

const wranglerVitestConfigPath = path.join(repoRoot, "apps/cloudflare/test/workers/wrangler.vitest.jsonc");
const wranglerVitestWorkerEntryPath = path.join(repoRoot, "apps/cloudflare/test/workers/worker-entry.ts");
const hostedWakeControlBaseUrlPlaceholder = "http://127.0.0.1:8913";

export interface HostedLocalTestWorkerClient {
  getJson(pathname: string): Promise<unknown>;
  postJson(pathname: string, body: unknown, headers?: Record<string, string>): Promise<unknown>;
}

export interface HostedLocalTestWorkerFixture {
  client: HostedLocalTestWorkerClient;
  dispose(): Promise<void>;
  getHostedRunLogs(userId: string): Promise<HostedRunLogRecord[]>;
  waitForRunnerPauseEntry(eventId: string): Promise<void>;
  waitForUserStatus(
    userId: string,
    predicate: (status: HostedExecutionUserStatus) => boolean,
  ): Promise<HostedExecutionUserStatus>;
}

export async function startHostedLocalTestWorkerFixture(input: {
  persistDirPrefix?: string;
  port?: number;
}): Promise<HostedLocalTestWorkerFixture> {
  const persistDir = await mkdtemp(path.join(os.tmpdir(), input.persistDirPrefix ?? "murph-hosted-test-worker-"));
  const workerPort = input.port ?? await reserveTcpPort();
  const baseUrl = `http://127.0.0.1:${workerPort}`;
  let child: ChildProcess | null = null;
  let hostedWakeControlServer: Server | null = null;
  let stdout = "";
  let stderr = "";

  const client = createHostedLocalTestWorkerClient({
    baseUrl,
    getStderr: () => stderr,
    getStdout: () => stdout,
  });

  const dispose = async (): Promise<void> => {
    if (child?.pid) {
      await terminateChildProcessAndWait(child, { signal: "SIGTERM" });
    }

    child = null;

    if (hostedWakeControlServer) {
      hostedWakeControlServer.closeIdleConnections?.();
      hostedWakeControlServer.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        hostedWakeControlServer?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    hostedWakeControlServer = null;

    await rm(persistDir, {
      force: true,
      recursive: true,
    });
  };

  try {
    const hostedWakeControl = await startHostedWakeControlServer();
    hostedWakeControlServer = hostedWakeControl.server;
    const wranglerConfigPath = await writeHostedLocalWranglerConfig({
      hostedWebBaseUrl: hostedWakeControl.baseUrl,
      persistDir,
    });
    child = spawn("pnpm", [
      "--dir",
      "apps/cloudflare",
      "exec",
      "wrangler",
      "dev",
      "--config",
      wranglerConfigPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(workerPort),
      "--local-protocol",
      "http",
      "--persist-to",
      persistDir,
    ], {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      await waitForWorkerReady({
        child,
        getStderr: () => stderr,
        getStdout: () => stdout,
        port: workerPort,
      });
    } catch (error) {
      await dispose().catch(() => {});
      throw new Error(formatFailure([
        error instanceof Error ? error.message : String(error),
      ], stdout, stderr));
    }

    return {
      client,
      dispose,
      getHostedRunLogs: hostedWakeControl.getLogs,
      waitForRunnerPauseEntry: async (eventId: string): Promise<void> => {
        const startedAt = Date.now();

        while ((Date.now() - startedAt) < 180_000) {
          const state = await client.getJson(`/__test/runner/pause?eventId=${encodeURIComponent(eventId)}`);

          if (isRunnerPauseState(state) && state.entered === true && state.hasRequest === true) {
            return;
          }

          await sleep(250);
        }

        throw new Error(formatFailure([
          `Timed out waiting for the paused runner commit for ${eventId}.`,
        ], stdout, stderr));
      },
      waitForUserStatus: async (
        userId: string,
        predicate: (status: HostedExecutionUserStatus) => boolean,
      ): Promise<HostedExecutionUserStatus> => {
        const startedAt = Date.now();

        while ((Date.now() - startedAt) < 180_000) {
          const status = await client.getJson(`/__test/status?userId=${encodeURIComponent(userId)}`);

          if (isHostedExecutionUserStatus(status) && predicate(status)) {
            return status;
          }

          await sleep(250);
        }

        throw new Error(formatFailure([
          `Timed out waiting for the hosted user status predicate for ${userId}.`,
        ], stdout, stderr));
      },
    };
  } catch (error) {
    if (child?.pid) {
      await dispose().catch(() => {});
    } else {
      await rm(persistDir, {
        force: true,
        recursive: true,
      }).catch(() => {});
    }

    throw error;
  }
}

async function waitForWorkerReady(input: {
  child: ChildProcess;
  getStderr: () => string;
  getStdout: () => string;
  port: number;
}): Promise<void> {
  await Promise.race([
    waitForHealthyHttpEndpoint({
      host: "127.0.0.1",
      label: "cloudflare-test-worker",
      path: "/health",
      port: input.port,
      protocol: "http",
    }),
    waitForWorkerExit(input),
  ]);
}

async function waitForWorkerExit(input: {
  child: ChildProcess;
  getStderr: () => string;
  getStdout: () => string;
  port: number;
}): Promise<never> {
  await new Promise<void>((resolve, reject) => {
    input.child.once("error", reject);
    input.child.once("exit", (code, signal) => {
      reject(new Error(formatFailure([
        `Wrangler exited before the hosted local test worker became healthy on port ${input.port}.`,
        `exit code: ${code === null ? "unknown" : String(code)}`,
        `signal: ${signal ?? "none"}`,
      ], input.getStdout(), input.getStderr())));
    });
  });

  throw new Error("Unreachable.");
}

async function reserveTcpPort(): Promise<number> {
  const server = createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Failed to resolve an ephemeral TCP port.");
    }

    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }).catch(() => {});
  }
}

async function writeHostedLocalWranglerConfig(input: {
  hostedWebBaseUrl: string;
  persistDir: string;
}): Promise<string> {
  const rawConfig = await readFile(wranglerVitestConfigPath, "utf8");
  const nextConfig = rawConfig.replace(
    hostedWakeControlBaseUrlPlaceholder,
    input.hostedWebBaseUrl,
  ).replace(
    '"main": "./worker-entry.ts"',
    `"main": ${JSON.stringify(wranglerVitestWorkerEntryPath)}`,
  );

  if (nextConfig === rawConfig) {
    throw new Error("Failed to rewrite HOSTED_WEB_BASE_URL in the hosted local Wrangler config.");
  }

  const configPath = path.join(input.persistDir, "wrangler.hosted-local-test.jsonc");
  await writeFile(configPath, nextConfig, "utf8");
  return configPath;
}

function createHostedLocalTestWorkerClient(input: {
  baseUrl: string;
  getStderr: () => string;
  getStdout: () => string;
}): HostedLocalTestWorkerClient {
  return {
    async getJson(pathname: string): Promise<unknown> {
      return await requestJson({
        baseUrl: input.baseUrl,
        getStderr: input.getStderr,
        getStdout: input.getStdout,
        method: "GET",
        pathname,
      });
    },
    async postJson(pathname: string, body: unknown, headers?: Record<string, string>): Promise<unknown> {
      return await requestJson({
        baseUrl: input.baseUrl,
        body,
        getStderr: input.getStderr,
        getStdout: input.getStdout,
        headers,
        method: "POST",
        pathname,
      });
    },
  };
}

async function requestJson(input: {
  baseUrl: string;
  body?: unknown;
  getStderr: () => string;
  getStdout: () => string;
  headers?: Record<string, string>;
  method: "GET" | "POST";
  pathname: string;
}): Promise<unknown> {
  const response = await fetch(new URL(input.pathname, `${input.baseUrl}/`), {
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: {
      ...(input.body === undefined ? {} : {
        "content-type": "application/json; charset=utf-8",
      }),
      ...(input.headers ?? {}),
    },
    method: input.method,
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(formatFailure([
      `${input.method} ${input.pathname} failed with HTTP ${response.status}.`,
      `body: ${body}`,
    ], input.getStdout(), input.getStderr()));
  }

  if (!body) {
    return null;
  }

  try {
    return parseJsonValue(body);
  } catch (error) {
    throw new Error(formatFailure([
      `${input.method} ${input.pathname} returned non-JSON output.`,
      `body: ${body}`,
      error instanceof Error ? error.message : String(error),
    ], input.getStdout(), input.getStderr()));
  }
}

async function startHostedWakeControlServer(): Promise<{
  baseUrl: string;
  getLogs(userId: string): Promise<HostedRunLogRecord[]>;
  server: Server;
}> {
  const bucket = new Map<string, string>();
  const testBucket: R2BucketLike = {
    async delete(key) {
      bucket.delete(key);
    },
    async get(key) {
      const value = bucket.get(key);
      if (value === undefined) {
        return null;
      }

      return {
        async arrayBuffer() {
          return Buffer.from(value, "utf8");
        },
        async json() {
          return parseJsonValue(value);
        },
        async text() {
          return value;
        },
      };
    },
    async put(key, value) {
      if (typeof value === "string") {
        bucket.set(key, value);
        return;
      }

      if (value instanceof Uint8Array) {
        bucket.set(key, Buffer.from(value).toString("utf8"));
        return;
      }

      bucket.set(key, String(value));
    },
  };

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const jsonBody = await readJsonBody(request);

    if (request.method === "POST" && url.pathname === "/__test/hosted-wake/materialize") {
      const result = await materializeTestHostedWakes({
        body: jsonBody as HostedWakeFetchRequest,
        bucket: testBucket,
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/hosted-wake/append") {
      const result = await appendTestHostedWake({
        bucket: testBucket,
        wake: jsonBody as HostedExecutionWake,
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/hosted-wake/fetch") {
      const result = await fetchTestHostedWakeBatch({
        body: jsonBody as HostedWakeFetchRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/hosted-wake/commit") {
      const result = await commitTestHostedWakeCursor({
        body: jsonBody as HostedWakeCommitRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/hosted-wake/finalize") {
      const result = await finalizeTestHostedWakeCursor({
        body: jsonBody as HostedWakeFinalizeRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/hosted-wake/status") {
      const result = await readTestHostedWakeStatus({
        body: jsonBody as HostedWakeStatusRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/hosted-wake/quarantine") {
      const result = await quarantineTestHostedWake({
        body: jsonBody as HostedWakeQuarantineRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/hosted-wake/terminal") {
      const result = await recordTestHostedWakeTerminal({
        body: jsonBody as HostedWakeTerminalRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/internal/hosted-run/acquire") {
      const result = await acquireTestHostedRun({
        body: jsonBody as HostedRunAcquireRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/internal/hosted-run/commit") {
      const result = await commitTestHostedRun({
        body: jsonBody as HostedRunCommitRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/internal/hosted-run/finalize") {
      const result = await finalizeTestHostedRun({
        body: jsonBody as HostedRunFinalizeRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/internal/hosted-run/release-finalize") {
      const result = await releaseTestHostedRunFinalize({
        body: jsonBody as HostedRunReleaseFinalizeRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/internal/hosted-run/status") {
      const result = await readTestHostedRunStatus({
        body: jsonBody as HostedRunStatusRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/internal/hosted-run/log") {
      const result = await recordTestHostedRunLog({
        body: jsonBody as HostedRunLogRequest,
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/hosted-run/runtime-wake") {
      const body = jsonBody as { occurredAt?: unknown };
      const result = await armTestHostedRuntimeWake({
        bucket: testBucket,
        userId: readBoundUserId(request, jsonBody),
        wakeAt: typeof body?.occurredAt === "string" ? body.occurredAt : new Date().toISOString(),
      });
      writeJson(response, 200, result);
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected the hosted wake control server to bind a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    getLogs: async (userId: string) => {
      const result = await readTestHostedRunStatus({
        body: {
          includeLogs: true,
        },
        bucket: testBucket,
        userId,
      });

      return result.logs ?? [];
    },
    server,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? parseJsonValue(body) : null;
}

function parseJsonValue(text: string): unknown {
  return JSON.parse(text);
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function readBoundUserId(request: IncomingMessage, body: unknown): string {
  const headerValue = request.headers["x-hosted-execution-user-id"];
  if (typeof headerValue === "string" && headerValue.length > 0) {
    return headerValue;
  }

  if (Array.isArray(headerValue) && typeof headerValue[0] === "string" && headerValue[0].length > 0) {
    return headerValue[0];
  }

  if (body && typeof body === "object" && "userId" in body && typeof body.userId === "string" && body.userId.length > 0) {
    return body.userId;
  }

  throw new Error("Expected a bound hosted execution user id.");
}

function isRunnerPauseState(
  value: unknown,
): value is {
  entered: boolean;
  hasRequest: boolean;
} {
  return Boolean(
    value
    && typeof value === "object"
    && "entered" in value
    && typeof value.entered === "boolean"
    && "hasRequest" in value
    && typeof value.hasRequest === "boolean",
  );
}

function isHostedExecutionUserStatus(value: unknown): value is HostedExecutionUserStatus {
  return Boolean(
    value
    && typeof value === "object"
    && "userId" in value
    && typeof value.userId === "string"
    && "pendingIngressEventCount" in value
    && typeof value.pendingIngressEventCount === "number"
    && "inFlight" in value
    && typeof value.inFlight === "boolean",
  );
}

function formatFailure(summaryLines: readonly string[], stdout: string, stderr: string): string {
  return [
    ...summaryLines,
    `stdout:\n${stdout}`,
    `stderr:\n${stderr}`,
  ].join("\n\n");
}
