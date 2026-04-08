import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  readHostedMemberIdentity: vi.fn(),
  writeHostedMemberSignupPhoneState: vi.fn(),
}));

vi.mock("../src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/runtime")>(
    "../src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      ...actual.getHostedOnboardingEnvironment(),
      inviteTtlHours: 24,
      publicBaseUrl: "https://join.example.test",
      stripePriceId: "price_123",
      stripeSecretKey: "sk_test_123",
    }),
    requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
  };
});

vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/hosted-member-identity-store")>(
    "../src/lib/hosted-onboarding/hosted-member-identity-store",
  );

  return {
    ...actual,
    readHostedMemberIdentity: storeMocks.readHostedMemberIdentity,
    writeHostedMemberSignupPhoneState: storeMocks.writeHostedMemberSignupPhoneState,
  };
});

import {
  abortHostedInvitePhoneCode,
  confirmHostedInvitePhoneCode,
  prepareHostedInvitePhoneCode,
} from "../src/lib/hosted-onboarding/invite-service";

describe("invite send-code lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMocks.writeHostedMemberSignupPhoneState.mockResolvedValue({
      memberId: "member_123",
    });
  });

  it("records only the transient attempt id before returning the stored signup phone", async () => {
    storeMocks.readHostedMemberIdentity.mockResolvedValue(makeIdentity());

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:00.000Z"),
        prisma: makeInvitePrisma(),
      }),
    ).resolves.toEqual({
      phoneNumber: "+15551234567",
      sendAttemptId: expect.stringMatching(/^hbpc_/),
    });

    expect(storeMocks.writeHostedMemberSignupPhoneState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.any(Object),
      signupPhoneCodeSendAttemptId: expect.stringMatching(/^hbpc_/),
      signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-07T01:00:00.000Z"),
    });
  });

  it("falls back to the canonical stored phone after signup-only state has been cleared", async () => {
    storeMocks.readHostedMemberIdentity.mockResolvedValue(makeIdentity({
      phoneNumber: "+15557654321",
      signupPhoneNumber: null,
    }));

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:00.000Z"),
        prisma: makeInvitePrisma(),
      }),
    ).resolves.toEqual({
      phoneNumber: "+15557654321",
      sendAttemptId: expect.stringMatching(/^hbpc_/),
    });
  });

  it("starts the durable cooldown on confirm and clears the temporary attempt markers", async () => {
    storeMocks.readHostedMemberIdentity.mockResolvedValue(makeIdentity({
      signupPhoneCodeSendAttemptId: "hbpc_confirm",
      signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-07T01:00:00.000Z"),
      signupPhoneCodeSentAt: null,
    }));

    await expect(
      confirmHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:02.000Z"),
        prisma: makeInvitePrisma(),
        sendAttemptId: "hbpc_confirm",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(storeMocks.writeHostedMemberSignupPhoneState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.any(Object),
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: new Date("2026-04-07T01:00:02.000Z"),
    });
  });

  it("clears only the transient attempt after a failed Privy send while the attempt is still current", async () => {
    storeMocks.readHostedMemberIdentity.mockResolvedValue(makeIdentity({
      signupPhoneCodeSendAttemptId: "hbpc_abort",
      signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-07T01:00:00.000Z"),
      signupPhoneCodeSentAt: null,
    }));

    await expect(
      abortHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:05.000Z"),
        prisma: makeInvitePrisma(),
        sendAttemptId: "hbpc_abort",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(storeMocks.writeHostedMemberSignupPhoneState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.any(Object),
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
    });
  });

  it("does not clear the cooldown for stale or mismatched abort requests", async () => {
    storeMocks.readHostedMemberIdentity.mockResolvedValue(makeIdentity({
      signupPhoneCodeSendAttemptId: "hbpc_current",
      signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-07T01:00:00.000Z"),
      signupPhoneCodeSentAt: null,
    }));

    await expect(
      abortHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:01:00.000Z"),
        prisma: makeInvitePrisma(),
        sendAttemptId: "hbpc_old",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(storeMocks.writeHostedMemberSignupPhoneState).not.toHaveBeenCalled();
  });
});

function makeInvitePrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedInvite: {
      findUnique: vi.fn().mockResolvedValue({
        expiresAt: new Date("2026-04-08T00:00:00.000Z"),
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          identity: {
            maskedPhoneNumberHint: "*** 4567",
          },
        },
        memberId: "member_123",
      }),
    },
  } as never;
}

function makeIdentity(input?: {
  phoneNumber?: string | null;
  signupPhoneCodeSendAttemptId?: string | null;
  signupPhoneCodeSendAttemptStartedAt?: Date | null;
  signupPhoneCodeSentAt?: Date | null;
  signupPhoneNumber?: string | null;
}) {
  return {
    maskedPhoneNumberHint: "*** 4567",
    memberId: "member_123",
    phoneNumber: input?.phoneNumber ?? null,
    phoneLookupKey: "hbidx:phone:v1:abc123",
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: input?.signupPhoneCodeSendAttemptId ?? null,
    signupPhoneCodeSendAttemptStartedAt: input?.signupPhoneCodeSendAttemptStartedAt ?? null,
    signupPhoneCodeSentAt: input?.signupPhoneCodeSentAt ?? null,
    signupPhoneNumber: input?.signupPhoneNumber ?? "+15551234567",
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  };
}
