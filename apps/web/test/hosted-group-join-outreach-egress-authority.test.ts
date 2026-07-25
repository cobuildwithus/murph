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

  // Cold egress must fail closed on every row state that is not "claimed and
  // still unsent", and on any source line other than the one the drain claimed.
  // Each case would otherwise be a route to an unsolicited or misrouted text.
  const PARTICIPANT_PHONE = "+15550102001";
  const LINE_PHONE = "+15550102099";

  function pendingRow(): {
    dispatchStartedAt: Date | null;
    participantPhoneLookupKey: string;
    phoneNumberLookupKey: string | null;
    sentAt: Date | null;
    skippedAt: Date | null;
  } {
    return {
      dispatchStartedAt: new Date("2026-07-24T20:00:00.000Z"),
      participantPhoneLookupKey: requirePhoneLookupKey(PARTICIPANT_PHONE),
      phoneNumberLookupKey: requirePhoneLookupKey(LINE_PHONE),
      sentAt: null,
      skippedAt: null,
    };
  }

  const refusals: readonly {
    fromPhoneNumber?: string;
    name: string;
    row: ReturnType<typeof pendingRow> | null;
  }[] = [
    { name: "no outreach row exists", row: null },
    {
      name: "the row was never claimed for dispatch",
      row: { ...pendingRow(), dispatchStartedAt: null },
    },
    {
      name: "the row already sent",
      row: { ...pendingRow(), sentAt: new Date("2026-07-24T20:05:00.000Z") },
    },
    {
      name: "the row was skipped",
      row: { ...pendingRow(), skippedAt: new Date("2026-07-24T20:05:00.000Z") },
    },
    {
      name: "the row has no selected line",
      row: { ...pendingRow(), phoneNumberLookupKey: null },
    },
    {
      fromPhoneNumber: "+15550102098",
      name: "the send uses a line other than the claimed one",
      row: pendingRow(),
    },
  ];

  for (const refusal of refusals) {
    it(`refuses cold egress when ${refusal.name}`, async () => {
      const prisma = {
        hostedGroupJoinOutreach: {
          findUnique: vi.fn().mockResolvedValue(refusal.row),
        },
      };

      await expect(
        assertHostedLinqGroupJoinOutreachParticipantEgressAuthority({
          fromPhoneNumber: refusal.fromPhoneNumber ?? LINE_PHONE,
          idempotencyKey: "group-join-outreach:hgrpjoa_opaque",
          outreachId: "hgrpjoa_opaque",
          prisma: prisma as never,
          targetPhoneNumber: PARTICIPANT_PHONE,
        }),
      ).rejects.toMatchObject({
        code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
        httpStatus: 403,
      });
    });
  }
});
