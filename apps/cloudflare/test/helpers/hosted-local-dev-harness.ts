import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildCloudflareHostedControlRuntimeEnsureProcessingPath,
  buildCloudflareHostedControlUserStatusPath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  parseHostedRunnerStatusResponse,
  parseHostedRuntimeEnsureProcessingRequest,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";

import { repoRoot } from "../../vitest.shared.js";
import { resolveHostedLocalDevConfig } from "@murphai/hosted-local-harness/dev-hosted-local/config";
import {
  startHostedLocalDevStack,
  type HostedLocalDevStack,
} from "@murphai/hosted-local-harness/dev-hosted-local/stack";
import {
  createHostedWebCallbackSignatureHeaders,
  readHostedWebCallbackSigningEnvironment,
} from "../../src/web-callback-auth.ts";

const hostedLocalStatusTimeoutMs = 180_000;
const hostedLocalStatusRequestTimeoutMs = 10_000;
const hostedLocalStatusPollIntervalMs = 250;
const hostedLocalNudgeTimeoutMs = 2_000;
const hostedLocalActivityExpiryTimeoutMs = 15_000;
const hostedLocalCompletionRetryMs = 1_000;
const hostedLocalRunUntilIdleTimeoutMs = 30_000;
const hostedLocalMailboxLagRecoveryNudgeAfterMs = 15_000;

export interface HostedLocalDevHarness {
  config: ReturnType<typeof resolveHostedLocalDevConfig>;
  oidcToken: string;
  persistDir: string;
  request(pathname: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(pathname: string, init?: RequestInit): Promise<T>;
  readUserStatus(userId: string): Promise<HostedRunnerStatusResponse>;
  nudgeUserBestEffort(userId: string): Promise<void>;
  expireRunnerActivityForTest(userId: string): Promise<{ ok: true }>;
  runHostedAlarmInvocationForTest(userId: string): Promise<HostedWorkspaceInvocationResult>;
  runHostedManualInvocationForTest(userId: string): Promise<HostedWorkspaceInvocationResult>;
  runHostedAlarmForTest(userId: string): Promise<{ ok: true }>;
  startStuckInvocationForTest(userId: string, input?: {
    startedAgoMs?: number;
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
      expireRunnerActivityForTest,
      runHostedAlarmInvocationForTest,
      runHostedManualInvocationForTest,
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
        stuckInput?: {
          startedAgoMs?: number;
        },
      ): Promise<{
        attemptId: string;
        nextWakeAt: string | null;
        ok: true;
      }> => {
        const searchParams = new URLSearchParams();
        if (typeof stuckInput?.startedAgoMs === "number") {
          searchParams.set("startedAgoMs", String(stuckInput.startedAgoMs));
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
        let nextCompletionRetryAt = startedAt;
        let mailboxLagFirstObservedAt: number | null = null;
        let lastStatus: HostedRunnerStatusResponse | null = null;
        let lastStatusReadError: string | null = null;

        while ((Date.now() - startedAt) < timeoutMs) {
          let status: HostedRunnerStatusResponse;
          try {
            status = await readHostedUserStatus({
              requestJson: requestJsonForRuntime,
              statusHeaders,
              statusPath,
              userId,
            });
          } catch (error) {
            lastStatusReadError = error instanceof Error ? error.message : String(error);
            await sleep(pollIntervalMs);
            continue;
          }
          lastStatus = status;
          lastStatusReadError = null;

          if (hostedStatusHasCompletedWithError(status)) {
            throw new Error(formatFailure([
              `Hosted runner reported terminal error for ${userId}.`,
              `last status: ${JSON.stringify(sanitizeHostedStatusForFailureLog(status))}`,
            ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
          }

          const completedStatus = resolveHostedCompletionStatus(status);
          if (completedStatus) {
            return completedStatus;
          }

          const now = Date.now();
          const hasMailboxLag = hostedStatusHasMailboxLag(status);
          mailboxLagFirstObservedAt = hasMailboxLag
            ? mailboxLagFirstObservedAt ?? now
            : null;
          if (
            hasMailboxLag
            && !status.inFlight
            && !status.lastErrorCode
            && now >= nextCompletionRetryAt
            && hasLocalMailboxDrainEvidence(status)
          ) {
            nextCompletionRetryAt = now + hostedLocalCompletionRetryMs;
            await runHostedManualInvocationForTest(userId)
              .catch(() => expireRunnerActivityForTest(userId).catch(() => {}));
            await sleep(pollIntervalMs);
            continue;
          }
          if (
            now >= nextRecoveryNudgeAt
            && hostedStatusHasStaleMailboxLag({
              firstObservedAt: mailboxLagFirstObservedAt,
              now,
              status,
            })
          ) {
            nextRecoveryNudgeAt = now + 2_000;
            await nudgeHostedUserBestEffort(userId);
          }

          await sleep(pollIntervalMs);
        }

        throw new Error(formatFailure([
          `Timed out waiting for hosted completion for ${userId}.`,
          ...(lastStatus
            ? [`last status: ${JSON.stringify(sanitizeHostedStatusForFailureLog(lastStatus))}`]
            : []),
          ...(lastStatusReadError ? [`last status read error: ${lastStatusReadError}`] : []),
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
        let lastStatusReadError: string | null = null;

        while ((Date.now() - startedAt) < timeoutMs) {
          let status: HostedRunnerStatusResponse;
          try {
            status = await readHostedUserStatus({
              requestJson: requestJsonForRuntime,
              statusHeaders,
              statusPath,
              userId,
            });
          } catch (error) {
            lastStatusReadError = error instanceof Error ? error.message : String(error);
            await sleep(pollIntervalMs);
            continue;
          }
          lastStatusReadError = null;

          if (!status.inFlight && status.mailboxLag.every((lane) => lane.lag === "0")) {
            return status;
          }

          await sleep(pollIntervalMs);
        }

        throw new Error(formatFailure([
          `Timed out waiting for hosted idle state for ${userId}.`,
          ...(lastStatusReadError ? [`last status read error: ${lastStatusReadError}`] : []),
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
    const pathname = buildCloudflareHostedControlRuntimeEnsureProcessingPath(userId);
    const url = new URL(pathname, `${workerBaseUrl}/`);
    const requestBody = JSON.stringify(parseHostedRuntimeEnsureProcessingRequest({
      orchestrationAttemptId: `hosted-local-nudge:${userId}`,
    }));
    const headers = {
      [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      "content-type": "application/json; charset=utf-8",
      ...await createHostedWebCallbackSignatureHeaders({
        environment: readHostedWebCallbackSigningEnvironment(
          stack?.workerRuntimeEnv ?? stack?.runtimeEnv ?? input.env,
        ),
        method: "POST",
        path: url.pathname,
        payload: requestBody,
        search: url.search,
        userId,
      }),
    };

    await requestJsonForRuntime(pathname, {
      body: requestBody,
      headers,
      method: "POST",
      signal: AbortSignal.timeout(hostedLocalNudgeTimeoutMs),
    }).catch(() => {});
  }

  async function expireRunnerActivityForTest(userId: string): Promise<{ ok: true }> {
    return await requestJsonForRuntime<{ ok: true }>(
      `/__test/users/${encodeURIComponent(userId)}/container-activity-expired`,
      {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
          ...statusHeaders(userId),
        },
        method: "POST",
        signal: AbortSignal.timeout(hostedLocalActivityExpiryTimeoutMs),
      },
    );
  }

  async function runHostedManualInvocationForTest(
    userId: string,
  ): Promise<HostedWorkspaceInvocationResult> {
    return await runHostedWorkspaceInvocationForTest(userId);
  }

  async function runHostedAlarmInvocationForTest(
    userId: string,
  ): Promise<HostedWorkspaceInvocationResult> {
    return await runHostedWorkspaceInvocationForTest(userId);
  }

  async function runHostedWorkspaceInvocationForTest(
    userId: string,
  ): Promise<HostedWorkspaceInvocationResult> {
    return await requestJsonForRuntime<HostedWorkspaceInvocationResult>(
      `/__test/users/${encodeURIComponent(userId)}/run-until-idle`,
      {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
          ...statusHeaders(userId),
        },
        method: "POST",
        signal: AbortSignal.timeout(hostedLocalRunUntilIdleTimeoutMs),
      },
    );
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

function resolveHostedCompletionStatus(
  status: HostedRunnerStatusResponse,
): HostedRunnerStatusResponse | null {
  if (status.inFlight || status.lastErrorCode) {
    return null;
  }

  if (status.mailboxLag.every((lane) => lane.lag === "0")) {
    return status.workspace !== null ? status : null;
  }

  return null;
}

function hasLocalMailboxDrainEvidence(
  status: HostedRunnerStatusResponse,
): boolean {
  const importedLogs: Array<{
    index: number;
    lane: HostedRunnerStatusResponse["mailboxLag"][number]["lane"];
  }> = [];

  for (const lane of status.mailboxLag) {
    if (lane.lag === "0") {
      continue;
    }

    const imported = readRecentMailboxImportedSeq(status, lane.lane);
    if (!imported || compareMailboxSeq(imported.seq, lane.maxSeq) < 0) {
      return false;
    }
    importedLogs.push({
      index: imported.index,
      lane: lane.lane,
    });
  }

  return hasLocalCompletionAfterMailboxImports(status, importedLogs);
}

function readRecentMailboxImportedSeq(
  status: HostedRunnerStatusResponse,
  lane: HostedRunnerStatusResponse["mailboxLag"][number]["lane"],
): { index: number; seq: string } | null {
  const logs = status.recentLogs ?? [];
  for (const [index, log] of logs.entries()) {
    if (log.eventCode !== "mailbox.imported") {
      continue;
    }
    const value = lane === "system"
      ? log.redactedJson?.systemSeqEnd
      : log.redactedJson?.conversationSeqEnd;
    if (typeof value === "string" && value.trim().length > 0) {
      return { index, seq: value };
    }
  }

  return null;
}

function hasLocalCompletionAfterMailboxImports(
  status: HostedRunnerStatusResponse,
  imports: readonly {
    index: number;
    lane: HostedRunnerStatusResponse["mailboxLag"][number]["lane"];
  }[],
): boolean {
  if (imports.length === 0) {
    return true;
  }

  const logs = status.recentLogs ?? [];
  return imports.every((imported) => logs.some((log, logIndex) => {
    if (imported.lane === "system") {
      return logIndex === imported.index
        || (
          logIndex < imported.index &&
          log.eventCode === "mailbox.system_processed"
          && (
            log.redactedJson?.status === "processed"
            || log.redactedJson?.status === "recorded"
          )
        );
    }

    if (logIndex >= imported.index) {
      return false;
    }

    return log.eventCode === "assistant.pass_finished";
  }));
}

function compareMailboxSeq(left: string, right: string): number {
  try {
    const leftSeq = BigInt(left);
    const rightSeq = BigInt(right);
    return leftSeq === rightSeq ? 0 : leftSeq > rightSeq ? 1 : -1;
  } catch {
    return left.localeCompare(right);
  }
}

function hostedStatusHasStaleMailboxLag(input: {
  firstObservedAt: number | null;
  now: number;
  status: HostedRunnerStatusResponse;
}): boolean {
  if (!hostedStatusHasMailboxLag(input.status)) {
    return false;
  }

  if (input.status.lastErrorCode) {
    return false;
  }

  if (input.firstObservedAt === null) {
    return false;
  }

  return input.now - input.firstObservedAt >= hostedLocalMailboxLagRecoveryNudgeAfterMs;
}

function hostedStatusHasCompletedWithError(status: HostedRunnerStatusResponse): boolean {
  return !status.inFlight
    && Boolean(status.lastErrorCode);
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
    signal: AbortSignal.timeout(hostedLocalStatusRequestTimeoutMs),
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

export function sanitizeHostedStatusForFailureLog(status: HostedRunnerStatusResponse): unknown {
  return sanitizeHostedFailureValue(status);
}

export function sanitizeHostedFailureText(value: string): string {
  return value
    .replace(
      /"recentLogs"\s*:\s*\[[\s\S]*?\](?=\s*[,}])/giu,
      "\"recentLogsPresent\":true",
    )
    .replace(
      /"((?:snapshotRef|browserVaultReplicaRef|dataKeyEnvelope|keyEnvelope|cipherEnvelope))"\s*:\s*\{[\s\S]*?\}(?=\s*[,}])/giu,
      (_, key: string) => `"${key}Present":true`,
    )
    .replace(
      /"((?:snapshotRef|browserVaultReplicaRef|recentLogs|objectKey|keyId|rootKeyId|runtimeRootKeyId|dataKeyId|keyEnvelope|wrappedKey|webhookDataJson|cipherEnvelope))"\s*:\s*"(?:(?:\\.)|[^"\\])*"/giu,
      (_, key: string) => `"${key}":"<redacted-hosted-ref>"`,
    )
    .replace(
      /\b(snapshotRef|browserVaultReplicaRef|recentLogs|objectKey|keyId|rootKeyId|runtimeRootKeyId|dataKeyId|keyEnvelope|wrappedKey|webhookDataJson|cipherEnvelope)=\S+/giu,
      (_, key: string) => `${key}=<redacted-hosted-ref>`,
    );
}

function sanitizeHostedFailureValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHostedFailureValue(item));
  }

  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeHostedFailureText(value) : value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (shouldOmitHostedFailureStatusKey(key)) {
      if (child !== null && child !== undefined) {
        sanitized[`${key}Present`] = true;
      }
      continue;
    }

    sanitized[key] = sanitizeHostedFailureValue(child);
  }

  return sanitized;
}

function shouldOmitHostedFailureStatusKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return normalized === "recentlogs"
    || normalized === "snapshotref"
    || normalized === "browservaultreplicaref"
    || normalized.endsWith("objectkey")
    || normalized.endsWith("keyenvelope")
    || normalized.endsWith("wrappedkey")
    || normalized.endsWith("keyjwk")
    || normalized.endsWith("keyid")
    || normalized.endsWith("rootkeyid")
    || normalized.endsWith("datakeyid")
    || normalized.includes("cipherenvelope")
    || normalized.includes("webhookdatajson");
}

function formatFailure(lines: string[], stdout: string, stderr: string): string {
  return [
    ...lines.map(sanitizeHostedFailureText),
    `stdout tail: ${sanitizeHostedFailureText(tail(stdout))}`,
    `stderr tail: ${sanitizeHostedFailureText(tail(stderr))}`,
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
