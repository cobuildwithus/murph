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
const localRunnerIdleTtlMs = "300000";
const linqApiToken = "linq-local-test-token";
const idleCheckpointWaitTimeoutMs = 180_000;

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
    await requireScenario().runWake(buildActivationWake(), userId);
    const activationCompletionStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activationCompletionStatus.lastErrorCode ?? null).toBeNull();
    expectMailboxLagDrained(activationCompletionStatus);
    const activationCompletionWorkspaceVersion = requireWorkspaceVersion(activationCompletionStatus);
    const activationStatus = hasIdleShutdownSnapshotLog(activationCompletionStatus.recentLogs ?? [])
      ? activationCompletionStatus
      : await waitForIdleShutdownCheckpoint({
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

    const postTurnPreCheckpointStatus = await waitForPostTurnPreIdleCheckpointWindow({
      previousWorkspaceVersion: activationWorkspaceVersion,
    });
    expectWorkspaceBaseOnly(postTurnPreCheckpointStatus);
    expect(requireWorkspaceVersion(postTurnPreCheckpointStatus)).toBe(activationWorkspaceVersion);

    const firstCompletionStatus = await waitForHostedForegroundIdleOrDeferredProgress({
      expectedConversationSeqEnd: firstSeq,
      expectedWorkspaceVersion: activationWorkspaceVersion,
    });
    expect(firstCompletionStatus.lastErrorCode ?? null).toBeNull();
    expectWorkspaceBaseOnly(firstCompletionStatus);
    const firstCompletionWorkspaceVersion = requireWorkspaceVersion(firstCompletionStatus);
    if (firstCompletionWorkspaceVersion === activationWorkspaceVersion) {
      expectForegroundDeferredMailboxProgressEvidence(firstCompletionStatus, {
        expectedConversationSeqEnd: firstSeq,
        expectedWorkspaceVersion: activationWorkspaceVersion,
      });
    } else {
      expectMailboxLagDrained(firstCompletionStatus);
    }

    const idleCheckpointStatus =
      firstCompletionWorkspaceVersion === activationWorkspaceVersion
        ? await waitForIdleShutdownCheckpoint({
            expectedConversationSeqEnd: firstSeq,
            previousWorkspaceVersion: activationWorkspaceVersion,
          })
        : firstCompletionStatus;
    expectWorkspaceBaseOnly(idleCheckpointStatus);
    const idleWorkspaceVersion = requireWorkspaceVersion(idleCheckpointStatus);
    expect(idleWorkspaceVersion).not.toBe(activationWorkspaceVersion);
    expectCommittedIdleCheckpointProgressEvidence(idleCheckpointStatus, {
      expectedConversationSeqEnd: firstSeq,
      expectedWorkspaceVersion: activationWorkspaceVersion,
    });

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

    const secondPostTurnPreCheckpointStatus = await waitForPostTurnPreIdleCheckpointWindow({
      previousWorkspaceVersion: idleWorkspaceVersion,
    });
    expectWorkspaceBaseOnly(secondPostTurnPreCheckpointStatus);
    expect(requireWorkspaceVersion(secondPostTurnPreCheckpointStatus)).toBe(idleWorkspaceVersion);

    const finalStatus = await waitForHostedForegroundIdleOrDeferredProgress({
      expectedConversationSeqEnd: secondSeq,
      expectedWorkspaceVersion: idleWorkspaceVersion,
    });
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    const finalWorkspaceVersion = requireWorkspaceVersion(finalStatus);
    if (finalWorkspaceVersion === idleWorkspaceVersion) {
      expectForegroundDeferredMailboxProgressEvidence(finalStatus, {
        expectedConversationSeqEnd: secondSeq,
        expectedWorkspaceVersion: idleWorkspaceVersion,
      });
    } else {
      expectMailboxLagDrained(finalStatus);
    }
    const secondIdleCheckpointStatus =
      finalWorkspaceVersion === idleWorkspaceVersion
        ? await waitForIdleShutdownCheckpoint({
            expectedConversationSeqEnd: secondSeq,
            previousWorkspaceVersion: idleWorkspaceVersion,
          })
        : finalStatus;
    expectCommittedIdleCheckpointProgressEvidence(secondIdleCheckpointStatus, {
      expectedConversationSeqEnd: secondSeq,
      expectedWorkspaceVersion: idleWorkspaceVersion,
    });
  }, 600_000);
});

describe("hosted local idle checkpoint deferred progress log helpers", () => {
  it("requires assistant completion at or after the latest matching deferred import", () => {
    const input = {
      expectedConversationSeqEnd: "2",
      expectedWorkspaceVersion: "7",
    };
    const olderImportLog = buildDeferredMailboxImportLog({
      at: "2026-06-18T12:00:04.000Z",
      conversationSeqEnd: "2",
      workspaceVersion: "7",
    });
    const stalePassFinishedLog = buildAssistantPassFinishedLog(
      "2026-06-18T12:00:05.000Z",
    );
    const latestImportLog = buildDeferredMailboxImportLog({
      at: "2026-06-18T12:00:06.000Z",
      conversationSeqEnd: "2",
      workspaceVersion: "7",
    });

    expect(findLatestDeferredMailboxImportLog([latestImportLog], input)).toBe(
      latestImportLog,
    );
    expect(hasAssistantPassFinishedAtOrAfterLog([latestImportLog], latestImportLog)).toBe(false);

    const staleCompletionLogs = [
      latestImportLog,
      stalePassFinishedLog,
      olderImportLog,
    ];
    expect(findLatestDeferredMailboxImportLog(staleCompletionLogs, input)).toBe(
      latestImportLog,
    );
    expect(hasAssistantPassFinishedAtOrAfterLog(
      staleCompletionLogs,
      latestImportLog,
    )).toBe(false);

    const completedAfterLatestImportLogs = [
      buildAssistantPassFinishedLog("2026-06-18T12:00:07.000Z"),
      ...staleCompletionLogs,
    ];
    expect(hasAssistantPassFinishedAtOrAfterLog(
      completedAfterLatestImportLogs,
      latestImportLog,
    )).toBe(true);
  });
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub({
    expectedAuthorizationToken: linqApiToken,
  });
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1000",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: localRunnerIdleTtlMs,
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: linqApiToken,
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
  expectedConversationSeqEnd?: string;
  previousWorkspaceVersion: string;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let activityExpiryAttempts = 0;
  let lastActivityExpiryError: unknown = null;
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < idleCheckpointWaitTimeoutMs) {
    const status = await readHostedRunnerStatusWithLogLimit(100);
    lastStatus = status;

    if (isIdleCheckpointStatusReady(status, input)) {
      return status;
    }

    if (input.expectedConversationSeqEnd === undefined && !status.inFlight) {
      try {
        await requireScenario().harness.expireRunnerActivityForTest(userId);
        activityExpiryAttempts += 1;
        lastActivityExpiryError = null;
      } catch (error) {
        lastActivityExpiryError = error;
      }
    }

    await sleep(250);
  }

  const finalStatus = await readHostedRunnerStatusWithLogLimit(100).catch(() => null);
  if (finalStatus) {
    lastStatus = finalStatus;
    if (isIdleCheckpointStatusReady(finalStatus, input)) {
      return finalStatus;
    }
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for hosted idle-shutdown checkpoint after deferred progress.",
    `activity expiry attempts: ${activityExpiryAttempts}`,
    ...(lastStatus
      ? [`last status summary: ${JSON.stringify(summarizeHostedStatusForFailure(lastStatus))}`]
      : []),
    ...(lastActivityExpiryError
      ? [`last activity expiry error: ${formatErrorMessage(lastActivityExpiryError)}`]
      : []),
  ]));
}

function isIdleCheckpointStatusReady(
  status: HostedRunnerStatusResponse,
  input: {
    expectedConversationSeqEnd?: string;
    previousWorkspaceVersion: string;
  },
): boolean {
  return Boolean(
    status.workspace
      && status.workspace.version !== input.previousWorkspaceVersion
      && isWorkspaceBaseOnly(status)
      && !status.lastErrorCode
      && (input.expectedConversationSeqEnd === undefined
        ? !status.inFlight && hasIdleShutdownSnapshotLog(status.recentLogs ?? [], {
            expectedWorkspaceVersion: input.previousWorkspaceVersion,
          })
        : hasCommittedIdleCheckpointProgressEvidence(status, {
            expectedConversationSeqEnd: input.expectedConversationSeqEnd,
            expectedWorkspaceVersion: input.previousWorkspaceVersion,
          })),
  );
}

async function waitForPostTurnPreIdleCheckpointWindow(input: {
  previousWorkspaceVersion: string;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 30_000) {
    const status = await readHostedRunnerStatusWithLogLimit(100);
    lastStatus = status;

    if (hasCompletedHostedError(status)) {
      throw new Error(await requireScenario().buildFailureMessage(userId, [
        "Hosted runner reported terminal error while waiting for post-turn pre-checkpoint window.",
        `last status summary: ${JSON.stringify(summarizeHostedStatusForFailure(status))}`,
      ]));
    }

    if (
      status.workspace
      && status.workspace.version === input.previousWorkspaceVersion
      && isWorkspaceBaseOnly(status)
    ) {
      return status;
    }

    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for post-turn pre-checkpoint window.",
    ...(lastStatus
      ? [`last status summary: ${JSON.stringify(summarizeHostedStatusForFailure(lastStatus))}`]
      : []),
  ]));
}

async function waitForHostedForegroundIdleOrDeferredProgress(input: {
  expectedConversationSeqEnd: string;
  expectedConversationSeqStart?: string;
  expectedWorkspaceVersion: string;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 120_000) {
    const status = await readHostedRunnerStatusWithLogLimit(100);
    lastStatus = status;

    if (hasCompletedHostedError(status)) {
      throw new Error(await requireScenario().buildFailureMessage(userId, [
        "Hosted runner reported terminal error while waiting for foreground invocation idle.",
        `last status summary: ${JSON.stringify(summarizeHostedStatusForFailure(status))}`,
      ]));
    }

    if (!status.inFlight && status.workspace !== null && !status.lastErrorCode) {
      return status;
    }

    if (status.workspace !== null && !status.lastErrorCode) {
      const deferredImportLog = findLatestDeferredMailboxImportLog(
        status.recentLogs ?? [],
        input,
      );
      if (
        deferredImportLog
        && hasAssistantPassFinishedAtOrAfterLog(status.recentLogs ?? [], deferredImportLog)
      ) {
        return status;
      }
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for hosted foreground invocation idle or deferred mailbox progress.",
    `expected deferred progress: ${JSON.stringify(input)}`,
    ...(lastStatus ? [`last status summary: ${JSON.stringify(summarizeHostedStatusForFailure(lastStatus))}`] : []),
  ]));
}

function hasCompletedHostedError(status: HostedRunnerStatusResponse): boolean {
  return !status.inFlight && Boolean(status.lastErrorCode);
}

function expectWorkspaceBaseOnly(status: HostedRunnerStatusResponse): void {
  expect(status.workspace).not.toBeNull();
  expect(isWorkspaceBaseOnly(status)).toBe(true);
}

function expectMailboxLagDrained(
  status: Pick<HostedRunnerStatusResponse, "mailboxLag" | "recentLogs">,
): void {
  const unresolved = status.mailboxLag.filter((lane) => lane.lag !== "0");
  if (unresolved.length === 0) {
    return;
  }

  expect(resolveLocallyDrainedMailboxLag(status)).toBe(true);
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

function resolveLocallyDrainedMailboxLag(
  status: Pick<HostedRunnerStatusResponse, "mailboxLag" | "recentLogs">,
): boolean {
  const importLogIndices: number[] = [];

  for (const lane of status.mailboxLag) {
    if (lane.lag === "0") {
      continue;
    }

    const imported = readRecentMailboxImportedSeq(status, lane.lane);
    if (!imported || compareMailboxSeq(imported.seq, lane.maxSeq) < 0) {
      return false;
    }
    importLogIndices.push(imported.index);
  }

  return importLogIndices.every((importIndex) =>
    (status.recentLogs ?? []).some((log, logIndex) =>
      logIndex < importIndex && log.eventCode === "assistant.pass_finished"
    )
  );
}

function readRecentMailboxImportedSeq(
  status: Pick<HostedRunnerStatusResponse, "recentLogs">,
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

function compareMailboxSeq(left: string, right: string): number {
  try {
    const leftSeq = BigInt(left);
    const rightSeq = BigInt(right);
    return leftSeq === rightSeq ? 0 : leftSeq > rightSeq ? 1 : -1;
  } catch {
    return left.localeCompare(right);
  }
}

function expectForegroundDeferredMailboxProgressEvidence(
  status: Pick<HostedRunnerStatusResponse, "recentLogs">,
  input: {
    expectedConversationSeqEnd: string;
    expectedConversationSeqStart?: string;
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
    ...(input.expectedConversationSeqStart === undefined
      ? {}
      : { conversationSeqStart: input.expectedConversationSeqStart }),
    stateChanged: true,
  });
}

function expectCommittedIdleCheckpointProgressEvidence(
  status: Pick<HostedRunnerStatusResponse, "recentLogs" | "workspace">,
  input: {
    expectedConversationSeqEnd: string;
    expectedWorkspaceVersion?: string;
  },
): void {
  if (hasCommittedIdleCheckpointProgressEvidence(status, input)) {
    return;
  }

  throw new Error([
    "Expected committed idle-checkpoint mailbox progress evidence.",
    `expected: ${JSON.stringify(input)}`,
    `workspace progress: ${JSON.stringify(summarizeWorkspaceCheckpointProgress(status))}`,
    `snapshot logs: ${JSON.stringify(summarizeIdleShutdownSnapshotLogs(
      status.recentLogs ?? [],
      input.expectedWorkspaceVersion,
    ))}`,
  ].join("\n"));
}

function summarizeWorkspaceCheckpointProgress(
  status: Pick<HostedRunnerStatusResponse, "workspace">,
): {
  conversationImportedSeq: string | null;
  workspaceVersion: string | null;
} {
  const conversationImportedSeq =
    status.workspace?.redactedStatus?.hostedMailboxConversationImportedSeq;
  return {
    conversationImportedSeq: typeof conversationImportedSeq === "string"
      ? conversationImportedSeq
      : null,
    workspaceVersion: status.workspace?.version ?? null,
  };
}

function summarizeHostedStatusForFailure(status: HostedRunnerStatusResponse): {
  idleShutdownSnapshots: ReturnType<typeof summarizeIdleShutdownSnapshotLogs>;
  inFlight: boolean;
  lastErrorCode: string | null;
  mailboxLag: Array<{
    importedSeq: string;
    lag: string;
    lane: HostedRunnerStatusResponse["mailboxLag"][number]["lane"];
    maxSeq: string;
  }>;
  mailboxLogs: ReturnType<typeof summarizeMailboxImportLogs>;
  nextAlarmAtPresent: boolean;
  workspaceProgress: ReturnType<typeof summarizeWorkspaceCheckpointProgress>;
} {
  return {
    idleShutdownSnapshots: summarizeIdleShutdownSnapshotLogs(status.recentLogs ?? []),
    inFlight: status.inFlight,
    lastErrorCode: status.lastErrorCode ?? null,
    mailboxLag: status.mailboxLag.map((lane) => ({
      importedSeq: lane.importedSeq,
      lag: lane.lag,
      lane: lane.lane,
      maxSeq: lane.maxSeq,
    })),
    mailboxLogs: summarizeMailboxImportLogs(status.recentLogs ?? []),
    nextAlarmAtPresent: status.nextAlarmAt != null,
    workspaceProgress: summarizeWorkspaceCheckpointProgress(status),
  };
}

function hasCommittedIdleCheckpointProgressEvidence(
  status: Pick<HostedRunnerStatusResponse, "recentLogs" | "workspace">,
  input: {
    expectedConversationSeqEnd: string;
    expectedWorkspaceVersion?: string;
  },
): boolean {
  if (
    input.expectedWorkspaceVersion !== undefined
    && status.workspace?.version === input.expectedWorkspaceVersion
  ) {
    return false;
  }

  const workspaceImportedSeq =
    status.workspace?.redactedStatus?.hostedMailboxConversationImportedSeq;
  return typeof workspaceImportedSeq === "string"
    && compareMailboxSeq(workspaceImportedSeq, input.expectedConversationSeqEnd) >= 0;
}

function findDeferredMailboxImportLog(
  logs: readonly HostedRuntimeLogEntry[],
  input: {
    expectedConversationSeqEnd: string;
    expectedConversationSeqStart?: string;
    expectedWorkspaceVersion?: string;
  },
): HostedRuntimeLogEntry | null {
  return [...logs].reverse().find((entry) =>
    isDeferredMailboxImportLog(entry, input)
  ) ?? null;
}

function findLatestDeferredMailboxImportLog(
  logs: readonly HostedRuntimeLogEntry[],
  input: {
    expectedConversationSeqEnd: string;
    expectedConversationSeqStart?: string;
    expectedWorkspaceVersion?: string;
  },
): HostedRuntimeLogEntry | null {
  return logs.find((entry) =>
    isDeferredMailboxImportLog(entry, input)
  ) ?? null;
}

function isDeferredMailboxImportLog(
  entry: HostedRuntimeLogEntry,
  input: {
    expectedConversationSeqEnd: string;
    expectedConversationSeqStart?: string;
    expectedWorkspaceVersion?: string;
  },
): boolean {
  return entry.eventCode === "mailbox.imported"
    && entry.phase === "import"
    && entry.redactedJson?.conversationSeqEnd === input.expectedConversationSeqEnd
    && (
      input.expectedConversationSeqStart === undefined
      || entry.redactedJson?.conversationSeqStart === input.expectedConversationSeqStart
    )
    && entry.redactedJson?.checkpointDeferred === true
    && entry.redactedJson?.stateChanged === true
    && (
      input.expectedWorkspaceVersion === undefined
      || entry.workspaceVersion === input.expectedWorkspaceVersion
    );
}

function hasAssistantPassFinishedAtOrAfterLog(
  logs: readonly HostedRuntimeLogEntry[],
  importLog: HostedRuntimeLogEntry,
): boolean {
  const importAtMs = Date.parse(importLog.at);
  if (!Number.isFinite(importAtMs)) {
    return false;
  }

  return logs.some((entry) => {
    if (entry.eventCode !== "assistant.pass_finished") {
      return false;
    }
    const entryAtMs = Date.parse(entry.at);
    return Number.isFinite(entryAtMs) && entryAtMs >= importAtMs;
  });
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

function summarizeIdleShutdownSnapshotLogs(
  logs: readonly HostedRuntimeLogEntry[],
  expectedWorkspaceVersion?: string,
): Array<{
  checkpointReason: unknown;
  eventCode: HostedRuntimeLogEntry["eventCode"];
  workspaceVersion?: string | null;
}> {
  return logs
    .filter((entry) =>
      entry.eventCode === "checkpoint.snapshot_finished"
      && entry.redactedJson?.checkpointReason === "idle_shutdown"
      && (
        expectedWorkspaceVersion === undefined
        || entry.workspaceVersion === expectedWorkspaceVersion
      )
    )
    .map((entry) => ({
      checkpointReason: entry.redactedJson?.checkpointReason,
      eventCode: entry.eventCode,
      workspaceVersion: entry.workspaceVersion ?? null,
    }));
}

function hasIdleShutdownSnapshotLog(
  logs: readonly HostedRuntimeLogEntry[],
  input: {
    expectedWorkspaceVersion?: string;
  } = {},
): boolean {
  return logs.some((entry) =>
    entry.eventCode === "checkpoint.snapshot_finished"
    && entry.redactedJson?.checkpointReason === "idle_shutdown"
    && (
      input.expectedWorkspaceVersion === undefined
      || entry.workspaceVersion === input.expectedWorkspaceVersion
    )
  );
}

function buildDeferredMailboxImportLog(input: {
  at: string;
  conversationSeqEnd: string;
  workspaceVersion: string;
}): HostedRuntimeLogEntry {
  return {
    at: input.at,
    component: "mailbox",
    eventCode: "mailbox.imported",
    level: "info",
    phase: "import",
    redactedJson: {
      checkpointDeferred: true,
      checkpointed: false,
      conversationSeqEnd: input.conversationSeqEnd,
      stateChanged: true,
    },
    workspaceVersion: input.workspaceVersion,
  };
}

function buildAssistantPassFinishedLog(at: string): HostedRuntimeLogEntry {
  return {
    at,
    component: "assistant",
    eventCode: "assistant.pass_finished",
    level: "info",
    phase: "invoke",
    redactedJson: {},
  };
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
