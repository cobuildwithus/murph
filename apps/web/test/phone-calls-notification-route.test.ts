import { describe, expect, it } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  resolveHostedPhoneCallResultNotificationRoute,
} from "@/src/lib/phone-calls/notification-route";

describe("hosted phone-call notification routing", () => {
  it("preserves credential-compatible thread delivery for a legacy home route", () => {
    const member = buildMember({
      linqChatId: "legacy_home_chat",
      linqHomeLineAssignedAt: new Date("2026-06-18T12:00:00.000Z"),
      linqParticipantContact: null,
      linqRecipientPhone: "+15559990000",
      pendingLinqChatId: "pending_chat",
      pendingLinqParticipantContact: {
        kind: "phone",
        lookupKey: "stale_pending_lookup",
        observedAt: new Date("2026-06-18T12:01:00.000Z"),
        value: "+15550002222",
      },
      pendingLinqRecipientPhone: "+15559990000",
    });

    expect(resolveHostedPhoneCallResultNotificationRoute({
      member,
      memberId: member.core.id,
    })).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "legacy_home_chat",
      },
    });
  });

  it("keeps a home thread with persisted participant authority", () => {
    const member = buildMember({
      linqChatId: "authorized_home_chat",
      linqHomeLineAssignedAt: new Date("2026-06-18T12:00:00.000Z"),
      linqParticipantContact: {
        kind: "phone",
        lookupKey: "authorized_home_lookup",
      },
      linqRecipientPhone: "+15559990000",
    });

    expect(resolveHostedPhoneCallResultNotificationRoute({
      member,
      memberId: member.core.id,
    })).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "authorized_home_chat",
      },
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
