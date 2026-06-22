import assert from "node:assert/strict";

import { beforeEach, expect, test, vi } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  markLinqChatRead: vi.fn(),
  sendEmail: vi.fn(),
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
  mocks.sendEmail.mockResolvedValue({
    providerMessageId: "email-message",
    providerThreadId: "email-thread",
    target: "email-thread",
  });
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
    providerFetch: vi.fn<typeof fetch>(),
    userEnv,
  });

  await typing.startLinqTyping?.({
    target: "chat_123",
  });
  await markHostedConversationReadBestEffort({
    forwardedEnv,
    providerFetch: vi.fn<typeof fetch>(),
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
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
  });

  await typing.startTelegramTyping?.({
    target: "telegram-thread",
  });

  assert.deepEqual(mocks.startTelegramTypingIndicator.mock.calls[0]?.[1]?.env, telegramEnv);
});

test("hosted channel activity uses provider fetch instead of effects-port provider tunnels", async () => {
  const providerFetch = vi.fn<typeof fetch>();
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

test("hosted channel activity does not use ambient fetch when provider fetch is missing", async () => {
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {},
    platformEnv: {},
    userEnv: {},
  });

  await expect(typing.startLinqTyping?.({
    target: "linq_chat_123",
  })).rejects.toMatchObject({
    code: "HOSTED_PROVIDER_FETCH_UNAVAILABLE",
  });
  await markHostedConversationReadBestEffort({
    forwardedEnv: {},
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

  expect(mocks.startLinqTypingIndicator).not.toHaveBeenCalled();
  expect(mocks.markLinqChatRead).not.toHaveBeenCalled();
});

test("hosted progress delivery dependencies use the hosted Linq provider effect", async () => {
  const providerFetch = vi.fn<typeof fetch>(async () =>
    Response.json({
      ok: true,
      result: {
        chat: { id: 123 },
        message_id: 42,
      },
    })
  );
  const signal = new AbortController().signal;
  const delivery = createHostedAssistantProgressDeliveryDependencies({
    effectsPort: {
      sendEmail: mocks.sendEmail,
    },
    forwardedEnv: {
      LINQ_API_BASE_URL: "https://api.linq.example",
      LINQ_API_TOKEN: "platform-linq-token",
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
    },
    platformEnv: {
      TELEGRAM_BOT_TOKEN: "platform-telegram-token",
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
    media: [
      {
        kind: "image",
        url: "https://cdn.example.test/dead-bug/setup.png",
        alt: "Dead bug setup",
        source: "dead-bug-setup",
      },
    ],
    message: "Checking the current thread.",
    replyToMessageId: "linq-reply",
    target: "linq-thread",
    targetKind: "thread",
  });
  await delivery.sendTelegram?.({
    idempotencyKey: "telegram-progress-key",
    message: "Checking the current Telegram thread.",
    replyToMessageId: "7",
    target: "123",
  });
  await delivery.sendEmail?.({
    idempotencyKey: "email-progress-key",
    identityId: null,
    message: "Checking the current email thread.",
    replyToMessageId: "email-reply",
    subject: "Murph update",
    target: "email-thread",
    targetKind: "thread",
  });

  assert.equal(delivery.signal, signal);
  assert.equal("sendWhatsApp" in delivery, false);
  assert.deepEqual(mocks.sendHostedProviderLinqMessage.mock.calls[0]?.[0], {
    directRecipientPhoneNumber: "+15550000001",
    fromPhoneNumber: "+15550000002",
    idempotencyKey: "progress-key",
    media: [
      {
        kind: "image",
        url: "https://cdn.example.test/dead-bug/setup.png",
        alt: "Dead bug setup",
        source: "dead-bug-setup",
      },
    ],
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
  assert.equal(
    String(providerFetch.mock.calls[0]?.[0]),
    "https://api.telegram.example/botplatform-telegram-token/sendMessage",
  );
  assert.deepEqual(JSON.parse(String(providerFetch.mock.calls[0]?.[1]?.body)), {
    chat_id: "123",
    reply_to_message_id: 7,
    text: "Checking the current Telegram thread.",
  });
  assert.deepEqual(mocks.sendEmail.mock.calls[0]?.[0], {
    idempotencyKey: "email-progress-key",
    message: "Checking the current email thread.",
    replyToMessageId: "email-reply",
    subject: "Murph update",
    target: "email-thread",
    targetKind: "thread",
  });
});

test("hosted progress email delivery rejects participant targets", async () => {
  const delivery = createHostedAssistantProgressDeliveryDependencies({
    effectsPort: {
      sendEmail: mocks.sendEmail,
    },
  });
  const sendEmail = delivery.sendEmail;
  assert.ok(sendEmail);

  await assert.rejects(
    () => sendEmail({
      identityId: null,
      message: "Checking the current email participant.",
      subject: null,
      target: "sender@example.test",
      targetKind: "participant",
    }),
    {
      code: "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
    },
  );
  assert.equal(mocks.sendEmail.mock.calls.length, 0);
});

test("hosted progress Linq delivery aborts provider send when request signal aborts", async () => {
  const requestAbort = new AbortController();
  const providerAbort = new Error("progress delivery closed");
  let providerEnteredResolve: (() => void) | null = null;
  const providerEntered = new Promise<void>((resolve) => {
    providerEnteredResolve = resolve;
  });
  mocks.sendHostedProviderLinqMessage.mockImplementationOnce(async (_payload, options) => {
    providerEnteredResolve?.();
    return await new Promise((_resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason);
        return;
      }
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    });
  });
  const delivery = createHostedAssistantProgressDeliveryDependencies({
    forwardedEnv: {
      LINQ_API_BASE_URL: "https://api.linq.example",
      LINQ_API_TOKEN: "platform-linq-token",
    },
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
  });

  const sendPromise = delivery.sendLinq?.({
    idempotencyKey: "progress-key",
    message: "Checking the current thread.",
    replyToMessageId: null,
    signal: requestAbort.signal,
    target: "linq-thread",
    targetKind: "thread",
  });
  await providerEntered;
  requestAbort.abort(providerAbort);

  assert.ok(sendPromise);
  await assert.rejects(sendPromise, /progress delivery closed/u);
  assert.equal(mocks.sendHostedProviderLinqMessage.mock.calls[0]?.[1]?.signal?.aborted, true);
});

test("hosted progress Linq delivery recovers same-wake direct recipient only", async () => {
  const wake = buildHostedExecutionLinqConversationMessageWake({
    eventId: "evt_linq_progress",
    linqMessage: {
      chatId: "linq-thread",
      from: "+15550000001",
      isFromMe: false,
      messageId: "linq-reply",
      parts: [],
    },
    occurredAt: "2026-04-08T00:00:00.000Z",
    phoneLookupKey: "+15550000002",
    userId: "member_123",
  });
  const delivery = createHostedAssistantProgressDeliveryDependencies({
    forwardedEnv: {
      LINQ_API_BASE_URL: "https://api.linq.example",
      LINQ_API_TOKEN: "platform-linq-token",
    },
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
    wake,
  });

  await delivery.sendLinq?.({
    directRecipientPhoneNumber: null,
    fromPhoneNumber: null,
    idempotencyKey: "progress-key",
    message: "Checking the current thread.",
    replyToMessageId: null,
    target: "linq-thread",
    targetKind: "thread",
  });

  assert.deepEqual(mocks.sendHostedProviderLinqMessage.mock.calls[0]?.[0], {
    directRecipientPhoneNumber: "+15550000001",
    fromPhoneNumber: null,
    idempotencyKey: "progress-key",
    media: null,
    message: "Checking the current thread.",
    replyToMessageId: null,
    target: "linq-thread",
    targetKind: "thread",
  });
});
