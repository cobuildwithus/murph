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
  it("keeps an established Linq participant when a newer phone credential exists", () => {
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
        linqParticipantContact: {
          lookupKey: establishedLookupKey,
        },
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

  it("does not pair a legacy home thread with a later phone credential", () => {
    const messaging = resolveHostedMemberMessagingState({
      identity: {
        phoneLookupKey: "hbidx:phone:v1:newer",
      },
      routing: {
        linqChatId: "chat_legacy",
        linqParticipantContact: null,
      },
    });

    expect(resolveHostedMemberAssistantNotificationRoute({
      linqChatId: "chat_legacy",
      linqContactLookupKey: null,
      linqRecipientPhone: "+15550100099",
      memberId: "member_legacy",
      memberPhoneNumber: "+15550100001",
      messaging,
    })).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "participant",
        target: "+15550100001",
      },
      threadId: null,
    });
  });

  it("does not pair an explicitly unauthorized home thread with a pending identity", () => {
    const messaging = resolveHostedMemberMessagingState({
      identity: null,
      routing: {
        linqChatId: "chat_legacy",
        linqParticipantContact: null,
        pendingLinqChatId: "chat_pending",
        pendingLinqParticipantContact: {
          lookupKey: "hbidx:phone:v1:pending",
        },
        telegramThreadId: "telegram_private",
      },
    });

    expect(resolveHostedMemberAssistantNotificationRoute({
      linqChatId: "chat_legacy",
      linqContactLookupKey: null,
      memberId: "member_legacy",
      messaging,
    })).toMatchObject({
      channel: "telegram",
      delivery: {
        kind: "thread",
        target: "telegram_private",
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
});
