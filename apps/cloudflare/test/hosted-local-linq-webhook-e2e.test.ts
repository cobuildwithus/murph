import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

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

const linqWebhookSecret = "linq-local-webhook-secret";
const hostedLinqVoiceNoteTranscriptText = "Remember to log the voice note";
const hostedLinqVoiceNoteAssistantReplyText = "Logged the voice note.";
const hostedLinqPdfAssistantReplyText = "Read the PDF attachment.";
const linqWebhookRunId = Date.now();

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let linqWebhookMemberCounter = 0;

interface ActiveLinqWebhookMember {
  chatId: string;
  replyChatPath: string;
  userId: string;
}

it("derives stable numeric suffixes from the full Linq user id", () => {
  expect(buildStableNumericSuffix("member_local_linq_webhook_20260408", 7)).not.toBe(
    buildStableNumericSuffix("member_local_linq_webhook_rapid_20260408", 7),
  );
});

describe("hosted local Linq webhook e2e", () => {
  beforeAll(async () => {
    await startLinqScenario((linq) => ({
      FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
      HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
      LINQ_ATTACHMENT_CDN_BASE_URL: linq.attachmentDownloadBaseUrl,
      WHISPER_COMMAND: "/app/test-parser-toolchain/whisper-cli",
      WHISPER_MODEL_PATH: "/app/test-parser-toolchain/ggml-test.bin",
    }));
  }, 300_000);

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

    requireScenario().queueAssistantResponses([HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT]);
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
    expect(assistantProviderRequests).toHaveLength(1);
    expect(assistantProviderRequests[0]?.body).toContain("U can call me Rocket Man");
  }, 300_000);

  it("keeps Linq context when two signed webhooks arrive before hosted completion catches up", async () => {
    const { chatId: materializedChatId, replyChatPath: expectedReplyChatPath, userId } =
      await createActiveLinqWebhookMember("rapid");
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;

    const firstWebhook = buildHostedLinqInboundEvent(userId, materializedChatId, {
      eventId: `evt_webhook_name_${userId}_rapid`,
      messageId: `msg_webhook_name_${userId}_rapid`,
      text: "U can call me Comet Rider",
    });
    const secondWebhook = buildHostedLinqInboundEvent(userId, materializedChatId, {
      eventId: `evt_webhook_goals_${userId}_rapid`,
      messageId: `msg_webhook_goals_${userId}_rapid`,
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

    await requireScenario().waitForLatestPendingWake(userId);
    await requireScenario().waitForHostedCompletion(userId);

    const replySends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundCountBeforeReply + 1,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId,
    });
    const newReplySends = replySends.slice(outboundCountBeforeReply);
    expect(newReplySends).toHaveLength(1);
    const groupedReplyText = requireLinqStub().readObservedMessageText(newReplySends[0]!);

    expect(groupedReplyText).toBe(
      HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
    );
    expect(groupedReplyText).not.toContain("Hey, I'm Murph");
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    expect(assistantProviderRequests).toHaveLength(1);
    expect(assistantProviderRequests[0]?.body).toContain("U can call me Comet Rider");
    expect(assistantProviderRequests[0]?.body).toContain(
      "I want to build more strength, improve endurance, and get fitter overall.",
    );
  }, 300_000);

  it("transcribes generic iMessage audio media and delivers the assistant reply", async () => {
    const { chatId: materializedChatId, replyChatPath: expectedReplyChatPath, userId } =
      await createActiveLinqWebhookMember("voice");
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const attachmentId = `att_voice_${userId}`;
    const expectedAttachmentDownloadPath =
      `/attachment-downloads/${encodeURIComponent(attachmentId)}.wav`;
    const attachmentDownloadCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
    });
    const expectedInboundDeletePath =
      `/messages/${encodeURIComponent(`msg_voice_memo_${userId}`)}`;
    const inboundDeleteCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "DELETE",
      expectedPath: expectedInboundDeletePath,
    });
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;

    requireScenario().queueAssistantResponses([hostedLinqVoiceNoteAssistantReplyText]);
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_voice_memo_${userId}`,
        messageId: `msg_voice_memo_${userId}`,
        parts: [
          {
            attachmentId,
            fileName: "Audio Message.m4a",
            mimeType: "audio/mp4",
            size: 23_000,
            type: "media",
            url: `${requireLinqStub().attachmentDownloadContainerBaseUrl}/${encodeURIComponent(attachmentId)}.m4a`,
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
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: inboundDeleteCountBeforeReply,
      expectedMethod: "DELETE",
      expectedPath: expectedInboundDeletePath,
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
      hostedLinqVoiceNoteAssistantReplyText,
    );
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    expect(assistantProviderRequests).toHaveLength(1);
    const assistantProviderBody = assistantProviderRequests[0]?.body ?? "";
    expect(assistantProviderBody).toContain(hostedLinqVoiceNoteTranscriptText);
    expect(assistantProviderBody).not.toContain(attachmentId);
    expect(assistantProviderBody).not.toContain(expectedAttachmentDownloadPath);
  }, 300_000);

  it("keeps PDF-only iMessage media replyable by exposing bounded local PDF evidence", async () => {
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
    const expectedInboundDeletePath =
      `/messages/${encodeURIComponent(`msg_pdf_${userId}`)}`;
    const inboundDeleteCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "DELETE",
      expectedPath: expectedInboundDeletePath,
    });
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;

    requireScenario().queueAssistantResponses([hostedLinqPdfAssistantReplyText]);
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
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: inboundDeleteCountBeforeReply,
      expectedMethod: "DELETE",
      expectedPath: expectedInboundDeletePath,
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
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    expect(assistantProviderRequests).toHaveLength(1);
    const providerBody = parseAssistantProviderRequestBody(assistantProviderRequests[0]?.body);
    const providerInput = Array.isArray(providerBody.input) ? providerBody.input : [];
    const inputFiles = providerInput.flatMap((item) => {
      if (!item || typeof item !== "object" || !("content" in item)) {
        return [];
      }
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content)
        ? content.filter((part) =>
            part
              && typeof part === "object"
              && (part as { type?: unknown }).type === "input_file"
          )
        : [];
    });
    expect(inputFiles).toEqual([]);
    expect(assistantProviderRequests[0]?.body).toContain("raw/assistant-input/");
    expect(assistantProviderRequests[0]?.body).toContain("attachments/001.pdf");
    expect(assistantProviderRequests[0]?.body).toContain("storedPath");
    expectNoNativeAttachmentLeaks(assistantProviderRequests[0]?.body, [
      attachmentId,
      expectedAttachmentDownloadPath,
      expectedAttachmentDownloadUrl,
      "pdfEvidencePath:",
      "stub-local-openai-key",
      "OPENAI_API_KEY",
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

function parseAssistantProviderRequestBody(body: string | undefined): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body ?? "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function expectNoNativeAttachmentLeaks(body: string | undefined, blockedTokens: readonly string[]): void {
  const normalized = body ?? "";
  for (const token of blockedTokens) {
    expect(normalized).not.toContain(token);
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
    userId,
  };
}

async function createActiveLinqWebhookMember(label: string): Promise<ActiveLinqWebhookMember> {
  linqWebhookMemberCounter += 1;
  const userId = `member_local_linq_webhook_${label}_${linqWebhookRunId}_${linqWebhookMemberCounter}`;

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

function buildLinqWebhookLocalInboundAllowlist(): string {
  return ["reply", "rapid", "voice", "pdf"]
    .map((label, index) =>
      buildLinqRecipientPhoneNumber(
        `member_local_linq_webhook_${label}_${linqWebhookRunId}_${index + 1}`,
      )
    )
    .join(",");
}
