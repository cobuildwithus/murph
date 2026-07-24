import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
import { describe, expect, it } from "vitest";

import {
  isHostedMemberMessagingSetupRequired,
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberChannels,
  resolveHostedMemberMessagingState,
} from "@/src/lib/hosted-onboarding/messaging-state";

describe("hosted member messaging authority", () => {
  it("uses explicit participant authority only when the caller supplies it", () => {
    const memberId = "member_123";
    const establishedLookupKey = "hbidx:email:v1:established";
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: establishedLookupKey,
      userId: memberId,
    });
    const messaging = resolveHostedMemberMessagingState({
      identity: {
        phoneLookupKey: "hbidx:phone:v1:newer",
      },
      routing: {
        linqChatId: "chat_home",
      },
    });

    const route = resolveHostedMemberAssistantNotificationRoute({
      linqChatId: "chat_home",
      linqContactLookupKey: establishedLookupKey,
      linqRecipientPhone: "+15550100099",
      memberId,
      memberPhoneNumber: "+15550100001",
      messaging,
    });

    expect(route).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "chat_home",
      },
      identityId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        establishedLookupKey,
      ),
    });
  });

  it("preserves credential-compatible thread identity for a legacy route", () => {
    const memberId = "member_legacy";
    const phoneLookupKey = "hbidx:phone:v1:newer";
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: phoneLookupKey,
      userId: memberId,
    });
    const messaging = resolveHostedMemberMessagingState({
      identity: {
        phoneLookupKey,
      },
      routing: {
        linqChatId: "chat_legacy",
      },
    });

    const routeInput = {
      linqChatId: "chat_legacy",
      linqContactLookupKey: null,
      linqRecipientPhone: "+15550100099",
      memberId,
      memberPhoneNumber: "+15550100001",
      messaging,
    };

    expect(resolveHostedMemberAssistantNotificationRoute(routeInput)).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "chat_legacy",
      },
      identityId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        phoneLookupKey,
      ),
    });
  });

  it("retains the legacy pending-identity fallback when no phone credential exists", () => {
    const messaging = resolveHostedMemberMessagingState({
      identity: null,
      routing: {
        linqChatId: "chat_legacy",
        pendingLinqChatId: "chat_pending",
        pendingLinqParticipantContact: {
          lookupKey: "hbidx:phone:v1:pending",
        },
      },
    });

    expect(resolveHostedMemberAssistantNotificationRoute({
      linqChatId: "chat_legacy",
      linqContactLookupKey: null,
      memberId: "member_legacy",
      messaging,
    })).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "chat_legacy",
      },
    });
  });

  it("retains messaging-state fallback when the lookup override is omitted", () => {
    const messaging = resolveHostedMemberMessagingState({
      identity: null,
      routing: {
        pendingLinqChatId: "chat_pending",
        pendingLinqParticipantContact: {
          lookupKey: "hbidx:phone:v1:pending",
        },
      },
    });

    expect(resolveHostedMemberAssistantNotificationRoute({
      linqChatId: "chat_pending",
      memberId: "member_pending",
      messaging,
    })).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "chat_pending",
      },
    });
  });

  it("treats a linked Telegram identity as setup-complete while delivery still waits for an inbound thread", () => {
    const input = {
      identity: null,
      routing: {
        telegramThreadId: null,
        telegramUserId: "456",
      },
    };
    const messaging = resolveHostedMemberMessagingState(input);

    expect(messaging).toMatchObject({
      hasDirectMessagingChannel: false,
      hasTelegram: false,
      telegramTarget: null,
    });
    expect(isHostedMemberMessagingSetupRequired(input)).toBe(false);
    expect(resolveHostedMemberChannels({
      ...input,
      emailLinked: false,
    })).toEqual({
      email: false,
      linq: false,
      telegram: false,
    });
    expect(resolveHostedMemberAssistantNotificationRoute({
      linqChatId: null,
      memberId: "member_telegram",
      messaging,
    })).toBeNull();
  });

  it("uses the exact inbound-observed Telegram thread for delivery", () => {
    const input = {
      identity: null,
      routing: {
        telegramThreadId: "456:business:connection:dm-topic:9",
        telegramUserId: "456",
      },
    };
    const messaging = resolveHostedMemberMessagingState(input);

    expect(messaging).toMatchObject({
      hasDirectMessagingChannel: true,
      hasTelegram: true,
      telegramTarget: "456:business:connection:dm-topic:9",
    });
    expect(isHostedMemberMessagingSetupRequired(input)).toBe(false);
    expect(resolveHostedMemberAssistantNotificationRoute({
      linqChatId: null,
      memberId: "member_telegram",
      messaging,
    })?.delivery).toEqual({
      kind: "thread",
      target: "456:business:connection:dm-topic:9",
    });
  });
});
