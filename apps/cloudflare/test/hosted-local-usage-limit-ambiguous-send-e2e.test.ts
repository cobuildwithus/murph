import { createHmac } from "node:crypto";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  grantHostedUsageCreditForTest,
  listHostedLinqDeliveriesForTest,
  readHostedAiUsageLimitPeriodForTest,
  readHostedMailboxItemForTest,
  seedHostedAiUsageLimitPeriodForTest,
  signalHostedRuntimeRecheckRuntimeForTest,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_usage_limit_ambiguous_${runId}`;
const chatId = `chat_local_usage_limit_ambiguous_${runId}`;
const linqApiToken = "linq-local-usage-limit-token";
const linqWebhookSecret = "linq-local-usage-limit-webhook-secret";
const assistantModel = "gpt-5.6-terra";
const firstInboundText = "Can you help me plan tomorrow's workout?";
const secondInboundText = "Can you also update the plan for Saturday?";
const firstAssistantReply = "Absolutely — here's a focused plan for tomorrow.";
const secondAssistantReply = "I've updated the Saturday plan too.";
const usageLimitNoticeUrl =
  "https://www.withmurph.ai/settings?addUsage=true#subscription";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

vi.mock("server-only", () => ({}));

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local usage-limit ambiguous send e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD:
          "price_local_usage_limit_5",
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-usage-limit-ambiguous-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted usage-limit ambiguous send e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  it("keeps one durable crossing notice while later over-limit work remains blocked", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      billingPlanCode: "launch_monthly",
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
      stripeCustomerId: `cus_local_usage_limit_${runId}`,
      stripeSubscriptionId: `sub_local_usage_limit_${runId}`,
    });
    await requireScenario().runWake(buildActivationWake(), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });
    const activationStatus = await requireScenario().harness.readUserStatus(userId);
    const conversationSeqBeforeFirstInbound = readConversationMailboxMaxSeq(activationStatus);
    const { periodEnd, periodStart } = buildCurrentUtcCalendarMonthPeriod();
    await seedHostedAiUsageLimitPeriodForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
      periodEnd,
      periodStart,
      remainingUsdMicros: 1n,
    });

    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const usageNoticeTextMatcher = (request: ObservedLinqRequest): boolean => {
      const text = requireLinqStub().readObservedMessageText(request);
      return text !== null
        && !text.includes(usageLimitNoticeUrl)
        && /allowance|cap|Edge|month|reset|usage/iu.test(text);
    };
    const usageNoticeLinkMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageLink(request) === usageLimitNoticeUrl;
    const observedTextBaseline = requireLinqStub().countObservedSends(
      replyPath,
      usageNoticeTextMatcher,
    );
    const acceptedTextBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      usageNoticeTextMatcher,
    );
    const observedBaseline = requireLinqStub().countObservedSends(
      replyPath,
      usageNoticeLinkMatcher,
    );
    const acceptedBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      usageNoticeLinkMatcher,
    );
    const firstReplyMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageText(request) === firstAssistantReply;
    const secondReplyMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageText(request) === secondAssistantReply;
    const firstReplyBaseline = requireLinqStub().countObservedSends(
      replyPath,
      firstReplyMatcher,
    );
    const providerBaseline = countAssistantResponseRequests();

    requireLinqStub().armNextPostAcceptLostAcknowledgment({
      expectedPath: replyPath,
      matchRequest: usageNoticeLinkMatcher,
      responseCount: 1,
    });
    requireScenario().queueAssistantResponses([firstAssistantReply], {
      matchInputContains: firstInboundText,
    });

    const firstResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_usage_limit_ambiguous_first_${runId}`,
        messageId: `msg_usage_limit_ambiguous_first_${runId}`,
        text: firstInboundText,
      },
    ));
    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: firstReplyBaseline + 1,
      expectedPath: replyPath,
      matchRequest: firstReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: observedTextBaseline + 1,
      expectedPath: replyPath,
      matchRequest: usageNoticeTextMatcher,
      scenario: requireScenario(),
      userId,
    });
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedTextBaseline + 1,
      expectedPath: replyPath,
      matchRequest: usageNoticeTextMatcher,
      scenario: requireScenario(),
      userId,
    });
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: observedBaseline + 1,
      expectedPath: replyPath,
      matchRequest: usageNoticeLinkMatcher,
      scenario: requireScenario(),
      userId,
    });
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedBaseline + 1,
      expectedPath: replyPath,
      matchRequest: usageNoticeLinkMatcher,
      scenario: requireScenario(),
      userId,
    });
    const firstCompletedStatus = await requireScenario().waitForHostedIdle(userId);

    expect(requireLinqStub().countObservedSends(replyPath, usageNoticeTextMatcher)).toBe(
      observedTextBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeTextMatcher)).toBe(
      acceptedTextBaseline + 1,
    );
    expect(requireLinqStub().countObservedSends(replyPath, usageNoticeLinkMatcher)).toBe(
      observedBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeLinkMatcher)).toBe(
      acceptedBaseline + 1,
    );
    expect(countAssistantResponseRequests()).toBe(providerBaseline + 1);
    expect(firstCompletedStatus.lastErrorCode ?? null).toBeNull();
    expect(readConversationMailboxLag(firstCompletedStatus)).toBe("0");
    expect(compareMailboxSeq(
      readConversationMailboxMaxSeq(firstCompletedStatus),
      conversationSeqBeforeFirstInbound,
    )).toBeGreaterThan(0);

    const deliveriesAfterAmbiguousSend = await listHostedLinqDeliveriesForTest({
      environment: requireScenario().runtimeEnv,
      template: "ai_usage_quota",
    });
    expect(deliveriesAfterAmbiguousSend).toHaveLength(1);
    expect(deliveriesAfterAmbiguousSend[0]).toMatchObject({
      acceptedAt: null,
      failedAt: expect.any(Date),
      failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
      status: "failed",
      template: "ai_usage_quota",
    });
    expect(deliveriesAfterAmbiguousSend[0]?.idempotencyKey).toEqual(expect.any(String));

    const exhaustedPeriod = await readHostedAiUsageLimitPeriodForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
      periodStart,
    });
    expect(exhaustedPeriod).toMatchObject({
      blockedAt: expect.any(Date),
      limitUsdMicros: 10_000_000n,
    });
    expect(exhaustedPeriod?.spentUsdMicros ?? 0n).toBeGreaterThanOrEqual(
      exhaustedPeriod?.limitUsdMicros ?? 1n,
    );

    const secondReplyBaseline = requireLinqStub().countObservedSends(
      replyPath,
      secondReplyMatcher,
    );
    requireScenario().queueAssistantResponses([secondAssistantReply], {
      matchInputContains: secondInboundText,
    });
    const secondResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_usage_limit_ambiguous_second_${runId}`,
        messageId: `msg_usage_limit_ambiguous_second_${runId}`,
        text: secondInboundText,
      },
    ));
    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });
    const blockedStatus = await requireScenario().waitForLatestPendingWake(userId);
    expect(readConversationMailboxLag(blockedStatus)).not.toBe("0");
    expect(compareMailboxSeq(
      readConversationMailboxMaxSeq(blockedStatus),
      readConversationMailboxMaxSeq(firstCompletedStatus),
    )).toBeGreaterThan(0);

    const finalStatus = await vi.waitFor(async () => {
      const status = await requireScenario().harness.readUserStatus(userId);
      expect(status.inFlight).toBe(false);
      expect(readConversationMailboxLag(status)).not.toBe("0");
      return status;
    }, {
      interval: 250,
      timeout: 30_000,
    });
    const blockedMailboxItem = await readHostedMailboxItemForTest({
      dedupeKey: `evt_usage_limit_ambiguous_second_${runId}`,
      environment: requireScenario().runtimeEnv,
      userId,
    });

    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.inFlight).toBe(false);
    expect(readConversationMailboxLag(finalStatus)).not.toBe("0");
    expect(compareMailboxSeq(
      readConversationMailboxMaxSeq(finalStatus),
      readConversationMailboxMaxSeq(firstCompletedStatus),
    )).toBeGreaterThan(0);
    expect(blockedMailboxItem.consumedAt).toBeNull();
    expect(requireLinqStub().countObservedSends(replyPath, secondReplyMatcher)).toBe(
      secondReplyBaseline,
    );
    expect(requireLinqStub().countObservedSends(replyPath, usageNoticeTextMatcher)).toBe(
      observedTextBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeTextMatcher)).toBe(
      acceptedTextBaseline + 1,
    );
    expect(requireLinqStub().countObservedSends(replyPath, usageNoticeLinkMatcher)).toBe(
      observedBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeLinkMatcher)).toBe(
      acceptedBaseline + 1,
    );
    expect(countAssistantResponseRequests()).toBe(providerBaseline + 1);

    const blockedDeliveries = await listHostedLinqDeliveriesForTest({
      environment: requireScenario().runtimeEnv,
      template: "ai_usage_quota",
    });
    expect(blockedDeliveries).toEqual(deliveriesAfterAmbiguousSend);

    const grant = await grantHostedUsageCreditForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
      purchaseId: `hucp_local_usage_limit_resume_${runId}`,
    });
    expect(grant).toMatchObject({
      balanceUsdMicros: 5_000_000n,
      granted: true,
      ledgerVersion: 1n,
    });
    await expect(readHostedAiUsageLimitPeriodForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
      periodStart,
    })).resolves.toMatchObject({ blockedAt: null });
    await expect(signalHostedRuntimeRecheckRuntimeForTest({
      environment: requireScenario().runtimeEnv,
      userId,
    })).resolves.toMatchObject({ signalAccepted: true });

    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: secondReplyBaseline + 1,
      expectedPath: replyPath,
      matchRequest: secondReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    const resumedStatus = await requireScenario().waitForHostedCompletion(userId);
    const resumedMailboxItem = await readHostedMailboxItemForTest({
      dedupeKey: `evt_usage_limit_ambiguous_second_${runId}`,
      environment: requireScenario().runtimeEnv,
      userId,
    });

    expect(resumedStatus.lastErrorCode ?? null).toBeNull();
    expect(readConversationMailboxLag(resumedStatus)).toBe("0");
    expect(resumedMailboxItem.id).toBe(blockedMailboxItem.id);
    expect(resumedMailboxItem.consumedAt).toEqual(expect.any(String));
    expect(requireLinqStub().countObservedSends(replyPath, secondReplyMatcher)).toBe(
      secondReplyBaseline + 1,
    );
    expect(countAssistantResponseRequests()).toBe(providerBaseline + 2);
    expect(requireLinqStub().countObservedSends(replyPath, usageNoticeTextMatcher)).toBe(
      observedTextBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeTextMatcher)).toBe(
      acceptedTextBaseline + 1,
    );
    expect(requireLinqStub().countObservedSends(replyPath, usageNoticeLinkMatcher)).toBe(
      observedBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeLinkMatcher)).toBe(
      acceptedBaseline + 1,
    );
    await expect(listHostedLinqDeliveriesForTest({
      environment: requireScenario().runtimeEnv,
      template: "ai_usage_quota",
    })).resolves.toEqual(blockedDeliveries);
  }, 420_000);
});

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:usage-limit-ambiguous-e2e`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

function buildCurrentUtcCalendarMonthPeriod(): {
  periodEnd: Date;
  periodStart: Date;
} {
  const now = new Date();
  return {
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

function countAssistantResponseRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  ).length;
}

function readConversationMailboxLane(
  status: HostedRunnerStatusResponse,
): HostedRunnerStatusResponse["mailboxLag"][number] {
  const lane = status.mailboxLag.find((entry) => entry.lane === "conversation");
  if (!lane) {
    throw new Error("Hosted runner status omitted the conversation mailbox lane.");
  }
  return lane;
}

function readConversationMailboxLag(status: HostedRunnerStatusResponse): string {
  return readConversationMailboxLane(status).lag;
}

function readConversationMailboxMaxSeq(status: HostedRunnerStatusResponse): string {
  return readConversationMailboxLane(status).maxSeq;
}

function compareMailboxSeq(left: string, right: string): number {
  const leftSeq = BigInt(left);
  const rightSeq = BigInt(right);
  return leftSeq > rightSeq ? 1 : leftSeq < rightSeq ? -1 : 0;
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return await fetch(
    `${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`,
    {
      body: rawBody,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-webhook-signature": `sha256=${signature}`,
        "x-webhook-timestamp": timestamp,
      },
      method: "POST",
    },
  );
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local usage-limit Linq stub was not initialized.");
  }
  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local usage-limit scenario was not initialized.");
  }
  return scenario;
}
