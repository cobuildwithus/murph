import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  DEFAULT_DATABASE_URL,
} from "../../../scripts/dev-hosted-local/constants.ts";
import {
  buildHostedAssistantNotificationDecisionResponse,
  buildStableNumericSuffix,
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
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const webhookUserId = `member_local_linq_webhook_${Date.now()}`;
const linqWebhookSecret = "linq-local-webhook-secret";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let activeLinqMember: ActiveLinqWebhookMember | null = null;

interface ActiveLinqWebhookMember {
  chatId: string;
  replyChatPath: string;
}

it("derives stable numeric suffixes from the full Linq user id", () => {
  expect(buildStableNumericSuffix("member_local_linq_webhook_20260408", 7)).not.toBe(
    buildStableNumericSuffix("member_local_linq_webhook_rapid_20260408", 7),
  );
});

describe("hosted local Linq webhook e2e", () => {
  beforeAll(async () => {
    await startLinqScenario((linq) => ({
      LINQ_ATTACHMENT_CDN_BASE_URL: linq.attachmentDownloadBaseUrl,
    }));
    activeLinqMember = await activateLinqWebhookMember(webhookUserId);
  }, 300_000);

  afterAll(async () => {
    activeLinqMember = null;
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("routes a signed Linq webhook through apps/web and delivers the follow-up reply", async () => {
    const { chatId: materializedChatId, replyChatPath } = requireActiveLinqMember();
    const expectedReplyChatPath = replyChatPath;
    const typingPath = `/chats/${encodeURIComponent(materializedChatId)}/typing`;
    const typingCountBeforeWebhook = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: typingPath,
    });
    const observedMessageIdsBeforeReply =
      requireLinqStub().listObservedMessageIds(materializedChatId).length;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;
    const inboundMessageId = `msg_webhook_${webhookUserId}`;
    const webhookEvent = buildHostedLinqInboundEvent(webhookUserId, materializedChatId, {
      eventId: `evt_webhook_${webhookUserId}`,
      messageId: inboundMessageId,
      text: "U can call me Rocket Man",
    });

    requireScenario().queueAssistantResponses([HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT]);
    const webhookResponse = await postSignedLinqWebhook(webhookEvent);
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: typingPath,
    })).toBeGreaterThanOrEqual(typingCountBeforeWebhook + 1);

    await requireScenario().waitForLatestPendingWake(webhookUserId);
    await requireScenario().waitForHostedCompletion(webhookUserId);

    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId: webhookUserId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT,
    );
    const outboundReplyMessageId =
      requireLinqStub().listObservedMessageIds(materializedChatId)[observedMessageIdsBeforeReply] ?? null;
    expect(outboundReplyMessageId).not.toBeNull();
    for (const messageId of [inboundMessageId, outboundReplyMessageId!]) {
      await requireLinqStub().waitForMatchingRequestCount({
        expectedCount: 1,
        expectedMethod: "DELETE",
        expectedPath: `/messages/${encodeURIComponent(messageId)}`,
        scenario: requireScenario(),
        userId: webhookUserId,
      });
    }
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    expect(assistantProviderRequests).toHaveLength(1);
    expect(assistantProviderRequests[0]?.body).toContain("U can call me Rocket Man");
  }, 300_000);

  it("keeps Linq context when two signed webhooks arrive before hosted completion catches up", async () => {
    const { chatId: materializedChatId, replyChatPath: expectedReplyChatPath } =
      requireActiveLinqMember();
    const observedMessageIdsBeforeReply =
      requireLinqStub().listObservedMessageIds(materializedChatId).length;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;

    const firstInboundMessageId = `msg_webhook_name_${webhookUserId}_rapid`;
    const firstWebhook = buildHostedLinqInboundEvent(webhookUserId, materializedChatId, {
      eventId: `evt_webhook_name_${webhookUserId}_rapid`,
      messageId: firstInboundMessageId,
      text: "U can call me Comet Rider",
    });
    const secondInboundMessageId = `msg_webhook_goals_${webhookUserId}_rapid`;
    const secondWebhook = buildHostedLinqInboundEvent(webhookUserId, materializedChatId, {
      eventId: `evt_webhook_goals_${webhookUserId}_rapid`,
      messageId: secondInboundMessageId,
      text: "I want to build more strength, improve endurance, and get fitter overall.",
    });

    requireScenario().queueAssistantResponses([HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT]);
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

    await requireScenario().waitForLatestPendingWake(webhookUserId);
    await requireScenario().waitForHostedCompletion(webhookUserId);

    const replySends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundCountBeforeReply + 1,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId: webhookUserId,
    });
    const newReplySends = replySends.slice(outboundCountBeforeReply);
    expect(newReplySends).toHaveLength(1);
    const groupedReplyText = requireLinqStub().readObservedMessageText(newReplySends[0]!);

    expect(groupedReplyText).toBe(
      HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
    );
    expect(groupedReplyText).not.toContain("Hey, I'm Murph");
    const outboundReplyMessageId =
      requireLinqStub().listObservedMessageIds(materializedChatId)[observedMessageIdsBeforeReply] ?? null;
    expect(outboundReplyMessageId).not.toBeNull();
    for (const messageId of [firstInboundMessageId, secondInboundMessageId, outboundReplyMessageId!]) {
      await requireLinqStub().waitForMatchingRequestCount({
        expectedCount: 1,
        expectedMethod: "DELETE",
        expectedPath: `/messages/${encodeURIComponent(messageId)}`,
        scenario: requireScenario(),
        userId: webhookUserId,
      });
    }
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    expect(assistantProviderRequests).toHaveLength(1);
    expect(assistantProviderRequests[0]?.body).toContain("U can call me Comet Rider");
    expect(assistantProviderRequests[0]?.body).toContain(
      "I want to build more strength, improve endurance, and get fitter overall.",
    );
  }, 300_000);

  it("hydrates a metadata-only Linq voice memo through the local attachment API and drains without a transcript", async () => {
    const { chatId: materializedChatId, replyChatPath: expectedReplyChatPath } =
      requireActiveLinqMember();
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const attachmentId = `att_voice_${webhookUserId}`;
    const expectedAttachmentMetadataPath = `/attachments/${encodeURIComponent(attachmentId)}`;
    const expectedAttachmentDownloadPath =
      `/attachment-downloads/${encodeURIComponent(attachmentId)}.wav`;
    const attachmentMetadataCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentMetadataPath,
    });
    const attachmentDownloadCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
    });
    const expectedInboundDeletePath =
      `/messages/${encodeURIComponent(`msg_voice_memo_${webhookUserId}`)}`;
    const inboundDeleteCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "DELETE",
      expectedPath: expectedInboundDeletePath,
    });
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      webhookUserId,
      materializedChatId,
      {
        eventId: `evt_voice_memo_${webhookUserId}`,
        messageId: `msg_voice_memo_${webhookUserId}`,
        parts: [
          {
            attachmentId,
            fileName: `${attachmentId}.wav`,
            mimeType: "audio/wav",
            type: "voice_memo",
          },
        ],
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(webhookUserId);
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: attachmentMetadataCountBeforeReply,
      expectedMethod: "GET",
      expectedPath: expectedAttachmentMetadataPath,
      scenario: requireScenario(),
      userId: webhookUserId,
    });
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: attachmentDownloadCountBeforeReply,
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
      scenario: requireScenario(),
      userId: webhookUserId,
    });
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: inboundDeleteCountBeforeReply,
      expectedMethod: "DELETE",
      expectedPath: expectedInboundDeletePath,
      scenario: requireScenario(),
      userId: webhookUserId,
    });
    const finalStatus = await requireScenario().waitForHostedCompletion(webhookUserId);
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingIngressEventCount).toBe(0);
    expect(finalStatus.inFlight).toBe(false);
    expect(finalStatus.bundleRef).not.toBeNull();

    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    expect(assistantProviderRequests).toHaveLength(0);
    expect(requireLinqStub().countObservedSends(expectedReplyChatPath)).toBe(
      outboundCountBeforeReply,
    );
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

function requireActiveLinqMember(): ActiveLinqWebhookMember {
  if (!activeLinqMember) {
    throw new Error("Hosted local active Linq member was not initialized.");
  }

  return activeLinqMember;
}

async function activateLinqWebhookMember(userId: string): Promise<ActiveLinqWebhookMember> {
  await requireScenario().seedActiveHostedLinqMember({
    homePhone: buildLinqHomePhoneNumber(userId),
    memberId: userId,
    memberPhone: buildLinqRecipientPhoneNumber(userId),
  });

  await requireScenario().runWake(buildActivationWake(userId), userId);
  await requireScenario().waitForHostedCompletion(userId);
  requireScenario().queueAssistantResponses([
    buildHostedAssistantNotificationDecisionResponse({
      privateSummary: "deliver signup welcome",
      text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
    }),
  ]);
  await requireScenario().runWake(
    buildHostedLinqSignupWelcomeWake({
      eventId: `assistant.notification.requested:local:${userId}:evt_linq_webhook`,
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
  };
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
      HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC: "1",
      LINQ_API_BASE_URL: requireLinqStub().baseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
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
