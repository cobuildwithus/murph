import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedEmailLookupKey,
  createHostedPhoneLookupKey,
  createHostedPrivyUserLookupKey,
  createHostedWalletAddressLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  areHostedDomainRootProviderCallsDisabled,
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import type { HostedPrivyIdentity } from "@/src/lib/hosted-onboarding/privy";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  HostedDomainRootPreparationMismatchError,
  prepareHostedDomainRootForWeb,
  revalidatePreparedHostedDomainRootForWebTx,
} from "@/src/lib/hosted-crypto/domain-root-store";

const privyManagementMocks = vi.hoisted(() => ({
  clientConstructor: vi.fn(),
  getUser: vi.fn(),
  setCustomMetadata: vi.fn(),
}));

const phoneCallResultRecoveryMocks = vi.hoisted(() => ({
  rearmRequired: vi.fn(),
}));

vi.mock("@/src/lib/phone-calls/reconciliation-workflow-start", () => ({
  signalHostedPhoneCallResultNotificationRecovery:
    phoneCallResultRecoveryMocks.rearmRequired,
}));

vi.mock("@privy-io/node", () => ({
  APIError: class APIError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
  PrivyClient: class PrivyClient {
    constructor(input: unknown) {
      privyManagementMocks.clientConstructor(input);
    }

    users() {
      return {
        _get: privyManagementMocks.getUser,
        setCustomMetadata: privyManagementMocks.setCustomMetadata,
      };
    }
  },
  verifyIdentityToken: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    contactPrivacyKeyring: {
      currentVersion: "v1",
      keysByVersion: {
        v1: Buffer.alloc(32, 7),
      },
      readVersions: ["v1"],
    },
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null,
    privyAppId: "cm_app_123",
    privyAppSecret: "privy-app-secret",
    privyVerificationKey: "privy-verification-key",
    publicBaseUrl: "https://join.example.test",
    stripeBillingMode: "payment",
    stripePriceIdsByPlan: {
      launch_edge_monthly: "price_edge_monthly_123",
      launch_monthly: "price_monthly_123",
    },
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
  getHostedOnboardingSecretCodec: () => ({
    encrypt: (value: string) => `enc:${value}`,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => {
  class HostedDomainRootPreparationMismatchError extends Error {}
  return {
    HostedDomainRootPreparationMismatchError,
    prepareHostedDomainRootForWeb: vi.fn().mockImplementation(
      async (input: { domain: string; userId: string }) => ({
        domain: input.domain,
        rootKeyId: `prepared-root:${input.userId}`,
        userId: input.userId,
      }),
    ),
    provisionActiveHostedDomainRootEnvelopeForUserOnly:
      vi.fn().mockResolvedValue(undefined),
    revalidatePreparedHostedDomainRootForWebTx: vi.fn().mockImplementation(
      async (input: { prepared: { rootKeyId: string } }) => ({
        root: Promise.resolve({
          envelope: { rootKeyId: input.prepared.rootKeyId },
          rootKey: new Uint8Array(32),
        }),
        rootKeyId: input.prepared.rootKeyId,
      }),
    ),
  };
});

import { completeHostedPrivyVerification as completeHostedPrivyVerificationImpl } from "@/src/lib/hosted-onboarding/authentication-service";

const NOW = new Date("2026-03-26T12:00:00.000Z");
const DEFAULT_PHONE_NUMBER = "+15551234567";
const DEFAULT_PHONE_LOOKUP_KEY = createHostedPhoneLookupKey(DEFAULT_PHONE_NUMBER)!;
const SECONDARY_PHONE_NUMBER = "+15557654321";
const SECONDARY_PHONE_LOOKUP_KEY = createHostedPhoneLookupKey(SECONDARY_PHONE_NUMBER)!;
const SYNTHETIC_TEST_WALLET_ADDRESS = "0x00000000000000000000000000000000000000a1";
const SYNTHETIC_TEST_WALLET_ADDRESS_ALT = "0x00000000000000000000000000000000000000b2";
type CompleteHostedPrivyVerificationInput = Parameters<
  typeof completeHostedPrivyVerificationImpl
>[0];
type CompleteHostedPrivyVerificationPrisma = CompleteHostedPrivyVerificationInput["prisma"];
type BaseHostedPrivyIdentity = HostedPrivyIdentity & {
  phone: NonNullable<HostedPrivyIdentity["phone"]>;
};
type PhoneOverrides = Partial<NonNullable<HostedPrivyIdentity["phone"]>> | null;
type IdentityOverrides = Omit<Partial<HostedPrivyIdentity>, "phone"> & {
  phone?: PhoneOverrides;
  wallet?: unknown;
};
type HostedInviteDelegate = {
  findUnique?: (input: { where?: Record<string, unknown> }) => Promise<unknown>;
};
type HostedMemberDelegate = {
  create?: (input: { data?: Record<string, unknown> }) => Promise<unknown>;
  findUnique?: (input: { where?: Record<string, unknown> }) => Promise<unknown>;
  update?: (input: { data?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown>;
  updateMany?: (input: { data?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown>;
};
type HostedMemberFindUniqueInclude = {
  billingRef?: boolean;
  identity?: boolean;
  routing?: boolean;
};
type HostedMemberFindUniqueSelect = {
  identity?: unknown;
  routing?: unknown;
};
type HostedMemberRoutingDelegate = {
  findMany?: (input: { where?: Record<string, unknown> }) => Promise<unknown>;
  findFirst?: (input: { where?: Record<string, unknown> }) => Promise<unknown>;
  findUnique?: (input: { where?: Record<string, unknown> }) => Promise<unknown>;
  upsert?: (input: {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
    where?: Record<string, unknown>;
  }) => Promise<unknown>;
};
type HostedMemberEmailAuthorizationDelegate = {
  findMany?: (input: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown[]>;
  findUnique?: (input: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown>;
  upsert?: (input: {
    create: Record<string, unknown>;
    select?: Record<string, unknown>;
    update: Record<string, unknown>;
    where?: Record<string, unknown>;
  }) => Promise<unknown>;
};
const livePrivyUsersById = new Map<string, {
  id: string;
  linked_accounts: Array<Record<string, unknown>>;
}>();

function projectIdentityAsLivePrivyUser(identity: HostedPrivyIdentity) {
  return {
    id: identity.userId,
    linked_accounts: [
      ...(identity.phone
        ? [{
            phone_number: identity.phone.number,
            type: "phone",
            verified_at: identity.phone.verifiedAt,
          }]
        : []),
      ...(identity.email?.verifiedAt
        ? [{
            address: identity.email.address,
            type: "email",
            verified_at: identity.email.verifiedAt,
          }]
        : []),
      ...(identity.telegram?.telegramUserId
        ? [{
            telegram_user_id: identity.telegram.telegramUserId,
            type: "telegram",
          }]
        : []),
    ],
  };
}

async function completeHostedPrivyVerification(
  input: CompleteHostedPrivyVerificationInput,
) {
  if (!livePrivyUsersById.has(input.identity.userId)) {
    livePrivyUsersById.set(
      input.identity.userId,
      projectIdentityAsLivePrivyUser(input.identity),
    );
  }
  return completeHostedPrivyVerificationImpl(input);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeIdentity(overrides: IdentityOverrides = {}): HostedPrivyIdentity {
  const identity = baseIdentity();
  const basePhone: NonNullable<HostedPrivyIdentity["phone"]> = identity.phone;
  const { wallet: ignoredWallet, ...identityOverrides } = overrides;
  void ignoredWallet;
  const phone: HostedPrivyIdentity["phone"] =
    overrides.phone === null
      ? null
      : {
          ...basePhone,
          ...(overrides.phone ?? {}),
        };

  return {
    ...identity,
    ...identityOverrides,
    phone,
  };
}

function baseIdentity(): BaseHostedPrivyIdentity {
  return {
    email: null,
    phone: {
      number: DEFAULT_PHONE_NUMBER,
      verifiedAt: 1742990400,
    },
    telegram: null,
    userId: "did:privy:user_123",
  };
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    accountGroupMemberships: [],
    billingStatus: HostedBillingStatus.not_started,
    createdAt: NOW,
    id: "member_123",
    linqChatId: null,
    maskedPhoneNumberHint: "*** 4567",
    pendingActivationTimeZone: null,
    phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    suspendedAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    threadContainer: null,
    updatedAt: NOW,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
    ...overrides,
  };
}

function makeInvite(member: ReturnType<typeof makeMember>, overrides: Record<string, unknown> = {}) {
  return {
    channel: "linq",
    checkouts: [],
    createdAt: NOW,
    expiresAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "invite_123",
    inviteCode: "invite-code",
    member: "identity" in member
      ? member
      : {
          ...member,
          identity: {
            createdAt: NOW,
            maskedPhoneNumberHint: member.maskedPhoneNumberHint,
            memberId: member.id,
            phoneLookupKey: member.phoneLookupKey,
            phoneNumberVerifiedAt: member.phoneNumberVerifiedAt,
            privyUserId: member.privyUserId,
            updatedAt: NOW,
            walletAddress: member.walletAddress,
            walletChainType: member.walletChainType,
            walletCreatedAt: member.walletCreatedAt,
            walletProvider: member.walletProvider,
          },
        },
    memberId: member.id,
    sentAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("completeHostedPrivyVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    livePrivyUsersById.clear();
    Reflect.deleteProperty(globalThis, "__murphHostedPrivyManagementClient");
    privyManagementMocks.getUser.mockImplementation(async (userId: string) =>
      livePrivyUsersById.get(userId) ?? { id: userId }
    );
    phoneCallResultRecoveryMocks.rearmRequired.mockResolvedValue(false);
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("binds a verified Privy identity onto an invite-bound member", async () => {
    const transactionCachePresence: boolean[] = [];
    const inviteMember = makeMember({
      maskedPhoneNumberHint: "*** 4321",
      phoneLookupKey: SECONDARY_PHONE_LOOKUP_KEY,
    });
    const invite = {
      ...makeInvite(inviteMember),
      member: {
        ...inviteMember,
        identity: {
          createdAt: NOW,
          maskedPhoneNumberHint: "*** 4567",
          memberId: inviteMember.id,
          phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
          phoneNumberVerifiedAt: null,
          privyUserId: null,
          updatedAt: NOW,
          walletAddress: null,
          walletChainType: null,
          walletCreatedAt: null,
          walletProvider: null,
        },
      },
    };
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...inviteMember,
          ...data,
        })),
        updateMany: vi.fn().mockImplementation(async () => {
          transactionCachePresence.push(Boolean(getHostedDomainRootUnwrapCache()));
          return { count: 1 };
        }),
      },
    });

    const result = await completeHostedPrivyVerification({
      identity: makeIdentity(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      timeZone: "America/New_York",
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    expect(transactionCachePresence).toEqual([true]);
    expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
    expect(result).toMatchObject({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      memberId: inviteMember.id,
      messagingSetupRequired: false,
      stage: "checkout",
    });
  });

  it("settles live Privy authority before opening the reconciliation transaction", async () => {
    const events: string[] = [];
    const inviteMember = makeMember();
    const invite = makeInvite(inviteMember);
    const prismaHolder: {
      current: NonNullable<CompleteHostedPrivyVerificationPrisma> | null;
    } = { current: null };
    const transaction = vi.fn(async (
      callback: (
        tx: NonNullable<CompleteHostedPrivyVerificationPrisma>,
      ) => Promise<unknown>,
    ) => {
      events.push("transaction-start");
      if (!prismaHolder.current) {
        throw new Error("Expected the Privy ordering fixture to be initialized.");
      }
      return callback(prismaHolder.current);
    });
    privyManagementMocks.getUser.mockImplementationOnce(async (userId: string) => {
      events.push("privy-authority-settled");
      return livePrivyUsersById.get(userId) ?? { id: userId };
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      $transaction: transaction,
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
      },
    });
    prismaHolder.current = prisma;

    await expect(completeHostedPrivyVerification({
      identity: makeIdentity(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    })).resolves.toMatchObject({
      memberId: inviteMember.id,
    });

    expect(events).toEqual([
      "privy-authority-settled",
      "transaction-start",
    ]);
    expect(privyManagementMocks.getUser).toHaveBeenCalledTimes(1);
  });

  it("drains root preparation while preserving the first provider failure", async () => {
    const providerFailure = new Error("provider authority failed");
    let resolveRoot!: (value: {
      domain: "control";
      rootKeyId: string;
      userId: string;
    }) => void;
    const rootGate = new Promise<{
      domain: "control";
      rootKeyId: string;
      userId: string;
    }>((resolve) => {
      resolveRoot = resolve;
    });
    vi.mocked(prepareHostedDomainRootForWeb).mockReturnValueOnce(rootGate);
    privyManagementMocks.getUser.mockRejectedValueOnce(providerFailure);
    const inviteMember = makeMember();
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInvite(inviteMember)),
      },
    });
    let settled = false;
    const completion = completeHostedPrivyVerification({
      identity: makeIdentity(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });
    void completion.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await vi.waitFor(() => {
      expect(privyManagementMocks.getUser).toHaveBeenCalledOnce();
      expect(prepareHostedDomainRootForWeb).toHaveBeenCalledOnce();
    });
    expect(settled).toBe(false);
    resolveRoot({
      domain: "control",
      rootKeyId: "root-drained-after-provider-failure",
      userId: inviteMember.id,
    });

    await expect(completion).rejects.toMatchObject({
      code: "PRIVY_USER_LOOKUP_FAILED",
      httpStatus: 503,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("retries the full preparation once after exact root drift", async () => {
    vi.mocked(revalidatePreparedHostedDomainRootForWebTx).mockRejectedValueOnce(
      new HostedDomainRootPreparationMismatchError(),
    );
    const inviteMember = makeMember();
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInvite(inviteMember)),
      },
    });

    await expect(completeHostedPrivyVerification({
      identity: makeIdentity(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    })).resolves.toMatchObject({ memberId: inviteMember.id });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(privyManagementMocks.getUser).toHaveBeenCalledTimes(2);
    expect(prepareHostedDomainRootForWeb).toHaveBeenCalledTimes(2);
  });

  it("retries secondary verified-email root drift once and then fails closed", async () => {
    const revalidatePreparedRoot = vi
      .mocked(revalidatePreparedHostedDomainRootForWebTx)
      .getMockImplementation();
    if (!revalidatePreparedRoot) {
      throw new Error("Expected the default prepared-root revalidation mock.");
    }
    vi.mocked(revalidatePreparedHostedDomainRootForWebTx)
      .mockImplementationOnce(revalidatePreparedRoot)
      .mockRejectedValueOnce(new HostedDomainRootPreparationMismatchError())
      .mockImplementationOnce(revalidatePreparedRoot)
      .mockRejectedValueOnce(new HostedDomainRootPreparationMismatchError());
    const phoneMember = makeMember({
      id: "member_phone_secondary_email_root_drift",
    });
    const activeInvite = makeInvite(phoneMember, {
      channel: "web",
      id: "invite_phone_secondary_email_root_drift",
      inviteCode: "invite-phone-secondary-email-root-drift",
      memberId: phoneMember.id,
    });
    const secondaryEmailUpsert = vi.fn();
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(
          async ({ where }: { where: Record<string, unknown> }) => (
            where.id === phoneMember.id || where.phoneLookupKey
              ? phoneMember
              : null
          ),
        ),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn(),
        upsert: secondaryEmailUpsert,
      },
    });

    await expect(completeHostedPrivyVerification({
      authMethod: "phone",
      identity: makeIdentity({
        email: {
          address: "secondary-root-drift@example.com",
          verifiedAt: 1743064200,
        },
      }),
      now: NOW,
      prisma,
    })).rejects.toBeInstanceOf(HostedDomainRootPreparationMismatchError);

    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
    expect(privyManagementMocks.getUser).toHaveBeenCalledTimes(2);
    expect(prepareHostedDomainRootForWeb).toHaveBeenCalledTimes(2);
    expect(revalidatePreparedHostedDomainRootForWebTx).toHaveBeenCalledTimes(4);
    expect(secondaryEmailUpsert).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
  });

  it("keeps another member's phone binding without decrypting that identity", async () => {
    const selectedMember = makeMember({
      id: "member_selected_by_privy_principal",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      privyUserId: baseIdentity().userId,
    });
    const phoneOwnerMember = makeMember({
      id: "member_existing_phone_owner",
    });
    const selectedIdentity = await readMemberIdentity(selectedMember);
    const phoneOwnerIdentity = await readMemberIdentity(phoneOwnerMember);
    if (!selectedIdentity || !phoneOwnerIdentity) {
      throw new Error("Expected cross-member phone identity fixtures.");
    }
    const activeInvite = makeInvite(selectedMember, {
      channel: "web",
      id: "invite_selected_by_privy_principal",
      inviteCode: "invite-selected-by-privy-principal",
      memberId: selectedMember.id,
    });
    const identityFindMany = vi.fn(async ({
      include,
      select,
      where,
    }: {
      include?: { member?: boolean };
      select?: { memberId?: boolean };
      where: Record<string, unknown>;
    }) => {
      if (where.privyUserLookupKey) {
        return include?.member
          ? [{ ...selectedIdentity, member: selectedMember }]
          : [selectedIdentity];
      }
      if (where.phoneLookupKey) {
        return select?.memberId
          ? [{ memberId: phoneOwnerMember.id }]
          : include?.member
            ? [{ ...phoneOwnerIdentity, member: phoneOwnerMember }]
            : [phoneOwnerIdentity];
      }
      return [];
    });
    const identityUpsert = vi.fn(async ({
      create,
      update,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      ...selectedIdentity,
      ...create,
      ...update,
    }));
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          where.id === selectedMember.id ? selectedMember : null),
      },
      hostedMemberIdentity: {
        findMany: identityFindMany,
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          where.memberId === selectedMember.id ? selectedIdentity : null),
        upsert: identityUpsert,
      },
    });

    await expect(completeHostedPrivyVerification({
      authMethod: "phone",
      identity: makeIdentity(),
      now: NOW,
      prisma,
    })).resolves.toMatchObject({
      inviteCode: "invite-selected-by-privy-principal",
      memberId: selectedMember.id,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(privyManagementMocks.getUser).toHaveBeenCalledTimes(1);
    expect(prepareHostedDomainRootForWeb).toHaveBeenCalledTimes(1);
    expect(revalidatePreparedHostedDomainRootForWebTx).toHaveBeenCalledTimes(1);
    expect(identityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        memberId: true,
      },
      where: expect.objectContaining({
        phoneLookupKey: expect.anything(),
      }),
    }));
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        phoneLookupKey: null,
      }),
    }));
  });

  it("binds a verified email identity onto an invite-bound Linq email contact despite stale client method", async () => {
    const pendingEmailAddress = "linq-handle@example.com";
    const pendingEmailLookupKey = createHostedEmailLookupKey(pendingEmailAddress)!;
    const privyEmailVerifiedAtSeconds = 1742990400;
    const verifiedEmailVerifiedAt = new Date(privyEmailVerifiedAtSeconds * 1000);
    const inviteMember = makeMember({
      id: "member_linq_email_invite",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
      privyUserId: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const inviteMemberWithRouting = {
      ...inviteMember,
      identity: {
        createdAt: NOW,
        maskedPhoneNumberHint: null,
        memberId: inviteMember.id,
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
        privyUserId: null,
        updatedAt: NOW,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      routing: {
        linqChatIdEncrypted: null,
        linqRecipientPhoneEncrypted: null,
        memberId: inviteMember.id,
        pendingLinqChatIdEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-routing.pending-linq-chat-id",
          memberId: inviteMember.id,
          value: "linq_chat_email_123",
        }),
        pendingLinqParticipantContactEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-routing.pending-linq-participant-contact",
          memberId: inviteMember.id,
          value: pendingEmailAddress,
        }),
        pendingLinqParticipantContactKind: "email",
        pendingLinqParticipantContactLookupKey: pendingEmailLookupKey,
        pendingLinqParticipantContactObservedAt: NOW,
        pendingLinqRecipientPhoneEncrypted: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
    };
    const invite = makeInvite(inviteMemberWithRouting);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...inviteMember,
          ...data,
        })),
      },
    });

    const result = await completeHostedPrivyVerification({
      authMethod: "phone",
      identity: makeIdentity({
        email: {
          address: "Linq-Handle@example.com",
          verifiedAt: privyEmailVerifiedAtSeconds,
        },
        phone: null,
        wallet: null,
      }),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      memberId: inviteMember.id,
      messagingSetupRequired: false,
      stage: "checkout",
    });
    expect(prisma.hostedMemberIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        memberId: inviteMember.id,
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
      }),
      update: expect.objectContaining({
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
      }),
    }));
    expect(prisma.hostedMemberEmailAuthorization.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        memberId: inviteMember.id,
        verifiedEmailLookupKey: pendingEmailLookupKey,
        verifiedEmailVerifiedAt,
      }),
      update: expect.objectContaining({
        verifiedEmailLookupKey: pendingEmailLookupKey,
        verifiedEmailVerifiedAt,
      }),
    }));
  });

  it("rejects an invite when the live principal email diverges from the token invite email", async () => {
    const pendingEmailAddress = "pending-invite@example.com";
    const canonicalEmailAddress = "canonical-member@example.com";
    const pendingEmailLookupKey = createHostedEmailLookupKey(pendingEmailAddress)!;
    const previousPrivyUserId = "did:privy:previous_invite_owner";
    const replacementPrivyUserId = "did:privy:replacement_invite_owner";
    const inviteMember = makeMember({
      id: "member_live_email_invite",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
      privyUserId: previousPrivyUserId,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const inviteMemberWithRouting = {
      ...inviteMember,
      identity: {
        createdAt: NOW,
        maskedPhoneNumberHint: null,
        memberId: inviteMember.id,
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
        privyUserId: previousPrivyUserId,
        updatedAt: NOW,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      routing: {
        linqChatIdEncrypted: null,
        linqRecipientPhoneEncrypted: null,
        memberId: inviteMember.id,
        pendingLinqChatIdEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-routing.pending-linq-chat-id",
          memberId: inviteMember.id,
          value: "linq_chat_live_email_invite",
        }),
        pendingLinqParticipantContactEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-routing.pending-linq-participant-contact",
          memberId: inviteMember.id,
          value: pendingEmailAddress,
        }),
        pendingLinqParticipantContactKind: "email",
        pendingLinqParticipantContactLookupKey: pendingEmailLookupKey,
        pendingLinqParticipantContactObservedAt: NOW,
        pendingLinqRecipientPhoneEncrypted: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
    };
    const invite = makeInvite(inviteMemberWithRouting);
    const storedIdentity = await readMemberIdentity(inviteMemberWithRouting);
    if (!storedIdentity) {
      throw new Error("Expected the live-email invite identity fixture.");
    }
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn(),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn().mockResolvedValue({
          directPublicSenderAddressEncrypted: null,
          directPublicSenderAuthorizedAt: NOW,
          directPublicSenderLookupKey: createHostedEmailLookupKey(canonicalEmailAddress),
          memberId: inviteMember.id,
          verifiedEmailAddressEncrypted: null,
          verifiedEmailLookupKey: createHostedEmailLookupKey(canonicalEmailAddress),
          verifiedEmailVerifiedAt: NOW,
        }),
        upsert: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          ...storedIdentity,
          privyUserId: previousPrivyUserId,
        }),
        upsert: vi.fn(),
      },
    });
    privyManagementMocks.getUser.mockResolvedValueOnce({
      id: replacementPrivyUserId,
      linked_accounts: [{
        address: canonicalEmailAddress,
        type: "email",
        verified_at: 1_743_064_200,
      }],
    });

    await expect(completeHostedPrivyVerification({
      authMethod: "email",
      identity: makeIdentity({
        email: {
          address: pendingEmailAddress,
          verifiedAt: 1_743_064_200,
        },
        phone: null,
        userId: replacementPrivyUserId,
        wallet: null,
      }),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    })).rejects.toMatchObject({
      code: "PRIVY_EMAIL_MISMATCH",
      httpStatus: 403,
    });

    expect(privyManagementMocks.getUser).toHaveBeenCalledWith(
      replacementPrivyUserId,
      {
        maxRetries: 0,
        timeout: 5_000,
      },
    );
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
  });

  it("maps invite-bound primary email ownership conflicts to a merge-safe account conflict", async () => {
    const pendingEmailAddress = "linq-conflict@example.com";
    const pendingEmailLookupKey = createHostedEmailLookupKey(pendingEmailAddress)!;
    const privyEmailVerifiedAtSeconds = 1742990400;
    const inviteMember = makeMember({
      id: "member_linq_email_conflict_invite",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
      privyUserId: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const inviteMemberWithRouting = {
      ...inviteMember,
      identity: {
        createdAt: NOW,
        maskedPhoneNumberHint: null,
        memberId: inviteMember.id,
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
        privyUserId: null,
        updatedAt: NOW,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      routing: {
        linqChatIdEncrypted: null,
        linqRecipientPhoneEncrypted: null,
        memberId: inviteMember.id,
        pendingLinqChatIdEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-routing.pending-linq-chat-id",
          memberId: inviteMember.id,
          value: "linq_chat_email_conflict_123",
        }),
        pendingLinqParticipantContactEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-routing.pending-linq-participant-contact",
          memberId: inviteMember.id,
          value: pendingEmailAddress,
        }),
        pendingLinqParticipantContactKind: "email",
        pendingLinqParticipantContactLookupKey: pendingEmailLookupKey,
        pendingLinqParticipantContactObservedAt: NOW,
        pendingLinqRecipientPhoneEncrypted: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
    };
    const invite = makeInvite(inviteMemberWithRouting);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn(),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn(),
        upsert: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
          "duplicate verified email",
          {
            clientVersion: "test",
            code: "P2002",
            meta: {
              target: ["verifiedEmailLookupKey"],
            },
          },
        )),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        authMethod: "email",
        identity: makeIdentity({
          email: {
            address: pendingEmailAddress,
            verifiedAt: privyEmailVerifiedAtSeconds,
          },
          phone: null,
          wallet: null,
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "PRIVY_IDENTITY_CONFLICT",
      httpStatus: 409,
    });

    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.upsert).toHaveBeenCalled();
  });

  it("keeps an existing wallet when invite verification sees a different linked wallet", async () => {
    const inviteMember = makeMember();
    const invite = makeInvite(inviteMember);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
      },
      hostedMember: {
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          createdAt: NOW,
          maskedPhoneNumberHint: "*** 4567",
          memberId: inviteMember.id,
          phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
          phoneNumberVerifiedAt: NOW,
          privyUserId: "did:privy:user_123",
          updatedAt: NOW,
          walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
          walletAddressEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-identity.wallet-address",
            memberId: inviteMember.id,
            value: SYNTHETIC_TEST_WALLET_ADDRESS,
          }),
          walletAddressLookupKey: createHostedWalletAddressLookupKey(
            SYNTHETIC_TEST_WALLET_ADDRESS,
          ),
          walletChainType: "ethereum",
          walletCreatedAt: NOW,
          walletProvider: "privy",
        }),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          wallet: {
            address: SYNTHETIC_TEST_WALLET_ADDRESS_ALT,
            chainType: "ethereum",
            id: "wallet_conflict",
            type: "wallet",
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-code",
      memberId: inviteMember.id,
      stage: "checkout",
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({
        walletAddressLookupKey: expect.anything(),
        walletChainType: expect.anything(),
        walletCreatedAt: expect.anything(),
        walletProvider: expect.anything(),
      }),
    }));
  });

  it("creates a hosted member and a web invite for a new public phone signup", async () => {
    const createdMember = makeMember({
      id: "member_new",
      phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
      phoneNumberVerifiedAt: NOW,
      privyUserId: "did:privy:user_123",
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const createdInvite = makeInvite(createdMember, {
      channel: "web",
      id: "invite_new",
      inviteCode: "public-invite-code",
      memberId: "member_new",
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(createdInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue(createdMember),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === createdMember.id ? createdMember : null
        )),
      },
    });

    const result = await completeHostedPrivyVerification({
      identity: makeIdentity(),
      now: NOW,
      prisma,
    });

    expect(prisma.hostedMember.findUnique).toHaveBeenCalled();
    expect(prisma.hostedMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billingStatus: HostedBillingStatus.not_started,
      }),
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
    expect(prisma.hostedInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: "web",
        memberId: "member_new",
      }),
    });
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.not.objectContaining({
        walletAddressLookupKey: expect.anything(),
        walletChainType: expect.anything(),
        walletCreatedAt: expect.anything(),
        walletProvider: expect.anything(),
      }),
      update: expect.not.objectContaining({
        walletAddressLookupKey: expect.anything(),
        walletChainType: expect.anything(),
        walletCreatedAt: expect.anything(),
        walletProvider: expect.anything(),
      }),
    }));
    expect(result.joinUrl).toBe("https://join.example.test/join/public-invite-code");
    expect(result.inviteCode).toBe("public-invite-code");
    expect(result.messagingSetupRequired).toBe(false);
    expect(result.stage).toBe("checkout");
    expect(privyManagementMocks.clientConstructor).toHaveBeenCalledOnce();
    expect(privyManagementMocks.getUser).toHaveBeenCalledWith(
      "did:privy:user_123",
      {
        maxRetries: 0,
        timeout: 5_000,
      },
    );
    expect(privyManagementMocks.setCustomMetadata).not.toHaveBeenCalled();
  });

  it("keeps public primary email binding in the member creation transaction", async () => {
    const createdMember = makeMember({
      id: "member_public_email_conflict",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
      privyUserId: "did:privy:user_123",
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    let transactionDepth = 0;
    const identityWriteTransactionDepths: number[] = [];
    const emailWriteTransactionDepths: number[] = [];
    const identityWriteTransactionCachePresence: boolean[] = [];
    const emailWriteTransactionCachePresence: boolean[] = [];
    const prismaHolder: {
      current: NonNullable<CompleteHostedPrivyVerificationPrisma> | null;
    } = {
      current: null,
    };
    const transaction = vi.fn(async (
      callback: (tx: NonNullable<CompleteHostedPrivyVerificationPrisma>) => Promise<unknown>,
    ) => {
      transactionDepth += 1;
      try {
        if (!prismaHolder.current) {
          throw new Error("Expected transaction prisma fixture to be initialized.");
        }

        const tx = Object.create(prismaHolder.current) as NonNullable<CompleteHostedPrivyVerificationPrisma>;
        Object.defineProperty(tx, "$transaction", {
          configurable: true,
          value: undefined,
        });
        return await callback(tx);
      } finally {
        transactionDepth -= 1;
      }
    });
    const identityUpsert = vi.fn(async ({
      create,
      update,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      identityWriteTransactionDepths.push(transactionDepth);
      identityWriteTransactionCachePresence.push(Boolean(getHostedDomainRootUnwrapCache()));
      return {
        ...create,
        ...update,
      };
    });
    const emailUpsert = vi.fn(async () => {
      emailWriteTransactionDepths.push(transactionDepth);
      emailWriteTransactionCachePresence.push(Boolean(getHostedDomainRootUnwrapCache()));
      throw new Prisma.PrismaClientKnownRequestError("duplicate verified email", {
        clientVersion: "test",
        code: "P2002",
        meta: {
          target: ["verifiedEmailLookupKey"],
        },
      });
    });
    let createdMemberId = createdMember.id;

    const prisma = asCompleteHostedPrivyVerificationPrisma({
      $transaction: transaction,
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn().mockImplementation(
          async ({ data }: { data: { id: string } }) => {
            createdMemberId = data.id;
            return { ...createdMember, id: data.id };
          },
        ),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === createdMemberId ? { ...createdMember, id: createdMemberId } : null
        )),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: emailUpsert,
      },
      hostedMemberIdentity: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: identityUpsert,
      },
    });
    prismaHolder.current = prisma;

    await expect(
      completeHostedPrivyVerification({
        authMethod: "email",
        identity: makeIdentity({
          email: {
            address: "public-conflict@example.com",
            verifiedAt: 1743064200,
          },
          phone: null,
          wallet: null,
        }),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "PRIVY_IDENTITY_CONFLICT",
      httpStatus: 409,
    });

    expect(identityWriteTransactionDepths).toEqual([1]);
    expect(emailWriteTransactionDepths).toEqual([1]);
    expect(identityWriteTransactionCachePresence).toEqual([true]);
    expect(emailWriteTransactionCachePresence).toEqual([true]);
    expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("persists a valid signup timezone only as pending activation state", async () => {
    const createdMember = makeMember({
      id: "member_timezone",
      phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
      phoneNumberVerifiedAt: NOW,
      privyUserId: "did:privy:user_123",
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
      walletChainType: "ethereum",
      walletCreatedAt: NOW,
      walletProvider: "privy",
    });
    const createdInvite = makeInvite(createdMember, {
      channel: "web",
      id: "invite_timezone",
      inviteCode: "public-timezone-invite",
      memberId: "member_timezone",
    });
    const hostedMemberUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(createdInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue(createdMember),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === createdMember.id ? createdMember : null
        )),
        updateMany: hostedMemberUpdateMany,
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity(),
        now: NOW,
        prisma,
        timeZone: "America/New_York",
      }),
    ).resolves.toMatchObject({
      inviteCode: "public-timezone-invite",
      memberId: "member_timezone",
      stage: "checkout",
    });

    expect(hostedMemberUpdateMany).toHaveBeenCalledWith({
      data: {
        pendingActivationTimeZone: "America/New_York",
      },
      where: {
        billingStatus: {
          in: [
            HostedBillingStatus.incomplete,
            HostedBillingStatus.not_started,
          ],
        },
        id: "member_timezone",
      },
    });
  });

  it("resolves an existing auth by verified email without creating a duplicate member", async () => {
    const existingMember = makeMember({
      id: "member_email_existing",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
      privyUserId: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const activeInvite = makeInvite(existingMember, {
      channel: "web",
      id: "invite_email_existing",
      inviteCode: "invite-email-existing",
      memberId: existingMember.id,
    });
    const hostedMemberEmailAuthorizationRecord = {
      directPublicSenderAddressEncrypted: null,
      directPublicSenderAuthorizedAt: null,
      directPublicSenderLookupKey: null,
      member: existingMember,
      memberId: existingMember.id,
      verifiedEmailAddressEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-email-authorization.verified-email",
        memberId: existingMember.id,
        value: "user@example.com",
      }),
      verifiedEmailLookupKey: createHostedEmailLookupKey("user@example.com"),
      verifiedEmailVerifiedAt: NOW,
    };
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === existingMember.id ? existingMember : null
        )),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => (
          where?.verifiedEmailLookupKey === hostedMemberEmailAuthorizationRecord.verifiedEmailLookupKey
            ? hostedMemberEmailAuthorizationRecord
            : null
        )),
        upsert: vi.fn(async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => ({
          ...create,
          ...update,
        })),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          email: {
            address: "user@example.com",
            verifiedAt: 1743064200,
          },
          phone: null,
          wallet: null,
        }),
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: expect.any(String),
      joinUrl: expect.stringContaining("/join/"),
      memberId: existingMember.id,
      // Verified email already gives Murph a delivery route, so signup no
      // longer holds this member on messaging setup.
      messagingSetupRequired: false,
      stage: "checkout",
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        memberId: existingMember.id,
      }),
    }));
    expect(prisma.hostedMemberEmailAuthorization.upsert).toHaveBeenCalled();
  });

  it("recovers a changed principal through shared completion when phone auth is inferred first", async () => {
    const oldPrivyUserId = "did:privy:previous_email_owner";
    const replacementPrivyUserId = "did:privy:replacement_email_owner";
    const emailAddress = "recovery@example.com";
    const staleTokenEmailAddress = "stale-recovery@example.com";
    const existingMember = makeMember({
      id: "member_email_recovery",
      phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
      phoneNumberVerifiedAt: NOW,
      privyUserId: oldPrivyUserId,
    });
    const activeInvite = makeInvite(existingMember, {
      channel: "web",
      id: "invite_email_recovery",
      inviteCode: "invite-email-recovery",
      memberId: existingMember.id,
    });
    const storedIdentity = await readMemberIdentity(existingMember);
    if (!storedIdentity) {
      throw new Error("Expected the email-recovery identity fixture.");
    }
    const emailAuthorization = {
      directPublicSenderAddressEncrypted: null,
      directPublicSenderAuthorizedAt: null,
      directPublicSenderLookupKey: null,
      memberId: existingMember.id,
      verifiedEmailAddressEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-email-authorization.verified-email",
        memberId: existingMember.id,
        value: emailAddress,
      }),
      verifiedEmailLookupKey: createHostedEmailLookupKey(emailAddress),
      verifiedEmailVerifiedAt: NOW,
    };
    const identityUpsert = vi.fn(async ({
      create,
      update,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      ...create,
      ...update,
    }));
    const lockQuery = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ memberId: existingMember.id }]);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      $queryRaw: lockQuery,
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === existingMember.id ? existingMember : null
        )),
      },
      hostedMemberEmailAuthorization: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => (
          where?.memberId === existingMember.id
          || where?.verifiedEmailLookupKey === emailAuthorization.verifiedEmailLookupKey
            ? emailAuthorization
            : null
        )),
        upsert: vi.fn(async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => ({
          ...emailAuthorization,
          ...create,
          ...update,
        })),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
          where.memberId === existingMember.id
          || where.phoneLookupKey === DEFAULT_PHONE_LOOKUP_KEY
          || where.privyUserLookupKey === createHostedPrivyUserLookupKey(oldPrivyUserId)
            ? {
                ...storedIdentity,
                privyUserId: oldPrivyUserId,
              }
            : null
        )),
        upsert: identityUpsert,
      },
    });
    privyManagementMocks.getUser.mockResolvedValueOnce({
      id: replacementPrivyUserId,
      linked_accounts: [{
        address: emailAddress,
        type: "email",
        verified_at: 1_743_064_200,
      }],
    });

    await expect(completeHostedPrivyVerification({
      identity: makeIdentity({
        email: {
          address: staleTokenEmailAddress,
          verifiedAt: 1_743_064_200,
        },
        userId: replacementPrivyUserId,
      }),
      now: NOW,
      prisma,
    })).resolves.toMatchObject({
      inviteCode: "invite-email-recovery",
      memberId: existingMember.id,
      messagingSetupRequired: false,
      stage: "checkout",
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(privyManagementMocks.getUser).toHaveBeenCalledWith(
      replacementPrivyUserId,
      {
        maxRetries: 0,
        timeout: 5_000,
      },
    );
    expect(lockQuery).toHaveBeenCalledTimes(3);
    expect(prisma.hostedMemberEmailAuthorization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          directPublicSenderLookupKey: createHostedEmailLookupKey(emailAddress),
          verifiedEmailLookupKey: createHostedEmailLookupKey(emailAddress),
        }),
        update: expect.objectContaining({
          directPublicSenderLookupKey: createHostedEmailLookupKey(emailAddress),
          verifiedEmailLookupKey: createHostedEmailLookupKey(emailAddress),
        }),
      }),
    );
    const persistedEmailLookupKeys = prisma.hostedMemberEmailAuthorization.upsert.mock.calls
      .flatMap(([call]) => [
        call.create?.directPublicSenderLookupKey,
        call.create?.verifiedEmailLookupKey,
        call.update?.directPublicSenderLookupKey,
        call.update?.verifiedEmailLookupKey,
      ]);
    expect(persistedEmailLookupKeys).not.toContain(
      createHostedEmailLookupKey(staleTokenEmailAddress),
    );
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        privyUserIdEncrypted: expect.any(String),
        privyUserLookupKey: createHostedPrivyUserLookupKey(replacementPrivyUserId),
      }),
    }));
  });

  it("resolves an existing active direct Privy member without creating a duplicate", async () => {
    const existingMember = makeMember({
      billingStatus: HostedBillingStatus.active,
      id: "member_active_direct_existing",
      phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
      phoneNumberVerifiedAt: NOW,
      privyUserId: "did:privy:user_123",
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
      walletChainType: "ethereum",
      walletCreatedAt: NOW,
      walletProvider: "privy",
    });
    const activeInvite = makeInvite(existingMember, {
      channel: "web",
      id: "invite_active_direct_existing",
      inviteCode: "invite-active-direct-existing",
      memberId: existingMember.id,
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === existingMember.id
            || where.memberId === existingMember.id
            || where.privyUserId
            || where.phoneLookupKey
            ? existingMember
            : null
        )),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity(),
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-active-direct-existing",
      memberId: existingMember.id,
      stage: "active",
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
  });

  it("resolves a texted-first member by phone on first web auth without creating a duplicate", async () => {
    const existingMember = makeMember({
      billingStatus: HostedBillingStatus.active,
      id: "member_texted_first_existing",
      phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
      phoneNumberVerifiedAt: null,
      privyUserId: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const activeInvite = makeInvite(existingMember, {
      channel: "web",
      id: "invite_texted_first_existing",
      inviteCode: "invite-texted-first-existing",
      memberId: existingMember.id,
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === existingMember.id || where.phoneLookupKey ? existingMember : null
        )),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity(),
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-texted-first-existing",
      memberId: existingMember.id,
      stage: "active",
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
  });

  it("resolves an existing auth by Telegram binding without creating a duplicate member", async () => {
    const existingMember = makeMember({
      id: "member_telegram_existing",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
      privyUserId: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const activeInvite = makeInvite(existingMember, {
      channel: "web",
      id: "invite_telegram_existing",
      inviteCode: "invite-telegram-existing",
      memberId: existingMember.id,
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === existingMember.id ? existingMember : null
        )),
      },
      hostedMemberRouting: {
        findFirst: vi.fn(async () => ({
          linqChatIdEncrypted: null,
          linqRecipientPhoneEncrypted: null,
          member: existingMember,
          memberId: existingMember.id,
          pendingLinqChatIdEncrypted: null,
          pendingLinqRecipientPhoneEncrypted: null,
          telegramUserIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-routing.telegram-user-id",
            memberId: existingMember.id,
            value: "456",
          }),
          telegramUserLookupKey: "hbidx:telegram-user:v1:telegram_lookup_456",
        })),
        findUnique: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => (
          where?.memberId === existingMember.id
            ? {
                linqChatIdEncrypted: null,
                linqRecipientPhoneEncrypted: null,
                member: existingMember,
                memberId: existingMember.id,
                pendingLinqChatIdEncrypted: null,
                pendingLinqRecipientPhoneEncrypted: null,
                telegramUserIdEncrypted: await encryptHostedWebNullableString({
                  field: "hosted-member-routing.telegram-user-id",
                  memberId: existingMember.id,
                  value: "456",
                }),
                telegramUserLookupKey: "hbidx:telegram-user:v1:telegram_lookup_456",
              }
            : null
        )),
        upsert: vi.fn(async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => ({
          ...create,
          ...update,
        })),
      },
    });

    const verificationInput = {
      identity: makeIdentity({
        phone: null,
        telegram: {
          firstName: "Alice",
          lastName: null,
          photoUrl: null,
          telegramUserId: "456",
          username: "alice",
        },
        wallet: null,
      }),
      now: NOW,
      prisma,
    };
    await expect(
      completeHostedPrivyVerification(verificationInput),
    ).resolves.toMatchObject({
      inviteCode: expect.any(String),
      joinUrl: expect.stringContaining("/join/"),
      memberId: existingMember.id,
      messagingSetupRequired: true,
      stage: "checkout",
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        memberId: existingMember.id,
      }),
    }));
    expect(prisma.hostedMemberRouting.upsert).toHaveBeenCalled();
    expect(phoneCallResultRecoveryMocks.rearmRequired).toHaveBeenCalledWith({
      memberId: existingMember.id,
      prisma,
    });

    const recoveryError = new Error("phone-call recovery unavailable");
    phoneCallResultRecoveryMocks.rearmRequired.mockRejectedValueOnce(
      recoveryError,
    );
    await expect(
      completeHostedPrivyVerification(verificationInput),
    ).resolves.toMatchObject({
      memberId: existingMember.id,
      stage: "checkout",
    });
    expect(phoneCallResultRecoveryMocks.rearmRequired).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Telegram auth resolves to multiple members across blind-index read candidates", async () => {
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findMany: vi.fn(async () => [
          {
            linqChatIdEncrypted: null,
            linqRecipientPhoneEncrypted: null,
            member: makeMember({ id: "member_telegram_v1" }),
            memberId: "member_telegram_v1",
            pendingLinqChatIdEncrypted: null,
            pendingLinqRecipientPhoneEncrypted: null,
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: "hbidx:telegram-user:v1:telegram_lookup_456",
          },
          {
            linqChatIdEncrypted: null,
            linqRecipientPhoneEncrypted: null,
            member: makeMember({ id: "member_telegram_v2" }),
            memberId: "member_telegram_v2",
            pendingLinqChatIdEncrypted: null,
            pendingLinqRecipientPhoneEncrypted: null,
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: "hbidx:telegram-user:v2:telegram_lookup_456",
          },
        ]),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          phone: null,
          telegram: {
            firstName: "Alice",
            lastName: null,
            photoUrl: null,
            telegramUserId: "456",
            username: "alice",
          },
          wallet: null,
        }),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_ROUTING_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: 2,
      },
      httpStatus: 500,
      retryable: true,
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("creates a hosted member and a web invite for a new public phone signup even when the Privy wallet is not ready yet", async () => {
    const createdMember = makeMember({
      id: "member_phone_only",
      phoneLookupKey: DEFAULT_PHONE_LOOKUP_KEY,
      phoneNumberVerifiedAt: NOW,
      privyUserId: "did:privy:user_123",
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const createdInvite = makeInvite(createdMember, {
      channel: "web",
      id: "invite_phone_only",
      inviteCode: "public-phone-only-invite",
      memberId: "member_phone_only",
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(createdInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue(createdMember),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === createdMember.id ? createdMember : null
        )),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          wallet: null,
        }),
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "public-phone-only-invite",
      joinUrl: "https://join.example.test/join/public-phone-only-invite",
      memberId: "member_phone_only",
      messagingSetupRequired: false,
      stage: "checkout",
    });

    expect(prisma.hostedMember.create).toHaveBeenCalledTimes(1);
  });

  it("treats a Telegram-only signup as messaging-ready before any inbound thread exists", async () => {
    const identityUpsert = vi.fn(async ({
      create,
      update,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      ...create,
      ...update,
    }));
    const createdMember = makeMember({
      id: "member_telegram_only",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
      privyUserId: "did:privy:user_123",
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    const createdInvite = makeInvite(createdMember, {
      channel: "web",
      id: "invite_telegram_only",
      inviteCode: "public-telegram-invite",
      memberId: "member_telegram_only",
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(createdInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue(createdMember),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === createdMember.id ? createdMember : null
        )),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: identityUpsert,
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          phone: null,
          telegram: {
            firstName: "Alice",
            lastName: null,
            photoUrl: null,
            telegramUserId: "456",
            username: "alice",
          },
          wallet: null,
        }),
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "public-telegram-invite",
      joinUrl: "https://join.example.test/join/public-telegram-invite",
      memberId: "member_telegram_only",
      messagingSetupRequired: false,
      stage: "checkout",
    });

    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        maskedPhoneNumberHint: null,
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
      }),
      update: expect.objectContaining({
        maskedPhoneNumberHint: null,
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
      }),
    }));
  });

  it("treats invite-bound Telegram-only verification as messaging-ready before inbound", async () => {
    const inviteMember = makeMember({
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
    });
    const invite = {
      ...makeInvite(inviteMember),
      member: {
        ...inviteMember,
        identity: {
          createdAt: NOW,
          maskedPhoneNumberHint: null,
          memberId: inviteMember.id,
          phoneLookupKey: null,
          phoneNumberVerifiedAt: null,
          privyUserId: null,
          updatedAt: NOW,
          walletAddress: null,
          walletChainType: null,
          walletCreatedAt: null,
          walletProvider: null,
        },
      },
    };
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...inviteMember,
          ...data,
        })),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          phone: null,
          telegram: {
            firstName: "Alice",
            lastName: null,
            photoUrl: null,
            telegramUserId: "456",
            username: "alice",
          },
          wallet: null,
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      memberId: inviteMember.id,
      messagingSetupRequired: false,
      stage: "checkout",
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
  });

  it("requires Telegram state for invite-bound Telegram auth before mutating identity", async () => {
    const inviteMember = makeMember({
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumberVerifiedAt: null,
    });
    const invite = {
      ...makeInvite(inviteMember),
      member: {
        ...inviteMember,
        identity: {
          createdAt: NOW,
          maskedPhoneNumberHint: null,
          memberId: inviteMember.id,
          phoneLookupKey: null,
          phoneNumberVerifiedAt: null,
          privyUserId: null,
          updatedAt: NOW,
          walletAddress: null,
          walletChainType: null,
          walletCreatedAt: null,
          walletProvider: null,
        },
      },
    };
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn(),
      },
      hostedMember: {
        update: vi.fn(),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        authMethod: "telegram",
        identity: makeIdentity({
          phone: null,
          telegram: null,
          wallet: null,
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "PRIVY_TELEGRAM_REQUIRED",
      httpStatus: 400,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
  });

  it("marks an already-active invite flow as paid and preserves the paid timestamp", async () => {
    const activeMember = makeMember({
      billingStatus: HostedBillingStatus.active,
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
      privyUserId: "did:privy:user_123",
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
      walletProvider: "privy",
    });
    const invite = makeInvite(activeMember);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...activeMember,
          ...data,
        })),
      },
    });

    const result = await completeHostedPrivyVerification({
      identity: makeIdentity(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    expect(result.stage).toBe("active");
  });

  it("treats active Family sponsorship as post-verification access", async () => {
    const sponsoredMember = makeMember({
      accountGroupMemberships: [
        {
          group: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
          status: "active",
        },
      ],
      billingStatus: HostedBillingStatus.not_started,
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
      privyUserId: "did:privy:user_123",
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
      walletProvider: "privy",
    });
    const invite = makeInvite(sponsoredMember);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...sponsoredMember,
          ...data,
        })),
      },
    });

    const result = await completeHostedPrivyVerification({
      identity: makeIdentity(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(result.stage).toBe("active");
  });

  it("preserves suspension for a suspended invited member", async () => {
    const suspendedMember = makeMember({
      billingStatus: HostedBillingStatus.active,
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
      privyUserId: "did:privy:user_123",
      suspendedAt: new Date("2026-03-21T12:00:00.000Z"),
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
      walletProvider: "privy",
    });
    const invite = makeInvite(suspendedMember);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn(),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...suspendedMember,
          ...data,
        })),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          email: {
            address: "suspended@example.test",
            verifiedAt: 1743064200,
          },
          telegram: {
            firstName: "Alice",
            lastName: null,
            photoUrl: null,
            telegramUserId: "456",
            username: "alice",
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
  });

  it("refuses a returning suspended member during public Privy verification before issuing a fresh invite", async () => {
    const suspendedMember = makeMember({
      billingStatus: HostedBillingStatus.not_started,
      phoneNumberVerifiedAt: NOW,
      privyUserId: "did:privy:user_123",
      suspendedAt: NOW,
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
      walletChainType: "ethereum",
      walletCreatedAt: NOW,
      walletProvider: "privy",
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id === suspendedMember.id || where.privyUserId || where.phoneLookupKey || where.walletAddress) {
            return suspendedMember;
          }

          return null;
        }),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...suspendedMember,
          ...data,
        })),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          email: {
            address: "suspended@example.test",
            verifiedAt: 1743064200,
          },
          telegram: {
            firstName: "Alice",
            lastName: null,
            photoUrl: null,
            telegramUserId: "456",
            username: "alice",
          },
        }),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
  });

  it("blocks re-creation while Privy deletion remains pending", async () => {
    const findPendingCleanup = vi.fn().mockResolvedValue({
      id: "cleanup_pending",
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedAccountDeletionCleanup: {
        findFirst: findPendingCleanup,
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(completeHostedPrivyVerification({
      identity: makeIdentity(),
      now: NOW,
      prisma,
    })).rejects.toMatchObject({
      code: "PRIVY_ACCOUNT_DELETION_IN_PROGRESS",
      httpStatus: 409,
      retryable: true,
    });

    expect(findPendingCleanup).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        privyCompletedAt: null,
        privyUserLookupKey: {
          in: [createHostedPrivyUserLookupKey("did:privy:user_123")],
        },
      },
    });
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("requires live provider authority before creating a new Privy member", async () => {
    privyManagementMocks.getUser.mockRejectedValueOnce(new Error("missing"));
    const findPendingCleanup = vi.fn().mockResolvedValue(null);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedAccountDeletionCleanup: {
        findFirst: findPendingCleanup,
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(completeHostedPrivyVerification({
      identity: makeIdentity(),
      now: NOW,
      prisma,
    })).rejects.toMatchObject({
      code: "PRIVY_USER_LOOKUP_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(findPendingCleanup).toHaveBeenCalledOnce();
    expect(privyManagementMocks.getUser).toHaveBeenCalledWith(
      "did:privy:user_123",
      {
        maxRetries: 0,
        timeout: 5_000,
      },
    );
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("resolves phone auth by the asserted phone even when a linked wallet points elsewhere", async () => {
    const phoneMember = makeMember({ id: "member_phone" });
    const walletMember = makeMember({
      id: "member_wallet",
      maskedPhoneNumberHint: "*** 4321",
      phoneLookupKey: SECONDARY_PHONE_LOOKUP_KEY,
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
    });
    const activeInvite = makeInvite(phoneMember, {
      channel: "web",
      id: "invite_phone_existing",
      inviteCode: "invite-phone-existing",
      memberId: phoneMember.id,
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id === phoneMember.id) {
            return phoneMember;
          }

          if (where.id === walletMember.id) {
            return walletMember;
          }

          if (where.privyUserId) {
            return null;
          }

          if (where.phoneLookupKey) {
            return phoneMember;
          }

          if (where.walletAddress || where.walletAddressLookupKey) {
            return walletMember;
          }

          return null;
        }),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        authMethod: "phone",
        identity: makeIdentity(),
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-phone-existing",
      memberId: phoneMember.id,
      stage: "checkout",
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        memberId: phoneMember.id,
      }),
    }));
    expect(prisma.hostedMemberIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({
        walletAddressLookupKey: expect.anything(),
        walletChainType: expect.anything(),
        walletCreatedAt: expect.anything(),
        walletProvider: expect.anything(),
      }),
    }));
  });

  it("does not read or persist secondary wallet state during phone auth", async () => {
    const phoneMember = makeMember({ id: "member_phone_ambiguous_wallet" });
    const walletMemberA = makeMember({
      id: "member_wallet_ambiguous_a",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
    });
    const walletMemberB = makeMember({
      id: "member_wallet_ambiguous_b",
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
    });
    const phoneIdentity = await readMemberIdentity(phoneMember);
    const walletIdentityA = await readMemberIdentity(walletMemberA);
    const walletIdentityB = await readMemberIdentity(walletMemberB);

    if (!phoneIdentity || !walletIdentityA || !walletIdentityB) {
      throw new Error("Expected hosted identity fixtures to be readable.");
    }

    const activeInvite = makeInvite(phoneMember, {
      channel: "web",
      id: "invite_phone_ambiguous_wallet",
      inviteCode: "invite-phone-ambiguous-wallet",
      memberId: phoneMember.id,
    });
    const identityFindMany = vi.fn(async ({
      include,
      where,
    }: {
      include?: { member?: boolean };
      where: Record<string, unknown>;
    }) => {
      const phoneLookupKeys = Array.isArray(
        (where.phoneLookupKey as { in?: unknown[] } | undefined)?.in,
      )
        ? (where.phoneLookupKey as { in: unknown[] }).in
        : [];
      const walletLookupKeys = Array.isArray(
        (where.walletAddressLookupKey as { in?: unknown[] } | undefined)?.in,
      )
        ? (where.walletAddressLookupKey as { in: unknown[] }).in
        : [];

      if (phoneLookupKeys.includes(DEFAULT_PHONE_LOOKUP_KEY)) {
        return include?.member
          ? [{ ...phoneIdentity, member: phoneMember }]
          : [phoneIdentity];
      }

      if (walletLookupKeys.length > 0) {
        return include?.member
          ? [
              { ...walletIdentityA, member: walletMemberA },
              { ...walletIdentityB, member: walletMemberB },
            ]
          : [walletIdentityA, walletIdentityB];
      }

      return [];
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id === phoneMember.id || where.phoneLookupKey === DEFAULT_PHONE_LOOKUP_KEY) {
            return phoneMember;
          }

          return null;
        }),
      },
      hostedMemberIdentity: {
        findMany: identityFindMany,
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          where.memberId === phoneMember.id ? phoneIdentity : null),
        upsert: vi.fn(async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => ({
          ...create,
          ...update,
        })),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        authMethod: "phone",
        identity: makeIdentity(),
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-phone-ambiguous-wallet",
      memberId: phoneMember.id,
      stage: "checkout",
    });

    expect(prisma.hostedMemberIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({
        walletAddressLookupKey: expect.anything(),
        walletChainType: expect.anything(),
        walletCreatedAt: expect.anything(),
        walletProvider: expect.anything(),
      }),
    }));
    expect(identityFindMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        walletAddressLookupKey: expect.anything(),
      }),
    }));
  });

  it("surfaces a secondary Telegram ownership conflict before issuing an invite", async () => {
    const secondaryTelegramTransactionCachePresence: boolean[] = [];
    const phoneMember = makeMember({ id: "member_phone_with_secondary_telegram" });
    const activeInvite = makeInvite(phoneMember, {
      channel: "web",
      id: "invite_phone_secondary_telegram",
      inviteCode: "invite-phone-secondary-telegram",
      memberId: phoneMember.id,
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === phoneMember.id || where.phoneLookupKey ? phoneMember : null
        )),
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockImplementation(async () => {
          secondaryTelegramTransactionCachePresence.push(
            Boolean(getHostedDomainRootUnwrapCache()),
          );
          return [
            {
              memberId: "member_secondary_telegram_owner",
            },
          ];
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        authMethod: "phone",
        identity: makeIdentity({
          telegram: {
            firstName: "Alice",
            lastName: null,
            photoUrl: null,
            telegramUserId: "456",
            username: "alice",
          },
        }),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_IDENTITY_CONFLICT",
      httpStatus: 409,
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(secondaryTelegramTransactionCachePresence).toEqual([true]);
    expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
  });

  it("writes a secondary Telegram binding exactly once during successful phone auth", async () => {
    const phoneMember = makeMember({ id: "member_phone_with_secondary_telegram" });
    const activeInvite = makeInvite(phoneMember, {
      channel: "web",
      id: "invite_phone_secondary_telegram",
      inviteCode: "invite-phone-secondary-telegram",
      memberId: phoneMember.id,
    });
    const telegramRoutingUpsert = vi.fn(async () => ({}));
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === phoneMember.id || where.phoneLookupKey ? phoneMember : null
        )),
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: telegramRoutingUpsert,
      },
    });

    await expect(
      completeHostedPrivyVerification({
        authMethod: "phone",
        identity: makeIdentity({
          telegram: {
            firstName: "Alice",
            lastName: null,
            photoUrl: null,
            telegramUserId: "456",
            username: "alice",
          },
        }),
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-phone-secondary-telegram",
      memberId: phoneMember.id,
      stage: "checkout",
    });

    expect(telegramRoutingUpsert).toHaveBeenCalledTimes(1);
  });

  it("does not block phone auth when a linked email belongs to another member", async () => {
    const secondaryEmailTransactionCachePresence: boolean[] = [];
    const secondaryEmailTransactionProviderDisabled: boolean[] = [];
    const phoneMember = makeMember({ id: "member_phone_secondary_email" });
    const activeInvite = makeInvite(phoneMember, {
      channel: "web",
      id: "invite_phone_secondary_email",
      inviteCode: "invite-phone-secondary-email",
      memberId: phoneMember.id,
    });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === phoneMember.id || where.phoneLookupKey ? phoneMember : null
        )),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn(),
        upsert: vi.fn().mockImplementation(async () => {
          secondaryEmailTransactionCachePresence.push(
            Boolean(getHostedDomainRootUnwrapCache()),
          );
          secondaryEmailTransactionProviderDisabled.push(
            areHostedDomainRootProviderCallsDisabled(),
          );
          throw new Prisma.PrismaClientKnownRequestError(
            "duplicate verified email",
            {
              clientVersion: "test",
              code: "P2002",
              meta: {
                target: ["verifiedEmailLookupKey"],
              },
            },
          );
        }),
      },
    });

    try {
      await expect(
        completeHostedPrivyVerification({
          authMethod: "phone",
          identity: makeIdentity({
            email: {
              address: "secondary@example.com",
              verifiedAt: 1743064200,
            },
          }),
          now: NOW,
          prisma,
        }),
      ).resolves.toMatchObject({
        inviteCode: "invite-phone-secondary-email",
        memberId: phoneMember.id,
        stage: "checkout",
      });
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted Privy secondary email binding sync failed.",
      );
    } finally {
      consoleWarn.mockRestore();
    }

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.upsert).toHaveBeenCalled();
    expect(secondaryEmailTransactionCachePresence).toEqual([true]);
    expect(secondaryEmailTransactionProviderDisabled).toEqual([true]);
    expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
  });

  it("does not swallow unexpected secondary email uniqueness failures", async () => {
    const phoneMember = makeMember({ id: "member_phone_secondary_email_unexpected" });
    const activeInvite = makeInvite(phoneMember, {
      channel: "web",
      id: "invite_phone_secondary_email_unexpected",
      inviteCode: "invite-phone-secondary-email-unexpected",
      memberId: phoneMember.id,
    });
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(activeInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
          where.id === phoneMember.id || where.phoneLookupKey ? phoneMember : null
        )),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn(),
        upsert: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
          "duplicate member email authorization",
          {
            clientVersion: "test",
            code: "P2002",
            meta: {
              target: ["memberId"],
            },
          },
        )),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        authMethod: "phone",
        identity: makeIdentity({
          email: {
            address: "secondary-unexpected@example.com",
            verifiedAt: 1743064200,
          },
        }),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });

    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("rejects invite verification when the Privy phone number does not match the invited number", async () => {
    const inviteMember = makeMember();
    const invite = makeInvite(inviteMember);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
      },
      hostedMember: {
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(invite.member.identity),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          phone: {
            number: "+15550000000",
            verifiedAt: 1742990400,
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "PRIVY_PHONE_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
  });

  it("preserves an existing member wallet when the verified Privy wallet differs", async () => {
    const existingWalletCreatedAt = new Date("2026-03-20T12:00:00.000Z");
    const inviteMember = makeMember({
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
      walletChainType: "ethereum",
      walletCreatedAt: existingWalletCreatedAt,
      walletProvider: "privy",
    });
    const invite = makeInvite(inviteMember);
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
      },
      hostedMember: {
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(invite.member.identity),
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          wallet: {
            address: SYNTHETIC_TEST_WALLET_ADDRESS_ALT,
            chainType: "ethereum",
            id: "wallet_conflict",
            type: "wallet",
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-code",
      memberId: inviteMember.id,
      stage: "checkout",
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({
        walletAddressLookupKey: expect.anything(),
        walletChainType: expect.anything(),
        walletCreatedAt: expect.anything(),
        walletProvider: expect.anything(),
      }),
    }));
  });

  it("preserves an existing stored wallet when the current Privy session has not produced one yet", async () => {
    const existingWalletCreatedAt = new Date("2026-03-20T12:00:00.000Z");
    const inviteMember = makeMember({
      walletAddress: SYNTHETIC_TEST_WALLET_ADDRESS,
      walletChainType: "ethereum",
      walletCreatedAt: existingWalletCreatedAt,
      walletProvider: "privy",
    });
    const invite = makeInvite(inviteMember);
    const identityUpsert = vi.fn(async ({
      create,
      update,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      ...create,
      ...update,
    }));
    const prisma = asCompleteHostedPrivyVerificationPrisma({
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...inviteMember,
          ...data,
        })),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(invite.member.identity),
        upsert: identityUpsert,
      },
    });

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          wallet: null,
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      memberId: inviteMember.id,
      messagingSetupRequired: false,
      stage: "checkout",
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

function asCompleteHostedPrivyVerificationPrisma<T extends Record<string, unknown>>(
  prisma: T,
): T & CompleteHostedPrivyVerificationPrisma {
  const prismaWithQueryRaw = prisma as T & CompleteHostedPrivyVerificationPrisma;
  const routingRecordsByMemberId = new Map<string, Record<string, unknown>>();
  const hostedInvite = readHostedInviteDelegate(prismaWithQueryRaw.hostedInvite);
  const hostedMember = readHostedMemberDelegate(prismaWithQueryRaw.hostedMember);
  const hostedMemberRouting = readHostedMemberRoutingDelegate(prismaWithQueryRaw.hostedMemberRouting);
  const hostedMemberEmailAuthorization =
    readHostedMemberEmailAuthorizationDelegate(prismaWithQueryRaw.hostedMemberEmailAuthorization);
  if (
    !("hostedAccountDeletionCleanup" in prismaWithQueryRaw)
    || !prismaWithQueryRaw.hostedAccountDeletionCleanup
  ) {
    Object.defineProperty(prismaWithQueryRaw, "hostedAccountDeletionCleanup", {
      configurable: true,
      value: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
  }
  if (!("hostedMember" in prismaWithQueryRaw) || !prismaWithQueryRaw.hostedMember || typeof hostedMember?.findUnique !== "function") {
    Object.defineProperty(prismaWithQueryRaw, "hostedMember", {
      configurable: true,
      value: {
        ...(hostedMember ?? {}),
        findUnique: vi.fn(async ({
          include,
          select,
          where,
        }: {
          include?: HostedMemberFindUniqueInclude;
          select?: HostedMemberFindUniqueSelect;
          where?: Record<string, unknown>;
        }) => {
          const invite = await hostedInvite?.findUnique?.({ where: {} });
          const inviteMember = (invite as { member?: unknown } | null)?.member ?? null;

          if (
            inviteMember
            && typeof where?.id === "string"
            && isPlainRecord(inviteMember)
            && inviteMember.id === where.id
          ) {
            if ((!include && !select) || typeof inviteMember !== "object") {
              return inviteMember;
            }

            return await projectHostedMemberFindUniqueResult({
              include,
              member: inviteMember,
              routingRecordsByMemberId,
              select,
            });
          }

          return null;
        }),
      },
    });
  } else {
    const hostedMemberRecord = prismaWithQueryRaw.hostedMember;
    const originalFindUnique =
      typeof hostedMemberRecord.findUnique === "function"
        ? hostedMemberRecord.findUnique.bind(hostedMemberRecord)
        : undefined;

    if (originalFindUnique) {
      Object.defineProperty(hostedMemberRecord, "findUnique", {
        configurable: true,
        value: vi.fn(async ({
          include,
          select,
          where,
        }: {
          include?: HostedMemberFindUniqueInclude;
          select?: HostedMemberFindUniqueSelect;
          where: Record<string, unknown>;
        }) => {
          const result = await Reflect.apply(originalFindUnique, hostedMemberRecord, [
            {
              include,
              select,
              where,
            },
          ]);

          if ((!include && !select) || !result || typeof result !== "object") {
            return result;
          }

          if (!isPlainRecord(result)) {
            return result;
          }

          return await projectHostedMemberFindUniqueResult({
            include,
            member: result,
            routingRecordsByMemberId,
            select,
          });
        }),
      });
    }
  }

  if (!("hostedMemberRouting" in prismaWithQueryRaw) || !prismaWithQueryRaw.hostedMemberRouting) {
    Object.defineProperty(prismaWithQueryRaw, "hostedMemberRouting", {
      configurable: true,
      value: {
        ...(hostedMemberRouting ?? {}),
        findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          const lookupKey = Array.isArray(
            (where?.telegramUserLookupKey as { in?: unknown[] } | undefined)?.in,
          )
            ? ((where?.telegramUserLookupKey as { in: unknown[] }).in[0] ?? null)
            : null;

          if (!lookupKey || typeof lookupKey !== "string") {
            return [];
          }

          for (const routingRecord of routingRecordsByMemberId.values()) {
            if (routingRecord.telegramUserLookupKey === lookupKey) {
              return [routingRecord];
            }
          }

          return [];
        }),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          const lookupKey = Array.isArray(
            (where?.telegramUserLookupKey as { in?: unknown[] } | undefined)?.in,
          )
            ? ((where?.telegramUserLookupKey as { in: unknown[] }).in[0] ?? null)
            : null;

          if (!lookupKey || typeof lookupKey !== "string") {
            return null;
          }

          for (const routingRecord of routingRecordsByMemberId.values()) {
            if (routingRecord.telegramUserLookupKey === lookupKey) {
              return routingRecord;
            }
          }

          return null;
        }),
        findUnique: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          const memberId = typeof where?.memberId === "string" ? where.memberId : null;
          return memberId ? routingRecordsByMemberId.get(memberId) ?? null : null;
        }),
        upsert: vi.fn(async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const memberId = typeof create.memberId === "string"
            ? create.memberId
            : typeof update.memberId === "string"
              ? update.memberId
              : null;
          const nextRecord = {
            ...create,
            ...update,
          };

          if (memberId) {
            routingRecordsByMemberId.set(memberId, nextRecord);
          }

          return nextRecord;
        }),
      },
    });
  } else if (
    typeof prismaWithQueryRaw.hostedMemberRouting.findMany !== "function"
    && typeof prismaWithQueryRaw.hostedMemberRouting.findFirst === "function"
  ) {
    Object.defineProperty(prismaWithQueryRaw.hostedMemberRouting, "findMany", {
      configurable: true,
      value: vi.fn(async (...args: unknown[]) => {
        const result = await prismaWithQueryRaw.hostedMemberRouting?.findFirst?.(
          ...(args as Parameters<NonNullable<HostedMemberRoutingDelegate["findFirst"]>>),
        );
        return result ? [result] : [];
      }),
    });
  }

  if (!("hostedMemberIdentity" in prismaWithQueryRaw) || !prismaWithQueryRaw.hostedMemberIdentity) {
    const hostedMemberIdentityFallback = {
      findFirst: vi.fn(async ({
        include,
        where,
      }: {
        include?: { member?: boolean };
        where: Record<string, unknown>;
      }) => {
        const privyUserLookupKey = Array.isArray(
          (where.privyUserLookupKey as { in?: unknown[] } | undefined)?.in,
        )
          ? ((where.privyUserLookupKey as { in: unknown[] }).in[0] ?? null)
          : null;
        const phoneLookupKey = Array.isArray(
          (where.phoneLookupKey as { in?: unknown[] } | undefined)?.in,
        )
          ? ((where.phoneLookupKey as { in: unknown[] }).in[0] ?? null)
          : null;
        const walletAddressLookupKey = Array.isArray(
          (where.walletAddressLookupKey as { in?: unknown[] } | undefined)?.in,
        )
          ? ((where.walletAddressLookupKey as { in: unknown[] }).in[0] ?? null)
          : null;

        return hostedMemberIdentityFallback.findUnique({
          include,
          where: {
            ...(typeof privyUserLookupKey === "string"
              ? {
                  privyUserLookupKey,
                }
              : {}),
            ...(typeof phoneLookupKey === "string"
              ? {
                  phoneLookupKey,
                }
              : {}),
            ...(typeof walletAddressLookupKey === "string"
              ? {
                  walletAddressLookupKey,
                }
              : {}),
          },
        });
      }),
      findMany: vi.fn(async (input: {
        include?: { member?: boolean };
        where: Record<string, unknown>;
      }) => {
        const identity = await hostedMemberIdentityFallback.findFirst(input);
        return identity ? [identity] : [];
      }),
      findUnique: vi.fn(async ({
        include,
        where,
      }: {
        include?: { member?: boolean };
        where: Record<string, unknown>;
      }) => {
        const invite = await hostedInvite?.findUnique?.({ where: {} });
        const inviteMember = (invite as { member?: unknown } | null)?.member ?? null;
        const inviteIdentity = await readMemberIdentity(inviteMember);
        if (
          inviteIdentity &&
          (where.memberId === inviteIdentity.memberId ||
            where.privyUserLookupKey === inviteIdentity.privyUserLookupKey ||
            where.phoneLookupKey === inviteIdentity.phoneLookupKey ||
            where.walletAddressLookupKey === inviteIdentity.walletAddressLookupKey)
        ) {
          return include?.member ? { ...inviteIdentity, member: inviteMember } : inviteIdentity;
        }

        const member = await hostedMember?.findUnique?.({ where });
        const identity = await readMemberIdentity(member);
        return identity && include?.member ? { ...identity, member } : identity;
      }),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        ...create,
        ...update,
      })),
    };

    Object.defineProperty(prismaWithQueryRaw, "hostedMemberIdentity", {
      configurable: true,
      value: hostedMemberIdentityFallback,
    });
  } else {
    const hostedMemberIdentityRecord = prismaWithQueryRaw.hostedMemberIdentity;
    const originalFindUnique =
      typeof hostedMemberIdentityRecord.findUnique === "function"
        ? hostedMemberIdentityRecord.findUnique.bind(hostedMemberIdentityRecord)
        : undefined;

    if (originalFindUnique) {
      Object.defineProperty(hostedMemberIdentityRecord, "findUnique", {
        configurable: true,
        value: vi.fn(async ({
          include,
          where,
        }: {
          include?: { member?: boolean };
          where: Record<string, unknown>;
        }) => {
          const result = await Reflect.apply(originalFindUnique, hostedMemberIdentityRecord, [
            {
              include,
              where,
            },
          ]);
          const identity = await readMemberIdentity(result);

          if (!identity) {
            return result;
          }

          const member =
            include?.member
              ? ((result as { member?: unknown } | null)?.member
                ?? await hostedMember?.findUnique?.({
                  where: {
                    id: identity.memberId,
                  },
                }))
              : undefined;

          return include?.member ? { ...identity, member } : identity;
        }),
      });
    }

    if (
      typeof hostedMemberIdentityRecord.findFirst !== "function"
      && typeof hostedMemberIdentityRecord.findUnique === "function"
    ) {
      Object.defineProperty(hostedMemberIdentityRecord, "findFirst", {
        configurable: true,
        value: vi.fn(async ({
          include,
          where,
        }: {
          include?: { member?: boolean };
          where: Record<string, unknown>;
        }) => {
          const privyUserLookupKey = Array.isArray(
            (where.privyUserLookupKey as { in?: unknown[] } | undefined)?.in,
          )
            ? ((where.privyUserLookupKey as { in: unknown[] }).in[0] ?? null)
            : null;
          const phoneLookupKey = Array.isArray(
            (where.phoneLookupKey as { in?: unknown[] } | undefined)?.in,
          )
            ? ((where.phoneLookupKey as { in: unknown[] }).in[0] ?? null)
            : null;
          const walletAddressLookupKey = Array.isArray(
            (where.walletAddressLookupKey as { in?: unknown[] } | undefined)?.in,
          )
            ? ((where.walletAddressLookupKey as { in: unknown[] }).in[0] ?? null)
            : null;

          return Reflect.apply(hostedMemberIdentityRecord.findUnique, hostedMemberIdentityRecord, [
            {
              include,
              where: {
                ...(typeof privyUserLookupKey === "string"
                  ? {
                      privyUserLookupKey,
                    }
                  : {}),
                ...(typeof phoneLookupKey === "string"
                  ? {
                      phoneLookupKey,
                    }
                  : {}),
                ...(typeof walletAddressLookupKey === "string"
                  ? {
                      walletAddressLookupKey,
                    }
                  : {}),
              },
            },
          ]);
        }),
      });
    }

    if (
      typeof hostedMemberIdentityRecord.findMany !== "function"
      && typeof hostedMemberIdentityRecord.findFirst === "function"
    ) {
      Object.defineProperty(hostedMemberIdentityRecord, "findMany", {
        configurable: true,
        value: vi.fn(async (input: {
          include?: { member?: boolean };
          where: Record<string, unknown>;
        }) => {
          const identity = await hostedMemberIdentityRecord.findFirst?.(input);
          return identity ? [identity] : [];
        }),
      });
    }

    if (typeof hostedMemberIdentityRecord.upsert !== "function") {
      Object.defineProperty(hostedMemberIdentityRecord, "upsert", {
        configurable: true,
        value: vi.fn(async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => ({
          ...create,
          ...update,
        })),
      });
    }
  }

  if (
    !("hostedMemberEmailAuthorization" in prismaWithQueryRaw)
    || !prismaWithQueryRaw.hostedMemberEmailAuthorization
  ) {
    Object.defineProperty(prismaWithQueryRaw, "hostedMemberEmailAuthorization", {
      configurable: true,
      value: {
        ...(hostedMemberEmailAuthorization ?? {}),
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => ({
          ...create,
          ...update,
        })),
      },
    });
  } else if (typeof prismaWithQueryRaw.hostedMemberEmailAuthorization.findMany !== "function") {
    Object.defineProperty(prismaWithQueryRaw.hostedMemberEmailAuthorization, "findMany", {
      configurable: true,
      value: vi.fn(async (input: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => {
        const lookupKeys = Array.isArray(
          (input.where?.verifiedEmailLookupKey as { in?: unknown[] } | undefined)?.in,
        )
          ? (input.where?.verifiedEmailLookupKey as { in: unknown[] }).in
          : [];
        const [lookupKey] = lookupKeys;
        const record = await hostedMemberEmailAuthorization?.findUnique?.({
          select: input.select,
          where: {
            ...(typeof lookupKey === "string"
              ? {
                  verifiedEmailLookupKey: lookupKey,
                }
              : {}),
          },
        });
        return record ? [record] : [];
      }),
    });
  }

  if (!("$queryRaw" in prismaWithQueryRaw)) {
    Object.defineProperty(prismaWithQueryRaw, "$queryRaw", {
      configurable: true,
      value: vi.fn(async () => []),
    });
  }
  if (!("hostedAccountGroupMembership" in prismaWithQueryRaw)) {
    Object.defineProperty(prismaWithQueryRaw, "hostedAccountGroupMembership", {
      configurable: true,
      value: {
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
      },
    });
  }
  if (!("$executeRaw" in prismaWithQueryRaw)) {
    Object.defineProperty(prismaWithQueryRaw, "$executeRaw", {
      configurable: true,
      value: vi.fn(async () => 0),
    });
  }
  if (!("$transaction" in prismaWithQueryRaw)) {
    Object.defineProperty(prismaWithQueryRaw, "$transaction", {
      configurable: true,
      value: vi.fn(async (callback: (transaction: CompleteHostedPrivyVerificationPrisma) => Promise<unknown>) =>
        callback(prismaWithQueryRaw)),
    });
  }
  return prismaWithQueryRaw;
}

function readHostedInviteDelegate(value: unknown): HostedInviteDelegate | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const findUnique: HostedInviteDelegate["findUnique"] | undefined = Reflect.get(value, "findUnique");
  return typeof findUnique === "function"
    ? {
        findUnique,
      }
    : undefined;
}

function readHostedMemberDelegate(value: unknown): HostedMemberDelegate | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const create: HostedMemberDelegate["create"] | undefined = Reflect.get(value, "create");
  const findUnique: HostedMemberDelegate["findUnique"] | undefined = Reflect.get(value, "findUnique");
  const update: HostedMemberDelegate["update"] | undefined = Reflect.get(value, "update");
  const updateMany: HostedMemberDelegate["updateMany"] | undefined = Reflect.get(value, "updateMany");

  return {
    ...(typeof create === "function"
      ? {
          create,
        }
      : {}),
    ...(typeof findUnique === "function"
      ? {
          findUnique,
        }
      : {}),
    ...(typeof update === "function"
      ? {
          update,
        }
      : {}),
    ...(typeof updateMany === "function"
      ? {
          updateMany,
        }
      : {}),
  };
}

function readHostedMemberRoutingDelegate(value: unknown): HostedMemberRoutingDelegate | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const findMany: HostedMemberRoutingDelegate["findMany"] | undefined = Reflect.get(value, "findMany");
  const findFirst: HostedMemberRoutingDelegate["findFirst"] | undefined = Reflect.get(value, "findFirst");
  const findUnique: HostedMemberRoutingDelegate["findUnique"] | undefined = Reflect.get(value, "findUnique");
  const upsert: HostedMemberRoutingDelegate["upsert"] | undefined = Reflect.get(value, "upsert");

  return {
    ...(typeof findMany === "function"
      ? {
          findMany,
        }
      : {}),
    ...(typeof findFirst === "function"
      ? {
          findFirst,
        }
      : {}),
    ...(typeof findUnique === "function"
      ? {
          findUnique,
        }
      : {}),
    ...(typeof upsert === "function"
      ? {
          upsert,
        }
      : {}),
  };
}

function readHostedMemberEmailAuthorizationDelegate(
  value: unknown,
): HostedMemberEmailAuthorizationDelegate | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const findUnique: HostedMemberEmailAuthorizationDelegate["findUnique"] | undefined =
    Reflect.get(value, "findUnique");
  const findMany: HostedMemberEmailAuthorizationDelegate["findMany"] | undefined =
    Reflect.get(value, "findMany");
  const upsert: HostedMemberEmailAuthorizationDelegate["upsert"] | undefined =
    Reflect.get(value, "upsert");

  return {
    ...(typeof findMany === "function"
      ? {
          findMany,
        }
      : {}),
    ...(typeof findUnique === "function"
      ? {
          findUnique,
        }
      : {}),
    ...(typeof upsert === "function"
      ? {
          upsert,
        }
      : {}),
  };
}

async function projectHostedMemberFindUniqueResult(input: {
  include?: HostedMemberFindUniqueInclude;
  member: Record<string, unknown>;
  routingRecordsByMemberId: Map<string, Record<string, unknown>>;
  select?: HostedMemberFindUniqueSelect;
}) {
  const memberId = typeof input.member.id === "string" ? input.member.id : null;
  const identity = isPlainRecord(input.member.identity)
    ? input.member.identity
    : await readMemberIdentity(input.member);
  const routing = isPlainRecord(input.member.routing)
    ? input.member.routing
    : memberId
      ? input.routingRecordsByMemberId.get(memberId) ?? null
      : null;

  if (input.select?.identity || input.select?.routing) {
    return {
      ...(input.select.identity
        ? {
            identity,
          }
        : {}),
      ...(input.select.routing
        ? {
            routing,
          }
        : {}),
    };
  }

  if (input.select) {
    return input.member;
  }

  return {
    ...input.member,
    ...(input.include?.billingRef
      ? {
          billingRef: input.member.billingRef ?? null,
        }
      : {}),
    ...(input.include?.identity
      ? {
          identity,
        }
      : {}),
    ...(input.include?.routing
      ? {
          routing,
        }
      : {}),
  };
}

async function readMemberIdentity(member: unknown) {
  if (!isPlainRecord(member)) {
    return null;
  }

  const record = member;
  const identity =
    isPlainRecord(record.identity)
      ? record.identity
      : record;

  const memberId =
    typeof identity.memberId === "string"
      ? identity.memberId
      : typeof record.id === "string"
        ? record.id
        : null;
  const phoneLookupKey =
    typeof identity.phoneLookupKey === "string" ? identity.phoneLookupKey : null;

  if (!memberId) {
    return null;
  }

  const phoneNumber = phoneLookupKey === null
    ? null
    : phoneLookupKey === SECONDARY_PHONE_LOOKUP_KEY
      ? SECONDARY_PHONE_NUMBER
      : DEFAULT_PHONE_NUMBER;

  return {
    createdAt: identity.createdAt instanceof Date ? identity.createdAt : NOW,
    maskedPhoneNumberHint:
      typeof identity.maskedPhoneNumberHint === "string"
        ? identity.maskedPhoneNumberHint
        : phoneLookupKey
          ? "*** 4567"
          : null,
    memberId,
    phoneNumberEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId,
      value: phoneNumber,
    }),
    phoneLookupKey,
    phoneNumberVerifiedAt:
      identity.phoneNumberVerifiedAt instanceof Date ? identity.phoneNumberVerifiedAt : null,
    privyUserIdEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.privy-user-id",
      memberId,
      value: typeof identity.privyUserId === "string" ? identity.privyUserId : null,
    }),
    privyUserLookupKey:
      typeof identity.privyUserId === "string"
        ? createHostedPrivyUserLookupKey(identity.privyUserId)
        : null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumberEncrypted: null,
    updatedAt: identity.updatedAt instanceof Date ? identity.updatedAt : NOW,
    walletAddressEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.wallet-address",
      memberId,
      value: typeof identity.walletAddress === "string" ? identity.walletAddress : null,
    }),
    walletAddressLookupKey:
      typeof identity.walletAddress === "string"
        ? createHostedWalletAddressLookupKey(identity.walletAddress)
        : null,
    walletChainType: typeof identity.walletChainType === "string" ? identity.walletChainType : null,
    walletCreatedAt: identity.walletCreatedAt instanceof Date ? identity.walletCreatedAt : null,
    walletProvider: typeof identity.walletProvider === "string" ? identity.walletProvider : null,
  };
}
