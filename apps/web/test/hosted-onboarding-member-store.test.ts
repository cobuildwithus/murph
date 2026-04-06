import { type HostedMember, HostedBillingStatus, HostedMemberStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  bindHostedMemberStripeCustomerIdIfMissing,
  findHostedMemberByPhoneLookupKey,
  findHostedMemberByPrivyUserId,
  findHostedMemberByStripeCustomerId,
  findHostedMemberByStripeSubscriptionId,
  findHostedMemberByTelegramUserLookupKey,
  readHostedMemberAggregate,
  readHostedMemberRoutingState,
  readHostedMemberStripeBillingRef,
  upsertHostedMemberIdentity,
  upsertHostedMemberLinqChatBinding,
  upsertHostedMemberTelegramRoutingBinding,
  writeHostedMemberStripeBillingRef,
} from "@/src/lib/hosted-onboarding/hosted-member-store";

describe("hosted-member-store", () => {
  it("finds a member by privy user id from the identity table", async () => {
    const member = createHostedMember();
    const prisma = {
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

  it("finds a member by Telegram lookup key from the routing table", async () => {
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_123",
            status: HostedMemberStatus.registered,
          },
        }),
      },
    } as never;

    await expect(
      findHostedMemberByTelegramUserLookupKey({
        prisma,
        telegramUserId: "tg_user_123",
      }),
    ).resolves.toEqual({
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      status: HostedMemberStatus.registered,
    });
  });

  it("reads member routing state from the routing table", async () => {
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

  it("upserts Linq chat bindings into the routing table", async () => {
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
        linqChatId: "chat_123",
        memberId: "member_123",
        telegramUserId: null,
      },
      update: {
        linqChatId: "chat_123",
      },
    });
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
      telegramUserId: "tg_user_123",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatId: null,
        memberId: "member_123",
        telegramUserId: "tg_user_123",
      },
      update: {
        telegramUserId: "tg_user_123",
      },
    });
  });

  it("upserts identity rows through the identity table", async () => {
    const upsert = vi.fn().mockResolvedValue({
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      normalizedPhoneNumber: "hbidx:phone:v1:abc123",
      phoneNumberVerifiedAt: null,
      privyUserId: "did:privy:user_123",
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
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
        normalizedPhoneNumber: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        prisma,
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      }),
    ).resolves.toEqual({
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      normalizedPhoneNumber: "hbidx:phone:v1:abc123",
      phoneNumberVerifiedAt: null,
      privyUserId: "did:privy:user_123",
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
        normalizedPhoneNumber: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
      update: {
        maskedPhoneNumberHint: "*** 4567",
        normalizedPhoneNumber: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
    });
  });

  it("reads Stripe billing refs from the billing-ref table", async () => {
    const prisma = {
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeLatestBillingEventCreatedAt: null,
          stripeLatestBillingEventId: "evt_123",
          stripeLatestCheckoutSessionId: "cs_123",
          stripeSubscriptionId: "sub_123",
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
      stripeLatestBillingEventCreatedAt: null,
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("finds members by Stripe billing refs from the billing-ref table", async () => {
    const member = createHostedMember();
    const prisma = {
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
  });

  it("writes Stripe billing refs through the billing-ref table", async () => {
    const upsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventCreatedAt: null,
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
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

  it("reads the canonical aggregate from split identity, routing, and billing-ref state", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          ...createHostedMember(),
          billingRef: {
            memberId: "member_123",
            stripeCustomerId: "cus_123",
            stripeLatestBillingEventCreatedAt: null,
            stripeLatestBillingEventId: "evt_123",
            stripeLatestCheckoutSessionId: "cs_123",
            stripeSubscriptionId: "sub_123",
          },
          identity: {
            maskedPhoneNumberHint: "*** 4567",
            memberId: "member_123",
            normalizedPhoneNumber: "hbidx:phone:v1:abc123",
            phoneNumberVerifiedAt: null,
            privyUserId: "did:privy:user_123",
            walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
            walletChainType: "ethereum",
            walletCreatedAt: null,
            walletProvider: "privy",
          },
          routing: {
            linqChatId: "chat_123",
            memberId: "member_123",
            telegramUserId: "tg_user_123",
          },
        }),
      },
    } as never;

    await expect(
      readHostedMemberAggregate({
        memberId: "member_123",
        prisma,
      }),
    ).resolves.toEqual({
      billingMode: null,
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeLatestBillingEventCreatedAt: null,
        stripeLatestBillingEventId: "evt_123",
        stripeLatestCheckoutSessionId: "cs_123",
        stripeSubscriptionId: "sub_123",
      },
      billingStatus: HostedBillingStatus.not_started,
      createdAt: new Date("2026-04-06T00:00:00.000Z"),
      id: "member_123",
      identity: {
        maskedPhoneNumberHint: "*** 4567",
        memberId: "member_123",
        normalizedPhoneNumber: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
      linqChatId: "chat_123",
      maskedPhoneNumberHint: "*** 4567",
      normalizedPhoneNumber: "hbidx:phone:v1:abc123",
      phoneNumberVerifiedAt: null,
      privyUserId: "did:privy:user_123",
      routing: {
        linqChatId: "chat_123",
        memberId: "member_123",
        telegramUserId: "tg_user_123",
      },
      status: HostedMemberStatus.invited,
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventCreatedAt: null,
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      telegramUserId: "tg_user_123",
      updatedAt: new Date("2026-04-06T00:00:00.000Z"),
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      walletChainType: "ethereum",
      walletCreatedAt: null,
      walletProvider: "privy",
    });
  });
});

function createHostedMember(overrides: Partial<HostedMember> = {}): HostedMember {
  return {
    billingMode: null,
    billingStatus: HostedBillingStatus.not_started,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    id: "member_123",
    status: HostedMemberStatus.invited,
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    ...overrides,
  };
}
