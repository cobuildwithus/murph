import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRunnerStatusResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  createIntegratedVaultServices,
} from "@murphai/vault-usecases/vault-services";

import {
  buildAssistantProviderShellCommandCall,
} from "./helpers/hosted-local-e2e-support.js";
import {
  buildHostedLocalRuntimeLogDatabaseNameForTest,
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";
import {
  DEFAULT_DATABASE_URL,
} from "@murphai/hosted-local-harness/dev-hosted-local/constants";

const linqWebhookSecret = "linq-local-active-turn-latency-secret";
const execFileAsync = promisify(execFile);
const runId = Date.now();
const codexTurnDelayMs = readPositiveIntegerEnv(
  "MURPH_E2E_ACTIVE_TURN_LATENCY_CODEX_DELAY_MS",
  15_000,
);
const lateInputDelayAfterWakeMs = readPositiveIntegerEnv(
  "MURPH_E2E_ACTIVE_TURN_LATENCY_LATE_INPUT_DELAY_MS",
  10_000,
);
const productionLikeAssistantModel = "gpt-5.6-terra";
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const idleShutdownDelayProbeIdleDelayMs = 180_000;
const projectedWakeNoSnapshotObservationMs = 5_000;
const slowPostDeliveryMaintenanceMs = 20_000;

let scenario: HostedLocalFullStackScenario | null = null;
let linqStub: HostedLocalLinqStub | null = null;
const cleanupPaths: string[] = [];

afterEach(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
}, 120_000);

describe("hosted local active-turn latency e2e", () => {
  it("folds same-chat late input into the default hosted queue-only active turn", async () => {
    const database = await createSharedProbeDatabase();

    try {
      const result = await runActiveTurnLatencyProbe({
        localDatabaseUrl: database.url,
      });

      process.stdout.write(
        `${[
          "Hosted active-turn latency probe:",
          `latency=${Math.round(result.webhookToFirstReplyMs)}ms`,
          `lateInputHandled=${String(result.lateInputHandled)}`,
          `providerRequests=${result.providerRequestCount}`,
        ].join(" ")}\n`,
      );

      expect(result.lateInputHandled).toBe(true);
      expect(result.outboundReplyCount).toBe(1);
      expect(result.webhookToFirstReplyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await database.cleanup();
    }
  }, 900_000);

  it("replies to a second message while prior post-delivery maintenance is slow", async () => {
    const database = await createSharedProbeDatabase();

    try {
      const result = await runPostDeliveryMaintenancePreemptionProbe({
        localDatabaseUrl: database.url,
      });

      process.stdout.write(
        `${[
          "Hosted post-delivery maintenance preemption probe:",
          `secondReplyLatency=${Math.round(result.secondReplyLatencyMs)}ms`,
          `slowMaintenance=${slowPostDeliveryMaintenanceMs}ms`,
        ].join(" ")}\n`,
      );

      expect(result.secondReplyLatencyMs).toBeLessThan(slowPostDeliveryMaintenanceMs);
      expect(result.secondReplyObserved).toBe(true);
    } finally {
      await database.cleanup();
    }
  }, 900_000);

  it("does not run the full idle-shutdown snapshot immediately for projected wakes under the 180s idle delay", async () => {
    const database = await createSharedProbeDatabase();

    try {
      const proof = await runIdleShutdownDelayProbe({
        localDatabaseUrl: database.url,
      });

      process.stdout.write(
        `${[
          "Hosted idle-shutdown delay probe:",
          `providerCleanupDeleteObserved=${String(proof.providerCleanupDeleteObserved)}`,
          `providerCleanupObservationMs=${Math.round(proof.providerCleanupObservationMs)}`,
          `idleShutdownSnapshots=${proof.idleShutdownSnapshotCount}`,
          `snapshotObservationMs=${Math.round(proof.snapshotObservationMs)}`,
          `workspaceCheckpointChanged=${String(proof.workspaceCheckpointChanged)}`,
          `checkpointedAtChanged=${String(proof.workspaceCheckpointedAtChanged)}`,
          `snapshotRefChanged=${String(proof.workspaceSnapshotRefChanged)}`,
          `workspaceVersionChanged=${String(proof.workspaceVersionChanged)}`,
        ].join(" ")}\n`,
      );

      expect(proof.providerCleanupDeleteObserved).toBe(true);
      expect(proof.idleShutdownSnapshotCount).toBe(0);
      // Canonical receipt commits may advance status-only workspace metadata;
      // the idle-floor invariant is that they retain the existing snapshot.
      expect(proof.workspaceSnapshotRefChanged).toBe(false);
    } finally {
      await database.cleanup();
    }
  }, 900_000);
});

async function runActiveTurnLatencyProbe(input: {
  localDatabaseUrl: string;
}): Promise<{
  lateInputHandled: boolean;
  outboundReplyCount: number;
  providerRequestCount: number;
  webhookToFirstReplyMs: number;
}> {
  const userId = `member_local_active_turn_latency_${runId}`;
  const chatId = `chat_local_active_turn_latency_${runId}`;
  const memberPhone = buildLinqRecipientPhoneNumber(userId);
  const homePhone = buildLinqHomePhoneNumber(userId);
  const firstText = "active turn latency first input";
  const lateText = "active turn latency late input";
  const replyText = "Active turn latency reply.";
  const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;

  await startProbeScenario({
    localDatabaseUrl: input.localDatabaseUrl,
    memberPhone,
  });

  try {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    const baselineProviderRequestCount = requireScenario().assistantProviderRequests.length;
    // Keep the first turn busy with a real sandboxed sleep so the late input
    // below arrives while the Codex turn is still active.
    requireScenario().queueAssistantResponses(
      [
        buildAssistantProviderShellCommandCall(
          `sleep ${Math.ceil(codexTurnDelayMs / 1000)}`,
        ),
        replyText,
      ],
      { matchInputContains: firstText },
    );
    requireScenario().queueAssistantResponses(["Late reply."], {
      matchInputContains: lateText,
    });

    const startedAt = performance.now();
    const firstResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_active_turn_latency_first_${runId}`,
        messageId: `msg_active_turn_latency_first_${runId}`,
        text: firstText,
      }),
    );
    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    await sleep(lateInputDelayAfterWakeMs);

    const lateResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_active_turn_latency_late_${runId}`,
        messageId: `msg_active_turn_latency_late_${runId}`,
        text: lateText,
      }),
    );
    expect(lateResponse.status).toBe(202);
    await expect(lateResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const firstReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    const webhookToFirstReplyMs = performance.now() - startedAt;
    expect(firstReply.method).toBe("POST");
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(replyText);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: 420_000,
    });
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    const outboundReplyCount =
      requireLinqStub().countObservedSends(replyPath) - baselineSendCount;

    const providerRequests = requireScenario().assistantProviderRequests.slice(
      baselineProviderRequestCount,
    );
    const providerRequestBodies = providerRequests.map((request) => request.body);
    expect(providerRequestBodies.some((body) => body.includes(firstText))).toBe(true);

    return {
      lateInputHandled: providerRequestBodies.some((body) => body.includes(lateText)),
      outboundReplyCount,
      providerRequestCount: providerRequests.length,
      webhookToFirstReplyMs,
    };
  } finally {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }
}

async function runPostDeliveryMaintenancePreemptionProbe(input: {
  localDatabaseUrl: string;
}): Promise<{
  secondReplyLatencyMs: number;
  secondReplyObserved: boolean;
}> {
  const probeId = randomUUID().replace(/-/gu, "").slice(0, 12);
  const userId = `member_local_post_delivery_preemption_${probeId}`;
  const chatId = `chat_local_post_delivery_preemption_${probeId}`;
  const memberPhone = buildLinqRecipientPhoneNumber(userId);
  const homePhone = buildLinqHomePhoneNumber(userId);
  const firstText = "post delivery preemption first input";
  const secondText = "post delivery preemption second input";
  const firstReplyText = "Post-delivery preemption first reply.";
  const secondReplyText = "Post-delivery preemption second reply.";
  const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;

  await startProbeScenario({
    idleCheckpointDelayMs: 3_000,
    localDatabaseUrl: input.localDatabaseUrl,
    memberPhone,
  });

  try {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const firstSendBaseline = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([firstReplyText], {
      matchInputContains: firstText,
    });
    const firstResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_post_delivery_preemption_first_${probeId}`,
        messageId: `msg_post_delivery_preemption_first_${probeId}`,
        text: firstText,
      },
    ));
    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const firstReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: firstSendBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(firstReplyText);

    const firstReplyMessageId = requireLinqStub().requireLatestObservedMessageId(chatId);
    const cleanupPath = `/messages/${encodeURIComponent(firstReplyMessageId)}`;
    const cleanupBaseline = requireLinqStub().countObservedRequests({
      expectedMethod: "DELETE",
      expectedPath: cleanupPath,
    });
    requireLinqStub().armNextRequestDelay({
      delayMs: slowPostDeliveryMaintenanceMs,
      expectedMethod: "DELETE",
      expectedPath: cleanupPath,
    });
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: cleanupBaseline,
      expectedMethod: "DELETE",
      expectedPath: cleanupPath,
      scenario: requireScenario(),
      userId,
    });

    const secondSendBaseline = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([secondReplyText], {
      matchInputContains: secondText,
    });
    const secondStartedAt = performance.now();
    const secondResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_post_delivery_preemption_second_${probeId}`,
        messageId: `msg_post_delivery_preemption_second_${probeId}`,
        text: secondText,
      },
    ));
    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const secondReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: secondSendBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    const secondReplyLatencyMs = performance.now() - secondStartedAt;
    const secondReplyObserved =
      requireLinqStub().readObservedMessageText(secondReply) === secondReplyText;
    const finalStatus = await requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: 420_000,
    });
    expect(finalStatus.lastErrorCode ?? null).toBeNull();

    return {
      secondReplyLatencyMs,
      secondReplyObserved,
    };
  } finally {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }
}

async function runIdleShutdownDelayProbe(input: {
  localDatabaseUrl: string;
}): Promise<{
  idleShutdownSnapshotCount: number;
  providerCleanupDeleteObserved: boolean;
  providerCleanupObservationMs: number;
  snapshotObservationMs: number;
  workspaceCheckpointChanged: boolean;
  workspaceCheckpointedAtChanged: boolean;
  workspaceSnapshotRefChanged: boolean;
  workspaceVersionChanged: boolean;
}> {
  const probeId = randomUUID().replace(/-/gu, "").slice(0, 12);
  const userId = `member_local_idle_shutdown_delay_${probeId}`;
  const chatId = `chat_local_idle_shutdown_delay_${probeId}`;
  const memberPhone = buildLinqRecipientPhoneNumber(userId);
  const homePhone = buildLinqHomePhoneNumber(userId);
  const replyText = "Idle shutdown delay probe reply.";
  const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;

  await startIdleShutdownDelayProbeScenario({
    localDatabaseUrl: input.localDatabaseUrl,
    memberPhone,
  });

  try {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });
    await seedActivatedWorkspaceCheckpoint(userId);
    const baselineStatus = await readHostedRunnerStatusWithLogLimit(userId, 100);
    const baselineSnapshotCount = countIdleShutdownSnapshotLogs(baselineStatus);
    const baselineCheckpoint = readWorkspaceCheckpointFingerprint(baselineStatus);
    expect(baselineCheckpoint.version).not.toBeNull();

    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    const userText = "idle shutdown delay probe input";
    requireScenario().queueAssistantResponses([replyText], {
      matchInputContains: userText,
    });

    const response = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_idle_shutdown_delay_${probeId}`,
        messageId: `msg_idle_shutdown_delay_${probeId}`,
        text: userText,
      }),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const reply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);
    const replyMessageId = requireLinqStub().requireLatestObservedMessageId(chatId);

    await waitForProjectedOutboxDeliveryWake(userId);
    const providerCleanupObservationStartedAt = performance.now();
    await waitForObservedLinqRequestWithoutNudge({
      expectedCount: 1,
      expectedMethod: "DELETE",
      expectedPath: `/messages/${encodeURIComponent(replyMessageId)}`,
      timeoutMs: 10_000,
      userId,
    });
    const providerCleanupObservationMs =
      performance.now() - providerCleanupObservationStartedAt;
    const snapshotObservationStartedAt = performance.now();
    const snapshotStatus = await observeIdleShutdownSnapshots({
      durationMs: projectedWakeNoSnapshotObservationMs,
      userId,
    });
    const snapshotObservationMs = performance.now() - snapshotObservationStartedAt;
    const observedCheckpoint = readWorkspaceCheckpointFingerprint(snapshotStatus);
    const workspaceCheckpointedAtChanged =
      baselineCheckpoint.checkpointedAt !== observedCheckpoint.checkpointedAt;
    const workspaceSnapshotRefChanged =
      baselineCheckpoint.snapshotRefJson !== observedCheckpoint.snapshotRefJson;
    const workspaceVersionChanged =
      baselineCheckpoint.version !== observedCheckpoint.version;

    return {
      idleShutdownSnapshotCount:
        countIdleShutdownSnapshotLogs(snapshotStatus) - baselineSnapshotCount,
      providerCleanupDeleteObserved: true,
      providerCleanupObservationMs,
      snapshotObservationMs,
      workspaceCheckpointChanged:
        workspaceCheckpointedAtChanged
        || workspaceSnapshotRefChanged
        || workspaceVersionChanged,
      workspaceCheckpointedAtChanged,
      workspaceSnapshotRefChanged,
      workspaceVersionChanged,
    };
  } finally {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }
}

async function startProbeScenario(input: {
  idleCheckpointDelayMs?: number;
  localDatabaseUrl: string;
  memberPhone: string;
}): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: String(input.idleCheckpointDelayMs ?? 1_000),
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: input.memberPhone,
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl: input.localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-active-turn-latency-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted active-turn latency e2e",
    streamLogs: streamDevLogs,
  });
}

async function startIdleShutdownDelayProbeScenario(input: {
  localDatabaseUrl: string;
  memberPhone: string;
}): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: String(idleShutdownDelayProbeIdleDelayMs),
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: input.memberPhone,
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl: input.localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-idle-shutdown-delay-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted idle-shutdown delay probe e2e",
    streamLogs: streamDevLogs,
  });
}

async function waitForObservedLinqRequestWithoutNudge(input: {
  expectedCount: number;
  expectedMethod: string;
  expectedPath: string;
  timeoutMs: number;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < input.timeoutMs) {
    if (
      requireLinqStub().countObservedRequests({
        expectedMethod: input.expectedMethod,
        expectedPath: input.expectedPath,
      }) >= input.expectedCount
    ) {
      return;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for a Linq request without runner nudges.",
    `expected method: ${input.expectedMethod}`,
    `expected path: ${input.expectedPath}`,
    `observed requests: ${JSON.stringify(summarizeObservedLinqRequestsForFailure())}`,
  ]));
}

function summarizeObservedLinqRequestsForFailure(): Array<{ method: string; url: string }> {
  return requireLinqStub().observedRequests.slice(-20).map((request) => ({
    method: request.method,
    url: request.url,
  }));
}

async function observeIdleShutdownSnapshots(input: {
  durationMs: number;
  userId: string;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < input.durationMs) {
    const status = await readHostedRunnerStatusWithLogLimit(input.userId, 100);
    lastStatus = status;
    await sleep(250);
  }

  return lastStatus ?? await readHostedRunnerStatusWithLogLimit(input.userId, 100);
}

async function waitForProjectedOutboxDeliveryWake(
  userId: string,
): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 10_000) {
    const status = await readHostedRunnerStatusWithLogLimit(userId, 100);
    lastStatus = status;
    if (hasProjectedOutboxDeliveryWakeLog(status)) {
      return status;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for an outbox delivery log with projected follow-up wake metadata.",
    ...(lastStatus ? [`last status summary: ${summarizeHostedStatusForFailure(lastStatus)}`] : []),
  ]));
}

async function readHostedRunnerStatusWithLogLimit(
  userId: string,
  logLimit: number,
): Promise<HostedRunnerStatusResponse> {
  const status = parseHostedRunnerStatusResponse(
    await requireScenario().harness.requestJson(
      `/internal/users/${encodeURIComponent(userId)}/status?logLimit=${logLimit}`,
      {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
        },
      },
    ),
  );
  if (status.userId !== userId) {
    throw new Error("Hosted runner status read returned a different user.");
  }
  return status;
}

function hasProjectedOutboxDeliveryWakeLog(status: HostedRunnerStatusResponse): boolean {
  return (status.recentLogs ?? []).some((entry) =>
    entry.eventCode === "outbox.delivery_finished"
    && entry.redactedJson?.nextWakeAtPresent === true
  );
}

function countIdleShutdownSnapshotLogs(status: HostedRunnerStatusResponse): number {
  return (status.recentLogs ?? []).filter((entry) =>
    entry.eventCode === "checkpoint.snapshot_finished"
    && entry.redactedJson?.checkpointReason === "idle_shutdown"
  ).length;
}

interface WorkspaceCheckpointFingerprint {
  checkpointedAt: string | null;
  snapshotRefJson: string;
  version: string | null;
}

function readWorkspaceCheckpointFingerprint(
  status: HostedRunnerStatusResponse,
): WorkspaceCheckpointFingerprint {
  const workspace = status.workspace ?? null;
  return {
    checkpointedAt: workspace?.checkpointedAt ?? null,
    snapshotRefJson: JSON.stringify(workspace?.snapshotRef ?? null),
    version: workspace?.version ?? null,
  };
}

function summarizeHostedStatusForFailure(status: HostedRunnerStatusResponse): string {
  const workspace = status.workspace ?? null;
  return JSON.stringify({
    lastErrorCode: status.lastErrorCode ?? null,
    logCount: status.recentLogs?.length ?? 0,
    nextAlarmAtPresent: status.nextAlarmAt != null,
    workspaceCheckpointedAtPresent: workspace?.checkpointedAt != null,
    workspaceSnapshotRefPresent: workspace?.snapshotRef != null,
    workspaceVersionPresent: workspace?.version !== undefined,
  });
}

async function seedActivatedWorkspaceCheckpoint(userId: string): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-vault-"));
  cleanupPaths.push(root);
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });

  await createIntegratedVaultServices().core.init({
    requestId: "seed-idle-shutdown",
    timezone: "America/New_York",
    vault: vaultRoot,
  });

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: createBrowserVaultReplicaRef({
      sourceBundleHash: hash,
    }),
    environment: requireScenario().runtimeEnv,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: {
      seeded: true,
    },
    snapshotRef: createSnapshotBundleRef({
      hash,
      size: snapshot.bundle.byteLength,
    }),
    userId,
  });
  expect(checkpoint.status).toBe("updated");

  await uploadHostedSnapshotArtifact({
    bytes: snapshot.bundle,
    hash,
    userId,
  });
}

async function uploadHostedSnapshotArtifact(input: {
  bytes: Uint8Array;
  hash: string;
  userId: string;
}): Promise<void> {
  await requireScenario().harness.request(
    `/__test/artifacts?userId=${encodeURIComponent(input.userId)}&sha256=${input.hash}`,
    {
      body: new Blob([new Uint8Array(input.bytes)]),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
      },
      method: "PUT",
    },
  );
}

function createSnapshotBundleRef(input: {
  hash: string;
  size: number;
}): HostedExecutionSnapshotRef {
  return {
    hash: input.hash,
    key: `cloudflare-workspace-snapshots/${input.hash}.bundle`,
    size: input.size,
    updatedAt: new Date().toISOString(),
  };
}

function createBrowserVaultReplicaRef(input: {
  sourceBundleHash: string;
}): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `idle-shutdown-${input.sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:idle-shutdown",
    objectKey: `browser-vault/idle-shutdown-${input.sourceBundleHash.slice(0, 32)}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:idle-shutdown",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: input.sourceBundleHash,
  };
}

async function createSharedProbeDatabase(): Promise<{
  cleanup(): Promise<void>;
  url: string;
}> {
  if (configuredDatabaseUrl) {
    return {
      cleanup: async () => {},
      url: configuredDatabaseUrl,
    };
  }

  const adminUrl = new URL(DEFAULT_DATABASE_URL);
  const databaseName = `murph_e2e_active_turn_latency_${
    randomUUID().replace(/-/gu, "").slice(0, 12)
  }`;
  const commandArgs = buildPostgresDatabaseCommandArgs(adminUrl, databaseName);
  const commandEnv = buildPostgresDatabaseCommandEnv(adminUrl);

  await execFileAsync("createdb", commandArgs, { env: commandEnv });

  const targetUrl = new URL(DEFAULT_DATABASE_URL);
  targetUrl.pathname = `/${databaseName}`;

  return {
    cleanup: async () => {
      await Promise.all([
        databaseName,
        buildHostedLocalRuntimeLogDatabaseNameForTest(databaseName),
      ].map(async (name) =>
        await execFileAsync("dropdb", [
          "--if-exists",
          "--force",
          ...buildPostgresDatabaseCommandArgs(adminUrl, name),
        ], { env: commandEnv })
      ));
    },
    url: targetUrl.toString(),
  };
}

function buildPostgresDatabaseCommandArgs(url: URL, databaseName: string): string[] {
  const args: string[] = [];

  if (url.hostname) {
    args.push("--host", url.hostname);
  }

  if (url.port) {
    args.push("--port", url.port);
  }

  if (url.username) {
    args.push("--username", decodeURIComponent(url.username));
  }

  args.push(databaseName);
  return args;
}

function buildPostgresDatabaseCommandEnv(url: URL): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (url.password) {
    env.PGPASSWORD = decodeURIComponent(url.password);
  }

  return env;
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_active_turn_latency`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(linqWebhookSecret, rawBody, timestamp);

  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local active-turn latency scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local active-turn latency Linq stub was not started.");
  }
  return linqStub;
}
