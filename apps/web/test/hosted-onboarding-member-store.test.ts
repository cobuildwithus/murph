import {
  Prisma,
  type HostedMember,
  HostedBillingStatus,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberRoutingTelegramPrivateState,
} from "@/src/lib/hosted-onboarding/member-private-codecs";

import {
  composeHostedMemberSnapshot,
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
  lookupHostedMemberRoutingByTelegramUserId,
  lookupHostedMemberRoutingByTelegramUserLookupKey,
  readHostedMemberIdByReplyAliasLookupKey,
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberReplyAliasLookupKeyTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";

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

  it("looks up identity by privy user id without exposing blind-index columns", async () => {
    const member = createHostedMember();
    const findFirst = vi.fn().mockResolvedValue({
      maskedPhoneNumberHint: "*** 4567",
      member,
      memberId: member.id,
      phoneLookupKey: "hbidx:phone:v1:abc123",
      phoneNumberVerifiedAt: null,
      privyUserIdEncrypted: encryptHostedWebNullableString({
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
    });
    const prisma = {
      hostedMemberIdentity: {
        findFirst,
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

    expect(findFirst).toHaveBeenCalledWith({
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
          signupPhoneNumberEncrypted: encryptHostedWebNullableString({
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
    const findFirst = vi.fn().mockResolvedValue({
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
    });
    const prisma = {
      hostedMemberIdentity: {
        findFirst,
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

    expect(findFirst).toHaveBeenCalledWith({
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

  it("looks up routing by Telegram lookup key without exposing the blind index", async () => {
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: encryptHostedWebNullableString({
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
        pendingLinqRecipientPhoneEncrypted: true,
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
        pendingLinqRecipientPhoneEncrypted: true,
        telegramUserLookupKey: true,
        telegramUserIdEncrypted: true,
      },
    });
  });

  it("reads member routing state from routing lookup keys plus encrypted local columns", async () => {
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: encryptHostedWebNullableString({
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
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: "tg_user_123",
    });
  });

  it("reads a persisted Telegram thread target alongside the raw Telegram user id", async () => {
    const telegramPrivateColumns = buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
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
      pendingLinqRecipientPhone: null,
      telegramThreadId: "456:business:biz-42:dm-topic:9",
      telegramUserId: "456",
      telegramUserLookupKey: "tg_user_456",
    });
  });

  it("fails closed when the persisted Telegram private payload uses an unknown schema", async () => {
    const telegramUserIdEncrypted = encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: JSON.stringify({
        schema: "murph.hosted-member-routing.telegram.v99",
        telegramThreadId: "456:business:biz-42:dm-topic:9",
        telegramUserId: "456",
      }),
    });

    expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted,
      }),
    ).toEqual({
      telegramThreadId: null,
      telegramUserId: null,
    });
  });

  it("reads legacy plaintext Telegram private payloads as a direct user binding", async () => {
    const telegramUserIdEncrypted = encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: "456",
    });

    expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted,
      }),
    ).toEqual({
      telegramThreadId: "456",
      telegramUserId: "456",
    });
  });

  it("fails closed when a persisted Telegram private payload points at a bare group chat id", async () => {
    const telegramUserIdEncrypted = encryptHostedWebNullableString({
      field: "hosted-member-routing.telegram-user-id",
      memberId: "member_123",
      value: "-1009999999999",
    });

    expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted,
      }),
    ).toEqual({
      telegramThreadId: null,
      telegramUserId: null,
    });
  });

  it("looks up the routed member by reply-alias lookup key", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      memberId: "member_123",
    });
    const prisma = {
      hostedMemberRouting: {
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
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
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
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
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
        pendingLinqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        NOT: {
          memberId: "member_123",
        },
      },
      data: {
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatIdEncrypted: expect.stringMatching(/^hbds:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hbds:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        memberId: "member_123",
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserLookupKey: null,
        telegramUserIdEncrypted: null,
      },
      update: {
        linqChatIdEncrypted: expect.stringMatching(/^hbds:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hbds:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
      },
    });
  });

  it("retries once when the exclusive Linq binding races another writer", async () => {
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
    ).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledTimes(4);
    expect(upsert).toHaveBeenCalledTimes(2);
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
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hbds:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        memberId: "member_123",
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
      update: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hbds:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
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

  it("upserts Telegram bindings into the routing table", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: queryRaw,
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
    expect(queryRaw).toHaveBeenCalledTimes(1);
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
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserIdEncrypted: expect.stringMatching(/^hbds:/u),
        telegramUserLookupKey: expect.stringMatching(/^hbidx:telegram-user:v1:/u),
      },
      update: {
        telegramUserIdEncrypted: expect.stringMatching(/^hbds:/u),
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
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: queryRaw,
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
    expect(queryRaw).toHaveBeenCalledTimes(1);
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
    const existingTelegramPrivateColumns = buildHostedMemberRoutingPrivateColumns({
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
      $queryRaw: vi.fn().mockResolvedValue([]),
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
    expect(
      readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_123",
        telegramUserIdEncrypted: upsertCall.update.telegramUserIdEncrypted,
      }),
    ).toEqual({
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
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
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
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts identity rows through blind lookup keys and encrypted local columns", async () => {
    const upsert = vi.fn().mockResolvedValue({
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:abc123",
      phoneNumberEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-identity.phone-number",
        memberId: "member_123",
        value: "+15551234567",
      }),
      phoneNumberVerifiedAt: null,
      privyUserLookupKey: "hbidx:privy-user:v1:abc123",
      privyUserIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-identity.privy-user-id",
        memberId: "member_123",
        value: "did:privy:user_123",
      }),
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumberEncrypted: null,
      walletAddressLookupKey: "hbidx:wallet-address:v1:abc123",
      walletAddressEncrypted: encryptHostedWebNullableString({
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
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
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

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        maskedPhoneNumberHint: "*** 4567",
        memberId: "member_123",
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberEncrypted: expect.stringMatching(/^hbds:/u),
        phoneNumberVerifiedAt: null,
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        privyUserIdEncrypted: expect.stringMatching(/^hbds:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
        walletAddressLookupKey: expect.stringMatching(/^hbidx:wallet-address:v1:/u),
        walletAddressEncrypted: expect.stringMatching(/^hbds:/u),
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
      update: {
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberEncrypted: expect.stringMatching(/^hbds:/u),
        phoneNumberVerifiedAt: null,
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        privyUserIdEncrypted: expect.stringMatching(/^hbds:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
        walletAddressLookupKey: expect.stringMatching(/^hbidx:wallet-address:v1:/u),
        walletAddressEncrypted: expect.stringMatching(/^hbds:/u),
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
    });
  });

  it("reads Stripe billing refs from billing lookup keys plus encrypted local columns", async () => {
    const prisma = {
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerIdEncrypted: encryptHostedWebNullableString({
            field: "hosted-member-billing-ref.stripe-customer-id",
            memberId: "member_123",
            value: "cus_123",
          }),
          stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
          stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
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
        stripeCustomerIdEncrypted: encryptHostedWebNullableString({
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
        stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
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
        stripeCustomerIdEncrypted: encryptHostedWebNullableString({
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
        stripeCustomerIdEncrypted: encryptHostedWebNullableString({
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
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
      stripeCustomerIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
      stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-subscription-id",
        memberId: "member_123",
        value: "sub_123",
      }),
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
    });
    const prisma = {
      $queryRaw: queryRaw,
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
        memberId: "member_123",
        stripeCustomerIdEncrypted: expect.stringMatching(/^hbds:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hbds:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      },
      update: {
        stripeCustomerIdEncrypted: expect.stringMatching(/^hbds:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hbds:/u),
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
    expect(queryRaw).toHaveBeenCalledTimes(2);
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
    const queryRaw = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: queryRaw,
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
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("persists Stripe billing freshness markers when a Stripe source drives the write", async () => {
    const freshnessAt = new Date("2026-04-12T00:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({
      lastStripeEventCreatedAt: freshnessAt,
      memberId: "member_123",
      stripeCustomerIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
      stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-subscription-id",
        memberId: "member_123",
        value: "sub_123",
      }),
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
    });
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
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
        lastStripeEventCreatedAt: freshnessAt,
        memberId: "member_123",
        stripeCustomerIdEncrypted: expect.stringMatching(/^hbds:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hbds:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      },
      update: {
        lastStripeEventCreatedAt: freshnessAt,
        stripeCustomerIdEncrypted: expect.stringMatching(/^hbds:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: expect.stringMatching(/^hbds:/u),
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

  it("binds Stripe customer ids without mutating the member row", async () => {
    const upsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
      stripeCustomerIdEncrypted: encryptHostedWebNullableString({
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
        stripeCustomerIdEncrypted: expect.stringMatching(/^hbds:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionLookupKey: null,
      },
      update: expect.objectContaining({
        stripeCustomerIdEncrypted: expect.stringMatching(/^hbds:/u),
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
      stripeCustomerIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:new",
      stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-subscription-id",
        memberId: "member_123",
        value: "sub_existing",
      }),
      stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:existing",
    });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerIdEncrypted: null,
          stripeCustomerLookupKey: null,
          stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
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
        stripeCustomerIdEncrypted: expect.stringMatching(/^hbds:/u),
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
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerIdEncrypted: encryptHostedWebNullableString({
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
            stripeCustomerIdEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-billing-ref.stripe-customer-id",
              memberId: "member_123",
              value: "cus_123",
            }),
            stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
            stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
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
            privyUserIdEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-identity.privy-user-id",
              memberId: "member_123",
              value: "did:privy:user_123",
            }),
            signupPhoneCodeSendAttemptId: null,
            signupPhoneCodeSendAttemptStartedAt: null,
            signupPhoneCodeSentAt: null,
            signupPhoneNumberEncrypted: null,
            walletAddressLookupKey: "hbidx:wallet-address:v1:abc123",
            walletAddressEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-identity.wallet-address",
              memberId: "member_123",
              value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
            }),
            walletChainType: "ethereum",
            walletCreatedAt: null,
            walletProvider: "privy",
          },
          routing: {
            linqChatIdEncrypted: encryptHostedWebNullableString({
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
        pendingLinqRecipientPhone: null,
        telegramThreadId: null,
        telegramUserId: null,
        telegramUserLookupKey: "tg_user_123",
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
    suspendedAt: null,
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    ...overrides,
  };
}
