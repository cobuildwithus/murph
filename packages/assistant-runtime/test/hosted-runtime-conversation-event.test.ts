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
  buildHostedEmailCapture: vi.fn(),
  buildHostedLinqCapture: vi.fn(),
  buildHostedTelegramCapture: vi.fn(),
  createConfiguredParserRegistry: vi.fn(),
  createParsedInboxPipeline: vi.fn(),
  openInboxRuntime: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events/email.ts", () => ({
  buildHostedEmailCapture: mocks.buildHostedEmailCapture,
}));

vi.mock("@murphai/inboxd", () => ({
  createParsedInboxPipeline: mocks.createParsedInboxPipeline,
  openInboxRuntime: mocks.openInboxRuntime,
}));

vi.mock("../src/hosted-runtime/events/linq.ts", () => ({
  buildHostedLinqCapture: mocks.buildHostedLinqCapture,
}));

vi.mock("@murphai/parsers", () => ({
  createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
}));

vi.mock("../src/hosted-runtime/events/telegram.ts", () => ({
  buildHostedTelegramCapture: mocks.buildHostedTelegramCapture,
}));

import { ingestHostedConversationMessageWake } from "../src/hosted-runtime/events/conversation.ts";

function createRuntime() {
  return {
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
  } as const;
}

beforeEach(() => {
  mocks.openInboxRuntime.mockResolvedValue({
    close: vi.fn(),
  });
  mocks.createConfiguredParserRegistry.mockResolvedValue({
    ffmpeg: undefined,
    registry: Symbol("parser-registry"),
  });
  mocks.createParsedInboxPipeline.mockImplementation(async (input) => ({
    close: vi.fn(),
    processCapture: vi.fn(async () => {
      await input.onParserDrain?.([{} as never, {} as never]);
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ingestHostedConversationMessageWake", () => {
  it("routes each conversation wake channel through capture normalization and parsed inbox persistence", async () => {
    const runtime = createRuntime();
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
    mocks.createParsedInboxPipeline.mockImplementation(async (input) => ({
      close: pipelineClose,
      processCapture: vi.fn(async (capture) => {
        const persisted = await processCapture(capture);
        await input.onParserDrain?.([{} as never, {} as never]);
        return persisted;
      }),
      runtime: input.runtime,
    }));

    const linqWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq",
      linqEvent: {
        event_type: "message.received",
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "15551234567",
      userId: "member_123",
    });
    const linqCapture = { source: "linq" };
    mocks.buildHostedLinqCapture.mockResolvedValueOnce(linqCapture);
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
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "chat_123",
      },
      userId: "member_123",
    });
    const telegramCapture = { source: "telegram" };
    mocks.buildHostedTelegramCapture.mockResolvedValueOnce(telegramCapture);
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
    const emailCapture = { source: "email" };
    mocks.buildHostedEmailCapture.mockResolvedValueOnce(emailCapture);
    await ingestHostedConversationMessageWake({
      runtime,
      vaultRoot,
      wake: emailWake,
    });

    expect(mocks.buildHostedLinqCapture).toHaveBeenCalledWith(linqWake);
    expect(mocks.buildHostedTelegramCapture).toHaveBeenCalledWith(telegramWake);
    expect(mocks.buildHostedEmailCapture).toHaveBeenCalledWith(
      emailWake,
      runtime.platform.effectsPort,
    );
    expect(mocks.openInboxRuntime).toHaveBeenCalledTimes(3);
    expect(mocks.createConfiguredParserRegistry).toHaveBeenCalledTimes(3);
    expect(mocks.createParsedInboxPipeline).toHaveBeenCalledTimes(3);
    expect(processCapture).toHaveBeenNthCalledWith(1, linqCapture);
    expect(processCapture).toHaveBeenNthCalledWith(2, telegramCapture);
    expect(processCapture).toHaveBeenNthCalledWith(3, emailCapture);
    expect(pipelineClose).toHaveBeenCalledTimes(3);
    expect(linqMetrics).toEqual({
      nextWakeAt: null,
      parserProcessed: 2,
    });
  });

  it("closes the inbox runtime when parsed pipeline creation fails before a pipeline exists", async () => {
    const runtimeClose = vi.fn();
    mocks.openInboxRuntime.mockResolvedValue({
      close: runtimeClose,
    });
    mocks.createParsedInboxPipeline.mockRejectedValue(new Error("pipeline failed"));
    mocks.buildHostedLinqCapture.mockResolvedValue({
      source: "linq",
    });

    await expect(
      ingestHostedConversationMessageWake({
        runtime: createRuntime(),
        vaultRoot: "/tmp/assistant-runtime-conversation",
        wake: buildHostedExecutionLinqConversationMessageWake({
          eventId: "evt_linq",
          linqEvent: {
            event_type: "message.received",
          },
          occurredAt: "2026-04-08T00:00:00.000Z",
          phoneLookupKey: "15551234567",
          userId: "member_123",
        }),
      }),
    ).rejects.toThrow("pipeline failed");

    expect(runtimeClose).toHaveBeenCalledTimes(1);
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
