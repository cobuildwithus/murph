import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildCloudflareHostedControlUserStatusPath } from "@murphai/cloudflare-hosted-control/routes";
import { parseHostedRunnerStatusResponse } from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import { repoRoot } from "../../vitest.shared.js";
import { resolveHostedLocalDevConfig } from "../../../../scripts/dev-hosted-local/config.ts";
import {
  startHostedLocalDevStack,
  type HostedLocalDevStack,
} from "../../../../scripts/dev-hosted-local/stack.ts";

const hostedLocalStatusTimeoutMs = 180_000;
const hostedLocalStatusPollIntervalMs = 250;
const hostedLocalNudgeTimeoutMs = 2_000;
const hostedLocalMailboxLagRecoveryNudgeAfterMs = 15_000;

export interface HostedLocalDevHarness {
  config: ReturnType<typeof resolveHostedLocalDevConfig>;
  oidcToken: string;
  persistDir: string;
  request(pathname: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(pathname: string, init?: RequestInit): Promise<T>;
  readUserStatus(userId: string): Promise<HostedRunnerStatusResponse>;
  nudgeUserBestEffort(userId: string): Promise<void>;
  runHostedAlarmForTest(userId: string): Promise<{ ok: true }>;
  startStuckInvocationForTest(userId: string, input?: {
    reason?: HostedWorkspaceInvocationReason;
  }): Promise<{
    attemptId: string;
    nextWakeAt: string | null;
    ok: true;
  }>;
  runtimeEnv: NodeJS.ProcessEnv;
  workerRuntimeEnv: NodeJS.ProcessEnv | null;
  stderrTail(maxChars?: number): string;
  stop(): Promise<void>;
  stdoutTail(maxChars?: number): string;
  waitForHostedCompletion(
    userId: string,
    input?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<HostedRunnerStatusResponse>;
  waitForHostedIdle(
    userId: string,
    input?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<HostedRunnerStatusResponse>;
  webBaseUrl: string;
  workerBaseUrl: string;
}

export async function startHostedLocalDevHarness(input: {
  env: NodeJS.ProcessEnv;
  persistDirOverride?: string | null;
  persistDirPrefix: string;
  resetPersistDir?: boolean;
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
  const nextDistDirSuffix = `e2e-${randomUUID()}`.toLowerCase();
  const nextEnvPath = path.join(repoRoot, "apps/web/next-env.d.ts");
  const originalNextEnvContents = await readFile(nextEnvPath, "utf8").catch(() => null);
  let nextDistDir: string | null = null;
  let stack: HostedLocalDevStack | null = null;

  const stop = async (): Promise<void> => {
    if (stack) {
      await stack.stop("SIGTERM");
    }

    stack = null;

    await restoreNextArtifacts().catch(() => {});

    if (createdTempPersistDir !== null) {
      await rm(createdTempPersistDir, { force: true, recursive: true });
      return;
    }
  };

  try {
    if (createdTempPersistDir === null && input.resetPersistDir !== false) {
      await rm(persistDir, { force: true, recursive: true });
      await mkdir(persistDir, { recursive: true });
    } else if (createdTempPersistDir === null) {
      await mkdir(persistDir, { recursive: true });
    }

    const resolvedNextDistDirSuffix = input.env.NEXT_DIST_DIR_SUFFIX?.trim() || nextDistDirSuffix;
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...input.env,
      MURPH_DEV_CF_PERSIST_DIR: persistDir,
      MURPH_HOSTED_WEB_DEV_OWNER_PID: String(process.pid),
      NEXT_DIST_DIR_SUFFIX: resolvedNextDistDirSuffix,
    };
    nextDistDir = resolveHostedLocalHarnessDistDir(
      runtimeEnv.NEXT_DIST_DIR_MODE,
      resolvedNextDistDirSuffix,
    );

    stack = await startHostedLocalDevStack({
      env: runtimeEnv,
      pipeOutput: streamLogs,
    });

    try {
      await stack.ready;
    } catch (error) {
      const stdout = stack.stdoutTail();
      const stderr = stack.stderrTail();
      await stop().catch(() => {});
      throw error instanceof Error
        ? error
        : new Error(formatFailure(
          [String(error)],
          stdout,
          stderr,
        ));
    }

    return {
      config: {
        ...config,
        workerPersistDir: persistDir,
      },
      oidcToken: stack.oidcToken,
      persistDir,
      readUserStatus: async (userId: string): Promise<HostedRunnerStatusResponse> => {
        return await readHostedUserStatus({
          requestJson: requestJsonForRuntime,
          statusHeaders,
          statusPath,
          userId,
        });
      },
      nudgeUserBestEffort: nudgeHostedUserBestEffort,
      request: requestForRuntime,
      requestJson: requestJsonForRuntime,
      runHostedAlarmForTest: async (userId: string): Promise<{ ok: true }> => {
        return await requestJsonForRuntime<{ ok: true }>(
          `/__test/users/${encodeURIComponent(userId)}/alarm`,
          {
            headers: statusHeaders(userId),
            method: "POST",
          },
        );
      },
      startStuckInvocationForTest: async (
        userId: string,
        stuckInput?: { reason?: HostedWorkspaceInvocationReason },
      ): Promise<{
        attemptId: string;
        nextWakeAt: string | null;
        ok: true;
      }> => {
        const searchParams = new URLSearchParams();
        if (stuckInput?.reason) {
          searchParams.set("reason", stuckInput.reason);
        }
        const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
        return await requestJsonForRuntime<{
          attemptId: string;
          nextWakeAt: string | null;
          ok: true;
        }>(
          `/__test/users/${encodeURIComponent(userId)}/stuck-invocation${suffix}`,
          {
            headers: statusHeaders(userId),
            method: "POST",
          },
        );
      },
      runtimeEnv: stack.runtimeEnv,
      workerRuntimeEnv: stack.workerRuntimeEnv,
      stop,
      stdoutTail: (maxChars?: number): string => stack?.stdoutTail(maxChars) ?? "",
      stderrTail: (maxChars?: number): string => stack?.stderrTail(maxChars) ?? "",
      waitForHostedCompletion: async (
        userId: string,
        pollInput: {
          pollIntervalMs?: number;
          timeoutMs?: number;
        } = {},
      ): Promise<HostedRunnerStatusResponse> => {
        const timeoutMs = pollInput.timeoutMs ?? hostedLocalStatusTimeoutMs;
        const pollIntervalMs = pollInput.pollIntervalMs ?? hostedLocalStatusPollIntervalMs;
        const startedAt = Date.now();
        let nextRecoveryNudgeAt = startedAt;
        let mailboxLagFirstObservedAt: number | null = null;
        let lastStatus: HostedRunnerStatusResponse | null = null;

        while ((Date.now() - startedAt) < timeoutMs) {
          const status = await readHostedUserStatus({
            requestJson: requestJsonForRuntime,
            statusHeaders,
            statusPath,
            userId,
          });
          lastStatus = status;

          if (hostedStatusHasCompletedWithError(status)) {
            throw new Error(formatFailure([
              `Hosted runner reported terminal error for ${userId}.`,
              `last status: ${JSON.stringify(status)}`,
            ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
          }

          if (
            !status.inFlight
            && status.mailboxLag.every((lane) => lane.lag === "0")
            && status.workspace !== null
            && !status.lastErrorCode
          ) {
            return status;
          }

          const now = Date.now();
          const hasMailboxLag = hostedStatusHasMailboxLag(status);
          mailboxLagFirstObservedAt = hasMailboxLag
            ? mailboxLagFirstObservedAt ?? now
            : null;
          if (
            now >= nextRecoveryNudgeAt
            && (
              hostedStatusHasRecoverableMailboxLag({
                firstObservedAt: mailboxLagFirstObservedAt,
                now,
                status,
              })
              || hostedStatusHasDueScheduledRecovery(status, now)
            )
          ) {
            nextRecoveryNudgeAt = now + 2_000;
            await nudgeHostedUserBestEffort(userId);
          }

          await sleep(pollIntervalMs);
        }

        throw new Error(formatFailure([
          `Timed out waiting for hosted completion for ${userId}.`,
          ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
        ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
      },
      waitForHostedIdle: async (
        userId: string,
        pollInput: {
          pollIntervalMs?: number;
          timeoutMs?: number;
        } = {},
      ): Promise<HostedRunnerStatusResponse> => {
        const timeoutMs = pollInput.timeoutMs ?? hostedLocalStatusTimeoutMs;
        const pollIntervalMs = pollInput.pollIntervalMs ?? hostedLocalStatusPollIntervalMs;
        const startedAt = Date.now();

        while ((Date.now() - startedAt) < timeoutMs) {
          const status = await readHostedUserStatus({
            requestJson: requestJsonForRuntime,
            statusHeaders,
            statusPath,
            userId,
          });

          if (!status.inFlight && status.mailboxLag.every((lane) => lane.lag === "0")) {
            return status;
          }

          await sleep(pollIntervalMs);
        }

        throw new Error(formatFailure([
          `Timed out waiting for hosted idle state for ${userId}.`,
        ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
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
        headers: buildAuthenticatedHeaders(stack?.oidcToken ?? "", init?.headers),
      });
    } catch (error) {
      throw new Error(formatFailure([
        `${init?.method ?? "GET"} ${pathname} failed before an HTTP response was received.`,
        error instanceof Error ? error.message : String(error),
      ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
    }

    if (!response.ok) {
      throw new Error(formatFailure([
        `${init?.method ?? "GET"} ${pathname} failed with HTTP ${response.status}.`,
        `body: ${await response.text()}`,
      ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
    }

    return response;
  }

  async function requestJsonForRuntime<T>(pathname: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(new URL(pathname, `${workerBaseUrl}/`), {
        ...init,
        headers: buildAuthenticatedHeaders(stack?.oidcToken ?? "", init?.headers),
      });
    } catch (error) {
      throw new Error(formatFailure([
        `${init?.method ?? "GET"} ${pathname} failed before an HTTP response was received.`,
        error instanceof Error ? error.message : String(error),
      ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
    }
    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(formatFailure([
        `${init?.method ?? "GET"} ${pathname} failed with HTTP ${response.status}.`,
        `body: ${rawBody}`,
      ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
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
      ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
    }
  }

  async function restoreNextArtifacts(): Promise<void> {
    const currentNextEnvContents = await readFile(nextEnvPath, "utf8").catch(() => null);

    if (originalNextEnvContents === null) {
      if (currentNextEnvContents !== null) {
        await rm(nextEnvPath, { force: true });
      }
    } else if (currentNextEnvContents !== originalNextEnvContents) {
      await writeFile(nextEnvPath, originalNextEnvContents, "utf8");
    }

    if (nextDistDir !== null) {
      await rm(path.join(repoRoot, "apps/web", nextDistDir), {
        force: true,
        recursive: true,
      });
    }
  }

  async function nudgeHostedUserBestEffort(userId: string): Promise<void> {
    await requestJsonForRuntime(`/internal/users/${encodeURIComponent(userId)}/nudge`, {
      body: "{}",
      headers: {
        ...statusHeaders(userId),
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal: AbortSignal.timeout(hostedLocalNudgeTimeoutMs),
    }).catch(() => {});
  }
}

function resolveLocalHarnessBaseHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function hostedStatusHasMailboxLag(status: HostedRunnerStatusResponse): boolean {
  return status.mailboxLag.some((lane) => {
    try {
      return BigInt(lane.lag) > 0n;
    } catch {
      return lane.lag !== "0";
    }
  });
}

function hostedStatusHasRecoverableMailboxLag(input: {
  firstObservedAt: number | null;
  now: number;
  status: HostedRunnerStatusResponse;
}): boolean {
  if (!hostedStatusHasMailboxLag(input.status)) {
    return false;
  }

  if (input.status.lastErrorCode) {
    return true;
  }

  if (input.firstObservedAt === null) {
    return false;
  }

  return input.now - input.firstObservedAt >= hostedLocalMailboxLagRecoveryNudgeAfterMs;
}

function hostedStatusHasCompletedWithError(status: HostedRunnerStatusResponse): boolean {
  return !status.inFlight
    && Boolean(status.lastErrorCode)
    && !hostedStatusHasMailboxLag(status)
    && !hostedStatusHasScheduledRecovery(status);
}

function hostedStatusHasScheduledRecovery(status: HostedRunnerStatusResponse): boolean {
  return typeof status.nextAlarmAt === "string" && status.nextAlarmAt.trim().length > 0;
}

function hostedStatusHasDueScheduledRecovery(
  status: HostedRunnerStatusResponse,
  nowMs: number,
): boolean {
  if (status.inFlight || !status.lastErrorCode || !hostedStatusHasScheduledRecovery(status)) {
    return false;
  }

  const nextAlarmAtMs = Date.parse(status.nextAlarmAt!);
  return Number.isFinite(nextAlarmAtMs) && nextAlarmAtMs <= nowMs;
}

function resolveHostedLocalHarnessDistDir(
  nextDistDirMode: string | undefined,
  nextDistDirSuffix: string,
): string {
  const baseDistDir = nextDistDirMode === "smoke" ? ".next-smoke" : ".next-dev";
  return `${baseDistDir}-${nextDistDirSuffix}`;
}

async function readHostedUserStatus(input: {
  requestJson: <T>(pathname: string, init?: RequestInit) => Promise<T>;
  statusHeaders: (userId: string) => HeadersInit;
  statusPath: (userId: string) => string;
  userId: string;
}): Promise<HostedRunnerStatusResponse> {
  const status = await input.requestJson<HostedRunnerStatusResponse>(input.statusPath(input.userId), {
    headers: input.statusHeaders(input.userId),
  });

  return parseHostedRunnerStatusResponse(status);
}

function buildAuthenticatedHeaders(
  oidcToken: string,
  headers?: HeadersInit,
): Headers {
  const normalized = new Headers(headers);
  normalized.set("authorization", `Bearer ${oidcToken}`);
  return normalized;
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
