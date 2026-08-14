import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  createHostedEmailLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

import {
  bindHostedMemberPhoneToPreparedMemberTx,
  ensureHostedMemberForPhoneResolutionTx,
  reconcileHostedPrivyIdentityOnMember,
} from "@/src/lib/hosted-onboarding/member-identity-service";
import type { HostedPrivyIdentity } from "@/src/lib/hosted-onboarding/privy";

const privyProvider = vi.hoisted(() => ({
  readUser: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/privy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/privy")>()),
  readHostedPrivyUserById: privyProvider.readUser,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >()),
  provisionActiveHostedDomainRootEnvelopeForUserOnly:
    vi.fn().mockResolvedValue(undefined),
  revalidatePreparedHostedDomainRootForWebTx: vi.fn(async (input: {
    prepared: { rootKeyId: string };
  }) => ({
    root: Promise.resolve({
      envelope: input.prepared,
      rootKey: new Uint8Array(32),
    }),
    rootKeyId: input.prepared.rootKeyId,
  })),
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
    privyProvider.readUser.mockReset();
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

  it("reports creation while persisting a provider-verified phone identity", async () => {
    const createdMember = makeMember({
      id: "member_created",
    });
    const participantContactLock = vi.fn().mockResolvedValue(0);
    const identityCreateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = asRootPrisma({
      $executeRaw: participantContactLock,
      hostedMember: {
        create: vi.fn().mockResolvedValue(createdMember),
        delete: vi.fn(),
      },
      hostedMemberIdentity: {
        createMany: identityCreateMany,
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
      },
    });

    await expect(ensureHostedMemberForPhoneResolutionTx({
      phoneNumber: "+1 555 123 4567",
      phoneNumberVerifiedAt: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({
      created: true,
      member: createdMember,
    });

    expect(identityCreateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: expect.stringMatching(/^hbm_/u),
        phoneNumberVerifiedAt: NOW,
        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
      skipDuplicates: true,
    });
    expect(participantContactLock).toHaveBeenCalledTimes(1);
    expect(participantContactLock.mock.invocationCallOrder[0])
      .toBeLessThan(identityCreateMany.mock.invocationCallOrder[0] ?? 0);
  });

  it("binds a verified phone to the exact prepared member without creating another member", async () => {
    const member = makeMember({ id: "member_prepared" });
    const identityUpsert = vi.fn(async ({ create, update }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      ...create,
      ...update,
      createdAt: NOW,
      updatedAt: NOW,
      walletAddressEncrypted: null,
      walletAddressLookupKey: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    }));
    const prisma = asRootPrisma({
      hostedMember: {
        create: vi.fn(),
      },
      hostedMemberIdentity: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: identityUpsert,
      },
    });
    const preparedControlRoot = {
      domain: "control",
      rootKeyId: "root_control_prepared",
      userId: member.id,
    } as const;

    await expect(bindHostedMemberPhoneToPreparedMemberTx({
      currentIdentity: null,
      member,
      phoneNumber: "+1 555 123 4567",
      phoneNumberVerifiedAt: NOW,
      preparedControlRoot,
      prisma: prisma as never,
    })).resolves.toBe(member);

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        memberId: member.id,
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        phoneNumberVerifiedAt: NOW,
      }),
      where: { memberId: member.id },
    }));
  });

  it("fails closed instead of rebinding a prepared member from another phone", async () => {
    const member = makeMember({ id: "member_prepared" });
    const prisma = asRootPrisma({
      hostedMemberIdentity: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
    });

    await expect(bindHostedMemberPhoneToPreparedMemberTx({
      currentIdentity: {
        maskedPhoneNumberHint: "*** 0000",
        memberId: member.id,
        phoneLookupKey: "hbidx:phone:v1:another-phone",
        phoneNumber: "+15550000000",
        phoneNumberVerifiedAt: NOW,
        privyUserId: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      member,
      phoneNumber: "+15551234567",
      phoneNumberVerifiedAt: NOW,
      preparedControlRoot: {
        domain: "control",
        rootKeyId: "root_control_prepared",
        userId: member.id,
      },
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_DOMAIN_ROOT_PREPARATION_MISMATCH",
    });

    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
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
        findMany: vi.fn().mockResolvedValue([]),
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
        findMany: vi.fn().mockResolvedValue([]),
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

  it("rebinds a changed Privy user when its verified email already belongs to the member", async () => {
    const lockQuery = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ memberId: "member_123" }]);
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
      $queryRaw: lockQuery,
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeStoredIdentity({
          privyUserId: "did:privy:previous_user",
        })),
        upsert: identityUpsert,
      },
    });
    privyProvider.readUser.mockResolvedValueOnce({
      id: "did:privy:replacement_user",
      linked_accounts: [{
        address: "member@example.com",
        type: "email",
        verified_at: 1743933600,
      }],
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      allowVerifiedEmailRebinding: true,
      identity: makeIdentity({
        email: {
          address: "member@example.com",
          verifiedAt: 1743933600,
        },
        userId: "did:privy:replacement_user",
      }),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      id: "member_123",
    });

    expect(lockQuery).toHaveBeenCalledTimes(2);
    expect(lockQuery.mock.calls[1]?.[0]).toMatchObject({
      values: [requireHostedEmailLookupKey("member@example.com")],
    });
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        privyUserIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
      }),
    }));
  });

  it("rejects a changed Privy user when only the phone matches the member", async () => {
    const identityUpsert = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeStoredIdentity({
          privyUserId: "did:privy:previous_user",
        })),
        upsert: identityUpsert,
      },
    });
    privyProvider.readUser.mockResolvedValueOnce({
      id: "did:privy:replacement_user",
      linked_accounts: [{
        number: "+15551234567",
        type: "phone",
        verified_at: 1743933600,
      }],
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      allowVerifiedEmailRebinding: true,
      identity: makeIdentity({
        userId: "did:privy:replacement_user",
      }),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "PRIVY_USER_MISMATCH",
      httpStatus: 409,
    });

    expect(identityUpsert).not.toHaveBeenCalled();
  });

  it("rejects a changed Privy user when its verified email belongs to another member", async () => {
    const lockQuery = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ memberId: "member_other" }]);
    const identityUpsert = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: lockQuery,
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeStoredIdentity({
          privyUserId: "did:privy:previous_user",
        })),
        upsert: identityUpsert,
      },
    });
    privyProvider.readUser.mockResolvedValueOnce({
      id: "did:privy:replacement_user",
      linked_accounts: [{
        address: "other-member@example.com",
        type: "email",
        verified_at: 1743933600,
      }],
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      allowVerifiedEmailRebinding: true,
      identity: makeIdentity({
        email: {
          address: "other-member@example.com",
          verifiedAt: 1743933600,
        },
        userId: "did:privy:replacement_user",
      }),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "PRIVY_USER_MISMATCH",
      httpStatus: 409,
    });

    expect(identityUpsert).not.toHaveBeenCalled();
  });

  it("keeps changed-principal email rebinding disabled outside interactive authentication", async () => {
    const identityUpsert = vi.fn();
    const lockQuery = vi.fn().mockResolvedValue([]);
    const prisma = asRootPrisma({
      $queryRaw: lockQuery,
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeStoredIdentity({
          privyUserId: "did:privy:previous_user",
        })),
        upsert: identityUpsert,
      },
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      identity: makeIdentity({
        email: {
          address: "member@example.com",
          verifiedAt: 1743933600,
        },
        userId: "did:privy:replacement_user",
      }),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "PRIVY_USER_MISMATCH",
      httpStatus: 409,
    });

    expect(privyProvider.readUser).not.toHaveBeenCalled();
    expect(lockQuery).toHaveBeenCalledTimes(1);
    expect(identityUpsert).not.toHaveBeenCalled();
  });

  it("rejects a stale token when the live principal no longer owns the member email", async () => {
    const identityUpsert = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeStoredIdentity({
          privyUserId: "did:privy:current_user",
        })),
        upsert: identityUpsert,
      },
    });
    privyProvider.readUser.mockResolvedValueOnce({
      id: "did:privy:stale_user",
      linked_accounts: [{
        address: "different@example.com",
        type: "email",
        verified_at: 1743933600,
      }],
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      allowVerifiedEmailRebinding: true,
      identity: makeIdentity({
        email: {
          address: "member@example.com",
          verifiedAt: 1743933600,
        },
        userId: "did:privy:stale_user",
      }),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "PRIVY_USER_MISMATCH",
      httpStatus: 409,
    });

    expect(identityUpsert).not.toHaveBeenCalled();
  });

  it("fails closed when the changed principal is missing from the live provider", async () => {
    const identityUpsert = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeMember()),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeStoredIdentity({
          privyUserId: "did:privy:current_user",
        })),
        upsert: identityUpsert,
      },
    });
    privyProvider.readUser.mockRejectedValueOnce({
      code: "PRIVY_USER_LOOKUP_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    await expect(reconcileHostedPrivyIdentityOnMember({
      allowVerifiedEmailRebinding: true,
      identity: makeIdentity({
        email: {
          address: "member@example.com",
          verifiedAt: 1743933600,
        },
        userId: "did:privy:missing_user",
      }),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "PRIVY_USER_LOOKUP_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(identityUpsert).not.toHaveBeenCalled();
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
        findMany: vi.fn().mockResolvedValue([]),
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

async function makeStoredIdentity(input: {
  privyUserId: string;
}) {
  return {
    maskedPhoneNumberHint: "*** 4567",
    memberId: "member_123",
    phoneLookupKey: "hbidx:phone:v1:existing",
    phoneNumberEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId: "member_123",
      value: "+15551234567",
    }),
    phoneNumberVerifiedAt: NOW,
    privyUserIdEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.privy-user-id",
      memberId: "member_123",
      value: input.privyUserId,
    }),
    privyUserLookupKey: "hbidx:privy-user:v1:existing",
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumberEncrypted: null,
    walletAddressEncrypted: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
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
  $executeRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
} {
  const executeRaw = (
    tx as T & { $executeRaw?: ReturnType<typeof vi.fn> }
  ).$executeRaw ?? vi.fn().mockResolvedValue(0);
  const innerTx = {
    $executeRaw: executeRaw,
    hostedAccountDeletionCleanup: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    ...tx,
  };
  return {
    ...innerTx,
    $executeRaw: executeRaw,
    $transaction: vi.fn(
      async (callback: (transaction: T) => Promise<unknown>) =>
        callback(innerTx as T),
    ),
  };
}
