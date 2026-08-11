import { describe, expect, it } from "vitest";

import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";

import {
  createHostedAssistantConversationIdentifierBlind,
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
  createHostedMailboxAssistantInputId,
  createHostedMailboxAssistantInputIdFromBlindedIdentity,
  hashHostedAssistantConversationIdentifier,
  hashNullableHostedAssistantConversationIdentifier,
  readHostedConversationAssistantIdentifierSecret,
} from "../src/assistant-identifiers.ts";
import type { HostedExecutionConversationMessageWake } from "../src/contracts.ts";

const HOSTED_ASSISTANT_IDENTIFIER_PATTERN = /^hid_[0-9a-f]{32}$/u;

describe("hosted Assistant Ask delivery identifiers", () => {
  it("preserves the reviewed Assistant Ask completion delivery key byte-for-byte", () => {
    expect(createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
      "aask_done_exact_vector",
    )).toBe(
      "reviewed-assistant-ask-completion:aef61e90376a8d9f43a6bc329711d11b20c66c8ea5a5b4af",
    );
  });

  it("preserves the private Assistant Ask completion delivery key byte-for-byte", () => {
    expect(createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
      " aask_done_exact_vector ",
    )).toBe("assistant-ask-private:aask_done_exact_vector");
  });
});

describe("hosted assistant conversation identifiers", () => {
  it("derives stable blinded identifiers for one hosted member", () => {
    const firstBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_test",
    });
    const secondBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_test",
    });

    expect(hashHostedAssistantConversationIdentifier(
      firstBlind,
      " +15550100001 ",
    )).toBe(hashHostedAssistantConversationIdentifier(
      secondBlind,
      "+15550100001",
    ));
    expect(hashHostedAssistantConversationIdentifier(
      firstBlind,
      "+15550100001",
    )).toMatch(HOSTED_ASSISTANT_IDENTIFIER_PATTERN);
  });

  it("scopes the same conversation identifier value per hosted member", () => {
    const firstBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_first",
    });
    const secondBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_second",
    });

    expect(hashHostedAssistantConversationIdentifier(
      firstBlind,
      "chat_home_123",
    )).not.toBe(hashHostedAssistantConversationIdentifier(
      secondBlind,
      "chat_home_123",
    ));
  });

  it("keeps nullable identifiers nullable while hashing non-empty values", () => {
    const blind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_nullable",
    });

    expect(hashNullableHostedAssistantConversationIdentifier(blind, null)).toBeNull();
    expect(hashNullableHostedAssistantConversationIdentifier(blind, "   ")).toBeNull();
    expect(hashNullableHostedAssistantConversationIdentifier(
      blind,
      "hbidx:phone:v1:lookup",
    )).toMatch(HOSTED_ASSISTANT_IDENTIFIER_PATTERN);
  });

  it("requires and incorporates secret-derived member routing material", () => {
    const firstBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:first",
      userId: "member_identifier_secret",
    });
    const secondBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:second",
      userId: "member_identifier_secret",
    });

    expect(hashHostedAssistantConversationIdentifier(
      firstBlind,
      "chat_home_123",
    )).not.toBe(hashHostedAssistantConversationIdentifier(
      secondBlind,
      "chat_home_123",
    ));
    expect(() =>
      createHostedAssistantConversationIdentifierBlind({
        secret: " ",
        userId: "member_identifier_secret",
      })
    ).toThrow(/secret material/u);
  });

  it("preserves the existing hosted mailbox input id byte-for-byte", () => {
    const input = {
      dedupeKey: "evt_golden",
      eventId: "evt_golden",
      lane: "conversation" as const,
      secret: "hbidx:phone:v1:account",
      userId: "member_golden",
    };
    const blind = createHostedAssistantConversationIdentifierBlind(input);
    const blindedDedupeKey = hashNullableHostedAssistantConversationIdentifier(
      blind,
      input.dedupeKey,
    );
    const blindedEventId = hashHostedAssistantConversationIdentifier(
      blind,
      input.eventId,
    );

    expect(createHostedMailboxAssistantInputId(input)).toBe(
      "ain_f4b132fd351b0ac309d77bfc4223137e",
    );
    expect(createHostedMailboxAssistantInputIdFromBlindedIdentity({
      dedupeKey: blindedDedupeKey,
      eventId: blindedEventId,
      lane: input.lane,
    })).toBe("ain_f4b132fd351b0ac309d77bfc4223137e");
  });

  it("derives the canonical channel conversation secret", () => {
    const baseWake = {
      eventId: "evt_channel_secret",
      kind: "conversation.message" as const,
      occurredAt: "2026-07-14T12:00:00.000Z",
      userId: "member_channel_secret",
    };
    const linqMessage = {
      chatId: "chat_channel_secret",
      from: "+15550100001",
      isFromMe: false,
      messageId: "message_channel_secret",
      parts: [],
    };
    const linqAccountWake = {
      ...baseWake,
      message: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq" as const,
        contactKind: "phone" as const,
        contactLookupKey: "hbidx:phone:v1:contact",
        linqMessage,
      },
    } satisfies HostedExecutionConversationMessageWake;
    const linqContactFallbackWake = {
      ...baseWake,
      message: {
        channel: "linq" as const,
        contactKind: "phone" as const,
        contactLookupKey: "hbidx:phone:v1:contact",
        linqMessage,
      },
    } satisfies HostedExecutionConversationMessageWake;
    const linqPhoneFallbackWake = {
      ...baseWake,
      message: {
        channel: "linq" as const,
        linqMessage,
        phoneLookupKey: "hbidx:phone:v1:legacy",
      },
    } satisfies HostedExecutionConversationMessageWake;
    const telegramWake = {
      ...baseWake,
      message: {
        channel: "telegram" as const,
        telegramMessage: {
          messageId: "telegram_message",
          schema: "murph.hosted-telegram-message.v1" as const,
          threadId: "telegram_thread",
        },
      },
    } satisfies HostedExecutionConversationMessageWake;

    expect(readHostedConversationAssistantIdentifierSecret(linqAccountWake)).toBe(
      "hbidx:phone:v1:account",
    );
    expect(readHostedConversationAssistantIdentifierSecret(
      linqContactFallbackWake,
    )).toBe("hbidx:phone:v1:contact");
    expect(readHostedConversationAssistantIdentifierSecret(
      linqPhoneFallbackWake,
    )).toBe("hbidx:phone:v1:legacy");
    expect(readHostedConversationAssistantIdentifierSecret(telegramWake)).toBe(
      "telegram_thread",
    );
  });

  it("preserves direct, group, legacy, and raw email secret fallbacks", () => {
    const baseWake = {
      eventId: "evt_email_secret",
      kind: "conversation.message" as const,
      occurredAt: "2026-07-14T12:00:00.000Z",
      userId: "member_email_secret",
    };
    const directWake = {
      ...baseWake,
      message: {
        channel: "email" as const,
        identityId: "identity_email",
        rawMessageKey: "raw_email",
        selfAddress: "self@example.test",
        threadKey: "thread_email",
      },
    } satisfies HostedExecutionConversationMessageWake;
    const directFallbackWake = {
      ...directWake,
      message: {
        ...directWake.message,
        identityId: null,
      },
    } satisfies HostedExecutionConversationMessageWake;
    const groupThreadWake = {
      ...directWake,
      message: {
        ...directWake.message,
        threadTarget: serializeHostedEmailThreadTarget({
          groupId: "group_email",
          targetKind: "group",
        }),
      },
    } satisfies HostedExecutionConversationMessageWake;
    const groupLegacyWake = {
      ...groupThreadWake,
      message: {
        ...groupThreadWake.message,
        threadKey: null,
        threadTarget: serializeHostedEmailThreadTarget({
          groupId: "group_email",
          references: ["legacy_root"],
          targetKind: "group",
        }),
      },
    } satisfies HostedExecutionConversationMessageWake;
    const groupRawWake = {
      ...groupLegacyWake,
      message: {
        ...groupLegacyWake.message,
        threadTarget: serializeHostedEmailThreadTarget({
          groupId: "group_email",
          targetKind: "group",
        }),
      },
    } satisfies HostedExecutionConversationMessageWake;

    expect(readHostedConversationAssistantIdentifierSecret(directWake)).toBe(
      "identity_email",
    );
    expect(readHostedConversationAssistantIdentifierSecret(directFallbackWake)).toBe(
      "self@example.test",
    );
    expect(readHostedConversationAssistantIdentifierSecret(groupThreadWake)).toBe(
      "group:group_email\0thread:thread_email",
    );
    expect(readHostedConversationAssistantIdentifierSecret(groupLegacyWake)).toBe(
      "group:group_email\0root:legacy_root",
    );
    expect(readHostedConversationAssistantIdentifierSecret(groupRawWake)).toBe(
      "raw_email",
    );
  });
});
