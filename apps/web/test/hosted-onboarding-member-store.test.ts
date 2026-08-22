import {
  Prisma,
  type HostedMember,
  HostedBillingStatus,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  createHostedEmailLookupKeyReadCandidates,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberRoutingTelegramPrivateState,
} from "@/src/lib/hosted-onboarding/member-private-codecs";

import {
  claimHostedMemberSignupNotificationEmailAttempt,
  composeHostedMemberSnapshot,
  createHostedMember as createHostedMemberStore,
  hostedMemberVerifiedEmailRecordsEqual,
  lockHostedMemberVerifiedEmailRecordTx,
  lookupHostedMemberByVerifiedEmailAddress,
  prepareHostedMemberVerifiedEmailReplyAlias,
  projectHostedMemberVerifiedEmailRecord,
  readHostedMemberEmailSnapshots,
  readHostedMemberMessagingSetupState,
  readHostedMemberSnapshot,
  readHostedMemberVerifiedEmailRecord,
  readHostedMemberVerifiedEmailSnapshots,
  type HostedMemberCoreState,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  activeHostedMemberAccessWhere,
} from "@/src/lib/hosted-onboarding/member-access";
import {
  bindHostedMemberStripeCustomerIdIfMissingTx,
  lookupHostedMemberStripeBillingRefByStripeCustomerId,
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
  readHostedMemberBillingEligibilityState,
  readHostedMemberStripeBillingRef,
  type HostedMemberStripeBillingRefSnapshot,
  writeHostedMemberStripeBillingRefTx,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  lookupHostedMemberIdentityByPhoneLookupKey,
  lookupHostedMemberIdentityByPhoneNumber,
  lookupHostedMemberIdByPhoneNumber,
  lookupHostedMemberIdentityByPrivyUserId,
  type HostedMemberIdentityState,
  upsertHostedMemberIdentity,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import {
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  demoteHostedMemberLinqGroupChatBindingsTx,
  lookupHostedMemberCoreByPendingLinqParticipantContact,
  lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberRoutingByPendingLinqParticipantContact,
  lookupHostedMemberRoutingByTelegramUserId,
  lookupHostedMemberRoutingByTelegramUserLookupKey,
  readHostedMemberIdByReplyAliasLookupKey,
  readHostedMemberRoutingState,
  resolveHostedMemberReplyAliasRegistrationTx,
  resolveHostedMemberCoreByTelegramUserId,
  type HostedMemberRoutingStateSnapshot,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx,
  upsertHostedMemberReplyAliasLookupKeyTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
  upsertHostedMemberPendingLinqParticipantContactTx,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/hosted-crypto/domain-root-store")>();
  return {
    ...actual,
    provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn().mockResolvedValue(undefined),
  };
});

const TEST_CONTACT_PRIVACY_KEY = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";
const TEST_CONTACT_PRIVACY_ROTATED_KEY = Buffer.alloc(32, 1).toString("base64");
const LEGACY_TELEGRAM_PRIVATE_STATE_SCHEMA = "murph.hosted-member-routing.telegram.v1";

function createMemberRowLockQueryRaw() {
  return vi.fn().mockImplementation((
    _query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise.resolve([{ id: values.at(-1) }]));
}

describe("hosted-member-store", () => {
  const previousHostedContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousHostedContactPrivacyCurrentKeyVersion =
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  beforeEach(() => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v1",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
      },
    });
    vi.clearAllMocks();
  });

  it("claims signup notification attempts through canonical active access", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const attemptedAt = new Date("2026-08-20T12:00:00.000Z");

    await expect(claimHostedMemberSignupNotificationEmailAttempt({
      attemptedAt,
      memberId: "member_123",
      prisma: {
        hostedMember: { updateMany },
      } as never,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        signupNotificationEmailAttemptedAt: attemptedAt,
      },
      where: {
        ...activeHostedMemberAccessWhere(),
        id: "member_123",
        signupNotificationEmailAttemptedAt: null,
      },
    });
  });

  afterEach(() => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousHostedContactPrivacyKeys);
    restoreEnvValue(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      previousHostedContactPrivacyCurrentKeyVersion,
    );
    clearHostedOnboardingEnvCache();
  });

  it("creates current-version members with explicitly pending onboarding", async () => {
    const create = vi.fn().mockResolvedValue({
      billingStatus: HostedBillingStatus.incomplete,
      createdAt: new Date("2026-08-04T12:00:00.000Z"),
      id: "member_new_onboarding",
      suspendedAt: null,
      updatedAt: new Date("2026-08-04T12:00:00.000Z"),
    });

    await createHostedMemberStore({
      billingStatus: HostedBillingStatus.incomplete,
      memberId: "member_new_onboarding",
      prisma: { hostedMember: { create } } as never,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "member_new_onboarding",
        initialOnboardingCompletedAt: null,
      }),
    }));
  });

  it("keeps identity, routing, and billing refs nested under their owning slices", () => {
    const core: HostedMemberCoreState = {
      billingStatus: HostedBillingStatus.incomplete,
      createdAt: new Date("2026-04-07T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-07T00:05:00.000Z"),
    };
    const identity: HostedMemberIdentityState = {
      maskedPhoneNumberHint: "+1 **** 1234",
      memberId: core.id,
      phoneNumber: "+15551234",
      phoneLookupKey: "phone_lookup_123",
      phoneNumberVerifiedAt: new Date("2026-04-07T00:02:00.000Z"),
      privyUserId: "did:privy:member_123",
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: "+15551234",
      walletAddress: "0x1234",
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2026-04-07T00:03:00.000Z"),
      walletProvider: "privy",
    };
    const routing: HostedMemberRoutingStateSnapshot = {
      linqChatId: "linq_chat_123",
      linqHomeLineAssignedAt: null,
      linqRecipientPhone: null,
      memberId: core.id,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: "telegram_lookup_123",
    };
    const billingRef: HostedMemberStripeBillingRefSnapshot = {
      memberId: core.id,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };

    const snapshot = composeHostedMemberSnapshot(core, {
      billingRef,
      identity,
      routing,
    });

    expect(snapshot).toEqual({
      billingRef,
      core,
      identity,
      routing,
    });
    expect(Object.keys(snapshot).sort()).toEqual([
      "billingRef",
      "core",
      "identity",
      "routing",
    ]);
    expect("phoneLookupKey" in snapshot).toBe(false);
    expect("linqChatId" in snapshot).toBe(false);
    expect("stripeCustomerId" in snapshot).toBe(false);
    expect(snapshot.identity?.phoneLookupKey).toBe(identity.phoneLookupKey);
    expect(snapshot.routing?.linqChatId).toBe(routing.linqChatId);
    expect(snapshot.billingRef?.stripeSubscriptionId).toBe(billingRef.stripeSubscriptionId);
  });

  it("looks up verified email members across readable blind-index versions", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const address = "Member@example.test";
    const lookupKeys = createHostedEmailLookupKeyReadCandidates(address);
    const member = createHostedMember({
      id: "member_email",
    });
    const findMany = vi.fn().mockResolvedValue([
      {
        directPublicSenderAddressEncrypted: null,
        directPublicSenderAuthorizedAt: null,
        directPublicSenderLookupKey: null,
        member,
        memberId: member.id,
        stripeCheckoutEmailAddressEncrypted: null,
        stripeCheckoutEmailCollectedAt: null,
        verifiedEmailAddressEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-email-authorization.verified-email",
          memberId: member.id,
          value: address.toLowerCase(),
        }),
        verifiedEmailLookupKey: lookupKeys.find((key) => key.includes(":v1:")) ?? null,
        verifiedEmailVerifiedAt: new Date("2026-04-07T01:00:00.000Z"),
      },
    ]);
    const prisma = {
      hostedMemberEmailAuthorization: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberByVerifiedEmailAddress({
        address,
        prisma,
      }),
    ).resolves.toMatchObject({
      core: {
        id: "member_email",
      },
      emailAuthorization: {
        memberId: "member_email",
        verifiedEmail: {
          address: "member@example.test",
        },
      },
      matchedBy: "verifiedEmail",
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        verifiedEmailLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:email:v2:/u),
            expect.stringMatching(/^hbidx:email:v1:/u),
          ]),
        },
        verifiedEmailVerifiedAt: {
          not: null,
        },
      },
    }));
  });

  it("reads bounded member email snapshots in one query and decrypts recipients", async () => {
    const member = createHostedMember({ id: "member_email_snapshot" });
    const address = "member@example.test";
    const findMany = vi.fn().mockResolvedValue([{
      ...member,
      emailAuthorization: {
        directPublicSenderAddressEncrypted: null,
        directPublicSenderAuthorizedAt: null,
        directPublicSenderLookupKey: null,
        memberId: member.id,
        stripeCheckoutEmailAddressEncrypted: null,
        stripeCheckoutEmailCollectedAt: null,
        verifiedEmailAddressEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-email-authorization.verified-email",
          memberId: member.id,
          value: address,
        }),
        verifiedEmailLookupKey: "hbidx:email:v1:snapshot",
        verifiedEmailVerifiedAt: new Date("2026-07-15T12:00:00.000Z"),
      },
    }]);
    const prisma = {
      hostedMember: { findMany },
    } as never;

    await expect(readHostedMemberEmailSnapshots({
      memberIds: [member.id, "member_missing"],
      prisma,
    })).resolves.toEqual([{
      core: {
        billingStatus: member.billingStatus,
        createdAt: member.createdAt,
        id: member.id,
        suspendedAt: member.suspendedAt,
        updatedAt: member.updatedAt,
      },
      emailAuthorization: {
        directPublicSender: null,
        memberId: member.id,
        stripeCheckoutEmail: null,
        verifiedEmail: {
          address,
          lookupKey: "hbidx:email:v1:snapshot",
          verifiedAt: new Date("2026-07-15T12:00:00.000Z"),
        },
      },
    }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: {
          in: [member.id, "member_missing"],
        },
      },
    }));
  });

  it("reads verified emails for a member set with one narrow query", async () => {
    const memberId = "member_verified_email_batch";
    const verifiedAt = new Date("2026-07-15T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{
      memberId,
      verifiedEmailAddressEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-email-authorization.verified-email",
        memberId,
        value: "batch@example.test",
      }),
      verifiedEmailLookupKey: "hbidx:email:v1:batch",
      verifiedEmailVerifiedAt: verifiedAt,
    }]);
    const prisma = {
      hostedMemberEmailAuthorization: { findMany },
    } as never;

    await expect(readHostedMemberVerifiedEmailSnapshots({
      memberIds: [memberId, memberId, "member_missing"],
      prisma,
    })).resolves.toEqual([{
      memberId,
      verifiedEmail: {
        address: "batch@example.test",
        lookupKey: "hbidx:email:v1:batch",
        verifiedAt,
      },
    }]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        memberId: {
          in: [memberId, "member_missing"],
        },
      },
      select: {
        memberId: true,
        verifiedEmailAddressEncrypted: true,
        verifiedEmailLookupKey: true,
        verifiedEmailVerifiedAt: true,
      },
    });
  });

  it("reads, projects, compares, and locks the exact verified-email owner record", async () => {
    const memberId = "member_verified_email_owner";
    const verifiedAt = new Date("2026-07-15T12:00:00.000Z");
    const record = {
      memberId,
      verifiedEmailAddressEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-email-authorization.verified-email",
        memberId,
        value: "owner@example.test",
      }),
      verifiedEmailLookupKey: "hbidx:email:v1:owner",
      verifiedEmailVerifiedAt: verifiedAt,
    };
    const findUnique = vi.fn().mockResolvedValue(record);
    const queryRaw = createMemberRowLockQueryRaw();
    const prisma = {
      $queryRaw: queryRaw,
      hostedMemberEmailAuthorization: { findUnique },
    } as never;

    await expect(readHostedMemberVerifiedEmailRecord({
      memberId,
      prisma,
    })).resolves.toEqual(record);
    await expect(projectHostedMemberVerifiedEmailRecord(
      record,
      prisma,
    )).resolves.toEqual({
      memberId,
      verifiedEmail: {
        address: "owner@example.test",
        lookupKey: "hbidx:email:v1:owner",
        verifiedAt,
      },
    });
    expect(hostedMemberVerifiedEmailRecordsEqual(record, {
      ...record,
      verifiedEmailVerifiedAt: new Date(verifiedAt),
    })).toBe(true);
    expect(hostedMemberVerifiedEmailRecordsEqual(record, {
      ...record,
      verifiedEmailLookupKey: "hbidx:email:v1:changed",
    })).toBe(false);
    await expect(lockHostedMemberVerifiedEmailRecordTx({
      memberId,
      prisma,
    })).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith({
      where: { memberId },
      select: {
        memberId: true,
        verifiedEmailAddressEncrypted: true,
        verifiedEmailLookupKey: true,
        verifiedEmailVerifiedAt: true,
      },
    });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw.mock.calls[0]?.[0].join(" ")).toContain(
      'FROM "hosted_member_email_authorization"',
    );
    expect(queryRaw.mock.calls[0]?.[1]).toBe(memberId);
  });

  it("fails closed when verified email read candidates match multiple members", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        directPublicSenderAddressEncrypted: null,
        directPublicSenderAuthorizedAt: null,
        directPublicSenderLookupKey: null,
        member: createHostedMember({ id: "member_email_one" }),
        memberId: "member_email_one",
        stripeCheckoutEmailAddressEncrypted: null,
        stripeCheckoutEmailCollectedAt: null,
        verifiedEmailAddressEncrypted: null,
        verifiedEmailLookupKey: "hbidx:email:v1:one",
        verifiedEmailVerifiedAt: new Date("2026-04-07T01:00:00.000Z"),
      },
      {
        directPublicSenderAddressEncrypted: null,
        directPublicSenderAuthorizedAt: null,
        directPublicSenderLookupKey: null,
        member: createHostedMember({ id: "member_email_two" }),
        memberId: "member_email_two",
        stripeCheckoutEmailAddressEncrypted: null,
        stripeCheckoutEmailCollectedAt: null,
        verifiedEmailAddressEncrypted: null,
        verifiedEmailLookupKey: "hbidx:email:v2:two",
        verifiedEmailVerifiedAt: new Date("2026-04-07T01:05:00.000Z"),
      },
    ]);
    const prisma = {
      hostedMemberEmailAuthorization: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberByVerifiedEmailAddress({
        address: "member@example.test",
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS",
      httpStatus: 500,
      retryable: true,
    });
  });

  it("looks up identity by privy user id without exposing blind-index columns", async () => {
    const member = createHostedMember();
    const findMany = vi.fn().mockResolvedValue([
      {
        maskedPhoneNumberHint: "*** 4567",
        member,
        memberId: member.id,
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        privyUserIdEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-identity.privy-user-id",
          memberId: member.id,
          value: "did:privy:user_123",
        }),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
        walletAddressEncrypted: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
    ]);
    const prisma = {
      hostedMemberIdentity: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberIdentityByPrivyUserId({
        prisma,
        privyUserId: "did:privy:user_123",
      }),
    ).resolves.toEqual({
      core: member,
      identity: expect.objectContaining({
        memberId: member.id,
        phoneNumber: null,
        privyUserId: "did:privy:user_123",
      }),
      matchedBy: "privyUserId",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        privyUserLookupKey: {
          in: [expect.stringMatching(/^hbidx:privy-user:v1:/u)],
        },
      },
      include: {
        member: true,
      },
    });
  });

  it("looks up only core member state for a Privy principal without decrypting identity fields", async () => {
    const member = createHostedMember();
    const core = {
      billingStatus: member.billingStatus,
      createdAt: member.createdAt,
      id: member.id,
      suspendedAt: member.suspendedAt,
      updatedAt: member.updatedAt,
    };
    const findMany = vi.fn().mockResolvedValue([{ memberId: member.id, member: core }]);
    const prisma = {
      hostedMemberIdentity: { findMany },
    } as never;

    await expect(lookupHostedMemberIdentityByPrivyUserId({
      prisma,
      privyUserId: "did:privy:user_123",
      projection: "core",
    })).resolves.toEqual({
      core,
      matchedBy: "privyUserId",
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        privyUserLookupKey: {
          in: [expect.stringMatching(/^hbidx:privy-user:v1:/u)],
        },
      },
      select: {
        memberId: true,
        member: {
          select: {
            billingStatus: true,
            createdAt: true,
            id: true,
            suspendedAt: true,
            updatedAt: true,
          },
        },
      },
    });
  });

  it("looks up identity by phone lookup key without returning the lookup key", async () => {
    const member = createHostedMember();
    const prisma = {
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          maskedPhoneNumberHint: "*** 4567",
          member,
          memberId: member.id,
          phoneLookupKey: "hbidx:phone:v1:abc123",
          phoneNumberVerifiedAt: null,
          privyUserIdEncrypted: null,
          signupPhoneCodeSendAttemptId: null,
          signupPhoneCodeSendAttemptStartedAt: null,
          signupPhoneCodeSentAt: null,
          signupPhoneNumberEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-identity.signup-phone-number",
            memberId: member.id,
            value: "+15551234567",
          }),
          walletAddressEncrypted: null,
          walletChainType: null,
          walletCreatedAt: null,
          walletProvider: null,
        }),
      },
    } as never;

    await expect(
      lookupHostedMemberIdentityByPhoneLookupKey({
        phoneLookupKey: "hbidx:phone:v1:abc123",
        prisma,
      }),
    ).resolves.toEqual({
      core: member,
      identity: {
        maskedPhoneNumberHint: "*** 4567",
        memberId: member.id,
        phoneNumber: null,
        phoneNumberVerifiedAt: null,
        privyUserId: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: "+15551234567",
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      matchedBy: "phoneLookupKey",
    });
  });

  it("looks up identity by raw phone number through read candidates", async () => {
    const member = createHostedMember();
    const findMany = vi.fn().mockResolvedValue([
      {
        maskedPhoneNumberHint: "*** 4567",
        member,
        memberId: member.id,
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        privyUserIdEncrypted: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
        walletAddressEncrypted: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
    ]);
    const prisma = {
      hostedMemberIdentity: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber: "+15551234567",
        prisma,
      }),
    ).resolves.toEqual({
      core: member,
      identity: expect.not.objectContaining({
        phoneLookupKey: expect.anything(),
      }),
      matchedBy: "phoneNumber",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        phoneLookupKey: {
          in: [expect.stringMatching(/^hbidx:phone:v1:/u)],
        },
      },
      include: {
        member: true,
      },
    });
  });

  it("reads only blind-index ownership when private identity projection is unnecessary", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { memberId: "member_phone_owner" },
    ]);
    const prisma = {
      hostedMemberIdentity: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberIdByPhoneNumber({
        phoneNumber: "+15551234567",
        prisma,
      }),
    ).resolves.toBe("member_phone_owner");

    expect(findMany).toHaveBeenCalledWith({
      where: {
        phoneLookupKey: {
          in: [expect.stringMatching(/^hbidx:phone:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
  });

  it("fails closed when rotated Privy user lookup candidates resolve to multiple members", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const firstMember = createHostedMember({
      id: "member_v1",
    });
    const secondMember = createHostedMember({
      billingStatus: HostedBillingStatus.active,
      id: "member_v2",
    });
    const findMany = vi.fn().mockResolvedValue([
      {
        maskedPhoneNumberHint: null,
        member: firstMember,
        memberId: firstMember.id,
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
        privyUserIdEncrypted: null,
        privyUserLookupKey: "hbidx:privy-user:v1:abc123",
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
        walletAddressEncrypted: null,
        walletAddressLookupKey: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      {
        maskedPhoneNumberHint: null,
        member: secondMember,
        memberId: secondMember.id,
        phoneLookupKey: null,
        phoneNumberVerifiedAt: null,
        privyUserIdEncrypted: null,
        privyUserLookupKey: "hbidx:privy-user:v2:def456",
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
        walletAddressEncrypted: null,
        walletAddressLookupKey: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
    ]);
    const prisma = {
      hostedMemberIdentity: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberIdentityByPrivyUserId({
        prisma,
        privyUserId: "did:privy:user_123",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: 2,
        matchedBy: "privyUserId",
      },
      httpStatus: 500,
      retryable: true,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        privyUserLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:privy-user:v2:/u),
            expect.stringMatching(/^hbidx:privy-user:v1:/u),
          ]),
        },
      },
      include: {
        member: true,
      },
    });
  });

  it("looks up routing by Telegram lookup key without exposing the blind index", async () => {
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-routing.home-linq-chat-id",
            memberId: "member_123",
            value: "chat_123",
          }),
          linqRecipientPhoneEncrypted: null,
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_123",
            suspendedAt: null,
          },
          memberId: "member_123",
          pendingLinqChatIdEncrypted: null,
          pendingLinqRecipientPhoneEncrypted: null,
          telegramUserIdEncrypted: null,
          telegramUserLookupKey: "hbidx:telegram-user:v1:abc123",
        }),
      },
    } as never;

    await expect(
      lookupHostedMemberRoutingByTelegramUserLookupKey({
        prisma,
        telegramUserLookupKey: "tg_user_123",
      }),
    ).resolves.toEqual({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
      matchedBy: "telegramUserLookupKey",
      routing: {
        hasTelegramUserBinding: true,
        linqChatId: "chat_123",
        memberId: "member_123",
      },
    });
  });

  it("looks up routing by raw Telegram user id through read candidates", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      linqChatIdEncrypted: null,
      linqRecipientPhoneEncrypted: null,
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: "hbidx:telegram-user:v1:abc123",
    }]);
    const prisma = {
      hostedMemberRouting: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberRoutingByTelegramUserId({
        prisma,
        telegramUserId: "456",
      }),
    ).resolves.toEqual({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
      matchedBy: "telegramUserId",
      routing: {
        hasTelegramUserBinding: true,
        linqChatId: null,
        memberId: "member_123",
      },
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        telegramUserLookupKey: {
          in: expect.arrayContaining([expect.stringMatching(/^hbidx:telegram-user:v1:/u)]),
        },
      },
      select: {
        linqChatIdEncrypted: true,
        linqChatLookupKey: true,
        linqHomeLineAssignedAt: true,
        linqParticipantContactKind: true,
        linqParticipantContactLookupKey: true,
        linqRecipientPhoneEncrypted: true,
        linqRecipientPhoneLookupKey: true,
        member: {
          select: {
            billingStatus: true,
            createdAt: true,
            id: true,
            suspendedAt: true,
            updatedAt: true,
          },
        },
        memberId: true,
        pendingLinqChatIdEncrypted: true,
        pendingLinqChatLookupKey: true,
        pendingLinqParticipantContactEncrypted: true,
        pendingLinqParticipantContactKind: true,
        pendingLinqParticipantContactLookupKey: true,
        pendingLinqParticipantContactObservedAt: true,
        pendingLinqRecipientPhoneEncrypted: true,
        pendingLinqRecipientPhoneLookupKey: true,
        replyAliasLookupKey: true,
        telegramUserLookupKey: true,
        telegramUserIdEncrypted: true,
      },
    });
  });

  it("resolves Telegram sender core without selecting encrypted routing state", async () => {
    const createdAt = new Date("2026-08-10T00:00:00.000Z");
    const updatedAt = new Date("2026-08-10T01:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{
      member: {
        billingStatus: HostedBillingStatus.active,
        createdAt,
        id: "member_123",
        suspendedAt: null,
        updatedAt,
      },
      memberId: "member_123",
    }]);

    await expect(resolveHostedMemberCoreByTelegramUserId({
      prisma: {
        hostedMemberRouting: { findMany },
      } as never,
      telegramUserId: "456",
    })).resolves.toEqual({
      core: {
        billingStatus: HostedBillingStatus.active,
        createdAt,
        id: "member_123",
        suspendedAt: null,
        updatedAt,
      },
      status: "found",
    });

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      select: {
        member: {
          select: {
            billingStatus: true,
            createdAt: true,
            id: true,
            suspendedAt: true,
            updatedAt: true,
          },
        },
        memberId: true,
      },
      where: {
        telegramUserLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:telegram-user:v1:/u),
          ]),
        },
      },
    });
  });

  it("resolves pending Linq sender core without selecting encrypted routing state", async () => {
    const createdAt = new Date("2026-08-10T00:00:00.000Z");
    const updatedAt = new Date("2026-08-10T01:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{
      member: {
        billingStatus: HostedBillingStatus.active,
        createdAt,
        id: "member_pending",
        suspendedAt: null,
        updatedAt,
      },
      memberId: "member_pending",
    }]);

    await expect(lookupHostedMemberCoreByPendingLinqParticipantContact({
      contact: {
        kind: "phone",
        lookupKey: "hbidx:phone:v1:pending-participant",
        value: "+15555550123",
      },
      linqChatId: "chat_pending",
      prisma: {
        hostedMemberRouting: { findMany },
      } as never,
      recipientPhone: "+15555550999",
    })).resolves.toMatchObject({ id: "member_pending" });

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      select: {
        member: {
          select: {
            billingStatus: true,
            createdAt: true,
            id: true,
            suspendedAt: true,
            updatedAt: true,
          },
        },
        memberId: true,
      },
      where: {
        pendingLinqChatLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:linq-chat:v1:/u),
          ]),
        },
        pendingLinqParticipantContactLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:phone:v1:/u),
          ]),
        },
        pendingLinqRecipientPhoneLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:phone:v1:/u),
          ]),
        },
      },
    });
  });

  it("fails closed when pending Linq contact candidates resolve to multiple members", async () => {
    const createdAt = new Date("2026-08-10T00:00:00.000Z");
    const updatedAt = new Date("2026-08-10T01:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        member: {
          billingStatus: HostedBillingStatus.active,
          createdAt,
          id: "member_pending_a",
          suspendedAt: null,
          updatedAt,
        },
        memberId: "member_pending_a",
      },
      {
        member: {
          billingStatus: HostedBillingStatus.active,
          createdAt,
          id: "member_pending_b",
          suspendedAt: null,
          updatedAt,
        },
        memberId: "member_pending_b",
      },
    ]);

    await expect(lookupHostedMemberCoreByPendingLinqParticipantContact({
      contact: {
        kind: "phone",
        lookupKey: "hbidx:phone:v1:pending-participant",
        value: "+15555550123",
      },
      prisma: {
        hostedMemberRouting: { findMany },
      } as never,
    })).rejects.toMatchObject({
      code: "LINQ_PENDING_CONTACT_ROUTING_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: 2,
        matchedBy: "pendingLinqParticipantContactLookupKey",
      },
    });
  });

  it("fails closed when raw Telegram user id resolves to multiple members across read candidates", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const findMany = vi.fn().mockResolvedValue([
      {
        linqChatIdEncrypted: null,
        linqHomeLineAssignedAt: null,
        linqRecipientPhoneEncrypted: null,
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_v1",
          suspendedAt: null,
        },
        memberId: "member_v1",
        pendingLinqChatIdEncrypted: null,
        pendingLinqRecipientPhoneEncrypted: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: "hbidx:telegram-user:v1:abc123",
      },
      {
        linqChatIdEncrypted: null,
        linqHomeLineAssignedAt: null,
        linqRecipientPhoneEncrypted: null,
        member: {
          billingStatus: HostedBillingStatus.incomplete,
          id: "member_v2",
          suspendedAt: null,
        },
        memberId: "member_v2",
        pendingLinqChatIdEncrypted: null,
        pendingLinqRecipientPhoneEncrypted: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: "hbidx:telegram-user:v2:def456",
      },
    ]);
    const prisma = {
      hostedMemberRouting: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberRoutingByTelegramUserId({
        prisma,
        telegramUserId: "456",
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_ROUTING_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: 2,
      },
      httpStatus: 500,
      retryable: true,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        telegramUserLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:telegram-user:v2:/u),
            expect.stringMatching(/^hbidx:telegram-user:v1:/u),
          ]),
        },
      },
      select: {
        linqChatIdEncrypted: true,
        linqChatLookupKey: true,
        linqHomeLineAssignedAt: true,
        linqParticipantContactKind: true,
        linqParticipantContactLookupKey: true,
        linqRecipientPhoneEncrypted: true,
        linqRecipientPhoneLookupKey: true,
        member: {
          select: {
            billingStatus: true,
            createdAt: true,
            id: true,
            suspendedAt: true,
            updatedAt: true,
          },
        },
        memberId: true,
        pendingLinqChatIdEncrypted: true,
        pendingLinqChatLookupKey: true,
        pendingLinqParticipantContactEncrypted: true,
        pendingLinqParticipantContactKind: true,
        pendingLinqParticipantContactLookupKey: true,
        pendingLinqParticipantContactObservedAt: true,
        pendingLinqRecipientPhoneEncrypted: true,
        pendingLinqRecipientPhoneLookupKey: true,
        replyAliasLookupKey: true,
        telegramUserLookupKey: true,
        telegramUserIdEncrypted: true,
      },
    });
  });

  it("reads member routing state from routing lookup keys plus encrypted local columns", async () => {
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-routing.home-linq-chat-id",
            memberId: "member_123",
            value: "chat_123",
          }),
          linqChatLookupKey: "hbidx:linq-chat:v1:abc123",
          linqParticipantContactKind: "email",
          linqParticipantContactLookupKey: "hbidx:email:v1:home-participant",
          linqRecipientPhoneEncrypted: null,
          memberId: "member_123",
          pendingLinqChatIdEncrypted: null,
          pendingLinqRecipientPhoneEncrypted: null,
          telegramUserIdEncrypted: null,
          telegramUserLookupKey: "tg_user_123",
        }),
      },
    } as never;

    await expect(
      readHostedMemberRoutingState({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      hasPendingLinqRouteState: false,
      linqChatId: "chat_123",
      linqChatLookupKey: "hbidx:linq-chat:v1:abc123",
      linqParticipantContact: {
        kind: "email",
        lookupKey: "hbidx:email:v1:home-participant",
      },
      linqRecipientPhone: null,
      linqRecipientPhoneLookupKey: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: "tg_user_123",
    });
  });

  it("reads a persisted Telegram thread target alongside the raw Telegram user id", async () => {
    const telegramPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: "456:business:biz-42:dm-topic:9",
      telegramUserId: "456",
    });
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: null,
          linqRecipientPhoneEncrypted: null,
          memberId: "member_123",
          pendingLinqChatIdEncrypted: null,
          pendingLinqRecipientPhoneEncrypted: null,
          telegramUserIdEncrypted: telegramPrivateColumns.telegramUserIdEncrypted,
          telegramUserLookupKey: "tg_user_456",
        }),
      },
    } as never;

    await expect(
      readHostedMemberRoutingState({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      hasPendingLinqRouteState: false,
      linqChatId: null,
      linqChatLookupKey: null,
      linqRecipientPhone: null,
      linqRecipientPhoneLookupKey: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: "456:business:biz-42:dm-topic:9",
      telegramUserId: "456",
      telegramUserLookupKey: "tg_user_456",
    });
  });

  it("does not project a Telegram identity-only binding as a direct thread target", async () => {
    const telegramPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: "456",
    });
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: null,
          linqRecipientPhoneEncrypted: null,
          memberId: "member_123",
          pendingLinqChatIdEncrypted: null,
          pendingLinqRecipientPhoneEncrypted: null,
          telegramUserIdEncrypted: telegramPrivateColumns.telegramUserIdEncrypted,
          telegramUserLookupKey: "tg_user_456",
        }),
      },
    } as never;

    await expect(
      readHostedMemberRoutingState({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      hasPendingLinqRouteState: false,
      linqChatId: null,
      linqChatLookupKey: null,
      linqRecipientPhone: null,
      linqRecipientPhoneLookupKey: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: "456",
      telegramUserLookupKey: "tg_user_456",
    });
  });

  it("preserves legacy Telegram user lookup and valid direct thread targets", async () => {
    const telegramUserIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: JSON.stringify({
        schema: LEGACY_TELEGRAM_PRIVATE_STATE_SCHEMA,
        telegramThreadId: "456:business:biz-42:dm-topic:9",
        telegramUserId: "456",
      }),
    });
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: null,
          linqRecipientPhoneEncrypted: null,
          memberId: "member_123",
          pendingLinqChatIdEncrypted: null,
          pendingLinqRecipientPhoneEncrypted: null,
          telegramUserIdEncrypted,
          telegramUserLookupKey: "tg_user_456",
        }),
      },
    } as never;

    await expect(
      readHostedMemberRoutingState({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      hasPendingLinqRouteState: false,
      linqChatId: null,
      linqChatLookupKey: null,
      linqRecipientPhone: null,
      linqRecipientPhoneLookupKey: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: "456:business:biz-42:dm-topic:9",
      telegramUserId: "456",
      telegramUserLookupKey: "tg_user_456",
    });
  });

  it("preserves legacy Telegram user lookup while dropping legacy identity-only thread targets", async () => {
    const telegramUserIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: JSON.stringify({
        schema: LEGACY_TELEGRAM_PRIVATE_STATE_SCHEMA,
        telegramThreadId: "456",
        telegramUserId: "456",
      }),
    });
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: null,
          linqRecipientPhoneEncrypted: null,
          memberId: "member_123",
          pendingLinqChatIdEncrypted: null,
          pendingLinqRecipientPhoneEncrypted: null,
          telegramUserIdEncrypted,
          telegramUserLookupKey: "tg_user_456",
        }),
      },
    } as never;

    await expect(
      readHostedMemberRoutingState({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      hasPendingLinqRouteState: false,
      linqChatId: null,
      linqChatLookupKey: null,
      linqRecipientPhone: null,
      linqRecipientPhoneLookupKey: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: "456",
      telegramUserLookupKey: "tg_user_456",
    });
  });

  it("fails closed when the persisted Telegram private payload uses an unknown schema", async () => {
    const telegramUserIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: JSON.stringify({
        schema: "murph.hosted-member-routing.telegram.v99",
        telegramThreadId: "456:business:biz-42:dm-topic:9",
        telegramUserId: "456",
      }),
    });

    await expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted,
      }),
    ).resolves.toEqual({
      telegramThreadId: null,
      telegramUserId: null,
    });
  });

  it("fails closed when the persisted Telegram private payload is not JSON", async () => {
    const telegramUserIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: "456",
    });

    await expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted,
      }),
    ).resolves.toEqual({
      telegramThreadId: null,
      telegramUserId: null,
    });
  });

  it("fails closed when the persisted Telegram private payload has the wrong JSON shape", async () => {
    const telegramUserIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: JSON.stringify(456),
    });

    await expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted,
      }),
    ).resolves.toEqual({
      telegramThreadId: null,
      telegramUserId: null,
    });
  });

  it("fails closed when a persisted Telegram private payload points at a bare group chat id", async () => {
    const telegramUserIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: "-1009999999999",
    });

    await expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted,
      }),
    ).resolves.toEqual({
      telegramThreadId: null,
      telegramUserId: null,
    });
  });

  it("looks up the routed member by reply-alias lookup key", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      memberId: "member_123",
    });
    const findMany = vi.fn();
    const prisma = {
      hostedMemberRouting: {
        findMany,
        findUnique,
      },
    } as never;

    await expect(
      readHostedMemberIdByReplyAliasLookupKey({
        prisma,
        replyAliasLookupKey: "  replyalias1234  ",
      }),
    ).resolves.toBe("member_123");

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        replyAliasLookupKey: "replyalias1234",
      },
      select: {
        memberId: true,
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("looks up an upgraded 32-hex reply-alias lookup key directly", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      memberId: "member_123",
    });
    const findMany = vi.fn();
    const prisma = {
      hostedMemberRouting: {
        findMany,
        findUnique,
      },
    } as never;

    await expect(
      readHostedMemberIdByReplyAliasLookupKey({
        prisma,
        replyAliasLookupKey: "0123456789abcdef0123456789abcdef",
      }),
    ).resolves.toBe("member_123");

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        replyAliasLookupKey: "0123456789abcdef0123456789abcdef",
      },
      select: {
        memberId: true,
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does not use prefix fallback for former 16-hex reply-alias lookup keys", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const prisma = {
      hostedMemberRouting: {
        findMany,
        findUnique,
      },
    } as never;

    await expect(
      readHostedMemberIdByReplyAliasLookupKey({
        prisma,
        replyAliasLookupKey: "0123456789abcdef",
      }),
    ).resolves.toBeNull();

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        replyAliasLookupKey: "0123456789abcdef",
      },
      select: {
        memberId: true,
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does not use prefix fallback for non-matching reply-alias lookup keys", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const prisma = {
      hostedMemberRouting: {
        findMany,
        findUnique,
      },
    } as never;

    await expect(
      readHostedMemberIdByReplyAliasLookupKey({
        prisma,
        replyAliasLookupKey: "not-a-legacy-key",
      }),
    ).resolves.toBeNull();

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        replyAliasLookupKey: "not-a-legacy-key",
      },
      select: {
        memberId: true,
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("upserts the reply-alias lookup key on the routing owner row", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      hostedMemberRouting: {
        upsert,
      },
    } as never;

    await upsertHostedMemberReplyAliasLookupKeyTx({
      memberId: "member_123",
      prisma,
      replyAliasLookupKey: "  0123456789abcdef0123456789abcdef  ",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatIdEncrypted: null,
        linqRecipientPhoneEncrypted: null,
        memberId: "member_123",
        pendingLinqChatIdEncrypted: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqRecipientPhoneEncrypted: null,
        replyAliasGeneration: 0,
        replyAliasLookupKey: "0123456789abcdef0123456789abcdef",
        telegramUserLookupKey: null,
        telegramUserIdEncrypted: null,
      },
      update: {
        replyAliasGeneration: 0,
        replyAliasLookupKey: "0123456789abcdef0123456789abcdef",
      },
    });
  });

  it("rejects a stale Worker alias after Web has rotated the current capability", async () => {
    const prisma = {
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          replyAliasGeneration: 1,
          replyAliasLookupKey: "11111111111111111111111111111111",
        }),
      },
    } as never;

    await expect(resolveHostedMemberReplyAliasRegistrationTx({
      candidateLookupKey: "00000000000000000000000000000000",
      fallbackGeneration: 1,
      fallbackLookupKey: "00000000000000000000000000000000",
      memberId: "member_123",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_EMAIL_REPLY_ALIAS_STALE",
      httpStatus: 409,
    });
  });

  it("restores a missing alias at the current generation without reviving generation zero", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          replyAliasGeneration: 3,
          replyAliasLookupKey: null,
        }),
        upsert,
      },
    } as never;

    await expect(resolveHostedMemberReplyAliasRegistrationTx({
      candidateLookupKey: null,
      fallbackGeneration: 3,
      fallbackLookupKey: "33333333333333333333333333333333",
      memberId: "member_123",
      prisma,
    })).resolves.toEqual({
      generation: 3,
      lookupKey: "33333333333333333333333333333333",
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: {
        replyAliasGeneration: 3,
        replyAliasLookupKey: "33333333333333333333333333333333",
      },
    }));
  });

  it("prepares the next reply-alias generation before a verified-email rotation transaction", async () => {
    const previousDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "test-reply-alias-signing-secret";
    const currentLookupKey = createHostedEmailLookupKeyReadCandidates(
      "current@example.test",
    )[0];
    const prisma = {
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn().mockResolvedValue({
          verifiedEmailLookupKey: currentLookupKey,
          verifiedEmailVerifiedAt: new Date("2026-08-20T10:00:00.000Z"),
        }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({ replyAliasGeneration: 4 }),
      },
    } as never;

    try {
      const current = await prepareHostedMemberVerifiedEmailReplyAlias({
        address: "current@example.test",
        memberId: "member_123",
        prisma,
      });
      const rotated = await prepareHostedMemberVerifiedEmailReplyAlias({
        address: "next@example.test",
        memberId: "member_123",
        prisma,
      });

      expect(current).toMatchObject({ generation: 4, memberId: "member_123" });
      expect(rotated).toMatchObject({ generation: 5, memberId: "member_123" });
      expect(rotated.lookupKey).toMatch(/^[0-9a-f]{32}$/u);
      expect(rotated.lookupKey).not.toBe(current.lookupKey);
    } finally {
      restoreEnvValue("HOSTED_EMAIL_DOMAIN", previousDomain);
      restoreEnvValue("HOSTED_EMAIL_SIGNING_SECRET", previousSigningSecret);
    }
  });

  it("upserts home Linq chat bindings into the routing table with encrypted local storage", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = createMemberRowLockQueryRaw();
    const findFirst = vi.fn().mockResolvedValue(null);
    const findUnique = vi.fn().mockResolvedValue(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst,
        findMany: vi.fn().mockResolvedValue([]),
        findUnique,
        updateMany,
        upsert,
      },
    } as never;

    await upsertHostedMemberHomeLinqBindingTx({
      linqChatId: "chat_123",
      memberId: "member_123",
      participantContact: {
        kind: "email",
        lookupKey: "hbidx:email:v1:home-participant",
      },
      prisma,
      recipientPhone: "+15550100001",
    });

    expect(findFirst).toHaveBeenCalledWith({
      select: {
        memberId: true,
      },
      where: {
        linqChatLookupKey: {
          in: [expect.stringMatching(/^hbidx:linq-chat:v1:/u)],
        },
        NOT: {
          memberId: "member_123",
        },
      },
    });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        linqChatLookupKey: null,
        pendingLinqChatLookupKey: {
          in: [expect.stringMatching(/^hbidx:linq-chat:v1:/u)],
        },
        NOT: {
          memberId: "member_123",
        },
      },
      data: {
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        linqChatLookupKey: {
          not: null,
        },
        pendingLinqChatLookupKey: {
          in: [expect.stringMatching(/^hbidx:linq-chat:v1:/u)],
        },
        NOT: {
          memberId: "member_123",
        },
      },
      data: {
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
      },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        linqParticipantContactKind: "email",
        linqParticipantContactLookupKey: "hbidx:email:v1:home-participant",
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        memberId: "member_123",
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserLookupKey: null,
        telegramUserIdEncrypted: null,
      },
      update: {
        linqChatIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        linqParticipantContactKind: "email",
        linqParticipantContactLookupKey: "hbidx:email:v1:home-participant",
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
      },
    });
  });

  it("enriches home participant authority once and does not replace it from later inbound identity", async () => {
    const establishedParticipant = {
      kind: "email" as const,
      lookupKey: "hbidx:email:v1:established-participant",
    };
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({
          linqChatLookupKey: "hbidx:linq-chat:v1:existing",
          linqParticipantContactKind: establishedParticipant.kind,
          linqParticipantContactLookupKey: establishedParticipant.lookupKey,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert,
      },
    } as never;

    await expect(upsertHostedMemberHomeLinqBindingTx({
      linqChatId: "chat_123",
      memberId: "member_123",
      participantContact: {
        kind: "phone",
        lookupKey: "hbidx:phone:v1:later-participant",
      },
      prisma,
      recipientPhone: "+15550100001",
    })).resolves.toEqual(establishedParticipant);

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqParticipantContactKind: establishedParticipant.kind,
        linqParticipantContactLookupKey: establishedParticipant.lookupKey,
      }),
    }));
  });

  it("does not carry an orphaned home participant onto a later private chat", async () => {
    const incomingParticipant = {
      kind: "phone" as const,
      lookupKey: "hbidx:phone:v1:incoming-participant",
    };
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({
          linqChatLookupKey: null,
          linqParticipantContactKind: "email",
          linqParticipantContactLookupKey: "hbidx:email:v1:orphaned-participant",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert,
      },
    } as never;

    await expect(upsertHostedMemberHomeLinqBindingTx({
      linqChatId: "chat_reestablished",
      memberId: "member_123",
      participantContact: incomingParticipant,
      prisma,
      recipientPhone: "+15550100001",
    })).resolves.toEqual(incomingParticipant);

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqParticipantContactKind: incomingParticipant.kind,
        linqParticipantContactLookupKey: incomingParticipant.lookupKey,
      }),
    }));
  });

  it("does not let a provisional participant claim veto an authorized home binding", async () => {
    const participantContact = createHostedLinqParticipantContact({
      kind: "email",
      value: "linked-member@example.test",
    });
    if (!participantContact) {
      throw new Error("Expected a valid Linq participant contact.");
    }

    const findMany = vi.fn().mockResolvedValue([{ memberId: "member_provisional" }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member_provisional" }]),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany,
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
        upsert,
      },
    } as never;

    await expect(upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      linqChatId: "chat_authorized",
      memberId: "member_active",
      participantContact,
      prisma,
      recipientPhone: "+15550100001",
    })).resolves.toEqual({
      kind: participantContact.kind,
      lookupKey: participantContact.lookupKey,
    });

    expect(findMany).toHaveBeenCalled();
    const clearedConflict = updateMany.mock.calls[0]?.[0]?.data;
    expect(clearedConflict).not.toHaveProperty("linqHomeLineAssignedAt");
    expect(clearedConflict).not.toHaveProperty("linqRecipientPhoneEncrypted");
    expect(clearedConflict).not.toHaveProperty("linqRecipientPhoneLookupKey");
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("retries instead of clearing a pending Linq route whose member owner is busy", async () => {
    const updateMany = vi.fn();
    const upsert = vi.fn();
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{ memberId: "member_pending" }]),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
        upsert,
      },
    } as never;

    await expect(upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      linqChatId: "chat_authorized",
      memberId: "member_active",
      participantContact: {
        kind: "phone",
        lookupKey: "hbidx:phone:v1:active-participant",
      },
      prisma,
      recipientPhone: "+15550100001",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PENDING_ROUTE_BUSY",
      retryable: true,
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("selects one home participant authority across concurrent first enrichment", async () => {
    const emailContact = createHostedLinqParticipantContact({
      kind: "email",
      value: "linked-member@example.test",
    });
    const phoneContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15550100002",
    });
    if (!emailContact || !phoneContact) {
      throw new Error("Expected valid Linq participant contacts.");
    }

    type ParticipantIdentity = {
      kind: "email" | "phone";
      lookupKey: string;
    };
    let selectedParticipant: ParticipantIdentity | null = null;
    let homeMemberLockCount = 0;
    let releaseFirstWrite = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let parallelReadCount = 0;
    let releaseParallelReads = () => {};
    const parallelReads = new Promise<void>((resolve) => {
      releaseParallelReads = resolve;
    });

    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = vi.fn(async (
      _query: TemplateStringsArray,
      memberId: string,
    ) => {
      homeMemberLockCount += 1;
      if (homeMemberLockCount > 1) {
        await firstWrite;
      }
      return [{ id: memberId }];
    });
    const findUnique = vi.fn(async () => {
      const participantAtRead = selectedParticipant;
      if (homeMemberLockCount === 0) {
        parallelReadCount += 1;
        if (parallelReadCount === 2) {
          releaseParallelReads();
        }
        await parallelReads;
      }
      return participantAtRead
        ? {
            linqChatLookupKey: "hbidx:linq-chat:v1:selected",
            linqParticipantContactKind: participantAtRead.kind,
            linqParticipantContactLookupKey: participantAtRead.lookupKey,
          }
        : null;
    });
    const upsert = vi.fn(async (args: {
      update: {
        linqParticipantContactKind?: "email" | "phone";
        linqParticipantContactLookupKey?: string;
      };
    }) => {
      const kind = args.update.linqParticipantContactKind;
      const lookupKey = args.update.linqParticipantContactLookupKey;
      if (!kind || !lookupKey) {
        throw new Error("Expected the home write to select participant authority.");
      }
      selectedParticipant = { kind, lookupKey };
      releaseFirstWrite();
      return {};
    });
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert,
      },
    } as never;

    const results = await Promise.all([
      upsertHostedMemberHomeLinqBindingTx({
        linqChatId: "chat_email",
        memberId: "member_123",
        participantContact: emailContact,
        prisma,
        recipientPhone: "+15550100001",
      }),
      upsertHostedMemberHomeLinqBindingTx({
        linqChatId: "chat_phone",
        memberId: "member_123",
        participantContact: phoneContact,
        prisma,
        recipientPhone: "+15550100001",
      }),
    ]);

    expect(new Set(results.map((result) => result?.lookupKey)).size).toBe(1);
    expect(results[0]).toEqual(results[1]);
    expect(selectedParticipant).toEqual(results[0]);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("demotes home and pending Linq bindings for canonical groups without clearing the assigned line", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = createMemberRowLockQueryRaw();
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const consumedAt = new Date("2026-07-12T12:00:00.000Z");
    const findFirstMailboxItem = vi.fn().mockResolvedValue({ consumedAt });
    const findMany = vi.fn().mockResolvedValue([
      { memberId: "member_home" },
      { memberId: "member_pending" },
    ]);
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedLinqDelivery: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMailboxItem: {
        deleteMany,
        findFirst: findFirstMailboxItem,
      },
      hostedMemberRouting: {
        findMany,
        updateMany,
      },
    } as never;

    await expect(demoteHostedMemberLinqGroupChatBindingsTx({
      linqChatId: "chat_group",
      mailboxDedupeKey: "evt_group",
      prisma,
    })).resolves.toEqual({ mailboxConsumedAt: consumedAt });

    const lookupKeys = createHostedLinqChatLookupKeyReadCandidates("chat_group");
    expect(lookupKeys).toHaveLength(2);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenNthCalledWith(1, expect.anything(), "member_home");
    expect(queryRaw).toHaveBeenNthCalledWith(2, expect.anything(), "member_pending");
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        dedupeKey: "evt_group",
        userId: {
          in: ["member_home", "member_pending"],
        },
      },
    });
    expect(findFirstMailboxItem).toHaveBeenCalledWith({
      orderBy: {
        consumedAt: "asc",
      },
      select: {
        consumedAt: true,
      },
      where: {
        consumedAt: {
          not: null,
        },
        dedupeKey: "evt_group",
        userId: {
          in: ["member_home", "member_pending"],
        },
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        linqChatLookupKey: {
          in: lookupKeys,
        },
      },
      data: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqParticipantContactKind: null,
        linqParticipantContactLookupKey: null,
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        pendingLinqChatLookupKey: {
          in: lookupKeys,
        },
      },
      data: {
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
      },
    });
  });

  it("keeps canonical group bindings while a provider dispatch is in flight", async () => {
    const findMany = vi.fn();
    const updateMany = vi.fn();
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedLinqDelivery: {
        findFirst: vi.fn().mockResolvedValue({ id: "delivery_in_flight" }),
      },
      hostedMemberRouting: {
        findMany,
        updateMany,
      },
    } as never;

    await expect(demoteHostedMemberLinqGroupChatBindingsTx({
      enforceProviderDispatchFence: true,
      linqChatId: "chat_group",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_GROUP_PROVIDER_DISPATCH_IN_FLIGHT",
      retryable: true,
    });

    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("retries group demotion when another member route appears after owner locking", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ memberId: "member_home" }])
      .mockResolvedValueOnce([
        { memberId: "member_home" },
        { memberId: "member_new" },
      ]);
    const updateMany = vi.fn();
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedLinqDelivery: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findMany,
        updateMany,
      },
    } as never;

    await expect(demoteHostedMemberLinqGroupChatBindingsTx({
      linqChatId: "chat_group",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_GROUP_ROUTE_CHANGED",
      retryable: true,
    });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: "home",
      expectedLockCount: 1,
      write: upsertHostedMemberHomeLinqBindingTx,
    },
    {
      kind: "pending",
      expectedLockCount: 1,
      write: upsertHostedMemberPendingLinqBindingTx,
    },
  ] as const)("refuses to recreate a $kind Linq binding after a thread route owns the chat", async ({
    expectedLockCount,
    write,
  }) => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = createMemberRowLockQueryRaw();
    const routeFindFirst = vi.fn().mockResolvedValue({
      containerMemberId: "thread_container",
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
        upsert,
      },
      hostedThreadRoute: {
        findFirst: routeFindFirst,
      },
    } as never;

    await expect(write({
      linqChatId: "chat_group",
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_CHAT_THREAD_ROUTE_CONFLICT",
      retryable: true,
    });

    expect(executeRaw).toHaveBeenCalledTimes(expectedLockCount);
    expect(Math.max(
      ...executeRaw.mock.invocationCallOrder,
      ...queryRaw.mock.invocationCallOrder,
    )).toBeLessThan(
      routeFindFirst.mock.invocationCallOrder[0]!,
    );
    expect(routeFindFirst).toHaveBeenCalledWith({
      select: {
        containerMemberId: true,
      },
      where: {
        channel: "linq",
        threadIdentityLookupKey: {
          in: createHostedExternalThreadIdentityLookupKeyReadCandidates({
            channel: "linq",
            threadId: "chat_group",
          }),
        },
      },
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("clears pending Linq route state when pending chat binding becomes home", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const pendingLinqChatLookupKey = createHostedLinqChatLookupKeyReadCandidates("chat_123")[0];
    const findUnique = vi.fn().mockResolvedValue({
      linqChatLookupKey: createHostedLinqChatLookupKeyReadCandidates("chat_old")[0],
      linqRecipientPhoneLookupKey: null,
      pendingLinqChatLookupKey,
      pendingLinqRecipientPhoneLookupKey: null,
    });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique,
        updateMany,
        upsert,
      },
    } as never;

    await upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      linqChatId: "chat_123",
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    });

    expect(findUnique).toHaveBeenCalledWith({
      select: {
        linqChatLookupKey: true,
        linqParticipantContactKind: true,
        linqParticipantContactLookupKey: true,
      },
      where: {
        memberId: "member_123",
      },
    });
    const upsertUpdate = upsert.mock.calls[0]?.[0]?.update;
    expect(upsertUpdate).toEqual(expect.objectContaining({
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
    }));
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("clears pending Linq route state when a different pending chat becomes home", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({
      linqChatLookupKey: createHostedLinqChatLookupKeyReadCandidates("chat_a")[0],
      linqRecipientPhoneLookupKey: null,
      pendingLinqChatLookupKey: createHostedLinqChatLookupKeyReadCandidates("chat_b")[0],
      pendingLinqRecipientPhoneLookupKey: null,
    });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique,
        updateMany,
        upsert,
      },
    } as never;

    await upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      linqChatId: "chat_c",
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    });

    const upsertUpdate = upsert.mock.calls[0]?.[0]?.update;
    expect(upsertUpdate).toEqual(expect.objectContaining({
      linqChatLookupKey: createHostedLinqChatLookupKeyReadCandidates("chat_c")[0],
      pendingLinqChatLookupKey: null,
    }));
    expect(findUnique).toHaveBeenCalledWith({
      select: {
        linqChatLookupKey: true,
        linqParticipantContactKind: true,
        linqParticipantContactLookupKey: true,
      },
      where: {
        memberId: "member_123",
      },
    });
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("rewrites pending Linq chat binding without reading prior route state", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({
      pendingLinqChatLookupKey: createHostedLinqChatLookupKeyReadCandidates("chat_old")[0],
    });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique,
        updateMany,
        upsert,
      },
    } as never;

    await upsertHostedMemberPendingLinqBindingTx({
      linqChatId: "chat_new",
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        pendingLinqChatLookupKey: createHostedLinqChatLookupKeyReadCandidates("chat_new")[0],
      }),
    }));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("retries a capacity-reserving pending bind when a home route wins the member lock", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = createMemberRowLockQueryRaw();
    const findUnique = vi.fn().mockResolvedValue({
      linqChatLookupKey: createHostedLinqChatLookupKeyReadCandidates("chat_home")[0],
      linqParticipantContactKind: "phone",
      linqParticipantContactLookupKey: "hbidx:phone:v1:home",
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findUnique,
        updateMany,
        upsert,
      },
    } as never;

    await expect(upsertHostedMemberPendingLinqBindingTx({
      homeLineAssignedAt: new Date("2026-07-12T12:00:00.000Z"),
      linqChatId: "chat_pending",
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_HOME_ROUTE_CHANGED",
      retryable: true,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledWith({
      select: {
        linqChatLookupKey: true,
        linqParticipantContactKind: true,
        linqParticipantContactLookupKey: true,
      },
      where: {
        memberId: "member_123",
      },
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("clears Linq chat conflicts across readable blind-index versions before rebinding", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const executeRaw = vi.fn().mockResolvedValue(0);
    const findFirst = vi.fn().mockResolvedValue(null);
    const findUnique = vi.fn().mockResolvedValue(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst,
        findMany: vi.fn().mockResolvedValue([]),
        findUnique,
        updateMany,
        upsert,
      },
    } as never;

    await upsertHostedMemberHomeLinqBindingTx({
      linqChatId: "chat_123",
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        linqChatLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:linq-chat:v2:/u),
            expect.stringMatching(/^hbidx:linq-chat:v1:/u),
          ]),
        },
      }),
    }));
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        linqChatLookupKey: null,
        pendingLinqChatLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:linq-chat:v2:/u),
            expect.stringMatching(/^hbidx:linq-chat:v1:/u),
          ]),
        },
      }),
    }));
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        linqChatLookupKey: {
          not: null,
        },
        pendingLinqChatLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:linq-chat:v2:/u),
            expect.stringMatching(/^hbidx:linq-chat:v1:/u),
          ]),
        },
      }),
    }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v2:/u),
      }),
      update: expect.objectContaining({
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v2:/u),
      }),
    }));
  });

  it("looks up home Linq chat routing across readable blind-index versions", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const [currentLookupKey, previousLookupKey] =
      createHostedLinqChatLookupKeyReadCandidates("chat_123");
    const member = createHostedMember({
      id: "member_123",
    });
    const findMany = vi.fn().mockResolvedValue([
      createHostedMemberRoutingLookupRecord({
        linqChatLookupKey: previousLookupKey,
        member,
      }),
    ]);
    const prisma = {
      hostedMemberRouting: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberRoutingByHomeLinqChatId({
        linqChatId: "chat_123",
        prisma,
      }),
    ).resolves.toMatchObject({
      core: {
        id: "member_123",
      },
      matchedBy: "linqChatLookupKey",
      routing: {
        memberId: "member_123",
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        linqChatLookupKey: {
          in: expect.arrayContaining([
            currentLookupKey,
            previousLookupKey,
          ]),
        },
      },
    }));
  });

  it("fails closed when home Linq chat lookup matches multiple rotated blind-index owners", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const memberOne = createHostedMember({
      id: "member_123",
    });
    const memberTwo = createHostedMember({
      id: "member_456",
    });
    const findMany = vi.fn().mockResolvedValue([
      createHostedMemberRoutingLookupRecord({ member: memberOne }),
      createHostedMemberRoutingLookupRecord({ member: memberTwo }),
    ]);
    const prisma = {
      hostedMemberRouting: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberRoutingByHomeLinqChatId({
        linqChatId: "chat_123",
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "LINQ_HOME_CHAT_ROUTING_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: 2,
        matchedBy: "linqChatLookupKey",
      },
    });
  });

  it("does not retry Linq binding writes inside the same transaction after a unique race", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn()
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          clientVersion: "test",
          code: "P2002",
        }),
      )
      .mockResolvedValueOnce({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
        upsert,
      },
    } as never;

    await expect(
      upsertHostedMemberHomeLinqBindingTx({
        linqChatId: "chat_123",
        memberId: "member_123",
        prisma,
        recipientPhone: "+15550100001",
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("upserts a home Linq recipient phone without creating a home chat binding", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = createMemberRowLockQueryRaw();
    const findUnique = vi.fn().mockResolvedValue(null);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findUnique,
        upsert,
      },
    } as never;

    await upsertHostedMemberHomeLinqRecipientPhoneTx({
      clearPending: true,
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    });

    expect(queryRaw).toHaveBeenCalledWith(expect.anything(), "member_123");
    expect(executeRaw).not.toHaveBeenCalled();

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        memberId: "member_123",
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
      update: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqParticipantContactKind: null,
        linqParticipantContactLookupKey: null,
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
      },
    });
  });

  it("does not promote pending Linq inbound freshness when pending recipient route becomes home", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = createMemberRowLockQueryRaw();
    const findUnique = vi.fn().mockResolvedValue({
      linqChatLookupKey: null,
      linqRecipientPhoneLookupKey: null,
      pendingLinqChatLookupKey: null,
      pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKeyReadCandidates("+15550100001")[0],
    });
    const upsert = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findUnique,
        updateMany,
        upsert,
      },
    } as never;

    await upsertHostedMemberHomeLinqRecipientPhoneTx({
      clearPending: true,
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    });

    const upsertUpdate = upsert.mock.calls[0]?.[0]?.update;
    expect(upsertUpdate).toEqual(expect.objectContaining({
      pendingLinqChatLookupKey: null,
      pendingLinqRecipientPhoneLookupKey: null,
    }));
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledWith(expect.anything(), "member_123");
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("counts active home-line assignments and pre-activation reservations by recipient phone", async () => {
    const homePhoneOne = "+15550100001";
    const homePhoneTwo = "+15550100002";
    const now = new Date("2026-06-30T12:00:00.000Z");
    const groupBy = vi.fn().mockResolvedValue([
      {
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homePhoneOne),
        _count: { _all: 2 },
      },
      {
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homePhoneTwo),
        _count: { _all: 1 },
      },
    ]);
    const prisma = {
      hostedMemberRouting: {
        groupBy,
      },
    } as never;

    await expect(
      countHostedMemberHomeLinqBindingsByRecipientPhone({
        now,
        prisma,
        recipientPhones: [homePhoneOne, homePhoneTwo],
      }),
    ).resolves.toEqual(
      new Map([
        [homePhoneOne, 2],
        [homePhoneTwo, 1],
      ]),
    );

    expect(groupBy).toHaveBeenCalledWith({
      by: ["linqRecipientPhoneLookupKey"],
      where: {
        linqRecipientPhoneLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:phone:v1:/u),
            expect.stringMatching(/^hbidx:phone:v1:/u),
          ]),
        },
        OR: [
          {
            member: {
              is: {
                billingStatus: HostedBillingStatus.active,
                suspendedAt: null,
              },
            },
          },
          {
            member: {
              is: {
                accountGroupMemberships: {
                  some: {
                    group: {
                      billingStatus: HostedBillingStatus.active,
                      suspendedAt: null,
                    },
                    status: "active",
                  },
                },
                suspendedAt: null,
              },
            },
          },
          {
            linqHomeLineAssignedAt: {
              not: null,
            },
            member: {
              is: {
                billingStatus: {
                  in: [
                    HostedBillingStatus.not_started,
                    HostedBillingStatus.incomplete,
                  ],
                },
                invites: {
                  some: {
                    channel: "linq",
                    expiresAt: {
                      gt: now,
                    },
                  },
                },
                suspendedAt: null,
              },
            },
          },
        ],
      },
      _count: {
        _all: true,
      },
    });
  });

  it("counts home-line assignments across readable recipient-phone blind-index versions", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const homePhone = "+15550100001";
    const [currentLookupKey, previousLookupKey] = createHostedPhoneLookupKeyReadCandidates(homePhone);
    const groupBy = vi.fn().mockResolvedValue([
      {
        linqRecipientPhoneLookupKey: previousLookupKey,
        _count: { _all: 1 },
      },
      {
        linqRecipientPhoneLookupKey: currentLookupKey,
        _count: { _all: 1 },
      },
    ]);
    const prisma = {
      hostedMemberRouting: {
        groupBy,
      },
    } as never;

    await expect(
      countHostedMemberHomeLinqBindingsByRecipientPhone({
        now: new Date("2026-06-30T12:00:00.000Z"),
        prisma,
        recipientPhones: [homePhone],
      }),
    ).resolves.toEqual(new Map([[homePhone, 2]]));

    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["linqRecipientPhoneLookupKey"],
      where: expect.objectContaining({
        linqRecipientPhoneLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:phone:v2:/u),
            expect.stringMatching(/^hbidx:phone:v1:/u),
          ]),
        },
      }),
      _count: {
        _all: true,
      },
    }));
  });

  it("rejects pending Linq participant contact writes that match another readable blind-index version", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const contact = createHostedLinqParticipantContact({
      kind: "email",
      value: "contact@example.test",
    });
    if (!contact) {
      throw new Error("Expected test contact to normalize.");
    }

    const executeRaw = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([{ memberId: "member_existing" }]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMemberRouting: {
        findMany,
        upsert,
      },
    } as never;

    await expect(
      upsertHostedMemberPendingLinqParticipantContactTx({
        contact,
        memberId: "member_123",
        observedAt: new Date("2026-04-07T01:00:00.000Z"),
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        pendingLinqParticipantContactLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:email:v2:/u),
            expect.stringMatching(/^hbidx:email:v1:/u),
          ]),
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("looks up pending Linq participant contacts across readable blind-index versions", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const contact = createHostedLinqParticipantContact({
      kind: "email",
      value: "contact@example.test",
    });
    if (!contact) {
      throw new Error("Expected test contact to normalize.");
    }

    const member = createHostedMember({
      id: "member_123",
    });
    const findMany = vi.fn().mockResolvedValue([
      createHostedMemberRoutingLookupRecord({
        member,
        pendingLinqParticipantContactKind: "email",
        pendingLinqParticipantContactLookupKey: contact.lookupKey,
        pendingLinqParticipantContactObservedAt: new Date("2026-04-07T01:00:00.000Z"),
      }),
    ]);
    const prisma = {
      hostedMemberRouting: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact,
        prisma,
      }),
    ).resolves.toMatchObject({
      core: {
        id: "member_123",
      },
      matchedBy: "pendingLinqParticipantContactLookupKey",
      routing: {
        memberId: "member_123",
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        pendingLinqParticipantContactLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:email:v2:/u),
            expect.stringMatching(/^hbidx:email:v1:/u),
          ]),
        },
      },
    }));
  });

  it("upserts Telegram bindings into the routing table", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findMany,
        findUnique: vi.fn().mockResolvedValue(null),
        upsert,
      },
    } as never;

    await expect(upsertHostedMemberTelegramRoutingBindingTx({
      memberId: "member_123",
      prisma,
      telegramUserId: "456",
    })).resolves.toEqual({ effectiveRouteChanged: true });

    expect(queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      "member_123",
    );
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(findMany).toHaveBeenCalledWith({
      where: {
        telegramUserLookupKey: {
          in: [expect.stringMatching(/^hbidx:telegram-user:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqRecipientPhoneEncrypted: null,
        linqRecipientPhoneLookupKey: null,
        memberId: "member_123",
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        telegramUserLookupKey: expect.stringMatching(/^hbidx:telegram-user:v1:/u),
      },
      update: {
        telegramUserIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        telegramUserLookupKey: expect.stringMatching(/^hbidx:telegram-user:v1:/u),
      },
    });
    const upsertCall = upsert.mock.calls[0]?.[0] as {
      create: {
        telegramUserIdEncrypted: string;
      };
    };
    await expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted: upsertCall.create.telegramUserIdEncrypted,
      }),
    ).resolves.toEqual({
      telegramThreadId: null,
      telegramUserId: "456",
    });
  });

  it("refreshes the same member's Telegram lookup key to the current rotation version", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });
    const existingTelegramPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: "456",
    });

    const findMany = vi.fn().mockResolvedValue([
      {
        memberId: "member_123",
      },
    ]);
    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          telegramUserIdEncrypted: existingTelegramPrivateColumns.telegramUserIdEncrypted,
        }),
        upsert,
      },
    } as never;

    await expect(upsertHostedMemberTelegramRoutingBindingTx({
      memberId: "member_123",
      prisma,
      telegramUserId: "456",
    })).resolves.toEqual({ effectiveRouteChanged: false });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        telegramUserLookupKey: {
          in: [
            expect.stringMatching(/^hbidx:telegram-user:v2:/u),
            expect.stringMatching(/^hbidx:telegram-user:v1:/u),
          ],
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          telegramUserLookupKey: expect.stringMatching(/^hbidx:telegram-user:v2:/u),
        }),
        update: expect.objectContaining({
          telegramUserLookupKey: expect.stringMatching(/^hbidx:telegram-user:v2:/u),
        }),
      }),
    );
  });

  it("preserves an existing rich Telegram thread target during a user-id-only resync", async () => {
    const existingTelegramPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: "456:business:biz-42:dm-topic:9",
      telegramUserId: "456",
    });
    const findMany = vi.fn().mockResolvedValue([
      {
        memberId: "member_123",
      },
    ]);
    const findUnique = vi.fn().mockResolvedValue({
      memberId: "member_123",
      telegramUserIdEncrypted: existingTelegramPrivateColumns.telegramUserIdEncrypted,
    });
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findMany,
        findUnique,
        upsert,
      },
    } as never;

    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: "member_123",
      prisma,
      telegramUserId: "456",
    });

    const upsertCall = upsert.mock.calls[0]?.[0] as {
      update: {
        telegramUserIdEncrypted: string;
      };
    };
    await expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted: upsertCall.update.telegramUserIdEncrypted,
      }),
    ).resolves.toEqual({
      telegramThreadId: "456:business:biz-42:dm-topic:9",
      telegramUserId: "456",
    });
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUnique.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("clears a legacy same-user Telegram thread target during a user-id-only resync", async () => {
    const legacyTelegramUserIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: JSON.stringify({
        schema: LEGACY_TELEGRAM_PRIVATE_STATE_SCHEMA,
        telegramThreadId: "456",
        telegramUserId: "456",
      }),
    });
    const findMany = vi.fn().mockResolvedValue([
      {
        memberId: "member_123",
      },
    ]);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          telegramUserIdEncrypted: legacyTelegramUserIdEncrypted,
        }),
        upsert,
      },
    } as never;

    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: "member_123",
      prisma,
      telegramUserId: "456",
    });

    const upsertCall = upsert.mock.calls[0]?.[0] as {
      update: {
        telegramUserIdEncrypted: string;
      };
    };
    await expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted: upsertCall.update.telegramUserIdEncrypted,
      }),
    ).resolves.toEqual({
      telegramThreadId: null,
      telegramUserId: "456",
    });
  });

  it("rejects Telegram binding when another member already owns a rotated lookup candidate", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const findMany = vi.fn().mockResolvedValue([
      {
        memberId: "member_other",
      },
    ]);
    const executeRaw = vi.fn().mockResolvedValue(0);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMemberRouting: {
        findMany,
        upsert,
      },
    } as never;

    await expect(
      upsertHostedMemberTelegramRoutingBindingTx({
        memberId: "member_123",
        prisma,
        telegramUserId: "456",
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_IDENTITY_CONFLICT",
      httpStatus: 409,
      name: "HostedOnboardingError",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        telegramUserLookupKey: {
          in: [
            expect.stringMatching(/^hbidx:telegram-user:v2:/u),
            expect.stringMatching(/^hbidx:telegram-user:v1:/u),
          ],
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts identity rows through blind lookup keys and encrypted local columns", async () => {
    const upsert = vi.fn().mockResolvedValue({
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:abc123",
      phoneNumberEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-identity.phone-number",
        memberId: "member_123",
        value: "+15551234567",
      }),
      phoneNumberVerifiedAt: null,
      privyUserLookupKey: "hbidx:privy-user:v1:abc123",
      privyUserIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-identity.privy-user-id",
        memberId: "member_123",
        value: "did:privy:user_123",
      }),
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumberEncrypted: null,
      walletAddressLookupKey: "hbidx:wallet-address:v1:abc123",
      walletAddressEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-identity.wallet-address",
        memberId: "member_123",
        value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      }),
      walletChainType: "ethereum",
      walletCreatedAt: null,
      walletProvider: "privy",
    });
    const prisma = {
      hostedMemberIdentity: {
        upsert,
      },
    } as never;

    await expect(
      upsertHostedMemberIdentity({
        maskedPhoneNumberHint: "*** 4567",
        memberId: "member_123",
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        phoneNumber: "+15551234567",
        prisma,
        privyUserId: "did:privy:user_123",
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
      }),
    ).resolves.toEqual({
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:abc123",
      phoneNumber: "+15551234567",
      phoneNumberVerifiedAt: null,
      privyUserId: "did:privy:user_123",
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      walletChainType: "ethereum",
      walletCreatedAt: null,
      walletProvider: "privy",
    });
    const { provisionActiveHostedDomainRootEnvelopeForUserOnly } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );

    expect(vi.mocked(provisionActiveHostedDomainRootEnvelopeForUserOnly)).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "control",
        prisma,
        reason: "hosted-member.identity-private-fields",
        userId: "member_123",
      }),
    );
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        maskedPhoneNumberHint: "*** 4567",
        memberId: "member_123",
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
        phoneNumberVerifiedAt: null,
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        privyUserIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
      },
      update: {
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
        phoneNumberVerifiedAt: null,
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        privyUserIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
      },
    });
  });

  it("reads Stripe billing refs from billing lookup keys plus encrypted local columns", async () => {
    const prisma = {
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-billing-ref.stripe-customer-id",
            memberId: "member_123",
            value: "cus_123",
          }),
          stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
          stripeSubscriptionIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-billing-ref.stripe-subscription-id",
            memberId: "member_123",
            value: "sub_123",
          }),
          stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
        }),
      },
    } as never;

    await expect(
      readHostedMemberStripeBillingRef({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("reads billing eligibility without loading private Stripe identifiers", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      currentBillingPhase: "pulse_trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial",
      currentPeriodEnd: null,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:def456",
    });
    const prisma = {
      hostedMemberBillingRef: {
        findUnique,
      },
    } as never;

    await expect(
      readHostedMemberBillingEligibilityState({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      currentBillingPhase: "pulse_trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial",
      currentPeriodEnd: null,
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      select: {
        currentBillingPhase: true,
        currentBillingPlanCode: true,
        currentCheckoutOffer: true,
        currentPeriodEnd: true,
        scheduledBillingEffectiveAt: true,
        scheduledBillingPlanCode: true,
        stripeCustomerLookupKey: true,
        stripeSubscriptionLookupKey: true,
      },
    });
  });

  it("looks up Stripe billing refs with the matched billing slice intact", async () => {
    const member = createHostedMember();
    const findMany = vi.fn()
      .mockResolvedValueOnce([{
        member,
        memberId: member.id,
        stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-billing-ref.stripe-customer-id",
          memberId: member.id,
          value: "cus_123",
        }),
        stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionLookupKey: null,
      }])
      .mockResolvedValueOnce([{
        member,
        memberId: member.id,
        stripeCustomerIdEncrypted: null,
        stripeCustomerLookupKey: null,
        stripeSubscriptionIdEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-billing-ref.stripe-subscription-id",
          memberId: member.id,
          value: "sub_123",
        }),
        stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
      }]);
    const prisma = {
      hostedMemberBillingRef: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberStripeBillingRefByStripeCustomerId({
        prisma,
        stripeCustomerId: "cus_123",
      }),
    ).resolves.toEqual({
      billingRef: {
        memberId: member.id,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
      },
      core: member,
      matchedBy: "stripeCustomerId",
    });
    await expect(
      lookupHostedMemberStripeBillingRefByStripeSubscriptionId({
        prisma,
        stripeSubscriptionId: "sub_123",
      }),
    ).resolves.toEqual({
      billingRef: {
        memberId: member.id,
        stripeCustomerId: null,
        stripeSubscriptionId: "sub_123",
      },
      core: member,
      matchedBy: "stripeSubscriptionId",
    });

    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: {
        stripeCustomerLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-customer:v1:/u)],
        },
      },
      include: {
        member: true,
      },
    });
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: {
        stripeSubscriptionLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-subscription:v1:/u)],
        },
      },
      include: {
        member: true,
      },
    });
  });

  it("fails closed when rotated Stripe lookup candidates resolve to multiple members", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const findMany = vi.fn().mockResolvedValue([
      {
        member: createHostedMember({
          id: "member_v1",
        }),
        memberId: "member_v1",
        stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-billing-ref.stripe-customer-id",
          memberId: "member_v1",
          value: "cus_123",
        }),
        stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionLookupKey: null,
      },
      {
        member: createHostedMember({
          id: "member_v2",
        }),
        memberId: "member_v2",
        stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
          field: "hosted-member-billing-ref.stripe-customer-id",
          memberId: "member_v2",
          value: "cus_123",
        }),
        stripeCustomerLookupKey: "hbidx:stripe-customer:v2:def456",
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionLookupKey: null,
      },
    ]);
    const prisma = {
      hostedMemberBillingRef: {
        findMany,
      },
    } as never;

    await expect(
      lookupHostedMemberStripeBillingRefByStripeCustomerId({
        prisma,
        stripeCustomerId: "cus_123",
      }),
    ).rejects.toMatchObject({
      code: "STRIPE_BILLING_LOOKUP_AMBIGUOUS",
      httpStatus: 500,
      name: "HostedOnboardingError",
      retryable: true,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        stripeCustomerLookupKey: {
          in: [
            expect.stringMatching(/^hbidx:stripe-customer:v2:/u),
            expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
          ],
        },
      },
      include: {
        member: true,
      },
    });
  });

  it("writes Stripe billing refs through lookup keys and encrypted local columns", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const executeRaw = vi.fn().mockResolvedValue(0);
    const upsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
      pulseTrialStartSource: "web_onboarding",
      stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
      stripeSubscriptionIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-subscription-id",
        memberId: "member_123",
        value: "sub_123",
      }),
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
    });
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member_123" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }),
      },
      hostedMemberBillingRef: {
        findMany,
        upsert,
      },
    } as never;

    await expect(
      writeHostedMemberStripeBillingRefTx({
        memberId: "member_123",
        pulseTrialStartSource: "web_onboarding",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tx: prisma,
      }),
    ).resolves.toEqual({
      memberId: "member_123",
      pulseTrialStartSource: "web_onboarding",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        currentCheckoutOffer: null,
        currentPeriodEnd: null,
        currentPeriodStart: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        pulseTrialStartSource: "web_onboarding",
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
        stripeSubscriptionScheduleIdEncrypted: null,
        stripeSubscriptionScheduleLookupKey: null,
        usagePlanTransitionAt: null,
        usagePlanTransitionFromCode: null,
        usagePlanTransitionKind: null,
        usagePlanTransitionToCode: null,
      },
      update: {
        pulseTrialStartSource: "web_onboarding",
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      },
    });
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: {
        stripeCustomerLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-customer:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: {
        stripeSubscriptionLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-subscription:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
  });

  it("rejects Stripe billing ref writes after the member is suspended", async () => {
    const upsert = vi.fn();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member_123" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          suspendedAt: new Date("2026-07-20T12:00:00.000Z"),
        }),
      },
      hostedMemberBillingRef: {
        findMany: vi.fn(),
        upsert,
      },
    } as never;

    await expect(
      writeHostedMemberStripeBillingRefTx({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tx: prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
    });

    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects Stripe billing ref writes when another member already owns a rotated lookup candidate", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const findMany = vi.fn()
      .mockResolvedValueOnce([
        {
          memberId: "member_other",
        },
      ])
      .mockResolvedValueOnce([]);
    const executeRaw = vi.fn().mockResolvedValue(0);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member_123" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }),
      },
      hostedMemberBillingRef: {
        findMany,
        upsert,
      },
    } as never;

    await expect(
      writeHostedMemberStripeBillingRefTx({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tx: prisma,
      }),
    ).rejects.toMatchObject({
      code: "STRIPE_BILLING_IDENTITY_CONFLICT",
      httpStatus: 500,
      name: "HostedOnboardingError",
      retryable: true,
    });

    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: {
        stripeCustomerLookupKey: {
          in: [
            expect.stringMatching(/^hbidx:stripe-customer:v2:/u),
            expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
          ],
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("persists Stripe billing freshness markers when a Stripe source drives the write", async () => {
    const freshnessAt = new Date("2026-04-12T00:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({
      lastStripeEventCreatedAt: freshnessAt,
      memberId: "member_123",
      stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
      stripeSubscriptionIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-subscription-id",
        memberId: "member_123",
        value: "sub_123",
      }),
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
    });
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member_123" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }),
      },
      hostedMemberBillingRef: {
        findMany,
        upsert,
      },
    } as never;

    await expect(
      writeHostedMemberStripeBillingRefTx({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeEventCreatedAt: freshnessAt,
        stripeSubscriptionId: "sub_123",
        tx: prisma,
      }),
    ).resolves.toEqual({
      lastStripeEventCreatedAt: freshnessAt,
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        currentCheckoutOffer: null,
        currentPeriodEnd: null,
        currentPeriodStart: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        lastStripeEventCreatedAt: freshnessAt,
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        pulseTrialStartSource: null,
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
        stripeSubscriptionScheduleIdEncrypted: null,
        stripeSubscriptionScheduleLookupKey: null,
        usagePlanTransitionAt: null,
        usagePlanTransitionFromCode: null,
        usagePlanTransitionKind: null,
        usagePlanTransitionToCode: null,
      },
      update: {
        lastStripeEventCreatedAt: freshnessAt,
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      },
    });
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: {
        stripeCustomerLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-customer:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: {
        stripeSubscriptionLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-subscription:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
  });

  it("preserves attempt A and Session S when the invoice.paid billing write binds subscription X first", async () => {
    // applyStripeInvoicePaid reaches this existing ref owner through
    // writeHostedMemberStripeBillingTx without owning Checkout-attempt fields.
    const checkoutCreatedAt = new Date("2026-07-27T12:00:00.000Z");
    const invoicePaidAt = new Date("2026-07-27T12:01:00.000Z");
    const stripeCheckoutSessionIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-billing-ref.stripe-checkout-session-id",
      memberId: "member_123",
      value: "cs_S",
    });
    const stripeCustomerIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-billing-ref.stripe-customer-id",
      memberId: "member_123",
      value: "cus_X",
    });
    const stripeSubscriptionIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-billing-ref.stripe-subscription-id",
      memberId: "member_123",
      value: "sub_X",
    });
    const findMany = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({
      checkoutAttemptId: "attempt_A",
      checkoutCreatedAt,
      checkoutIntentHash: "intent_A",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      lastStripeEventCreatedAt: invoicePaidAt,
      memberId: "member_123",
      stripeCheckoutSessionIdEncrypted,
      stripeCheckoutSessionLookupKey: "hbidx:stripe-checkout-session:v1:S",
      stripeCustomerIdEncrypted,
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:X",
      stripeSubscriptionIdEncrypted,
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:X",
      stripeSubscriptionScheduleIdEncrypted: null,
      stripeSubscriptionScheduleLookupKey: null,
    });
    const prisma = {
      $queryRaw: createMemberRowLockQueryRaw(),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }),
      },
      hostedMemberBillingRef: {
        findMany,
        upsert,
      },
    } as never;

    await expect(writeHostedMemberStripeBillingRefTx({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_X",
      stripeEventCreatedAt: invoicePaidAt,
      stripeSubscriptionId: "sub_X",
      tx: prisma,
    })).resolves.toMatchObject({
      checkoutAttemptId: "attempt_A",
      checkoutCreatedAt,
      checkoutIntentHash: "intent_A",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      lastStripeEventCreatedAt: invoicePaidAt,
      stripeCheckoutSessionId: "cs_S",
      stripeCustomerId: "cus_X",
      stripeSubscriptionId: "sub_X",
    });

    const updateData = upsert.mock.calls[0]?.[0]?.update;
    expect(updateData).toEqual(expect.objectContaining({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      lastStripeEventCreatedAt: invoicePaidAt,
      stripeCustomerLookupKey: expect.stringMatching(
        /^hbidx:stripe-customer:v1:/u,
      ),
      stripeSubscriptionLookupKey: expect.stringMatching(
        /^hbidx:stripe-subscription:v1:/u,
      ),
    }));
    for (const field of [
      "checkoutAttemptId",
      "checkoutCreatedAt",
      "checkoutIntentHash",
      "stripeCheckoutSessionIdEncrypted",
      "stripeCheckoutSessionLookupKey",
    ]) {
      expect(updateData).not.toHaveProperty(field);
    }
  });

  it("persists Stripe billing plan and period markers from reconciliation", async () => {
    const currentBillingPlanCode = "launch_edge_monthly";
    const currentPeriodStart = new Date("2026-04-01T00:00:00.000Z");
    const currentPeriodEnd = new Date("2026-05-01T00:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({
      currentBillingPlanCode,
      currentPeriodEnd,
      currentPeriodStart,
      memberId: "member_123",
      stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
      stripeSubscriptionIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-subscription-id",
        memberId: "member_123",
        value: "sub_123",
      }),
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
    });
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member_123" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }),
      },
      hostedMemberBillingRef: {
        findMany,
        upsert,
      },
    } as never;

    await expect(
      writeHostedMemberStripeBillingRefTx({
        currentBillingPlanCode,
        currentPeriodEnd,
        currentPeriodStart,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tx: prisma,
      }),
    ).resolves.toMatchObject({
      currentBillingPlanCode,
      currentPeriodEnd,
      currentPeriodStart,
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: expect.objectContaining({
        currentBillingPlanCode,
        currentPeriodEnd,
        currentPeriodStart,
        memberId: "member_123",
      }),
      update: expect.objectContaining({
        currentBillingPlanCode,
        currentPeriodEnd,
        currentPeriodStart,
      }),
    });
  });

  it("binds Stripe customer ids without mutating the member row", async () => {
    const upsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
      stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
      stripeSubscriptionIdEncrypted: null,
      stripeSubscriptionLookupKey: null,
    });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }),
      },
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn().mockResolvedValue(null),
        upsert,
      },
    } as never;

    await expect(
      bindHostedMemberStripeCustomerIdIfMissingTx({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        tx: prisma,
      }),
    ).resolves.toEqual({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: null,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        memberId: "member_123",
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionLookupKey: null,
        stripeSubscriptionScheduleIdEncrypted: null,
      },
      update: expect.objectContaining({
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
      }),
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        stripeCustomerLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-customer:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
  });

  it("binds Stripe customer ids without clearing existing encrypted billing fields", async () => {
    const upsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
      stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:new",
      stripeSubscriptionIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-subscription-id",
        memberId: "member_123",
        value: "sub_existing",
      }),
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:existing",
    });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }),
      },
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerIdEncrypted: null,
          stripeCustomerLookupKey: null,
          stripeSubscriptionIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-billing-ref.stripe-subscription-id",
            memberId: "member_123",
            value: "sub_existing",
          }),
          stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:existing",
        }),
        upsert,
      },
    } as never;

    await expect(
      bindHostedMemberStripeCustomerIdIfMissingTx({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        tx: prisma,
      }),
    ).resolves.toEqual({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_existing",
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: {
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
      },
    }));
    expect(findMany).toHaveBeenCalledWith({
      where: {
        stripeCustomerLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-customer:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(upsert.mock.calls[0]?.[0]?.update).not.toHaveProperty("stripeSubscriptionIdEncrypted");
  });

  it("returns the existing Stripe billing slice when another writer already won the bind", async () => {
    const upsert = vi.fn();
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }),
      },
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-billing-ref.stripe-customer-id",
            memberId: "member_123",
            value: "cus_existing",
          }),
          stripeCustomerLookupKey: "hbidx:stripe-customer:v1:existing",
          stripeSubscriptionIdEncrypted: null,
          stripeSubscriptionLookupKey: null,
        }),
        upsert,
      },
    } as never;

    await expect(
      bindHostedMemberStripeCustomerIdIfMissingTx({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        tx: prisma,
      }),
    ).resolves.toEqual({
      memberId: "member_123",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        stripeCustomerLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-customer:v1:/u)],
        },
      },
      select: {
        memberId: true,
      },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reads the canonical aggregate from lookup-key tables plus encrypted local columns", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          ...createHostedMember(),
          billingRef: {
            memberId: "member_123",
            stripeCustomerIdEncrypted: await encryptHostedWebNullableString({
              field: "hosted-member-billing-ref.stripe-customer-id",
              memberId: "member_123",
              value: "cus_123",
            }),
            stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
            stripeSubscriptionIdEncrypted: await encryptHostedWebNullableString({
              field: "hosted-member-billing-ref.stripe-subscription-id",
              memberId: "member_123",
              value: "sub_123",
            }),
            stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
          },
          identity: {
            maskedPhoneNumberHint: "*** 4567",
            memberId: "member_123",
            phoneLookupKey: "hbidx:phone:v1:abc123",
            phoneNumberVerifiedAt: null,
            privyUserLookupKey: "hbidx:privy-user:v1:abc123",
            privyUserIdEncrypted: await encryptHostedWebNullableString({
              field: "hosted-member-identity.privy-user-id",
              memberId: "member_123",
              value: "did:privy:user_123",
            }),
            signupPhoneCodeSendAttemptId: null,
            signupPhoneCodeSendAttemptStartedAt: null,
            signupPhoneCodeSentAt: null,
            signupPhoneNumberEncrypted: null,
            walletAddressLookupKey: "hbidx:wallet-address:v1:abc123",
            walletAddressEncrypted: await encryptHostedWebNullableString({
              field: "hosted-member-identity.wallet-address",
              memberId: "member_123",
              value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
            }),
            walletChainType: "ethereum",
            walletCreatedAt: null,
            walletProvider: "privy",
          },
          routing: {
            linqChatIdEncrypted: await encryptHostedWebNullableString({
              field: "hosted-member-routing.home-linq-chat-id",
              memberId: "member_123",
              value: "chat_123",
            }),
            linqChatLookupKey: "hbidx:linq-chat:v1:abc123",
            linqRecipientPhoneEncrypted: null,
            memberId: "member_123",
            pendingLinqChatIdEncrypted: null,
            pendingLinqRecipientPhoneEncrypted: null,
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: "tg_user_123",
          },
        }),
      },
    } as never;

    await expect(
      readHostedMemberSnapshot({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.not_started,
        createdAt: new Date("2026-04-06T00:00:00.000Z"),
        id: "member_123",
        suspendedAt: null,
        updatedAt: new Date("2026-04-06T00:00:00.000Z"),
      },
      identity: {
        maskedPhoneNumberHint: "*** 4567",
        memberId: "member_123",
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumber: null,
        phoneNumberVerifiedAt: null,
        privyUserId: "did:privy:user_123",
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
      routing: {
        hasPendingLinqRouteState: false,
        linqChatId: "chat_123",
        linqChatLookupKey: "hbidx:linq-chat:v1:abc123",
        linqRecipientPhone: null,
        linqRecipientPhoneLookupKey: null,
        memberId: "member_123",
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        replyAliasLookupKey: null,
        telegramThreadId: null,
        telegramUserId: null,
        telegramUserLookupKey: "tg_user_123",
      },
    });
  });

  it("reads only messaging setup state needed by Privy completion", async () => {
    const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: "456",
    });
    const findUnique = vi.fn().mockResolvedValue({
      identity: {
        phoneLookupKey: "hbidx:phone:v1:abc123",
      },
      routing: {
        memberId: "member_123",
        telegramUserIdEncrypted: routingPrivateColumns.telegramUserIdEncrypted,
      },
    });
    const prisma = {
      hostedMember: {
        findUnique,
      },
    } as never;

    await expect(
      readHostedMemberMessagingSetupState({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      identity: {
        phoneLookupKey: "hbidx:phone:v1:abc123",
      },
      routing: {
        linqChatId: null,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        telegramThreadId: null,
        telegramUserId: "456",
      },
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      select: {
        identity: {
          select: {
            phoneLookupKey: true,
          },
        },
        routing: true,
      },
    });
  });

});

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function setHostedContactPrivacyKeyring(input: {
  currentVersion: string;
  keysByVersion: Record<string, string>;
}): void {
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.keysByVersion)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function createHostedMember(overrides: Partial<HostedMember> = {}): HostedMember {
  return {
    assistantPersona: null,
    assistantPersonaCausalSeq: null,
    assistantDetail: null,
    assistantDetailCausalSeq: null,
    assistantHumor: null,
    assistantHumorCausalSeq: null,
    assistantModelPreference: null,
    assistantProviderPreference: null,
    assistantReasoningEffortPreference: null,
    assistantPush: null,
    assistantPushCausalSeq: null,
    assistantUnhinged: null,
    assistantUnhingedCausalSeq: null,
    assistantTone: null,
    assistantToneCausalSeq: null,
    assistantVoice: null,
    assistantVoiceCausalSeq: null,
    initialOnboardingCompletedAt: null,
    billingStatus: HostedBillingStatus.not_started,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    signupNotificationContextEncrypted: null,
    signupNotificationContextExpiresAt: null,
    signupNotificationEmailAttemptedAt: null,
    signupWelcomeEmailAttemptedAt: null,
    suspendedAt: null,
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    usageCreditBalanceUsdMicros: null,
    usageCreditLedgerVersion: null,
    ...overrides,
  };
}

function createHostedMemberRoutingLookupRecord(input: {
  linqChatLookupKey?: string | null;
  member: HostedMember;
  pendingLinqParticipantContactKind?: string | null;
  pendingLinqParticipantContactLookupKey?: string | null;
  pendingLinqParticipantContactObservedAt?: Date | null;
}) {
  return {
    linqChatIdEncrypted: null,
    linqChatLookupKey: input.linqChatLookupKey ?? null,
    linqRecipientPhoneEncrypted: null,
    member: input.member,
    memberId: input.member.id,
    pendingLinqChatIdEncrypted: null,
    pendingLinqParticipantContactEncrypted: null,
    pendingLinqParticipantContactKind: input.pendingLinqParticipantContactKind ?? null,
    pendingLinqParticipantContactLookupKey:
      input.pendingLinqParticipantContactLookupKey ?? null,
    pendingLinqParticipantContactObservedAt:
      input.pendingLinqParticipantContactObservedAt ?? null,
    pendingLinqRecipientPhoneEncrypted: null,
    replyAliasLookupKey: null,
    telegramUserIdEncrypted: null,
    telegramUserLookupKey: null,
  };
}
