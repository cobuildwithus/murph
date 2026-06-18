import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import { createHostedEmailLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";

import {
  reconcileHostedPrivyIdentityOnMember,
} from "@/src/lib/hosted-onboarding/member-identity-service";
import type { HostedPrivyIdentity } from "@/src/lib/hosted-onboarding/privy";

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2026-04-06T10:00:00.000Z");
const TEST_CONTACT_PRIVACY_KEY = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";
const SYNTHETIC_TEST_WALLET_ADDRESS = "0x00000000000000000000000000000000000000a1";

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

  it("requires a verified Privy email when reconciling against an expected invite email", async () => {
    const identityUpsert = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          maskedPhoneNumberHint: null,
          memberId: "member_123",
          phoneLookupKey: null,
          phoneNumber: null,
          phoneNumberVerifiedAt: null,
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
      expectedEmailLookupKey: requireHostedEmailLookupKey("invite@example.com"),
      identity: makeIdentity({
        email: {
          address: "invite@example.com",
          verifiedAt: null,
        },
        phone: null,
      }),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "PRIVY_EMAIL_REQUIRED",
      httpStatus: 400,
    });

    expect(identityUpsert).not.toHaveBeenCalled();
  });

  it("does not write wallet fields when reconciling an identity without a stored wallet", async () => {
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
          maskedPhoneNumberHint: null,
          memberId: "member_123",
          phoneLookupKey: null,
          phoneNumber: null,
          phoneNumberVerifiedAt: null,
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
      identity: makeIdentity(),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      id: "member_123",
    });

    expect(identityUpsert).toHaveBeenCalledTimes(1);
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({
        walletAddressLookupKey: expect.anything(),
        walletChainType: expect.anything(),
        walletCreatedAt: expect.anything(),
        walletProvider: expect.anything(),
      }),
    }));
  });

  it("maps identity unique races to a Privy identity conflict without retrying", async () => {
    const identityUpsert = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate privy user", {
        clientVersion: "test",
        code: "P2002",
        meta: {
          target: ["privyUserLookupKey"],
        },
      }),
    );
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          maskedPhoneNumberHint: null,
          memberId: "member_123",
          phoneLookupKey: null,
          phoneNumber: null,
          phoneNumberVerifiedAt: null,
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
      identity: makeIdentity(),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "PRIVY_IDENTITY_CONFLICT",
      httpStatus: 409,
    });

    expect(identityUpsert).toHaveBeenCalledTimes(1);
  });

  it("preserves an existing stored wallet by omitting wallet fields from identity updates", async () => {
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
          maskedPhoneNumberHint: null,
          memberId: "member_123",
          phoneLookupKey: null,
          phoneNumber: null,
          phoneNumberVerifiedAt: null,
          privyUserId: null,
          walletAddressEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-identity.wallet-address",
            memberId: "member_123",
            value: SYNTHETIC_TEST_WALLET_ADDRESS,
          }),
          walletChainType: "ethereum",
          walletCreatedAt: NOW,
          walletProvider: "privy",
        }),
        upsert: identityUpsert,
      },
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      identity: makeIdentity(),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      id: "member_123",
    });

    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({
        walletAddressLookupKey: expect.anything(),
        walletChainType: expect.anything(),
        walletCreatedAt: expect.anything(),
        walletProvider: expect.anything(),
      }),
    }));
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

function requireHostedEmailLookupKey(value: string): string {
  const lookupKey = createHostedEmailLookupKey(value);
  if (!lookupKey) {
    throw new Error("Expected test email lookup key.");
  }
  return lookupKey;
}

function asRootPrisma<T extends object>(tx: T): T & {
  $transaction: ReturnType<typeof vi.fn>;
} {
  return {
    ...tx,
    $transaction: vi.fn(async (callback: (innerTx: T) => Promise<unknown>) => callback(tx)),
  };
}
