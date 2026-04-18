import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildCloudflareHostedControlUserStatusPath } from "@murphai/cloudflare-hosted-control/routes";
import { parseHostedExecutionUserStatus } from "@murphai/hosted-execution/parsers";
import type { HostedExecutionUserStatus } from "@murphai/hosted-execution";

import { repoRoot } from "../../vitest.shared.js";
import { resolveHostedLocalDevConfig } from "../../../../scripts/dev-hosted-local/config.ts";
import {
  terminateChildProcessAndWait,
} from "../../../../scripts/dev-hosted-local/runtime.ts";
import { resolveVercelOidcToken } from "../../../../scripts/dev-hosted-local/vercel.ts";

export interface HostedLocalDevHarness {
  config: ReturnType<typeof resolveHostedLocalDevConfig>;
  oidcToken: string;
  persistDir: string;
  request(pathname: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(pathname: string, init?: RequestInit): Promise<T>;
  readUserStatus(userId: string): Promise<HostedExecutionUserStatus>;
  stderrTail(maxChars?: number): string;
  stop(): Promise<void>;
  stdoutTail(maxChars?: number): string;
  waitForHostedCompletion(
    userId: string,
    input?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<HostedExecutionUserStatus>;
  webBaseUrl: string;
  workerBaseUrl: string;
}

export async function startHostedLocalDevHarness(input: {
  env: NodeJS.ProcessEnv;
  persistDirOverride?: string | null;
  persistDirPrefix: string;
  statusHeaders?: (userId: string) => HeadersInit;
  statusPath?: (userId: string) => string;
  streamLogs?: boolean;
}): Promise<HostedLocalDevHarness> {
  const config = resolveHostedLocalDevConfig(input.env);
  const workerBaseUrl =
    `${config.workerProtocol}://${resolveLocalHarnessBaseHost(config.workerHost)}:${config.workerPort}`;
  const webBaseUrl = `http://${resolveLocalHarnessBaseHost(config.webHost)}:${config.webPort}`;
  const statusPath = input.statusPath ?? ((userId: string) => buildCloudflareHostedControlUserStatusPath(userId));
  const statusHeaders = input.statusHeaders ?? (() => ({}));
  const streamLogs = input.streamLogs === true;
  const persistDirOverride = input.persistDirOverride?.trim() || null;
  const createdTempPersistDir = persistDirOverride === null
    ? await mkdtemp(path.join(os.tmpdir(), input.persistDirPrefix))
    : null;
  const persistDir = createdTempPersistDir
    ?? path.resolve(repoRoot, persistDirOverride ?? "");
  const readyToken = randomUUID();
  const nextDistDirSuffix = `e2e-${readyToken}`.toLowerCase();
  let child: ChildProcess | null = null;
  let oidcToken = "";
  let stdout = "";
  let stderr = "";

  const stop = async (): Promise<void> => {
    if (child?.pid) {
      await terminateChildProcessAndWait(child, { signal: "SIGTERM" });
    }

    child = null;

    if (createdTempPersistDir !== null) {
      await rm(createdTempPersistDir, { force: true, recursive: true });
      return;
    }
  };

  try {
    if (createdTempPersistDir === null) {
      await rm(persistDir, { force: true, recursive: true });
      await mkdir(persistDir, { recursive: true });
    }

    const runtimeEnv: NodeJS.ProcessEnv = {
      ...input.env,
      MURPH_DEV_CF_PERSIST_DIR: persistDir,
      MURPH_DEV_READY_TOKEN: readyToken,
      NEXT_DIST_DIR_SUFFIX: input.env.NEXT_DIST_DIR_SUFFIX?.trim() || nextDistDirSuffix,
    };

    child = spawn("pnpm", ["dev"], {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: runtimeEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (streamLogs) {
        process.stdout.write(chunk);
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (streamLogs) {
        process.stderr.write(chunk);
      }
    });

    oidcToken = await resolveVercelOidcToken(runtimeEnv);

    try {
      await waitForReadyToken({
        child,
        readyToken,
        stderr: () => stderr,
        stdout: () => stdout,
      });
      ensurePreparedRunnerContainerImageAlias(`${stdout}\n${stderr}`);
    } catch (error) {
      await stop().catch(() => {});
      throw error instanceof Error
        ? error
        : new Error(formatFailure([String(error)], stdout, stderr));
    }

    return {
      config: {
        ...config,
        workerPersistDir: persistDir,
      },
      oidcToken,
      persistDir,
      readUserStatus: async (userId: string): Promise<HostedExecutionUserStatus> => {
        return await readHostedUserStatus({
          requestJson: requestJsonForRuntime,
          statusHeaders,
          statusPath,
          userId,
        });
      },
      request: requestForRuntime,
      requestJson: requestJsonForRuntime,
      stop,
      stdoutTail: (maxChars?: number): string => tail(stdout, maxChars),
      stderrTail: (maxChars?: number): string => tail(stderr, maxChars),
      waitForHostedCompletion: async (
        userId: string,
        pollInput: {
          pollIntervalMs?: number;
          timeoutMs?: number;
        } = {},
      ): Promise<HostedExecutionUserStatus> => {
        const timeoutMs = pollInput.timeoutMs ?? 180_000;
        const pollIntervalMs = pollInput.pollIntervalMs ?? 1_000;
        const startedAt = Date.now();

        while ((Date.now() - startedAt) < timeoutMs) {
          const status = await readHostedUserStatus({
            requestJson: requestJsonForRuntime,
            statusHeaders,
            statusPath,
            userId,
          });

          if (
            status.pendingEventCount === 0
            && !status.inFlight
            && status.bundleRef !== null
            && status.lastError === null
          ) {
            return status;
          }

          await sleep(pollIntervalMs);
        }

        throw new Error(formatFailure([
          `Timed out waiting for hosted completion for ${userId}.`,
        ], stdout, stderr));
      },
      webBaseUrl,
      workerBaseUrl,
    };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }

  async function requestForRuntime(pathname: string, init?: RequestInit): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(new URL(pathname, `${workerBaseUrl}/`), {
        ...init,
        headers: buildAuthenticatedHeaders(oidcToken, init?.headers),
      });
    } catch (error) {
      throw new Error(formatFailure([
        `${init?.method ?? "GET"} ${pathname} failed before an HTTP response was received.`,
        error instanceof Error ? error.message : String(error),
      ], stdout, stderr));
    }

    if (!response.ok) {
      throw new Error(formatFailure([
        `${init?.method ?? "GET"} ${pathname} failed with HTTP ${response.status}.`,
        `body: ${await response.text()}`,
      ], stdout, stderr));
    }

    return response;
  }

  async function requestJsonForRuntime<T>(pathname: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(new URL(pathname, `${workerBaseUrl}/`), {
        ...init,
        headers: buildAuthenticatedHeaders(oidcToken, init?.headers),
      });
    } catch (error) {
      throw new Error(formatFailure([
        `${init?.method ?? "GET"} ${pathname} failed before an HTTP response was received.`,
        error instanceof Error ? error.message : String(error),
      ], stdout, stderr));
    }
    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(formatFailure([
        `${init?.method ?? "GET"} ${pathname} failed with HTTP ${response.status}.`,
        `body: ${rawBody}`,
      ], stdout, stderr));
    }

    if (rawBody.length === 0) {
      return null as T;
    }

    try {
      return JSON.parse(rawBody) as T;
    } catch (error) {
      throw new Error(formatFailure([
        `Failed to parse JSON from ${init?.method ?? "GET"} ${pathname}.`,
        error instanceof Error ? error.message : String(error),
        `body: ${rawBody}`,
      ], stdout, stderr));
    }
  }
}

function resolveLocalHarnessBaseHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

async function readHostedUserStatus(input: {
  requestJson: <T>(pathname: string, init?: RequestInit) => Promise<T>;
  statusHeaders: (userId: string) => HeadersInit;
  statusPath: (userId: string) => string;
  userId: string;
}): Promise<HostedExecutionUserStatus> {
  const status = await input.requestJson<HostedExecutionUserStatus>(input.statusPath(input.userId), {
    headers: input.statusHeaders(input.userId),
  });

  return parseHostedExecutionUserStatus(status);
}

function buildAuthenticatedHeaders(
  oidcToken: string,
  headers?: HeadersInit,
): Headers {
  const normalized = new Headers(headers);
  normalized.set("authorization", `Bearer ${oidcToken}`);
  return normalized;
}

async function waitForReadyToken(input: {
  child: ChildProcess;
  readyToken: string;
  stderr: () => string;
  stdout: () => string;
}): Promise<void> {
  const expectedLine = `__MURPH_HOSTED_LOCAL_READY__ ${input.readyToken}`;
  const startedAt = Date.now();
  const timeoutMs = 300_000;

  while ((Date.now() - startedAt) < timeoutMs) {
    if (input.stdout().includes(expectedLine)) {
      return;
    }

    if (input.child.exitCode !== null || input.child.signalCode !== null) {
      throw new Error(formatFailure([
        "Local hosted dev exited before reaching its ready checkpoint.",
      ], input.stdout(), input.stderr()));
    }

    await sleep(250);
  }

  throw new Error(formatFailure([
    "Timed out waiting for the local hosted dev ready checkpoint.",
  ], input.stdout(), input.stderr()));
}

function formatFailure(lines: string[], stdout: string, stderr: string): string {
  return [
    ...lines,
    `stdout tail: ${tail(stdout)}`,
    `stderr tail: ${tail(stderr)}`,
  ].join("\n");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function tail(value: string, maxChars: number = 2_000): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}

function ensurePreparedRunnerContainerImageAlias(stdout: string): void {
  const expectedRef = readLatestPreparedRunnerContainerImageRef(stdout);
  if (!expectedRef) {
    return;
  }

  if (hasDockerImageRef(expectedRef)) {
    return;
  }

  const expectedIdPrefix = readLatestPreparedRunnerContainerImageIdPrefix(stdout);
  if (!expectedIdPrefix) {
    throw new Error(
      `Prepared runner container image ${expectedRef} is missing and no local image id was found in dev output.`,
    );
  }

  const existingRef = findPreparedRunnerContainerImageRefByIdPrefix(expectedIdPrefix);
  if (!existingRef) {
    throw new Error(
      `Prepared runner container image ${expectedRef} is missing and no local image matches id prefix ${expectedIdPrefix}.`,
    );
  }

  execFileSync("docker", ["tag", existingRef, expectedRef], {
    stdio: "pipe",
  });
}

function readLatestPreparedRunnerContainerImageRef(stdout: string): string | null {
  const matches = Array.from(
    stdout.matchAll(/naming to docker\.io\/(cloudflare-dev\/runnercontainer:[a-f0-9]+)\s+done/g),
  );
  return matches.at(-1)?.[1] ?? null;
}

function readLatestPreparedRunnerContainerImageIdPrefix(stdout: string): string | null {
  const matches = Array.from(stdout.matchAll(/exporting manifest sha256:([a-f0-9]{12,64})/g));
  const manifestHash = matches.at(-1)?.[1] ?? null;
  return manifestHash ? manifestHash.slice(0, 12) : null;
}

function hasDockerImageRef(imageRef: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", imageRef], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function findPreparedRunnerContainerImageRefByIdPrefix(expectedIdPrefix: string): string | null {
  const rawOutput = execFileSync(
    "docker",
    ["images", "--format", "{{.Repository}}:{{.Tag}} {{.ID}}"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const lines = rawOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [imageRef, imageId] = line.split(/\s+/, 2);
    if (!imageRef?.startsWith("cloudflare-dev/runnercontainer:")) {
      continue;
    }

    if (imageId?.startsWith(expectedIdPrefix)) {
      return imageRef;
    }
  }

  return null;
}
