import {
  Prisma,
  type HostedMember,
  HostedBillingStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";

import {
  composeHostedMemberSnapshot,
  readHostedMemberSnapshot,
  type HostedMemberCoreState,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  bindHostedMemberStripeCustomerIdIfMissing,
  findHostedMemberByStripeCustomerId,
  findHostedMemberByStripeSubscriptionId,
  readHostedMemberStripeBillingRef,
  type HostedMemberStripeBillingRefSnapshot,
  writeHostedMemberStripeBillingRef,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  findHostedMemberByPhoneNumber,
  findHostedMemberByPhoneLookupKey,
  findHostedMemberByPrivyUserId,
  type HostedMemberIdentityState,
  upsertHostedMemberIdentity,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import {
  findHostedMemberByTelegramUserId,
  findHostedMemberByTelegramUserLookupKey,
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
  upsertHostedMemberLinqChatBinding,
  upsertHostedMemberTelegramRoutingBinding,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";

describe("hosted-member-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      memberId: core.id,
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

  it("finds a member by privy user id from the identity table", async () => {
    const member = createHostedMember();
    const findFirst = vi.fn().mockResolvedValue({
      member,
    });
    const prisma = {
      hostedMemberIdentity: {
        findFirst,
      },
    } as never;

    await expect(
      findHostedMemberByPrivyUserId({
        prisma,
        privyUserId: "did:privy:user_123",
      }),
    ).resolves.toEqual(member);

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

  it("finds a member by phone lookup key from the identity table", async () => {
    const member = createHostedMember();
    const prisma = {
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          member,
        }),
      },
    } as never;

    await expect(
      findHostedMemberByPhoneLookupKey({
        phoneLookupKey: "hbidx:phone:v1:abc123",
        prisma,
      }),
    ).resolves.toEqual(member);
  });

  it("finds a member by raw phone number through read candidates", async () => {
    const member = createHostedMember();
    const findFirst = vi.fn().mockResolvedValue({
      member,
    });
    const prisma = {
      hostedMemberIdentity: {
        findFirst,
      },
    } as never;

    await expect(
      findHostedMemberByPhoneNumber({
        phoneNumber: "+15551234567",
        prisma,
      }),
    ).resolves.toEqual(member);

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

  it("finds a member by Telegram lookup key from the routing table", async () => {
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_123",
            suspendedAt: null,
          },
        }),
      },
    } as never;

    await expect(
      findHostedMemberByTelegramUserLookupKey({
        prisma,
        telegramUserLookupKey: "tg_user_123",
      }),
    ).resolves.toEqual({
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      suspendedAt: null,
    });
  });

  it("finds a member by raw Telegram user id through read candidates", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
    });
    const prisma = {
      hostedMemberRouting: {
        findFirst,
      },
    } as never;

    await expect(
      findHostedMemberByTelegramUserId({
        prisma,
        telegramUserId: "456",
      }),
    ).resolves.toEqual({
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      suspendedAt: null,
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        telegramUserLookupKey: {
          in: [expect.stringMatching(/^hbidx:telegram-user:v1:/u)],
        },
      },
      select: {
        member: {
          select: {
            billingStatus: true,
            id: true,
            suspendedAt: true,
          },
        },
      },
    });
  });

  it("reads member routing state from routing lookup keys plus encrypted local columns", async () => {
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: encryptHostedWebNullableString({
            field: "hosted-member-routing.linq-chat-id",
            memberId: "member_123",
            value: "chat_123",
          }),
          linqChatLookupKey: "hbidx:linq-chat:v1:abc123",
          memberId: "member_123",
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
      memberId: "member_123",
      telegramUserLookupKey: "tg_user_123",
    });
  });

  it("upserts Linq chat bindings into the routing table with encrypted local storage", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      hostedMemberRouting: {
        updateMany,
        upsert,
      },
    } as never;

    await upsertHostedMemberLinqChatBinding({
      linqChatId: "chat_123",
      memberId: "member_123",
      prisma,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        NOT: {
          memberId: "member_123",
        },
      },
      data: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatIdEncrypted: expect.stringMatching(/^hbds:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        memberId: "member_123",
        telegramUserLookupKey: null,
        telegramUserIdEncrypted: null,
      },
      update: {
        linqChatIdEncrypted: expect.stringMatching(/^hbds:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
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
      upsertHostedMemberLinqChatBinding({
        linqChatId: "chat_123",
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("upserts Telegram bindings into the routing table", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      hostedMemberRouting: {
        upsert,
      },
    } as never;

    await upsertHostedMemberTelegramRoutingBinding({
      memberId: "member_123",
      prisma,
      telegramUserId: "456",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        memberId: "member_123",
        telegramUserIdEncrypted: expect.stringMatching(/^hbds:/u),
        telegramUserLookupKey: expect.stringMatching(/^hbidx:telegram-user:v1:/u),
      },
      update: {
        telegramUserIdEncrypted: expect.stringMatching(/^hbds:/u),
        telegramUserLookupKey: expect.stringMatching(/^hbidx:telegram-user:v1:/u),
      },
    });
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

  it("finds members by Stripe billing refs from lookup-key columns", async () => {
    const member = createHostedMember();
    const findFirst = vi.fn()
      .mockResolvedValueOnce({
        member,
      })
      .mockResolvedValueOnce({
        member,
      });
    const prisma = {
      hostedMemberBillingRef: {
        findFirst,
      },
    } as never;

    await expect(
      findHostedMemberByStripeCustomerId({
        prisma,
        stripeCustomerId: "cus_123",
      }),
    ).resolves.toEqual(member);
    await expect(
      findHostedMemberByStripeSubscriptionId({
        prisma,
        stripeSubscriptionId: "sub_123",
      }),
    ).resolves.toEqual(member);

    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        stripeCustomerLookupKey: {
          in: [expect.stringMatching(/^hbidx:stripe-customer:v1:/u)],
        },
      },
      include: {
        member: true,
      },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
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

  it("writes Stripe billing refs through lookup keys and encrypted local columns", async () => {
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
      hostedMemberBillingRef: {
        upsert,
      },
    } as never;

    await expect(
      writeHostedMemberStripeBillingRef({
        memberId: "member_123",
        prisma,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
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
  });

  it("binds Stripe customer ids without mutating the member row", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert,
      },
    } as never;

    await expect(
      bindHostedMemberStripeCustomerIdIfMissing({
        memberId: "member_123",
        prisma,
        stripeCustomerId: "cus_123",
      }),
    ).resolves.toBe(true);

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
  });

  it("binds Stripe customer ids without clearing existing encrypted billing fields", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerIdEncrypted: null,
          stripeCustomerLookupKey: null,
          stripeSubscriptionIdEncrypted: "hbds:v1:existing-subscription",
          stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:existing",
        }),
        upsert,
      },
    } as never;

    await expect(
      bindHostedMemberStripeCustomerIdIfMissing({
        memberId: "member_123",
        prisma,
        stripeCustomerId: "cus_123",
      }),
    ).resolves.toBe(true);

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: {
        stripeCustomerIdEncrypted: expect.stringMatching(/^hbds:/u),
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
      },
    }));
    expect(upsert.mock.calls[0]?.[0]?.update).not.toHaveProperty("stripeSubscriptionIdEncrypted");
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
              field: "hosted-member-routing.linq-chat-id",
              memberId: "member_123",
              value: "chat_123",
            }),
            linqChatLookupKey: "hbidx:linq-chat:v1:abc123",
            memberId: "member_123",
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
        memberId: "member_123",
        telegramUserLookupKey: "tg_user_123",
      },
    });
  });
});

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
