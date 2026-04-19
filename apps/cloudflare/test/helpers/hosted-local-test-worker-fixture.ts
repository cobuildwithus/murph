import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import type {
  HostedExecutionUserStatus,
  HostedExecutionWake,
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
  appendTestHostedWake,
  commitTestHostedWakeCursor,
  fetchTestHostedWakeBatch,
  finalizeTestHostedWakeCursor,
  materializeTestHostedWakes,
  quarantineTestHostedWake,
  readTestHostedWakeStatus,
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

  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(formatFailure([
      `${input.method} ${input.pathname} failed with HTTP ${response.status}.`,
      `body: ${rawBody}`,
    ], input.getStdout(), input.getStderr()));
  }

  if (rawBody.length === 0) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    throw new Error(formatFailure([
      `Failed to parse JSON from ${input.method} ${input.pathname}.`,
      error instanceof Error ? error.message : String(error),
      `body: ${rawBody}`,
    ], input.getStdout(), input.getStderr()));
  }
}

function isRunnerPauseState(value: unknown): value is {
  entered: boolean;
  hasRequest: boolean;
} {
  return typeof value === "object"
    && value !== null
    && "entered" in value
    && typeof (value as { entered?: unknown }).entered === "boolean"
    && "hasRequest" in value
    && typeof (value as { hasRequest?: unknown }).hasRequest === "boolean";
}

function isHostedExecutionUserStatus(value: unknown): value is HostedExecutionUserStatus {
  return typeof value === "object"
    && value !== null
    && "pendingWakeCount" in value
    && typeof (value as { pendingWakeCount?: unknown }).pendingWakeCount === "number";
}

function formatFailure(lines: string[], stdout: string, stderr: string): string {
  return [
    ...lines,
    `stdout tail: ${tail(stdout)}`,
    `stderr tail: ${tail(stderr)}`,
  ].join("\n");
}

function tail(value: string, maxChars: number = 2_000): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}

async function startHostedWakeControlServer(): Promise<{
  baseUrl: string;
  server: Server;
}> {
  const bucket = new InMemoryR2Bucket();
  const server = createServer(async (request, response) => {
    try {
      await handleHostedWakeControlRequest(request, response, bucket);
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to resolve the hosted wake control server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function handleHostedWakeControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  bucket: R2BucketLike,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const userId = request.headers["x-hosted-execution-user-id"];

  if (typeof userId !== "string" || userId.length === 0) {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: "x-hosted-execution-user-id is required." }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/internal/hosted-wake/unseen") {
    const body = await readJsonBody<HostedWakeFetchRequest>(request);
    response.end(JSON.stringify(await fetchTestHostedWakeBatch({
      body,
      bucket,
      userId,
    })));
    return;
  }

  if (method === "POST" && url.pathname === "/api/internal/hosted-wake/test-append") {
    const body = await readJsonBody<HostedExecutionWake>(request);
    response.end(JSON.stringify(await appendTestHostedWake({
      bucket,
      wake: body,
    } satisfies {
      bucket: R2BucketLike;
      wake: HostedExecutionWake;
    }) satisfies HostedWakeAppendResponse));
    return;
  }

  if (method === "POST" && url.pathname === "/api/internal/hosted-wake/commit") {
    const body = await readJsonBody<HostedWakeCommitRequest>(request);
    response.end(JSON.stringify(await commitTestHostedWakeCursor({
      body,
      bucket,
      userId,
    })));
    return;
  }

  if (method === "POST" && url.pathname === "/api/internal/hosted-wake/finalize") {
    const body = await readJsonBody<HostedWakeFinalizeRequest>(request);
    response.end(JSON.stringify(await finalizeTestHostedWakeCursor({
      body,
      bucket,
      userId,
    })));
    return;
  }

  if (method === "POST" && url.pathname === "/api/internal/hosted-wake/terminal") {
    const body = await readJsonBody<HostedWakeTerminalRequest>(request);
    response.end(JSON.stringify(await recordTestHostedWakeTerminal({
      body,
      bucket,
      userId,
    })));
    return;
  }

  if (method === "POST" && url.pathname === "/api/internal/hosted-wake/materialize") {
    response.end(JSON.stringify(await materializeTestHostedWakes({
      body: {},
      bucket,
      userId,
    })));
    return;
  }

  if (method === "POST" && url.pathname === "/api/internal/hosted-wake/quarantine") {
    const body = await readJsonBody<HostedWakeQuarantineRequest>(request);
    response.end(JSON.stringify(await quarantineTestHostedWake({
      body,
      bucket,
      userId,
    })));
    return;
  }

  if (method === "POST" && url.pathname === "/api/internal/hosted-wake/status") {
    const body = await readJsonBody<HostedWakeStatusRequest>(request);
    response.end(JSON.stringify(await readTestHostedWakeStatus({
      body,
      bucket,
      userId,
    })));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ error: "Not found." }));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw.length === 0 ? "{}" : raw) as T;
}

class InMemoryR2Bucket implements R2BucketLike {
  private readonly entries = new Map<string, string>();

  async get(key: string) {
    const value = this.entries.get(key);

    if (value === undefined) {
      return null;
    }

    return {
      async arrayBuffer() {
        return new TextEncoder().encode(value).buffer.slice(0);
      },
    };
  }

  async put(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
