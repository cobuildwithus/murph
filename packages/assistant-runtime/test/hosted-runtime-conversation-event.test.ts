import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionWhatsAppConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  createHostedLinqAttachmentDownloadDriver: vi.fn(),
  createHostedTelegramAttachmentDownloadDriver: vi.fn(),
  createHostedTelegramEffectsAttachmentDownloadDriver: vi.fn(),
  logHostedTelegramAttachmentDownloadUnavailable: vi.fn(),
  createInboxPipeline: vi.fn(),
  normalizeHostedEmailConversationCapture: vi.fn(),
  normalizeHostedLinqConversationCapture: vi.fn(),
  normalizeHostedTelegramConversationCapture: vi.fn(),
  normalizeHostedWhatsAppConversationCapture: vi.fn(),
  openInboxRuntime: vi.fn(),
  readHostedRawEmailMessage: vi.fn(),
  resolveHostedEmailSelfAddresses: vi.fn(),
}));

vi.mock("@murphai/inboxd/runtime", () => ({
  createInboxPipeline: mocks.createInboxPipeline,
  openInboxRuntime: mocks.openInboxRuntime,
}));

vi.mock("@murphai/inboxd/connectors/hosted-conversation", () => ({
  normalizeHostedEmailConversationCapture: mocks.normalizeHostedEmailConversationCapture,
  normalizeHostedLinqConversationCapture: mocks.normalizeHostedLinqConversationCapture,
  normalizeHostedTelegramConversationCapture: mocks.normalizeHostedTelegramConversationCapture,
  normalizeHostedWhatsAppConversationCapture: mocks.normalizeHostedWhatsAppConversationCapture,
}));

vi.mock("../src/hosted-runtime/events/email.ts", () => ({
  readHostedRawEmailMessage: mocks.readHostedRawEmailMessage,
}));

vi.mock("../src/hosted-runtime/events/linq.ts", () => ({
  createHostedLinqAttachmentDownloadDriver: mocks.createHostedLinqAttachmentDownloadDriver,
  HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS: 5_000,
  withHostedLinqAttachmentDownloadRetry: (
    driver: unknown,
  ) => driver,
}));

vi.mock("../src/hosted-runtime/events/telegram.ts", () => ({
  createHostedTelegramAttachmentDownloadDriver: mocks.createHostedTelegramAttachmentDownloadDriver,
  createHostedTelegramEffectsAttachmentDownloadDriver:
    mocks.createHostedTelegramEffectsAttachmentDownloadDriver,
  logHostedTelegramAttachmentDownloadUnavailable:
    mocks.logHostedTelegramAttachmentDownloadUnavailable,
  withHostedTelegramAttachmentDownloadLogging: (
    driver: unknown,
  ) => driver,
  withHostedTelegramAttachmentDownloadRetry: (
    driver: unknown,
  ) => driver,
}));

vi.mock("@murphai/hosted-execution/hosted-email", () => ({
  resolveHostedEmailSelfAddresses: mocks.resolveHostedEmailSelfAddresses,
}));

import {
  importHostedConversationMessageWakeIntoLocalInbox,
} from "../src/hosted-runtime/events/conversation.ts";

function createRuntime() {
  return {
    forwardedEnv: {},
    userEnv: {},
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      deviceSyncPort: null,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageRecordPort: null,
    },
    platformEnv: {},
  } as const;
}

beforeEach(() => {
  mocks.createHostedTelegramEffectsAttachmentDownloadDriver.mockReturnValue(null);
  mocks.logHostedTelegramAttachmentDownloadUnavailable.mockResolvedValue(undefined);
  mocks.openInboxRuntime.mockResolvedValue({
    close: vi.fn(),
  });
  mocks.createInboxPipeline.mockImplementation(async (input) => ({
    close: vi.fn(),
    processCapture: vi.fn(async () => {
      return {
        captureId: "capture_123",
        createdAt: "2026-04-08T00:00:00.000Z",
        deduped: false,
        sourceDirectory: "raw/inbox/linq/capture_123",
        eventId: "evt_capture_123",
      };
    }),
    runtime: input.runtime,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("importHostedConversationMessageWakeIntoLocalInbox", () => {
  it("normalizes each hosted conversation wake directly before parsed inbox persistence", async () => {
    const baseRuntime = createRuntime();
    const providerFetch = vi.fn<typeof fetch>();
    const runtime = {
      ...baseRuntime,
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        OPENAI_API_KEY: "sk-runtime",
      },
      userEnv: {
        LINQ_ATTACHMENT_CDN_BASE_URL: "http://169.254.169.254/attachment-downloads",
      },
      platform: {
        ...baseRuntime.platform,
        providerFetch,
      },
      platformEnv: {
        LINQ_ATTACHMENT_CDN_BASE_URL: "https://cdn.linq.example/attachment-downloads",
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
    };
    const vaultRoot = "/tmp/assistant-runtime-conversation";
    const processCapture = vi.fn(async (capture: unknown) => {
      expect(capture).toBeDefined();
      return {
        captureId: "capture_123",
        createdAt: "2026-04-08T00:00:00.000Z",
        deduped: false,
        sourceDirectory: "raw/inbox/linq/capture_123",
        eventId: "evt_capture_123",
      };
    });
    const pipelineClose = vi.fn();
    mocks.createInboxPipeline.mockImplementation(async (input) => ({
      close: pipelineClose,
      processCapture: vi.fn(async (capture) => {
        return processCapture(capture);
      }),
      runtime: input.runtime,
    }));

    const linqWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq",
      linqMessage: {
        chatId: "chat_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_real_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "15551234567",
      userId: "member_123",
    });
    const linqDriver = {
      downloadUrl: vi.fn(),
    };
    const linqCapture = {
      accountId: "15551234567",
      attachments: [],
      actor: {
        isSelf: false,
      },
      externalId: "linq:msg_real_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      raw: {},
      source: "linq",
      text: "hello",
      thread: {
        id: "chat_123",
      },
    };
    mocks.createHostedLinqAttachmentDownloadDriver.mockReturnValueOnce(linqDriver);
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce(linqCapture);
    const linqImport = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime,
      vaultRoot,
      wake: linqWake,
    });

    const telegramWake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_telegram",
      occurredAt: "2026-04-08T00:01:00.000Z",
      telegramMessage: {
        messageId: "tg_message_123",
        replyContextPreview: "Replying to: Earlier message",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "chat_123",
      },
      userId: "member_123",
    });
    const telegramDriver = {
      downloadFile: vi.fn(),
      getFile: vi.fn(),
    };
    const telegramCapture = { source: "telegram" };
    mocks.createHostedTelegramAttachmentDownloadDriver.mockReturnValueOnce(telegramDriver);
    mocks.normalizeHostedTelegramConversationCapture.mockResolvedValueOnce(telegramCapture);
    await importHostedConversationMessageWakeIntoLocalInbox({
      runtime,
      vaultRoot,
      wake: telegramWake,
    });

    const emailWake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:02:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "user@example.com",
      userId: "member_123",
    });
    const rawEmailMessage = Uint8Array.from([1, 2, 3]);
    const selfAddresses = [
      "assistant@mail.example.test",
      "user@example.com",
    ];
    const emailCapture = {
      attachments: [],
      source: "email",
      text: null,
    };
    mocks.readHostedRawEmailMessage.mockResolvedValueOnce(rawEmailMessage);
    mocks.resolveHostedEmailSelfAddresses.mockReturnValueOnce(selfAddresses);
    mocks.normalizeHostedEmailConversationCapture.mockResolvedValueOnce(emailCapture);
    await importHostedConversationMessageWakeIntoLocalInbox({
      runtime,
      vaultRoot,
      wake: emailWake,
    });

    const whatsappWake = buildHostedExecutionWhatsAppConversationMessageWake({
      eventId: "evt_whatsapp",
      occurredAt: "2026-04-08T00:03:00.000Z",
      userId: "member_123",
      whatsappMessage: {
        fromWaId: "15551234567",
        messageId: "wamid.test",
        phoneNumberId: "phone-number-id",
        schema: "murph.hosted-whatsapp-message.v1",
        text: "CHECKIN",
        threadId: "15551234567",
      },
    });
    const whatsappCapture = { source: "whatsapp" };
    mocks.normalizeHostedWhatsAppConversationCapture.mockResolvedValueOnce(whatsappCapture);
    await importHostedConversationMessageWakeIntoLocalInbox({
      runtime,
      vaultRoot,
      wake: whatsappWake,
    });

    expect(mocks.createHostedLinqAttachmentDownloadDriver).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedLinqAttachmentDownloadDriver).toHaveBeenCalledWith({
      env: {
        LINQ_ATTACHMENT_CDN_BASE_URL: "https://cdn.linq.example/attachment-downloads",
        LINQ_API_TOKEN: "linq-token",
      },
      platform: runtime.platform,
    });
    expect(mocks.normalizeHostedLinqConversationCapture).toHaveBeenCalledWith({
      accountId: "15551234567",
      attachmentDownloadTimeoutMs: 5_000,
      downloadDriver: linqDriver,
      linqMessage: linqWake.message.linqMessage,
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    expect(mocks.createHostedTelegramAttachmentDownloadDriver).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedTelegramAttachmentDownloadDriver).toHaveBeenCalledWith({
      env: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      fetchImplementation: providerFetch,
    });
    expect(mocks.normalizeHostedTelegramConversationCapture).toHaveBeenCalledWith({
      accountId: "bot",
      downloadDriver: telegramDriver,
      externalId: "evt_telegram",
      message: telegramWake.message.telegramMessage,
      occurredAt: "2026-04-08T00:01:00.000Z",
      receivedAt: "2026-04-08T00:01:00.000Z",
    });
    expect(mocks.readHostedRawEmailMessage).toHaveBeenCalledWith(
      emailWake,
      runtime.platform.effectsPort,
    );
    expect(mocks.resolveHostedEmailSelfAddresses).toHaveBeenCalledWith({
      extra: ["user@example.com"],
      senderIdentity: "assistant@mail.example.test",
    });
    expect(mocks.normalizeHostedEmailConversationCapture).toHaveBeenCalledWith({
      accountAddress: "assistant@mail.example.test",
      accountId: "assistant@mail.example.test",
      rawMessage: rawEmailMessage,
      selfAddresses,
      source: "email",
      threadTarget: null,
    });
    expect(mocks.normalizeHostedWhatsAppConversationCapture).toHaveBeenCalledWith({
      accountId: "phone-number-id",
      externalId: "evt_whatsapp",
      message: whatsappWake.message.whatsappMessage,
      occurredAt: "2026-04-08T00:03:00.000Z",
      receivedAt: "2026-04-08T00:03:00.000Z",
    });
    expect(mocks.openInboxRuntime.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mocks.createInboxPipeline).toHaveBeenCalledTimes(4);
    expect(processCapture).toHaveBeenNthCalledWith(1, linqCapture);
    expect(processCapture).toHaveBeenNthCalledWith(2, telegramCapture);
    expect(processCapture).toHaveBeenNthCalledWith(3, emailCapture);
    expect(processCapture).toHaveBeenNthCalledWith(4, whatsappCapture);
    expect(pipelineClose).toHaveBeenCalledTimes(4);
    expect(linqImport.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
    expect(linqImport.requiresTerminalMediaParserEvidence).toBe(false);
  });

  it("prefers effects-backed Telegram attachment driver when available", async () => {
    const effectsDriver = {
      downloadFile: vi.fn(),
      getFile: vi.fn(),
    };
    const telegramCapture = { source: "telegram" };
    mocks.createHostedTelegramEffectsAttachmentDownloadDriver.mockReturnValueOnce(effectsDriver);
    mocks.normalizeHostedTelegramConversationCapture.mockResolvedValueOnce(telegramCapture);

    const wake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_telegram",
      occurredAt: "2026-04-08T00:01:00.000Z",
      telegramMessage: {
        messageId: "123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "chat_123",
      },
      userId: "member_123",
    });

    const runtime = createRuntime();
    await importHostedConversationMessageWakeIntoLocalInbox({
      runtime,
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake,
    });

    expect(mocks.createHostedTelegramEffectsAttachmentDownloadDriver).toHaveBeenCalledWith({
      effectsPort: runtime.platform.effectsPort,
    });
    expect(mocks.createHostedTelegramAttachmentDownloadDriver).not.toHaveBeenCalled();
    expect(mocks.normalizeHostedTelegramConversationCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadDriver: effectsDriver,
      }),
    );
  });

  it("does not log Telegram driver unavailability for text-only messages", async () => {
    mocks.createHostedTelegramAttachmentDownloadDriver.mockReturnValueOnce(null);
    mocks.normalizeHostedTelegramConversationCapture.mockResolvedValueOnce({
      source: "telegram",
    });

    const wake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_telegram",
      occurredAt: "2026-04-08T00:01:00.000Z",
      telegramMessage: {
        messageId: "123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "chat_123",
      },
      userId: "member_123",
    });
    const runtime = createRuntime();

    await importHostedConversationMessageWakeIntoLocalInbox({
      runtime,
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake,
    });

    expect(mocks.logHostedTelegramAttachmentDownloadUnavailable).not.toHaveBeenCalled();
    expect(mocks.normalizeHostedTelegramConversationCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadDriver: null,
      }),
    );
  });

  it("awaits Telegram driver-unavailable logging before metadata-only attachment import", async () => {
    const calls: string[] = [];
    mocks.createHostedTelegramAttachmentDownloadDriver.mockReturnValueOnce(null);
    mocks.logHostedTelegramAttachmentDownloadUnavailable.mockImplementationOnce(async () => {
      calls.push("log");
    });
    mocks.normalizeHostedTelegramConversationCapture.mockImplementationOnce(async () => {
      calls.push("normalize");
      return {
        attachments: [
          {
            kind: "document",
          },
        ],
        source: "telegram",
        text: null,
      };
    });

    const wake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_telegram",
      occurredAt: "2026-04-08T00:01:00.000Z",
      telegramMessage: {
        attachments: [
          {
            fileId: "file_123",
            fileName: "report.pdf",
            kind: "document",
            mimeType: "application/pdf",
          },
        ],
        messageId: "123",
        schema: "murph.hosted-telegram-message.v1",
        text: null,
        threadId: "chat_123",
      },
      userId: "member_123",
    });
    const runtime = createRuntime();

    await importHostedConversationMessageWakeIntoLocalInbox({
      runtime,
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake,
    });

    expect(mocks.logHostedTelegramAttachmentDownloadUnavailable).toHaveBeenCalledWith(
      runtime.platform,
    );
    expect(calls).toEqual(["log", "normalize"]);
    expect(mocks.normalizeHostedTelegramConversationCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadDriver: null,
      }),
    );
  });

  it("closes the inbox runtime when plain pipeline creation fails before a pipeline exists", async () => {
    const runtimeClose = vi.fn();
    mocks.openInboxRuntime.mockResolvedValue({
      close: runtimeClose,
    });
    mocks.createInboxPipeline.mockRejectedValue(new Error("pipeline failed"));
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValue({
      source: "linq",
    });

    await expect(
      importHostedConversationMessageWakeIntoLocalInbox({
        runtime: createRuntime(),
        vaultRoot: "/tmp/assistant-runtime-conversation",
        wake: buildHostedExecutionLinqConversationMessageWake({
          eventId: "evt_linq",
          linqMessage: {
            chatId: "chat_123",
            from: "+15551234567",
            isFromMe: false,
            messageId: "msg_123",
            parts: [],
          },
          occurredAt: "2026-04-08T00:00:00.000Z",
          phoneLookupKey: "15551234567",
          userId: "member_123",
        }),
      }),
    ).rejects.toThrow("pipeline failed");

    expect(runtimeClose).toHaveBeenCalledTimes(1);
  });

  it("persists media-only parser work without draining it and reports the terminal-evidence gate", async () => {
    const mediaCapture = {
      accountId: "15551234567",
      attachments: [
        {
          attachmentId: "attachment_audio",
          kind: "audio",
        },
      ],
      actor: {
        isSelf: false,
      },
      externalId: "linq:msg_media_only",
      occurredAt: "2026-04-08T00:00:00.000Z",
      raw: {},
      source: "linq",
      text: null,
      thread: {
        id: "chat_media_only",
      },
    };
    const processCapture = vi.fn(async () => ({
      captureId: "capture_media_only",
      createdAt: "2026-04-08T00:00:00.000Z",
      deduped: false,
      sourceDirectory: "raw/inbox/linq/capture_media_only",
      eventId: "evt_capture_media_only",
    }));
    const pipelineClose = vi.fn();
    mocks.createInboxPipeline.mockImplementationOnce(async (input) => ({
      close: pipelineClose,
      processCapture,
      runtime: input.runtime,
    }));
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce(mediaCapture);

    const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: createRuntime(),
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_media_only",
        linqMessage: {
          chatId: "chat_media_only",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_media_only",
          parts: [],
        },
        occurredAt: "2026-04-08T00:00:00.000Z",
        phoneLookupKey: "15551234567",
        userId: "member_123",
      }),
    });

    expect(processCapture).toHaveBeenCalledWith(mediaCapture);
    expect(importResult).toEqual({
      capture: expect.objectContaining({
        captureId: "capture_media_only",
      }),
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      requiresTerminalMediaParserEvidence: true,
    });
    expect(pipelineClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      expected: true,
      subject: null,
      textPreview: null,
    },
    {
      expected: false,
      subject: "Please review this recording",
      textPreview: null,
    },
    {
      expected: false,
      subject: null,
      textPreview: "The details are in the recording.",
    },
  ])(
    "sets direct email media parser gate to $expected for authored subject/body metadata",
    async ({ expected, subject, textPreview }) => {
      mocks.readHostedRawEmailMessage.mockResolvedValueOnce(Uint8Array.from([1, 2, 3]));
      mocks.normalizeHostedEmailConversationCapture.mockResolvedValueOnce({
        attachments: [{
          attachmentId: "attachment_email_audio",
          kind: "audio",
        }],
        source: "email",
        text: "Normalized email metadata must not bypass the authored-text gate.",
      });

      const result = await importHostedConversationMessageWakeIntoLocalInbox({
        runtime: createRuntime(),
        vaultRoot: "/tmp/assistant-runtime-conversation",
        wake: buildHostedExecutionEmailConversationMessageWake({
          attachmentSummaries: [{
            contentType: "audio/mpeg",
            fileName: "recording.mp3",
            sizeBytes: 123,
          }],
          eventId: `evt_email_media_${expected ? "only" : "text"}`,
          identityId: "assistant@mail.example.test",
          occurredAt: "2026-04-08T00:00:00.000Z",
          rawMessageKey: "raw_email_media",
          subject,
          textPreview,
          threadIsDirect: true,
          userId: "member_123",
        }),
      });

      expect(result.requiresTerminalMediaParserEvidence).toBe(expected);
    },
  );

  it("does not gate text-plus-media conversation input on parser evidence", async () => {
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      accountId: "15551234567",
      attachments: [
        {
          attachmentId: "attachment_audio",
          kind: "audio",
        },
      ],
      actor: {
        isSelf: false,
      },
      externalId: "linq:msg_text_and_media",
      occurredAt: "2026-04-08T00:00:00.000Z",
      raw: {},
      source: "linq",
      text: "Please listen to this.",
      thread: {
        id: "chat_text_and_media",
      },
    });

    const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: createRuntime(),
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_text_and_media",
        linqMessage: {
          chatId: "chat_text_and_media",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_text_and_media",
          parts: [
            {
              type: "text",
              value: "Please listen to this.",
            },
          ],
        },
        occurredAt: "2026-04-08T00:00:00.000Z",
        phoneLookupKey: "15551234567",
        userId: "member_123",
      }),
    });

    expect(importResult.requiresTerminalMediaParserEvidence).toBe(false);
    expect(importResult.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
  });

  it("rejects promptly when projection aborts after canonical capture persistence", async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException("Stop requested.", "AbortError");
    const pipelineClose = vi.fn();
    const processCapture = vi.fn(async () => {
      abortController.abort(abortReason);
      return {
        captureId: "capture_after_process_abort",
        createdAt: "2026-04-08T00:00:00.000Z",
        deduped: false,
        sourceDirectory: "raw/inbox/linq/capture_after_process_abort",
        eventId: "evt_capture_after_process_abort",
      };
    });
    mocks.createInboxPipeline.mockImplementationOnce(async (input) => ({
      close: pipelineClose,
      processCapture,
      runtime: input.runtime,
    }));
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      attachments: [],
      source: "linq",
      text: null,
    });

    await expect(
      importHostedConversationMessageWakeIntoLocalInbox({
        runtime: createRuntime(),
        signal: abortController.signal,
        vaultRoot: "/tmp/assistant-runtime-conversation",
        wake: buildHostedExecutionLinqConversationMessageWake({
          eventId: "evt_linq_after_process_abort",
          linqMessage: {
            chatId: "chat_after_process_abort",
            from: "+15551234567",
            isFromMe: false,
            messageId: "msg_after_process_abort",
            parts: [],
          },
          occurredAt: "2026-04-08T00:00:00.000Z",
          phoneLookupKey: "15551234567",
          userId: "member_123",
        }),
      }),
    ).rejects.toBe(abortReason);

    expect(processCapture).toHaveBeenCalledTimes(1);
    expect(pipelineClose).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to transient inbox projection when canonical inbox persistence fails", async () => {
    const runtimeStore = {
      close: vi.fn(),
    };
    const pipelineClose = vi.fn();
    const capture = {
      accountId: "15551234567",
      attachments: [],
      actor: {
        isSelf: false,
      },
      externalId: "linq:msg_projection_failed",
      occurredAt: "2026-04-08T00:00:00.000Z",
      raw: {},
      source: "linq",
      text: "hello after ledger failure",
      thread: {
        id: "chat_projection_failed",
      },
    };
    mocks.openInboxRuntime.mockResolvedValueOnce(runtimeStore);
    mocks.createInboxPipeline.mockImplementationOnce(async (input) => ({
      close: pipelineClose,
      processCapture: vi.fn(async () => {
        throw new Error("canonical inbox capture unavailable");
      }),
      runtime: input.runtime,
    }));
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce(capture);

    await expect(
      importHostedConversationMessageWakeIntoLocalInbox({
        runtime: createRuntime(),
        vaultRoot: "/tmp/assistant-runtime-conversation",
        wake: buildHostedExecutionLinqConversationMessageWake({
          eventId: "evt_linq_projection_failed",
          linqMessage: {
            chatId: "chat_projection_failed",
            from: "+15551234567",
            isFromMe: false,
            messageId: "msg_projection_failed",
            parts: [],
          },
          occurredAt: "2026-04-08T00:00:00.000Z",
          phoneLookupKey: "15551234567",
          userId: "member_123",
        }),
      }),
    ).rejects.toThrow("Canonical inbox capture projection failed.");

    expect(pipelineClose).toHaveBeenCalledTimes(1);
  });

  it("fails closed on unsupported conversation wake kinds before opening the inbox runtime", async () => {
    await expect(
      importHostedConversationMessageWakeIntoLocalInbox({
        runtime: createRuntime(),
        vaultRoot: "/tmp/assistant-runtime-conversation",
        wake: {
          eventId: "evt_unknown",
          kind: "conversation.message",
          message: {
            channel: "unsupported",
          },
        } as never,
      }),
    ).rejects.toThrow(/Unsupported hosted conversation message wake kind/u);

    expect(mocks.openInboxRuntime).not.toHaveBeenCalled();
  });
});
