import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
import { describe, expect, it } from "vitest";

import {
  resolveHostedMemberAssistantNotificationRoute,
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

  it("keeps bot authority out of the semantic Telegram conversation identity", () => {
    const memberId = "member_telegram";
    const buildRoute = (telegramThreadId: string) => resolveHostedMemberAssistantNotificationRoute({
      linqChatId: null,
      memberId,
      messaging: resolveHostedMemberMessagingState({
        identity: null,
        routing: { telegramThreadId, telegramUserId: "456" },
      }),
    });

    const authorizedRoute = buildRoute("456:bot:123456");
    const inboundRoute = buildRoute("456");

    expect(authorizedRoute).toMatchObject({
      delivery: { kind: "thread", target: "456:bot:123456" },
    });
    expect(authorizedRoute?.threadId).toBe(inboundRoute?.threadId);
  });
});
