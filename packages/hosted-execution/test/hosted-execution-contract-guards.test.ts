import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionWakeFromDispatch,
} from "../src/builders.ts";
import {
  isHostedConversationMessageWake,
  isHostedEmailConversationMessageWake,
  isHostedEmailMessageWakeDispatch,
  isHostedLinqMessageWakeDispatch,
  isHostedLinqConversationMessageWake,
  isHostedMessageWakeDispatch,
  isHostedMessageWakeEventKind,
  isHostedSystemWake,
  isHostedSystemWakeDispatch,
  isHostedTelegramConversationMessageWake,
  isHostedTelegramMessageWakeDispatch,
} from "../src/contracts.ts";

describe("hosted execution dispatch guards", () => {
  it("distinguishes message and system wake kinds", () => {
    expect(isHostedMessageWakeEventKind("linq.message.received")).toBe(true);
    expect(isHostedMessageWakeEventKind("telegram.message.received")).toBe(true);
    expect(isHostedMessageWakeEventKind("email.message.received")).toBe(true);
    expect(isHostedMessageWakeEventKind("assistant.cron.tick")).toBe(false);
    expect(isHostedMessageWakeEventKind("device-sync.wake")).toBe(false);
  });

  it("narrows hosted wake dispatches by message family", () => {
    const linqDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "linq-guard-1",
      linqEvent: { text: "hello" },
      occurredAt: "2026-04-18T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_guard",
      userId: "user_guard",
    });
    const telegramDispatch = buildHostedExecutionTelegramMessageReceivedDispatch({
      eventId: "telegram-guard-1",
      occurredAt: "2026-04-18T00:00:00.000Z",
      telegramMessage: {
        messageId: "message_guard",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello telegram",
        threadId: "thread_guard",
      },
      userId: "user_guard",
    });
    const emailDispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-guard-1",
      identityId: "identity_guard",
      occurredAt: "2026-04-18T00:00:00.000Z",
      rawMessageKey: "raw_guard",
      userId: "user_guard",
    });
    const systemDispatch = buildHostedExecutionAssistantCronTickDispatch({
      eventId: "cron-guard-1",
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "manual",
      userId: "user_guard",
    });

    expect(isHostedMessageWakeDispatch(linqDispatch)).toBe(true);
    expect(isHostedMessageWakeDispatch(telegramDispatch)).toBe(true);
    expect(isHostedMessageWakeDispatch(emailDispatch)).toBe(true);
    expect(isHostedMessageWakeDispatch(systemDispatch)).toBe(false);

    expect(isHostedSystemWakeDispatch(systemDispatch)).toBe(true);
    expect(isHostedSystemWakeDispatch(linqDispatch)).toBe(false);

    expect(isHostedLinqMessageWakeDispatch(linqDispatch)).toBe(true);
    expect(isHostedLinqMessageWakeDispatch(telegramDispatch)).toBe(false);
    expect(isHostedLinqMessageWakeDispatch(emailDispatch)).toBe(false);

    expect(isHostedTelegramMessageWakeDispatch(telegramDispatch)).toBe(true);
    expect(isHostedTelegramMessageWakeDispatch(linqDispatch)).toBe(false);
    expect(isHostedTelegramMessageWakeDispatch(emailDispatch)).toBe(false);

    expect(isHostedEmailMessageWakeDispatch(emailDispatch)).toBe(true);
    expect(isHostedEmailMessageWakeDispatch(linqDispatch)).toBe(false);
    expect(isHostedEmailMessageWakeDispatch(systemDispatch)).toBe(false);
  });

  it("narrows hosted wakes by conversation channel versus system wake", () => {
    const linqWake = buildHostedExecutionWakeFromDispatch(
      buildHostedExecutionLinqMessageReceivedDispatch({
        eventId: "linq-wake-1",
        linqEvent: { text: "hello" },
        linqMessageId: null,
        occurredAt: "2026-04-18T00:00:00.000Z",
        phoneLookupKey: "phone_lookup_guard",
        userId: "user_guard",
      }),
    );
    const telegramWake = buildHostedExecutionWakeFromDispatch(
      buildHostedExecutionTelegramMessageReceivedDispatch({
        eventId: "telegram-wake-1",
        occurredAt: "2026-04-18T00:00:00.000Z",
        telegramMessage: {
          messageId: "message_guard",
          schema: "murph.hosted-telegram-message.v1",
          text: "hello telegram",
          threadId: "thread_guard",
        },
        userId: "user_guard",
      }),
    );
    const emailWake = buildHostedExecutionWakeFromDispatch(
      buildHostedExecutionEmailMessageReceivedDispatch({
        eventId: "email-wake-1",
        identityId: "identity_guard",
        occurredAt: "2026-04-18T00:00:00.000Z",
        rawMessageKey: "raw_guard",
        selfAddress: null,
        userId: "user_guard",
      }),
    );
    const systemWake = buildHostedExecutionWakeFromDispatch(
      buildHostedExecutionAssistantCronTickDispatch({
        eventId: "cron-wake-1",
        occurredAt: "2026-04-18T00:00:00.000Z",
        reason: "manual",
        userId: "user_guard",
      }),
    );

    expect(isHostedConversationMessageWake(linqWake)).toBe(true);
    expect(isHostedConversationMessageWake(telegramWake)).toBe(true);
    expect(isHostedConversationMessageWake(emailWake)).toBe(true);
    expect(isHostedConversationMessageWake(systemWake)).toBe(false);

    expect(isHostedLinqConversationMessageWake(linqWake)).toBe(true);
    expect(isHostedLinqConversationMessageWake(telegramWake)).toBe(false);
    expect(isHostedLinqConversationMessageWake(emailWake)).toBe(false);

    expect(isHostedTelegramConversationMessageWake(telegramWake)).toBe(true);
    expect(isHostedTelegramConversationMessageWake(linqWake)).toBe(false);
    expect(isHostedTelegramConversationMessageWake(emailWake)).toBe(false);

    expect(isHostedEmailConversationMessageWake(emailWake)).toBe(true);
    expect(isHostedEmailConversationMessageWake(linqWake)).toBe(false);
    expect(isHostedEmailConversationMessageWake(systemWake)).toBe(false);

    expect(isHostedSystemWake(systemWake)).toBe(true);
    expect(isHostedSystemWake(emailWake)).toBe(false);
  });
});
