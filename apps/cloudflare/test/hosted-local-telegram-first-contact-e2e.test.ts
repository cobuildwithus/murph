import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "@murphai/hosted-execution";

import { buildStableNumericSuffix } from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildTelegramMessageId,
  buildTelegramThreadId,
  HOSTED_TELEGRAM_DEFAULT_ASSISTANT_REPLY_TEXT,
  HOSTED_TELEGRAM_GROUPED_ASSISTANT_REPLY_TEXT,
  startHostedLocalTelegramStub,
  type HostedLocalTelegramStub,
} from "./helpers/hosted-local-telegram-support.js";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../src/runner-injected-credential.ts";

const userId = `member_local_telegram_reply_${Date.now()}`;
const fastReplyUserId = `member_local_telegram_fast_reply_${Date.now()}`;
const telegramBotToken = "telegram-local-test-token";
const hostedLocalTelegramRequestToken = HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const telegramDebugLogFile = process.env.MURPH_E2E_TELEGRAM_DEBUG_LOG_FILE?.trim() || null;
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;
let telegramStub: HostedLocalTelegramStub | null = null;

it("derives stable numeric suffixes from the full Telegram user id", () => {
  expect(buildStableNumericSuffix("member_local_telegram_reply_20260408", 7)).not.toBe(
    buildStableNumericSuffix("member_local_telegram_fast_reply_20260408", 7),
  );
});

describe("hosted local Telegram auto-reply e2e", () => {
  beforeAll(async () => {
    await startTelegramScenario();
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await telegramStub?.stop();
    telegramStub = null;
  }, 120_000);

  it("sends Telegram typing and a reply after an inbound Telegram message", async () => {
    await requireScenario().seedActiveHostedMember({ memberId: userId });
    await requireScenario().runWake(buildActivationWake(userId), userId);

    await requireScenario().waitForHostedCompletion(userId);
    await requireTelegramStub().waitForRequestsToSettle({
      scenario: requireScenario(),
      userId,
    });

    requireScenario().queueAssistantResponses([HOSTED_TELEGRAM_DEFAULT_ASSISTANT_REPLY_TEXT]);
    const requestCountBeforeInbound = requireTelegramStub().observedRequests.length;
    await requireScenario().runWake(buildInboundTelegramWake(userId), userId);

    await requireScenario().waitForLatestPendingWake(userId);
    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.workspace).not.toBeNull();
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    await requireTelegramStub().waitForRequest({
      expectedPath: `/bot${hostedLocalTelegramRequestToken}/sendChatAction`,
      matchRequest: requireTelegramStub().createTypingMatcher(userId),
      scenario: requireScenario(),
      userId,
    });
    const sendRequest = await requireTelegramStub().waitForRequest({
      expectedPath: `/bot${hostedLocalTelegramRequestToken}/sendMessage`,
      matchRequest: requireTelegramStub().createSendMessageMatcher(userId),
      scenario: requireScenario(),
      userId,
    });

    const requestsAfterInbound = requireTelegramStub().observedRequests.slice(requestCountBeforeInbound);
    const typingRequestsAfterInbound = requestsAfterInbound.filter((request) =>
      request.url === `/bot${hostedLocalTelegramRequestToken}/sendChatAction`
      && requireTelegramStub().createTypingMatcher(userId)(request)
    );

    expect(sendRequest.method).toBe("POST");
    expect(typingRequestsAfterInbound.length).toBeGreaterThanOrEqual(1);
    expect(typingRequestsAfterInbound.every((request) => request.method === "POST")).toBe(true);

    const sendIndex = requestsAfterInbound.indexOf(sendRequest);
    const typingIndices = typingRequestsAfterInbound.map((request) =>
      requestsAfterInbound.indexOf(request)
    );
    expect(sendIndex).toBeGreaterThanOrEqual(0);
    expect(typingIndices[0]).toBeGreaterThanOrEqual(0);
    expect(sendIndex).toBeGreaterThan(typingIndices[0]);

    expect(requireTelegramStub().parseObservedJson(sendRequest.body)).toMatchObject({
      chat_id: buildTelegramThreadId(userId),
      reply_to_message_id: Number.parseInt(buildTelegramMessageId(userId), 10),
      text: HOSTED_TELEGRAM_DEFAULT_ASSISTANT_REPLY_TEXT,
    });
    await requireTelegramStub().waitForRequestsToSettle({
      scenario: requireScenario(),
      userId,
    });
    expect(requireTelegramStub().countObservedRequests(
      `/bot${hostedLocalTelegramRequestToken}/deleteMessages`,
    )).toBe(0);
  }, 300_000);

  it("keeps Telegram context when two messages arrive before hosted completion catches up", async () => {
    await requireScenario().seedActiveHostedMember({ memberId: fastReplyUserId });
    await requireScenario().runWake(buildActivationWake(fastReplyUserId), fastReplyUserId);

    await requireScenario().waitForHostedCompletion(fastReplyUserId);
    await requireTelegramStub().waitForRequestsToSettle({
      scenario: requireScenario(),
      userId: fastReplyUserId,
    });

    const expectedSendPath = `/bot${hostedLocalTelegramRequestToken}/sendMessage`;
    const baselineSendCount = requireTelegramStub().countObservedRequests(
      expectedSendPath,
      requireTelegramStub().createSendMessageMatcher(fastReplyUserId),
    );

    requireScenario().queueAssistantResponses([HOSTED_TELEGRAM_GROUPED_ASSISTANT_REPLY_TEXT]);
    await requireScenario().enqueueWake(
      buildInboundTelegramWake(fastReplyUserId, {
        eventId: `telegram.message.received:local:${fastReplyUserId}:evt_telegram_name`,
        messageId: `${buildTelegramMessageId(fastReplyUserId)}1`,
        text: "U can call me Rocket Man",
      }),
      fastReplyUserId,
    );

    await requireScenario().enqueueWake(
      buildInboundTelegramWake(fastReplyUserId, {
        eventId: `telegram.message.received:local:${fastReplyUserId}:evt_telegram_goals`,
        messageId: `${buildTelegramMessageId(fastReplyUserId)}2`,
        text: "I want to build more strength, improve endurance, and get fitter overall.",
      }),
      fastReplyUserId,
    );

    await requireScenario().waitForLatestPendingWake(fastReplyUserId);
    await requireScenario().waitForHostedCompletion(fastReplyUserId);
    await requireTelegramStub().waitForRequestsToSettle({
      scenario: requireScenario(),
      userId: fastReplyUserId,
    });

    const replyRequests = await requireTelegramStub().waitForRequestCount({
      expectedCount: baselineSendCount + 1,
      expectedPath: expectedSendPath,
      matchRequest: requireTelegramStub().createSendMessageMatcher(fastReplyUserId),
      scenario: requireScenario(),
      userId: fastReplyUserId,
    });
    const newReplyRequests = replyRequests.slice(baselineSendCount);
    expect(newReplyRequests).toHaveLength(1);
    const replyTexts = newReplyRequests.map((request) =>
      requireTelegramStub().parseObservedJson(request.body)?.text
    );

    expect(replyTexts).toEqual([
      HOSTED_TELEGRAM_GROUPED_ASSISTANT_REPLY_TEXT,
    ]);
  }, 300_000);
});

function buildActivationWake(userId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_telegram_activation`,
    memberId: userId,
    memberChannels: {
      email: false,
      linq: false,
      telegram: true,
    },
    occurredAt: new Date().toISOString(),
  });
}

function buildInboundTelegramWake(
  userId: string,
  overrides: {
    eventId?: string;
    messageId?: string;
    text?: string;
  } = {},
) {
  return buildHostedExecutionTelegramConversationMessageWake({
    eventId:
      overrides.eventId
      ?? `telegram.message.received:local:${userId}:evt_telegram_reply`,
    occurredAt: new Date().toISOString(),
    telegramMessage: {
      messageId: overrides.messageId ?? buildTelegramMessageId(userId),
      schema: "murph.hosted-telegram-message.v1",
      text: overrides.text ?? "yo",
      threadId: buildTelegramThreadId(userId),
    },
    userId,
  });
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}

function requireTelegramStub(): HostedLocalTelegramStub {
  if (!telegramStub) {
    throw new Error("Hosted local Telegram stub was not initialized.");
  }

  return telegramStub;
}

async function startTelegramScenario(): Promise<void> {
  telegramStub = await startHostedLocalTelegramStub({
    botToken: telegramBotToken,
    debugLogFile: telegramDebugLogFile,
  });
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      TELEGRAM_API_BASE_URL: requireTelegramStub().runnerBaseUrl,
      TELEGRAM_BOT_TOKEN: telegramBotToken,
    },
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-telegram-first-contact-",
    requiredRunnerEnvProfile: "telegram",
    scenarioLabel: "Local hosted Telegram e2e",
    streamLogs: streamDevLogs,
  });
}
