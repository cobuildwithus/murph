import {
  Prisma,
  type HostedMember,
  HostedBillingStatus,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  createHostedEmailLookupKeyReadCandidates,
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
  composeHostedMemberSnapshot,
  lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberMessagingSetupState,
  readHostedMemberSnapshot,
  type HostedMemberCoreState,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  bindHostedMemberStripeCustomerIdIfMissingTx,
  lookupHostedMemberStripeBillingRefByStripeCustomerId,
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
  readHostedMemberStripeBillingRef,
  type HostedMemberStripeBillingRefSnapshot,
  writeHostedMemberStripeBillingRefTx,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  lookupHostedMemberIdentityByPhoneLookupKey,
  lookupHostedMemberIdentityByPhoneNumber,
  lookupHostedMemberIdentityByPrivyUserId,
  type HostedMemberIdentityState,
  upsertHostedMemberIdentity,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import {
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberRoutingByPendingLinqParticipantContact,
  lookupHostedMemberRoutingByTelegramUserId,
  lookupHostedMemberRoutingByTelegramUserLookupKey,
  readHostedMemberIdByReplyAliasLookupKey,
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
  upsertHostedMemberHomeLinqBindingTx,
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

  afterEach(() => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousHostedContactPrivacyKeys);
    restoreEnvValue(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      previousHostedContactPrivacyCurrentKeyVersion,
    );
    clearHostedOnboardingEnvCache();
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
        linqRecipientPhoneEncrypted: true,
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
        pendingLinqParticipantContactEncrypted: true,
        pendingLinqParticipantContactKind: true,
        pendingLinqParticipantContactLookupKey: true,
        pendingLinqParticipantContactObservedAt: true,
        pendingLinqRecipientPhoneEncrypted: true,
        replyAliasLookupKey: true,
        telegramUserLookupKey: true,
        telegramUserIdEncrypted: true,
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
        linqRecipientPhoneEncrypted: true,
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
        pendingLinqParticipantContactEncrypted: true,
        pendingLinqParticipantContactKind: true,
        pendingLinqParticipantContactLookupKey: true,
        pendingLinqParticipantContactObservedAt: true,
        pendingLinqRecipientPhoneEncrypted: true,
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
      linqChatId: "chat_123",
      linqRecipientPhone: null,
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
      linqChatId: null,
      linqRecipientPhone: null,
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
      replyAliasLookupKey: "  replyalias1234  ",
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
        replyAliasLookupKey: "replyalias1234",
        telegramUserLookupKey: null,
        telegramUserIdEncrypted: null,
      },
      update: {
        replyAliasLookupKey: "replyalias1234",
      },
    });
  });

  it("upserts home Linq chat bindings into the routing table with encrypted local storage", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      hostedMemberRouting: {
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

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        linqChatLookupKey: {
          in: [expect.stringMatching(/^hbidx:linq-chat:v1:/u)],
        },
        NOT: {
          memberId: "member_123",
        },
      },
      data: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqRecipientPhoneEncrypted: null,
        linqRecipientPhoneLookupKey: null,
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
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
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
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
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
      },
    });
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
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      hostedMemberRouting: {
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

    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        linqChatLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:linq-chat:v2:/u),
            expect.stringMatching(/^hbidx:linq-chat:v1:/u),
          ]),
        },
      }),
    }));
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
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
      hostedMemberRouting: {
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
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      hostedMemberRouting: {
        upsert,
      },
    } as never;

    await upsertHostedMemberHomeLinqRecipientPhoneTx({
      clearPending: true,
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550100001",
    });

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

  it("counts active home-line assignments by recipient phone even before a home chat is bound", async () => {
    const homePhoneOne = "+15550100001";
    const homePhoneTwo = "+15550100002";
    const findMany = vi.fn().mockResolvedValue([
      {
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homePhoneOne),
      },
      {
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homePhoneOne),
      },
      {
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homePhoneTwo),
      },
    ]);
    const prisma = {
      hostedMemberRouting: {
        findMany,
      },
    } as never;

    await expect(
      countHostedMemberHomeLinqBindingsByRecipientPhone({
        prisma,
        recipientPhones: [homePhoneOne, homePhoneTwo],
      }),
    ).resolves.toEqual(
      new Map([
        [homePhoneOne, 2],
        [homePhoneTwo, 1],
      ]),
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        linqRecipientPhoneLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:phone:v1:/u),
            expect.stringMatching(/^hbidx:phone:v1:/u),
          ]),
        },
        member: {
          is: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
        },
      },
      select: {
        linqRecipientPhoneLookupKey: true,
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
    const findMany = vi.fn().mockResolvedValue([
      {
        linqRecipientPhoneLookupKey: previousLookupKey,
      },
      {
        linqRecipientPhoneLookupKey: currentLookupKey,
      },
    ]);
    const prisma = {
      hostedMemberRouting: {
        findMany,
      },
    } as never;

    await expect(
      countHostedMemberHomeLinqBindingsByRecipientPhone({
        prisma,
        recipientPhones: [homePhone],
      }),
    ).resolves.toEqual(new Map([[homePhone, 2]]));

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        linqRecipientPhoneLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:phone:v2:/u),
            expect.stringMatching(/^hbidx:phone:v1:/u),
          ]),
        },
      }),
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
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        findMany,
        findUnique: vi.fn().mockResolvedValue(null),
        upsert,
      },
    } as never;

    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: "member_123",
      prisma,
      telegramUserId: "456",
    });

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
  });

  it("refreshes the same member's Telegram lookup key to the current rotation version", async () => {
    setHostedContactPrivacyKeyring({
      currentVersion: "v2",
      keysByVersion: {
        v1: TEST_CONTACT_PRIVACY_KEY,
        v2: TEST_CONTACT_PRIVACY_ROTATED_KEY,
      },
    });

    const findMany = vi.fn().mockResolvedValue([
      {
        memberId: "member_123",
      },
    ]);
    const executeRaw = vi.fn().mockResolvedValue(0);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        findMany,
        findUnique: vi.fn().mockResolvedValue(null),
        upsert,
      },
    } as never;

    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: "member_123",
      prisma,
      telegramUserId: "456",
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
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedMemberRouting: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          telegramUserIdEncrypted: existingTelegramPrivateColumns.telegramUserIdEncrypted,
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
      telegramThreadId: "456:business:biz-42:dm-topic:9",
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
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $executeRaw: executeRaw,
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
    ).resolves.toEqual({
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
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
        stripeSubscriptionScheduleIdEncrypted: null,
        stripeSubscriptionScheduleLookupKey: null,
      },
      update: {
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
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
        stripeCustomerIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
        stripeSubscriptionScheduleIdEncrypted: null,
        stripeSubscriptionScheduleLookupKey: null,
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
        linqChatId: "chat_123",
        linqRecipientPhone: null,
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
        telegramThreadId: "456",
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
    billingStatus: HostedBillingStatus.not_started,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    signupNotificationEmailAttemptedAt: null,
    signupWelcomeEmailAttemptedAt: null,
    suspendedAt: null,
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
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
