import { describe, expect, it } from "vitest";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  resolveHostedPhoneCallResultContextRoute,
} from "@/src/lib/phone-calls/result-context-route";

describe("hosted phone-call result context routing", () => {
  it("preserves credential-compatible thread delivery for a legacy home route", () => {
    const lookupKey = "stale_pending_lookup";
    const member = buildMember({
      linqChatId: "legacy_home_chat",
      linqHomeLineAssignedAt: new Date("2026-06-18T12:00:00.000Z"),
      linqParticipantContact: null,
      linqRecipientPhone: "+15559990000",
      pendingLinqChatId: "pending_chat",
      pendingLinqParticipantContact: {
        kind: "phone",
        lookupKey,
        observedAt: new Date("2026-06-18T12:01:00.000Z"),
        value: "+15550002222",
      },
      pendingLinqRecipientPhone: "+15559990000",
    });

    const route = resolveHostedPhoneCallResultContextRoute({
      member,
      memberId: member.core.id,
    });
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: lookupKey,
      userId: member.core.id,
    });

    expect(route).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "legacy_home_chat",
      },
      identityId: hashHostedAssistantConversationIdentifier(identifierBlind, lookupKey),
    });
  });

  it("does not rekey a home thread to persisted participant authority", () => {
    const lookupKey = "owner_phone_lookup";
    const member = buildMember({
      linqChatId: "authorized_home_chat",
      linqHomeLineAssignedAt: new Date("2026-06-18T12:00:00.000Z"),
      linqParticipantContact: {
        kind: "phone",
        lookupKey: "authorized_home_lookup",
      },
      linqRecipientPhone: "+15559990000",
    });

    const route = resolveHostedPhoneCallResultContextRoute({
      member,
      memberId: member.core.id,
    });
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: lookupKey,
      userId: member.core.id,
    });

    expect(route).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "authorized_home_chat",
      },
      identityId: hashHostedAssistantConversationIdentifier(identifierBlind, lookupKey),
    });
  });
});

function buildMember(
  routingOverrides: Partial<NonNullable<HostedMemberSnapshot["routing"]>>,
): HostedMemberSnapshot {
  return {
    billingRef: null,
    core: {
      billingStatus: "incomplete",
      createdAt: new Date("2026-06-18T12:00:00.000Z"),
      id: "member_owner",
      suspendedAt: null,
      updatedAt: new Date("2026-06-18T12:00:00.000Z"),
    },
    identity: {
      maskedPhoneNumberHint: "+1 *** *** 1111",
      memberId: "member_owner",
      phoneLookupKey: "owner_phone_lookup",
      phoneNumber: "+15550001111",
      phoneNumberVerifiedAt: new Date("2026-06-18T12:00:00.000Z"),
      privyUserId: null,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    },
    routing: {
      linqChatId: null,
      linqHomeLineAssignedAt: null,
      linqParticipantContact: null,
      linqRecipientPhone: null,
      memberId: "member_owner",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
      ...routingOverrides,
    },
  };
}
