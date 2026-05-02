import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";

import {
  lookupHostedMemberForPrivyIdentity,
  reconcileHostedPrivyIdentityOnMember,
} from "@/src/lib/hosted-onboarding/member-identity-service";
import type { HostedPrivyIdentity } from "@/src/lib/hosted-onboarding/privy";

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2026-04-06T10:00:00.000Z");
const TEST_CONTACT_PRIVACY_KEY = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";

describe("hosted-onboarding member-identity-service", () => {
  const previousHostedContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousHostedContactPrivacyCurrentKeyVersion =
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  beforeEach(() => {
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${TEST_CONTACT_PRIVACY_KEY}`;
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
    clearHostedOnboardingEnvCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousHostedContactPrivacyKeys);
    restoreEnvValue(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      previousHostedContactPrivacyCurrentKeyVersion,
    );
    clearHostedOnboardingEnvCache();
  });

  it("locks and re-reads the current member before reconciling a Privy identity", async () => {
    const lockedMember = makeMember({
      suspendedAt: null,
    });
    const lockQuery = vi.fn().mockResolvedValue([]);
    const hostedMember = {
      findUnique: vi.fn().mockResolvedValue(lockedMember),
      update: vi.fn(),
    };
    const identityUpsert = vi.fn(async ({
      create,
      update: updateData,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      ...create,
      ...updateData,
    }));
    const hostedMemberIdentity = {
      findUnique: vi.fn().mockResolvedValue({
        maskedPhoneNumberHint: "*** 4567",
        memberId: lockedMember.id,
        phoneLookupKey: "hbidx:phone:v1:existing",
        phoneNumberVerifiedAt: null,
        privyUserId: null,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      }),
      upsert: identityUpsert,
    };
    const prisma = asRootPrisma({
      $queryRaw: lockQuery,
      hostedMember,
      hostedMemberIdentity,
    });

    const result = await reconcileHostedPrivyIdentityOnMember({
      identity: makeIdentity(),
      member: makeMember({
        suspendedAt: null,
      }),
      now: NOW,
      prisma: prisma as never,
    });

    expect(lockQuery).toHaveBeenCalledTimes(1);
    expect(hostedMember.findUnique).toHaveBeenCalledWith({
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
      where: {
        id: "member_123",
      },
    });
    expect(hostedMember.update).not.toHaveBeenCalled();
    expect(result.suspendedAt).toBeNull();
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberId: "member_123",
      },
      update: expect.objectContaining({
        phoneNumberVerifiedAt: NOW,
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        privyUserIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
      }),
    }));
  });

  it("blocks a suspended member before reconciling any identity fields", async () => {
    const lockedMember = makeMember({
      suspendedAt: NOW,
    });
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(lockedMember),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          maskedPhoneNumberHint: "*** 4567",
          memberId: lockedMember.id,
          phoneLookupKey: "hbidx:phone:v1:existing",
          phoneNumber: null,
          phoneNumberVerifiedAt: null,
          privyUserId: null,
          walletAddress: null,
          walletChainType: null,
          walletCreatedAt: null,
          walletProvider: null,
        }),
        upsert: vi.fn(),
      },
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      identity: makeIdentity(),
      member: makeMember({
        suspendedAt: null,
      }),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
  });

  it("fails closed when the member disappears before the locked reconciliation write", async () => {
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      identity: makeIdentity(),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
  });

  it("preserves the existing phone identity fields when reconciling a Telegram-only Privy session", async () => {
    const verifiedAt = new Date("2026-04-01T10:00:00.000Z");
    const identityUpsert = vi.fn(async ({
      create,
      update: updateData,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      ...create,
      ...updateData,
    }));
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          maskedPhoneNumberHint: "*** 4567",
          memberId: "member_123",
          phoneLookupKey: "hbidx:phone:v1:existing",
          phoneNumber: "+15551234567",
          phoneNumberVerifiedAt: verifiedAt,
          privyUserId: null,
          walletAddress: null,
          walletChainType: null,
          walletCreatedAt: null,
          walletProvider: null,
        }),
        upsert: identityUpsert,
      },
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      identity: makeIdentity({
        phone: null,
        telegram: {
          firstName: "Alice",
          lastName: null,
          photoUrl: null,
          telegramUserId: "456",
          username: "alice",
        },
      }),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      id: "member_123",
    });

    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: "hbidx:phone:v1:existing",
        phoneNumberVerifiedAt: verifiedAt,
      }),
    }));
  });

  it("preserves every matching identity binding when Privy identity lookup hits the same member twice", async () => {
    const member = makeMember();
    const identityRecord = {
      maskedPhoneNumberHint: "*** 4567",
      member,
      memberId: member.id,
      phoneLookupKey: "hbidx:phone:v1:member_123",
      phoneNumberVerifiedAt: NOW,
      privyUserIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-identity.privy-user-id",
        memberId: member.id,
        value: "did:privy:user_123",
      }),
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumberEncrypted: null,
      walletAddressEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-identity.wallet-address",
        memberId: member.id,
        value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      }),
      walletChainType: "ethereum",
      walletCreatedAt: NOW,
      walletProvider: "privy",
    };
    const prisma = {
      hostedMemberIdentity: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(identityRecord)
          .mockResolvedValueOnce(identityRecord)
          .mockResolvedValueOnce(identityRecord),
      },
    };

    await expect(
      lookupHostedMemberForPrivyIdentity({
        identity: makeIdentity({
          wallet: {
            address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            chainType: "ethereum",
            id: "wallet_123",
            type: "wallet",
          },
        }),
        parallelizeReads: true,
        prisma: prisma as never,
      }),
    ).resolves.toEqual({
      core: member,
      identity: expect.objectContaining({
        memberId: member.id,
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      }),
      matchedBy: [
        "privyUserId",
        "phoneNumber",
        "walletAddress",
      ],
    });
  });
});

function makeIdentity(
  overrides: Partial<HostedPrivyIdentity> = {},
): HostedPrivyIdentity {
  return {
    phone: {
      number: "+15551234567",
      verifiedAt: 1743933600,
    },
    telegram: null,
    userId: "did:privy:user_123",
    wallet: null,
    ...overrides,
  };
}

function makeMember(overrides: Partial<{
  billingStatus: HostedBillingStatus;
  id: string;
  suspendedAt: Date | null;
}> = {}) {
  return {
    billingStatus: HostedBillingStatus.not_started,
    createdAt: NOW,
    id: "member_123",
    pendingActivationTimeZone: null,
    suspendedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function asRootPrisma<T extends object>(tx: T): T & {
  $transaction: ReturnType<typeof vi.fn>;
} {
  return {
    ...tx,
    $transaction: vi.fn(async (callback: (innerTx: T) => Promise<unknown>) => callback(tx)),
  };
}
