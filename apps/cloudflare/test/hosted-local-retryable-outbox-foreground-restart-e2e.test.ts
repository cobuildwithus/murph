import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const chatId = `chat_local_retryable_outbox_restart_${runId}`;
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

  it("serves new foreground work before replaying a durable retry exactly once", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
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
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const baselineAcceptedRequestCount = requireLinqStub().acceptedSendRequests.length;
    const baselineMessageIdCount = requireLinqStub().listObservedMessageIds(chatId).length;
    const baselineProviderRequestCount = countAssistantProviderResponsesApiRequests();
    const baselineOlderObservedCount = requireLinqStub().countObservedSends(
      replyPath,
      olderReplyMatcher,
    );
    const baselineOlderAcceptedCount = requireLinqStub().countAcceptedSends(
      replyPath,
      olderReplyMatcher,
    );
    const baselineForegroundObservedCount = requireLinqStub().countObservedSends(
      replyPath,
      foregroundReplyMatcher,
    );
    const baselineForegroundAcceptedCount = requireLinqStub().countAcceptedSends(
      replyPath,
      foregroundReplyMatcher,
    );

    requireScenario().queueAssistantResponses([olderReplyText], {
      matchInputContains: olderInboundText,
    });
    requireScenario().queueAssistantResponses([foregroundReplyText], {
      matchInputContains: foregroundInboundText,
    });
    requireLinqStub().armNextPreAcceptRetryableSendFailure({
      expectedPath: replyPath,
      matchRequest: olderReplyMatcher,
    });

    const olderWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_retryable_outbox_older_${runId}`,
        messageId: `msg_retryable_outbox_older_${runId}`,
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
      expectedPath: replyPath,
      matchRequest: olderReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().countAcceptedSends(replyPath, olderReplyMatcher)).toBe(
      baselineOlderAcceptedCount,
    );
    expect(requireLinqStub().listObservedMessageIds(chatId)).toHaveLength(
      baselineMessageIdCount,
    );

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
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_retryable_outbox_foreground_${runId}`,
        messageId: `msg_retryable_outbox_foreground_${runId}`,
        text: foregroundInboundText,
      }),
    );
    expect(foregroundWebhookResponse.status).toBe(202);
    await expect(foregroundWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const foregroundReply = await requireLinqStub().waitForAdditionalAcceptedSend({
      baselineCount: baselineForegroundAcceptedCount,
      expectedPath: replyPath,
      matchRequest: foregroundReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(foregroundReply)).toBe(foregroundReplyText);
    expect(requireLinqStub().countAcceptedSends(replyPath, olderReplyMatcher)).toBe(
      baselineOlderAcceptedCount,
    );
    expect(Date.now()).toBeLessThan(retryWakeAtMs);

    const olderRetriedReply = await requireLinqStub().waitForAdditionalAcceptedSend({
      baselineCount: baselineOlderAcceptedCount,
      expectedPath: replyPath,
      matchRequest: olderReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(olderRetriedReply)).toBe(olderReplyText);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const acceptedReplies = requireLinqStub().acceptedSendRequests
      .slice(baselineAcceptedRequestCount)
      .filter((request) => request.url === replyPath);
    expect(acceptedReplies.map((request) => requireLinqStub().readObservedMessageText(request)))
      .toEqual([foregroundReplyText, olderReplyText]);
    expect(requireLinqStub().countObservedSends(replyPath, foregroundReplyMatcher)).toBe(
      baselineForegroundObservedCount + 1,
    );
    expect(requireLinqStub().countObservedSends(replyPath, olderReplyMatcher)).toBe(
      baselineOlderObservedCount + 4,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, foregroundReplyMatcher)).toBe(
      baselineForegroundAcceptedCount + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, olderReplyMatcher)).toBe(
      baselineOlderAcceptedCount + 1,
    );
    expect(requireLinqStub().listObservedMessageIds(chatId)).toHaveLength(
      baselineMessageIdCount + 2,
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
      baselineForegroundAcceptedCount,
      baselineMessageIdCount,
      baselineOlderAcceptedCount,
      foregroundReplyMatcher,
      olderReplyMatcher,
      replyPath,
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
    const status = await readHostedRunnerStatusWithLogLimit(100);
    lastStatus = status;
    const nextWakeAtMs = Date.parse(status.workspace?.nextWakeAt ?? "");
    if (
      status.workspace
      && !status.inFlight
      && !status.lastErrorCode
      && status.mailboxLag.every((lane) => lane.lag === "0")
      && Number.isFinite(nextWakeAtMs)
      && nextWakeAtMs > Date.now()
      && readPendingDeliveryEffectCount(status) > 0
      && hasRetryableOutboxDeliveryLog(status)
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
  baselineMessageIdCount: number;
  baselineOlderAcceptedCount: number;
  foregroundReplyMatcher: ObservedLinqRequestMatcher;
  olderReplyMatcher: ObservedLinqRequestMatcher;
  replyPath: string;
}): Promise<void> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;
  while (Date.now() - startedAt < 3_000) {
    lastStatus = await readHostedRunnerStatusWithLogLimit(100);
    expect(requireLinqStub().countAcceptedSends(input.replyPath, input.foregroundReplyMatcher))
      .toBe(input.baselineForegroundAcceptedCount + 1);
    expect(requireLinqStub().countAcceptedSends(input.replyPath, input.olderReplyMatcher))
      .toBe(input.baselineOlderAcceptedCount + 1);
    expect(requireLinqStub().listObservedMessageIds(chatId)).toHaveLength(
      input.baselineMessageIdCount + 2,
    );
    await sleep(250);
  }

  expect(lastStatus?.lastErrorCode ?? null).toBeNull();
  expect(lastStatus?.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  expect(lastStatus ? readPendingDeliveryEffectCount(lastStatus) : -1).toBe(0);
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

function hasRetryableOutboxDeliveryLog(status: HostedRunnerStatusResponse): boolean {
  return (status.recentLogs ?? []).some((entry) =>
    entry.eventCode === "outbox.delivery_finished"
    && entry.redactedJson?.retryable === 1
    && entry.redactedJson?.sent === 0
    && entry.redactedJson?.nextWakeAtPresent === true
  );
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
