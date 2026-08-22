import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildCloudflareHostedControlUserStatusPath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  parseHostedRunnerStatusResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";

import type {
  HostedLocalForegroundPriorityOrderingObservationState,
} from "../../src/hosted-local-test/foreground-priority-ordering.ts";

import { repoRoot } from "../../vitest.shared.js";
import { resolveHostedLocalDevConfig } from "@murphai/hosted-local-harness/dev-hosted-local/config";
import {
  startHostedLocalDevStack,
  type HostedLocalDevStack,
} from "@murphai/hosted-local-harness/dev-hosted-local/stack";
import {
  resolveHostedWebDevDistDirName,
  shouldUseHostedWebProductionStart,
} from "@murphai/hosted-local-harness/dev-hosted-local/web-production-start";
const hostedLocalStatusTimeoutMs = 180_000;
const hostedLocalStatusRequestTimeoutMs = 10_000;
const hostedLocalStatusPollIntervalMs = 250;
const hostedLocalActivityExpiryTimeoutMs = 15_000;
const hostedLocalShutdownCheckpointControlTimeoutMs = 120_000;
const hostedLocalRunUntilIdleTimeoutMs = 30_000;

export interface HostedLocalDevHarness {
  ageActiveRuntimeFenceForTest(
    userId: string,
    startedAgoMs: number,
  ): Promise<{ attemptId: string; ok: true; startedAt: string }>;
  assertNoInterventions(): void;
  assertStripeListenerAlive(): void;
  config: ReturnType<typeof resolveHostedLocalDevConfig>;
  /** The app-session HMAC key the web process runs with. */
  hostedAppSessionHmacKey: string;
  interventionCount: number;
  oidcToken: string;
  persistDir: string;
  request(pathname: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(pathname: string, init?: RequestInit): Promise<T>;
  readUserStatus(userId: string): Promise<HostedRunnerStatusResponse>;
  armCanonicalCheckpointLostAckForTest(userId: string): Promise<{ ok: true }>;
  armTemporalMailboxSignalFaultForTest(
    userId: string,
    mailboxItemId: string,
  ): Promise<{
    armed: true;
    deliveredToPendingConsumer: boolean;
  }>;
  clearTemporalMailboxSignalFaultForTest(userId: string): Promise<{
    cleared: boolean;
    ok: true;
  }>;
  armForegroundPriorityOrderingObservationForTest(
    userId: string,
    barrierTarget:
      | "canonical_post_commit"
      | "empty_conversation_probe",
  ): Promise<{ ok: true }>;
  clearForegroundPriorityOrderingObservationForTest(
    userId: string,
  ): Promise<{ cleared: boolean; ok: true }>;
  armSnapshotPublicationCorruptionForTest(userId: string): Promise<{ ok: true }>;
  armIdleSnapshotStartBarrierForTest(userId: string): Promise<{ ok: true }>;
  armShutdownCheckpointPublicationBarrierForTest(userId: string): Promise<{ ok: true }>;
  beginShutdownCheckpointGracefulStopForTest(userId: string): Promise<{ ok: true }>;
  expireRunnerActivityForTest(userId: string): Promise<{ ok: true }>;
  dropRunnerActiveOperationForTest(userId: string, input?: {
    loseCompletedInvocationResult?: boolean;
  }): Promise<{ ok: true }>;
  readForegroundPriorityOrderingObservationForTest(
    userId: string,
  ): Promise<HostedLocalForegroundPriorityOrderingObservationState>;
  recordForegroundPriorityAssistantProviderStartForTest(
    userId: string,
  ): Promise<{ ok: true }>;
  readShutdownCheckpointPublicationBarrierForTest(
    userId: string,
  ): Promise<{ state: "armed" | "entered" | "unarmed" }>;
  releaseShutdownCheckpointPublicationBarrierForTest(
    userId: string,
  ): Promise<{ ok: true; released: boolean }>;
  runHostedAlarmInvocationForTest(userId: string): Promise<HostedWorkspaceInvocationResult>;
  runHostedManualInvocationForTest(userId: string): Promise<HostedWorkspaceInvocationResult>;
  runHostedAlarmForTest(userId: string): Promise<{ ok: true }>;
  startStuckInvocationForTest(userId: string, input?: {
    sameWorkerVersion?: boolean;
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
  testControls: boolean;
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
  waitForHostedProgress(
    userId: string,
    input?: {
      afterStatus?: HostedRunnerStatusResponse;
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<HostedRunnerStatusResponse>;
  armGeneratedImageProviderBarrierForTest(userId: string): Promise<{ ok: true }>;
  releaseForegroundPriorityOrderingBarrierForTest(
    userId: string,
  ): Promise<{ ok: true; released: boolean }>;
  releaseGeneratedImageProviderBarrierForTest(userId: string): Promise<{ ok: true }>;
  /** True only when this harness selected an existing production Web artifact. */
  webUsesProductionArtifact: boolean;
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
  testControls?: boolean;
  webProcessEnvOverrides?: NodeJS.ProcessEnv;
  webTemporalMailboxSignalFaultUserId?: string;
}): Promise<HostedLocalDevHarness> {
  const config = resolveHostedLocalDevConfig(input.env);
  const workerBaseUrl =
    `${config.workerProtocol}://${resolveLocalHarnessBaseHost(config.workerHost)}:${config.workerPort}`;
  const webBaseUrl = `http://${resolveLocalHarnessBaseHost(config.webHost)}:${config.webPort}`;
  const statusPath = input.statusPath ?? ((userId: string) => buildCloudflareHostedControlUserStatusPath(userId));
  const statusHeaders = input.statusHeaders ?? (() => ({}));
  const streamLogs = input.streamLogs === true;
  const testControls = input.testControls === true;
  const persistDirOverride = input.persistDirOverride?.trim() || null;
  const createdTempPersistDir = persistDirOverride === null
    ? await mkdtemp(path.join(os.tmpdir(), input.persistDirPrefix))
    : null;
  const persistDir = createdTempPersistDir
    ?? path.resolve(repoRoot, persistDirOverride ?? "");
  const nextDistDirSuffix = `e2e-${randomUUID()}`.toLowerCase();
  const nextEnvPath = path.join(repoRoot, "apps/web/next-env.d.ts");
  const originalNextEnvContents = await readFile(nextEnvPath, "utf8").catch(() => null);
  let harnessRuntimeEnv: NodeJS.ProcessEnv | null = null;
  let interventionCount = 0;
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
    harnessRuntimeEnv = runtimeEnv;
    nextDistDir = resolveHostedWebDevDistDirName(runtimeEnv);
    const webUsesProductionArtifact = await shouldUseHostedWebProductionStart({
      env: runtimeEnv,
    });

    stack = await startHostedLocalDevStack({
      env: runtimeEnv,
      pipeOutput: streamLogs,
      ...(input.webProcessEnvOverrides
        ? { webProcessEnvOverrides: input.webProcessEnvOverrides }
        : {}),
      ...(input.webTemporalMailboxSignalFaultUserId === undefined
        ? {}
        : {
          webTemporalMailboxSignalFaultUserId:
            input.webTemporalMailboxSignalFaultUserId,
        }),
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
      ageActiveRuntimeFenceForTest: async (
        userId: string,
        startedAgoMs: number,
      ): Promise<{ attemptId: string; ok: true; startedAt: string }> => {
        assertHostedLocalTestControlsAvailable("ageActiveRuntimeFenceForTest");
        return await requestJsonForRuntime<{
          attemptId: string;
          ok: true;
          startedAt: string;
        }>(
          `/__test/users/${encodeURIComponent(userId)}`
            + `/active-runtime-fence/age?startedAgoMs=${encodeURIComponent(String(startedAgoMs))}`,
          {
            headers: statusHeaders(userId),
            method: "POST",
          },
        );
      },
      assertNoInterventions: (): void => {
        if (interventionCount === 0) {
          return;
        }
        throw new Error(
          `Expected a passive hosted-local scenario, but the harness issued ${interventionCount} mutating intervention request(s). Deliberate recovery controls require faultInjection: true.`,
        );
      },
      assertStripeListenerAlive: (): void => {
        const stripeListener = stack?.processes.stripe;
        if (!stripeListener || stripeListener.child.exitCode !== null) {
          throw new Error(
            "The hosted-local scenario requires its owned stripe listen process to remain alive.",
          );
        }
      },
      config: {
        ...config,
        workerPersistDir: persistDir,
      },
      hostedAppSessionHmacKey: stack.hostedAppSessionHmacKey,
      oidcToken: stack.oidcToken,
      get interventionCount(): number {
        return interventionCount;
      },
      persistDir,
      readUserStatus: async (userId: string): Promise<HostedRunnerStatusResponse> => {
        return await readHostedUserStatus({
          requestJson: requestJsonForRuntime,
          statusHeaders,
          statusPath,
          userId,
        });
      },
      armGeneratedImageProviderBarrierForTest,
      armCanonicalCheckpointLostAckForTest,
      armTemporalMailboxSignalFaultForTest,
      armForegroundPriorityOrderingObservationForTest,
      clearForegroundPriorityOrderingObservationForTest,
      clearTemporalMailboxSignalFaultForTest,
      armSnapshotPublicationCorruptionForTest,
      armIdleSnapshotStartBarrierForTest,
      armShutdownCheckpointPublicationBarrierForTest,
      beginShutdownCheckpointGracefulStopForTest,
      dropRunnerActiveOperationForTest,
      expireRunnerActivityForTest,
      readForegroundPriorityOrderingObservationForTest,
      recordForegroundPriorityAssistantProviderStartForTest,
      readShutdownCheckpointPublicationBarrierForTest,
      releaseForegroundPriorityOrderingBarrierForTest,
      releaseGeneratedImageProviderBarrierForTest,
      releaseShutdownCheckpointPublicationBarrierForTest,
      runHostedAlarmInvocationForTest: requireTestControls(runHostedAlarmInvocationForTest),
      runHostedManualInvocationForTest: requireTestControls(runHostedManualInvocationForTest),
      request: requestForRuntime,
      requestJson: requestJsonForRuntime,
      runHostedAlarmForTest: async (userId: string): Promise<{ ok: true }> => {
        assertHostedLocalTestControlsAvailable("runHostedAlarmForTest");
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
          sameWorkerVersion?: boolean;
          startedAgoMs?: number;
        },
      ): Promise<{
        attemptId: string;
        nextWakeAt: string | null;
        ok: true;
      }> => {
        assertHostedLocalTestControlsAvailable("startStuckInvocationForTest");
        const searchParams = new URLSearchParams();
        if (typeof stuckInput?.startedAgoMs === "number") {
          searchParams.set("startedAgoMs", String(stuckInput.startedAgoMs));
        }
        if (stuckInput?.sameWorkerVersion === true) {
          searchParams.set("sameWorkerVersion", "1");
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
      testControls,
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
      waitForHostedProgress: async (
        userId: string,
        pollInput: {
          afterStatus?: HostedRunnerStatusResponse;
          pollIntervalMs?: number;
          timeoutMs?: number;
        } = {},
      ): Promise<HostedRunnerStatusResponse> => {
        const timeoutMs = pollInput.timeoutMs ?? hostedLocalStatusTimeoutMs;
        const pollIntervalMs = pollInput.pollIntervalMs ?? hostedLocalStatusPollIntervalMs;
        const startedAt = Date.now();
        let baselineStatus = pollInput.afterStatus;
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

          if (baselineStatus === undefined) {
            if (hostedStatusHasObservableWork(status)) {
              return status;
            }
            baselineStatus = status;
          } else if (hostedStatusHasProgressedSince(status, baselineStatus)) {
            return status;
          }

          await sleep(pollIntervalMs);
        }

        throw new Error(formatFailure([
          `Timed out waiting for hosted production-path progress for ${userId}.`,
          ...(lastStatus
            ? [`last status: ${JSON.stringify(sanitizeHostedStatusForFailureLog(lastStatus))}`]
            : []),
          ...(lastStatusReadError ? [`last status read error: ${lastStatusReadError}`] : []),
        ], stack?.stdoutTail() ?? "", stack?.stderrTail() ?? ""));
      },
      webUsesProductionArtifact,
      webBaseUrl,
      workerBaseUrl,
    };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }

  async function requestForRuntime(pathname: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    interventionCount += countHostedLocalInterventionRequest(pathname, init?.method);

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
    interventionCount += countHostedLocalInterventionRequest(pathname, init?.method);

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

    const nextDistPath = nextDistDir === null
      ? null
      : path.join(repoRoot, "apps/web", nextDistDir);
    if (
      nextDistPath !== null
      && !await shouldUseHostedWebProductionStart({
        distDir: nextDistPath,
        env: harnessRuntimeEnv ?? input.env,
      })
    ) {
      await rm(nextDistPath, {
        force: true,
        recursive: true,
      });
    }
  }

  async function expireRunnerActivityForTest(userId: string): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("expireRunnerActivityForTest");
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

  async function armCanonicalCheckpointLostAckForTest(
    userId: string,
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("armCanonicalCheckpointLostAckForTest");
    return await requestJsonForRuntime<{ ok: true }>(
      `/__test/users/${encodeURIComponent(userId)}/canonical-checkpoint-lost-ack`,
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

  async function armTemporalMailboxSignalFaultForTest(
    userId: string,
    mailboxItemId: string,
  ): Promise<{
    armed: true;
    deliveredToPendingConsumer: boolean;
  }> {
    assertHostedLocalTestControlsAvailable(
      "armTemporalMailboxSignalFaultForTest",
    );
    return await requestJsonForRuntime<{
      armed: true;
      deliveredToPendingConsumer: boolean;
    }>(
      `/__test/users/${encodeURIComponent(userId)}`
        + "/temporal-mailbox-signal-fault/arm",
      {
        body: JSON.stringify({ mailboxItemId }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
          ...statusHeaders(userId),
        },
        method: "POST",
        signal: AbortSignal.timeout(hostedLocalActivityExpiryTimeoutMs),
      },
    );
  }

  async function clearTemporalMailboxSignalFaultForTest(
    userId: string,
  ): Promise<{
    cleared: boolean;
    ok: true;
  }> {
    assertHostedLocalTestControlsAvailable(
      "clearTemporalMailboxSignalFaultForTest",
    );
    return await requestJsonForRuntime<{
      cleared: boolean;
      ok: true;
    }>(
      `/__test/users/${encodeURIComponent(userId)}`
        + "/temporal-mailbox-signal-fault/clear",
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

  async function armForegroundPriorityOrderingObservationForTest(
    userId: string,
    barrierTarget:
      | "canonical_post_commit"
      | "empty_conversation_probe",
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable(
      "armForegroundPriorityOrderingObservationForTest",
    );
    const action = barrierTarget === "canonical_post_commit"
      ? "arm-canonical"
      : "arm-empty-probe";
    return await requestForegroundPriorityOrderingControlForTest(
      userId,
      action,
    );
  }

  async function readForegroundPriorityOrderingObservationForTest(
    userId: string,
  ): Promise<HostedLocalForegroundPriorityOrderingObservationState> {
    assertHostedLocalTestControlsAvailable(
      "readForegroundPriorityOrderingObservationForTest",
    );
    return await requestForegroundPriorityOrderingControlForTest(
      userId,
      "status",
    );
  }

  async function releaseForegroundPriorityOrderingBarrierForTest(
    userId: string,
  ): Promise<{ ok: true; released: boolean }> {
    assertHostedLocalTestControlsAvailable(
      "releaseForegroundPriorityOrderingBarrierForTest",
    );
    return await requestForegroundPriorityOrderingControlForTest(
      userId,
      "release",
    );
  }

  async function recordForegroundPriorityAssistantProviderStartForTest(
    userId: string,
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable(
      "recordForegroundPriorityAssistantProviderStartForTest",
    );
    return await requestForegroundPriorityOrderingControlForTest(
      userId,
      "provider-start",
    );
  }

  async function clearForegroundPriorityOrderingObservationForTest(
    userId: string,
  ): Promise<{ cleared: boolean; ok: true }> {
    assertHostedLocalTestControlsAvailable(
      "clearForegroundPriorityOrderingObservationForTest",
    );
    return await requestForegroundPriorityOrderingControlForTest(
      userId,
      "clear",
    );
  }

  async function requestForegroundPriorityOrderingControlForTest<T>(
    userId: string,
    action:
      | "arm-canonical"
      | "arm-empty-probe"
      | "clear"
      | "provider-start"
      | "release"
      | "status",
  ): Promise<T> {
    return await requestJsonForRuntime<T>(
      `/__test/users/${encodeURIComponent(userId)}`
        + `/foreground-priority-ordering?action=${action}`,
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

  async function armGeneratedImageProviderBarrierForTest(
    userId: string,
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("armGeneratedImageProviderBarrierForTest");
    return await requestJsonForRuntime<{ ok: true }>(
      `/__test/users/${encodeURIComponent(userId)}/generated-image-provider-barrier/arm`,
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

  async function releaseGeneratedImageProviderBarrierForTest(
    userId: string,
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("releaseGeneratedImageProviderBarrierForTest");
    return await requestJsonForRuntime<{ ok: true }>(
      `/__test/users/${encodeURIComponent(userId)}/generated-image-provider-barrier/release`,
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

  async function armSnapshotPublicationCorruptionForTest(
    userId: string,
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("armSnapshotPublicationCorruptionForTest");
    return await requestJsonForRuntime<{ ok: true }>(
      `/__test/users/${encodeURIComponent(userId)}/snapshot-publication-corruption`,
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

  async function armShutdownCheckpointPublicationBarrierForTest(
    userId: string,
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("armShutdownCheckpointPublicationBarrierForTest");
    return await requestShutdownCheckpointPublicationBarrierForTest<{ ok: true }>(
      userId,
      "arm",
    );
  }

  async function armIdleSnapshotStartBarrierForTest(
    userId: string,
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("armIdleSnapshotStartBarrierForTest");
    return await requestShutdownCheckpointPublicationBarrierForTest<{ ok: true }>(
      userId,
      "arm-snapshot-start",
    );
  }

  async function beginShutdownCheckpointGracefulStopForTest(
    userId: string,
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("beginShutdownCheckpointGracefulStopForTest");
    return await requestShutdownCheckpointPublicationBarrierForTest<{ ok: true }>(
      userId,
      "shutdown",
    );
  }

  async function readShutdownCheckpointPublicationBarrierForTest(
    userId: string,
  ): Promise<{ state: "armed" | "entered" | "unarmed" }> {
    assertHostedLocalTestControlsAvailable("readShutdownCheckpointPublicationBarrierForTest");
    return await requestShutdownCheckpointPublicationBarrierForTest<{
      state: "armed" | "entered" | "unarmed";
    }>(userId, "status");
  }

  async function releaseShutdownCheckpointPublicationBarrierForTest(
    userId: string,
  ): Promise<{ ok: true; released: boolean }> {
    assertHostedLocalTestControlsAvailable("releaseShutdownCheckpointPublicationBarrierForTest");
    return await requestShutdownCheckpointPublicationBarrierForTest<{
      ok: true;
      released: boolean;
    }>(userId, "release");
  }

  async function requestShutdownCheckpointPublicationBarrierForTest<T>(
    userId: string,
    action: "arm" | "arm-snapshot-start" | "release" | "shutdown" | "status",
  ): Promise<T> {
    return await requestJsonForRuntime<T>(
      `/__test/users/${encodeURIComponent(userId)}`
        + `/shutdown-checkpoint-publication-barrier?action=${action}`,
      {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
          ...statusHeaders(userId),
        },
        method: "POST",
        signal: AbortSignal.timeout(hostedLocalShutdownCheckpointControlTimeoutMs),
      },
    );
  }

  async function dropRunnerActiveOperationForTest(
    userId: string,
    input: { loseCompletedInvocationResult?: boolean } = {},
  ): Promise<{ ok: true }> {
    assertHostedLocalTestControlsAvailable("dropRunnerActiveOperationForTest");
    return await requestJsonForRuntime<{ ok: true }>(
      `/__test/users/${encodeURIComponent(userId)}/container-active-operation-drop`
        + (input.loseCompletedInvocationResult === true
          ? "?loseCompletedInvocationResult=1"
          : ""),
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

  function requireTestControls<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      assertHostedLocalTestControlsAvailable(fn.name || "test control");
      return await fn(...args);
    };
  }

  function assertHostedLocalTestControlsAvailable(controlName: string): void {
    if (testControls) {
      return;
    }
    throw new Error(`${controlName} requires hosted-local test controls. Mark the scenario with testControls: true instead of enabling the test Worker entrypoint globally.`);
  }
}

function resolveLocalHarnessBaseHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function resolveHostedCompletionStatus(
  status: HostedRunnerStatusResponse,
): HostedRunnerStatusResponse | null {
  if (status.inFlight || status.lastErrorCode) {
    return null;
  }

  if (hostedStatusHasDueWorkspaceWake(status)) {
    return null;
  }

  if (status.mailboxLag.every((lane) => lane.lag === "0")) {
    return status.workspace !== null ? status : null;
  }

  return null;
}

function hostedStatusHasDueWorkspaceWake(
  status: HostedRunnerStatusResponse,
  now = Date.now(),
): boolean {
  const rawNextWakeAt = status.workspace?.nextWakeAt ?? null;
  if (rawNextWakeAt === null) {
    return false;
  }

  const nextWakeAt = Date.parse(rawNextWakeAt);
  return Number.isFinite(nextWakeAt) && nextWakeAt <= now;
}

function hostedStatusHasObservableWork(status: HostedRunnerStatusResponse): boolean {
  return status.inFlight
    || status.mailboxLag.some((lane) => lane.lag !== "0")
    || hostedStatusHasDueWorkspaceWake(status);
}

function hostedStatusHasProgressedSince(
  status: HostedRunnerStatusResponse,
  baseline: HostedRunnerStatusResponse,
): boolean {
  if (status.inFlight !== baseline.inFlight) {
    return true;
  }
  if (status.lastInvocationAt !== baseline.lastInvocationAt) {
    return true;
  }
  if (status.lastErrorCode !== baseline.lastErrorCode) {
    return true;
  }

  const statusWorkspace = status.workspace;
  const baselineWorkspace = baseline.workspace;
  if ((statusWorkspace === null) !== (baselineWorkspace === null)) {
    return true;
  }
  if (
    statusWorkspace !== null
    && baselineWorkspace !== null
    && (
      statusWorkspace.version !== baselineWorkspace.version
      || statusWorkspace.updatedAt !== baselineWorkspace.updatedAt
      || statusWorkspace.checkpointedAt !== baselineWorkspace.checkpointedAt
      || statusWorkspace.nextWakeAt !== baselineWorkspace.nextWakeAt
      || statusWorkspace.nextWakeReason !== baselineWorkspace.nextWakeReason
    )
  ) {
    return true;
  }

  if (status.mailboxLag.length !== baseline.mailboxLag.length) {
    return true;
  }
  return status.mailboxLag.some((lane, index) => {
    const baselineLane = baseline.mailboxLag[index];
    return baselineLane === undefined
      || lane.lane !== baselineLane.lane
      || lane.importedSeq !== baselineLane.importedSeq
      || lane.maxSeq !== baselineLane.maxSeq
      || lane.lag !== baselineLane.lag;
  });
}

function countHostedLocalInterventionRequest(
  pathname: string,
  method: string | undefined,
): number {
  const normalizedMethod = (method ?? "GET").toUpperCase();
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD") {
    return 0;
  }

  const normalizedPathname = new URL(pathname, "https://hosted-local.invalid").pathname;
  return normalizedPathname.startsWith("/__test/users/")
    || normalizedPathname.endsWith("/runtime/ensure-processing")
    ? 1
    : 0;
}

function hostedStatusHasCompletedWithError(status: HostedRunnerStatusResponse): boolean {
  return !status.inFlight
    && Boolean(status.lastErrorCode);
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
