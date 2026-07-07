import assert from "node:assert/strict";

import { beforeEach, expect, test, vi } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
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
} from "../src/hosted-runtime/channel-activity.ts";

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
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

function buildLinqRouteAuthority(threadId: string) {
  return {
    accountLookupKey: "hbidx:phone:v1:account",
    channel: "linq" as const,
    containerMemberId: "member_123",
    threadId,
  };
}

test("hosted Linq typing uses the hosted env after target context validation", async () => {
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

  const routeAuthority = buildLinqRouteAuthority("chat_123");
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv,
    linqDeliveryContexts: [
      {
        directRecipientPhoneNumber: "+15551234567",
        fromPhoneNumber: null,
        replyToMessageId: "msg_123",
        routeAuthority,
        service: null,
        target: "chat_123",
        threadIsDirect: null,
      },
    ],
    platformEnv: {
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
    providerFetch: vi.fn<typeof fetch>(),
    userEnv,
  });

  await expect(typing.startLinqTyping?.({
    target: "chat_123",
  })).resolves.toBeUndefined();

  assert.deepEqual(mocks.startLinqTypingIndicator.mock.calls[0]?.[0], {
    target: "chat_123",
  });
  assert.deepEqual(mocks.startLinqTypingIndicator.mock.calls[0]?.[1]?.env, linqEnv);
  assert.equal(mocks.startLinqTypingIndicator.mock.calls[0]?.[1]?.maxSessionMs, 5 * 60_000);
  assert.equal(mocks.startLinqTypingIndicator.mock.calls[0]?.[1]?.refreshMs, 45_000);
});

test("hosted Linq typing starts without route authority when the target context matches", async () => {
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
    },
    linqDeliveryContexts: [
      {
        directRecipientPhoneNumber: "+15551234567",
        fromPhoneNumber: null,
        replyToMessageId: "msg_123",
        routeAuthority: null,
        service: null,
        target: "chat_123",
        threadIsDirect: null,
      },
    ],
    platformEnv: {},
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
  });

  await expect(typing.startLinqTyping?.({
    target: "chat_123",
  })).resolves.toBeUndefined();

  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledWith(
    {
      target: "chat_123",
    },
    expect.any(Object),
  );
});

test("hosted Linq typing no-ops when no delivery context is present", async () => {
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
    },
    linqDeliveryContexts: [],
    platformEnv: {},
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
  });

  await expect(typing.startLinqTyping?.({
    target: "chat_123",
  })).resolves.toBeUndefined();

  expect(mocks.startLinqTypingIndicator).not.toHaveBeenCalled();
});

test("hosted Linq typing allows only one active session per target", async () => {
  const stop = vi.fn(async () => undefined);
  mocks.startLinqTypingIndicator.mockResolvedValue({
    stop,
  });
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
    },
    linqDeliveryContexts: [
      {
        directRecipientPhoneNumber: "+15551234567",
        fromPhoneNumber: null,
        replyToMessageId: "msg_123",
        routeAuthority: buildLinqRouteAuthority("chat_123"),
        service: null,
        target: "chat_123",
        threadIsDirect: null,
      },
    ],
    platformEnv: {},
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
  });

  const handle = await typing.startLinqTyping?.({
    target: "chat_123",
  });
  await expect(typing.startLinqTyping?.({
    target: "chat_123",
  })).resolves.toBeUndefined();

  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledTimes(1);
  await handle?.stop();
  const restartedHandle = await typing.startLinqTyping?.({
    target: "chat_123",
  });
  expect(restartedHandle).toBeDefined();
  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledTimes(2);
  await restartedHandle?.stop();
});

test("hosted Linq typing suppresses restarts after a max-length session", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-07T12:00:00.000Z"));
  const stop = vi.fn(async () => undefined);
  mocks.startLinqTypingIndicator.mockResolvedValue({
    stop,
  });
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
    },
    linqDeliveryContexts: [
      {
        directRecipientPhoneNumber: "+15551234567",
        fromPhoneNumber: null,
        replyToMessageId: "msg_123",
        routeAuthority: null,
        service: null,
        target: "chat_123",
        threadIsDirect: null,
      },
    ],
    platformEnv: {},
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
  });

  const handle = await typing.startLinqTyping?.({
    target: "chat_123",
  });
  vi.setSystemTime(new Date("2026-07-07T12:05:01.000Z"));
  await handle?.stop();

  await expect(typing.startLinqTyping?.({
    target: "chat_123",
  })).resolves.toBeUndefined();
  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledTimes(1);

  vi.setSystemTime(new Date("2026-07-07T12:15:02.000Z"));
  const restartedHandle = await typing.startLinqTyping?.({
    target: "chat_123",
  });
  expect(restartedHandle).toBeDefined();
  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledTimes(2);
  await restartedHandle?.stop();
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
  const routeAuthority = buildLinqRouteAuthority("linq_chat_123");
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {},
    linqDeliveryContexts: [
      {
        directRecipientPhoneNumber: "+15551234567",
        fromPhoneNumber: null,
        replyToMessageId: "msg_123",
        routeAuthority,
        service: null,
        target: "linq_chat_123",
        threadIsDirect: null,
      },
    ],
    platformEnv: {},
    providerFetch,
    userEnv: {},
  });

  await expect(typing.startLinqTyping?.({
    target: "linq_chat_123",
  })).resolves.toBeUndefined();
  await typing.startTelegramTyping?.({
    target: "telegram_chat_123",
  });

  assert.equal(mocks.startLinqTypingIndicator.mock.calls[0]?.[1]?.fetchImplementation, providerFetch);
  assert.equal(mocks.startTelegramTypingIndicator.mock.calls[0]?.[1]?.fetchImplementation, providerFetch);
});

test("hosted Linq typing no-ops when the target is not the current inbound context", async () => {
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
    },
    linqDeliveryContexts: [
      {
        directRecipientPhoneNumber: "+15551234567",
        fromPhoneNumber: null,
        replyToMessageId: "msg_123",
        routeAuthority: null,
        service: null,
        target: "current_linq_chat",
        threadIsDirect: null,
      },
    ],
    platformEnv: {},
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
  });

  await expect(typing.startLinqTyping?.({
    target: "different_linq_chat",
  })).resolves.toBeUndefined();

  expect(mocks.startLinqTypingIndicator).not.toHaveBeenCalled();
});

test("hosted Linq typing does not use target fallback when another context is present", async () => {
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
    },
    linqDeliveryContexts: [
      {
        directRecipientPhoneNumber: "+15551234567",
        fromPhoneNumber: null,
        replyToMessageId: "msg_123",
        routeAuthority: null,
        service: null,
        target: "current_linq_chat",
        threadIsDirect: null,
      },
    ],
    platformEnv: {},
    providerFetch: vi.fn<typeof fetch>(),
    userEnv: {},
  });

  await expect(typing.startLinqTyping?.({
    target: "different_linq_chat",
  })).resolves.toBeUndefined();

  expect(mocks.startLinqTypingIndicator).not.toHaveBeenCalled();
});

test("hosted channel activity does not use ambient fetch when provider fetch is missing", async () => {
  const typing = createHostedAssistantChannelTypingDependencies({
    forwardedEnv: {},
    linqDeliveryContexts: [
      {
        directRecipientPhoneNumber: "+15551234567",
        fromPhoneNumber: null,
        replyToMessageId: "msg_123",
        routeAuthority: null,
        service: null,
        target: "linq_chat_123",
        threadIsDirect: null,
      },
    ],
    platformEnv: {},
    userEnv: {},
  });

  await expect(typing.startLinqTyping?.({
    target: "linq_chat_123",
  })).resolves.toBeUndefined();

  expect(mocks.startLinqTypingIndicator).not.toHaveBeenCalled();
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
      async assertLinqRecentInboundEngagement() {},
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
    effectsPort: {
      async assertLinqRecentInboundEngagement() {},
      sendEmail: mocks.sendEmail,
    },
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
    effectsPort: {
      async assertLinqRecentInboundEngagement() {},
      sendEmail: mocks.sendEmail,
    },
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

test("hosted progress Linq delivery sends recovered same-wake chat when request target is blinded", async () => {
  const wake = buildHostedExecutionLinqConversationMessageWake({
    eventId: "evt_linq_progress_blinded_target",
    linqMessage: {
      chatId: "linq_chat_current",
      from: "+15550000001",
      isFromMe: false,
      messageId: "linq_message_current",
      parts: [],
    },
    occurredAt: "2026-04-08T00:00:00.000Z",
    phoneLookupKey: "+15550000002",
    userId: "member_123",
  });
  const delivery = createHostedAssistantProgressDeliveryDependencies({
    effectsPort: {
      async assertLinqRecentInboundEngagement() {},
      sendEmail: mocks.sendEmail,
    },
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
    replyToMessageId: "linq_message_current",
    target: "hbid:linq-chat:v1:redacted",
    targetKind: "thread",
  });

  assert.deepEqual(mocks.sendHostedProviderLinqMessage.mock.calls[0]?.[0], {
    directRecipientPhoneNumber: "+15550000001",
    fromPhoneNumber: null,
    idempotencyKey: "progress-key",
    media: null,
    message: "Checking the current thread.",
    replyToMessageId: "linq_message_current",
    target: "linq_chat_current",
    targetKind: "thread",
  });
});

test("hosted progress Linq delivery recovers redacted routed same-wake chat through egress authority", async () => {
  const routeAuthority = buildLinqRouteAuthority("linq_chat_current");
  const wake = buildHostedExecutionLinqConversationMessageWake({
    eventId: "evt_linq_progress_blinded_routed_target",
    linqMessage: {
      chatId: "linq_chat_current",
      from: "+15550000001",
      isFromMe: false,
      messageId: "linq_message_current",
      parts: [],
    },
    occurredAt: "2026-04-08T00:00:00.000Z",
    phoneLookupKey: "+15550000002",
    routeAuthority,
    userId: "member_123",
  });
  const assertRecentInbound = vi.fn(async () => undefined);
  const delivery = createHostedAssistantProgressDeliveryDependencies({
    effectsPort: {
      assertLinqRecentInboundEngagement: assertRecentInbound,
      sendEmail: mocks.sendEmail,
    },
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
    replyToMessageId: "linq_message_current",
    target: "hbid:linq-chat:v1:redacted",
    targetKind: "thread",
  });

  expect(assertRecentInbound).toHaveBeenCalledWith(
    expect.objectContaining({
      routeAuthority,
      target: "linq_chat_current",
      targetKind: "thread",
    }),
    {
      signal: null,
    },
  );
  assert.deepEqual(mocks.sendHostedProviderLinqMessage.mock.calls[0]?.[0], {
    directRecipientPhoneNumber: "+15550000001",
    fromPhoneNumber: null,
    idempotencyKey: "progress-key",
    media: null,
    message: "Checking the current thread.",
    replyToMessageId: "linq_message_current",
    target: "linq_chat_current",
    targetKind: "thread",
  });
});
