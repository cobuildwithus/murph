import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedOnboardingReadClient } from "@/src/lib/hosted-onboarding/shared";

const mocks = vi.hoisted(() => ({
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByLinqEmailHandle: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  lookupHostedMemberIdentityByPrivyUserId: vi.fn(),
  lookupHostedMemberRoutingByTelegramUserId: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    mocks.lookupHostedMemberByVerifiedEmailAddress,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByLinqEmailHandle:
    mocks.lookupHostedMemberIdentityByLinqEmailHandle,
  lookupHostedMemberIdentityByPhoneNumber:
    mocks.lookupHostedMemberIdentityByPhoneNumber,
  lookupHostedMemberIdentityByPrivyUserId:
    mocks.lookupHostedMemberIdentityByPrivyUserId,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  lookupHostedMemberRoutingByTelegramUserId:
    mocks.lookupHostedMemberRoutingByTelegramUserId,
}));

import {
  lookupHostedMemberForPrivyAuthAttempt,
} from "@/src/lib/hosted-onboarding/member-identity-lookup";

describe("hosted member email identity lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
    mocks.lookupHostedMemberIdentityByLinqEmailHandle.mockResolvedValue(null);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue(null);
    mocks.lookupHostedMemberIdentityByPrivyUserId.mockResolvedValue(null);
    mocks.lookupHostedMemberRoutingByTelegramUserId.mockResolvedValue(null);
  });

  it("reuses a Linq email-handle member for no-invite email login", async () => {
    const member = makeMember("member_linq_email");
    mocks.lookupHostedMemberIdentityByLinqEmailHandle.mockResolvedValue({
      core: member,
      identity: makeIdentityState(member.id),
      matchedBy: "linqEmailHandle",
    });

    await expect(lookupHostedMemberForPrivyAuthAttempt({
      authMethod: "email",
      identity: makeEmailIdentity(),
      prisma: makeReadClient(),
    })).resolves.toMatchObject({
      core: { id: member.id },
      matchedBy: ["linqEmailHandle"],
    });
  });

  it("retains both matches when verified email and the Linq handle agree", async () => {
    const member = makeMember("member_converged_email");
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: member,
      matchedBy: "verifiedEmail",
    });
    mocks.lookupHostedMemberIdentityByLinqEmailHandle.mockResolvedValue({
      core: member,
      identity: makeIdentityState(member.id),
      matchedBy: "linqEmailHandle",
    });

    await expect(lookupHostedMemberForPrivyAuthAttempt({
      authMethod: "email",
      identity: makeEmailIdentity(),
      prisma: makeReadClient(),
    })).resolves.toMatchObject({
      core: { id: member.id },
      matchedBy: ["verifiedEmail", "linqEmailHandle"],
    });
  });

  it("fails closed when verified email and the Linq handle disagree", async () => {
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: makeMember("member_verified_email"),
      matchedBy: "verifiedEmail",
    });
    mocks.lookupHostedMemberIdentityByLinqEmailHandle.mockResolvedValue({
      core: makeMember("member_linq_email"),
      identity: makeIdentityState("member_linq_email"),
      matchedBy: "linqEmailHandle",
    });

    await expect(lookupHostedMemberForPrivyAuthAttempt({
      authMethod: "email",
      identity: makeEmailIdentity(),
      prisma: makeReadClient(),
    })).rejects.toMatchObject({
      code: "PRIVY_IDENTITY_CONFLICT",
      httpStatus: 409,
    });
  });

  it("fails closed when the Privy principal and Linq handle disagree", async () => {
    mocks.lookupHostedMemberIdentityByPrivyUserId.mockResolvedValue({
      core: makeMember("member_privy_principal"),
      identity: makeIdentityState("member_privy_principal"),
      matchedBy: "privyUserId",
    });
    mocks.lookupHostedMemberIdentityByLinqEmailHandle.mockResolvedValue({
      core: makeMember("member_linq_email"),
      identity: makeIdentityState("member_linq_email"),
      matchedBy: "linqEmailHandle",
    });

    await expect(lookupHostedMemberForPrivyAuthAttempt({
      authMethod: "email",
      identity: makeEmailIdentity(),
      prisma: makeReadClient(),
    })).rejects.toMatchObject({
      code: "PRIVY_IDENTITY_CONFLICT",
      httpStatus: 409,
    });
  });
});

function makeMember(id: string) {
  const now = new Date("2026-09-04T20:46:00.000Z");
  return {
    billingStatus: HostedBillingStatus.not_started,
    createdAt: now,
    id,
    suspendedAt: null,
    updatedAt: now,
  };
}

function makeReadClient(): HostedOnboardingReadClient {
  // Store modules are mocked in this unit suite; the client is passed through
  // as an opaque boundary value and is never dereferenced.
  return Object.create(null) as HostedOnboardingReadClient;
}

function makeEmailIdentity() {
  return {
    email: {
      address: "person@example.com",
      verifiedAt: 1_788_555_160,
    },
    phone: null,
    telegram: null,
    userId: "did:privy:email-login",
  };
}

function makeIdentityState(memberId: string) {
  return {
    maskedPhoneNumberHint: null,
    memberId,
    phoneNumber: null,
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  };
}
