import { describe, expect, it, vi } from "vitest";

import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqGroupJoinOutreachParticipantEgressAuthority,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";

function requirePhoneLookupKey(phoneNumber: string): string {
  const lookupKey = createHostedPhoneLookupKey(phoneNumber);
  if (!lookupKey) {
    throw new Error("Expected a phone lookup key.");
  }
  return lookupKey;
}

describe("hosted group join outreach participant egress authority", () => {
  it("allows only the exact pending outreach, participant, line, and idempotency key", async () => {
    const participantPhone = "+15550102001";
    const linePhone = "+15550102099";
    const prisma = {
      hostedGroupJoinOutreach: {
        findUnique: vi.fn().mockResolvedValue({
          dispatchStartedAt: new Date("2026-07-24T20:00:00.000Z"),
          participantPhoneLookupKey: requirePhoneLookupKey(participantPhone),
          phoneNumberLookupKey: requirePhoneLookupKey(linePhone),
          sentAt: null,
          skippedAt: null,
        }),
      },
    };

    await expect(
      assertHostedLinqGroupJoinOutreachParticipantEgressAuthority({
        fromPhoneNumber: linePhone,
        idempotencyKey: "group-join-outreach:hgrpjoa_opaque",
        outreachId: "hgrpjoa_opaque",
        prisma: prisma as never,
        targetPhoneNumber: participantPhone,
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertHostedLinqGroupJoinOutreachParticipantEgressAuthority({
        fromPhoneNumber: linePhone,
        idempotencyKey: "signup-welcome:hbm_opaque",
        outreachId: "hgrpjoa_opaque",
        prisma: prisma as never,
        targetPhoneNumber: participantPhone,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    await expect(
      assertHostedLinqGroupJoinOutreachParticipantEgressAuthority({
        fromPhoneNumber: linePhone,
        idempotencyKey: "group-join-outreach:hgrpjoa_opaque",
        outreachId: "hgrpjoa_opaque",
        prisma: prisma as never,
        targetPhoneNumber: "+15550102002",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });
});
