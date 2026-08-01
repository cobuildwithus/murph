import { describe, expect, it, vi } from "vitest";

import {
  assertHostedMemberBillingStartMessagingReady,
} from "@/src/lib/hosted-onboarding/billing-start-preconditions";

function makePrisma(verifiedEmailVerifiedAt: Date | null) {
  return {
    hostedMemberEmailAuthorization: {
      findUnique: vi.fn().mockResolvedValue(
        verifiedEmailVerifiedAt
          ? { verifiedEmailVerifiedAt }
          : null,
      ),
    },
  };
}

describe("hosted billing messaging readiness", () => {
  it("accepts a verified phone without reading email state", async () => {
    const prisma = makePrisma(null);

    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: {
        memberId: "member_phone",
        phoneLookupKey: "hbidx:phone:v1:ready",
      },
      prisma: prisma as never,
      routing: null,
    })).resolves.toBeUndefined();

    expect(prisma.hostedMemberEmailAuthorization.findUnique).not.toHaveBeenCalled();
  });

  it("accepts a verified email when no phone or Telegram route exists", async () => {
    const verifiedAt = new Date("2026-07-31T10:00:00.000Z");
    const prisma = makePrisma(verifiedAt);

    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: {
        memberId: "member_email",
        phoneLookupKey: null,
      },
      prisma: prisma as never,
      routing: null,
    })).resolves.toBeUndefined();

    expect(prisma.hostedMemberEmailAuthorization.findUnique).toHaveBeenCalledWith({
      select: {
        verifiedEmailVerifiedAt: true,
      },
      where: {
        memberId: "member_email",
      },
    });
  });

  it("still rejects a member with no reachable messaging channel", async () => {
    const prisma = makePrisma(null);

    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: {
        memberId: "member_unreachable",
        phoneLookupKey: null,
      },
      prisma: prisma as never,
      routing: null,
    })).rejects.toMatchObject({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
      httpStatus: 409,
      message:
        "Verify a phone number or email address, or connect Telegram before checkout so Murph can message you.",
    });
  });

  it("fails closed when an incomplete snapshot cannot name the member", async () => {
    const prisma = makePrisma(new Date("2026-07-31T10:00:00.000Z"));

    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: {
        phoneLookupKey: null,
      },
      prisma: prisma as never,
      routing: null,
    })).rejects.toMatchObject({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
    });

    expect(prisma.hostedMemberEmailAuthorization.findUnique).not.toHaveBeenCalled();
  });
});
