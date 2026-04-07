import {
  Prisma,
  type HostedMember,
  HostedBillingStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const memberPrivateStateMocks = vi.hoisted(() => ({
  readHostedMemberPrivateState: vi.fn(),
  writeHostedMemberPrivateStatePatch: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-private-state", () => ({
  readHostedMemberPrivateState: memberPrivateStateMocks.readHostedMemberPrivateState,
  writeHostedMemberPrivateStatePatch: memberPrivateStateMocks.writeHostedMemberPrivateStatePatch,
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    memberPrivateStateMocks.readHostedMemberPrivateState.mockResolvedValue(null);
    memberPrivateStateMocks.writeHostedMemberPrivateStatePatch.mockImplementation(
      async ({ memberId, patch }: { memberId: string; patch: Record<string, string | null | undefined> }) => ({
        linqChatId: patch.linqChatId ?? null,
        memberId,
        privyUserId: patch.privyUserId ?? null,
        schema: "murph.hosted-member-private-state.v1",
        signupPhoneCodeSentAt: patch.signupPhoneCodeSentAt ?? null,
        signupPhoneNumber: patch.signupPhoneNumber ?? null,
        stripeCustomerId: patch.stripeCustomerId ?? null,
        stripeLatestBillingEventId: patch.stripeLatestBillingEventId ?? null,
        stripeLatestCheckoutSessionId: patch.stripeLatestCheckoutSessionId ?? null,
        stripeSubscriptionId: patch.stripeSubscriptionId ?? null,
        updatedAt: "2026-04-07T00:00:00.000Z",
        walletAddress: patch.walletAddress ?? null,
      }),
    );
  });

  it("finds a member by privy user id from the identity table", async () => {
    const member = createHostedMember();
    const findUnique = vi.fn().mockResolvedValue({
      member,
    });
    const prisma = {
      hostedMemberIdentity: {
        findUnique,
      },
    } as never;

    await expect(
      findHostedMemberByPrivyUserId({
        prisma,
        privyUserId: "did:privy:user_123",
      }),
    ).resolves.toEqual(member);

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
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

  it("reads member routing state from routing lookup keys plus private state", async () => {
    memberPrivateStateMocks.readHostedMemberPrivateState.mockResolvedValue({
      linqChatId: "chat_123",
      memberId: "member_123",
      privyUserId: null,
      schema: "murph.hosted-member-private-state.v1",
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: null,
    });
    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
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

  it("upserts Linq chat bindings into the routing table and private state", async () => {
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
        linqChatLookupKey: null,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        memberId: "member_123",
        telegramUserLookupKey: null,
      },
      update: {
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
      },
    });
    expect(memberPrivateStateMocks.writeHostedMemberPrivateStatePatch).toHaveBeenCalledWith({
      memberId: "member_123",
      patch: {
        linqChatId: "chat_123",
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
      telegramUserLookupKey: "tg_user_123",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        linqChatLookupKey: null,
        memberId: "member_123",
        telegramUserLookupKey: "tg_user_123",
      },
      update: {
        telegramUserLookupKey: "tg_user_123",
      },
    });
  });

  it("upserts identity rows through blind lookup keys and private state", async () => {
    const upsert = vi.fn().mockResolvedValue({
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:abc123",
      phoneNumberVerifiedAt: null,
      privyUserLookupKey: "hbidx:privy-user:v1:abc123",
      walletAddressLookupKey: "hbidx:wallet-address:v1:abc123",
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
      phoneLookupKey: "hbidx:phone:v1:abc123",
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
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        walletAddressLookupKey: expect.stringMatching(/^hbidx:wallet-address:v1:/u),
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
      update: {
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        walletAddressLookupKey: expect.stringMatching(/^hbidx:wallet-address:v1:/u),
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
    });
    expect(memberPrivateStateMocks.writeHostedMemberPrivateStatePatch).toHaveBeenCalledWith({
      memberId: "member_123",
      patch: {
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      },
    });
  });

  it("reads Stripe billing refs from billing lookup keys plus private state", async () => {
    memberPrivateStateMocks.readHostedMemberPrivateState.mockResolvedValue({
      linqChatId: null,
      memberId: "member_123",
      privyUserId: null,
      schema: "murph.hosted-member-private-state.v1",
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: null,
    });
    const prisma = {
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
          stripeLatestBillingEventCreatedAt: null,
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
      stripeLatestBillingEventCreatedAt: null,
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("finds members by Stripe billing refs from lookup-key columns", async () => {
    const member = createHostedMember();
    const findUnique = vi.fn()
      .mockResolvedValueOnce({
        member,
      })
      .mockResolvedValueOnce({
        member,
      });
    const prisma = {
      hostedMemberBillingRef: {
        findUnique,
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

    expect(findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
      },
      include: {
        member: true,
      },
    });
    expect(findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      },
      include: {
        member: true,
      },
    });
  });

  it("writes Stripe billing refs through lookup keys and private state", async () => {
    const upsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
      stripeLatestBillingEventCreatedAt: null,
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
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeLatestBillingEventCreatedAt: null,
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      },
      update: {
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      },
    });
    expect(memberPrivateStateMocks.writeHostedMemberPrivateStatePatch).toHaveBeenCalledWith({
      memberId: "member_123",
      patch: {
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
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeLatestBillingEventCreatedAt: null,
        stripeSubscriptionLookupKey: null,
      },
      update: {
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
      },
    });
    expect(memberPrivateStateMocks.writeHostedMemberPrivateStatePatch).toHaveBeenCalledWith({
      memberId: "member_123",
      patch: {
        stripeCustomerId: "cus_123",
      },
    });
  });

  it("reads the canonical aggregate from lookup-key tables plus private state", async () => {
    memberPrivateStateMocks.readHostedMemberPrivateState.mockResolvedValue({
      linqChatId: "chat_123",
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      schema: "murph.hosted-member-private-state.v1",
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    });
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          ...createHostedMember(),
          billingRef: {
            memberId: "member_123",
            stripeCustomerLookupKey: "hbidx:stripe-customer:v1:abc123",
            stripeLatestBillingEventCreatedAt: null,
            stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:abc123",
          },
          identity: {
            maskedPhoneNumberHint: "*** 4567",
            memberId: "member_123",
            phoneLookupKey: "hbidx:phone:v1:abc123",
            phoneNumberVerifiedAt: null,
            privyUserLookupKey: "hbidx:privy-user:v1:abc123",
            walletAddressLookupKey: "hbidx:wallet-address:v1:abc123",
            walletChainType: "ethereum",
            walletCreatedAt: null,
            walletProvider: "privy",
          },
          routing: {
            linqChatLookupKey: "hbidx:linq-chat:v1:abc123",
            memberId: "member_123",
            telegramUserLookupKey: "tg_user_123",
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
        phoneLookupKey: "hbidx:phone:v1:abc123",
        phoneNumberVerifiedAt: null,
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: null,
        walletProvider: "privy",
      },
      linqChatId: "chat_123",
      maskedPhoneNumberHint: "*** 4567",
      phoneLookupKey: "hbidx:phone:v1:abc123",
      phoneNumberVerifiedAt: null,
      privyUserId: "did:privy:user_123",
      routing: {
        linqChatId: "chat_123",
        memberId: "member_123",
        telegramUserLookupKey: "tg_user_123",
      },
      suspendedAt: null,
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventCreatedAt: null,
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      telegramUserLookupKey: "tg_user_123",
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
    billingStatus: HostedBillingStatus.not_started,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    ...overrides,
  };
}
