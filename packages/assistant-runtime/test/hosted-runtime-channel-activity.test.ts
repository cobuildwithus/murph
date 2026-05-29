import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  markLinqChatRead: vi.fn(),
  sendHostedProviderLinqMessage: vi.fn(),
  startLinqTypingIndicator: vi.fn(),
  startTelegramTypingIndicator: vi.fn(),
}));

vi.mock("@murphai/assistant-engine/assistant-channel-adapters", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/assistant-engine/assistant-channel-adapters")
  >();
  return {
    ...actual,
    startLinqTypingIndicator: mocks.startLinqTypingIndicator,
    startTelegramTypingIndicator: mocks.startTelegramTypingIndicator,
  };
});

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  markLinqChatRead: mocks.markLinqChatRead,
}));

vi.mock("../src/hosted-provider-effects.ts", () => ({
  sendHostedProviderLinqMessage: mocks.sendHostedProviderLinqMessage,
}));

import {
  createHostedAssistantProgressDeliveryDependencies,
} from "../src/hosted-runtime/callbacks.ts";
import {
  buildHostedLinqChannelEnv,
  buildHostedTelegramChannelEnv,
  createHostedAssistantChannelTypingDependencies,
  markHostedConversationReadBestEffort,
} from "../src/hosted-runtime/channel-activity.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markLinqChatRead.mockResolvedValue(undefined);
  mocks.sendHostedProviderLinqMessage.mockResolvedValue({
    providerMessageId: "linq-message",
    providerThreadId: "linq-thread",
    target: "linq-thread",
    targetKind: "thread",
  });
  mocks.startLinqTypingIndicator.mockResolvedValue(undefined);
  mocks.startTelegramTypingIndicator.mockResolvedValue(undefined);
});

test("hosted Linq read and typing share the same forwarded plus user env", async () => {
  const forwardedEnv = {
    LINQ_API_BASE_URL: "https://api.linq.example",
    LINQ_API_TOKEN: "platform-linq-token",
    OPENAI_API_KEY: "platform-vercel-token",
  };
  const userEnv = {
    LINQ_API_TOKEN: "user-linq-token",
  };
  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv,
    userEnv,
  });

  assert.deepEqual(linqEnv, {
    LINQ_API_BASE_URL: "https://api.linq.example",
    LINQ_API_TOKEN: "user-linq-token",
  });

  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv,
    platformEnv: {
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
    userEnv,
  });

  await typing.startLinqTyping?.({
    target: "chat_123",
  });
  await markHostedConversationReadBestEffort({
    forwardedEnv,
    userEnv,
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
      phoneLookupKey: "phone_lookup",
      userId: "member_123",
    }),
  });

  assert.deepEqual(mocks.startLinqTypingIndicator.mock.calls[0]?.[1]?.env, linqEnv);
  assert.deepEqual(mocks.markLinqChatRead.mock.calls[0]?.[1]?.env, linqEnv);
});

test("hosted Linq channel env does not mix a forwarded token with a user base URL", () => {
  assert.deepEqual(
    buildHostedLinqChannelEnv({
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example",
        LINQ_API_TOKEN: "platform-linq-token",
      },
      userEnv: {
        LINQ_API_BASE_URL: "https://user-controlled.linq.example",
      },
    }),
    {
      LINQ_API_BASE_URL: "https://api.linq.example",
      LINQ_API_TOKEN: "platform-linq-token",
    },
  );

  assert.deepEqual(
    buildHostedLinqChannelEnv({
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example",
        LINQ_API_TOKEN: "platform-linq-token",
      },
      userEnv: {
        LINQ_API_BASE_URL: "https://user.linq.example",
        LINQ_API_TOKEN: "user-linq-token",
      },
    }),
    {
      LINQ_API_BASE_URL: "https://user.linq.example",
      LINQ_API_TOKEN: "user-linq-token",
    },
  );
});

test("hosted Telegram typing uses a Telegram-only platform channel env", async () => {
  const telegramEnv = buildHostedTelegramChannelEnv({
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
      OPENAI_API_KEY: "platform-vercel-token",
      TELEGRAM_BOT_TOKEN: "untrusted-forwarded-token",
      TELEGRAM_FILE_BASE_URL: "https://forwarded-files.telegram.example",
    },
    platformEnv: {
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "platform-telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    },
  });

  assert.deepEqual(telegramEnv, {
    TELEGRAM_API_BASE_URL: "https://api.telegram.example",
    TELEGRAM_BOT_TOKEN: "platform-telegram-token",
    TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
  });

  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
      OPENAI_API_KEY: "platform-vercel-token",
      TELEGRAM_BOT_TOKEN: "untrusted-forwarded-token",
    },
    platformEnv: telegramEnv,
    userEnv: {},
  });

  await typing.startTelegramTyping?.({
    target: "telegram-thread",
  });

  assert.deepEqual(mocks.startTelegramTypingIndicator.mock.calls[0]?.[1]?.env, telegramEnv);
});

test("hosted channel activity uses provider fetch instead of effects-port provider tunnels", async () => {
  const providerFetch = vi.fn() as unknown as typeof fetch;
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {},
    platformEnv: {},
    providerFetch,
    userEnv: {},
  });

  await typing.startLinqTyping?.({
    target: "linq_chat_123",
  });
  await typing.startTelegramTyping?.({
    target: "telegram_chat_123",
  });

  await markHostedConversationReadBestEffort({
    forwardedEnv: {},
    providerFetch,
    userEnv: {},
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
      phoneLookupKey: "phone_lookup",
      userId: "member_123",
    }),
  });

  assert.equal(mocks.startLinqTypingIndicator.mock.calls[0]?.[1]?.fetchImplementation, providerFetch);
  assert.equal(mocks.startTelegramTypingIndicator.mock.calls[0]?.[1]?.fetchImplementation, providerFetch);
  assert.equal(mocks.markLinqChatRead.mock.calls[0]?.[1]?.fetchImplementation, providerFetch);
});

test("hosted progress delivery dependencies use the hosted Linq provider effect", async () => {
  const providerFetch = vi.fn() as unknown as typeof fetch;
  const signal = new AbortController().signal;
  const delivery = createHostedAssistantProgressDeliveryDependencies({
    forwardedEnv: {
      LINQ_API_BASE_URL: "https://api.linq.example",
      LINQ_API_TOKEN: "platform-linq-token",
    },
    providerFetch,
    signal,
    userEnv: {
      LINQ_API_TOKEN: "user-linq-token",
    },
  });

  await delivery.sendLinq?.({
    directRecipientPhoneNumber: "+15550000001",
    fromPhoneNumber: "+15550000002",
    idempotencyKey: "progress-key",
    message: "Checking the current thread.",
    replyToMessageId: "linq-reply",
    target: "linq-thread",
    targetKind: "thread",
  });

  assert.equal(delivery.signal, signal);
  assert.equal("sendTelegram" in delivery, false);
  assert.equal("sendWhatsApp" in delivery, false);
  assert.equal("sendEmail" in delivery, false);
  assert.deepEqual(mocks.sendHostedProviderLinqMessage.mock.calls[0]?.[0], {
    directRecipientPhoneNumber: "+15550000001",
    fromPhoneNumber: "+15550000002",
    idempotencyKey: "progress-key",
    message: "Checking the current thread.",
    replyToMessageId: "linq-reply",
    target: "linq-thread",
    targetKind: "thread",
  });
  assert.deepEqual(mocks.sendHostedProviderLinqMessage.mock.calls[0]?.[1], {
    env: {
      LINQ_API_BASE_URL: "https://api.linq.example",
      LINQ_API_TOKEN: "user-linq-token",
    },
    fetchImplementation: providerFetch,
    signal,
  });
});
