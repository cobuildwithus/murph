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
  readHostedMemberMessagingSetupState: vi.fn(),
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
    readHostedPrivyUserById: vi.fn().mockResolvedValue({
      id: "did:privy:timezone-handoff",
      linked_accounts: [{
        phone_number: "+48123456789",
        type: "phone",
        verified_at: 1782043200,
      }],
    }),
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
    readHostedMemberMessagingSetupState: mocks.readHostedMemberMessagingSetupState,
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
  });

  it("persists the signup timezone before activation can claim the member row", async () => {
    const sequence: string[] = [];
    let memberResolutionTransactionOpen = false;
    let activationClaimed = false;
    let pendingActivationTimeZone: string | null = null;

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
      "activation:claim",
    ]);
  });
});
