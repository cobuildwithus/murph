import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readHostedLinqFirstContactMemberState,
  readHostedMailboxItemForTest,
  type HostedMailboxItemForTest,
} from "#hosted-web-testing";
import {
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
} from "@murphai/hosted-execution/runtime-control";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
  type ObservedLinqRequest,
  type ObservedLinqRequestMatcher,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_retryable_outbox_restart_${runId}`;
const olderChatId = `chat_local_retryable_outbox_older_${runId}`;
const foregroundChatId = `chat_local_retryable_outbox_foreground_${runId}`;
const olderEventId = `evt_retryable_outbox_older_${runId}`;
const foregroundEventId = `evt_retryable_outbox_foreground_${runId}`;
const linqWebhookSecret = "linq-local-retryable-outbox-restart-secret";
const productionLikeAssistantModel = "gpt-5.5";
const olderInboundText = "older retryable outbox input";
const foregroundInboundText = "new foreground input after restart";
const olderReplyText = "Older reply that must retry exactly once.";
const foregroundReplyText = "Foreground reply delivered before the old retry.";

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

describe("hosted local retryable outbox foreground restart e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 300_000);

  it("rebinds fresh direct work before replaying its former-route delivery exactly once", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    const olderReplyPath = `/chats/${encodeURIComponent(olderChatId)}/messages`;
    const foregroundReplyPath =
      `/chats/${encodeURIComponent(foregroundChatId)}/messages`;
    const olderReplyMatcher = matchLinqMessageText(olderReplyText);
    const foregroundReplyMatcher = matchLinqMessageText(foregroundReplyText);

    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: olderChatId,
      memberId: userId,
      participantPhone: memberPhone,
      recipientPhone: homePhone,
    });
    await expect(readMemberState()).resolves.toEqual({
      homeChatId: olderChatId,
      homeRecipientPhone: homePhone,
      memberCount: 1,
      memberId: userId,
      pendingChatId: null,
    });

    const baselineAcceptedRequestCount = requireLinqStub().acceptedSendRequests.length;
    const baselineOlderMessageIdCount =
      requireLinqStub().listObservedMessageIds(olderChatId).length;
    const baselineForegroundMessageIdCount =
      requireLinqStub().listObservedMessageIds(foregroundChatId).length;
    const baselineProviderRequestCount = countAssistantProviderResponsesApiRequests();
    const baselineOlderObservedCount = requireLinqStub().countObservedSends(
      olderReplyPath,
      olderReplyMatcher,
    );
    const baselineOlderAcceptedCount = requireLinqStub().countAcceptedSends(
      olderReplyPath,
      olderReplyMatcher,
    );
    const baselineForegroundObservedCount = requireLinqStub().countObservedSends(
      foregroundReplyPath,
      foregroundReplyMatcher,
    );
    const baselineForegroundAcceptedCount = requireLinqStub().countAcceptedSends(
      foregroundReplyPath,
      foregroundReplyMatcher,
    );

    requireScenario().queueAssistantResponses([olderReplyText], {
      matchInputContains: olderInboundText,
    });
    requireScenario().queueAssistantResponses([foregroundReplyText], {
      matchInputContains: foregroundInboundText,
    });
    requireLinqStub().armNextPreAcceptRetryableSendFailure({
      expectedPath: olderReplyPath,
      matchRequest: olderReplyMatcher,
    });

    const olderWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, olderChatId, {
        eventId: olderEventId,
        isGroup: false,
        messageId: `msg_retryable_outbox_older_${runId}`,
        service: "iMessage",
        text: olderInboundText,
      }),
    );
    expect(olderWebhookResponse.status).toBe(202);
    await expect(olderWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: baselineOlderObservedCount + 3,
      expectedPath: olderReplyPath,
      matchRequest: olderReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().countAcceptedSends(olderReplyPath, olderReplyMatcher)).toBe(
      baselineOlderAcceptedCount,
    );
    expect(requireLinqStub().listObservedMessageIds(olderChatId)).toHaveLength(
      baselineOlderMessageIdCount,
    );
    const olderMailboxItem = await readMailboxItem(olderEventId);
    expect(olderMailboxItem).toMatchObject({
      consumedAt: null,
      dedupeKey: olderEventId,
      kind: "conversation.message",
      lane: "conversation",
    });

    const retryableStatus = await waitForDurableRetryableOutbox();
    const retryWakeAtMs = Date.parse(retryableStatus.workspace?.nextWakeAt ?? "");
    expect(Number.isFinite(retryWakeAtMs)).toBe(true);
    expect(retryWakeAtMs - Date.now()).toBeGreaterThan(5_000);
    expect(retryableStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const baselineIdleShutdownCleanupCount = countActivityExpiredDestroyRequestLogs();
    const restartedStatus = await waitForIdleShutdownCheckpoint({
      baselineCleanupCount: baselineIdleShutdownCleanupCount,
      retryWakeAtMs,
    });
    expect(restartedStatus.workspace).not.toBeNull();
    expect(readHostedExecutionSnapshotHotRef(restartedStatus.workspace?.snapshotRef ?? null))
      .toBeNull();
    expect(readHostedExecutionSnapshotDeltaRef(restartedStatus.workspace?.snapshotRef ?? null))
      .toBeNull();
    expect(restartedStatus.inFlight).toBe(false);
    expect(restartedStatus.lastErrorCode ?? null).toBeNull();
    expect(countActivityExpiredDestroyRequestLogs())
      .toBeGreaterThan(baselineIdleShutdownCleanupCount);

    const foregroundWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, foregroundChatId, {
        eventId: foregroundEventId,
        isGroup: false,
        messageId: `msg_retryable_outbox_foreground_${runId}`,
        service: "iMessage",
        text: foregroundInboundText,
      }),
    );
    expect(foregroundWebhookResponse.status).toBe(202);
    await expect(foregroundWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await expect(readMemberState()).resolves.toEqual({
      homeChatId: foregroundChatId,
      homeRecipientPhone: homePhone,
      memberCount: 1,
      memberId: userId,
      pendingChatId: null,
    });
    const foregroundMailboxItem = await readMailboxItem(foregroundEventId);
    expect(foregroundMailboxItem).toMatchObject({
      dedupeKey: foregroundEventId,
      kind: "conversation.message",
      lane: "conversation",
    });
    expect(foregroundMailboxItem.id).not.toBe(olderMailboxItem.id);
    expect(BigInt(foregroundMailboxItem.laneSeq))
      .toBeGreaterThan(BigInt(olderMailboxItem.laneSeq));

    await requireScenario().waitForLatestPendingWake(userId);
    const foregroundReply = await requireLinqStub().waitForAdditionalAcceptedSend({
      baselineCount: baselineForegroundAcceptedCount,
      expectedPath: foregroundReplyPath,
      matchRequest: foregroundReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(foregroundReply)).toBe(foregroundReplyText);
    const consumedForegroundMailboxItem = await waitForConsumedMailboxItem(
      foregroundEventId,
    );
    expect(consumedForegroundMailboxItem.id).toBe(foregroundMailboxItem.id);
    expect(consumedForegroundMailboxItem.consumedAt).not.toBeNull();
    const unconsumedOlderMailboxItem = await readMailboxItem(olderEventId);
    expect(unconsumedOlderMailboxItem).toMatchObject({
      consumedAt: null,
      id: olderMailboxItem.id,
    });
    expect(requireLinqStub().countAcceptedSends(olderReplyPath, olderReplyMatcher)).toBe(
      baselineOlderAcceptedCount,
    );

    const olderRetriedReply = await requireLinqStub().waitForAdditionalAcceptedSend({
      baselineCount: baselineOlderAcceptedCount,
      expectedPath: olderReplyPath,
      matchRequest: olderReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(olderRetriedReply)).toBe(olderReplyText);
    const consumedOlderMailboxItem = await waitForConsumedMailboxItem(olderEventId);
    expect(consumedOlderMailboxItem.id).toBe(olderMailboxItem.id);
    expect(consumedOlderMailboxItem.consumedAt).not.toBeNull();
    await expect(readMemberState()).resolves.toEqual({
      homeChatId: foregroundChatId,
      homeRecipientPhone: homePhone,
      memberCount: 1,
      memberId: userId,
      pendingChatId: null,
    });

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const acceptedReplies = requireLinqStub().acceptedSendRequests
      .slice(baselineAcceptedRequestCount)
      .filter((request) =>
        request.url === olderReplyPath || request.url === foregroundReplyPath
      );
    expect(acceptedReplies.map((request) => ({
      path: request.url,
      text: requireLinqStub().readObservedMessageText(request),
    }))).toEqual([
      {
        path: foregroundReplyPath,
        text: foregroundReplyText,
      },
      {
        path: olderReplyPath,
        text: olderReplyText,
      },
    ]);
    expect(
      requireLinqStub().countObservedSends(foregroundReplyPath, foregroundReplyMatcher),
    ).toBe(
      baselineForegroundObservedCount + 1,
    );
    expect(requireLinqStub().countObservedSends(olderReplyPath, olderReplyMatcher)).toBe(
      baselineOlderObservedCount + 4,
    );
    expect(
      requireLinqStub().countAcceptedSends(foregroundReplyPath, foregroundReplyMatcher),
    ).toBe(
      baselineForegroundAcceptedCount + 1,
    );
    expect(requireLinqStub().countAcceptedSends(olderReplyPath, olderReplyMatcher)).toBe(
      baselineOlderAcceptedCount + 1,
    );
    expect(requireLinqStub().listObservedMessageIds(foregroundChatId)).toHaveLength(
      baselineForegroundMessageIdCount + 1,
    );
    expect(requireLinqStub().listObservedMessageIds(olderChatId)).toHaveLength(
      baselineOlderMessageIdCount + 1,
    );

    const assistantProviderRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(baselineProviderRequestCount);
    expect(assistantProviderRequests).toHaveLength(2);
    expect(readAssistantProviderRequestText(assistantProviderRequests[0]!)).toContain(
      olderInboundText,
    );
    expect(readAssistantProviderRequestText(assistantProviderRequests[1]!)).toContain(
      foregroundInboundText,
    );

    await assertNoDuplicateDeliveryAfterQuiescence({
      baselineForegroundMessageIdCount,
      baselineForegroundAcceptedCount,
      baselineOlderMessageIdCount,
      baselineOlderAcceptedCount,
      foregroundReplyPath,
      foregroundReplyMatcher,
      olderReplyPath,
      olderReplyMatcher,
    });
    await requireScenario().assertHealthyHostedRun(userId, {
      expectAssistantProviderRequest: true,
    });
  }, 600_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    faultInjection: true,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-retryable-outbox-restart-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted retryable outbox foreground restart e2e",
    streamLogs: streamDevLogs,
    testControls: true,
  });
}

async function waitForDurableRetryableOutbox(): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 20_000) {
    const status = await readHostedRunnerStatusWithLogLimit(1_000);
    lastStatus = status;
    const nextWakeAtMs = Date.parse(status.workspace?.nextWakeAt ?? "");
    if (
      status.workspace
      && !status.inFlight
      && !status.lastErrorCode
      && status.mailboxLag.every((lane) => lane.lag === "0")
      && Number.isFinite(nextWakeAtMs)
      && nextWakeAtMs > Date.now()
      // The prepared delivery effect is consumed by this attempt; the durable
      // retry is represented by its future wake and nonterminal attempt state.
      && readHostedOutboxCounter(status, "hostedOutboxDeliveryAttempted") === 1
      && readHostedOutboxCounter(status, "hostedOutboxDeliverySent") === 0
      && readHostedOutboxCounter(status, "hostedOutboxTerminalizedSending") === 0
    ) {
      return status;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the failed outbound reply to become durably retryable.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

async function waitForIdleShutdownCheckpoint(input: {
  baselineCleanupCount: number;
  retryWakeAtMs: number;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastActivityExpiryError: unknown = null;
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 20_000) {
    if (Date.now() >= input.retryWakeAtMs) {
      break;
    }
    const status = await readHostedRunnerStatusWithLogLimit(100);
    lastStatus = status;
    const hotRef = status.workspace
      ? readHostedExecutionSnapshotHotRef(status.workspace.snapshotRef)
      : null;
    const deltaRef = status.workspace
      ? readHostedExecutionSnapshotDeltaRef(status.workspace.snapshotRef)
      : null;

    if (
      status.workspace
      && hotRef === null
      && deltaRef === null
      && !status.inFlight
      && !status.lastErrorCode
      && countActivityExpiredDestroyRequestLogs() > input.baselineCleanupCount
    ) {
      return status;
    }

    try {
      await requireScenario().harness.expireRunnerActivityForTest(userId);
      lastActivityExpiryError = null;
    } catch (error) {
      lastActivityExpiryError = error;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out forcing an idle checkpoint and container restart before the old retry became due.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
    ...(lastActivityExpiryError
      ? [`last activity expiry error: ${formatErrorMessage(lastActivityExpiryError)}`]
      : []),
  ]));
}

async function assertNoDuplicateDeliveryAfterQuiescence(input: {
  baselineForegroundAcceptedCount: number;
  baselineForegroundMessageIdCount: number;
  baselineOlderAcceptedCount: number;
  baselineOlderMessageIdCount: number;
  foregroundReplyPath: string;
  foregroundReplyMatcher: ObservedLinqRequestMatcher;
  olderReplyPath: string;
  olderReplyMatcher: ObservedLinqRequestMatcher;
}): Promise<void> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;
  while (Date.now() - startedAt < 3_000) {
    lastStatus = await readHostedRunnerStatusWithLogLimit(100);
    expect(
      requireLinqStub().countAcceptedSends(
        input.foregroundReplyPath,
        input.foregroundReplyMatcher,
      ),
    )
      .toBe(input.baselineForegroundAcceptedCount + 1);
    expect(
      requireLinqStub().countAcceptedSends(
        input.olderReplyPath,
        input.olderReplyMatcher,
      ),
    )
      .toBe(input.baselineOlderAcceptedCount + 1);
    expect(requireLinqStub().listObservedMessageIds(foregroundChatId)).toHaveLength(
      input.baselineForegroundMessageIdCount + 1,
    );
    expect(requireLinqStub().listObservedMessageIds(olderChatId)).toHaveLength(
      input.baselineOlderMessageIdCount + 1,
    );
    await sleep(250);
  }

  expect(lastStatus?.lastErrorCode ?? null).toBeNull();
  expect(lastStatus?.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  expect(lastStatus ? readPendingDeliveryEffectCount(lastStatus) : -1).toBe(0);
}

async function readMemberState() {
  return await readHostedLinqFirstContactMemberState({
    environment: requireScenario().runtimeEnv,
    memberPhone: buildLinqRecipientPhoneNumber(userId),
  });
}

async function readMailboxItem(dedupeKey: string): Promise<HostedMailboxItemForTest> {
  return await readHostedMailboxItemForTest({
    dedupeKey,
    environment: requireScenario().runtimeEnv,
    userId,
  });
}

async function waitForConsumedMailboxItem(
  dedupeKey: string,
): Promise<HostedMailboxItemForTest> {
  const startedAt = Date.now();
  let lastItem: HostedMailboxItemForTest | null = null;
  while (Date.now() - startedAt < 20_000) {
    lastItem = await readMailboxItem(dedupeKey);
    if (lastItem.consumedAt) {
      return lastItem;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for an accepted reply to consume its exact mailbox item.",
    `mailbox dedupe key: ${dedupeKey}`,
    ...(lastItem ? [`last mailbox item: ${JSON.stringify(lastItem)}`] : []),
  ]));
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

function readPendingDeliveryEffectCount(status: HostedRunnerStatusResponse): number {
  const rawCount = status.workspace?.redactedStatus?.hostedOutboxPendingDeliveryEffects;
  if (typeof rawCount === "number" && Number.isSafeInteger(rawCount)) {
    return rawCount;
  }
  if (typeof rawCount === "string" && /^\d+$/u.test(rawCount)) {
    return Number(rawCount);
  }
  return 0;
}

function readHostedOutboxCounter(
  status: HostedRunnerStatusResponse,
  key: string,
): number {
  const rawCount = status.workspace?.redactedStatus?.[key];
  if (typeof rawCount === "number" && Number.isSafeInteger(rawCount)) {
    return rawCount;
  }
  if (typeof rawCount === "string" && /^\d+$/u.test(rawCount)) {
    return Number(rawCount);
  }
  return -1;
}

function countActivityExpiredDestroyRequestLogs(): number {
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
        details?: { destroyRequestReason?: unknown };
        message?: unknown;
      };
      return candidate.message === "Hosted execution container destroy requested."
        && candidate.details?.destroyRequestReason === "activity-expired";
    }).length;
}

function matchLinqMessageText(expectedText: string): ObservedLinqRequestMatcher {
  return (request) => requireLinqStub().readObservedMessageText(request) === expectedText;
}

function countAssistantProviderResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  ).length;
}

function readAssistantProviderRequestText(request: { body: string }): string {
  return collectJsonStrings(JSON.parse(request.body)).join("\n\n");
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJsonStrings(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectJsonStrings(entry));
  }
  return [];
}

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_retryable_outbox_restart`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(rawBody, timestamp);

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

function signLinqWebhook(payload: string, timestamp: string): string {
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `sha256=${signature}`;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local retryable-outbox restart scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local retryable-outbox restart Linq stub was not started.");
  }
  return linqStub;
}
