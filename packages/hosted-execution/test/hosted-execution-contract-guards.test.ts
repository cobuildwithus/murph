import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionRuntimeControlWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionWhatsAppConversationMessageWake,
} from "../src/builders.ts";
import {
  isHostedConversationMessageWake,
  isHostedEmailConversationMessageWake,
  isHostedExecutionWakeKind,
  isHostedLinqConversationMessageWake,
  isHostedSystemWake,
  isHostedTelegramConversationMessageWake,
  isHostedWhatsAppConversationMessageWake,
} from "../src/contracts.ts";

describe("hosted execution wake guards", () => {
  it("accepts canonical wake kinds only", () => {
    expect(isHostedExecutionWakeKind("conversation.message")).toBe(true);
    expect(isHostedExecutionWakeKind("member.activated")).toBe(true);
    expect(isHostedExecutionWakeKind("runtime.manual-requested")).toBe(true);
    expect(isHostedExecutionWakeKind("runtime.maintenance-requested")).toBe(true);
    expect(isHostedExecutionWakeKind("unsupported.kind")).toBe(false);
    expect(isHostedExecutionWakeKind("linq.message.received")).toBe(false);
    expect(isHostedExecutionWakeKind("email.message.received")).toBe(false);
  });

  it("narrows hosted wakes by conversation channel versus system wake", () => {
    const linqWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-wake-1",
      linqMessage: {
        chatId: "chat_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-04-18T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_guard",
      userId: "user_guard",
    });
    const telegramWake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "telegram-wake-1",
      occurredAt: "2026-04-18T00:00:00.000Z",
      telegramMessage: {
        messageId: "message_guard",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello telegram",
        threadId: "thread_guard",
      },
      userId: "user_guard",
    });
    const emailWake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "email-wake-1",
      identityId: "identity_guard",
      occurredAt: "2026-04-18T00:00:00.000Z",
      rawMessageKey: "raw_guard",
      selfAddress: null,
      userId: "user_guard",
    });
    const whatsappWake = buildHostedExecutionWhatsAppConversationMessageWake({
      eventId: "whatsapp-wake-1",
      occurredAt: "2026-04-18T00:00:00.000Z",
      userId: "user_guard",
      whatsappMessage: {
        fromWaId: "15551234567",
        messageId: "wamid.guard",
        schema: "murph.hosted-whatsapp-message.v1",
        text: "hello whatsapp",
        threadId: "15551234567",
      },
    });
    const systemWake = buildHostedExecutionDeviceSyncWake({
      eventId: "device-sync-wake-1",
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "connected",
      userId: "user_guard",
    });
    const controlWake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control-wake-1",
      kind: "runtime.maintenance-requested",
      occurredAt: "2026-04-18T00:00:00.000Z",
      userId: "user_guard",
    });

    expect(isHostedConversationMessageWake(linqWake)).toBe(true);
    expect(isHostedConversationMessageWake(telegramWake)).toBe(true);
    expect(isHostedConversationMessageWake(emailWake)).toBe(true);
    expect(isHostedConversationMessageWake(whatsappWake)).toBe(true);
    expect(isHostedConversationMessageWake(systemWake)).toBe(false);
    expect(isHostedConversationMessageWake(controlWake)).toBe(false);

    expect(isHostedLinqConversationMessageWake(linqWake)).toBe(true);
    expect(isHostedLinqConversationMessageWake(telegramWake)).toBe(false);
    expect(isHostedLinqConversationMessageWake(emailWake)).toBe(false);

    expect(isHostedTelegramConversationMessageWake(telegramWake)).toBe(true);
    expect(isHostedTelegramConversationMessageWake(linqWake)).toBe(false);
    expect(isHostedTelegramConversationMessageWake(emailWake)).toBe(false);

    expect(isHostedWhatsAppConversationMessageWake(whatsappWake)).toBe(true);
    expect(isHostedWhatsAppConversationMessageWake(telegramWake)).toBe(false);
    expect(isHostedWhatsAppConversationMessageWake(systemWake)).toBe(false);

    expect(isHostedEmailConversationMessageWake(emailWake)).toBe(true);
    expect(isHostedEmailConversationMessageWake(linqWake)).toBe(false);
    expect(isHostedEmailConversationMessageWake(systemWake)).toBe(false);

    expect(isHostedSystemWake(systemWake)).toBe(true);
    expect(isHostedSystemWake(controlWake)).toBe(true);
    expect(isHostedSystemWake(emailWake)).toBe(false);
  });
});
