import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRunnerStatusResponse,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
  HostedRuntimeLogEntry,
} from "@murphai/hosted-execution/runtime-control";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  requireLinqPhoneLookupKey,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_idle_checkpoint_deferred_${runId}`;
const chatId = `chat_local_idle_checkpoint_deferred_${runId}`;
const linqWebhookSecret = "linq-local-idle-checkpoint-deferred-secret";
const productionLikeAssistantModel = "gpt-5.5";
const firstUserText = "idle checkpoint deferred first input";
const secondUserText = "idle checkpoint deferred second input";
const firstReplyText = "First deferred checkpoint reply.";
const secondReplyText = "Second deferred checkpoint reply.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;
let linqStub: HostedLocalLinqStub | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local idle checkpoint deferred progress e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 300_000);

  it("idle-checkpoints foreground-deferred mailbox progress even when the visible workspace is base-only", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;

    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    const activationBaselineCleanupCount = countSuccessfulIdleShutdownContainerCleanupLogs();
    await requireScenario().runWake(buildActivationWake(), userId);
    const activationCompletionStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activationCompletionStatus.lastErrorCode ?? null).toBeNull();
    expectMailboxLagDrained(activationCompletionStatus);
    const activationCompletionWorkspaceVersion = requireWorkspaceVersion(activationCompletionStatus);
    const activationStatus = await waitForIdleShutdownCheckpoint({
      baselineCleanupCount: activationBaselineCleanupCount,
      previousWorkspaceVersion: activationCompletionWorkspaceVersion,
    });
    expectWorkspaceBaseOnly(activationStatus);
    const activationWorkspaceVersion = requireWorkspaceVersion(activationStatus);

    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    const baselineCleanupCount = countSuccessfulIdleShutdownContainerCleanupLogs();
    requireScenario().queueAssistantResponses([firstReplyText, secondReplyText]);

    const firstWake = await requireScenario().runWake(
      buildInboundLinqWake({
        eventId: `evt_idle_checkpoint_deferred_first_${runId}`,
        messageId: `msg_idle_checkpoint_deferred_first_${runId}`,
        text: firstUserText,
      }),
      userId,
    );
    const firstSeq = firstWake.append.wake.seq;
    const firstReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(firstReplyText);

    const firstCompletionStatus = await waitForHostedInvocationIdleWithLogs();
    expect(firstCompletionStatus.lastErrorCode ?? null).toBeNull();
    expectWorkspaceBaseOnly(firstCompletionStatus);
    expectMailboxLagDrained(firstCompletionStatus);
    expectDeferredMailboxImportLog(firstCompletionStatus, {
      expectedConversationSeqEnd: firstSeq,
      expectedConversationSeqStart: "0",
      expectedWorkspaceVersion: activationWorkspaceVersion,
    });

    const idleCheckpointStatus =
      requireWorkspaceVersion(firstCompletionStatus) === activationWorkspaceVersion
        ? await waitForIdleShutdownCheckpoint({
            baselineCleanupCount,
            previousWorkspaceVersion: activationWorkspaceVersion,
          })
        : firstCompletionStatus;
    expectWorkspaceBaseOnly(idleCheckpointStatus);
    const idleWorkspaceVersion = requireWorkspaceVersion(idleCheckpointStatus);
    expect(idleWorkspaceVersion).not.toBe(activationWorkspaceVersion);
    expectIdleShutdownSnapshotLog(idleCheckpointStatus);

    const secondWake = await requireScenario().runWake(
      buildInboundLinqWake({
        eventId: `evt_idle_checkpoint_deferred_second_${runId}`,
        messageId: `msg_idle_checkpoint_deferred_second_${runId}`,
        text: secondUserText,
      }),
      userId,
    );
    const secondSeq = secondWake.append.wake.seq;
    const secondReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount + 1,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(secondReply)).toBe(secondReplyText);

    const finalStatus = await waitForHostedInvocationIdleWithLogs();
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expectMailboxLagDrained(finalStatus);
    expectDeferredMailboxImportLog(finalStatus, {
      expectedConversationSeqEnd: secondSeq,
      expectedConversationSeqStart: firstSeq,
      expectedWorkspaceVersion: idleWorkspaceVersion,
    });
  }, 600_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_SHUTDOWN_CHECKPOINT_SAFETY_MARGIN_MS: "0",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().baseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-idle-checkpoint-deferred-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted idle checkpoint deferred progress e2e",
    streamLogs: streamDevLogs,
  });
}

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_idle_checkpoint_deferred`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

function buildInboundLinqWake(input: {
  eventId: string;
  messageId: string;
  text: string;
}) {
  return buildHostedExecutionLinqConversationMessageWake({
    eventId: input.eventId,
    linqMessage: {
      chatId,
      from: buildLinqRecipientPhoneNumber(userId),
      isFromMe: false,
      messageId: input.messageId,
      parts: [{
        type: "text",
        value: input.text,
      }],
      service: "SMS",
    },
    occurredAt: new Date().toISOString(),
    phoneLookupKey: requireLinqPhoneLookupKey(userId),
    userId,
  });
}

async function waitForIdleShutdownCheckpoint(input: {
  baselineCleanupCount: number;
  previousWorkspaceVersion: string;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastAlarmError: unknown = null;
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 120_000) {
    const status = await readHostedRunnerStatusWithLogLimit(50);
    lastStatus = status;
    const cleanupCount = countSuccessfulIdleShutdownContainerCleanupLogs();

    if (
      status.workspace
      && status.workspace.version !== input.previousWorkspaceVersion
      && isWorkspaceBaseOnly(status)
      && !status.inFlight
      && !status.lastErrorCode
      && cleanupCount > input.baselineCleanupCount
      && hasIdleShutdownSnapshotLog(status.recentLogs ?? [])
    ) {
      return status;
    }

    const alarmDelayMs = status.nextAlarmAt
      ? Math.max(0, Date.parse(status.nextAlarmAt) - Date.now())
      : 250;
    if (alarmDelayMs > 0) {
      await sleep(Math.min(alarmDelayMs + 100, 1_000));
    }

    try {
      await requireScenario().harness.runHostedAlarmForTest(userId);
      lastAlarmError = null;
    } catch (error) {
      lastAlarmError = error;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for hosted idle-shutdown checkpoint after deferred progress.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
    ...(lastAlarmError ? [`last alarm error: ${formatErrorMessage(lastAlarmError)}`] : []),
  ]));
}

async function waitForHostedInvocationIdleWithLogs(): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 120_000) {
    const status = await readHostedRunnerStatusWithLogLimit(50);
    lastStatus = status;

    if (status.lastErrorCode) {
      throw new Error(await requireScenario().buildFailureMessage(userId, [
        "Hosted runner reported terminal error while waiting for foreground invocation idle.",
        `last status: ${JSON.stringify(status)}`,
      ]));
    }

    if (!status.inFlight && status.workspace !== null) {
      return status;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for hosted foreground invocation idle.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

function expectWorkspaceBaseOnly(status: HostedRunnerStatusResponse): void {
  expect(status.workspace).not.toBeNull();
  expect(isWorkspaceBaseOnly(status)).toBe(true);
}

function expectMailboxLagDrained(status: Pick<HostedRunnerStatusResponse, "mailboxLag">): void {
  expect(status.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
}

function isWorkspaceBaseOnly(status: HostedRunnerStatusResponse): boolean {
  const snapshotRef = status.workspace?.snapshotRef ?? null;
  return snapshotRef !== null
    && readHostedExecutionSnapshotHotRef(snapshotRef) === null
    && readHostedExecutionSnapshotDeltaRef(snapshotRef) === null;
}

function requireWorkspaceVersion(status: HostedRunnerStatusResponse): string {
  const version = status.workspace?.version ?? null;
  if (!version) {
    throw new Error("Hosted status did not include a workspace version.");
  }
  return version;
}

function expectDeferredMailboxImportLog(
  status: Pick<HostedRunnerStatusResponse, "recentLogs">,
  input: {
    expectedConversationSeqEnd: string;
    expectedConversationSeqStart: string;
    expectedWorkspaceVersion?: string;
  },
): void {
  const logs = status.recentLogs ?? [];
  const log = findDeferredMailboxImportLog(logs, {
    expectedConversationSeqEnd: input.expectedConversationSeqEnd,
    expectedConversationSeqStart: input.expectedConversationSeqStart,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
  });
  if (!log) {
    throw new Error([
      "Expected a foreground deferred mailbox import log.",
      `expected: ${JSON.stringify(input)}`,
      `mailbox logs: ${JSON.stringify(summarizeMailboxImportLogs(logs))}`,
    ].join("\n"));
  }
  expect(log?.redactedJson).toMatchObject({
    checkpointDeferred: true,
    checkpointed: false,
    conversationSeqEnd: input.expectedConversationSeqEnd,
    conversationSeqStart: input.expectedConversationSeqStart,
    stateChanged: true,
  });
}

function findDeferredMailboxImportLog(
  logs: readonly HostedRuntimeLogEntry[],
  input: {
    expectedConversationSeqEnd: string;
    expectedConversationSeqStart: string;
    expectedWorkspaceVersion?: string;
  },
): HostedRuntimeLogEntry | null {
  return [...logs].reverse().find((entry) =>
    entry.eventCode === "mailbox.imported"
    && entry.phase === "import"
    && entry.redactedJson?.conversationSeqEnd === input.expectedConversationSeqEnd
    && entry.redactedJson?.conversationSeqStart === input.expectedConversationSeqStart
    && entry.redactedJson?.checkpointDeferred === true
    && entry.redactedJson?.stateChanged === true
    && (
      input.expectedWorkspaceVersion === undefined
      || entry.workspaceVersion === input.expectedWorkspaceVersion
    )
  ) ?? null;
}

async function readHostedRunnerStatusWithLogLimit(
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

function summarizeMailboxImportLogs(
  logs: readonly HostedRuntimeLogEntry[],
): Array<{
  checkpointDeferred: unknown;
  conversationSeqEnd: unknown;
  conversationSeqStart: unknown;
  eventCode: HostedRuntimeLogEntry["eventCode"];
  phase: HostedRuntimeLogEntry["phase"];
  stateChanged: unknown;
}> {
  return logs
    .filter((entry) => entry.eventCode === "mailbox.imported")
    .map((entry) => ({
      checkpointDeferred: entry.redactedJson?.checkpointDeferred,
      conversationSeqEnd: entry.redactedJson?.conversationSeqEnd,
      conversationSeqStart: entry.redactedJson?.conversationSeqStart,
      eventCode: entry.eventCode,
      phase: entry.phase,
      stateChanged: entry.redactedJson?.stateChanged,
    }));
}

function expectIdleShutdownSnapshotLog(status: HostedRunnerStatusResponse): void {
  expect(hasIdleShutdownSnapshotLog(status.recentLogs ?? [])).toBe(true);
}

function hasIdleShutdownSnapshotLog(logs: readonly HostedRuntimeLogEntry[]): boolean {
  return logs.some((entry) =>
    entry.eventCode === "checkpoint.snapshot_finished"
    && entry.redactedJson?.checkpointReason === "idle_shutdown"
  );
}

function countSuccessfulIdleShutdownContainerCleanupLogs(): number {
  const output = [
    requireScenario().harness.stdoutTail(200_000),
    requireScenario().harness.stderrTail(200_000),
  ].join("\n");

  return output
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        return false;
      }

      let record: unknown;
      try {
        record = JSON.parse(trimmed);
      } catch {
        return false;
      }

      if (!record || typeof record !== "object") {
        return false;
      }

      const candidate = record as {
        details?: {
          destroyAttempted?: unknown;
          destroyOk?: unknown;
        };
        message?: unknown;
        userId?: unknown;
      };
      return candidate.message === "Hosted runner completed idle-shutdown checkpoint container cleanup."
        && candidate.userId === userId
        && candidate.details?.destroyAttempted === true
        && candidate.details?.destroyOk === true;
    }).length;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local idle checkpoint deferred progress scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local idle checkpoint deferred progress Linq stub was not started.");
  }
  return linqStub;
}
