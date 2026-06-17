import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
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
  readHostedLocalLinqImagePngBytes,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const linqWebhookSecret = "linq-local-webhook-secret";
const hostedLinqVoiceNoteTranscriptText = "Remember to log the voice note";
const hostedLinqImageAssistantReplyText = "Reviewed the image attachment.";
const hostedLinqVoiceNoteAssistantReplyText = "Logged the voice note.";
const hostedLinqPdfAssistantReplyText = "Read the PDF attachment.";
const linqWebhookRunId = Date.now();

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
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
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
    const assistantProviderBody = requireSingleAssistantProviderRequestBody(
      assistantProviderRequests,
      "nickname webhook provider request",
    );
    expect(
      assistantProviderBody.includes("U can call me Rocket Man"),
      summarizeProviderTextRequestShape(assistantProviderBody),
    ).toBe(true);
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
    expect(
      assistantProviderRequests.length,
      summarizeGroupedWebhookProviderRequests(assistantProviderRequests),
    ).toBeGreaterThan(0);
    const assistantProviderBodies = assistantProviderRequests.map((request) => request.body);
    expect(assistantProviderBodies.some((body) =>
      body.includes("U can call me Comet Rider")
    )).toBe(true);
    expect(assistantProviderBodies.some((body) =>
      body.includes("I want to build more strength, improve endurance, and get fitter overall.")
    )).toBe(true);
  }, 300_000);

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

    requireScenario().queueAssistantResponses([hostedLinqImageAssistantReplyText]);
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
    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    const assistantProviderBody = requireSingleAssistantProviderRequestBody(
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

  it("keeps audio-only iMessage media replyable with bounded attachment context", async () => {
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
    expect(assistantProviderBody.includes("fileName: Audio Message.m4a")).toBe(true);
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

function summarizeProviderAudioRequestShape(rawBody: string): string {
  return JSON.stringify({
    hasAttachmentContext: rawBody.includes("Attachment context:"),
    hasAudioFileName: rawBody.includes("fileName: Audio Message.m4a"),
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
      // Temporal is the only hosted wake authority, and the hosted-local test
      // worker entrypoint provides the deterministic fake AI binding the
      // audio transcription path needs.
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
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
  return ["reply", "rapid", "pdf", "image", "voice"]
    .map((label) =>
      buildLinqRecipientPhoneNumber(
        `member_local_linq_webhook_${label}_${linqWebhookRunId}_1`,
      )
    )
    .join(",");
}
