import { afterEach, describe, expect, it, vi } from "vitest";

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
  withHostedInboxPipeline: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events/email.ts", () => ({
  buildHostedEmailCapture: mocks.buildHostedEmailCapture,
}));

vi.mock("../src/hosted-runtime/events/inbox-pipeline.ts", () => ({
  withHostedInboxPipeline: mocks.withHostedInboxPipeline,
}));

vi.mock("../src/hosted-runtime/events/linq.ts", () => ({
  buildHostedLinqCapture: mocks.buildHostedLinqCapture,
}));

vi.mock("../src/hosted-runtime/events/telegram.ts", () => ({
  buildHostedTelegramCapture: mocks.buildHostedTelegramCapture,
}));

import { processHostedConversationMessageWake } from "../src/hosted-runtime/events/conversation.ts";

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

afterEach(() => {
  vi.clearAllMocks();
  mocks.withHostedInboxPipeline.mockImplementation(async (_vaultRoot, callback) => callback({
    processCapture: vi.fn(async () => {}),
  }));
});

describe("processHostedConversationMessageWake", () => {
  it("routes each conversation wake channel through the dedicated capture normalizer and inbox pipeline", async () => {
    const runtime = createRuntime();
    const vaultRoot = "/tmp/assistant-runtime-conversation";
    const processCapture = vi.fn(async () => {});
    mocks.withHostedInboxPipeline.mockImplementation(async (_vaultRoot, callback) => callback({
      processCapture,
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
    await processHostedConversationMessageWake({
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
    await processHostedConversationMessageWake({
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
    await processHostedConversationMessageWake({
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
    expect(mocks.withHostedInboxPipeline).toHaveBeenCalledTimes(3);
    expect(processCapture).toHaveBeenNthCalledWith(1, linqCapture);
    expect(processCapture).toHaveBeenNthCalledWith(2, telegramCapture);
    expect(processCapture).toHaveBeenNthCalledWith(3, emailCapture);
  });
});
