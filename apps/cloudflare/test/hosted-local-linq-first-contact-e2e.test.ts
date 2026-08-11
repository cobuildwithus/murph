import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readHostedMailboxItemForTest,
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
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
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  createIntegratedVaultServices,
} from "@murphai/vault-usecases/vault-services";

import {
  buildAssistantProviderMurphToolCall,
  buildStableNumericSuffix,
  expectAdvertisedMurphDynamicTools,
  type HostedLocalAssistantProviderScriptedResponse,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  ensureProcessingAfterSyntheticMailboxAppendForTest,
} from "./helpers/hosted-local-wake.js";
import {
  buildHostedLinqSignupWelcomeWake,
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT,
  HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
  HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT,
  startHostedLocalLinqStub,
  type ObservedLinqRequest,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const userId = `member_local_linq_first_contact_${Date.now()}`;
const directReplyUserId = `member_local_linq_direct_reply_${Date.now()}`;
const richLinkLostAckUserId = `member_local_linq_link_lost_ack_${Date.now()}`;
const richLinkRetryRecoveryUserId = `member_local_linq_link_retry_recovery_${Date.now()}`;
const richLinkFallbackUserId = `member_local_linq_link_fallback_${Date.now()}`;
const duplicateWelcomeUserId = `member_local_linq_duplicate_welcome_${Date.now()}`;
const fastReplyUserId = `member_local_linq_fast_reply_${Date.now()}`;
const progressToolUserId = `member_local_linq_progress_tool_${Date.now()}`;
const postAssistantReplyUserId = `member_local_linq_post_assistant_reply_${Date.now()}`;
const checkpointReplayUserId = `member_local_linq_checkpoint_replay_${Date.now()}`;
const typingLoopUserId = `member_local_linq_typing_loop_${Date.now()}`;
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-webhook-secret";
const signupFollowupQuestionText =
  "What's your name? And if you're comfortable sharing, your age and whether you're a guy or girl.";
const postAssistantReplyAffirmativeText = "yes lets do it rocket fixture";
const checkpointReplayReplyText = "Yes - I can help with that.";
const progressToolAttemptText = "Checking the current iMessage thread now.";
const progressToolFinalReplyText = "I checked that and can keep helping from here.";
const typingLoopReplyText = "I saw that and can help from here.";
const richLinkLostAckUrl = "https://example.test/continue/lost-ack";
const richLinkRetryRecoveryUrl = "https://example.test/continue/recovered";
const richLinkFallbackUrl = "https://example.test/continue/fallback";
const productionLikeAssistantModel = "gpt-5.6-terra";
const localRunnerIdleTtlMs = "300000";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const fastDeployGate = process.env.MURPH_HOSTED_LOCAL_E2E_FAST_GATE === "1";
const testControlsEnabled = process.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS === "1";
const productionDescribe = testControlsEnabled ? describe.skip : describe;
const testControlsDescribe = testControlsEnabled ? describe : describe.skip;
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const itOutsideFastDeployGate = fastDeployGate ? it.skip : it;
const itCheckpointReplayRepro =
  process.env.MURPH_HOSTED_LOCAL_LINQ_REPLAY_REPRO === "1"
    ? itOutsideFastDeployGate
    : it.skip;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
const cleanupPaths: string[] = [];

function buildHostedAssistantProgressAttemptResponses(input: {
  progressText: string;
  text: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderMurphToolCall("send_progress_update", {
      text: input.progressText,
    }),
    input.text,
  ];
}

afterAll(async () => {
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

it("derives stable numeric suffixes from the full Linq user id", () => {
  expect(buildStableNumericSuffix("member_local_linq_first_contact_20260408", 7)).not.toBe(
    buildStableNumericSuffix("member_local_linq_direct_reply_20260408", 7),
  );
});

productionDescribe("hosted local Linq first-contact e2e", () => {
  beforeAll(async () => {
    await ensureLinqScenario();
  }, 300_000);

  it("sends the first-contact Linq welcome through the live local worker", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `member.activated:local:${userId}:evt_linq_first_contact`,
        userId,
      }),
      userId,
    );
    const sendRequestPromise = requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
      scenario: requireScenario(),
      userId,
    });

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.workspace).not.toBeNull();
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const sendRequest = await sendRequestPromise;
    expect(requireLinqStub().requireObservedChatId(userId)).toEqual(expect.any(String));
    expect(sendRequest.method).toBe("POST");
    expect(sendRequest.url).toBe(requireLinqStub().createChatPath);
    expect(JSON.parse(sendRequest.body)).toMatchObject({
      from: buildLinqHomePhoneNumber(userId),
      message: {
        idempotency_key: `signup-welcome:${userId}`,
        parts: [
          {
            type: "text",
            value: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
          },
        ],
      },
      to: [buildLinqRecipientPhoneNumber(userId)],
    });
  }, 300_000);

  it("sends a Linq reply after a later inbound Linq message", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(directReplyUserId),
      memberId: directReplyUserId,
      memberPhone: buildLinqRecipientPhoneNumber(directReplyUserId),
    });
    await requireScenario().runWake(
      buildActivationWake(directReplyUserId),
      directReplyUserId,
    );
    await requireScenario().waitForHostedCompletion(directReplyUserId);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId:
          `member.activated:local:${directReplyUserId}:evt_linq_direct_reply`,
        userId: directReplyUserId,
      }),
      directReplyUserId,
    );
    const welcomeSendPromise = requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(directReplyUserId),
      scenario: requireScenario(),
      userId: directReplyUserId,
    });
    await requireScenario().waitForHostedCompletion(directReplyUserId);
    await welcomeSendPromise;

    const materializedChatId = requireLinqStub().requireObservedChatId(directReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const expectedTypingPath = `/chats/${encodeURIComponent(materializedChatId)}/typing`;
    const observedMessageIdsBeforeReply =
      requireLinqStub().listObservedMessageIds(materializedChatId).length;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    const requestCountBeforeReply = requireLinqStub().observedRequests.length;
    requireScenario().queueAssistantResponses([HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT], {
      matchInputContains: "hello mate",
    });
    const directReplyEventId = `evt_direct_reply_${directReplyUserId}`;
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      directReplyUserId,
      materializedChatId,
      {
        eventId: directReplyEventId,
        messageId: `msg_direct_reply_${directReplyUserId}`,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(directReplyUserId);
    const completionPromise = requireScenario()
      .waitForHostedCompletion(directReplyUserId);
    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId: directReplyUserId,
    });
    const requestsAfterInbound = requireLinqStub().observedRequests.slice(requestCountBeforeReply);
    const typingRequestsAfterInbound = requestsAfterInbound.filter((request) =>
      request.method === "POST" && request.url === expectedTypingPath
    );
    expect(replySend.method).toBe("POST");
    expect(typingRequestsAfterInbound.length).toBeGreaterThanOrEqual(1);

    const sendIndex = requestsAfterInbound.indexOf(replySend);
    const typingIndices = typingRequestsAfterInbound.map((request) =>
      requestsAfterInbound.indexOf(request)
    );

    expect(sendIndex).toBeGreaterThanOrEqual(0);
    expect(typingIndices[0]).toBeGreaterThanOrEqual(0);
    expect(sendIndex).toBeGreaterThan(typingIndices[0]);
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT,
    );
    const outboundReplyMessageId =
      requireLinqStub().listObservedMessageIds(materializedChatId)[observedMessageIdsBeforeReply] ?? null;
    expect(outboundReplyMessageId).not.toBeNull();
    const finalStatus = await completionPromise;
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expectAdvertisedMurphDynamicTools(requireScenario().assistantProviderRequests, {
      computerToolsAvailable: true,
      connectedAppsAvailable: true,
      messageTargetingAvailable: true,
      pendingVaultFilesAvailable: true,
      phoneCallsAvailable: true,
      progressUpdatesAvailable: true,
      responseCardAvailable: true,
      vaultFileSendAvailable: true,
    });
    await requireLinqStub().waitForMatchingRequestCount({
      expectedCount: 1,
      expectedMethod: "DELETE",
      expectedPath: `/messages/${encodeURIComponent(`msg_direct_reply_${directReplyUserId}`)}`,
      scenario: requireScenario(),
      userId: directReplyUserId,
    });
    await requireLinqStub().waitForMatchingRequestCount({
      expectedCount: 1,
      expectedMethod: "DELETE",
      expectedPath: `/messages/${encodeURIComponent(outboundReplyMessageId!)}`,
      scenario: requireScenario(),
      userId: directReplyUserId,
    });

    // Recreate the old late-handoff path after exactly one accepted reply.
    // Depending on whether the existing runner child has cleared before the
    // late ensure arrives, the control plane can start or wake processing. Both
    // accepted paths must quiesce without another model turn or Linq send.
    const assistantProviderResponseCountAfterReply =
      countAssistantProviderResponsesApiRequests();
    const answeredMailboxItem = await readHostedMailboxItemForTest({
      dedupeKey: directReplyEventId,
      environment: requireScenario().runtimeEnv,
      userId: directReplyUserId,
    });
    expect(answeredMailboxItem.consumedAt).not.toBeNull();
    const lateEnsure = await ensureProcessingAfterSyntheticMailboxAppendForTest({
      harness: requireScenario().harness,
      userId: directReplyUserId,
    });
    expect(lateEnsure.kind).toBe("runtime_processing_accepted");
    const quiescentStatus = await requireScenario().waitForHostedIdle(
      directReplyUserId,
    );
    expect(quiescentStatus.lastErrorCode ?? null).toBeNull();
    expect(quiescentStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(countAssistantProviderResponsesApiRequests()).toBe(
      assistantProviderResponseCountAfterReply,
    );
    expect(requireLinqStub().countObservedSends(expectedDirectReplyChatPath)).toBe(
      outboundCountBeforeReply + 1,
    );
  }, 300_000);

  it("reconciles a lost rich-link acknowledgment without replaying assistant text", async () => {
    const chatId = `chat_local_linq_link_lost_ack_${Date.now()}`;
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const primaryText = "Continue here:";
    const eventId = `evt_linq_link_lost_ack_${richLinkLostAckUserId}`;
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(richLinkLostAckUserId),
      memberId: richLinkLostAckUserId,
      memberPhone: buildLinqRecipientPhoneNumber(richLinkLostAckUserId),
    });
    await requireScenario().runWake(
      buildActivationWake(richLinkLostAckUserId),
      richLinkLostAckUserId,
    );
    await requireScenario().waitForHostedCompletion(richLinkLostAckUserId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: richLinkLostAckUserId,
      recipientPhone: buildLinqRecipientPhoneNumber(richLinkLostAckUserId),
    });

    const primaryMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageText(request) === primaryText;
    const linkMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageLink(request) === richLinkLostAckUrl;
    const primaryBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      primaryMatcher,
    );
    const observedLinkBaseline = requireLinqStub().countObservedSends(
      replyPath,
      linkMatcher,
    );
    const acceptedLinkBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      linkMatcher,
    );
    const providerBaseline = countAssistantProviderResponsesApiRequests();
    requireLinqStub().armNextPostAcceptLostAcknowledgment({
      expectedPath: replyPath,
      matchRequest: linkMatcher,
      responseCount: 1,
    });
    requireScenario().queueAssistantResponses([
      `${primaryText}\n${richLinkLostAckUrl}`,
    ], {
      matchInputContains: "Give me the lost acknowledgment link",
    });

    const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      richLinkLostAckUserId,
      chatId,
      {
        eventId,
        messageId: `msg_${eventId}`,
        text: "Give me the lost acknowledgment link.",
      },
    ));
    expect(response.status).toBe(202);
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: primaryBaseline + 1,
      expectedPath: replyPath,
      matchRequest: primaryMatcher,
      scenario: requireScenario(),
      userId: richLinkLostAckUserId,
    });
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: observedLinkBaseline + 2,
      expectedPath: replyPath,
      matchRequest: linkMatcher,
      scenario: requireScenario(),
      userId: richLinkLostAckUserId,
    });
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedLinkBaseline + 1,
      expectedPath: replyPath,
      matchRequest: linkMatcher,
      scenario: requireScenario(),
      userId: richLinkLostAckUserId,
    });
    const completed = await requireScenario().waitForHostedCompletion(
      richLinkLostAckUserId,
    );
    expect(completed.lastErrorCode ?? null).toBeNull();
    expect(completed.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(countAssistantProviderResponsesApiRequests()).toBe(providerBaseline + 1);
    await expect(readHostedMailboxItemForTest({
      dedupeKey: eventId,
      environment: requireScenario().runtimeEnv,
      userId: richLinkLostAckUserId,
    })).resolves.toMatchObject({
      consumedAt: expect.any(String),
    });

    const lateEnsure = await ensureProcessingAfterSyntheticMailboxAppendForTest({
      harness: requireScenario().harness,
      userId: richLinkLostAckUserId,
    });
    expect(lateEnsure.kind).toBe("runtime_processing_accepted");
    await requireScenario().waitForHostedIdle(richLinkLostAckUserId);
    expect(countAssistantProviderResponsesApiRequests()).toBe(providerBaseline + 1);
    expect(requireLinqStub().countAcceptedSends(replyPath, primaryMatcher)).toBe(
      primaryBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, linkMatcher)).toBe(
      acceptedLinkBaseline + 1,
    );
  }, 300_000);

  it("falls back to URL text after a definitive rich-link rejection", async () => {
    const chatId = `chat_local_linq_link_fallback_${Date.now()}`;
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const primaryText = "Finish setup here:";
    const eventId = `evt_linq_link_fallback_${richLinkFallbackUserId}`;
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(richLinkFallbackUserId),
      memberId: richLinkFallbackUserId,
      memberPhone: buildLinqRecipientPhoneNumber(richLinkFallbackUserId),
    });
    await requireScenario().runWake(
      buildActivationWake(richLinkFallbackUserId),
      richLinkFallbackUserId,
    );
    await requireScenario().waitForHostedCompletion(richLinkFallbackUserId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: richLinkFallbackUserId,
      recipientPhone: buildLinqRecipientPhoneNumber(richLinkFallbackUserId),
    });

    const primaryMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageText(request) === primaryText;
    const linkMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageLink(request) === richLinkFallbackUrl;
    const fallbackMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageText(request) === richLinkFallbackUrl;
    const primaryBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      primaryMatcher,
    );
    const linkBaseline = requireLinqStub().countObservedSends(replyPath, linkMatcher);
    const fallbackBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      fallbackMatcher,
    );
    const providerBaseline = countAssistantProviderResponsesApiRequests();
    requireLinqStub().armNextPreAcceptDefinitiveSendFailure({
      expectedPath: replyPath,
      matchRequest: linkMatcher,
    });
    requireScenario().queueAssistantResponses([
      `${primaryText}\n${richLinkFallbackUrl}`,
    ], {
      matchInputContains: "Give me the fallback link",
    });

    const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      richLinkFallbackUserId,
      chatId,
      {
        eventId,
        messageId: `msg_${eventId}`,
        text: "Give me the fallback link.",
      },
    ));
    expect(response.status).toBe(202);
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: primaryBaseline + 1,
      expectedPath: replyPath,
      matchRequest: primaryMatcher,
      scenario: requireScenario(),
      userId: richLinkFallbackUserId,
    });
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: linkBaseline + 1,
      expectedPath: replyPath,
      matchRequest: linkMatcher,
      scenario: requireScenario(),
      userId: richLinkFallbackUserId,
    });
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: fallbackBaseline + 1,
      expectedPath: replyPath,
      matchRequest: fallbackMatcher,
      scenario: requireScenario(),
      userId: richLinkFallbackUserId,
    });
    const completed = await requireScenario().waitForHostedCompletion(
      richLinkFallbackUserId,
    );
    expect(completed.lastErrorCode ?? null).toBeNull();
    expect(completed.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(countAssistantProviderResponsesApiRequests()).toBe(providerBaseline + 1);
    await expect(readHostedMailboxItemForTest({
      dedupeKey: eventId,
      environment: requireScenario().runtimeEnv,
      userId: richLinkFallbackUserId,
    })).resolves.toMatchObject({
      consumedAt: expect.any(String),
    });
  }, 300_000);

  it("recovers a pre-accept rich-link transport failure without replaying assistant text", async () => {
    const chatId = `chat_local_linq_link_retry_recovery_${Date.now()}`;
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const primaryText = "Continue after confirmation:";
    const eventId = `evt_linq_link_retry_recovery_${richLinkRetryRecoveryUserId}`;
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(richLinkRetryRecoveryUserId),
      memberId: richLinkRetryRecoveryUserId,
      memberPhone: buildLinqRecipientPhoneNumber(richLinkRetryRecoveryUserId),
    });
    await requireScenario().runWake(
      buildActivationWake(richLinkRetryRecoveryUserId),
      richLinkRetryRecoveryUserId,
    );
    await requireScenario().waitForHostedCompletion(richLinkRetryRecoveryUserId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: richLinkRetryRecoveryUserId,
      recipientPhone: buildLinqRecipientPhoneNumber(richLinkRetryRecoveryUserId),
    });

    const primaryMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageText(request) === primaryText;
    const linkMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageLink(request) === richLinkRetryRecoveryUrl;
    const primaryBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      primaryMatcher,
    );
    const observedLinkBaseline = requireLinqStub().countObservedSends(
      replyPath,
      linkMatcher,
    );
    const acceptedLinkBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      linkMatcher,
    );
    const providerBaseline = countAssistantProviderResponsesApiRequests();
    requireLinqStub().armNextPreAcceptRetryableSendFailure({
      expectedPath: replyPath,
      matchRequest: linkMatcher,
    });
    requireScenario().queueAssistantResponses([
      `${primaryText}\n${richLinkRetryRecoveryUrl}`,
    ], {
      matchInputContains: "Give me the recovery link",
    });

    const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      richLinkRetryRecoveryUserId,
      chatId,
      {
        eventId,
        messageId: `msg_${eventId}`,
        text: "Give me the recovery link.",
      },
    ));
    expect(response.status).toBe(202);
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: primaryBaseline + 1,
      expectedPath: replyPath,
      matchRequest: primaryMatcher,
      scenario: requireScenario(),
      userId: richLinkRetryRecoveryUserId,
    });
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: observedLinkBaseline + 3,
      expectedPath: replyPath,
      matchRequest: linkMatcher,
      scenario: requireScenario(),
      userId: richLinkRetryRecoveryUserId,
    });
    expect(requireLinqStub().countAcceptedSends(replyPath, linkMatcher)).toBe(
      acceptedLinkBaseline,
    );
    await expect(readHostedMailboxItemForTest({
      dedupeKey: eventId,
      environment: requireScenario().runtimeEnv,
      userId: richLinkRetryRecoveryUserId,
    })).resolves.toMatchObject({
      consumedAt: null,
    });

    const retryEnsure = await ensureProcessingAfterSyntheticMailboxAppendForTest({
      harness: requireScenario().harness,
      userId: richLinkRetryRecoveryUserId,
    });
    expect(retryEnsure.kind).toBe("runtime_processing_accepted");
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedLinkBaseline + 1,
      expectedPath: replyPath,
      matchRequest: linkMatcher,
      scenario: requireScenario(),
      userId: richLinkRetryRecoveryUserId,
    });
    const completed = await requireScenario().waitForHostedCompletion(
      richLinkRetryRecoveryUserId,
    );
    expect(completed.lastErrorCode ?? null).toBeNull();
    expect(completed.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(countAssistantProviderResponsesApiRequests()).toBe(providerBaseline + 1);
    expect(requireLinqStub().countAcceptedSends(replyPath, primaryMatcher)).toBe(
      primaryBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, linkMatcher)).toBe(
      acceptedLinkBaseline + 1,
    );
    await expect(readHostedMailboxItemForTest({
      dedupeKey: eventId,
      environment: requireScenario().runtimeEnv,
      userId: richLinkRetryRecoveryUserId,
    })).resolves.toMatchObject({
      consumedAt: expect.any(String),
    });

    const lateEnsure = await ensureProcessingAfterSyntheticMailboxAppendForTest({
      harness: requireScenario().harness,
      userId: richLinkRetryRecoveryUserId,
    });
    expect(lateEnsure.kind).toBe("runtime_processing_accepted");
    await requireScenario().waitForHostedIdle(richLinkRetryRecoveryUserId);
    expect(countAssistantProviderResponsesApiRequests()).toBe(providerBaseline + 1);
    expect(requireLinqStub().countAcceptedSends(replyPath, primaryMatcher)).toBe(
      primaryBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, linkMatcher)).toBe(
      acceptedLinkBaseline + 1,
    );
  }, 300_000);

  // Hosted turns dispatch final replies queue-only through the outbox, but an
  // auto-reply turn has a member actively waiting, so model-authored progress
  // updates deliver immediately as ephemeral sends ahead of the final reply.
  it("delivers model-authored progress updates from hosted queue-only Linq auto-replies", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(progressToolUserId),
      memberId: progressToolUserId,
      memberPhone: buildLinqRecipientPhoneNumber(progressToolUserId),
    });
    await requireScenario().runWake(
      buildActivationWake(progressToolUserId),
      progressToolUserId,
    );
    await requireScenario().waitForHostedCompletion(progressToolUserId);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId:
          `member.activated:local:${progressToolUserId}:evt_linq_progress_tool`,
        userId: progressToolUserId,
      }),
      progressToolUserId,
    );
    const welcomeSendPromise = requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(progressToolUserId),
      scenario: requireScenario(),
      userId: progressToolUserId,
    });
    await requireScenario().waitForHostedCompletion(progressToolUserId);
    await welcomeSendPromise;

    const materializedChatId = requireLinqStub().requireObservedChatId(progressToolUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply =
      requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    requireScenario().queueAssistantResponses(
      buildHostedAssistantProgressAttemptResponses({
        progressText: progressToolAttemptText,
        text: progressToolFinalReplyText,
      }),
      { matchInputContains: "Can you check this thread?" },
    );

    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      progressToolUserId,
      materializedChatId,
      {
        eventId: `evt_progress_tool_${progressToolUserId}`,
        messageId: `msg_progress_tool_${progressToolUserId}`,
        text: "Can you check this thread?",
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(progressToolUserId);
    const completionPromise = requireScenario()
      .waitForHostedCompletion(progressToolUserId);
    const matchingSends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundCountBeforeReply + 2,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId: progressToolUserId,
    });
    const newSendTexts = matchingSends
      .slice(outboundCountBeforeReply)
      .map((request) => requireLinqStub().readObservedMessageText(request));
    expect(
      matchingSends
        .slice(outboundCountBeforeReply)
        .map((request) => request.authorizationStatus),
    ).toEqual(["hosted-sentinel", "hosted-sentinel"]);
    expect(newSendTexts).toEqual([
      progressToolAttemptText,
      progressToolFinalReplyText,
    ]);

    const finalStatus = await completionPromise;
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(requireLinqStub().countObservedSends(expectedDirectReplyChatPath)).toBe(
      outboundCountBeforeReply + 2,
    );
  }, 300_000);

  itOutsideFastDeployGate(
    "does not repeat the signup welcome after the first inbound Linq greeting",
    async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(duplicateWelcomeUserId),
      memberId: duplicateWelcomeUserId,
      memberPhone: buildLinqRecipientPhoneNumber(duplicateWelcomeUserId),
    });
    await requireScenario().runWake(
      buildActivationWake(duplicateWelcomeUserId),
      duplicateWelcomeUserId,
    );
    await requireScenario().waitForHostedCompletion(duplicateWelcomeUserId);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId:
          `member.activated:local:${duplicateWelcomeUserId}:evt_linq_duplicate_welcome`,
        userId: duplicateWelcomeUserId,
      }),
      duplicateWelcomeUserId,
    );

    const createChatRequest = await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(duplicateWelcomeUserId),
      scenario: requireScenario(),
      userId: duplicateWelcomeUserId,
    });
    expect(createChatRequest.method).toBe("POST");
    expect(requireLinqStub().readObservedMessageText(createChatRequest)).toBe(
      MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
    );
    await requireScenario().waitForHostedCompletion(duplicateWelcomeUserId);

    const materializedChatId = requireLinqStub().requireObservedChatId(duplicateWelcomeUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply =
      requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    const assistantProviderResponseCountBefore =
      countAssistantProviderResponsesApiRequests();
    requireScenario().queueAssistantResponses([signupFollowupQuestionText], {
      matchInputContains: "Hey mate yea",
    });

    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      duplicateWelcomeUserId,
      materializedChatId,
      {
        eventId: `evt_duplicate_welcome_${duplicateWelcomeUserId}`,
        messageId: `msg_duplicate_welcome_${duplicateWelcomeUserId}`,
        text: "Hey mate yea",
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(duplicateWelcomeUserId);
    const followupQuestionSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId: duplicateWelcomeUserId,
    });
    expect(requireLinqStub().readObservedMessageText(followupQuestionSend)).toBe(
      signupFollowupQuestionText,
    );
    expect(requireLinqStub().countObservedSends(expectedDirectReplyChatPath)).toBe(
      outboundCountBeforeReply + 1,
    );
    expect(
      requireLinqStub().countObservedSends(
        requireLinqStub().createChatPath,
        requireLinqStub().createCreateChatRequestMatcher(duplicateWelcomeUserId),
      ),
    ).toBe(1);

    const assistantProviderResponseRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(assistantProviderResponseCountBefore);
    expect(assistantProviderResponseRequests.length).toBeGreaterThanOrEqual(1);

    const firstInboundPromptText = assistantProviderResponseRequests
      .map(readAssistantProviderRequestText)
      .find((text) => text.includes("Message text:\nHey mate yea"));
    if (!firstInboundPromptText) {
      throw new Error("Expected the first inbound Linq prompt to include the latest user message.");
    }
    const inboundPromptText = firstInboundPromptText;
    expect(inboundPromptText).toContain("Murph onboarding:");
    expect(inboundPromptText).toContain(
      "$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md",
    );
    expect(inboundPromptText).toContain("User message:\nSource: linq");
    },
    300_000,
  );

  itOutsideFastDeployGate(
    "keeps Linq context when two messages arrive before hosted completion catches up",
    async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(fastReplyUserId),
      memberId: fastReplyUserId,
      memberPhone: buildLinqRecipientPhoneNumber(fastReplyUserId),
    });
    await requireScenario().runWake(buildActivationWake(fastReplyUserId), fastReplyUserId);
    await requireScenario().waitForHostedCompletion(fastReplyUserId);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `member.activated:local:${fastReplyUserId}:evt_linq_fast_reply`,
        userId: fastReplyUserId,
      }),
      fastReplyUserId,
    );

    const createChatRequest = await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(fastReplyUserId),
      scenario: requireScenario(),
      userId: fastReplyUserId,
    });
    expect(createChatRequest.method).toBe("POST");
    await requireScenario().waitForHostedCompletion(fastReplyUserId);

    const materializedChatId = requireLinqStub().requireObservedChatId(fastReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    const nameText = "U can call me Rocket Man";
    const goalsText = "I want to build more strength, improve endurance, and get fitter overall.";
    const groupedReplyMatcher = (request: ObservedLinqRequest) =>
      requireLinqStub().readObservedMessageText(request) ===
        HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT;
    const groupedReplyCountBefore = requireLinqStub().countObservedSends(
      expectedDirectReplyChatPath,
      groupedReplyMatcher,
    );

    requireScenario().queueAssistantResponses([
      {
        matchInputContains: nameText,
        response: HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT,
      },
      {
        matchInputContains: goalsText,
        response: HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
      },
    ]);
    const firstWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      fastReplyUserId,
      materializedChatId,
      {
        eventId: `evt_fast_reply_name_${fastReplyUserId}`,
        messageId: `msg_fast_name_${fastReplyUserId}`,
        text: nameText,
      },
    ));
    const secondWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      fastReplyUserId,
      materializedChatId,
      {
        eventId: `evt_fast_reply_goals_${fastReplyUserId}`,
        messageId: `msg_fast_goals_${fastReplyUserId}`,
        text: goalsText,
      },
    ));
    expect(firstWebhookResponse.status).toBe(202);
    await expect(firstWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(secondWebhookResponse.status).toBe(202);
    await expect(secondWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const statusBeforeWait = await requireScenario().harness.readUserStatus(fastReplyUserId);
    await requireScenario().waitForLatestPendingWake(fastReplyUserId);
    await requireScenario().waitForHostedCompletion(fastReplyUserId);
    const statusAfterWait = await requireScenario().harness.readUserStatus(fastReplyUserId);

    await requireLinqStub().waitForAdditionalSend({
      baselineCount: groupedReplyCountBefore,
      expectedPath: expectedDirectReplyChatPath,
      matchRequest: groupedReplyMatcher,
      scenario: requireScenario(),
      userId: fastReplyUserId,
    });
    const createChatRequests = requireLinqStub().observedRequests.filter((request) =>
      request.url === requireLinqStub().createChatPath
      && requireLinqStub().createCreateChatRequestMatcher(fastReplyUserId)(request)
    );
    if (createChatRequests.length !== 1) {
      throw new Error(
        `Expected exactly one Linq chat materialization for ${fastReplyUserId}, saw ${
          createChatRequests.length
        }: ${JSON.stringify({
          createChatRequests: createChatRequests.map((request) => ({
            text: requireLinqStub().readObservedMessageText(request),
            url: request.url,
          })),
          statusAfterWait,
          statusBeforeWait,
        })}`,
      );
    }

    const newReplySends = requireLinqStub().observedRequests.filter((request) =>
      request.method === "POST" && request.url === expectedDirectReplyChatPath
    ).slice(outboundCountBeforeReply);
    const newReplyTexts = newReplySends.map((request) =>
      requireLinqStub().readObservedMessageText(request)
    );
    expect(newReplyTexts).toContain(HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT);
    expect(newReplyTexts.every((text) =>
      text === HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT
      || text === HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT
    )).toBe(true);
    expect(newReplyTexts.length).toBeLessThanOrEqual(2);
    },
    300_000,
  );

  itOutsideFastDeployGate(
    "keeps replying when the member answers again immediately after the assistant reply",
    async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(postAssistantReplyUserId),
      memberId: postAssistantReplyUserId,
      memberPhone: buildLinqRecipientPhoneNumber(postAssistantReplyUserId),
    });
    await requireScenario().runWake(
      buildActivationWake(postAssistantReplyUserId),
      postAssistantReplyUserId,
    );
    await requireScenario().waitForHostedCompletion(postAssistantReplyUserId);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId:
          `member.activated:local:${postAssistantReplyUserId}:evt_linq_post_assistant_reply`,
        userId: postAssistantReplyUserId,
      }),
      postAssistantReplyUserId,
    );

    const createChatRequest = await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(postAssistantReplyUserId),
      scenario: requireScenario(),
      userId: postAssistantReplyUserId,
    });
    expect(createChatRequest.method).toBe("POST");
    await requireScenario().waitForHostedCompletion(postAssistantReplyUserId);

    const materializedChatId = requireLinqStub().requireObservedChatId(postAssistantReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const expectedTypingPath = `/chats/${encodeURIComponent(materializedChatId)}/typing`;
    const outboundCountBeforeFirstReply =
      requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    const assistantProviderResponseCountBefore =
      countAssistantProviderResponsesApiRequests();
    const assistantQuestionText =
      "What's your name? And if you're comfortable sharing, your age and whether you're a guy or girl.";
    const assistantSecondReplyText =
      "Got it. I will remember that and we can work from those goals.";
    requireScenario().queueAssistantResponses([assistantQuestionText], {
      matchInputContains: postAssistantReplyAffirmativeText,
    });
    requireScenario().queueAssistantResponses([assistantSecondReplyText], {
      matchInputContains:
        "You can call me River. I want to build strength, improve cholesterol, sleep better, and have more energy.",
    });

    const firstWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      postAssistantReplyUserId,
      materializedChatId,
      {
        eventId: `evt_post_assistant_reply_yes_${postAssistantReplyUserId}`,
        messageId: `msg_post_assistant_reply_yes_${postAssistantReplyUserId}`,
        text: postAssistantReplyAffirmativeText,
      },
    ));
    expect(firstWebhookResponse.status).toBe(202);
    await expect(firstWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(postAssistantReplyUserId);
    const firstReplySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeFirstReply,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId: postAssistantReplyUserId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReplySend)).toBe(
      assistantQuestionText,
    );

    const outboundCountBeforeSecondReply =
      requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    const requestCountBeforeSecondReply = requireLinqStub().observedRequests.length;
    const secondWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      postAssistantReplyUserId,
      materializedChatId,
      {
        eventId: `evt_post_assistant_reply_goals_${postAssistantReplyUserId}`,
        messageId: `msg_post_assistant_reply_goals_${postAssistantReplyUserId}`,
        text:
          "You can call me River. I want to build strength, improve cholesterol, sleep better, and have more energy.",
      },
    ));
    expect(secondWebhookResponse.status).toBe(202);
    await expect(secondWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(postAssistantReplyUserId);
    const finalStatus = await requireScenario().waitForHostedCompletion(
      postAssistantReplyUserId,
    );
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const secondReplySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeSecondReply,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId: postAssistantReplyUserId,
    });
    expect(requireLinqStub().readObservedMessageText(secondReplySend)).toBe(
      assistantSecondReplyText,
    );
    const requestsAfterSecondInbound =
      requireLinqStub().observedRequests.slice(requestCountBeforeSecondReply);
    const secondReplyTypingStarts = requestsAfterSecondInbound.filter((request) =>
      request.method === "POST" && request.url === expectedTypingPath
    );
    expect(secondReplyTypingStarts.length).toBeGreaterThanOrEqual(1);

    const secondReplySendIndex = requestsAfterSecondInbound.indexOf(secondReplySend);
    const secondReplyTypingStartIndex = requestsAfterSecondInbound.indexOf(
      secondReplyTypingStarts[0]!,
    );
    expect(secondReplySendIndex).toBeGreaterThanOrEqual(0);
    expect(secondReplyTypingStartIndex).toBeGreaterThanOrEqual(0);
    expect(secondReplySendIndex).toBeGreaterThan(secondReplyTypingStartIndex);

    expect(requireScenario().runtimeEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "stub-local-openai-key",
    });
    expect(requireScenario().runtimeEnv.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(requireScenario().runtimeEnv.HOSTED_ASSISTANT_BASE_URL).toBeUndefined();
    expect(requireScenario().runtimeEnv.HOSTED_ASSISTANT_PROVIDER_NAME).toBeUndefined();
    const assistantProviderResponseRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(assistantProviderResponseCountBefore);
    expect(assistantProviderResponseRequests).toHaveLength(2);
    expect(assistantProviderResponseRequests.every((request) =>
      request.method === "POST"
    )).toBe(true);
    },
    300_000,
  );

});

testControlsDescribe("hosted local Linq checkpoint replay e2e", () => {
  beforeAll(async () => {
    await ensureLinqScenario();
  }, 300_000);

  itCheckpointReplayRepro(
    "reproduces duplicate visible Linq sends when replay groups change after a lost receipt checkpoint",
    async () => {
      const materializedChatId = `chat_local_linq_checkpoint_replay_${Date.now()}`;
      const memberPhone = buildLinqRecipientPhoneNumber(checkpointReplayUserId);
      const homePhone = buildLinqHomePhoneNumber(checkpointReplayUserId);
      const replyPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;

      await requireScenario().seedActiveHostedLinqMember({
        homePhone,
        memberId: checkpointReplayUserId,
        memberPhone,
      });
      await requireScenario().bindActiveHostedLinqHomeChat({
        chatId: materializedChatId,
        memberId: checkpointReplayUserId,
        recipientPhone: memberPhone,
      });
      await seedEmptyHostedWorkspaceCheckpointForTest(
        checkpointReplayUserId,
        "checkpoint-replay-before-first-send",
      );

      const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
      requireScenario().queueAssistantResponses([checkpointReplayReplyText], {
        matchInputContains: "Can you help me with this?",
      });
      const firstWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
        checkpointReplayUserId,
        materializedChatId,
        {
          eventId: `evt_checkpoint_replay_first_${checkpointReplayUserId}`,
          messageId: `msg_checkpoint_replay_first_${checkpointReplayUserId}`,
          text: "Can you help me with this?",
        },
      ));
      expect(firstWebhookResponse.status).toBe(202);
      await expect(firstWebhookResponse.json()).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });

      await requireScenario().waitForLatestPendingWake(checkpointReplayUserId);
      const firstSend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: baselineSendCount,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId: checkpointReplayUserId,
      });
      expect(requireLinqStub().readObservedMessageText(firstSend)).toBe(
        checkpointReplayReplyText,
      );
      const firstIdempotencyKey = readObservedLinqIdempotencyKey(firstSend);
      expect(firstIdempotencyKey).toMatch(/^sha256:/u);

      await seedEmptyHostedWorkspaceCheckpointForTest(
        checkpointReplayUserId,
        "checkpoint-replay-after-lost-receipt",
      );

      const postRewindBaselineSendCount = requireLinqStub().countObservedSends(replyPath);
      requireScenario().queueAssistantResponses(
        [
          checkpointReplayReplyText,
          checkpointReplayReplyText,
        ],
        { matchInputContains: "Also, can you repeat that?" },
      );
      const secondWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
        checkpointReplayUserId,
        materializedChatId,
        {
          eventId: `evt_checkpoint_replay_second_${checkpointReplayUserId}`,
          messageId: `msg_checkpoint_replay_second_${checkpointReplayUserId}`,
          text: "Also, can you repeat that?",
        },
      ));
      expect(secondWebhookResponse.status).toBe(202);
      await expect(secondWebhookResponse.json()).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });

      await requireScenario().waitForLatestPendingWake(checkpointReplayUserId);
      const replaySend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: postRewindBaselineSendCount,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId: checkpointReplayUserId,
      });
      expect(requireLinqStub().readObservedMessageText(replaySend)).toBe(
        checkpointReplayReplyText,
      );
      const replayIdempotencyKey = readObservedLinqIdempotencyKey(replaySend);
      expect(replayIdempotencyKey).toMatch(/^sha256:/u);
      expect(replayIdempotencyKey).not.toBe(firstIdempotencyKey);

      const replaySends = requireLinqStub().observedRequests
        .filter((request) => request.url === replyPath)
        .filter((request) =>
          requireLinqStub().readObservedMessageText(request) === checkpointReplayReplyText
        );
      expect(replaySends.length).toBeGreaterThanOrEqual(2);
    },
    360_000,
  );
});

testControlsDescribe("hosted local Linq stale scheduled wake e2e", () => {
  beforeAll(async () => {
    await restartLinqScenario({
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1200",
    }, {
      faultInjection: true,
    });
  }, 300_000);

  itOutsideFastDeployGate(
    "does not resend Linq side effects when a stale scheduled wake remains after a reply",
    async () => {
      await requireScenario().seedActiveHostedLinqMember({
        homePhone: buildLinqHomePhoneNumber(typingLoopUserId),
        memberId: typingLoopUserId,
        memberPhone: buildLinqRecipientPhoneNumber(typingLoopUserId),
      });
      await requireScenario().runWake(
        buildActivationWake(typingLoopUserId),
        typingLoopUserId,
      );
      await requireScenario().waitForHostedCompletion(typingLoopUserId);
      await requireScenario().runWake(
        buildHostedLinqSignupWelcomeWake({
          eventId:
            `member.activated:local:${typingLoopUserId}:evt_linq_typing_loop`,
          userId: typingLoopUserId,
        }),
        typingLoopUserId,
      );
      await requireLinqStub().waitForSend({
        expectedPath: requireLinqStub().createChatPath,
        matchRequest: requireLinqStub().createCreateChatRequestMatcher(typingLoopUserId),
        scenario: requireScenario(),
        userId: typingLoopUserId,
      });
      await requireScenario().waitForHostedCompletion(typingLoopUserId);

      const materializedChatId = requireLinqStub().requireObservedChatId(typingLoopUserId);
      const expectedReplyPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
      const expectedTypingPath = `/chats/${encodeURIComponent(materializedChatId)}/typing`;
      const observedMessageIdsBeforeReply =
        requireLinqStub().listObservedMessageIds(materializedChatId).length;
      const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyPath);
      await seedStaleWorkspaceWakeFromCurrentCheckpoint(typingLoopUserId);
      const statusAfterPreReplyStaleWakeSeed = await readHostedRunnerStatusWithLogLimit(
        typingLoopUserId,
        20,
      );
      const preReplySeededWakeMs = Date.parse(
        statusAfterPreReplyStaleWakeSeed.workspace?.nextWakeAt ?? "",
      );
      expect(Number.isFinite(preReplySeededWakeMs)).toBe(true);
      expect(preReplySeededWakeMs).toBeLessThanOrEqual(Date.now());
      requireScenario().queueAssistantResponses([typingLoopReplyText], {
        matchInputContains: "Can you help me with this?",
      });

      const replyStartedAtMs = Date.now();
      const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
        typingLoopUserId,
        materializedChatId,
        {
          eventId: `evt_typing_loop_reply_${typingLoopUserId}`,
          messageId: `msg_typing_loop_reply_${typingLoopUserId}`,
          text: "Can you help me with this?",
        },
      ));
      expect(webhookResponse.status).toBe(202);
      await expect(webhookResponse.json()).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });

      await requireScenario().waitForLatestPendingWake(typingLoopUserId);
      const replySend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: outboundCountBeforeReply,
        expectedPath: expectedReplyPath,
        scenario: requireScenario(),
        userId: typingLoopUserId,
      });
      expect(requireLinqStub().readObservedMessageText(replySend)).toBe(typingLoopReplyText);
      await requireScenario().waitForHostedCompletion(typingLoopUserId);
      const outboundReplyMessageId =
        requireLinqStub().listObservedMessageIds(materializedChatId)[observedMessageIdsBeforeReply] ?? null;
      expect(outboundReplyMessageId).not.toBeNull();
      await requireLinqStub().waitForMatchingRequestCount({
        expectedCount: 1,
        expectedMethod: "DELETE",
        expectedPath: `/messages/${encodeURIComponent(`msg_typing_loop_reply_${typingLoopUserId}`)}`,
        scenario: requireScenario(),
        userId: typingLoopUserId,
      });
      await requireLinqStub().waitForMatchingRequestCount({
        expectedCount: 1,
        expectedMethod: "DELETE",
        expectedPath: `/messages/${encodeURIComponent(outboundReplyMessageId!)}`,
        scenario: requireScenario(),
        userId: typingLoopUserId,
      });
      await requireScenario().waitForHostedCompletion(typingLoopUserId);

      const statusAfterReplyIdle = await readHostedRunnerStatusWithLogLimit(
        typingLoopUserId,
        20,
      );
      const postReplyNextWakeAt = statusAfterReplyIdle.workspace?.nextWakeAt ?? null;
      if (postReplyNextWakeAt !== null) {
        const postReplyWakeMs = Date.parse(postReplyNextWakeAt);
        expect(Number.isFinite(postReplyWakeMs)).toBe(true);
        expect(postReplyWakeMs).toBeGreaterThanOrEqual(replyStartedAtMs);
      }

      const requestCountAfterCleanup = requireLinqStub().observedRequests.length;
      const outboundCountAfterCleanup = requireLinqStub().countObservedSends(expectedReplyPath);
      expect(outboundCountAfterCleanup).toBe(outboundCountBeforeReply + 1);
      await seedStaleWorkspaceWakeFromCurrentCheckpoint(typingLoopUserId);
      const statusAfterStaleWakeSeed = await readHostedRunnerStatusWithLogLimit(
        typingLoopUserId,
        20,
      );
      const seededWakeMs = Date.parse(statusAfterStaleWakeSeed.workspace?.nextWakeAt ?? "");
      expect(Number.isFinite(seededWakeMs)).toBe(true);
      expect(seededWakeMs).toBeLessThanOrEqual(Date.now());
      expect(hasHostedMailboxBacklog(statusAfterStaleWakeSeed)).toBe(true);

      const alarmStartedAtMs = Date.now();
      const alarmOutcome = await runHostedAlarmUntilIdleForTest(typingLoopUserId);

      const postReplyTypingStarts = requireLinqStub().observedRequests
        .slice(requestCountAfterCleanup)
        .filter((request) => request.method === "POST" && request.url === expectedTypingPath);
      const outboundCountAfterAlarm = requireLinqStub().countObservedSends(expectedReplyPath);

      if (alarmOutcome.status === "scheduled") {
        expect(alarmOutcome.nextWakeAt).toEqual(expect.any(String));
        const scheduledWakeMs = Date.parse(alarmOutcome.nextWakeAt ?? "");
        expect(Number.isFinite(scheduledWakeMs)).toBe(true);
        expect(scheduledWakeMs).toBeGreaterThanOrEqual(alarmStartedAtMs);
      } else {
        expect(alarmOutcome.status).toBe("idle");
        expect(alarmOutcome.nextWakeAt).toBeNull();
      }
      expect(postReplyTypingStarts).toHaveLength(0);
      expect(outboundCountAfterAlarm).toBe(outboundCountAfterCleanup);
    },
    300_000,
  );
});

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

function buildActivationWake(userId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_linq_first_contact`,
    memberId: userId,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
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

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not initialized.");
  }

  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}

function readObservedLinqIdempotencyKey(request: ObservedLinqRequest): string | null {
  const parsed: unknown = JSON.parse(request.body);
  const message = readObjectProperty(parsed, "message");
  const idempotencyKey = readObjectProperty(message, "idempotency_key");
  return typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0
    ? idempotencyKey
    : null;
}

function readObjectProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

async function seedEmptyHostedWorkspaceCheckpointForTest(
  memberId: string,
  label: string,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-linq-replay-vault-"));
  cleanupPaths.push(root);
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });

  await createIntegratedVaultServices().core.init({
    requestId: `seed-${label}`,
    timezone: "UTC",
    vault: vaultRoot,
  });

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: createBrowserVaultReplicaRef(memberId, hash, label),
    environment: requireScenario().runtimeEnv,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: {
      seeded: true,
    },
    snapshotRef: createSnapshotBundleRef(hash, snapshot.bundle.byteLength),
    userId: memberId,
  });
  expect(checkpoint.status).toBe("updated");

  await uploadHostedSnapshotArtifact({
    bytes: snapshot.bundle,
    hash,
    userId: memberId,
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

function createSnapshotBundleRef(
  hash: string,
  size: number,
): HostedExecutionSnapshotRef {
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size,
    updatedAt: new Date().toISOString(),
  };
}

function createBrowserVaultReplicaRef(
  memberId: string,
  sourceBundleHash: string,
  label: string,
): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `${label}-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:linq-checkpoint-replay",
    objectKey: `browser-vault/${memberId}/${label}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:linq-checkpoint-replay",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

async function startLinqScenario(
  additionalEnv: NodeJS.ProcessEnv = {},
  options: {
    faultInjection?: boolean;
  } = {},
): Promise<void> {
  linqStub = await startHostedLocalLinqStub({
    expectedAuthorizationToken: linqApiToken,
  });
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqFirstContactLocalInboundAllowlist(),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: linqApiToken,
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: localRunnerIdleTtlMs,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
      ...additionalEnv,
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    faultInjection: options.faultInjection,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-first-contact-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq e2e",
    streamLogs: streamDevLogs,
  });
}

async function ensureLinqScenario(): Promise<void> {
  if (scenario) {
    return;
  }

  await startLinqScenario({
    HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
  });
}

async function restartLinqScenario(
  additionalEnv: NodeJS.ProcessEnv = {},
  options: {
    faultInjection?: boolean;
  } = {},
): Promise<void> {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;

  await sleep(2_000);
  await startLinqScenario(additionalEnv, options);
}

function buildLinqFirstContactLocalInboundAllowlist(): string {
  return [
    directReplyUserId,
    richLinkLostAckUserId,
    richLinkRetryRecoveryUserId,
    richLinkFallbackUserId,
    duplicateWelcomeUserId,
    fastReplyUserId,
    progressToolUserId,
    postAssistantReplyUserId,
    checkpointReplayUserId,
    typingLoopUserId,
  ].map(buildLinqRecipientPhoneNumber).join(",");
}

async function seedStaleWorkspaceWakeFromCurrentCheckpoint(userId: string): Promise<void> {
  const status = await readHostedRunnerStatusWithLogLimit(userId, 100);
  const workspace = status.workspace;
  if (!workspace?.snapshotRef || !workspace.browserVaultReplicaRef) {
    throw new Error("Expected a checkpointed hosted workspace before seeding stale wake.");
  }

  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: workspace.browserVaultReplicaRef,
    environment: requireScenario().runtimeEnv,
    nextWakeAt: new Date(Date.now() - 1_000).toISOString(),
    nextWakeReason: "assistant",
    redactedStatusJson: {
      seededStaleWakeForTest: true,
    },
    snapshotRef: workspace.snapshotRef,
    userId,
  });
  expect(checkpoint.status).toBe("updated");
}

async function runHostedAlarmUntilIdleForTest(
  userId: string,
  signal: AbortSignal,
): Promise<HostedWorkspaceInvocationResult> {
  return await requireScenario().harness.requestJson<HostedWorkspaceInvocationResult>(
    `/__test/users/${encodeURIComponent(userId)}/run-until-idle`,
    {
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      },
      method: "POST",
      signal,
    },
  );
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

function hasHostedMailboxBacklog(status: HostedRunnerStatusResponse): boolean {
  return status.mailboxLag.some((lane) => lane.lag !== "0");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
