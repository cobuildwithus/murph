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
const groupOwnerUserId = `member_local_usage_limit_group_owner_${runId}`;
const guestUserId = `guest_local_usage_limit_group_${runId}`;
const chatId = `chat_local_usage_limit_ambiguous_${runId}`;
const groupChatId = `chat_local_usage_limit_group_${runId}`;
const memberPhone = buildLinqRecipientPhoneNumber(userId);
const groupOwnerPhone = buildLinqRecipientPhoneNumber(groupOwnerUserId);
const guestPhone = buildLinqRecipientPhoneNumber(guestUserId);
const linqApiToken = "linq-local-usage-limit-token";
const linqWebhookSecret = "linq-local-usage-limit-webhook-secret";
const assistantModel = "gpt-5.6-terra";
const firstInboundText = "Can you help me plan tomorrow's workout?";
const secondInboundText = "Can you also update the plan for Saturday?";
const firstAssistantReply = "Absolutely — here's a focused plan for tomorrow.";
const secondAssistantReply = "I've updated the Saturday plan too.";
const groupBootstrapText = "Create the group usage backlog fixture.";
const groupBootstrapReply = "The group fixture is ready.";
const groupSecondTurnText = "Add a second group reply context.";
const groupSecondTurnReply = "The second group context is ready.";
const groupBacklogReply = "I caught up with the whole group in one reply.";
const usageLimitNoticeUrl =
  "https://withmurph.ai/settings?usageRecovery=true#subscription";

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
          [memberPhone, groupOwnerPhone, guestPhone].join(","),
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
    await requireScenario().seedActiveHostedLinqMember({
      billingPlanCode: "launch_monthly",
      homePhone: buildLinqHomePhoneNumber(groupOwnerUserId),
      memberId: groupOwnerUserId,
      memberPhone: groupOwnerPhone,
      stripeCustomerId: `cus_local_usage_group_owner_${runId}`,
      stripeSubscriptionId: `sub_local_usage_group_owner_${runId}`,
    });
  }, 300_000);

  it("keeps one durable crossing notice while later over-limit work remains blocked", async () => {
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
      expectedCount: observedBaseline + 2,
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
      observedBaseline + 2,
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
      acceptedAt: expect.any(Date),
      failedAt: null,
      failureCode: null,
      status: "accepted",
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
      observedBaseline + 2,
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
      observedBaseline + 2,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeLinkMatcher)).toBe(
      acceptedBaseline + 1,
    );
    await expect(listHostedLinqDeliveriesForTest({
      environment: requireScenario().runtimeEnv,
      template: "ai_usage_quota",
    })).resolves.toEqual(blockedDeliveries);
  }, 420_000);

  it("releases one multi-sender group backlog as one attributable reply", async () => {
    requireLinqStub().setChatIsGroup(groupChatId, true);

    const groupReplyPath = `/chats/${encodeURIComponent(groupChatId)}/messages`;
    const bootstrapSendBaseline = requireLinqStub().countObservedSends(groupReplyPath);
    requireScenario().queueAssistantResponses([groupBootstrapReply], {
      matchInputContains: groupBootstrapText,
    });
    const bootstrapResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(groupOwnerUserId, groupChatId, {
        eventId: `evt_usage_group_bootstrap_${runId}`,
        isGroup: true,
        messageId: `msg_usage_group_bootstrap_${runId}`,
        service: "iMessage",
        text: groupBootstrapText,
      }),
    );
    expect(bootstrapResponse.status).toBe(202);
    await expect(bootstrapResponse.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });

    const routedState = await vi.waitFor(async () => {
      const state = await requireScenario().readHostedLinqWorkspaceIsolationState({
        chatId: groupChatId,
        memberId: userId,
      });
      expect(state.thread?.containerMemberId).toEqual(expect.any(String));
      return state;
    }, {
      interval: 250,
      timeout: 30_000,
    });
    const containerMemberId = routedState.thread?.containerMemberId;
    if (!containerMemberId) {
      throw new Error("Expected the group route to create a container workspace.");
    }

    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: bootstrapSendBaseline + 1,
      expectedPath: groupReplyPath,
      matchRequest: (request) =>
        requireLinqStub().readObservedMessageText(request) === groupBootstrapReply,
      scenario: requireScenario(),
      userId: containerMemberId,
    });
    await requireScenario().waitForHostedCompletion(containerMemberId);
    const bootstrapReplyMessageId =
      requireAcceptedLinqMessageIdByText(groupChatId, groupBootstrapReply);

    const { periodEnd, periodStart } = buildCurrentUtcCalendarMonthPeriod();
    const secondTurnReplyMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageText(request)
        === groupSecondTurnReply;
    const secondTurnSendBaseline = requireLinqStub().countObservedSends(
      groupReplyPath,
      secondTurnReplyMatcher,
    );
    requireScenario().queueAssistantResponses([groupSecondTurnReply], {
      matchInputContains: groupSecondTurnText,
    });
    const secondTurnResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(groupOwnerUserId, groupChatId, {
        eventId: `evt_usage_group_second_turn_${runId}`,
        isGroup: true,
        messageId: `msg_usage_group_second_turn_${runId}`,
        service: "iMessage",
        text: groupSecondTurnText,
      }),
    );
    expect(secondTurnResponse.status).toBe(202);
    await expect(secondTurnResponse.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: secondTurnSendBaseline + 1,
      expectedPath: groupReplyPath,
      matchRequest: secondTurnReplyMatcher,
      scenario: requireScenario(),
      userId: containerMemberId,
    });
    await requireScenario().waitForHostedIdle(containerMemberId);
    const secondTurnReplyMessageId =
      requireAcceptedLinqMessageIdByText(groupChatId, groupSecondTurnReply);
    await seedHostedAiUsageLimitPeriodForTest({
      environment: requireScenario().runtimeEnv,
      memberId: containerMemberId,
      periodEnd,
      periodStart,
      remainingUsdMicros: 0n,
    });
    await expect(readHostedAiUsageLimitPeriodForTest({
      environment: requireScenario().runtimeEnv,
      memberId: containerMemberId,
      periodStart,
    })).resolves.toMatchObject({
      blockedAt: expect.any(Date),
    });

    const backlogInputs = [
      {
        eventId: `evt_usage_group_backlog_owner_one_${runId}`,
        messageId: `msg_usage_group_backlog_owner_one_${runId}`,
        replyToMessageId: bootstrapReplyMessageId,
        senderUserId: groupOwnerUserId,
        text: `GROUP_BACKLOG_OWNER_ONE_${runId}`,
      },
      {
        eventId: `evt_usage_group_backlog_guest_${runId}`,
        messageId: `msg_usage_group_backlog_guest_${runId}`,
        replyToMessageId: secondTurnReplyMessageId,
        senderUserId: guestUserId,
        text: `GROUP_BACKLOG_GUEST_${runId}`,
      },
      {
        eventId: `evt_usage_group_backlog_owner_two_${runId}`,
        messageId: `msg_usage_group_backlog_owner_two_${runId}`,
        replyToMessageId: secondTurnReplyMessageId,
        senderUserId: groupOwnerUserId,
        text: `GROUP_BACKLOG_OWNER_TWO_${runId}`,
      },
    ] as const;
    const providerBaseline = countAssistantResponseRequests();
    requireScenario().queueAssistantResponses([groupBacklogReply], {
      matchInputContains: backlogInputs.map((input) => input.text),
    });

    for (const input of backlogInputs) {
      const response = await postSignedLinqWebhook(
        buildHostedLinqInboundEvent(input.senderUserId, groupChatId, {
          eventId: input.eventId,
          isGroup: true,
          messageId: input.messageId,
          recipientUserId: groupOwnerUserId,
          replyToMessageId: input.replyToMessageId,
          service: "iMessage",
          text: input.text,
        }),
      );
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      });
    }

    const blockedStatus = await vi.waitFor(async () => {
      const status = await requireScenario().harness.readUserStatus(
        containerMemberId,
      );
      expect(status.inFlight).toBe(false);
      expect(readConversationMailboxLag(status)).not.toBe("0");
      return status;
    }, {
      interval: 250,
      timeout: 30_000,
    });
    expect(blockedStatus.lastErrorCode ?? null).toBeNull();
    expect(countAssistantResponseRequests()).toBe(providerBaseline);
    for (const input of backlogInputs) {
      await expect(readHostedMailboxItemForTest({
        dedupeKey: input.eventId,
        environment: requireScenario().runtimeEnv,
        userId: containerMemberId,
      })).resolves.toMatchObject({
        consumedAt: null,
      });
    }

    const postReleaseSendBaseline =
      requireLinqStub().countObservedSends(groupReplyPath);
    const backlogReplyBaseline = requireLinqStub().countObservedSends(
      groupReplyPath,
      (request) =>
        requireLinqStub().readObservedMessageText(request) === groupBacklogReply,
    );
    await grantHostedUsageCreditForTest({
      environment: requireScenario().runtimeEnv,
      memberId: containerMemberId,
      purchaseId: `hucp_local_usage_group_resume_${runId}`,
    });
    await expect(signalHostedRuntimeRecheckRuntimeForTest({
      environment: requireScenario().runtimeEnv,
      userId: containerMemberId,
    })).resolves.toMatchObject({
      signalAccepted: true,
    });
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: backlogReplyBaseline + 1,
      expectedPath: groupReplyPath,
      matchRequest: (request) =>
        requireLinqStub().readObservedMessageText(request) === groupBacklogReply,
      scenario: requireScenario(),
      userId: containerMemberId,
    });
    const completedStatus = await requireScenario().waitForHostedCompletion(
      containerMemberId,
    );

    expect(completedStatus.lastErrorCode ?? null).toBeNull();
    expect(readConversationMailboxLag(completedStatus)).toBe("0");
    expect(requireLinqStub().countObservedSends(groupReplyPath)).toBe(
      postReleaseSendBaseline + 1,
    );
    const resumedProviderRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(providerBaseline);
    expect(resumedProviderRequests).toHaveLength(1);
    const resumedPrompt = requireJsonStringContainingAll(
      resumedProviderRequests[0]?.body ?? "",
      backlogInputs.map((input) => input.text),
    );
    for (const input of backlogInputs) {
      expect(resumedPrompt).toContain(input.text);
    }
    expect(resumedPrompt).toContain(`Sender: ${groupOwnerPhone}`);
    expect(resumedPrompt).toContain(`Sender: ${guestPhone}`);
    expect(resumedPrompt).toContain(groupBootstrapReply);
    expect(resumedPrompt).toContain(groupSecondTurnReply);
    expect(
      resumedPrompt.match(/Message ref: ain_[0-9a-f]{32}/gu),
    ).toHaveLength(backlogInputs.length);
    for (const input of backlogInputs) {
      await expect(readHostedMailboxItemForTest({
        dedupeKey: input.eventId,
        environment: requireScenario().runtimeEnv,
        userId: containerMemberId,
      })).resolves.toMatchObject({
        consumedAt: expect.any(String),
      });
    }
  }, 600_000);
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

function requireAcceptedLinqMessageIdByText(chatId: string, text: string): string {
  const acceptedGroupSends = requireLinqStub().acceptedSendRequests.filter(
    (request) =>
      request.method === "POST"
      && request.url === `/chats/${encodeURIComponent(chatId)}/messages`,
  );
  const acceptedIndex = acceptedGroupSends.findIndex((request) =>
    requireLinqStub().readObservedMessageText(request) === text
  );
  const messageId = requireLinqStub().listObservedMessageIds(chatId)[acceptedIndex];
  if (acceptedIndex < 0 || !messageId) {
    throw new Error(`Missing accepted Linq message id for ${text}.`);
  }
  return messageId;
}

function requireJsonStringContainingAll(
  jsonText: string,
  expectedValues: readonly string[],
): string {
  const parsed: unknown = JSON.parse(jsonText);
  const candidates = collectJsonStrings(parsed)
    .filter((value) => expectedValues.every((expected) => value.includes(expected)))
    .sort((left, right) => left.length - right.length);
  const [candidate] = candidates;
  if (!candidate) {
    throw new Error("Assistant provider request omitted the compound group prompt.");
  }
  return candidate;
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectJsonStrings);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectJsonStrings);
  }
  return [];
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
