import { createHash } from "node:crypto";

import { buildHostedExecutionLinqConversationMessageWake, buildHostedExecutionMemberActivatedWake } from "@murphai/hosted-execution";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildHostedLinqSignupWelcomeWake,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  postHostedLocalLinqWebhook,
  requireLinqPhoneLookupKey,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";
import {
  listHostedRuntimeLogsForTest,
  readHostedLinqFirstTurnDeliveryForTest,
  seedHostedLinqHeldFirstTurnForTest,
  signalHostedMailboxAppendRuntimeForTest,
} from "#hosted-web-testing";

vi.mock("server-only", () => ({}));

const runId = Date.now();
const laterMessageUserId = `member_local_first_turn_held_later_${runId}`;
const loneMessageUserId = `member_local_first_turn_held_lone_${runId}`;
const nativeReplyUserId = `member_local_first_turn_held_native_${runId}`;
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-first-turn-held-secret";
const vetoCode = "HOSTED_LINQ_INSTANT_FIRST_TURN_OWNS_REPLY";
const supersededCode = "HOSTED_LINQ_INSTANT_FIRST_TURN_ALREADY_ANSWERED";

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

// The first turn's OpenAI call has a fixed endpoint, so this seeds the rejected
// retry through the delivery owners. Everything after that row is the real path.
describe("hosted local Linq held first turn e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1000",
        HOSTED_ONBOARDING_LINQ_INSTANT_START_PHONE_PREFIXES: "+155550",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          [laterMessageUserId, loneMessageUserId, nativeReplyUserId]
            .map(buildLinqRecipientPhoneNumber).join(","),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl: process.env.DATABASE_URL?.trim() || undefined,
      persistDirOverride: process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null,
      persistDirPrefix: "murph-hosted-local-linq-first-turn-held-",
      requiredRunnerEnvProfile: "linq",
      // The harness creates a fresh database for each run, so nothing needs resetting.
      resetLocalDatabase: false,
      scenarioLabel: "Local hosted Linq held first turn e2e",
      streamLogs: process.env.MURPH_E2E_STREAM_DEV_LOGS === "1",
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("answers a later message on the first model run and never sends the held reply", async () => {
    const userId = laterMessageUserId;
    const { chatId, replyPath } = await createActiveLinqMember(userId);
    const heldEventId = `evt_first_turn_held_later_${runId}`;
    const heldText = `Held first message ${runId}`;
    const laterText = `Later message ${runId}`;
    const replyText = "One reply to the later message.";

    await seedHeldFirstMessage({ chatId, eventId: heldEventId, text: heldText, userId });
    requireScenario().queueAssistantResponses([replyText], {
      matchInputContains: [heldText, laterText],
    });
    const sendBaseline = requireLinqStub().countAcceptedSends(replyPath);

    const later = await postSignedWebhook(buildInboundEvent({
      chatId, eventId: `evt_first_turn_later_${runId}`, text: laterText, userId,
    }));
    expect(later.status).toBe(202);

    const reply = await requireLinqStub().waitForAdditionalAcceptedSend({
      baselineCount: sendBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);
    await requireScenario().waitForHostedCompletion(userId);

    // One turn covers both inputs, so the veto never spends a second model run.
    expect(listModelRuns(laterText)).toHaveLength(1);
    expect(listModelRuns(laterText)[0]?.body).toContain(heldText);
    expect(await countLogEntries(userId, vetoCode)).toBe(0);

    // A replay of the held input is refused at its claim, before any send attempt.
    const observedSends = requireLinqStub().countObservedSends(replyPath);
    const replay = await postSignedWebhook(buildInboundEvent({
      chatId, eventId: heldEventId, text: heldText, userId,
    }));
    expect(replay.status).toBe(503);
    await expect(replay.json()).resolves.toMatchObject({
      error: { details: { reason: "delivery-in-flight" } },
    });
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(observedSends);
    expect(requireLinqStub().countAcceptedSends(replyPath)).toBe(sendBaseline + 1);
    await expect(readHeldRow({ eventId: heldEventId })).resolves.toMatchObject({
      acceptedAt: null,
      failureCode: "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY_REJECTED",
      status: "failed",
    });
  }, 600_000);

  it("ends a reply aimed at a held input when the later message runs in its own turn", async () => {
    const userId = nativeReplyUserId;
    const { chatId, replyPath } = await createActiveLinqMember(userId);
    const heldEventId = `evt_first_turn_held_native_${runId}`;
    const heldText = `Held message before a native reply ${runId}`;
    const laterText = `Native reply after the held message ${runId}`;
    const replyText = "One reply to the native reply.";

    await seedHeldFirstMessage({ chatId, eventId: heldEventId, text: heldText, userId });
    requireScenario().queueAssistantResponses(["This reply must not be sent."], {
      matchInputContains: heldText,
    });
    requireScenario().queueAssistantResponses([replyText], { matchInputContains: laterText });
    const sendBaseline = requireLinqStub().countAcceptedSends(replyPath);

    // A different native reply anchor keeps the later message out of the held input's turn.
    const later = await postSignedWebhook(buildHostedLinqInboundEvent(userId, chatId, {
      eventId: `evt_first_turn_native_${runId}`,
      messageId: `msg_evt_first_turn_native_${runId}`,
      replyToMessageId: `msg_earlier_reply_${runId}`,
      service: "iMessage",
      text: laterText,
    }));
    expect(later.status).toBe(202);

    const reply = await requireLinqStub().waitForAdditionalAcceptedSend({
      baselineCount: sendBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);
    await requireScenario().waitForHostedCompletion(userId);

    // The later turn's history can repeat the held text, so only the first run shows
    // that the held input ran alone. Its reply must end without a send or a retry.
    const firstHeldRun = listModelRuns(heldText)[0];
    expect({
      acceptedSends: requireLinqStub().countAcceptedSends(replyPath) - sendBaseline,
      firstRunHeldAlone: firstHeldRun !== undefined && !firstHeldRun.body.includes(laterText),
      laterRuns: listModelRuns(laterText).length,
      supersededReplies: await countLogEntries(userId, supersededCode),
      vetoes: await countLogEntries(userId, vetoCode),
    }).toEqual({
      acceptedSends: 1,
      firstRunHeldAlone: true,
      laterRuns: 1,
      supersededReplies: 1,
      vetoes: 0,
    });
  }, 600_000);

  it("keeps vetoing a lone held first message", async () => {
    const userId = loneMessageUserId;
    const { chatId, replyPath } = await createActiveLinqMember(userId);
    const heldEventId = `evt_first_turn_held_lone_${runId}`;
    const heldText = `Lone held first message ${runId}`;

    const append = await seedHeldFirstMessage({ chatId, eventId: heldEventId, text: heldText, userId });
    requireScenario().queueAssistantResponses(["This reply must not be sent."], {
      matchInputContains: heldText,
    });
    const sendBaseline = requireLinqStub().countAcceptedSends(replyPath);

    await signalHostedMailboxAppendRuntimeForTest({
      environment: requireScenario().runtimeEnv,
      expectedUserId: userId,
      mailboxItemId: append.wake.id,
    });
    await vi.waitFor(async () => {
      expect(await countLogEntries(userId, vetoCode)).toBeGreaterThan(0);
    }, { interval: 2_000, timeout: 240_000 });

    expect(listModelRuns(heldText).length).toBeGreaterThan(0);
    expect(requireLinqStub().countAcceptedSends(replyPath)).toBe(sendBaseline);
  }, 600_000);
});

async function createActiveLinqMember(userId: string): Promise<{ chatId: string; replyPath: string }> {
  await requireScenario().seedActiveHostedLinqMember({
    homePhone: buildLinqHomePhoneNumber(userId),
    memberId: userId,
    memberPhone: buildLinqRecipientPhoneNumber(userId),
  });
  await requireScenario().runWake(buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:held`,
    memberChannels: { email: false, linq: true, telegram: false },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  }), userId);
  await requireScenario().waitForHostedCompletion(userId);
  await requireScenario().runWake(buildHostedLinqSignupWelcomeWake({
    eventId: `member.activated:local:${userId}:held-welcome`,
    userId,
  }), userId);
  await requireScenario().waitForHostedCompletion(userId);
  await requireLinqStub().waitForSend({
    expectedPath: requireLinqStub().createChatPath,
    matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
    scenario: requireScenario(),
    userId,
  });
  const chatId = requireLinqStub().requireObservedChatId(userId);
  await requireScenario().bindActiveHostedLinqHomeChat({
    chatId,
    memberId: userId,
    recipientPhone: buildLinqRecipientPhoneNumber(userId),
  });
  return { chatId, replyPath: `/chats/${encodeURIComponent(chatId)}/messages` };
}

async function seedHeldFirstMessage(input: {
  chatId: string;
  eventId: string;
  text: string;
  userId: string;
}) {
  await seedHostedLinqHeldFirstTurnForTest({
    chatId: input.chatId,
    environment: requireScenario().runtimeEnv,
    eventId: input.eventId,
    idempotencyKey: firstTurnIdempotencyKey(input.eventId),
    memberId: input.userId,
  });
  return await requireScenario().enqueueWake(buildHostedExecutionLinqConversationMessageWake({
    eventId: input.eventId,
    linqMessage: {
      chatId: input.chatId,
      from: buildLinqRecipientPhoneNumber(input.userId),
      isFromMe: false,
      messageId: `msg_${input.eventId}`,
      parts: [{ type: "text", value: input.text }],
      service: "iMessage",
      threadIsDirect: true,
    },
    occurredAt: new Date().toISOString(),
    phoneLookupKey: requireLinqPhoneLookupKey(input.userId),
    userId: input.userId,
  }), input.userId);
}

function firstTurnIdempotencyKey(eventId: string): string {
  const digest = createHash("sha256").update(eventId).digest("hex").slice(0, 32);
  return `linq-instant-first-turn-v1-${digest}`;
}

function buildInboundEvent(input: { chatId: string; eventId: string; text: string; userId: string }) {
  return buildHostedLinqInboundEvent(input.userId, input.chatId, {
    eventId: input.eventId,
    messageId: `msg_${input.eventId}`,
    service: "iMessage",
    text: input.text,
  });
}

function postSignedWebhook(event: Record<string, unknown>): Promise<Response> {
  return postHostedLocalLinqWebhook({
    event,
    secret: linqWebhookSecret,
    webBaseUrl: requireScenario().harness.webBaseUrl,
  });
}

function readHeldRow(input: { eventId: string }) {
  return readHostedLinqFirstTurnDeliveryForTest({
    environment: requireScenario().runtimeEnv,
    idempotencyKey: firstTurnIdempotencyKey(input.eventId),
  });
}

function listModelRuns(text: string) {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.method === "POST"
    && request.url === "/v1/responses"
    && request.requestKind === "turn"
    && request.body.includes(text)
  );
}

async function countLogEntries(userId: string, code: string): Promise<number> {
  const logs = await listHostedRuntimeLogsForTest({
    environment: requireScenario().runtimeEnv,
    limit: 1_500,
    userId,
  });
  return logs.filter((entry) => JSON.stringify(entry.redactedJson ?? {}).includes(code)).length;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) throw new Error("Hosted local Linq stub was not initialized.");
  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) throw new Error("Hosted local full-stack scenario was not initialized.");
  return scenario;
}
