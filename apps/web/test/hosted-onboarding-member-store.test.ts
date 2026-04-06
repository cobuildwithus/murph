import { type HostedMember, HostedBillingStatus, HostedMemberStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  bindHostedMemberStripeCustomerIdIfMissing,
  findHostedMemberByPhoneLookupKey,
  findHostedMemberByPrivyUserId,
  findHostedMemberByStripeCustomerId,
  findHostedMemberByStripeSubscriptionId,
  findHostedMemberByTelegramUserLookupKey,
  readHostedMemberStripeBillingRef,
  readHostedMemberRoutingState,
  syncHostedMemberPrivacyFoundationFromMember,
  upsertHostedMemberLinqChatBinding,
  upsertHostedMemberTelegramRoutingBinding,
  writeHostedMemberStripeBillingRef,
} from "@/src/lib/hosted-onboarding/hosted-member-store";

describe("hosted-member-store", () => {
  it("finds a member by privy user id from the additive identity table", async () => {
    const member = createHostedMember({
      privyUserId: "did:privy:user_123",
    });
    const hostedMemberFindUnique = vi.fn();
    const prisma = {
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          member,
        }),
      },
    } as never;

    await expect(
      findHostedMemberByPrivyUserId({
        prisma,
        privyUserId: "did:privy:user_123",
      }),
    ).resolves.toEqual(member);
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
  });

  it("falls back to the legacy member row when the additive phone identity row is missing", async () => {
    const member = createHostedMember();
    const hostedMemberFindUnique = vi.fn().mockResolvedValue(member);
    const prisma = {
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never;

    await expect(
      findHostedMemberByPhoneLookupKey({
        phoneLookupKey: "hbidx:phone:v1:abc123",
        prisma,
      }),
    ).resolves.toEqual(member);
    expect(hostedMemberFindUnique).toHaveBeenCalledWith({
      where: {
        normalizedPhoneNumber: "hbidx:phone:v1:abc123",
      },
    });
  });

  it("finds a member by Telegram lookup key from the additive routing table", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.active,
      telegramUserId: "tg_user_123",
    });
    const hostedMemberFindUnique = vi.fn();
    const prisma = {
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member,
        }),
      },
    } as never;

    await expect(
      findHostedMemberByTelegramUserLookupKey({
        prisma,
        telegramUserId: "tg_user_123",
      }),
    ).resolves.toEqual(member);
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
  });

  it("reads member routing state from the additive routing table", async () => {
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatId: "chat_123",
          memberId: "member_123",
          telegramUserId: "tg_user_123",
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
      telegramUserId: "tg_user_123",
    });
  });

  it("upserts Linq chat bindings into the additive routing table only", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      hostedMemberRouting: {
        upsert,
      },
    } as never;

    await upsertHostedMemberLinqChatBinding({
      linqChatId: "chat_123",
      memberId: "member_123",
      prisma,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        memberId: "member_123",
        linqChatId: "chat_123",
        telegramUserId: null,
      },
      update: {
        linqChatId: "chat_123",
      },
    });
  });

  it("upserts Telegram bindings into the additive routing table and clears stored usernames", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      hostedMemberRouting: {
        upsert,
      },
    } as never;

    await upsertHostedMemberTelegramRoutingBinding({
      memberId: "member_123",
      prisma,
      telegramUserId: "tg_user_123",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        memberId: "member_123",
        linqChatId: null,
        telegramUserId: "tg_user_123",
      },
      update: {
        telegramUserId: "tg_user_123",
      },
    });
  });

  it("reads Stripe billing refs from the additive table without falling back to legacy member columns", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(createHostedMember({
          stripeCustomerId: "cus_legacy_123",
        })),
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            memberId: "member_123",
            stripeCustomerId: "cus_additive_123",
            stripeLatestBillingEventCreatedAt: null,
            stripeLatestBillingEventId: null,
            stripeLatestCheckoutSessionId: null,
            stripeSubscriptionId: null,
          })
          .mockResolvedValueOnce(null),
      },
    } as never;

    await expect(
      readHostedMemberStripeBillingRef({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      memberId: "member_123",
      stripeCustomerId: "cus_additive_123",
      stripeLatestBillingEventCreatedAt: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
    });

    await expect(
      readHostedMemberStripeBillingRef({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toBeNull();
  });

  it("finds members by Stripe billing refs from the additive table", async () => {
    const member = createHostedMember({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    const hostedMemberFindUnique = vi.fn();
    const prisma = {
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            member,
          })
          .mockResolvedValueOnce({
            member,
          }),
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
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
  });

  it("writes Stripe billing refs through the additive billing table without mutating legacy member columns", async () => {
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventCreatedAt: null,
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
    });
    const prisma = {
      hostedMember: {
        update,
      },
      hostedMemberBillingRef: {
        upsert,
      },
    } as never;

    await expect(
      writeHostedMemberStripeBillingRef({
        memberId: "member_123",
        prisma,
        stripeCustomerId: "cus_123",
        stripeLatestBillingEventId: "evt_123",
        stripeLatestCheckoutSessionId: "cs_123",
        stripeSubscriptionId: "sub_123",
      }),
    ).resolves.toEqual({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventCreatedAt: null,
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
    });

    expect(update).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeLatestBillingEventCreatedAt: null,
        stripeLatestBillingEventId: "evt_123",
        stripeLatestCheckoutSessionId: "cs_123",
        stripeSubscriptionId: "sub_123",
      },
      update: {
        stripeCustomerId: "cus_123",
        stripeLatestBillingEventId: "evt_123",
        stripeLatestCheckoutSessionId: "cs_123",
        stripeSubscriptionId: "sub_123",
      },
    });
  });

  it("binds Stripe customer ids through the helper without reopening the service layer to raw hosted-member writes", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        updateMany,
      },
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

    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeLatestBillingEventCreatedAt: null,
        stripeLatestBillingEventId: null,
        stripeLatestCheckoutSessionId: null,
        stripeSubscriptionId: null,
      },
      update: {
        stripeCustomerId: "cus_123",
      },
    });
  });

  it("syncs identity refs and seeds missing billing refs without rewriting routing ownership", async () => {
    const hostedMemberIdentityUpsert = vi.fn().mockResolvedValue({});
    const hostedMemberBillingRefCreate = vi.fn().mockResolvedValue({});
    const member = createHostedMember({
      linqChatId: "chat_123",
      privyUserId: "did:privy:user_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      telegramUserId: "tg_user_123",
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    });
    const prisma = {
      hostedMemberIdentity: {
        upsert: hostedMemberIdentityUpsert,
      },
      hostedMemberBillingRef: {
        create: hostedMemberBillingRefCreate,
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never;

    await syncHostedMemberPrivacyFoundationFromMember({
      member,
      prisma,
    });

    expect(hostedMemberIdentityUpsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: expect.objectContaining({
        memberId: "member_123",
        normalizedPhoneNumber: member.normalizedPhoneNumber,
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      }),
      update: expect.objectContaining({
        normalizedPhoneNumber: member.normalizedPhoneNumber,
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      }),
    });
    expect(hostedMemberBillingRefCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      }),
    });
  });

  it("does not overwrite existing additive billing refs from legacy member snapshots", async () => {
    const hostedMemberIdentityUpsert = vi.fn().mockResolvedValue({});
    const hostedMemberBillingRefCreate = vi.fn().mockResolvedValue({});
    const hostedMemberBillingRefFindUnique = vi.fn().mockResolvedValue({
      memberId: "member_123",
      stripeCustomerId: "cus_additive_123",
      stripeLatestBillingEventCreatedAt: new Date("2026-04-06T00:00:00.000Z"),
      stripeLatestBillingEventId: "evt_additive_123",
      stripeLatestCheckoutSessionId: "cs_additive_123",
      stripeSubscriptionId: "sub_additive_123",
    });
    const member = createHostedMember({
      stripeCustomerId: "cus_legacy_123",
      stripeLatestBillingEventId: "evt_legacy_123",
      stripeSubscriptionId: "sub_legacy_123",
    });
    const prisma = {
      hostedMemberIdentity: {
        upsert: hostedMemberIdentityUpsert,
      },
      hostedMemberBillingRef: {
        create: hostedMemberBillingRefCreate,
        findUnique: hostedMemberBillingRefFindUnique,
      },
    } as never;

    await syncHostedMemberPrivacyFoundationFromMember({
      member,
      prisma,
    });

    expect(hostedMemberIdentityUpsert).toHaveBeenCalledOnce();
    expect(hostedMemberBillingRefFindUnique).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
    });
    expect(hostedMemberBillingRefCreate).not.toHaveBeenCalled();
  });
});

function createHostedMember(overrides: Partial<HostedMember> = {}): HostedMember {
  return {
    ...baseHostedMember(),
    ...overrides,
  };
}

function baseHostedMember(): HostedMember {
  return {
    billingMode: null,
    billingStatus: HostedBillingStatus.not_started,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    id: "member_123",
    linqChatId: null,
    maskedPhoneNumberHint: "*** 4567",
    normalizedPhoneNumber: "hbidx:phone:v1:abc123",
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    status: HostedMemberStatus.invited,
    stripeCustomerId: null,
    stripeLatestBillingEventCreatedAt: null,
    stripeLatestBillingEventId: null,
    stripeLatestCheckoutSessionId: null,
    stripeSubscriptionId: null,
    telegramUserId: null,
    telegramUsername: null,
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  };
}
