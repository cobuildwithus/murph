import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionWhatsAppConversationMessageWake,
} from "@murphai/hosted-execution";
import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";
import type { AttachmentParseJobRecord, RunAttachmentParseJobResult } from "@murphai/parsers";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  createConfiguredParserRegistry: vi.fn(),
  createHostedLinqAttachmentDownloadDriver: vi.fn(),
  createHostedTelegramAttachmentDownloadDriver: vi.fn(),
  createHostedTelegramEffectsAttachmentDownloadDriver: vi.fn(),
  logHostedTelegramAttachmentDownloadUnavailable: vi.fn(),
  createInboxParserService: vi.fn(),
  createInboxPipeline: vi.fn(),
  createParsedInboxPipeline: vi.fn(),
  normalizeHostedEmailConversationCapture: vi.fn(),
  normalizeHostedLinqConversationCapture: vi.fn(),
  normalizeHostedTelegramConversationCapture: vi.fn(),
  normalizeHostedWhatsAppConversationCapture: vi.fn(),
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
  normalizeHostedWhatsAppConversationCapture: mocks.normalizeHostedWhatsAppConversationCapture,
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

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  markLinqChatRead: mocks.markLinqChatRead,
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

function createRuntimeWithLogPort(logRequests: HostedRuntimeLogRequest[]) {
  const runtime = createRuntime();
  return {
    ...runtime,
    platform: {
      ...runtime.platform,
      logPort: {
        async write(request: HostedRuntimeLogRequest) {
          logRequests.push(request);
          return {
            loggedCount: request.entries.length,
          };
        },
      },
    },
  } as const;
}

function createParseJobResult(
  overrides: Pick<RunAttachmentParseJobResult, "status"> & Partial<RunAttachmentParseJobResult>,
): RunAttachmentParseJobResult {
  return {
    job: createParseJobRecord({
      state: overrides.status,
    }),
    ...overrides,
  };
}

function createParseJobRecord(
  overrides: Partial<AttachmentParseJobRecord>,
): AttachmentParseJobRecord {
  return {
    attachmentId: "attachment_123",
    attempts: 1,
    captureId: "capture_123",
    createdAt: "2026-04-08T00:00:00.000Z",
    jobId: "job_123",
    pipeline: "attachment_text",
    state: "pending",
    ...overrides,
  };
}

function mockOpenInboxRuntimeWithParseJobs(input: {
  attachmentKinds?: Readonly<Record<string, "audio" | "video" | "document" | "image" | "other">>;
  failedJobs?: AttachmentParseJobRecord[];
  pendingJobs?: AttachmentParseJobRecord[];
} = {}) {
  const pendingJobs = input.pendingJobs ?? [
    createParseJobRecord({
      state: "pending",
    }),
  ];
  const failedJobs = input.failedJobs ?? [];
  const attachmentKinds = input.attachmentKinds ?? {};
  const attachmentIds = Array.from(
    new Set(
      [...pendingJobs, ...failedJobs].map((job) => job.attachmentId),
    ),
  );
  mocks.openInboxRuntime.mockResolvedValueOnce({
    close: vi.fn(),
    getCapture: vi.fn((captureId: string) => ({
      attachments: attachmentIds.map((attachmentId, index) => ({
        attachmentId,
        kind: attachmentKinds[attachmentId] ?? "audio",
        ordinal: index + 1,
      })),
      captureId,
    })),
    listAttachmentParseJobs: vi.fn((filters: { state?: string } = {}) => {
      if (filters.state === "pending") {
        return pendingJobs;
      }
      if (filters.state === "failed") {
        return failedJobs;
      }
      return [];
    }),
  });
}

beforeEach(() => {
  mocks.createHostedTelegramEffectsAttachmentDownloadDriver.mockReturnValue(null);
  mocks.logHostedTelegramAttachmentDownloadUnavailable.mockResolvedValue(undefined);
  mocks.markLinqChatRead.mockResolvedValue(undefined);
  mocks.openInboxRuntime.mockResolvedValue({
    close: vi.fn(),
    listAttachmentParseJobs: vi.fn(() => []),
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
    const emailCapture = { source: "email" };
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
    expect(mocks.markLinqChatRead).not.toHaveBeenCalled();
    expect(pipelineClose).toHaveBeenCalledTimes(4);
    expect(linqImport.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
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
      return { source: "telegram" };
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
    expect(mocks.markLinqChatRead).not.toHaveBeenCalled();
  });

  it("passes explicit hosted parser toolchain config to parser registry without env fallback", async () => {
    const parserToolchain = {
      tools: {
        ffmpeg: {
          command: "/usr/bin/ffmpeg",
        },
        whisper: {
          command: "/usr/local/bin/whisper-cli",
          modelPath: "/home/runner/.murph/models/whisper/ggml-base.en.bin",
        },
      },
    };
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValue({
      source: "linq",
    });
    mockOpenInboxRuntimeWithParseJobs();

    await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: {
        ...createRuntime(),
        parserToolchain,
      },
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
    });

    expect(mocks.createConfiguredParserRegistry).toHaveBeenCalledWith({
      allowEnvToolchain: false,
      allowSystemToolchainLookup: false,
      readVaultToolchainConfig: false,
      toolchain: {
        source: "platform",
        tools: parserToolchain.tools,
      },
      vaultRoot: "/tmp/assistant-runtime-conversation",
    });
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
    mockOpenInboxRuntimeWithParseJobs();

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

    expect(order).toEqual(["processCapture"]);
    expect(importResult.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 1,
    });
    expect(mocks.markLinqChatRead).not.toHaveBeenCalled();
  });

  it("keeps persisted conversation import successful when post-persistence parser setup fails", async () => {
    const order: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
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
    mocks.markLinqChatRead.mockImplementationOnce(async () => {
      order.push("markRead");
    });
    mocks.createConfiguredParserRegistry.mockRejectedValueOnce(new Error("parser setup failed"));
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      source: "linq",
    });
    mockOpenInboxRuntimeWithParseJobs();

    const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: {
        ...createRuntimeWithLogPort(logRequests),
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

    expect(order).toEqual(["processCapture"]);
    expect(importResult.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
    expect(mocks.createInboxPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.createConfiguredParserRegistry).toHaveBeenCalledTimes(1);
    expect(mocks.createInboxParserService).not.toHaveBeenCalled();
    expect(logRequests).toHaveLength(1);
    expect(logRequests[0]?.entries).toEqual([
      expect.objectContaining({
        component: "mailbox",
        errorCode: "runtime_error",
        eventCode: "mailbox.parser_drain_failed",
        level: "warn",
        phase: "import",
        redactedJson: {
          captureIdPresent: true,
          errorCode: "runtime_error",
        },
      }),
    ]);
  });

  it("does not initialize parser tooling for legacy non-media pending jobs", async () => {
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      source: "linq",
    });
    mockOpenInboxRuntimeWithParseJobs({
      attachmentKinds: {
        "attachment-document": "document",
      },
      pendingJobs: [
        createParseJobRecord({
          attachmentId: "attachment-document",
          state: "pending",
        }),
      ],
    });

    const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: createRuntime(),
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_legacy_document_parse_job",
        linqMessage: {
          chatId: "chat_legacy_document_parse_job",
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

    expect(importResult.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
    expect(mocks.createConfiguredParserRegistry).not.toHaveBeenCalled();
    expect(mocks.createInboxParserService).not.toHaveBeenCalled();
  });

  it("logs aggregate parser job failures without exposing attachment paths", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.createInboxParserService.mockReturnValueOnce({
      drain: vi.fn(async () => [
        createParseJobResult({
          errorCode: "ffmpeg_unavailable",
          errorMessage: "spawn /app/test-parser-toolchain/ffmpeg ENOENT",
          job: createParseJobRecord({
            jobId: "job_ffmpeg_failure",
            state: "failed",
          }),
          status: "failed",
        }),
        createParseJobResult({
          errorCode: "provider_unavailable",
          errorMessage: "No parser provider found for audio/mp4",
          job: createParseJobRecord({
            jobId: "job_provider_failure",
            state: "failed",
          }),
          status: "failed",
        }),
        createParseJobResult({
          job: createParseJobRecord({
            jobId: "job_success",
            state: "succeeded",
          }),
          manifestPath: "raw/inbox/capture_123/parser-results/manifest.json",
          providerId: "provider_123",
          status: "succeeded",
        }),
      ]),
    });
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      source: "linq",
    });
    mockOpenInboxRuntimeWithParseJobs();

    const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: createRuntimeWithLogPort(logRequests),
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_parser_job_failure",
        linqMessage: {
          chatId: "chat_after_parser_job_failure",
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

    expect(importResult.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 3,
    });
    expect(logRequests).toHaveLength(1);
    expect(logRequests[0]?.entries).toEqual([
      expect.objectContaining({
        component: "mailbox",
        eventCode: "mailbox.parser_jobs_failed",
        level: "warn",
        phase: "import",
        redactedJson: {
          captureIdPresent: true,
          errorCodes: ["ffmpeg_unavailable", "provider_unavailable"],
          parserFailed: 2,
          parserObservedFailedJobs: 0,
          parserProcessed: 3,
          parserSucceeded: 1,
        },
      }),
    ]);
  });

  it("logs failed parser job state when drain returns no job result", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mockOpenInboxRuntimeWithParseJobs({
      failedJobs: [
        createParseJobRecord({
          errorCode: "ffmpeg_unavailable",
          errorMessage: "spawn /app/test-parser-toolchain/ffmpeg ENOENT",
          jobId: "job_failed_from_state",
          state: "failed",
        }),
      ],
    });
    mocks.createInboxParserService.mockReturnValueOnce({
      drain: vi.fn(async () => []),
    });
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      source: "linq",
    });

    const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: createRuntimeWithLogPort(logRequests),
      vaultRoot: "/tmp/assistant-runtime-conversation",
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_parser_state_failure",
        linqMessage: {
          chatId: "chat_after_parser_state_failure",
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

    expect(importResult.metrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 0,
    });
    expect(logRequests).toHaveLength(1);
    expect(logRequests[0]?.entries).toEqual([
      expect.objectContaining({
        component: "mailbox",
        eventCode: "mailbox.parser_jobs_failed",
        level: "warn",
        phase: "import",
        redactedJson: {
          captureIdPresent: true,
          errorCodes: ["ffmpeg_unavailable"],
          parserFailed: 1,
          parserObservedFailedJobs: 1,
          parserProcessed: 0,
          parserSucceeded: 0,
        },
      }),
    ]);
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
    mocks.createInboxParserService.mockReturnValueOnce({
      drain: vi.fn(async () => []),
    });

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

    expect(mocks.createInboxParserService).not.toHaveBeenCalled();
    expect(pipelineClose).toHaveBeenCalledTimes(1);
  });

  it("does not mark self-authored Linq messages as read", async () => {
    mocks.normalizeHostedLinqConversationCapture.mockResolvedValueOnce({
      source: "linq",
    });

    await importHostedConversationMessageWakeIntoLocalInbox({
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
