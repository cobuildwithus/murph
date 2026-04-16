import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HostedExecutionUserStatus } from "@murphai/hosted-execution";

import { repoRoot } from "../../vitest.shared.js";
import {
  sleep,
  terminateChildProcessAndWait,
  waitForHealthyHttpEndpoint,
} from "../../../../scripts/dev-hosted-local/runtime.ts";

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
  port: number;
}): Promise<HostedLocalTestWorkerFixture> {
  const persistDir = await mkdtemp(path.join(os.tmpdir(), input.persistDirPrefix ?? "murph-hosted-test-worker-"));
  const baseUrl = `http://127.0.0.1:${input.port}`;
  let child: ChildProcess | null = null;
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

    await rm(persistDir, {
      force: true,
      recursive: true,
    });
  };

  try {
    child = spawn("pnpm", [
      "--dir",
      "apps/cloudflare",
      "exec",
      "wrangler",
      "dev",
      "--config",
      "./test/workers/wrangler.vitest.jsonc",
      "--ip",
      "127.0.0.1",
      "--port",
      String(input.port),
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
      await waitForHealthyHttpEndpoint({
        host: "127.0.0.1",
        label: "cloudflare-test-worker",
        path: "/health",
        port: input.port,
        protocol: "http",
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
    && "pendingEventCount" in value
    && typeof (value as { pendingEventCount?: unknown }).pendingEventCount === "number"
    && "retryingEventId" in value;
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
