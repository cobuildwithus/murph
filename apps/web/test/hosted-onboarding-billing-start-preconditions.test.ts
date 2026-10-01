import { describe, expect, it, vi } from "vitest";

import {
  assertHostedMemberBillingStartMessagingReady,
} from "@/src/lib/hosted-onboarding/billing-start-preconditions";

function makePrisma() {
  return {
    hostedMemberEmailAuthorization: {
      findUnique: vi.fn(),
    },
  };
}

describe("hosted billing messaging readiness", () => {
  it("accepts a verified phone without reading email state", async () => {
    const prisma = makePrisma();

    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: {
        phoneLookupKey: "hbidx:phone:v1:ready",
      },
      prisma: prisma as never,
      routing: null,
    })).resolves.toBeUndefined();

    expect(prisma.hostedMemberEmailAuthorization.findUnique).not.toHaveBeenCalled();
  });

  it("requires a conversational channel even when email is verified", async () => {
    const prisma = makePrisma();

    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: {
        emailLinked: true,
        phoneLookupKey: null,
      },
      prisma: prisma as never,
      routing: null,
    })).rejects.toMatchObject({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
    });

    expect(prisma.hostedMemberEmailAuthorization.findUnique).not.toHaveBeenCalled();
  });

  it("still rejects a member with no reachable messaging channel", async () => {
    const prisma = makePrisma();

    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: {
        phoneLookupKey: null,
      },
      prisma: prisma as never,
      routing: null,
    })).rejects.toMatchObject({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
      httpStatus: 409,
      message:
        "Verify a phone number or connect Telegram before checkout so Murph can message you.",
    });
  });
});
