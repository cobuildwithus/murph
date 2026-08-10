import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readHostedIngressLatencyTraceForTest,
  readHostedMailboxItemForTest,
} from "#hosted-web-testing";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  buildStableNumericSuffix,
  didShellPrewarmArriveByIngressAcceptance,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqSignupWelcomeWake,
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
  HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT,
  readHostedLocalLinqImagePngBytes,
  startHostedLocalLinqStub,
  type ObservedLinqRequest,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const linqWebhookSecret = "linq-local-webhook-secret";
const hostedLinqCometRiderAssistantReplyText =
  "Got it - I'll call you Comet Rider.\n\nWhat are your health goals right now?";
const hostedLinqImageAssistantReplyText = "Reviewed the image attachment.";
const hostedLinqPdfAssistantReplyText = "Read the PDF attachment.";
const hostedLinqAppCardAssistantReplyText = "Handled the app card.";
const hostedLinqTypingPrewarmAssistantReplyText =
  "The typing prewarm kept the normal reply path intact.";
const hostedLinqParticipantAdditionGroupContext =
  "One or more participants were recently added to this group chat.";
const hostedLinqParticipantAddedDetailedContext =
  "Participant +15559870001 was added to the group.";
const linqWebhookRunId = Date.now();
const hostedLinqGroupIsolationGuestUserId =
  `member_local_linq_webhook_group_isolation_guest_${linqWebhookRunId}`;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
const linqWebhookMemberCountersByLabel = new Map<string, number>();

interface ActiveLinqWebhookMember {
  chatId: string;
  replyChatPath: string;
  userId: string;
}

type HostedLinqWorkspaceIsolationState = Awaited<ReturnType<
  HostedLocalFullStackScenario["readHostedLinqWorkspaceIsolationState"]
>>;

async function waitForHostedLinqWorkspaceIsolationState(input: {
  chatId: string;
  isReady: (state: HostedLinqWorkspaceIsolationState) => boolean;
  memberId: string;
}): Promise<HostedLinqWorkspaceIsolationState> {
  const startedAt = Date.now();
  let lastState: HostedLinqWorkspaceIsolationState | null = null;

  while (Date.now() - startedAt < 120_000) {
    lastState = await requireScenario().readHostedLinqWorkspaceIsolationState({
      chatId: input.chatId,
      memberId: input.memberId,
    });
    if (input.isReady(lastState)) {
      return lastState;
    }
    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for durable Linq workspace isolation state: ${JSON.stringify(lastState)}`,
  );
}

it("derives stable numeric suffixes from the full Linq user id", () => {
  expect(buildStableNumericSuffix("member_local_linq_webhook_20260408", 7)).not.toBe(
    buildStableNumericSuffix("member_local_linq_webhook_rapid_20260408", 7),
  );
});

describe("hosted local Linq webhook e2e", () => {
  beforeAll(async () => {
    await startLinqScenario(buildLinqWebhookScenarioEnv);
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("routes a signed Linq webhook through apps/web and delivers the follow-up reply", async () => {
    const { chatId: materializedChatId, replyChatPath, userId } =
      await createActiveLinqWebhookMember("reply");
    const expectedReplyChatPath = replyChatPath;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;
    const webhookEvent = buildHostedLinqInboundEvent(userId, materializedChatId, {
      eventId: `evt_webhook_${userId}`,
      messageId: `msg_webhook_${userId}`,
      text: "U can call me Rocket Man",
    });

    requireScenario().queueAssistantResponses([HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT], {
      matchInputContains: "U can call me Rocket Man",
    });
    const webhookResponse = await postSignedLinqWebhook(webhookEvent);
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    await requireScenario().waitForHostedCompletion(userId);

    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT,
    );
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    const assistantProviderBody = requireSingleAssistantProviderRequestBody(
      assistantProviderRequests,
      "nickname webhook provider request",
    );
    expect(
      assistantProviderBody.includes("U can call me Rocket Man"),
      summarizeProviderTextRequestShape(assistantProviderBody),
    ).toBe(true);
  }, 300_000);

  it("reduces an inbound iMessage app card to fallback text and replies in the same chat", async () => {
    const { chatId, replyChatPath, userId } =
      await createActiveLinqWebhookMember("app-card");
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(replyChatPath);
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;
    const fallbackText = "Completed the check-in from the app card.";
    const privateCardSentinel = "private-card-metadata-sentinel";

    requireScenario().queueAssistantResponses([hostedLinqAppCardAssistantReplyText], {
      matchInputContains: fallbackText,
    });
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_app_card_${userId}`,
        messageId: `msg_app_card_${userId}`,
        parts: [{
          app: {
            bundle_id: `com.example.${privateCardSentinel}`,
            name: privateCardSentinel,
            team_id: "TESTTEAM01",
          },
          fallbackText,
          layout: {
            caption: privateCardSentinel,
          },
          type: "imessage_app",
          url: `https://example.test/${privateCardSentinel}`,
        }],
        service: "iMessage",
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    await requireScenario().waitForHostedCompletion(userId);

    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: replyChatPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      hostedLinqAppCardAssistantReplyText,
    );
    const assistantProviderBody = requireSingleAssistantProviderRequestBody(
      requireScenario().assistantProviderRequests.slice(assistantProviderCountBeforeReply),
      "iMessage app-card provider request",
    );
    expect(assistantProviderBody).toContain(fallbackText);
    expect(assistantProviderBody).not.toContain(privateCardSentinel);
  }, 300_000);

  it("prewarms from signed typing before the later durable message and reply", async () => {
    const { chatId, replyChatPath, userId } =
      await createActiveLinqWebhookMember("typing-prewarm");
    const idleBeforeTyping = await requireScenario().waitForHostedIdle(userId);
    const stateBeforeTyping = await requireScenario()
      .readHostedLinqWorkspaceIsolationState({ chatId, memberId: userId });
    const outboundCountBeforeTyping = requireLinqStub()
      .countObservedSends(replyChatPath);
    const providerCountBeforeTyping = requireScenario().assistantProviderRequests.length;

    const typingResponse = await postSignedLinqWebhook({
      api_version: "v3",
      created_at: new Date().toISOString(),
      data: {
        chat_id: chatId,
      },
      event_id: `evt_typing_prewarm_${userId}`,
      event_type: "chat.typing_indicator.started",
    });
    expect(typingResponse.status).toBe(202);
    await expect(typingResponse.json()).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "typing-ignored",
    });

    const stateAfterTyping = await requireScenario()
      .readHostedLinqWorkspaceIsolationState({ chatId, memberId: userId });
    const statusAfterTyping = await requireScenario().harness.readUserStatus(userId);
    expect(stateAfterTyping.personal.conversationMailboxCount).toBe(
      stateBeforeTyping.personal.conversationMailboxCount,
    );
    expect(statusAfterTyping.lastInvocationAt ?? null).toBe(
      idleBeforeTyping.lastInvocationAt ?? null,
    );
    expect(statusAfterTyping.inFlight).toBe(false);
    expect(statusAfterTyping.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(requireScenario().assistantProviderRequests).toHaveLength(
      providerCountBeforeTyping,
    );
    expect(requireLinqStub().countObservedSends(replyChatPath)).toBe(
      outboundCountBeforeTyping,
    );

    const messageText = "Does the normal reply still arrive after typing?";
    const messageEventId = `evt_after_typing_prewarm_${userId}`;
    requireScenario().queueAssistantResponses([
      hostedLinqTypingPrewarmAssistantReplyText,
    ], {
      matchInputContains: messageText,
    });
    const messageResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: messageEventId,
        messageId: `msg_after_typing_prewarm_${userId}`,
        text: messageText,
      }),
    );
    expect(messageResponse.status).toBe(202);
    await expect(messageResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    await requireScenario().waitForHostedCompletion(userId);
    const reply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeTyping,
      expectedPath: replyChatPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(
      hostedLinqTypingPrewarmAssistantReplyText,
    );
    expect(requireLinqStub().countObservedSends(replyChatPath)).toBe(
      outboundCountBeforeTyping + 1,
    );
    expect(requireScenario().assistantProviderRequests).toHaveLength(
      providerCountBeforeTyping + 1,
    );
    const latencyTrace = await waitForTypingPrewarmLatencyTrace({
      mailboxDedupeKey: messageEventId,
      userId,
    });
    expect(latencyTrace.phaseBreakdown?.orchestration).toMatchObject({
      shellPrewarmFirstHintAtEpochMs: expect.any(Number),
      shellPrewarmHintCount: expect.any(Number),
      shellPrewarmOutcome: expect.stringMatching(
        /^(?:cold_start_observed|start_issued_warm)$/u,
      ),
      shellPrewarmSource: "linq-typing-started",
    });
    expect(didShellPrewarmArriveByIngressAcceptance({
      acceptedAt: latencyTrace.acceptedAt,
      firstHintAtEpochMs:
        latencyTrace.phaseBreakdown?.orchestration?.shellPrewarmFirstHintAtEpochMs,
    })).toBe(true);
  }, 300_000);

  it("keeps Linq context when two signed webhooks arrive before hosted completion catches up", async () => {
    const { chatId: materializedChatId, replyChatPath: expectedReplyChatPath, userId } =
      await createActiveLinqWebhookMember("rapid");
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;
    const nameText = "U can call me Comet Rider";
    const goalsText = "I want to build more strength, improve endurance, and get fitter overall.";
    const groupedReplyMatcher = (request: ObservedLinqRequest) =>
      requireLinqStub().readObservedMessageText(request) ===
        HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT;
    const groupedReplyCountBefore = requireLinqStub().countObservedSends(
      expectedReplyChatPath,
      groupedReplyMatcher,
    );

    const firstWebhook = buildHostedLinqInboundEvent(userId, materializedChatId, {
      eventId: `evt_webhook_name_${userId}_rapid`,
      messageId: `msg_webhook_name_${userId}_rapid`,
      text: nameText,
    });
    const secondWebhook = buildHostedLinqInboundEvent(userId, materializedChatId, {
      eventId: `evt_webhook_goals_${userId}_rapid`,
      messageId: `msg_webhook_goals_${userId}_rapid`,
      text: goalsText,
    });

    requireScenario().queueAssistantResponses([
      {
        matchInputContains: nameText,
        response: hostedLinqCometRiderAssistantReplyText,
      },
      {
        matchInputContains: goalsText,
        response: HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
      },
    ]);
    const firstResponse = await postSignedLinqWebhook(firstWebhook);
    const secondResponse = await postSignedLinqWebhook(secondWebhook);

    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    await requireScenario().waitForHostedCompletion(userId);

    await requireLinqStub().waitForAdditionalSend({
      baselineCount: groupedReplyCountBefore,
      expectedPath: expectedReplyChatPath,
      matchRequest: groupedReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    const newReplySends = requireLinqStub().observedRequests.filter((request) =>
      request.method === "POST" && request.url === expectedReplyChatPath
    ).slice(outboundCountBeforeReply);
    const newReplyTexts = newReplySends.map((request) =>
      requireLinqStub().readObservedMessageText(request)
    );

    expect(newReplyTexts).toContain(HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT);
    expect(newReplyTexts.some((text) => text?.includes("Hey, I'm Murph"))).toBe(false);
    expect(newReplyTexts.every((text) =>
      text === hostedLinqCometRiderAssistantReplyText
      || text === HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT
    )).toBe(true);
    expect(newReplyTexts.length).toBeLessThanOrEqual(2);
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    expect(
      assistantProviderRequests.length,
      summarizeGroupedWebhookProviderRequests(assistantProviderRequests),
    ).toBeGreaterThan(0);
    const assistantProviderBodies = assistantProviderRequests.map((request) => request.body);
    expect(assistantProviderBodies.some((body) =>
      body.includes(nameText)
    )).toBe(true);
    expect(assistantProviderBodies.some((body) =>
      body.includes(goalsText)
    )).toBe(true);
  }, 300_000);

  it("never routes a canonically grouped chat or an unregistered participant through the personal workspace", async () => {
    const { chatId, replyChatPath, userId } =
      await createActiveLinqWebhookMember("group-isolation");
    const privateContextSentinel =
      `PRIVATE_DIRECT_CONTEXT_SENTINEL_${linqWebhookRunId}`;
    const directReplyText = "Saved that private direct-chat context.";
    const firstGroupText = "GROUP_ISOLATION_OWNER_MESSAGE";
    const firstGroupReplyText = "The owner group message stayed isolated.";
    const guestGroupText = "GROUP_ISOLATION_GUEST_MESSAGE";
    const guestGroupReplyText = "The guest group message stayed isolated.";

    const directSendCountBefore = requireLinqStub().countObservedSends(replyChatPath);
    requireScenario().queueAssistantResponses([directReplyText], {
      matchInputContains: privateContextSentinel,
    });
    const directResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_group_isolation_private_${userId}`,
        messageId: `msg_group_isolation_private_${userId}`,
        text: privateContextSentinel,
      },
    ));
    expect(directResponse.status).toBe(202);
    await expect(directResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    await requireScenario().waitForHostedCompletion(userId);
    const directReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: directSendCountBefore,
      expectedPath: replyChatPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(directReply)).toBe(directReplyText);

    const baseline = await requireScenario().readHostedLinqWorkspaceIsolationState({
      chatId,
      memberId: userId,
    });
    expect(baseline.personal).toMatchObject({
      conversationMailboxCount: 1,
      homeChatBound: true,
      pendingChatBound: false,
      recipientAssigned: true,
    });
    expect(baseline.personal.workspaceVersion).not.toBeNull();
    expect(baseline.thread).toBeNull();

    requireLinqStub().setChatIsGroup(chatId, true);
    const canonicalChatPath = `/chats/${encodeURIComponent(chatId)}`;
    const canonicalReadsBefore = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: canonicalChatPath,
    });
    const firstGroupSendCountBefore = requireLinqStub().countObservedSends(replyChatPath);
    const firstGroupProviderCountBefore = requireScenario().assistantProviderRequests.length;
    requireScenario().queueAssistantResponses([firstGroupReplyText], {
      matchInputContains: firstGroupText,
    });
    const firstGroupEvent = buildHostedLinqInboundEvent(userId, chatId, {
      eventId: `evt_group_isolation_owner_${userId}`,
      messageId: `msg_group_isolation_owner_${userId}`,
      text: firstGroupText,
    });
    expect(
      ((firstGroupEvent.data as { chat?: { is_group?: boolean } }).chat?.is_group),
    ).toBe(false);

    const firstGroupResponse = await postSignedLinqWebhook(firstGroupEvent);
    expect(firstGroupResponse.status).toBe(202);
    await expect(firstGroupResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: canonicalChatPath,
    })).toBeGreaterThan(canonicalReadsBefore);

    const routedBeforeFirstRun =
      await requireScenario().readHostedLinqWorkspaceIsolationState({
        chatId,
        memberId: userId,
      });
    expect(routedBeforeFirstRun.personal).toMatchObject({
      conversationMailboxCount: baseline.personal.conversationMailboxCount,
      homeChatBound: false,
      homeLineAssigned: baseline.personal.homeLineAssigned,
      pendingChatBound: false,
      recipientAssigned: true,
    });
    expect(routedBeforeFirstRun.thread).toMatchObject({
      containerExists: true,
      conversationMailboxCount: 1,
      ownerMemberId: userId,
    });
    const containerMemberId = routedBeforeFirstRun.thread?.containerMemberId;
    if (!containerMemberId) {
      throw new Error("Expected canonical group routing to create a thread container.");
    }

    await requireScenario().waitForLatestPendingWake(containerMemberId);
    const firstGroupReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: firstGroupSendCountBefore,
      expectedPath: replyChatPath,
      scenario: requireScenario(),
      userId: containerMemberId,
    });
    expect(requireLinqStub().readObservedMessageText(firstGroupReply)).toBe(
      firstGroupReplyText,
    );
    const afterFirstGroup = await waitForHostedLinqWorkspaceIsolationState({
      chatId,
      isReady: (state) =>
        state.personal.conversationMailboxCount
          === baseline.personal.conversationMailboxCount
        && state.thread?.containerMemberId === containerMemberId
        && state.thread.conversationMailboxCount === 1
        && BigInt(state.thread.workspaceVersion ?? "-1")
          > BigInt(routedBeforeFirstRun.thread?.workspaceVersion ?? "-1"),
      memberId: userId,
    });
    // The personal runtime can finish a queued follow-up checkpoint after its
    // completion status turns idle. Mailbox ownership, not its workspace
    // version, is the durable routing-isolation invariant.
    expect(afterFirstGroup.personal.conversationMailboxCount).toBe(
      baseline.personal.conversationMailboxCount,
    );
    expect(afterFirstGroup.thread).toMatchObject({
      containerMemberId,
      conversationMailboxCount: 1,
    });
    expect(BigInt(afterFirstGroup.thread?.workspaceVersion ?? "-1")).toBeGreaterThan(
      BigInt(routedBeforeFirstRun.thread?.workspaceVersion ?? "-1"),
    );
    const firstGroupProviderBodies = requireScenario().assistantProviderRequests
      .slice(firstGroupProviderCountBefore)
      .map((request) => request.body)
      .filter((body) => body.includes(firstGroupText));
    expect(firstGroupProviderBodies.length).toBeGreaterThan(0);
    expect(firstGroupProviderBodies.every((body) =>
      !body.includes(privateContextSentinel)
      && !body.includes("Murph onboarding:")
      && !body.includes("murph-onboarding/SKILL.md")
      && !body.includes(hostedLinqParticipantAdditionGroupContext)
      && !body.includes(hostedLinqParticipantAddedDetailedContext)
    )).toBe(true);

    const participantAddedProviderCountBefore =
      requireScenario().assistantProviderRequests.length;
    const participantAddedResponse = await postSignedLinqWebhook({
      api_version: "v3",
      created_at: "2026-03-26T12:01:00.000Z",
      data: {
        added_at: "2026-03-26T12:01:00.000Z",
        chat_id: chatId,
        participant: {
          handle: "+15559870001",
          id: `participant_group_isolation_${linqWebhookRunId}`,
          service: "iMessage",
        },
      },
      event_id: `evt_group_isolation_participant_added_${userId}`,
      event_type: "participant.added",
      trace_id: `trace_group_isolation_participant_added_${linqWebhookRunId}`,
      webhook_version: "2026-02-03",
    });
    expect(participantAddedResponse.status).toBe(202);
    await expect(participantAddedResponse.json()).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "recorded-linq-provider-event:participant.added",
    });
    expect(requireScenario().assistantProviderRequests).toHaveLength(
      participantAddedProviderCountBefore,
    );

    const guestSendCountBefore = requireLinqStub().countObservedSends(replyChatPath);
    const guestProviderCountBefore = requireScenario().assistantProviderRequests.length;
    requireScenario().queueAssistantResponses([guestGroupReplyText], {
      matchInputContains: guestGroupText,
    });
    const guestEvent = buildHostedLinqInboundEvent(
      hostedLinqGroupIsolationGuestUserId,
      chatId,
      {
        eventId: `evt_group_isolation_guest_${userId}`,
        isGroup: true,
        messageId: `msg_group_isolation_guest_${userId}`,
        recipientUserId: userId,
        text: guestGroupText,
      },
    );
    expect(
      ((guestEvent.data as { chat?: { is_group?: boolean } }).chat?.is_group),
    ).toBe(true);
    const guestResponse = await postSignedLinqWebhook(guestEvent);
    expect(guestResponse.status).toBe(202);
    await expect(guestResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-thread-route",
    });
    await requireScenario().waitForLatestPendingWake(containerMemberId);
    const guestReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: guestSendCountBefore,
      expectedPath: replyChatPath,
      scenario: requireScenario(),
      userId: containerMemberId,
    });
    expect(requireLinqStub().readObservedMessageText(guestReply)).toBe(
      guestGroupReplyText,
    );
    const afterGuestGroup = await waitForHostedLinqWorkspaceIsolationState({
      chatId,
      isReady: (state) =>
        state.personal.conversationMailboxCount
          === baseline.personal.conversationMailboxCount
        && state.thread?.containerMemberId === containerMemberId
        && state.thread.conversationMailboxCount === 2
        && BigInt(state.thread.workspaceVersion ?? "-1")
          > BigInt(afterFirstGroup.thread?.workspaceVersion ?? "-1"),
      memberId: userId,
    });
    expect(afterGuestGroup.personal.conversationMailboxCount).toBe(
      baseline.personal.conversationMailboxCount,
    );
    expect(afterGuestGroup.personal).toMatchObject({
      homeChatBound: false,
      homeLineAssigned: baseline.personal.homeLineAssigned,
      pendingChatBound: false,
      recipientAssigned: true,
    });
    expect(afterGuestGroup.thread).toMatchObject({
      containerMemberId,
      conversationMailboxCount: 2,
      ownerMemberId: userId,
    });
    expect(BigInt(afterGuestGroup.thread?.workspaceVersion ?? "-1")).toBeGreaterThan(
      BigInt(afterFirstGroup.thread?.workspaceVersion ?? "-1"),
    );
    const guestProviderBodies = requireScenario().assistantProviderRequests
      .slice(guestProviderCountBefore)
      .map((request) => request.body)
      .filter((body) => body.includes(guestGroupText));
    expect(guestProviderBodies.length).toBeGreaterThan(0);
    expect(guestProviderBodies.every((body) =>
      !body.includes(privateContextSentinel)
      && !body.includes("Murph onboarding:")
      && !body.includes("murph-onboarding/SKILL.md")
    )).toBe(true);
    expect(guestProviderBodies.some((body) =>
      body.includes(hostedLinqParticipantAdditionGroupContext)
    )).toBe(true);
    expect(guestProviderBodies.some((body) =>
      body.includes(hostedLinqParticipantAddedDetailedContext)
    )).toBe(true);
  }, 600_000);

  it("keeps PDF-only iMessage media replyable with bounded attachment context", async () => {
    const { chatId: materializedChatId, replyChatPath: expectedReplyChatPath, userId } =
      await createActiveLinqWebhookMember("pdf");
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const attachmentId = `att_pdf_${userId}`;
    const expectedAttachmentDownloadPath =
      `/attachment-downloads/${encodeURIComponent(attachmentId)}.pdf`;
    const expectedAttachmentDownloadUrl =
      `${requireLinqStub().attachmentDownloadContainerBaseUrl}/${encodeURIComponent(attachmentId)}.pdf`;
    const attachmentDownloadCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
    });
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;

    requireScenario().queueAssistantResponses([hostedLinqPdfAssistantReplyText], {
      matchInputContains: "lab-results.pdf",
    });
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_pdf_${userId}`,
        messageId: `msg_pdf_${userId}`,
        parts: [
          {
            attachmentId,
            fileName: "lab-results.pdf",
            mimeType: "application/pdf",
            size: 128,
            type: "media",
            url: expectedAttachmentDownloadUrl,
          },
        ],
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: attachmentDownloadCountBeforeReply,
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
      scenario: requireScenario(),
      userId,
    });
    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalStatus.inFlight).toBe(false);
    expect(finalStatus.workspace).not.toBeNull();

    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      hostedLinqPdfAssistantReplyText,
    );
    const assistantProviderRequests = requireScenario().assistantProviderRequests
      .slice(assistantProviderCountBeforeReply)
      .filter((request) => request.body.includes("lab-results.pdf"));
    const assistantProviderBody = requireSingleAssistantProviderRequestBody(
      assistantProviderRequests,
      "pdf media provider request",
    );
    const providerBody = parseAssistantProviderRequestBody(assistantProviderBody);
    const inputFiles = collectProviderInputPartsByType(providerBody, "input_file");
    expect(
      inputFiles.length,
      summarizeProviderFileRequestShape(providerBody, assistantProviderBody),
    ).toBe(0);
    expect(assistantProviderBody.includes("\"input_file\"")).toBe(false);
    expect(assistantProviderBody.includes("\"file_data\"")).toBe(false);
    expect(assistantProviderBody.includes("\"file_id\"")).toBe(false);
    expect(assistantProviderBody.includes("Attachment context:")).toBe(true);
    expect(assistantProviderBody.includes("fileName: lab-results.pdf")).toBe(true);
    expect(assistantProviderBody.includes("raw/inbox/")).toBe(true);
    expect(assistantProviderBody.includes("lab-results.pdf")).toBe(true);
    expect(assistantProviderBody.includes("raw/assistant-input/")).toBe(false);
    expect(assistantProviderBody.includes("storedPath")).toBe(true);
    expect(assistantProviderBody.includes("raw evidence: not_attempted")).toBe(false);
    expectNoNativeAttachmentLeaks(assistantProviderBody, [
      attachmentId,
      expectedAttachmentDownloadPath,
      expectedAttachmentDownloadUrl,
      "pdfEvidencePath:",
      "stub-local-openai-key",
      "OPENAI_API_KEY",
    ]);
  }, 300_000);

  it("normalizes a large image-only iMessage media attachment before the multimodal provider path", async () => {
    await restartLinqScenario(buildLinqWebhookScenarioEnv);
    const { chatId: materializedChatId, replyChatPath: expectedReplyChatPath, userId } =
      await createActiveLinqWebhookMember("image");
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const attachmentId = `att_image_${userId}`;
    const originalImageBytes = readHostedLocalLinqImagePngBytes();
    const expectedAttachmentMetadataPath = `/attachments/${encodeURIComponent(attachmentId)}`;
    const expectedAttachmentDownloadPath =
      `/attachment-downloads/${encodeURIComponent(attachmentId)}.png`;
    const expectedAttachmentDownloadUrl =
      `${requireLinqStub().attachmentDownloadContainerBaseUrl}/${encodeURIComponent(attachmentId)}.png`;
    const attachmentMetadataCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentMetadataPath,
    });
    const attachmentDownloadCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
    });
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;

    requireScenario().queueAssistantResponses([hostedLinqImageAssistantReplyText], {
      // The image pipeline normalizes outbox.png to WebP and the provider
      // request renders the normalized evidence filename (asserted below as
      // `fileName: outbox.webp`), so the matcher must use the normalized name.
      matchInputContains: "outbox.webp",
    });
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_image_${userId}`,
        messageId: `msg_image_${userId}`,
        parts: [
          {
            attachmentId,
            fileName: "outbox.png",
            mimeType: "image/png",
            size: originalImageBytes.byteLength,
            type: "media",
            url: expectedAttachmentDownloadUrl,
          },
        ],
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: attachmentMetadataCountBeforeReply,
      expectedMethod: "GET",
      expectedPath: expectedAttachmentMetadataPath,
      scenario: requireScenario(),
      userId,
    });
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: attachmentDownloadCountBeforeReply,
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
      scenario: requireScenario(),
      userId,
    });
    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalStatus.inFlight).toBe(false);
    expect(finalStatus.workspace).not.toBeNull();

    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      hostedLinqImageAssistantReplyText,
    );
    expect(requireLinqStub().countObservedSends(expectedReplyChatPath)).toBe(
      outboundCountBeforeReply + 1,
    );
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    const assistantProviderBody = requireStableAssistantProviderRequestBody(
      assistantProviderRequests,
      "image media provider request",
    );
    const providerBody = parseAssistantProviderRequestBody(assistantProviderBody);
    const inputImages = collectProviderInputPartsByType(providerBody, "input_image");
    const imageShapeSummary = summarizeProviderImageRequestShape(
      providerBody,
      assistantProviderBody,
    );
    expect(inputImages.length, imageShapeSummary).toBeGreaterThan(0);
    const imagePayload = decodeSingleProviderDataImageUrl(inputImages, imageShapeSummary);
    expect(imagePayload.mediaType, imageShapeSummary).toBe("image/webp");
    expect(imagePayload.bytes.byteLength, imageShapeSummary).toBeGreaterThan(12);
    expect(hasWebpSignature(imagePayload.bytes), imageShapeSummary).toBe(true);
    expect(hasPngSignature(imagePayload.bytes), imageShapeSummary).toBe(false);
    expect(imagePayload.bytes.byteLength, imageShapeSummary).toBeLessThan(
      originalImageBytes.byteLength,
    );
    expect(providerInputPartsIncludeImageUrlWithPrefix(inputImages, "data:image/png;base64,")).toBe(
      false,
    );
    expect(assistantProviderBody.includes("data:image/png;base64,"), imageShapeSummary).toBe(
      false,
    );
    expect(assistantProviderBody.includes("Attachment context:")).toBe(true);
    expect(assistantProviderBody.includes("fileName: outbox.webp")).toBe(true);
    expect(assistantProviderBody.includes("mime: image/webp")).toBe(true);
    expect(assistantProviderBody.includes("raw/inbox/")).toBe(true);
    expect(assistantProviderBody.includes("raw/assistant-input/")).toBe(false);
    expect(assistantProviderBody.includes("storedPath")).toBe(true);
    expect(assistantProviderBody.includes("raw evidence: not_attempted")).toBe(false);
    expectNoNativeAttachmentLeaks(assistantProviderBody, [
      attachmentId,
      expectedAttachmentDownloadPath,
      expectedAttachmentDownloadUrl,
    ]);
  }, 300_000);

});

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

async function waitForTypingPrewarmLatencyTrace(input: {
  mailboxDedupeKey: string;
  userId: string;
}) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30_000) {
    try {
      const mailboxItem = await readHostedMailboxItemForTest({
        dedupeKey: input.mailboxDedupeKey,
        environment: requireScenario().runtimeEnv,
        userId: input.userId,
      });
      const trace = await readHostedIngressLatencyTraceForTest({
        environment: requireScenario().runtimeEnv,
        mailboxItemId: mailboxItem.id,
        userId: input.userId,
      });
      if (
        trace.phaseBreakdown?.orchestration?.shellPrewarmOutcome
        && trace.phaseBreakdown.orchestration.shellPrewarmSource
      ) {
        return trace;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw new Error(
    `Timed out waiting for the typing-prewarm latency trace: ${String(lastError)}`,
  );
}

function parseAssistantProviderRequestBody(body: string | undefined): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body ?? "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function collectProviderInputPartsByType(
  body: Record<string, unknown>,
  type: string,
): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (record.type === type) {
      matches.push(record);
    }
    for (const child of Object.values(record)) {
      visit(child);
    }
  };
  visit(body);
  return matches;
}

function providerInputPartsIncludeImageUrlWithPrefix(
  parts: readonly Record<string, unknown>[],
  prefix: string,
): boolean {
  return parts.some((part) =>
    typeof part.image_url === "string" && part.image_url.startsWith(prefix)
  );
}

function decodeSingleProviderDataImageUrl(
  parts: readonly Record<string, unknown>[],
  shapeSummary: string,
): { bytes: Buffer; mediaType: string } {
  const urls = parts
    .map((part) => part.image_url)
    .filter((value): value is string => typeof value === "string");
  if (urls.length !== 1) {
    throw new Error(
      `${shapeSummary}; expected exactly one provider data image URL, got ${urls.length}`,
    );
  }
  const [url] = urls;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/u.exec(url!);
  if (!match) {
    throw new Error(
      `${shapeSummary}; provider image URL was not a supported base64 data image URL`,
    );
  }
  return {
    bytes: Buffer.from(match![2]!, "base64"),
    mediaType: match![1]!,
  };
}

function hasWebpSignature(bytes: Uint8Array): boolean {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    buffer.byteLength >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function hasPngSignature(bytes: Uint8Array): boolean {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return (
    bytes.byteLength >= pngSignature.length
    && pngSignature.every((byte, index) => bytes[index] === byte)
  );
}

function requireSingleAssistantProviderRequestBody(
  requests: readonly { body: string; method: string; url: string }[],
  context: string,
): string {
  if (requests.length !== 1) {
    throw new Error(
      `${context}: expected exactly one provider request, got ${requests.length}; ${summarizeProviderRequestsForFailure(requests)}`,
    );
  }
  return requests[0]!.body;
}

function requireStableAssistantProviderRequestBody(
  requests: readonly { body: string; method: string; url: string }[],
  context: string,
): string {
  const firstRequest = requests[0] ?? null;
  if (!firstRequest) {
    throw new Error(
      `${context}: expected at least one provider request; ${summarizeProviderRequestsForFailure(requests)}`,
    );
  }

  const divergentRequest = requests.find((request) =>
    request.body !== firstRequest.body
    || request.method !== firstRequest.method
    || request.url !== firstRequest.url
  );
  if (divergentRequest) {
    throw new Error(
      `${context}: expected duplicate provider attempts to preserve the request; ${summarizeProviderRequestsForFailure(requests)}`,
    );
  }

  return firstRequest.body;
}

function summarizeProviderRequestsForFailure(
  requests: readonly { body: string; method: string; url: string }[],
): string {
  return JSON.stringify(requests.map((request) => ({
    bodyBytes: Buffer.byteLength(request.body, "utf8"),
    hasAttachmentContext: request.body.includes("Attachment context:"),
    hasDataImage: request.body.includes("data:image"),
    hasInputFile: request.body.includes("\"input_file\""),
    hasInputImage: request.body.includes("\"input_image\""),
    method: request.method,
    urlPath: safeProviderRequestUrlPath(request.url),
  })));
}

function safeProviderRequestUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "unparseable";
  }
}

function summarizeProviderTextRequestShape(rawBody: string): string {
  return JSON.stringify({
    bodyBytes: Buffer.byteLength(rawBody, "utf8"),
    hasAttachmentContext: rawBody.includes("Attachment context:"),
    hasDataImage: rawBody.includes("data:image"),
    hasInputFile: rawBody.includes("\"input_file\""),
    hasInputImage: rawBody.includes("\"input_image\""),
  });
}

function summarizeProviderFileRequestShape(
  body: Record<string, unknown>,
  rawBody: string,
): string {
  return JSON.stringify({
    hasAttachmentContext: rawBody.includes("Attachment context:"),
    hasFileData: rawBody.includes("\"file_data\""),
    hasFileId: rawBody.includes("\"file_id\""),
    hasInputFile: rawBody.includes("\"input_file\""),
    inputFileCount: collectProviderInputPartsByType(body, "input_file").length,
    inputItemCount: Array.isArray(body.input) ? body.input.length : null,
    inputTypes: collectJsonTypeFields(body).slice(0, 24),
    rawPathExtensions: Array.from(rawBody.matchAll(/attachments\/\d+\.([A-Za-z0-9]+)/gu))
      .map((match) => match[1])
      .slice(0, 8),
  });
}

function summarizeProviderImageRequestShape(
  body: Record<string, unknown>,
  rawBody: string,
): string {
  return JSON.stringify({
    hasAttachmentContext: rawBody.includes("Attachment context:"),
    hasDataImage: rawBody.includes("data:image"),
    hasEvidenceReadFallback: rawBody.includes("rich evidence could not be loaded"),
    hasInputImage: rawBody.includes("input_image"),
    inputItemCount: Array.isArray(body.input) ? body.input.length : null,
    inputTypes: collectJsonTypeFields(body).slice(0, 24),
    mimeLines: Array.from(rawBody.matchAll(/mime: (image\/[A-Za-z0-9.+-]+)/gu))
      .map((match) => match[1])
      .slice(0, 8),
    rawPathExtensions: Array.from(rawBody.matchAll(/attachments\/\d+\.([A-Za-z0-9]+)/gu))
      .map((match) => match[1])
      .slice(0, 8),
    routingImageEligible: Array.from(rawBody.matchAll(/routingImageEligible: (true|false)/gu))
      .map((match) => match[1])
      .slice(0, 8),
    routingImageReasons: Array.from(rawBody.matchAll(/routingImageReason: ([A-Za-z0-9-]+)/gu))
      .map((match) => match[1])
      .slice(0, 8),
  });
}

function summarizeGroupedWebhookProviderRequests(
  requests: readonly { body: string; method: string; url: string }[],
): string {
  return JSON.stringify(requests.map((request) => ({
    bodyBytes: Buffer.byteLength(request.body, "utf8"),
    hasFirstWebhookText: request.body.includes("U can call me Comet Rider"),
    hasSecondWebhookText: request.body.includes("I want to build more strength"),
    method: request.method,
    urlPath: safeProviderRequestUrlPath(request.url),
  })));
}

function collectJsonTypeFields(value: unknown): string[] {
  const types: string[] = [];
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.type === "string") {
      types.push(record.type);
    }
    for (const child of Object.values(record)) {
      visit(child);
    }
  };
  visit(value);
  return types;
}

function expectNoNativeAttachmentLeaks(body: string | undefined, blockedTokens: readonly string[]): void {
  const normalized = body ?? "";
  for (const token of blockedTokens) {
    expect(normalized.includes(token)).toBe(false);
  }
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

async function activateLinqWebhookMember(userId: string): Promise<ActiveLinqWebhookMember> {
  await requireScenario().seedActiveHostedLinqMember({
    homePhone: buildLinqHomePhoneNumber(userId),
    memberId: userId,
    memberPhone: buildLinqRecipientPhoneNumber(userId),
  });

  await requireScenario().runWake(buildActivationWake(userId), userId);
  await requireScenario().waitForHostedCompletion(userId);
  await requireScenario().runWake(
    buildHostedLinqSignupWelcomeWake({
      eventId: `member.activated:local:${userId}:evt_linq_webhook`,
      userId,
    }),
    userId,
  );
  await requireScenario().waitForHostedCompletion(userId);
  await requireLinqStub().waitForSend({
    expectedPath: requireLinqStub().createChatPath,
    matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
    scenario: requireScenario(),
    userId,
  });

  const chatId = requireLinqStub().requireObservedChatId(userId);
  return {
    chatId,
    replyChatPath: `/chats/${encodeURIComponent(chatId)}/messages`,
    userId,
  };
}

async function createActiveLinqWebhookMember(label: string): Promise<ActiveLinqWebhookMember> {
  const labelCounter = (linqWebhookMemberCountersByLabel.get(label) ?? 0) + 1;
  linqWebhookMemberCountersByLabel.set(label, labelCounter);
  const userId = `member_local_linq_webhook_${label}_${linqWebhookRunId}_${labelCounter}`;

  return await activateLinqWebhookMember(userId);
}

async function startLinqScenario(
  additionalEnv:
    | NodeJS.ProcessEnv
    | ((linqStub: HostedLocalLinqStub) => NodeJS.ProcessEnv) = {},
): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  const resolvedAdditionalEnv =
    typeof additionalEnv === "function" ? additionalEnv(requireLinqStub()) : additionalEnv;
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqWebhookLocalInboundAllowlist(),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
      ...resolvedAdditionalEnv,
    },
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-webhook-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq webhook e2e",
    streamLogs: streamDevLogs,
  });
}

async function restartLinqScenario(
  additionalEnv:
    | NodeJS.ProcessEnv
    | ((linqStub: HostedLocalLinqStub) => NodeJS.ProcessEnv) = {},
): Promise<void> {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
  await startLinqScenario(additionalEnv);
}

function buildLinqWebhookScenarioEnv(linq: HostedLocalLinqStub): NodeJS.ProcessEnv {
  return {
    FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
    HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
    LINQ_ATTACHMENT_CDN_BASE_URL: linq.attachmentDownloadBaseUrl,
    MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
  };
}

function buildLinqWebhookLocalInboundAllowlist(): string {
  const memberPhones = [
    "reply",
    "app-card",
    "typing-prewarm",
    "rapid",
    "group-isolation",
    "pdf",
    "image",
  ]
    .map((label) =>
      buildLinqRecipientPhoneNumber(
        `member_local_linq_webhook_${label}_${linqWebhookRunId}_1`,
      )
    );
  return [
    ...memberPhones,
    buildLinqRecipientPhoneNumber(hostedLinqGroupIsolationGuestUserId),
  ].join(",");
}
