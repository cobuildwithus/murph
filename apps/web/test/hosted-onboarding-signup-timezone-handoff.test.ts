import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedPrivyAccountDeletionNotPending: vi.fn(),
  ensureHostedMemberForPrivyIdentityResolutionTx: vi.fn(),
  issueHostedInvite: vi.fn(),
  lookupHostedMemberForPrivyAuthAttempt: vi.fn(),
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
  prepareHostedMemberVerifiedEmailReplyAlias: vi.fn(),
  readHostedPrivyUserById: vi.fn(),
  readHostedMemberMessagingSetupState: vi.fn(),
  syncHostedMemberVerifiedEmailAuthorization: vi.fn(),
  writeHostedMemberSignupNotificationContextIfPendingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    prepareHostedDomainRootForWeb: vi.fn().mockResolvedValue({
      domain: "control",
      rootKeyId: "root-timezone-handoff",
      userId: "member_timezone_handoff",
    }),
  };
});

vi.mock("@/src/lib/hosted-onboarding/privy", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/privy")
  >();
  return {
    ...actual,
    readHostedPrivyUserById: mocks.readHostedPrivyUserById,
  };
});

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  deriveHostedOnboardingTimingErrorName: () => "test_error",
  finishHostedOnboardingTiming: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  startHostedOnboardingTiming: () => ({ startedAt: 0 }),
}));

vi.mock("@/src/lib/hosted-onboarding/activation-progress", () => ({
  isHostedMemberActivationPending: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/member-identity-service")
  >();

  return {
    ...actual,
    assertHostedPrivyAccountDeletionNotPending:
      mocks.assertHostedPrivyAccountDeletionNotPending,
    ensureHostedMemberForPrivyIdentityResolutionTx:
      mocks.ensureHostedMemberForPrivyIdentityResolutionTx,
    lookupHostedMemberForPrivyAuthAttempt:
      mocks.lookupHostedMemberForPrivyAuthAttempt,
    lookupHostedMemberForPrivyPrincipal:
      mocks.lookupHostedMemberForPrivyPrincipal,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >();

  return {
    ...actual,
    prepareHostedMemberVerifiedEmailReplyAlias:
      mocks.prepareHostedMemberVerifiedEmailReplyAlias,
    readHostedMemberMessagingSetupState: mocks.readHostedMemberMessagingSetupState,
    syncHostedMemberVerifiedEmailAuthorization:
      mocks.syncHostedMemberVerifiedEmailAuthorization,
    writeHostedMemberSignupNotificationContextIfPendingTx:
      mocks.writeHostedMemberSignupNotificationContextIfPendingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/invite-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/invite-service")
  >();

  return {
    ...actual,
    buildHostedInviteUrl: (inviteCode: string) =>
      `https://join.example.test/join/${inviteCode}`,
    issueHostedInvite: mocks.issueHostedInvite,
  };
});

import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/authentication-service";

const NOW = new Date("2026-06-21T12:00:00.000Z");
const MEMBER = {
  billingStatus: HostedBillingStatus.not_started,
  createdAt: NOW,
  id: "member_timezone_handoff",
  suspendedAt: null,
  updatedAt: NOW,
};
const IDENTITY = {
  email: null,
  phone: {
    number: "+48123456789",
    verifiedAt: 1782043200,
  },
  telegram: null,
  userId: "did:privy:timezone-handoff",
};

describe("hosted signup timezone handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedPrivyAccountDeletionNotPending.mockResolvedValue(undefined);
    mocks.ensureHostedMemberForPrivyIdentityResolutionTx.mockResolvedValue({
      created: true,
      identity: IDENTITY,
      member: MEMBER,
    });
    mocks.issueHostedInvite.mockResolvedValue({
      inviteCode: "invite_timezone_handoff",
    });
    mocks.readHostedMemberMessagingSetupState.mockResolvedValue(null);
    mocks.lookupHostedMemberForPrivyAuthAttempt.mockResolvedValue(null);
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);
    mocks.prepareHostedMemberVerifiedEmailReplyAlias.mockResolvedValue({
      generation: 0,
      lookupKey: "0123456789abcdef0123456789abcdef",
      memberId: MEMBER.id,
      verifiedEmailLookupKeys: ["live-email-lookup-key"],
    });
    mocks.readHostedPrivyUserById.mockResolvedValue({
      id: "did:privy:timezone-handoff",
      linked_accounts: [{
        phone_number: "+48123456789",
        type: "phone",
        verified_at: 1782043200,
      }],
    });
    mocks.syncHostedMemberVerifiedEmailAuthorization.mockResolvedValue({});
    mocks.writeHostedMemberSignupNotificationContextIfPendingTx
      .mockResolvedValue(true);
  });

  it("persists the signup timezone before activation can claim the member row", async () => {
    const sequence: string[] = [];
    let memberResolutionTransactionOpen = false;
    let activationClaimed = false;
    let pendingActivationTimeZone: string | null = null;
    mocks.writeHostedMemberSignupNotificationContextIfPendingTx
      .mockImplementationOnce(async () => {
        expect(memberResolutionTransactionOpen).toBe(true);
        expect(activationClaimed).toBe(false);
        sequence.push("signup-context:persist");
        return true;
      });

    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        memberResolutionTransactionOpen = true;
        sequence.push("member-resolution:start");

        try {
          return await callback(prisma);
        } finally {
          memberResolutionTransactionOpen = false;
          activationClaimed = true;
          sequence.push("activation:claim");
        }
      }),
      hostedMember: {
        findUnique: vi.fn(async () => ({
          accountGroupMemberships: [],
          billingStatus: MEMBER.billingStatus,
          suspendedAt: null,
          threadContainer: null,
        })),
        updateMany: vi.fn(async ({ data }: { data: { pendingActivationTimeZone: string } }) => {
          if (!memberResolutionTransactionOpen || activationClaimed) {
            sequence.push("timezone:lost");
            return { count: 0 };
          }

          pendingActivationTimeZone = data.pendingActivationTimeZone;
          sequence.push("timezone:persist");
          return { count: 1 };
        }),
      },
    } as unknown as PrismaClient;

    await expect(
      completeHostedPrivyVerification({
        identity: IDENTITY,
        now: NOW,
        prisma,
        signupNotificationContext: {
          schema: "murph.hosted-signup-notification-context.v1",
          occurredAt: NOW.toISOString(),
          surface: "website",
          timeZone: "Europe/Warsaw",
          location: {
            city: "Warsaw",
            country: "PL",
          },
        },
        timeZone: "Europe/Warsaw",
      }),
    ).resolves.toMatchObject({
      memberId: MEMBER.id,
      stage: "checkout",
    });

    expect(pendingActivationTimeZone).toBe("Europe/Warsaw");
    expect(sequence).toEqual([
      "member-resolution:start",
      "timezone:persist",
      "signup-context:persist",
      "activation:claim",
    ]);
    expect(mocks.writeHostedMemberSignupNotificationContextIfPendingTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        context: expect.objectContaining({
          occurredAt: NOW.toISOString(),
          surface: "website",
        }),
        memberId: MEMBER.id,
        prisma,
      }));
  });

  it("leaves inactive signup notification context empty when request capture is omitted", async () => {
    let signupNotificationContextEncrypted: string | null = null;
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma)),
      hostedMember: {
        findUnique: vi.fn(async () => ({
          accountGroupMemberships: [],
          billingStatus: MEMBER.billingStatus,
          suspendedAt: null,
          threadContainer: null,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } as unknown as PrismaClient;
    mocks.writeHostedMemberSignupNotificationContextIfPendingTx
      .mockImplementationOnce(async () => {
        signupNotificationContextEncrypted = "encrypted-context";
        return true;
      });

    await expect(
      completeHostedPrivyVerification({
        identity: IDENTITY,
        now: NOW,
        prisma,
        timeZone: "Europe/Warsaw",
      }),
    ).resolves.toMatchObject({
      memberId: MEMBER.id,
      stage: "checkout",
    });

    expect(mocks.writeHostedMemberSignupNotificationContextIfPendingTx)
      .not.toHaveBeenCalled();
    expect(signupNotificationContextEncrypted).toBeNull();
  });

  it("prepares a private reply alias from the authoritative live email", async () => {
    const staleIdentity = {
      email: {
        address: "stale@example.test",
        verifiedAt: 1_782_043_140,
      },
      phone: null,
      telegram: null,
      userId: "did:privy:timezone-handoff",
    };
    const liveIdentity = {
      ...staleIdentity,
      email: {
        address: "live@example.test",
        verifiedAt: 1_782_043_200,
      },
    };
    mocks.readHostedPrivyUserById.mockResolvedValueOnce({
      id: liveIdentity.userId,
      linked_accounts: [{
        address: liveIdentity.email.address,
        type: "email",
        verified_at: liveIdentity.email.verifiedAt,
      }],
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValueOnce(MEMBER);
    mocks.ensureHostedMemberForPrivyIdentityResolutionTx.mockResolvedValueOnce({
      created: false,
      identity: liveIdentity,
      member: MEMBER,
    });
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma)),
      hostedMember: {
        findUnique: vi.fn(async () => ({
          accountGroupMemberships: [],
          billingStatus: MEMBER.billingStatus,
          suspendedAt: null,
          threadContainer: null,
        })),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    await expect(completeHostedPrivyVerification({
      authMethod: "email",
      identity: staleIdentity,
      now: NOW,
      prisma,
    })).resolves.toMatchObject({ memberId: MEMBER.id });

    expect(mocks.prepareHostedMemberVerifiedEmailReplyAlias)
      .toHaveBeenCalledWith(expect.objectContaining({
        address: liveIdentity.email.address,
        memberId: MEMBER.id,
      }));
    expect(mocks.prepareHostedMemberVerifiedEmailReplyAlias)
      .not.toHaveBeenCalledWith(expect.objectContaining({
        address: staleIdentity.email.address,
      }));
    expect(mocks.syncHostedMemberVerifiedEmailAuthorization)
      .toHaveBeenCalledWith(expect.objectContaining({
        address: liveIdentity.email.address,
        memberId: MEMBER.id,
      }));
  });
});
