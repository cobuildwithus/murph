import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  createConfiguredParserRegistry: vi.fn(),
  createHostedLinqAttachmentDownloadDriver: vi.fn(),
  createHostedTelegramAttachmentDownloadDriver: vi.fn(),
  createInboxParserService: vi.fn(),
  createInboxPipeline: vi.fn(),
  createParsedInboxPipeline: vi.fn(),
  normalizeHostedEmailConversationCapture: vi.fn(),
  normalizeHostedLinqConversationCapture: vi.fn(),
  normalizeHostedTelegramConversationCapture: vi.fn(),
  openInboxRuntime: vi.fn(),
  readHostedRawEmailMessage: vi.fn(),
  markLinqChatRead: vi.fn(),
  resolveHostedEmailSelfAddresses: vi.fn(),
}));

vi.mock("@murphai/inboxd", () => ({
  createInboxPipeline: mocks.createInboxPipeline,
  createParsedInboxPipeline: mocks.createParsedInboxPipeline,
  openInboxRuntime: mocks.openInboxRuntime,
}));

vi.mock("@murphai/inboxd/connectors/hosted-conversation", () => ({
  normalizeHostedEmailConversationCapture: mocks.normalizeHostedEmailConversationCapture,
  normalizeHostedLinqConversationCapture: mocks.normalizeHostedLinqConversationCapture,
  normalizeHostedTelegramConversationCapture: mocks.normalizeHostedTelegramConversationCapture,
}));

vi.mock("@murphai/parsers", () => ({
  createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
  createInboxParserService: mocks.createInboxParserService,
}));

vi.mock("../src/hosted-runtime/events/email.ts", () => ({
  readHostedRawEmailMessage: mocks.readHostedRawEmailMessage,
}));

vi.mock("../src/hosted-runtime/events/linq.ts", () => ({
  createHostedLinqAttachmentDownloadDriver: mocks.createHostedLinqAttachmentDownloadDriver,
  HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS: 5_000,
}));

vi.mock("../src/hosted-runtime/events/telegram.ts", () => ({
  createHostedTelegramAttachmentDownloadDriver: mocks.createHostedTelegramAttachmentDownloadDriver,
}));

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  markLinqChatRead: mocks.markLinqChatRead,
}));

vi.mock("@murphai/hosted-execution/hosted-email", () => ({
  resolveHostedEmailSelfAddresses: mocks.resolveHostedEmailSelfAddresses,
}));

import {
  importHostedConversationMessageWakeIntoLocalInbox,
  ingestHostedConversationMessageWake,
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
      usageExportPort: null,
    },
    platformEnv: {},
  } as const;
}

beforeEach(() => {
  mocks.markLinqChatRead.mockResolvedValue(undefined);
  mocks.openInboxRuntime.mockResolvedValue({
    close: vi.fn(),
  });
  mocks.createConfiguredParserRegistry.mockResolvedValue({
    ffmpeg: undefined,
    registry: Symbol("parser-registry"),
  });
  mocks.createInboxPipeline.mockImplementation(async (input) => ({
    close: vi.fn(),
    processCapture: vi.fn(async () => {
      return {
        captureId: "capture_123",
        createdAt: "2026-04-08T00:00:00.000Z",
        deduped: false,
        envelopePath: "raw/inbox/linq/capture_123/envelope.json",
        eventId: "evt_capture_123",
      };
    }),
    runtime: input.runtime,
  }));
  mocks.createInboxParserService.mockReturnValue({
    drain: vi.fn(async () => [{} as never, {} as never]),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ingestHostedConversationMessageWake", () => {
  it("normalizes each hosted conversation wake directly before parsed inbox persistence", async () => {
    const runtime = {
      ...createRuntime(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        VERCEL_AI_API_KEY: "sk-runtime",
      },
      platformEnv: {
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
        envelopePath: "raw/inbox/linq/capture_123/envelope.json",
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
    const linqMetrics = await ingestHostedConversationMessageWake({
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
    await ingestHostedConversationMessageWake({
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
    const emailCapture = { source: "email" };
    mocks.readHostedRawEmailMessage.mockResolvedValueOnce(rawEmailMessage);
    mocks.resolveHostedEmailSelfAddresses.mockReturnValueOnce(selfAddresses);
    mocks.normalizeHostedEmailConversationCapture.mockResolvedValueOnce(emailCapture);
    await ingestHostedConversationMessageWake({
      runtime,
      vaultRoot,
      wake: emailWake,
    });

    expect(mocks.createHostedLinqAttachmentDownloadDriver).toHaveBeenCalledTimes(1);
    expect(mocks.normalizeHostedLinqConversationCapture).toHaveBeenCalledWith({
      accountId: "15551234567",
      attachmentDownloadTimeoutMs: 5_000,
      downloadDriver: linqDriver,
      linqMessage: linqWake.message.linqMessage,
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    expect(mocks.createHostedTelegramAttachmentDownloadDriver).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedTelegramAttachmentDownloadDriver).toHaveBeenCalledWith({
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
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
    expect(mocks.openInboxRuntime.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mocks.createInboxPipeline).toHaveBeenCalledTimes(3);
    expect(processCapture).toHaveBeenNthCalledWith(1, linqCapture);
    expect(processCapture).toHaveBeenNthCalledWith(2, telegramCapture);
    expect(processCapture).toHaveBeenNthCalledWith(3, emailCapture);
    expect(mocks.markLinqChatRead).not.toHaveBeenCalled();
    expect(pipelineClose).toHaveBeenCalledTimes(3);
    expect(linqMetrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
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
      ingestHostedConversationMessageWake({
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
    expect(mocks.markLinqChatRead).not.toHaveBeenCalled();
  });

  it("marks inbound Linq chats read after post-checkpoint import effects without failing ingestion", async () => {
    const order: string[] = [];
    mocks.createInboxPipeline.mockImplementation(async (input) => ({
      close: vi.fn(),
      processCapture: vi.fn(async () => {
        order.push("processCapture");
        return {
          captureId: "capture_123",
          createdAt: "2026-04-08T00:00:00.000Z",
          deduped: false,
          envelopePath: "raw/inbox/linq/capture_123/envelope.json",
          eventId: "evt_capture_123",
        };
      }),
      runtime: input.runtime,
    }));
    mocks.createInboxParserService.mockReturnValueOnce({
      drain: vi.fn(async () => [{} as never]),
    });
    mocks.markLinqChatRead.mockImplementationOnce(async () => {
      order.push("markRead");
      throw new Error("provider unavailable");
    });
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      source: "linq",
    });

    const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: {
        ...createRuntime(),
        forwardedEnv: {
          LINQ_API_BASE_URL: "https://api.linq.example",
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {
          TELEGRAM_BOT_TOKEN: "telegram-token",
        },
      },
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq",
        linqMessage: {
          chatId: "chat_after_import",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_123",
          parts: [],
        },
        occurredAt: "2026-04-08T00:00:00.000Z",
        phoneLookupKey: "15551234567",
        userId: "member_123",
      }),
    });
    expect(order).toEqual(["processCapture"]);
    expect(mocks.markLinqChatRead).not.toHaveBeenCalled();

    await importResult.afterCheckpoint?.();

    expect(order).toEqual(["processCapture", "markRead"]);
    expect(importResult.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
    expect(mocks.markLinqChatRead).toHaveBeenCalledWith(
      {
        chatId: "chat_after_import",
      },
      expect.objectContaining({
        env: {
          LINQ_API_BASE_URL: "https://api.linq.example",
          LINQ_API_TOKEN: "linq-token",
        },
      }),
    );
  });

  it("keeps persisted conversation import successful when post-persistence parser setup fails", async () => {
    const order: string[] = [];
    mocks.createInboxPipeline.mockImplementationOnce(async (input) => ({
      close: vi.fn(),
      processCapture: vi.fn(async () => {
        order.push("processCapture");
        return {
          captureId: "capture_after_parser_setup_failure",
          createdAt: "2026-04-08T00:00:00.000Z",
          deduped: false,
          envelopePath: "raw/inbox/linq/capture_after_parser_setup_failure/envelope.json",
          eventId: "evt_capture_after_parser_setup_failure",
        };
      }),
      runtime: input.runtime,
    }));
    mocks.createConfiguredParserRegistry.mockRejectedValueOnce(
      new Error("parser registry unavailable"),
    );
    mocks.markLinqChatRead.mockImplementationOnce(async () => {
      order.push("markRead");
    });
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      source: "linq",
    });

    const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: {
        ...createRuntime(),
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
      },
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_parser_setup_failure",
        linqMessage: {
          chatId: "chat_after_parser_setup_failure",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_123",
          parts: [],
        },
        occurredAt: "2026-04-08T00:00:00.000Z",
        phoneLookupKey: "15551234567",
        userId: "member_123",
      }),
    });

    await importResult.afterCheckpoint?.();

    expect(order).toEqual(["processCapture", "markRead"]);
    expect(importResult.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
    expect(mocks.createInboxPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.createConfiguredParserRegistry).toHaveBeenCalledTimes(1);
    expect(mocks.createInboxParserService).not.toHaveBeenCalled();
  });

  it("does not mark self-authored Linq messages as read", async () => {
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      source: "linq",
    });

    await ingestHostedConversationMessageWake({
      runtime: createRuntime(),
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_from_me",
        linqMessage: {
          chatId: "chat_from_me",
          from: "+15551234567",
          isFromMe: true,
          messageId: "msg_123",
          parts: [],
        },
        occurredAt: "2026-04-08T00:00:00.000Z",
        phoneLookupKey: "15551234567",
        userId: "member_123",
      }),
    });

    expect(mocks.markLinqChatRead).not.toHaveBeenCalled();
  });

  it("fails closed on unsupported conversation wake kinds before opening the inbox runtime", async () => {
    await expect(
      ingestHostedConversationMessageWake({
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
