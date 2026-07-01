import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const encryptionMocks = vi.hoisted(() => ({
  decryptHostedWebNullableString: vi.fn(),
  encryptHostedWebNullableString: vi.fn(),
}));
const activationMocks = vi.hoisted(() => ({
  activateHostedMemberForFamilySponsorshipTx: vi.fn(),
}));
const cryptoRootMocks = vi.hoisted(() => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn(),
}));
const identityMocks = vi.hoisted(() => ({
  ensureHostedMemberForPhoneTx: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: encryptionMocks.decryptHostedWebNullableString,
  encryptHostedWebNullableString: encryptionMocks.encryptHostedWebNullableString,
}));
vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  MURPH_ASSISTANT_FAMILY_WELCOME_MESSAGE:
    "You are in. Your Murph access is paid through a Family plan, but your Murph conversations, health data, vault data, exports, and deletion controls stay private to you. The Family owner cannot see them.",
  activateHostedMemberForFamilySponsorshipTx:
    activationMocks.activateHostedMemberForFamilySponsorshipTx,
}));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly:
    cryptoRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly,
}));
vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  ensureHostedMemberForPhoneTx: identityMocks.ensureHostedMemberForPhoneTx,
}));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: runtimeMocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApi: runtimeMocks.requireHostedStripeApi,
  requireHostedStripeBillingPlanConfig: runtimeMocks.requireHostedStripeBillingPlanConfig,
}));

import {
  createHostedEmailLookupKey,
  createHostedPhoneLookupKey,
  createHostedTelegramUsernameLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  acceptHostedFamilyInviteFromTelegramTx,
  acceptHostedFamilyInviteFromPhoneTx,
  acceptHostedFamilyInviteTx,
  applyHostedFamilyStripeCheckoutCompletedTx,
  applyHostedFamilyStripeSubscriptionUpdatedTx,
  buildHostedFamilyCheckoutRedirectUrl,
  buildHostedFamilyInviteReplyText,
  buildHostedFamilyTelegramInviteUrl,
  createHostedAccountGroupForOwnerTx,
  createHostedFamilyBillingCheckout,
  hasHostedAccountGroupMembershipAccess,
  hostedFamilyInviteHasReusableTarget,
  issueHostedFamilyInviteFromOwnerTx,
  issueHostedFamilyInviteTx,
  readHostedFamilyCheckoutSessionIdFromUrl,
  resolveHostedFamilyCheckoutRedirectUrl,
  writeHostedAccountGroupStripeBillingTx,
  parseHostedFamilyInviteStartToken,
  readHostedFamilyAccessForMember,
  removeHostedFamilyMemberTx,
  updateHostedFamilySeatCount,
} from "@/src/lib/hosted-onboarding/family-plan";

const TEST_CONTACT_PRIVACY_KEY = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";
const FAMILY_STRIPE_PERIOD_START_SECONDS = 1_771_948_800;
const FAMILY_STRIPE_PERIOD_END_SECONDS = 1_774_540_800;
const FAMILY_STRIPE_PERIOD_START = new Date(FAMILY_STRIPE_PERIOD_START_SECONDS * 1000);
const FAMILY_STRIPE_PERIOD_END = new Date(FAMILY_STRIPE_PERIOD_END_SECONDS * 1000);
type MockFn = ReturnType<typeof vi.fn>;
type FamilyPlanTxMock = Prisma.TransactionClient & {
  $queryRaw: MockFn;
  hostedAccountGroup: Prisma.TransactionClient["hostedAccountGroup"] & {
    create: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    update: MockFn;
  };
  hostedAccountGroupBillingRef: Prisma.TransactionClient["hostedAccountGroupBillingRef"] & {
    findMany: MockFn;
    findUnique: MockFn;
    update: MockFn;
    updateMany: MockFn;
    upsert: MockFn;
  };
  hostedAccountGroupInvite: Prisma.TransactionClient["hostedAccountGroupInvite"] & {
    count: MockFn;
    create: MockFn;
    findMany: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    update: MockFn;
    updateMany: MockFn;
  };
  hostedMember: Prisma.TransactionClient["hostedMember"] & {
    create: MockFn;
    findUnique: MockFn;
    update: MockFn;
  };
  hostedMemberBillingRef: Prisma.TransactionClient["hostedMemberBillingRef"] & {
    findUnique: MockFn;
    updateMany: MockFn;
  };
  hostedMemberRouting: Prisma.TransactionClient["hostedMemberRouting"] & {
    findMany: MockFn;
    findUnique: MockFn;
    upsert: MockFn;
  };
  hostedAccountGroupMembership: Prisma.TransactionClient["hostedAccountGroupMembership"] & {
    count: MockFn;
    findMany: MockFn;
    findFirst: MockFn;
    updateMany: MockFn;
    upsert: MockFn;
  };
};

describe("hosted Family plan", () => {
  const previousHostedContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousHostedContactPrivacyCurrentKeyVersion =
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  const previousHostedFamilyStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY;
  const previousLegacyHostedFamilyStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MONTHLY;
  const previousHostedPulseStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY;
  const previousHostedEdgeStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY;
  const previousHostedOnboardingPublicBaseUrl =
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${TEST_CONTACT_PRIVACY_KEY}`;
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://local.withmurph.ai:3443";
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY = "price_pulse";
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY = "price_edge";
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY = "price_family";
    delete process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MONTHLY;
    clearHostedOnboardingEnvCache();
    encryptionMocks.encryptHostedWebNullableString.mockImplementation(async ({ value }) =>
      value ? `encrypted:${value}` : null
    );
    encryptionMocks.decryptHostedWebNullableString.mockImplementation(async ({ value }) =>
      typeof value === "string" && value.startsWith("encrypted:")
        ? value.slice("encrypted:".length)
        : null
    );
    activationMocks.activateHostedMemberForFamilySponsorshipTx.mockImplementation(async ({ memberId }) => ({
      activated: true,
      hostedExecutionEventId: "member.activated:family",
      memberId,
    }));
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptionItems: {
        update: vi.fn().mockResolvedValue({
          id: "si_family",
          quantity: 3,
        }),
      },
    });
    runtimeMocks.requireHostedStripeBillingPlanConfig.mockImplementation(({ billingPlanCode }) => ({
      billingPlanCode,
      priceId: billingPlanCode === "launch_edge_monthly" ? "price_edge" : "price_pulse",
      stripe: runtimeMocks.requireHostedStripeApi(),
    }));
    runtimeMocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue(
      "https://local.withmurph.ai:3443",
    );
    cryptoRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly.mockResolvedValue(undefined);
    identityMocks.ensureHostedMemberForPhoneTx.mockResolvedValue({
      billingStatus: HostedBillingStatus.not_started,
      id: "member_mom",
      suspendedAt: null,
    });
  });

  afterEach(() => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousHostedContactPrivacyKeys);
    restoreEnvValue(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      previousHostedContactPrivacyCurrentKeyVersion,
    );
    restoreEnvValue(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MONTHLY",
      previousLegacyHostedFamilyStripePriceId,
    );
    restoreEnvValue(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
      previousHostedFamilyStripePriceId,
    );
    restoreEnvValue(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      previousHostedPulseStripePriceId,
    );
    restoreEnvValue(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
      previousHostedEdgeStripePriceId,
    );
    restoreEnvValue(
      "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
      previousHostedOnboardingPublicBaseUrl,
    );
    clearHostedOnboardingEnvCache();
  });

  it("creates owner family groups without storing seat capacity on the group", async () => {
    const tx = createTxMock();

    await createHostedAccountGroupForOwnerTx({
      groupId: "hbag_family",
      now: new Date("2026-06-18T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      tx,
    });

    const createArg = tx.hostedAccountGroup.create.mock.calls[0]?.[0];
    expect(createArg?.data).not.toHaveProperty("maxSeats");
    expect(createArg).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        memberships: {
          create: expect.objectContaining({
            memberId: "member_owner",
            role: "owner",
            status: "active",
          }),
        },
      }),
    }));
  });

  it("builds Telegram deep links without treating usernames as identity proof", () => {
    expect(buildHostedFamilyTelegramInviteUrl({
      botUsername: "@withmurph_bot",
      inviteCode: "invite_123",
    })).toBe("https://t.me/withmurph_bot?start=family_invite_123");
    expect(parseHostedFamilyInviteStartToken("/start family_invite_123")).toBe("invite_123");
    expect(parseHostedFamilyInviteStartToken("family_invite_123")).toBe("invite_123");
    expect(parseHostedFamilyInviteStartToken("@dad_username")).toBeNull();
  });

  it("builds short hosted Family checkout links from Stripe checkout URLs", () => {
    const stripeUrl =
      "https://checkout.stripe.com/c/pay/cs_test_a1FamilyCheckout123#fidkdWxOYHwnPyd1blpxYHZxWjA0";

    expect(readHostedFamilyCheckoutSessionIdFromUrl(stripeUrl)).toBe(
      "cs_test_a1FamilyCheckout123",
    );
    expect(buildHostedFamilyCheckoutRedirectUrl({
      checkoutUrl: stripeUrl,
      publicBaseUrl: "https://local.withmurph.ai:3443",
    })).toBe("https://local.withmurph.ai:3443/checkout/family/cs_test_a1FamilyCheckout123");
    expect(buildHostedFamilyCheckoutRedirectUrl({
      checkoutUrl: "https://example.test/not-stripe",
      publicBaseUrl: "https://local.withmurph.ai:3443",
    })).toBeNull();
  });

  it("keeps Telegram invite links for Telegram-only family invites", () => {
    expect(buildHostedFamilyInviteReplyText({
      invite: {
        inviteCode: "invite_123",
        targetEmail: null,
        targetLabel: "Dad",
        targetPhoneHint: null,
        targetPhoneNumber: null,
      },
      telegramBotUsername: "@withmurph_bot",
    })).toContain("Forward this Telegram invite link to Dad: https://t.me/withmurph_bot?start=family_invite_123");
  });

  it("uses the web accept link for email-bound family invite replies", () => {
    expect(buildHostedFamilyInviteReplyText({
      invite: {
        inviteCode: "invite_email",
        targetEmail: "dad@example.com",
        targetLabel: "Dad",
        targetPhoneHint: null,
        targetPhoneNumber: null,
      },
      publicBaseUrl: "https://local.withmurph.ai:3443",
      telegramBotUsername: "@withmurph_bot",
    })).toContain(
      "Forward this Family invite link to Dad: https://local.withmurph.ai:3443/family/accept/invite_email",
    );
  });

  it("lets only the owner issue a phone or Telegram-hinted invite", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      pendingInviteCount: 0,
    });

    const invite = await issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      now: new Date("2026-06-18T12:00:00.000Z"),
      targetLabel: "Dad",
      targetPhoneNumber: "+48 600 000 000",
      targetTelegramUsername: "@dad_username",
      tx,
    });

    expect(invite).toMatchObject({
      groupId: "hbag_family",
      targetLabel: "Dad",
      targetPhoneNumber: "+48600000000",
      targetTelegramUsername: "dad_username",
    });
    expect(tx.hostedAccountGroupInvite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        targetPhoneNumberEncrypted: "encrypted:+48600000000",
        targetTelegramUsernameEncrypted: "encrypted:dad_username",
        targetTelegramUsernameLookupKey: expect.stringMatching(/^hbidx:telegram-username:v1:/u),
      }),
    }));

    await expect(issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_sibling",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_OWNER_REQUIRED",
    });
  });

  it("creates a Family invite from structured owner input", async () => {
    process.env.TELEGRAM_BOT_USERNAME = "withmurph_bot";
    clearHostedOnboardingEnvCache();

    const tx = createTxMock({
      activeMembershipCount: 1,
      pendingInviteCount: 0,
    });

    const result = await issueHostedFamilyInviteFromOwnerTx({
      ownerMemberId: "member_owner",
      targetLabel: "dad",
      targetPhoneNumber: "+48 600 000 000",
      targetTelegramUsername: "@dad_username",
      tx,
    });

    expect(result).toMatchObject({
      invite: {
        targetPhoneNumber: "+48600000000",
        targetTelegramUsername: "dad_username",
      },
    });
    expect(result.replyText).not.toContain("Forward this Telegram invite link");
    expect(result.replyText).toContain("They need to send this token to Murph from that phone number");
    expect(result.replyText).toContain("you cannot see their private Murph conversations");
  });

  it("reuses a pending invite for the same phone", async () => {
    const tx = createTxMock({
      activeMembershipCount: 3,
      pendingInviteCount: 1,
    });
    tx.hostedAccountGroupInvite.findFirst.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    });

    await expect(issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      targetPhoneNumber: "+48 600 000 000",
      targetTelegramUsername: "@dad_username",
      tx,
    })).resolves.toMatchObject({
      id: "hbagi_invite",
      targetPhoneNumber: "+48600000000",
    });

    expect(tx.hostedAccountGroupInvite.create).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.count).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.count).not.toHaveBeenCalled();
  });

  it("reuses a pending invite matching any supplied contact, including email", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findFirst.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
    });

    await expect(issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      targetEmail: "MOM@example.com",
      tx,
    })).resolves.toMatchObject({ id: "hbagi_invite" });

    const where = tx.hostedAccountGroupInvite.findFirst.mock.calls[0]?.[0]?.where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetEmailLookupKey: expect.objectContaining({ in: expect.any(Array) }) }),
      ]),
    );
    expect(tx.hostedAccountGroupInvite.create).not.toHaveBeenCalled();
  });

  it("accepts a plain Telegram /start when one pending invite is pre-bound to that username", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findMany.mockResolvedValueOnce([
      {
        inviteCode: "invite_telegram",
      },
    ]);
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      inviteCode: "invite_telegram",
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Dad_User"),
    }));

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername: "dad_user",
      text: "/start",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      role: "member",
      status: "active",
    });

    expect(tx.hostedAccountGroupInvite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2,
      where: expect.objectContaining({
        status: "pending",
        targetTelegramUsernameLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:telegram-username:v1:/u),
          ]),
        },
      }),
    }));
    expect(tx.hostedMember.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: expect.stringMatching(/^hbm_/u),
      }),
    }));
    expect(cryptoRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly)
      .toHaveBeenCalledWith({
        domain: "control",
        prisma: tx,
        reason: "hosted-family.telegram-routing",
        userId: expect.stringMatching(/^hbm_/u),
      });
    expect(tx.hostedMemberRouting.upsert).toHaveBeenCalled();
    expect(
      cryptoRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.hostedMemberRouting.upsert.mock.invocationCallOrder[0]);
  });

  it("rejects explicit Telegram tokens from a different bound username", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      expiresAt: new Date("2026-07-01T12:00:00.000Z"),
      status: "pending",
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Alice_User"),
    });

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      now: new Date("2026-06-18T12:00:00.000Z"),
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername: "bob_user",
      text: "/start family_invite_telegram",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
    });

    expect(tx.hostedMember.create).not.toHaveBeenCalled();
    expect(cryptoRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly).not.toHaveBeenCalled();
    expect(tx.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("falls back to a username-bound pending invite when a Telegram start token is stale", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce(createPendingInvite({
        expiresAt: new Date("2026-06-18T11:00:00.000Z"),
        inviteCode: "invite_old",
        status: "revoked",
      }))
      .mockResolvedValueOnce(createPendingInvite({
        inviteCode: "invite_telegram",
        targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Dad_User"),
      }));
    tx.hostedAccountGroupInvite.findMany.mockResolvedValueOnce([
      {
        inviteCode: "invite_telegram",
      },
    ]);

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      now: new Date("2026-06-18T12:00:00.000Z"),
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername: "dad_user",
      text: "/start family_invite_old",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      role: "member",
      status: "active",
    });

    expect(tx.hostedAccountGroupInvite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2,
      where: expect.objectContaining({
        targetTelegramUsernameLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:telegram-username:v1:/u),
          ]),
        },
      }),
    }));
    expect(tx.hostedMember.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: expect.stringMatching(/^hbm_/u),
      }),
    }));
    expect(tx.hostedMemberRouting.upsert).toHaveBeenCalled();
  });

  it("does not guess a Telegram invite when plain /start matches multiple pending username-bound invites", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findMany.mockResolvedValueOnce([
      {
        inviteCode: "invite_first",
      },
      {
        inviteCode: "invite_second",
      },
    ]);

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername: "dad_user",
      text: "/start",
      tx,
    })).resolves.toBeNull();

    expect(tx.hostedAccountGroupInvite.findUnique).not.toHaveBeenCalled();
    expect(tx.hostedMember.create).not.toHaveBeenCalled();
  });

  it("counts active members plus pending invites against billed seats", async () => {
    const tx = createTxMock({
      activeMembershipCount: 3,
      pendingInviteCount: 1,
    });

    await expect(issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
    });
  });

  it("does not issue invites before paid billed seats are confirmed", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: null,
      pendingInviteCount: 0,
    });

    await expect(issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      targetPhoneNumber: "+48 600 000 000",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
    });

    expect(tx.hostedAccountGroupInvite.findFirst).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.create).not.toHaveBeenCalled();
  });

  it("accepts phone-bound invites only from the invited phone number", async () => {
    const tx = createTxMock();

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      phoneNumber: "+48 700 000 000",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
    });

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      phoneNumber: "+48 600 000 000",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_mom",
        prisma: tx,
      }),
    );
  });

  it("lets a phone-verified invitee accept when the invite also carries a Telegram hint", async () => {
    const tx = createTxMock();

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      phoneNumber: "+48 600 000 000",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      status: "active",
    });
  });

  it("accepts email-bound invites only from the invited email address", async () => {
    const tx = createTxMock();

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      email: "someone-else@example.com",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_EMAIL_MISMATCH",
    });

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      email: "mom@example.com",
      inviteCode: "invite_phone",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      status: "active",
    });
  });

  it("blocks web acceptance of an invite with no phone or email binding", async () => {
    const tx = createTxMock();

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetEmailLookupKey: null,
      targetPhoneLookupKey: null,
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      requireWebBinding: true,
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_WEB_ACCEPT_REQUIRES_CONTACT",
    });
  });

  it("marks WhatsApp family invite phone acceptance as provider-verified", async () => {
    const now = new Date("2026-06-18T12:30:00.000Z");
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    })).mockResolvedValueOnce(createPendingInvite({
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    }));

    await expect(acceptHostedFamilyInviteFromPhoneTx({
      now,
      phoneNumber: "+48 600 000 000",
      text: "family_invite_phone",
      tx,
    })).resolves.toMatchObject({
      memberId: "member_mom",
    });

    expect(identityMocks.ensureHostedMemberForPhoneTx).toHaveBeenCalledWith({
      phoneNumber: "+48 600 000 000",
      phoneNumberVerifiedAt: now,
      prisma: tx,
    });
  });

  it("returns the same phone member membership when a phone invite retry is already accepted", async () => {
    const now = new Date("2026-06-18T12:30:00.000Z");
    const tx = createTxMock();
    const acceptedInvite = {
      ...createPendingInvite({
        status: "accepted",
        targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
      }),
      acceptedAt: new Date("2026-06-18T12:31:00.000Z"),
      acceptedByMemberId: "member_mom",
      expiresAt: new Date("2026-06-18T12:00:00.000Z"),
    };
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce(acceptedInvite)
      .mockResolvedValueOnce(acceptedInvite);
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      group: acceptedInvite.group,
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });

    await expect(acceptHostedFamilyInviteFromPhoneTx({
      now,
      phoneNumber: "+48 600 000 000",
      text: "family_invite_phone",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });

    expect(identityMocks.ensureHostedMemberForPhoneTx).toHaveBeenCalledWith({
      phoneNumber: "+48 600 000 000",
      phoneNumberVerifiedAt: now,
      prisma: tx,
    });
    expect(tx.hostedAccountGroupMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        groupId: "hbag_family",
        memberId: "member_mom",
        status: "active",
      },
    }));
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("does not let WhatsApp claim a Telegram-bound invite", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      targetPhoneLookupKey: null,
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@alice"),
    }));

    await expect(acceptHostedFamilyInviteFromPhoneTx({
      phoneNumber: "+48 600 000 000",
      text: "family_invite_phone",
      tx,
    })).resolves.toBeNull();

    expect(identityMocks.ensureHostedMemberForPhoneTx).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
  });

  it("rejects phone acceptance from the wrong phone before creating a member", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    }));

    await expect(acceptHostedFamilyInviteFromPhoneTx({
      phoneNumber: "+48 700 000 000",
      text: "family_invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
    });

    expect(identityMocks.ensureHostedMemberForPhoneTx).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
  });

  it("runs phone acceptance consent hooks after invite validation and before membership write", async () => {
    const tx = createTxMock();
    const observedOrder: string[] = [];
    const consentHook = vi.fn(async () => {
      observedOrder.push("consent");
    });
    tx.hostedAccountGroupMembership.upsert.mockImplementationOnce(async () => {
      observedOrder.push("membership");
      return {
        group: createPendingInvite().group,
        groupId: "hbag_family",
        memberId: "member_mom",
        role: "member",
        status: "active",
      };
    });

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      onAcceptedMemberValidated: consentHook,
      phoneNumber: "+48 600 000 000",
      tx,
    })).resolves.toMatchObject({
      memberId: "member_mom",
      status: "active",
    });

    expect(consentHook).toHaveBeenCalledWith({
      acceptedMemberId: "member_mom",
      invite: expect.objectContaining({
        id: "hbagi_invite",
      }),
    });
    expect(observedOrder).toEqual(["consent", "membership"]);

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    });
    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      onAcceptedMemberValidated: consentHook,
      phoneNumber: "+48 700 000 000",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
    });
    expect(consentHook).toHaveBeenCalledTimes(1);
  });

  it("does not let the owner accept an invite into their own group", async () => {
    const tx = createTxMock();

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_owner",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_OWNER_ALREADY_IN_GROUP",
    });

    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.update).not.toHaveBeenCalled();
  });

  it("does not create membership when another accept already claimed the invite", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());
    tx.hostedAccountGroupInvite.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
    });

    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        expiresAt: {
          gt: expect.any(Date),
        },
        id: "hbagi_invite",
        status: "pending",
      },
    }));
  });

  it("treats provider retries after invite acceptance as idempotent success", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      acceptedByMemberId: "member_mom",
      status: "accepted",
    });
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      group: createPendingInvite().group,
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      status: "active",
    });

    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("accepts the final pending invite when it fills the paid seats", async () => {
    const tx = createTxMock({
      activeMembershipCount: 3,
      pendingInviteCount: 1,
      pendingInviteCountExcludingCurrent: 0,
    });

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });
  });

  it("does not let one member use active sponsorship from two family plans", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      id: "hbagm_other",
    });

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
    });

    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.update).not.toHaveBeenCalled();
  });

  it("does not let one member hold active memberships in two family plans before billing", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      id: "hbagm_other",
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
    });

    expect(tx.hostedAccountGroupMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        groupId: {
          not: "hbag_family",
        },
        memberId: "member_mom",
        status: "active",
      }),
    }));
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("does not silently convert active direct paid members into Family sponsorship", async () => {
    const tx = createTxMock();
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingRef: {
        currentBillingPhase: "paid",
      },
      billingStatus: HostedBillingStatus.active,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED",
    });

    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
  });

  it("removes sponsored access without deleting the member", async () => {
    const tx = createTxMock();

    await expect(removeHostedFamilyMemberTx({
      groupId: "hbag_family",
      memberId: "member_child",
      ownerMemberId: "member_owner",
      tx,
    })).resolves.toBe(true);

    expect(tx.hostedAccountGroupMembership.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "removed",
      }),
      where: {
        groupId: "hbag_family",
        memberId: "member_child",
        status: "active",
      },
    }));
  });

  it("requires active group billing for membership access", () => {
    expect(hasHostedAccountGroupMembershipAccess({
      group: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
      membershipStatus: "active",
    })).toBe(true);

    expect(hasHostedAccountGroupMembershipAccess({
      group: {
        billingStatus: HostedBillingStatus.unpaid,
        suspendedAt: null,
      },
      membershipStatus: "active",
    })).toBe(false);
  });

  it("reads accessible family access instead of the oldest inactive membership", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      group: {
        billingStatus: HostedBillingStatus.active,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });

    await expect(readHostedFamilyAccessForMember({
      memberId: "member_mom",
      prisma: tx,
    })).resolves.toMatchObject({
      group: {
        billingStatus: HostedBillingStatus.active,
      },
      groupId: "hbag_family",
      memberId: "member_mom",
    });

    expect(tx.hostedAccountGroupMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
        memberId: "member_mom",
        status: "active",
      },
    }));
  });

  it("fails closed for family access when active plus pending seats exceed billed seats", async () => {
    const tx = createTxMock({
      activeMembershipCount: 3,
      billedSeatCount: 4,
      pendingInviteCount: 2,
    });
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      group: {
        billingStatus: HostedBillingStatus.active,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });

    await expect(readHostedFamilyAccessForMember({
      memberId: "member_mom",
      now: new Date("2026-06-18T12:00:00.000Z"),
      prisma: tx,
    })).resolves.toBeNull();

    expect(tx.hostedAccountGroupMembership.count).toHaveBeenCalledWith({
      where: {
        groupId: "hbag_family",
        status: "active",
      },
    });
    expect(tx.hostedAccountGroupInvite.count).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          gt: new Date("2026-06-18T12:00:00.000Z"),
        },
        groupId: "hbag_family",
        status: "pending",
      },
    });
  });

  it("activates active family members when Stripe marks the group subscription active", async () => {
    const tx = createTxMock();
    const eventCreatedAt = new Date("2026-06-18T12:30:00.000Z");

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt,
      },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).resolves.toMatchObject({
      activations: [
        { memberId: "member_owner" },
        { memberId: "member_mom" },
      ],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: 4,
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_family_monthly",
        groupId: "hbag_family",
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionItemLookupKey: expect.stringMatching(/^hbidx:stripe-subscription-item:v1:/u),
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      }),
    }));
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.active,
      },
      where: {
        id: "hbag_family",
      },
    });
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenCalledTimes(2);
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenNthCalledWith(
      1,
      {
        memberId: "member_owner",
        occurredAt: eventCreatedAt,
        prisma: tx,
        sourceEventId: "family-subscription:sub_family",
      },
    );
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenNthCalledWith(
      2,
      {
        memberId: "member_mom",
        occurredAt: eventCreatedAt,
        prisma: tx,
        sourceEventId: "family-subscription:sub_family",
      },
    );
  });

  it("stores Family billing periods from the seat item when Stripe omits top-level periods", async () => {
    const tx = createTxMock();

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        periodLocation: "subscription_item",
      }),
      tx,
    })).resolves.toMatchObject({
      activations: [
        { memberId: "member_owner" },
        { memberId: "member_mom" },
      ],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        currentBillingPhase: "paid",
        currentPeriodEnd: FAMILY_STRIPE_PERIOD_END,
        currentPeriodStart: FAMILY_STRIPE_PERIOD_START,
      }),
      update: expect.objectContaining({
        currentBillingPhase: "paid",
        currentPeriodEnd: FAMILY_STRIPE_PERIOD_END,
        currentPeriodStart: FAMILY_STRIPE_PERIOD_START,
      }),
    }));
  });

  it("reconciles active Family billing while skipping direct-paid members during activation", async () => {
    const tx = createTxMock();
    const eventCreatedAt = new Date("2026-06-18T12:30:00.000Z");
    tx.hostedMember.findUnique.mockImplementation(async ({ where }) => ({
      billingRef: {
        currentBillingPhase: where.id === "member_mom" ? "paid" : null,
      },
      billingStatus: where.id === "member_mom"
        ? HostedBillingStatus.active
        : HostedBillingStatus.not_started,
    }));

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt,
      },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).resolves.toMatchObject({
      activations: [
        { memberId: "member_owner" },
      ],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: 4,
      }),
    }));
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenCalledTimes(1);
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenCalledWith({
      memberId: "member_owner",
      occurredAt: eventCreatedAt,
      prisma: tx,
      sourceEventId: "family-subscription:sub_family",
    });
  });

  it("fails closed when Stripe seats drop below active Family memberships", async () => {
    const tx = createTxMock({
      activeMembershipCount: 3,
    });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        itemQuantity: 2,
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: 2,
        currentBillingPhase: null,
      }),
    }));
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.unpaid,
      },
      where: {
        id: "hbag_family",
      },
    });
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("derives active Family billing from the locked membership count", async () => {
    const tx = createTxMock();
    let ownerLocked = false;
    tx.$queryRaw.mockImplementation(async () => {
      ownerLocked = true;
      return [];
    });
    tx.hostedAccountGroupMembership.count.mockImplementation(async () =>
      ownerLocked ? 3 : 2
    );

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        itemQuantity: 2,
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: "hbag_family",
    });

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.hostedAccountGroupMembership.count.mock.invocationCallOrder[0],
    );
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: 2,
        currentBillingPhase: null,
      }),
    }));
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.unpaid,
      },
      where: {
        id: "hbag_family",
      },
    });
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("revokes newest pending invites when Stripe seats drop below active plus pending seats", async () => {
    const tx = createTxMock({
      activeMembershipCount: 2,
      pendingInviteCount: 2,
    });
    tx.hostedAccountGroupInvite.findMany.mockResolvedValueOnce([
      { id: "inv_newest" },
      { id: "inv_oldest" },
    ]);

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        itemQuantity: 3,
      }),
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupInvite.updateMany).toHaveBeenCalledWith({
      data: {
        status: "revoked",
      },
      where: {
        groupId: "hbag_family",
        id: {
          in: ["inv_newest"],
        },
        status: "pending",
      },
    });
  });

  it("fails closed when the family subscription item quantity is outside the seat range", async () => {
    const tx = createTxMock();

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        itemQuantity: 7,
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: null,
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_family_monthly",
        stripeSubscriptionItemLookupKey: null,
      }),
      update: expect.objectContaining({
        billedSeatCount: null,
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_family_monthly",
        stripeSubscriptionItemLookupKey: null,
      }),
    }));
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.unpaid,
      },
      where: {
        id: "hbag_family",
      },
    });
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("fails closed when Stripe returns multiple family seat subscription items", async () => {
    const tx = createTxMock();

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        duplicateFamilyItems: true,
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: null,
        currentBillingPhase: null,
        stripeSubscriptionItemLookupKey: null,
      }),
      update: expect.objectContaining({
        billedSeatCount: null,
        currentBillingPhase: null,
        stripeSubscriptionItemLookupKey: null,
      }),
    }));
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.unpaid,
      },
      where: {
        id: "hbag_family",
      },
    });
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });


  it("fails closed before activation when a member already has another active family membership", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "hbagm_other" });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
    });

    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("does not activate family members from a stale active Stripe subscription event", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce({
      billedSeatCount: 4,
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_family_monthly",
      currentPeriodEnd: null,
      currentPeriodStart: null,
      group: {
        billingStatus: HostedBillingStatus.unpaid,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      groupId: "hbag_family",
      lastStripeEventCreatedAt: new Date("2026-06-18T12:45:00.000Z"),
      stripeCustomerIdEncrypted: "encrypted:cus_family",
      stripeSubscriptionItemIdEncrypted: "encrypted:si_family",
      stripeSubscriptionIdEncrypted: "encrypted:sub_family",
    });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("does not let checkout completion stale the first active subscription event", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupBillingRef.upsert.mockImplementationOnce(async ({ create }) => ({
      billedSeatCount: create.billedSeatCount,
      currentBillingPhase: create.currentBillingPhase,
      currentBillingPlanCode: create.currentBillingPlanCode,
      currentPeriodEnd: create.currentPeriodEnd,
      currentPeriodStart: create.currentPeriodStart,
      group: createPendingInvite().group,
      groupId: create.groupId,
      lastStripeEventCreatedAt: create.lastStripeEventCreatedAt,
      stripeCustomerIdEncrypted: create.stripeCustomerIdEncrypted,
      stripeSubscriptionItemIdEncrypted: create.stripeSubscriptionItemIdEncrypted,
      stripeSubscriptionIdEncrypted: create.stripeSubscriptionIdEncrypted,
    }));
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce(null);

    await expect(writeHostedAccountGroupStripeBillingTx({
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_family_monthly",
      groupId: "hbag_family",
      preserveLastStripeEventCreatedAt: true,
      stripeCustomerId: "cus_family",
      stripeEventCreatedAt: new Date("2026-06-18T12:35:00.000Z"),
      stripeSubscriptionId: "sub_family",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      lastStripeEventCreatedAt: null,
    });

    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce({
      billedSeatCount: null,
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_family_monthly",
      currentPeriodEnd: null,
      currentPeriodStart: null,
      group: createPendingInvite().group,
      groupId: "hbag_family",
      lastStripeEventCreatedAt: null,
      stripeCustomerIdEncrypted: "encrypted:cus_family",
      stripeSubscriptionItemIdEncrypted: null,
      stripeSubscriptionIdEncrypted: "encrypted:sub_family",
    });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).resolves.toMatchObject({
      activations: [
        { memberId: "member_owner" },
        { memberId: "member_mom" },
      ],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroup.update).toHaveBeenLastCalledWith({
      data: {
        billingStatus: HostedBillingStatus.active,
      },
      where: {
        id: "hbag_family",
      },
    });
  });

  it("creates a fresh Stripe Checkout Session for each billing start", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(createBillingRefMock({
        billedSeatCount: null,
        currentBillingPhase: null,
        group,
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionItemIdEncrypted: null,
      }));
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn().mockResolvedValue({
      id: "cs_test_familyRetry123",
      url: "https://checkout.stripe.com/c/pay/cs_test_familyRetry123",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://local.withmurph.ai:3443/checkout/family/cs_test_familyRetry123",
    });

    expect(checkoutCreate).toHaveBeenCalledTimes(1);
    expect(checkoutCreate.mock.calls[0]).toHaveLength(2);
    expect(checkoutCreate.mock.calls[0]?.[0]).toMatchObject({
      line_items: [{
        price: "price_family",
        quantity: 2,
      }],
      mode: "subscription",
      subscription_data: {
        metadata: expect.objectContaining({
          checkoutAttemptId: expect.stringMatching(/^hbfca_/u),
        }),
      },
    });
    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: expect.stringMatching(/^hosted-family-checkout:hbag_family:hbfca_/u),
    });
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        checkoutAttemptId: expect.stringMatching(/^hbfca_/u),
        checkoutSeatCount: 2,
      }),
    }));
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stripeCheckoutSessionLookupKey: expect.stringMatching(/^hbidx:stripe-checkout-session:v1:/u),
      }),
      where: expect.objectContaining({
        groupId: "hbag_family",
      }),
    }));
  });

  it("converts an active direct paid owner subscription into Family billing without creating a second checkout", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce(null);
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValueOnce(createMemberBillingRefMock());

    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn();
    const directSubscription = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 1,
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_owner",
      },
      priceId: "price_pulse",
      subscriptionId: "sub_direct",
    });
    const updatedSubscription = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 2,
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
        ownerMemberId: "member_owner",
      },
      periodLocation: "subscription_item",
      priceId: "price_family",
      subscriptionId: "sub_direct",
    });
    const subscriptionRetrieve = vi.fn().mockResolvedValue(directSubscription);
    const subscriptionUpdate = vi.fn().mockResolvedValue(updatedSubscription);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
      subscriptions: {
        retrieve: subscriptionRetrieve,
        update: subscriptionUpdate,
      },
    });
    const result = await createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    });
    expect(result).toEqual({
      alreadyActive: true,
      url: null,
    });

    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(subscriptionRetrieve).toHaveBeenCalledWith("sub_direct", {
      expand: ["items.data.price"],
    });
    expect(subscriptionUpdate).toHaveBeenCalledWith("sub_direct", expect.objectContaining({
      items: [{
        id: "si_family",
        price: "price_family",
        quantity: 2,
      }],
      metadata: expect.objectContaining({
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        checkoutOffer: "",
        kind: "hosted_family_plan",
        memberId: "",
        ownerMemberId: "member_owner",
      }),
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
    }), {
      idempotencyKey: "hosted-family-direct-paid-upgrade:hbag_family:sub_direct:launch_monthly:price_pulse:price_family:seats-2",
    });
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: 2,
        currentBillingPhase: "paid",
        currentPeriodEnd: FAMILY_STRIPE_PERIOD_END,
        currentPeriodStart: FAMILY_STRIPE_PERIOD_START,
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      }),
    }));
    expect(tx.hostedMember.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.not_started,
      },
      where: {
        id: "member_owner",
      },
    });
    expect(tx.hostedMemberBillingRef.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        stripeCustomerLookupKey: null,
        stripeSubscriptionLookupKey: null,
      }),
      where: {
        memberId: "member_owner",
      },
    }));
  });

  it("keeps unsupported direct paid subscription items as a non-retryable owner transfer error", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce(null);
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValueOnce(createMemberBillingRefMock());

    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const subscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(makeFamilyStripeSubscription({
          customerId: "cus_direct",
          duplicateFamilyItems: true,
          itemQuantity: 1,
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutOffer: "standard",
            memberId: "member_owner",
          },
          priceId: "price_pulse",
          subscriptionId: "sub_direct",
        })),
        update: subscriptionUpdate,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
      retryable: false,
    });
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  it("reuses a pending Family checkout attempt for duplicate checkout starts", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce({
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_existing",
        checkoutSeatCount: 2,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn().mockResolvedValue({
      id: "cs_test_familyRetry123",
      url: "https://checkout.stripe.com/c/pay/cs_test_familyRetry123",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toMatchObject({
      alreadyActive: false,
    });

    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: expect.stringContaining(":hbfca_existing:"),
    });
  });

  it("does not start a second pending Family checkout for a different seat count", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce({
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_existing",
        checkoutSeatCount: 2,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 3,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_IN_PROGRESS",
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
  });

  it("rejects Family checkout when an inactive owner group belongs to a sponsored member", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      group: {
        billingStatus: HostedBillingStatus.active,
        id: "hbag_sponsor",
        ownerMemberId: "member_sponsor",
        suspendedAt: null,
      },
      groupId: "hbag_sponsor",
      memberId: "member_owner",
      role: "member",
      status: "active",
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
  });

  it("requires the per-seat Family Stripe price env and ignores the old fixed price env", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce(null);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    delete process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY;
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MONTHLY = "price_fixed_family";
    clearHostedOnboardingEnvCache();

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "STRIPE_PRICE_ID_REQUIRED",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
  });

  it("preserves subscription-owned billing fields when late checkout binds ids", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce({
      billedSeatCount: 4,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_family_monthly",
      currentPeriodEnd: new Date("2026-07-18T12:30:00.000Z"),
      currentPeriodStart: new Date("2026-06-18T12:30:00.000Z"),
      group: createPendingInvite().group,
      groupId: "hbag_family",
      lastStripeEventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      stripeCustomerIdEncrypted: "encrypted:cus_family",
      stripeSubscriptionItemIdEncrypted: "encrypted:si_family",
      stripeSubscriptionIdEncrypted: "encrypted:sub_family",
    });

    await expect(writeHostedAccountGroupStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_family_monthly",
      groupId: "hbag_family",
      preserveLastStripeEventCreatedAt: true,
      stripeCustomerId: "cus_family",
      stripeEventCreatedAt: new Date("2026-06-18T12:35:00.000Z"),
      stripeSubscriptionId: "sub_family",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({
        currentBillingPhase: expect.anything(),
        currentPeriodEnd: expect.anything(),
        currentPeriodStart: expect.anything(),
        lastStripeEventCreatedAt: expect.anything(),
      }),
    }));
  });

  it("does not match subscription events by customer alone", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupBillingRef.findMany.mockImplementation(async ({ where }) => {
      if (where?.stripeCustomerLookupKey) {
        return [{
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_family_monthly",
          currentPeriodEnd: null,
          currentPeriodStart: null,
          group: {
            billingStatus: HostedBillingStatus.active,
            id: "hbag_family",
            ownerMemberId: "member_owner",
            suspendedAt: null,
          },
          groupId: "hbag_family",
          lastStripeEventCreatedAt: null,
          stripeCustomerIdEncrypted: "encrypted:cus_family",
          stripeSubscriptionItemIdEncrypted: "encrypted:si_family",
          stripeSubscriptionIdEncrypted: "encrypted:sub_family",
        }];
      }
      return [];
    });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        metadata: {},
        subscriptionId: "sub_other",
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: null,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("does not let metadata bind another subscription to a group that already has one", async () => {
    const tx = createTxMock();

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        subscriptionId: "sub_other",
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: null,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("does not bind checkout completion when the pending attempt does not match", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce({
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_current",
        checkoutSeatCount: 2,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_current123",
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });

    await expect(applyHostedFamilyStripeCheckoutCompletedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      session: makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_old",
        sessionId: "cs_test_old123",
        subscriptionId: "sub_other",
      }),
      tx,
    })).resolves.toEqual({
      groupId: null,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
  });

  it("clears an unavailable pending Family checkout session for retry", async () => {
    const sessionId = "cs_test_unavailable123";
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce({
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_current",
        checkoutSeatCount: 2,
        stripeCheckoutSessionIdEncrypted: `encrypted:${sessionId}`,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const retrieve = vi.fn().mockResolvedValue(makeFamilyStripeCheckoutSession({
      checkoutAttemptId: "hbfca_current",
      sessionId,
      subscriptionId: null,
      url: null,
    }));
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          retrieve,
        },
      },
    });

    await expect(resolveHostedFamilyCheckoutRedirectUrl({
      prisma: tx as never,
      sessionId,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_UNAVAILABLE",
      httpStatus: 410,
    });

    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutSeatCount: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: {
        groupId: "hbag_family",
        stripeCheckoutSessionLookupKey: expect.stringMatching(
          /^hbidx:stripe-checkout-session:v1:/u,
        ),
      },
    });
  });

  it("updates Family seat count through Stripe without writing the reconciled seat quantity", async () => {
    const tx = createTxMock({
      activeMembershipCount: 2,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const stripeSubscriptionItemUpdate = vi.fn().mockResolvedValue({
      id: "si_family",
      quantity: 3,
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      subscriptionItems: {
        update: stripeSubscriptionItemUpdate,
      },
    });

    await expect(updateHostedFamilySeatCount({
      groupId: "hbag_family",
      now: new Date("2026-06-18T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetSeatCount: 3,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(stripeSubscriptionItemUpdate).toHaveBeenCalledWith(
      "si_family",
      {
        payment_behavior: "error_if_incomplete",
        proration_behavior: "always_invoice",
        quantity: 3,
      },
    );
    expect(stripeSubscriptionItemUpdate.mock.calls[0]).toHaveLength(2);
    expect(tx.hostedAccountGroupBillingRef.update).not.toHaveBeenCalled();
  });

  it("does not reduce Family seats below active members and pending invites", async () => {
    const tx = createTxMock({
      activeMembershipCount: 2,
      billedSeatCount: 4,
      pendingInviteCount: 1,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilySeatCount({
      groupId: "hbag_family",
      now: new Date("2026-06-18T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetSeatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_SEAT_COUNT_BELOW_USAGE",
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.update).not.toHaveBeenCalled();
  });

  it("does not activate a group from non-family subscription metadata", async () => {
    const tx = createTxMock();
    delete process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY;

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        metadata: {
          accountGroupId: "hbag_family",
          billingPlanCode: "launch_monthly",
          kind: "hosted_member_plan",
        },
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: null,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });
});

function createBillingRefMock(overrides: Partial<{
  billedSeatCount: number | null;
  checkoutAttemptId: string | null;
  checkoutCreatedAt: Date | null;
  checkoutSeatCount: number | null;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  group: {
    billingStatus: HostedBillingStatus;
    id: string;
    ownerMemberId: string;
    suspendedAt: Date | null;
  };
  groupId: string;
  lastStripeEventCreatedAt: Date | null;
  stripeCheckoutSessionIdEncrypted: string | null;
  stripeCustomerIdEncrypted: string | null;
  stripeSubscriptionIdEncrypted: string | null;
  stripeSubscriptionItemIdEncrypted: string | null;
}> = {}) {
  const group = overrides.group ?? {
    billingStatus: HostedBillingStatus.active,
    id: "hbag_family",
    ownerMemberId: "member_owner",
    suspendedAt: null,
  };

  const resolveNullableOverride = <Key extends keyof typeof overrides>(
    key: Key,
    fallback: (typeof overrides)[Key],
  ): (typeof overrides)[Key] | typeof fallback =>
    Object.hasOwn(overrides, key) ? overrides[key] : fallback;

  return {
    billedSeatCount: resolveNullableOverride("billedSeatCount", 4),
    checkoutAttemptId: resolveNullableOverride("checkoutAttemptId", null),
    checkoutCreatedAt: resolveNullableOverride("checkoutCreatedAt", null),
    checkoutSeatCount: resolveNullableOverride("checkoutSeatCount", null),
    currentBillingPhase: resolveNullableOverride("currentBillingPhase", "paid"),
    currentBillingPlanCode: resolveNullableOverride(
      "currentBillingPlanCode",
      "launch_family_monthly",
    ),
    currentPeriodEnd: resolveNullableOverride(
      "currentPeriodEnd",
      new Date("2026-07-18T12:00:00.000Z"),
    ),
    currentPeriodStart: resolveNullableOverride(
      "currentPeriodStart",
      new Date("2026-06-18T12:00:00.000Z"),
    ),
    group,
    groupId: resolveNullableOverride("groupId", "hbag_family"),
    lastStripeEventCreatedAt: resolveNullableOverride("lastStripeEventCreatedAt", null),
    stripeCheckoutSessionIdEncrypted: resolveNullableOverride(
      "stripeCheckoutSessionIdEncrypted",
      null,
    ),
    stripeCustomerIdEncrypted: resolveNullableOverride(
      "stripeCustomerIdEncrypted",
      "encrypted:cus_family",
    ),
    stripeSubscriptionIdEncrypted: resolveNullableOverride(
      "stripeSubscriptionIdEncrypted",
      "encrypted:sub_family",
    ),
    stripeSubscriptionItemIdEncrypted: resolveNullableOverride(
      "stripeSubscriptionItemIdEncrypted",
      "encrypted:si_family",
    ),
  };
}

function createMemberBillingRefMock(overrides: Partial<{
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  stripeCustomerIdEncrypted: string | null;
  stripeSubscriptionIdEncrypted: string | null;
}> = {}) {
  return {
    currentBillingPhase: overrides.currentBillingPhase ?? "paid",
    currentBillingPlanCode: overrides.currentBillingPlanCode ?? "launch_monthly",
    currentCheckoutOffer: "standard",
    currentPeriodEnd: new Date("2026-07-18T12:00:00.000Z"),
    currentPeriodStart: new Date("2026-06-18T12:00:00.000Z"),
    currentTrialEndsAt: null,
    currentTrialStartedAt: null,
    lastStripeEventCreatedAt: null,
    memberId: "member_owner",
    pulseTrialPolicyVersion: null,
    pulseTrialRedeemedAt: null,
    scheduledBillingEffectiveAt: null,
    scheduledBillingPlanCode: null,
    stripeCustomerIdEncrypted: overrides.stripeCustomerIdEncrypted ?? "encrypted:cus_direct",
    stripeCustomerLookupKey: "hbidx:stripe-customer:v1:direct",
    stripeSubscriptionIdEncrypted: overrides.stripeSubscriptionIdEncrypted ?? "encrypted:sub_direct",
    stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:direct",
    stripeSubscriptionScheduleIdEncrypted: null,
    stripeSubscriptionScheduleLookupKey: null,
  };
}

function createTxMock(input: {
  activeMembershipCount?: number;
  billedSeatCount?: number | null;
  group?: {
    billingStatus: HostedBillingStatus;
    id: string;
    ownerMemberId: string;
    suspendedAt: Date | null;
  } | null;
  pendingInviteCount?: number;
  pendingInviteCountExcludingCurrent?: number;
} = {}): FamilyPlanTxMock {
  const group = input.group ?? {
    billingStatus: HostedBillingStatus.active,
    id: "hbag_family",
    ownerMemberId: "member_owner",
    suspendedAt: null,
  };
  const membership = {
    group,
    groupId: "hbag_family",
    memberId: "member_mom",
    role: "member",
    status: "active",
  };
  const billingRef = createBillingRefMock({
    billedSeatCount: input.billedSeatCount === undefined ? 4 : input.billedSeatCount,
    group,
  });

  const tx = new Proxy({} as FamilyPlanTxMock, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof FamilyPlanTxMock];
      }
      if (typeof property === "string") {
        return {};
      }
      return undefined;
    },
  });

  Object.assign(tx, {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedAccountGroup: {
      create: vi.fn().mockResolvedValue(group),
      findFirst: vi.fn().mockResolvedValue(group),
      findUnique: vi.fn().mockResolvedValue(group),
      update: vi.fn().mockResolvedValue(group),
    },
    hostedAccountGroupBillingRef: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(billingRef),
      update: vi.fn().mockResolvedValue({ ...billingRef }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockImplementation(async ({ create }) => ({
        billedSeatCount: create.billedSeatCount,
        checkoutAttemptId: create.checkoutAttemptId ?? null,
        checkoutCreatedAt: create.checkoutCreatedAt ?? null,
        checkoutSeatCount: create.checkoutSeatCount ?? null,
        currentBillingPhase: create.currentBillingPhase,
        currentBillingPlanCode: create.currentBillingPlanCode,
        currentPeriodEnd: create.currentPeriodEnd,
        currentPeriodStart: create.currentPeriodStart,
        group,
        groupId: create.groupId,
        lastStripeEventCreatedAt: create.lastStripeEventCreatedAt,
        stripeCheckoutSessionIdEncrypted: create.stripeCheckoutSessionIdEncrypted ?? null,
        stripeCustomerIdEncrypted: create.stripeCustomerIdEncrypted,
        stripeSubscriptionItemIdEncrypted: create.stripeSubscriptionItemIdEncrypted,
        stripeSubscriptionIdEncrypted: create.stripeSubscriptionIdEncrypted,
      })),
    },
    hostedAccountGroupInvite: {
      count: vi.fn().mockImplementation(async ({ where }) =>
        where?.NOT?.id === "hbagi_invite"
          ? input.pendingInviteCountExcludingCurrent ?? input.pendingInviteCount ?? 0
          : input.pendingInviteCount ?? 0
      ),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        acceptedAt: null,
        acceptedByMemberId: null,
        channel: data.channel,
        createdAt: new Date("2026-06-18T12:00:00.000Z"),
        expiresAt: data.expiresAt,
        group,
        groupId: data.groupId,
        id: data.id,
        inviteCode: data.inviteCode,
        invitedByMemberId: data.invitedByMemberId,
        status: data.status,
        targetEmailEncrypted: data.targetEmailEncrypted,
        targetEmailLookupKey: data.targetEmailLookupKey,
        targetLabel: data.targetLabel,
        targetPhoneLookupKey: data.targetPhoneLookupKey,
        targetPhoneNumberEncrypted: data.targetPhoneNumberEncrypted,
        targetTelegramUsernameEncrypted: data.targetTelegramUsernameEncrypted,
        targetTelegramUsernameLookupKey: data.targetTelegramUsernameLookupKey,
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      })),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(createPendingInvite()),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedMember: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        billingStatus: data.billingStatus,
        createdAt: new Date("2026-06-18T12:00:00.000Z"),
        id: data.id,
        suspendedAt: null,
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      })),
      findUnique: vi.fn().mockResolvedValue({
        billingRef: {
          currentBillingPhase: null,
        },
        billingStatus: HostedBillingStatus.not_started,
        suspendedAt: null,
      }),
      update: vi.fn().mockResolvedValue({
        billingStatus: HostedBillingStatus.not_started,
        id: "member_owner",
        suspendedAt: null,
      }),
    },
    hostedMemberBillingRef: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedMemberRouting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    hostedAccountGroupMembership: {
      count: vi.fn().mockResolvedValue(input.activeMembershipCount ?? 1),
      findMany: vi.fn().mockResolvedValue([
        { memberId: "member_owner" },
        { memberId: "member_mom" },
      ]),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue(membership),
    },
  });

  return tx;
}

function makeFamilyStripeCheckoutSession(input: {
  checkoutAttemptId?: string | null;
  sessionId?: string;
  subscriptionId?: string | null;
  url?: string | null;
} = {}): Stripe.Checkout.Session {
  const sessionId = input.sessionId ?? "cs_test_family123";

  const session: Partial<Stripe.Checkout.Session> = {
    customer: "cus_family",
    id: sessionId,
    metadata: {
      accountGroupId: "hbag_family",
      billingPlanCode: "launch_family_monthly",
      ...(input.checkoutAttemptId ? { checkoutAttemptId: input.checkoutAttemptId } : {}),
      kind: "hosted_family_plan",
      ownerMemberId: "member_owner",
    },
    mode: "subscription",
    object: "checkout.session",
    subscription: input.subscriptionId === undefined ? "sub_family" : input.subscriptionId,
    url: input.url === undefined
      ? "https://checkout.stripe.com/c/pay/cs_test_family123"
      : input.url,
  };

  return session as Stripe.Checkout.Session;
}

function makeFamilyStripeSubscription(input: {
  customerId?: string;
  duplicateFamilyItems?: boolean;
  itemQuantity?: number;
  metadata?: Stripe.Metadata;
  periodLocation?: "subscription" | "subscription_item";
  priceId?: string;
  subscriptionId?: string;
} = {}): Stripe.Subscription {
  const subscriptionId = input.subscriptionId ?? "sub_family";
  const priceId = input.priceId ?? "price_family";
  const periodOnSubscriptionItem = input.periodLocation === "subscription_item";
  const familyItem = {
    id: "si_family",
    quantity: input.itemQuantity ?? 4,
    price: {
      id: priceId,
    },
    ...(periodOnSubscriptionItem
      ? {
          current_period_end: FAMILY_STRIPE_PERIOD_END_SECONDS,
          current_period_start: FAMILY_STRIPE_PERIOD_START_SECONDS,
        }
      : {}),
  } as Stripe.SubscriptionItem;
  const subscription: Stripe.Subscription & {
    current_period_end?: number;
    current_period_start?: number;
  } = {
    application: null,
    application_fee_percent: null,
    automatic_tax: {
      disabled_reason: null,
      enabled: false,
      liability: null,
    },
    billing_cycle_anchor: 1_771_948_800,
    billing_cycle_anchor_config: null,
    billing_mode: {
      flexible: null,
      type: "classic",
    },
    billing_thresholds: null,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    cancellation_details: null,
    collection_method: "charge_automatically",
    created: 1_771_948_800,
    currency: "usd",
    customer: input.customerId ?? "cus_family",
    customer_account: null,
    ...(periodOnSubscriptionItem
      ? {}
      : {
          current_period_end: FAMILY_STRIPE_PERIOD_END_SECONDS,
          current_period_start: FAMILY_STRIPE_PERIOD_START_SECONDS,
        }),
    days_until_due: null,
    default_payment_method: null,
    default_source: null,
    description: null,
    discounts: [],
    ended_at: null,
    id: subscriptionId,
    invoice_settings: {
      account_tax_ids: null,
      issuer: {
        type: "self",
      },
    },
    items: {
      data: input.duplicateFamilyItems
        ? [
            familyItem,
            {
              ...familyItem,
              id: "si_family_duplicate",
            } as Stripe.SubscriptionItem,
          ]
        : [familyItem],
      has_more: false,
      object: "list",
      url: `/v1/subscription_items?subscription=${subscriptionId}`,
    },
    latest_invoice: null,
    livemode: false,
    managed_payments: null,
    metadata: input.metadata ?? {
      accountGroupId: "hbag_family",
      billingPlanCode: "launch_family_monthly",
      kind: "hosted_family_plan",
    },
    next_pending_invoice_item_invoice: null,
    object: "subscription",
    on_behalf_of: null,
    pause_collection: null,
    payment_settings: null,
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: null,
    schedule: null,
    start_date: 1_771_948_800,
    status: "active",
    test_clock: null,
    transfer_data: null,
    trial_end: null,
    trial_settings: {
      end_behavior: {
        missing_payment_method: "cancel",
      },
    },
    trial_start: null,
  };

  return subscription;
}

function createPendingInvite(overrides: Partial<{
  acceptedAt: Date | null;
  acceptedByMemberId: string | null;
  expiresAt: Date;
  inviteCode: string;
  status: string;
  targetEmailEncrypted: string | null;
  targetEmailLookupKey: string | null;
  targetPhoneLookupKey: string | null;
  targetTelegramUsernameEncrypted: string | null;
  targetTelegramUsernameLookupKey: string | null;
}> = {}) {
  return {
    acceptedAt: null,
    acceptedByMemberId: null,
    channel: "family",
    createdAt: new Date("2026-06-18T12:00:00.000Z"),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    group: {
      billingStatus: HostedBillingStatus.active,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    },
    groupId: "hbag_family",
    id: "hbagi_invite",
    inviteCode: "invite_phone",
    invitedByMemberId: "member_owner",
    status: "pending",
    targetEmailEncrypted: null,
    targetEmailLookupKey: null,
    targetLabel: "Mom",
    targetPhoneLookupKey: null,
    targetPhoneNumberEncrypted: "encrypted:+48600000000",
    targetTelegramUsernameEncrypted: null,
    targetTelegramUsernameLookupKey: null,
    updatedAt: new Date("2026-06-18T12:00:00.000Z"),
    ...overrides,
  };
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function clearHostedOnboardingEnvCache(): void {
  delete (globalThis as {
    __murphHostedOnboardingEnv?: unknown;
    __murphHostedOnboardingStripe?: unknown;
  }).__murphHostedOnboardingEnv;
  delete (globalThis as {
    __murphHostedOnboardingEnv?: unknown;
    __murphHostedOnboardingStripe?: unknown;
  }).__murphHostedOnboardingStripe;
}

describe("hostedFamilyInviteHasReusableTarget", () => {
  it("is true for a valid phone or email", () => {
    expect(hostedFamilyInviteHasReusableTarget({ targetPhoneNumber: "+48600000000" })).toBe(true);
    expect(hostedFamilyInviteHasReusableTarget({ targetEmail: "mom@example.com" })).toBe(true);
  });

  it("is false for label-only, empty, or whitespace contacts", () => {
    expect(hostedFamilyInviteHasReusableTarget({})).toBe(false);
    expect(hostedFamilyInviteHasReusableTarget({ targetPhoneNumber: "   " })).toBe(false);
    expect(hostedFamilyInviteHasReusableTarget({ targetEmail: "  " })).toBe(false);
  });
});
