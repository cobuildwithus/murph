import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildHostedLinqSignupWelcomeWake,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const linqWebhookSecret = "linq-local-webhook-audio-secret";
const hostedLinqVoiceNoteTranscriptText = "Remember to log the voice note";
const hostedLinqVoiceNoteAssistantReplyText = "Logged the voice note.";
const runId = Date.now();

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

interface ActiveLinqWebhookMember {
  chatId: string;
  replyChatPath: string;
  userId: string;
}

describe("hosted local Linq webhook audio e2e", () => {
  beforeAll(async () => {
    await startLinqScenario();
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("keeps audio-only iMessage media replyable with bounded attachment context", async () => {
    const { chatId: materializedChatId, replyChatPath: expectedReplyChatPath, userId } =
      await createActiveLinqWebhookMember();
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const attachmentId = `att_voice_${userId}`;
    const expectedAttachmentDownloadPath =
      `/attachment-downloads/${encodeURIComponent(attachmentId)}.wav`;
    const attachmentDownloadCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
    });
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;

    requireScenario().queueAssistantResponses([hostedLinqVoiceNoteAssistantReplyText], {
      matchInputContains: "Audio Message.wav",
    });
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_voice_memo_${userId}`,
        messageId: `msg_voice_memo_${userId}`,
        parts: [
          {
            attachmentId,
            fileName: "Audio Message.wav",
            mimeType: "audio/wav",
            size: 23_000,
            type: "media",
            url: `${requireLinqStub().attachmentDownloadContainerBaseUrl}/${encodeURIComponent(attachmentId)}.wav`,
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
      hostedLinqVoiceNoteAssistantReplyText,
    );
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    const assistantProviderBody = requireSingleAssistantProviderRequestBody(
      assistantProviderRequests,
      "audio media provider request",
    );
    expect(assistantProviderBody.includes("Attachment context:")).toBe(true);
    expect(assistantProviderBody.includes("fileName: Audio Message.wav")).toBe(true);
    expect(
      assistantProviderBody.includes(hostedLinqVoiceNoteTranscriptText),
      summarizeProviderAudioRequestShape(assistantProviderBody),
    ).toBe(true);
    expect(assistantProviderBody.includes("raw evidence: not_attempted")).toBe(false);
    expectNoNativeAttachmentLeaks(assistantProviderBody, [
      attachmentId,
      expectedAttachmentDownloadPath,
    ]);
  }, 300_000);
});

async function createActiveLinqWebhookMember(): Promise<ActiveLinqWebhookMember> {
  const userId = `member_local_linq_webhook_voice_${runId}_1`;
  await requireScenario().seedActiveHostedLinqMember({
    homePhone: buildLinqHomePhoneNumber(userId),
    memberId: userId,
    memberPhone: buildLinqRecipientPhoneNumber(userId),
  });

  await requireScenario().runWake(buildActivationWake(userId), userId);
  await requireScenario().waitForHostedCompletion(userId);
  await requireScenario().runWake(
    buildHostedLinqSignupWelcomeWake({
      eventId: `member.activated:local:${userId}:evt_linq_webhook_audio`,
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

async function startLinqScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
      HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(`member_local_linq_webhook_voice_${runId}_1`),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      LINQ_ATTACHMENT_CDN_BASE_URL: requireLinqStub().attachmentDownloadBaseUrl,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
    },
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-webhook-audio-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq webhook audio e2e",
    streamLogs: streamDevLogs,
    testControls: true,
  });
}

function buildActivationWake(userId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_linq_webhook_audio_activation`,
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

function summarizeProviderRequestsForFailure(
  requests: readonly { body: string; method: string; url: string }[],
): string {
  return JSON.stringify(requests.map((request) => ({
    bodyBytes: Buffer.byteLength(request.body, "utf8"),
    hasAttachmentContext: request.body.includes("Attachment context:"),
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

function summarizeProviderAudioRequestShape(rawBody: string): string {
  return JSON.stringify({
    hasAttachmentContext: rawBody.includes("Attachment context:"),
    hasAudioFileName: rawBody.includes("fileName: Audio Message.wav"),
    hasParserPendingStatus: rawBody.includes(
      "Attachment parser status: audio/video transcript is not available yet.",
    ),
    hasRawInboxPath: rawBody.includes("raw/inbox/"),
    hasStoredPath: rawBody.includes("storedPath:"),
    hasTranscript: rawBody.includes(hostedLinqVoiceNoteTranscriptText),
    parseStates: Array.from(rawBody.matchAll(/parseState: ([A-Za-z0-9_-]+)/gu))
      .map((match) => match[1])
      .slice(0, 8),
    rawEvidenceStates: Array.from(rawBody.matchAll(/- raw evidence: ([A-Za-z0-9_-]+)/gu))
      .map((match) => match[1])
      .slice(0, 8),
  });
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
