import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberPreferencesUpdatedWake,
  buildHostedExecutionRuntimeControlWake,
  buildHostedExecutionProviderSetupContinuationRequestedWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "../src/builders.ts";
import {
  isHostedConversationMessageWake,
  isHostedEmailConversationMessageWake,
  isHostedExecutionWakeKind,
  isHostedLinqConversationMessageWake,
  isHostedSystemWake,
  isHostedTelegramConversationMessageWake,
} from "../src/contracts.ts";
import {
  parseHostedExecutionWake,
} from "../src/parsers.ts";

describe("hosted execution wake guards", () => {
  it("accepts canonical wake kinds only", () => {
    expect(isHostedExecutionWakeKind("conversation.message")).toBe(true);
    expect(isHostedExecutionWakeKind("member.activated")).toBe(true);
    expect(isHostedExecutionWakeKind("member.preferences.updated")).toBe(true);
    expect(isHostedExecutionWakeKind("runtime.manual-requested")).toBe(true);
    expect(
      isHostedExecutionWakeKind("runtime.pending-effects-reconcile-requested"),
    ).toBe(true);
    expect(isHostedExecutionWakeKind("runtime.maintenance-requested")).toBe(true);
    expect(
      isHostedExecutionWakeKind("runtime.provider-setup-continuation-requested"),
    ).toBe(true);
    expect(isHostedExecutionWakeKind("unsupported.kind")).toBe(false);
    expect(isHostedExecutionWakeKind("linq.message.received")).toBe(false);
    expect(isHostedExecutionWakeKind("email.message.received")).toBe(false);
  });

  it("round-trips one typed provider setup continuation without credentials", () => {
    const wake = buildHostedExecutionProviderSetupContinuationRequestedWake({
      eventId: "runtime-control:provider-setup-continuation:fixture",
      occurredAt: "1970-01-01T00:00:00.000Z",
      providerSetup: {
        handoffId: "hch_fixture",
        provider: "strava",
        runId: "hcr_fixture",
        setupId: "dps_fixture",
        setupVersion: 2,
      },
      userId: "member_fixture",
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(JSON.stringify(wake)).not.toMatch(/clientId|clientSecret|credential/iu);
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
    const preferencesWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member-preferences-wake-1",
      memberId: "user_guard",
      occurredAt: "2026-07-08T00:00:00.000Z",
      preferences: {
        tone: "casual",
        voice: "warm",
      },
    });

    expect(isHostedConversationMessageWake(linqWake)).toBe(true);
    expect(isHostedConversationMessageWake(telegramWake)).toBe(true);
    expect(isHostedConversationMessageWake(emailWake)).toBe(true);
    expect(isHostedConversationMessageWake(systemWake)).toBe(false);
    expect(isHostedConversationMessageWake(controlWake)).toBe(false);

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
    expect(isHostedSystemWake(controlWake)).toBe(true);
    expect(isHostedSystemWake(preferencesWake)).toBe(true);
    expect(isHostedSystemWake(emailWake)).toBe(false);
  });

  it("parses Linq message corrections with a bounded text-part index", () => {
    const wake = {
      ...buildHostedExecutionLinqConversationMessageWake({
        eventId: "linq-edit-wake-1",
        linqMessage: {
          chatId: "chat_edit",
          editedSourceInputId: "ain_11111111111111111111111111111111",
          editedTextPartIndex: 0,
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_edit",
          parts: [{ type: "text" as const, value: "corrected wording" }],
          replyToMessageId: "msg_edit",
        },
        occurredAt: "2026-07-28T18:00:00.000Z",
        phoneLookupKey: "phone_lookup_edit",
        userId: "user_edit",
      }),
    };

    expect(parseHostedExecutionWake(wake)).toEqual(wake);

    for (const editedTextPartIndex of [-1, 1.5, 2_147_483_648]) {
      expect(() =>
        parseHostedExecutionWake({
          ...wake,
          message: {
            ...wake.message,
            linqMessage: {
              ...wake.message.linqMessage,
              editedTextPartIndex,
            },
          },
        }),
      ).toThrow("editedTextPartIndex");
    }
    expect(() =>
      parseHostedExecutionWake({
        ...wake,
        message: {
          ...wake.message,
          linqMessage: {
            ...wake.message.linqMessage,
            editedSourceInputId: "msg_provider_private",
          },
        },
      }),
    ).toThrow("editedSourceInputId");
  });

  it("parses member preferences updated wakes with strict shared preference ids", () => {
    expect(
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-sparse-personality",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-08T00:00:00.000Z",
        preferences: {
          personality: {
            humor: 7,
          },
        },
        userId: "user_guard",
      }),
    ).toEqual({
      eventId: "member-preferences-wake-sparse-personality",
      kind: "member.preferences.updated",
      occurredAt: "2026-07-08T00:00:00.000Z",
      preferences: {
        personality: {
          humor: 7,
        },
      },
      userId: "user_guard",
    });

    expect(
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-persona",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-20T00:00:00.000Z",
        preferences: {
          persona: "navy-seal",
          tone: "casual",
          voice: "drill-sergeant",
        },
        requestedFields: ["persona", "tone", "voice"],
        userId: "user_guard",
      }),
    ).toEqual({
      eventId: "member-preferences-wake-persona",
      kind: "member.preferences.updated",
      occurredAt: "2026-07-20T00:00:00.000Z",
      preferences: {
        persona: "navy-seal",
        tone: "casual",
        voice: "drill-sergeant",
      },
      requestedFields: ["persona", "tone", "voice"],
      userId: "user_guard",
    });

    const wake = parseHostedExecutionWake({
      eventId: "member-preferences-wake-1",
      kind: "member.preferences.updated",
      occurredAt: "2026-07-08T00:00:00.000Z",
      preferences: {
        personality: {
          detail: 8,
          humor: 0,
          push: null,
        },
        tone: "formal",
        voice: "upbeat",
      },
      userId: "user_guard",
    });

    expect(wake).toEqual({
      eventId: "member-preferences-wake-1",
      kind: "member.preferences.updated",
      occurredAt: "2026-07-08T00:00:00.000Z",
      preferences: {
        personality: {
          detail: 8,
          humor: 0,
          push: null,
        },
        tone: "formal",
        voice: "upbeat",
      },
      userId: "user_guard",
    });
    expect(
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-legacy-persona",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-07T00:00:00.000Z",
        preferences: {
          persona: "medical-detective",
        },
        userId: "user_guard",
      }),
    ).toEqual({
      eventId: "member-preferences-wake-legacy-persona",
      kind: "member.preferences.updated",
      occurredAt: "2026-07-07T00:00:00.000Z",
      preferences: {
        persona: "scientist",
      },
      userId: "user_guard",
    });
    expect(() =>
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-empty",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-08T00:00:00.000Z",
        preferences: {},
        userId: "user_guard",
      }),
    ).toThrow(/tone, voice, or personality/u);
    expect(() =>
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-invalid-persona",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-20T00:00:00.000Z",
        preferences: {
          persona: "celebrity-guru",
        },
        userId: "user_guard",
      }),
    ).toThrow(/persona/u);
    expect(() =>
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-invalid",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-08T00:00:00.000Z",
        preferences: {
          voice: "not-a-roster-id",
        },
        userId: "user_guard",
      }),
    ).toThrow(/voice/u);
    expect(() =>
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-invalid-personality",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-08T00:00:00.000Z",
        preferences: {
          personality: {
            humor: 11,
          },
        },
        userId: "user_guard",
      }),
    ).toThrow(/personality\.humor/u);
    expect(() =>
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-unknown-personality",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-08T00:00:00.000Z",
        preferences: {
          personality: {
            surprise: 4,
          },
        },
        userId: "user_guard",
      }),
    ).toThrow(/personality\.surprise/u);
    expect(() =>
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-empty-personality",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-08T00:00:00.000Z",
        preferences: {
          personality: {},
        },
        userId: "user_guard",
      }),
    ).toThrow(/at least one setting/u);
  });
});
