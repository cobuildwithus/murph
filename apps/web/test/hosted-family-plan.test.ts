import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";

const encryptionMocks = vi.hoisted(() => ({
  decryptHostedWebNullableString: vi.fn(),
  encryptHostedWebNullableString: vi.fn(),
}));
const activationMocks = vi.hoisted(() => ({
  activateHostedMemberForFamilySponsorshipTx: vi.fn(),
  buildHostedMemberActivationEventId: vi.fn(),
}));
const cryptoRootMocks = vi.hoisted(() => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn(),
}));
const identityMocks = vi.hoisted(() => ({
  ensureHostedMemberForPhoneTx: vi.fn(),
}));
const mailboxMocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  requireHostedStripeFamilyPlanConfig: vi.fn(),
  resolveHostedStripePortalConfigurationId: vi.fn(),
}));
const activationWakeMocks = vi.hoisted(() => ({
  signalHostedMemberActivationRuntimeWakeBestEffortResult: vi.fn(),
}));
const groupJoinConfirmationMocks = vi.hoisted(() => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
}));
const recurringFinancialMocks = vi.hoisted(() => ({
  classifyHostedStripeRecurringFinancialHealth: vi.fn(),
  readHostedStripeRecurringFinancialState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: encryptionMocks.decryptHostedWebNullableString,
  encryptHostedWebNullableString: encryptionMocks.encryptHostedWebNullableString,
}));
vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForFamilySponsorshipTx:
    activationMocks.activateHostedMemberForFamilySponsorshipTx,
  buildHostedMemberActivationEventId:
    activationMocks.buildHostedMemberActivationEventId,
}));
vi.mock("@/src/lib/hosted-onboarding/member-activation-runtime-wake", () => ({
  HOSTED_MEMBER_ACTIVATION_RUNTIME_WAKE_TIMEOUT_MS: 5_000,
  signalHostedMemberActivationRuntimeWakeBestEffortResult:
    activationWakeMocks.signalHostedMemberActivationRuntimeWakeBestEffortResult,
}));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly:
    cryptoRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly,
}));
vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  ensureHostedMemberForPhoneTx: identityMocks.ensureHostedMemberForPhoneTx,
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mailboxMocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey: mailboxMocks.readHostedMailboxItemByDedupeKey,
}));
vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    groupJoinConfirmationMocks.materializePendingHostedGroupJoinConfirmationsBestEffort,
}));
vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", () => ({
  classifyHostedStripeRecurringFinancialHealth:
    recurringFinancialMocks.classifyHostedStripeRecurringFinancialHealth,
  readHostedStripeRecurringFinancialState:
    recurringFinancialMocks.readHostedStripeRecurringFinancialState,
}));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: runtimeMocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApi: runtimeMocks.requireHostedStripeApi,
  requireHostedStripeBillingPlanConfig: runtimeMocks.requireHostedStripeBillingPlanConfig,
  requireHostedStripeFamilyPlanConfig: runtimeMocks.requireHostedStripeFamilyPlanConfig,
  resolveHostedStripePortalConfigurationId:
    runtimeMocks.resolveHostedStripePortalConfigurationId,
}));

import {
  createHostedEmailLookupKey,
  createHostedPhoneLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionItemLookupKey,
  createHostedStripeSubscriptionLookupKey,
  createHostedTelegramUserLookupKey,
  createHostedTelegramUsernameLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedStripeSubscriptionMutationScope,
} from "@/src/lib/hosted-onboarding/stripe-billing-state";
import {
  acceptHostedFamilyInvite,
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
  ensureHostedAccountGroupForOwnerTx,
  hasHostedAccountGroupMembershipAccess,
  hostedFamilyInviteHasReusableTarget,
  issueHostedFamilyInviteFromOwnerTx,
  issueHostedFamilyInviteTx,
  prepareHostedLegacySyntheticFamilyCleanupTx,
  readHostedFamilyCheckoutSessionIdFromUrl,
  reconcileHostedFamilyDirectPaidTransitionSubscription,
  resolveHostedFamilyChatNotificationRouteTx,
  resolveHostedFamilyCheckoutRedirectUrl,
  writeHostedAccountGroupStripeBillingTx,
  parseHostedFamilyInviteStartToken,
  readHostedFamilyAccessForMember,
  resolveHostedFamilyUsageCreditCheckoutTargetTx,
  resolveHostedFamilyInviteTokenForInbound,
  removeHostedFamilyMemberTx,
  setHostedFamilyStripeBillingReversalStateTx,
  updateHostedFamilyMemberPlan,
  updateHostedFamilyPlanCapacities,
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
  hostedMemberIdentity: Prisma.TransactionClient["hostedMemberIdentity"] & {
    findUnique: MockFn;
  };
  hostedThreadContainer: Prisma.TransactionClient["hostedThreadContainer"] & {
    findUnique: MockFn;
  };
  hostedMemberBillingRef: Prisma.TransactionClient["hostedMemberBillingRef"] & {
    findMany: MockFn;
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
    findUnique: MockFn;
    update: MockFn;
    updateMany: MockFn;
    upsert: MockFn;
  };
  hostedAccountGroupPlanCapacity: Prisma.TransactionClient["hostedAccountGroupPlanCapacity"] & {
    createMany: MockFn;
    deleteMany: MockFn;
    findMany: MockFn;
  };
};

describe("hosted Family plan", () => {
  const previousHostedContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousHostedContactPrivacyCurrentKeyVersion =
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  const previousHostedFamilyStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY;
  const previousHostedFamilyEdgeStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY;
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
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY =
      "price_family_edge";
    delete process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MONTHLY;
    clearHostedOnboardingEnvCache();
    runtimeMocks.resolveHostedStripePortalConfigurationId.mockReturnValue(
      undefined,
    );
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
      hostedExecutionMailboxItemId: "mailbox_member_activation",
      memberId,
    }));
    activationMocks.buildHostedMemberActivationEventId.mockReturnValue(
      "member.activated:hosted.family.sponsorship:member_mom:family-invite:hbagi_invite",
    );
    activationWakeMocks.signalHostedMemberActivationRuntimeWakeBestEffortResult.mockResolvedValue({
      accepted: true,
      configured: true,
      errorCode: null,
      mailboxItemIdPresent: true,
      signalAccepted: true,
      workflowIdPresent: true,
    });
    mailboxMocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: { id: "mailbox_item_owner_notification" },
    });
    mailboxMocks.readHostedMailboxItemByDedupeKey.mockResolvedValue({
      dedupeKey: "member.activated:hosted.family.sponsorship:member_mom:family-invite:hbagi_invite",
      id: "mailbox_member_activation",
    });
    groupJoinConfirmationMocks.materializePendingHostedGroupJoinConfirmationsBestEffort
      .mockResolvedValue(undefined);
    recurringFinancialMocks.readHostedStripeRecurringFinancialState.mockResolvedValue({
      collectionState: {
        invoiceId: "in_family_current",
        invoicePaymentId: "ip_family_current",
        kind: "paid",
        paymentIntentId: "pi_family_current",
      },
      fullyRefunded: false,
      invoiceId: "in_family_current",
      outstandingDispute: false,
    });
    recurringFinancialMocks.classifyHostedStripeRecurringFinancialHealth
      .mockReturnValue({ kind: "healthy" });
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
    runtimeMocks.requireHostedStripeFamilyPlanConfig.mockImplementation(({ planCode }) => ({
      planCode,
      priceId: planCode === "edge" ? "price_family_edge" : "price_family",
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
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
      previousHostedFamilyEdgeStripePriceId,
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

  it("authorizes an active unsuspended Family beneficiary against group billing", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findUnique
      .mockResolvedValueOnce({ memberId: "member_mom", status: "active" })
      .mockResolvedValueOnce({
        member: { suspendedAt: null, threadContainer: null },
        memberId: "member_mom",
        status: "active",
      });

    await expect(resolveHostedFamilyUsageCreditCheckoutTargetTx({
      beneficiaryMemberId: "member_mom",
      ownerMemberId: "member_owner",
      tx,
    })).resolves.toEqual({
      beneficiaryMemberId: "member_mom",
      groupId: "hbag_family",
      stripeCustomerId: "cus_family",
    });
    expect(tx.hostedAccountGroup.findUnique).toHaveBeenCalledWith({
      select: expect.objectContaining({
        billingStatus: true,
        id: true,
        ownerMemberId: true,
        suspendedAt: true,
      }),
      where: { ownerMemberId: "member_owner" },
    });
    expect(tx.hostedAccountGroupMembership.findUnique).toHaveBeenNthCalledWith(1, {
      select: { memberId: true, status: true },
      where: {
        groupId_memberId: {
          groupId: "hbag_family",
          memberId: "member_mom",
        },
      },
    });
    expect(tx.hostedAccountGroupMembership.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      member: {
        suspendedAt: new Date("2026-07-22T12:00:00.000Z"),
        threadContainer: null,
      },
    },
    {
      member: { suspendedAt: null, threadContainer: { memberId: "member_mom" } },
    },
  ])("rejects an ineligible Family usage-credit beneficiary", async ({ member }) => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findUnique
      .mockResolvedValueOnce({ memberId: "member_mom", status: "active" })
      .mockResolvedValueOnce({
        member,
        memberId: "member_mom",
        status: "active",
      });

    await expect(resolveHostedFamilyUsageCreditCheckoutTargetTx({
      beneficiaryMemberId: "member_mom",
      ownerMemberId: "member_owner",
      tx,
    })).resolves.toBeNull();
  });

  it("rejects a foreign Family selector before locking its member row", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce(null);

    await expect(resolveHostedFamilyUsageCreditCheckoutTargetTx({
      beneficiaryMemberId: "member_foreign",
      ownerMemberId: "member_owner",
      tx,
    })).resolves.toBeNull();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a Family beneficiary removed after selector binding", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findUnique
      .mockResolvedValueOnce({ memberId: "member_mom", status: "active" })
      .mockResolvedValueOnce({
        member: { suspendedAt: null, threadContainer: null },
        memberId: "member_mom",
        status: "removed",
      });

    await expect(resolveHostedFamilyUsageCreditCheckoutTargetTx({
      beneficiaryMemberId: "member_mom",
      ownerMemberId: "member_owner",
      tx,
    })).resolves.toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedAccountGroupBillingRef.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    {
      billingStatus: HostedBillingStatus.past_due,
      label: "inactive",
      suspendedAt: null,
    },
    {
      billingStatus: HostedBillingStatus.active,
      label: "suspended",
      suspendedAt: new Date("2026-07-22T12:00:00.000Z"),
    },
  ])("rejects an $label Family owner group for usage-credit checkout", async ({
    billingStatus,
    suspendedAt,
  }) => {
    const tx = createTxMock({
      group: {
        billingStatus,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt,
      },
    });

    await expect(resolveHostedFamilyUsageCreditCheckoutTargetTx({
      beneficiaryMemberId: "member_mom",
      ownerMemberId: "member_owner",
      tx,
    })).resolves.toBeNull();
    expect(tx.hostedAccountGroupMembership.findUnique).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.findUnique).not.toHaveBeenCalled();
  });

  it("rejects Family usage-credit checkout without current group Stripe billing", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findUnique
      .mockResolvedValueOnce({ memberId: "member_mom", status: "active" })
      .mockResolvedValueOnce({
        member: { suspendedAt: null, threadContainer: null },
        memberId: "member_mom",
        status: "active",
      });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);

    await expect(resolveHostedFamilyUsageCreditCheckoutTargetTx({
      beneficiaryMemberId: "member_mom",
      ownerMemberId: "member_owner",
      tx,
    })).resolves.toBeNull();
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

  it("rejects a synthetic thread container at the canonical Family owner boundary", async () => {
    const tx = createTxMock();
    tx.hostedThreadContainer.findUnique.mockResolvedValueOnce({
      memberId: "member_owner",
    });

    await expect(createHostedAccountGroupForOwnerTx({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_PERSONAL_OWNER_REQUIRED",
      httpStatus: 403,
    });

    expect(tx.hostedAccountGroup.create).not.toHaveBeenCalled();
  });

  it("rejects returning an existing Family group for a synthetic owner", async () => {
    const tx = createTxMock();
    tx.hostedThreadContainer.findUnique.mockResolvedValueOnce({
      memberId: "member_owner",
    });

    await expect(ensureHostedAccountGroupForOwnerTx({
      ownerMemberId: "member_owner",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_PERSONAL_OWNER_REQUIRED",
      httpStatus: 403,
    });

    expect(tx.hostedAccountGroup.findFirst).toHaveBeenCalled();
    expect(tx.hostedAccountGroup.create).not.toHaveBeenCalled();
  });

  it("builds Telegram deep links without treating usernames as identity proof", () => {
    expect(buildHostedFamilyTelegramInviteUrl({
      botUsername: "@withmurph_bot",
      inviteCode: "invite_123",
    })).toBe("https://t.me/withmurph_bot?start=family_invite_123");
    expect(parseHostedFamilyInviteStartToken("/start family_invite_123")).toBe("invite_123");
    expect(parseHostedFamilyInviteStartToken("family_invite_123")).toBe("invite_123");
    expect(
      parseHostedFamilyInviteStartToken(
        "Hi Murph, joining the family plan (code family_invite_123)",
      ),
    ).toBe("invite_123");
    expect(parseHostedFamilyInviteStartToken("code family_invite_123.")).toBe("invite_123");
    expect(parseHostedFamilyInviteStartToken("hello")).toBeNull();
    expect(parseHostedFamilyInviteStartToken("prefamily_invite_123")).toBeNull();
    expect(parseHostedFamilyInviteStartToken("family_invite_123_extra")).toBe(
      "invite_123_extra",
    );
    expect(parseHostedFamilyInviteStartToken("@dad_username")).toBeNull();
  });

  it("resolves inbound family invite tokens only when the invite row exists", async () => {
    const tx = createTxMock();

    await expect(resolveHostedFamilyInviteTokenForInbound({
      prisma: tx,
      text: "Hi Murph, joining the family plan (code family_invite_123)",
    })).resolves.toBe("invite_123");
    expect(tx.hostedAccountGroupInvite.findUnique).toHaveBeenLastCalledWith({
      select: {
        id: true,
      },
      where: {
        inviteCode: "invite_123",
      },
    });

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(null);

    await expect(resolveHostedFamilyInviteTokenForInbound({
      prisma: tx,
      text: "sending the family_photos album now",
    })).resolves.toBeNull();
    expect(tx.hostedAccountGroupInvite.findUnique).toHaveBeenLastCalledWith({
      select: {
        id: true,
      },
      where: {
        inviteCode: "photos",
      },
    });

    await expect(resolveHostedFamilyInviteTokenForInbound({
      prisma: tx,
      text: "hello",
    })).resolves.toBeNull();
    expect(tx.hostedAccountGroupInvite.findUnique).toHaveBeenCalledTimes(2);
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
        targetTelegramUsername: "dad_username",
      },
      telegramBotUsername: "@withmurph_bot",
    })).toContain("Forward this Telegram invite link to Dad: https://t.me/withmurph_bot?start=family_invite_123");
  });

  it("uses the web accept link for label-only family invite replies", () => {
    const replyText = buildHostedFamilyInviteReplyText({
      invite: {
        inviteCode: "invite_label",
        targetEmail: null,
        targetLabel: "Dad",
        targetPhoneHint: null,
        targetPhoneNumber: null,
        targetTelegramUsername: null,
      },
      publicBaseUrl: "https://local.withmurph.ai:3443",
      telegramBotUsername: "@withmurph_bot",
    });

    expect(replyText).not.toContain("https://t.me/");
    expect(replyText).toContain(
      "Forward this Family invite link to Dad: https://local.withmurph.ai:3443/family/accept/invite_label",
    );
    expect(replyText).toContain(
      "Whoever opens it can join, so it is best sent directly to them.",
    );
  });

  it("falls back to a token for label-only family invite replies without a public base URL", () => {
    const replyText = buildHostedFamilyInviteReplyText({
      invite: {
        inviteCode: "invite_label",
        targetEmail: null,
        targetLabel: "Dad",
        targetPhoneHint: null,
        targetPhoneNumber: null,
        targetTelegramUsername: null,
      },
      publicBaseUrl: null,
      telegramBotUsername: "@withmurph_bot",
    });

    expect(replyText).not.toContain("https://t.me/");
    expect(replyText).toContain("Family invite token: family_invite_label");
  });

  it("uses the web accept link for phone-bound family invite replies", () => {
    const replyText = buildHostedFamilyInviteReplyText({
      invite: {
        inviteCode: "invite_phone",
        targetEmail: null,
        targetLabel: "Dad",
        targetPhoneHint: "+48 6** *** ***",
        targetPhoneNumber: "+48600000000",
        targetTelegramUsername: null,
      },
      publicBaseUrl: "https://local.withmurph.ai:3443",
      telegramBotUsername: "@withmurph_bot",
    });

    expect(replyText).toContain(
      "Forward this Family invite link to Dad: https://local.withmurph.ai:3443/family/accept/invite_phone",
    );
    expect(replyText).toContain(
      "When they open it they can join by text right from their phone.",
    );
  });

  it("uses the web accept link for email-bound family invite replies", () => {
    expect(buildHostedFamilyInviteReplyText({
      invite: {
        inviteCode: "invite_email",
        targetEmail: "dad@example.com",
        targetLabel: "Dad",
        targetPhoneHint: null,
        targetPhoneNumber: null,
        targetTelegramUsername: null,
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
    expect(result.replyText).toContain(
      "Forward this Family invite link to dad: https://local.withmurph.ai:3443/family/accept/",
    );
    expect(result.replyText).toContain(
      "When they open it they can join by text right from their phone.",
    );
    expect(result.replyText).toContain(
      "You pay for their Murph access, but everything they share with me stays private to them.",
    );
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

  it("moves a reused pending invite to the requested tier when capacity is open", async () => {
    const tx = createTxMock();
    const existingInvite = createPendingInvite({
      planCode: "pulse",
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
    });
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 3, planCode: "pulse" },
      { billedQuantity: 1, planCode: "edge" },
    ]);
    tx.hostedAccountGroupInvite.findFirst.mockResolvedValueOnce(existingInvite);
    tx.hostedAccountGroupInvite.findMany.mockResolvedValueOnce([
      { planCode: "pulse" },
    ]);
    tx.hostedAccountGroupInvite.update.mockResolvedValueOnce({
      ...existingInvite,
      planCode: "edge",
    });

    await expect(issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      planCode: "edge",
      targetEmail: "mom@example.com",
      tx,
    })).resolves.toMatchObject({
      id: "hbagi_invite",
      planCode: "edge",
    });

    expect(tx.hostedAccountGroupInvite.update).toHaveBeenCalledWith({
      data: { planCode: "edge" },
      select: expect.any(Object),
      where: { id: "hbagi_invite" },
    });
    expect(tx.hostedAccountGroupInvite.create).not.toHaveBeenCalled();
  });

  it("keeps a reused invite on its tier when the requested tier is full", async () => {
    const tx = createTxMock();
    const existingInvite = createPendingInvite({
      planCode: "pulse",
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
    });
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 3, planCode: "pulse" },
    ]);
    tx.hostedAccountGroupInvite.findFirst.mockResolvedValueOnce(existingInvite);
    tx.hostedAccountGroupInvite.findMany.mockResolvedValueOnce([
      { planCode: "pulse" },
    ]);

    await expect(issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      planCode: "edge",
      targetEmail: "mom@example.com",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
    });

    expect(tx.hostedAccountGroupInvite.update).not.toHaveBeenCalled();
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    const acceptedMemberId = tx.$queryRaw.mock.calls[1]?.[1];
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      "member_owner",
    );
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      acceptedMemberId,
    );
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      acceptedMemberId,
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      tx.hostedMemberRouting.upsert.mock.invocationCallOrder[0]
      ?? Number.POSITIVE_INFINITY,
    );
    expect(tx.hostedMemberRouting.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      tx.hostedAccountGroupMembership.upsert.mock.invocationCallOrder[0],
    );
  });

  it("keeps the Telegram route when family acceptance is rejected after member locking", async () => {
    const tx = createTxMock({
      activeMembershipCount: 4,
      billedSeatCount: 4,
    });
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
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
    });

    const acceptedMemberId = tx.$queryRaw.mock.calls[1]?.[1];
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      "member_owner",
    );
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      acceptedMemberId,
    );
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      acceptedMemberId,
    );
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      4,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      acceptedMemberId,
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[3]).toBeLessThan(
      tx.hostedMemberRouting.upsert.mock.invocationCallOrder[0]
      ?? Number.POSITIVE_INFINITY,
    );
    expect(tx.hostedMemberRouting.upsert).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
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

  it.each([
    ["changed", "renamed_user"],
    ["removed", null],
  ])("preserves an accepted explicit Telegram token after the username is %s", async (
    _usernameState,
    telegramUsername,
  ) => {
    const tx = createTxMock();
    const acceptedInvite = {
      ...createPendingInvite({
        inviteCode: "invite_telegram",
        targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Dad_User"),
      }),
      acceptedByMemberId: "member_mom",
      status: "accepted",
    };
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce({
        acceptedByMemberId: "member_mom",
        expiresAt: acceptedInvite.expiresAt,
        status: "accepted",
        targetTelegramUsernameLookupKey: acceptedInvite.targetTelegramUsernameLookupKey,
      })
      .mockResolvedValueOnce(acceptedInvite);
    tx.hostedMemberRouting.findMany.mockResolvedValue([{
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: null,
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
      member: {
        billingStatus: HostedBillingStatus.not_started,
        createdAt: new Date("2026-06-18T12:00:00.000Z"),
        id: "member_mom",
        suspendedAt: null,
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      memberId: "member_mom",
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted: null,
      pendingLinqParticipantContactKind: null,
      pendingLinqParticipantContactLookupKey: null,
      pendingLinqParticipantContactObservedAt: null,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
      replyAliasLookupKey: null,
      telegramUserIdEncrypted: "encrypted:456",
      telegramUserLookupKey: createHostedTelegramUserLookupKey("456"),
    }]);
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      group: acceptedInvite.group,
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });
    const onAcceptedMemberActivated = vi.fn();

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      onAcceptedMemberActivated,
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername,
      text: "/start family_invite_telegram",
      tx,
    })).resolves.toMatchObject({
      memberId: "member_mom",
      status: "active",
    });

    expect(onAcceptedMemberActivated).toHaveBeenCalledWith(expect.objectContaining({
      activated: false,
      hostedExecutionMailboxItemId: "mailbox_member_activation",
      memberId: "member_mom",
    }));
    expect(tx.hostedAccountGroupInvite.findMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedMember.create).not.toHaveBeenCalled();
    expect(tx.hostedMemberRouting.upsert).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      "member_mom",
    );
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      "member_mom",
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.hostedMemberRouting.upsert.mock.invocationCallOrder[0]
      ?? Number.POSITIVE_INFINITY,
    );
  });

  it("rejects a stale family webhook after its Telegram identity is relinked", async () => {
    const tx = createTxMock();
    const acceptedInvite = {
      ...createPendingInvite({
        inviteCode: "invite_telegram",
        targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Dad_User"),
      }),
      acceptedByMemberId: "member_mom",
      status: "accepted",
    };
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce({
        acceptedByMemberId: acceptedInvite.acceptedByMemberId,
        expiresAt: acceptedInvite.expiresAt,
        status: acceptedInvite.status,
        targetTelegramUsernameLookupKey: acceptedInvite.targetTelegramUsernameLookupKey,
      })
      .mockResolvedValueOnce(acceptedInvite);
    tx.hostedMemberRouting.findMany
      .mockResolvedValueOnce([{
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqHomeLineAssignedAt: null,
        linqParticipantContactKind: null,
        linqParticipantContactLookupKey: null,
        linqRecipientPhoneEncrypted: null,
        linqRecipientPhoneLookupKey: null,
        member: {
          billingStatus: HostedBillingStatus.not_started,
          createdAt: new Date("2026-06-18T12:00:00.000Z"),
          id: "member_mom",
          suspendedAt: null,
          updatedAt: new Date("2026-06-18T12:00:00.000Z"),
        },
        memberId: "member_mom",
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        replyAliasLookupKey: null,
        telegramUserIdEncrypted: "encrypted:456",
        telegramUserLookupKey: createHostedTelegramUserLookupKey("456"),
      }])
      .mockResolvedValueOnce([]);
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      group: acceptedInvite.group,
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername: null,
      text: "/start family_invite_telegram",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
    });

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('from "hosted_member"')]),
      "member_mom",
    );
    expect(tx.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("rejects an accepted explicit Telegram token from a different stable account", async () => {
    const tx = createTxMock();
    const acceptedInvite = {
      ...createPendingInvite({
        inviteCode: "invite_telegram",
        targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Dad_User"),
      }),
      acceptedByMemberId: "member_mom",
      status: "accepted",
    };
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      acceptedByMemberId: acceptedInvite.acceptedByMemberId,
      expiresAt: acceptedInvite.expiresAt,
      status: acceptedInvite.status,
      targetTelegramUsernameLookupKey: acceptedInvite.targetTelegramUsernameLookupKey,
    });
    tx.hostedMemberRouting.findMany.mockResolvedValueOnce([{
      member: {
        billingStatus: HostedBillingStatus.active,
        createdAt: new Date("2026-06-18T12:00:00.000Z"),
        id: "member_other",
        suspendedAt: null,
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      memberId: "member_other",
      telegramUserIdEncrypted: "encrypted:999",
      telegramUserLookupKey: createHostedTelegramUserLookupKey("999"),
    }]);

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      telegramThreadId: "999",
      telegramUserId: "999",
      telegramUsername: "renamed_user",
      text: "/start family_invite_telegram",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
    });

    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
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

  it("accepts a phone plus Telegram invite from the matching Telegram username", async () => {
    const tx = createTxMock();
    const invite = createPendingInvite({
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
    });
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce(invite)
      .mockResolvedValueOnce(invite);

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername: "mom_user",
      text: "/start family_invite_phone",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      status: "active",
    });

    expect(tx.hostedMember.create).toHaveBeenCalled();
    expect(tx.hostedMemberRouting.upsert).toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        memberId: expect.stringMatching(/^hbm_/u),
      }),
    }));
  });

  it("accepts a phone plus Telegram invite from the matching phone webhook sender", async () => {
    const now = new Date("2026-06-18T12:30:00.000Z");
    const tx = createTxMock();
    const invite = createPendingInvite({
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
    });
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce(invite)
      .mockResolvedValueOnce(invite);

    await expect(acceptHostedFamilyInviteFromPhoneTx({
      now,
      phoneNumber: "+48 600 000 000",
      text: "family_invite_phone",
      tx,
    })).resolves.toMatchObject({
      memberId: "member_mom",
      status: "active",
    });

    expect(identityMocks.ensureHostedMemberForPhoneTx).toHaveBeenCalledWith({
      phoneNumber: "+48 600 000 000",
      phoneNumberVerifiedAt: now,
      prisma: tx,
    });
  });

  it("rejects a phone plus Telegram invite from the wrong Telegram username", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
    }));

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      now: new Date("2026-06-18T12:00:00.000Z"),
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername: "other_user",
      text: "/start family_invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
    });

    expect(tx.hostedMember.create).not.toHaveBeenCalled();
    expect(tx.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("rejects a phone plus Telegram invite from the wrong phone webhook sender", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
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

  it("accepts an email plus Telegram invite from the matching web email", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
    }));

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      email: "MOM@example.com",
      inviteCode: "invite_phone",
      requireWebBinding: true,
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      status: "active",
    });
  });

  it("accepts an email plus Telegram invite from the matching Telegram username", async () => {
    const tx = createTxMock();
    const invite = createPendingInvite({
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
    });
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce(invite)
      .mockResolvedValueOnce(invite);

    await expect(acceptHostedFamilyInviteFromTelegramTx({
      telegramThreadId: "123",
      telegramUserId: "456",
      telegramUsername: "mom_user",
      text: "/start family_invite_phone",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      status: "active",
    });
    expect(tx.hostedAccountGroupMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        memberId: expect.stringMatching(/^hbm_/u),
      }),
    }));
  });

  it("rejects an email plus Telegram invite on web when no session identity matches", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
    }));

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      email: "someone-else@example.com",
      inviteCode: "invite_phone",
      phoneNumber: "+48 600 000 000",
      requireWebBinding: true,
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_EMAIL_MISMATCH",
    });

    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
  });

  it("accepts an unbound invite via web with any signed-in member identity", async () => {
    const tx = createTxMock();

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      phoneNumber: "+48 600 000 000",
      requireWebBinding: true,
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      role: "member",
      status: "active",
    });
  });

  it("notifies the owner when a bound invite is accepted", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    });
    tx.hostedMemberIdentity.findUnique.mockResolvedValueOnce({
      maskedPhoneNumberHint: "+1 *** *** 1111",
      memberId: "member_owner",
      phoneLookupKey: createHostedPhoneLookupKey("+15550001111"),
      phoneNumberEncrypted: "encrypted:+15550001111",
      phoneNumberVerifiedAt: new Date("2026-06-18T12:00:00.000Z"),
      privyUserIdEncrypted: null,
      privyUserLookupKey: null,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumberEncrypted: null,
      walletAddressEncrypted: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    tx.hostedMemberRouting.findUnique.mockResolvedValueOnce({
      linqChatIdEncrypted: "encrypted:owner_home_chat",
      linqChatLookupKey: "owner_home_chat_lookup",
      linqHomeLineAssignedAt: new Date("2026-06-18T12:00:00.000Z"),
      linqParticipantContactKind: "phone",
      linqParticipantContactLookupKey: createHostedPhoneLookupKey("+15550001111"),
      linqRecipientPhoneEncrypted: "encrypted:+15559990000",
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15559990000"),
      memberId: "member_owner",
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted: null,
      pendingLinqParticipantContactKind: null,
      pendingLinqParticipantContactLookupKey: null,
      pendingLinqParticipantContactObservedAt: null,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
      replyAliasLookupKey: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      phoneNumber: "+48 600 000 000",
      tx,
    })).resolves.toMatchObject({
      memberId: "member_mom",
      status: "active",
    });

    expect(mailboxMocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    const appendInput = mailboxMocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0];
    expect(appendInput).toEqual(expect.objectContaining({ tx }));
    expect(appendInput?.envelope).toMatchObject({
      kind: "assistant.notification.requested",
      userId: "member_owner",
      notification: {
        responsePolicy: {
          kind: "require_send",
        },
      },
    });
    expect(appendInput?.envelope.notification.instructions).toContain(
      "Saved invite label",
    );
    expect(appendInput?.envelope.notification.instructions).toContain("\"Mom\"");
    expect(JSON.stringify(appendInput?.envelope)).not.toContain(
      "Mom just joined your family plan.",
    );
    expect(JSON.stringify(appendInput?.envelope)).not.toContain(
      "require_send_exact_text",
    );
  });

  it("preserves credential-compatible thread delivery for a legacy owner route", async () => {
    const tx = createTxMock();
    const ownerPhoneLookupKey = createHostedPhoneLookupKey("+15550001111");
    tx.hostedMemberIdentity.findUnique.mockResolvedValueOnce({
      maskedPhoneNumberHint: "+1 *** *** 1111",
      memberId: "member_owner",
      phoneLookupKey: ownerPhoneLookupKey,
      phoneNumberEncrypted: "encrypted:+15550001111",
      phoneNumberVerifiedAt: new Date("2026-06-18T12:00:00.000Z"),
      privyUserIdEncrypted: null,
      privyUserLookupKey: null,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumberEncrypted: null,
      walletAddressEncrypted: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    });
    tx.hostedMemberRouting.findUnique.mockResolvedValueOnce({
      linqChatIdEncrypted: "encrypted:legacy_home_chat",
      linqChatLookupKey: "legacy_home_chat_lookup",
      linqHomeLineAssignedAt: new Date("2026-06-18T12:00:00.000Z"),
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneEncrypted: "encrypted:+15559990000",
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15559990000"),
      memberId: "member_owner",
      pendingLinqChatIdEncrypted: "encrypted:pending_chat",
      pendingLinqChatLookupKey: "pending_chat_lookup",
      pendingLinqParticipantContactEncrypted: "encrypted:+15550002222",
      pendingLinqParticipantContactKind: "phone",
      pendingLinqParticipantContactLookupKey: "stale_pending_lookup",
      pendingLinqParticipantContactObservedAt: new Date("2026-06-18T12:01:00.000Z"),
      pendingLinqRecipientPhoneEncrypted: "encrypted:+15559990000",
      pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15559990000"),
      replyAliasLookupKey: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });

    const route = await resolveHostedFamilyChatNotificationRouteTx({
      memberId: "member_owner",
      tx,
    });
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "stale_pending_lookup",
      userId: "member_owner",
    });

    expect(route).toMatchObject({
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "legacy_home_chat",
      },
      identityId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        "stale_pending_lookup",
      ),
    });
  });

  it("rejects web acceptance of a Telegram-only invite", async () => {
    const tx = createTxMock();

    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce({
      ...createPendingInvite(),
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Mom_User"),
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      phoneNumber: "+48 600 000 000",
      requireWebBinding: true,
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_WEB_ACCEPT_REQUIRES_CONTACT",
    });
  });

  it("accepts an unbound invite from a new phone and binds the sender phone", async () => {
    const now = new Date("2026-06-18T12:30:00.000Z");
    const tx = createTxMock();
    const unboundInvite = createPendingInvite({
      targetEmailLookupKey: null,
      targetPhoneLookupKey: null,
      targetTelegramUsernameLookupKey: null,
    });
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce(unboundInvite)
      .mockResolvedValueOnce(unboundInvite);

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
    expect(tx.hostedAccountGroupMembership.upsert).toHaveBeenCalled();
  });

  it("marks family invite phone acceptance as provider-verified", async () => {
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
    const onAcceptedMemberLocked = vi.fn();
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
      onAcceptedMemberLocked,
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
    expect(onAcceptedMemberLocked).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("does not let phone acceptance claim a Telegram-bound invite", async () => {
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

  it("does not let phone acceptance claim an email-bound invite", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite({
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
      targetPhoneLookupKey: null,
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

  it("resolves accepted-member routing after member locks and before claiming the invite", async () => {
    const tx = createTxMock();
    const observedOrder: string[] = [];
    tx.$queryRaw.mockImplementation(async () => {
      observedOrder.push("member-lock");
      return [];
    });
    tx.hostedAccountGroupInvite.updateMany.mockImplementationOnce(async () => {
      observedOrder.push("invite-claim");
      return { count: 1 };
    });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      onAcceptedMemberLocked: async () => {
        observedOrder.push("route-binding");
      },
      tx,
    })).resolves.toMatchObject({
      memberId: "member_mom",
      status: "active",
    });

    expect(observedOrder).toEqual([
      "member-lock",
      "member-lock",
      "route-binding",
      "invite-claim",
    ]);
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

  it("keeps unbound double-claim single-winner when another accept already claimed it", async () => {
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

  it("returns activation recovery metadata on an accepted invite replay", async () => {
    const tx = createTxMock();
    const onAcceptedMemberActivated = vi.fn();
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
      onAcceptedMemberActivated,
      tx,
    })).resolves.toMatchObject({
      memberId: "member_mom",
      status: "active",
    });

    expect(onAcceptedMemberActivated).toHaveBeenCalledWith({
      activated: false,
      hostedExecutionEventId:
        "member.activated:hosted.family.sponsorship:member_mom:family-invite:hbagi_invite",
      hostedExecutionMailboxItemId: "mailbox_member_activation",
      memberId: "member_mom",
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

  it("copies an Edge invite tier onto the accepted membership", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(
      createPendingInvite({ planCode: "edge" }),
    );
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 1, planCode: "pulse" },
      { billedQuantity: 1, planCode: "edge" },
    ]);
    tx.hostedAccountGroupMembership.count.mockImplementation(async ({ where }) =>
      where?.planCode === "edge" ? 0 : 1
    );

    await acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    });

    expect(tx.hostedAccountGroupMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ planCode: "edge" }),
        update: expect.objectContaining({ planCode: "edge" }),
      }),
    );
  });

  it("payment-gates a price-increasing member tier before projecting Edge", async () => {
    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: null,
        planCode: "pulse",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.update.mockResolvedValueOnce({
      id: "hbagm_mom",
      pendingPlanCode: "edge",
      planCode: "pulse",
      updatedAt: pendingStartedAt,
    });
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "edge",
      planCode: "pulse",
    });
    tx.hostedAccountGroupMembership.findMany
      .mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "edge" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ]);
    const currentCapacities = [{ billedQuantity: 2, planCode: "pulse" }];
    const targetCapacities = [
      { billedQuantity: 1, planCode: "pulse" },
      { billedQuantity: 1, planCode: "edge" },
    ];
    tx.hostedAccountGroupPlanCapacity.findMany
      .mockResolvedValue(targetCapacities)
      .mockResolvedValueOnce(currentCapacities)
      .mockResolvedValueOnce(currentCapacities);
    const stripeRetrieve = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ itemQuantity: 2 }),
    );
    const paidInvoice = makeFamilyStripeInvoice({ status: "paid" });
    const stripeUpdate = vi.fn().mockResolvedValue({
      ...makeFamilyStripeSubscription({
        edgeItemQuantity: 1,
        itemQuantity: 1,
      }),
      latest_invoice: paidInvoice,
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn().mockResolvedValue(
          makeFamilyStripeInvoicePaymentList([]),
        ),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(paidInvoice),
      },
      subscriptions: {
        retrieve: stripeRetrieve,
        update: stripeUpdate,
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).resolves.toMatchObject({ syncing: false });

    expect(tx.hostedAccountGroupMembership.update).toHaveBeenCalledWith({
      data: { pendingPlanCode: "edge" },
      select: { id: true, pendingPlanCode: true, planCode: true, updatedAt: true },
      where: { id: "hbagm_mom" },
    });
    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        items: [
          { id: "si_family", quantity: 1 },
          { price: "price_family_edge", quantity: 1 },
        ],
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "always_invoice",
        proration_date: Math.floor(pendingStartedAt.getTime() / 1_000),
      }),
      {
        idempotencyKey: expect.stringMatching(
          new RegExp(
            `^family-member-plan:hbag_family:hbagm_mom:${pendingStartedAt.getTime()}:edge:[a-f0-9]{32}$`,
          ),
        ),
      },
    );
    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { planCode: "edge" } }),
    );
  });

  it("payment-gates the last Pulse seat by price, then consolidates without a second proration", async () => {
    const tx = createTxMock({ activeMembershipCount: 6, billedSeatCount: 6 });
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: null,
        planCode: "pulse",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.update.mockResolvedValueOnce({
      id: "hbagm_mom",
      pendingPlanCode: "edge",
      planCode: "pulse",
      updatedAt: pendingStartedAt,
    });
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "edge",
      planCode: "pulse",
    });
    const currentAssignments = [
      { memberId: "member_owner", planCode: "edge" },
      { memberId: "member_two", planCode: "edge" },
      { memberId: "member_three", planCode: "edge" },
      { memberId: "member_four", planCode: "edge" },
      { memberId: "member_five", planCode: "edge" },
      { memberId: "member_mom", planCode: "pulse" },
    ];
    tx.hostedAccountGroupMembership.findMany
      .mockResolvedValue(currentAssignments.map((assignment) => (
        assignment.memberId === "member_mom"
          ? { ...assignment, planCode: "edge" }
          : assignment
      )))
      .mockResolvedValueOnce(currentAssignments)
      .mockResolvedValueOnce(currentAssignments)
      .mockResolvedValueOnce(currentAssignments);
    const currentCapacities = [
      { billedQuantity: 1, planCode: "pulse" },
      { billedQuantity: 5, planCode: "edge" },
    ];
    tx.hostedAccountGroupPlanCapacity.findMany
      .mockResolvedValue([{ billedQuantity: 6, planCode: "edge" }])
      .mockResolvedValueOnce(currentCapacities)
      .mockResolvedValueOnce(currentCapacities);

    const paidInvoice = makeFamilyStripeInvoice({ status: "paid" });
    const duplicateApplied: Stripe.Subscription = {
      ...makeFamilyStripeSubscription({
        edgeItemQuantity: 5,
        itemQuantity: 1,
        priceId: "price_family_edge",
      }),
      latest_invoice: paidInvoice,
    };
    const normalizedBase = makeFamilyStripeSubscription({
      edgeItemQuantity: 6,
    });
    const normalized: Stripe.Subscription = {
      ...normalizedBase,
      items: {
        ...normalizedBase.items,
        data: [normalizedBase.items.data[1]!],
      },
      latest_invoice: paidInvoice,
    };
    const stripeUpdate = vi.fn()
      .mockResolvedValueOnce(duplicateApplied)
      .mockResolvedValueOnce(normalized);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn().mockResolvedValue(
          makeFamilyStripeInvoicePaymentList([]),
        ),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(paidInvoice),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(
          makeFamilyStripeSubscription({
            edgeItemQuantity: 5,
            itemQuantity: 1,
          }),
        ),
        update: stripeUpdate,
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).resolves.toMatchObject({ syncing: true });

    expect(stripeUpdate).toHaveBeenNthCalledWith(
      1,
      "sub_family",
      expect.objectContaining({
        items: [{
          id: "si_family",
          price: "price_family_edge",
          quantity: 1,
        }],
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "always_invoice",
      }),
      expect.any(Object),
    );
    expect(stripeUpdate).toHaveBeenNthCalledWith(
      2,
      "sub_family",
      expect.objectContaining({
        items: [
          { id: "si_family_edge", quantity: 6 },
          { deleted: true, id: "si_family" },
        ],
        proration_behavior: "none",
      }),
      expect.any(Object),
    );
    expect(stripeUpdate.mock.calls[1]?.[1]).not.toHaveProperty(
      "payment_behavior",
    );
    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { planCode: "edge" } }),
    );
  });

  it.each([
    "requires_action",
    "requires_payment_method",
  ] as const)(
    "returns the exact Stripe action URL when a member tier charge %s",
    async (paymentIntentStatus) => {
    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: null,
        planCode: "pulse",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.update.mockResolvedValueOnce({
      id: "hbagm_mom",
      pendingPlanCode: "edge",
      planCode: "pulse",
      updatedAt: pendingStartedAt,
    });
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "edge",
      planCode: "pulse",
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
      { memberId: "member_mom", planCode: "pulse" },
    ]);
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 2, planCode: "pulse" },
    ]);

    const currentSubscription = makeFamilyStripeSubscription({ itemQuantity: 2 });
    const targetSubscription = makeFamilyStripeSubscription({
      edgeItemQuantity: 1,
      itemQuantity: 1,
    });
    const actionInvoice = makeFamilyStripeInvoice({
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_test/in_member_plan",
      status: "open",
    });
    const pendingSubscription: Stripe.Subscription = {
      ...currentSubscription,
      latest_invoice: actionInvoice,
      pending_update: {
        ...makeFamilyStripePendingUpdate({
          quantity: 1,
          subscriptionItem: currentSubscription.items.data[0]!,
        }),
        subscription_items: targetSubscription.items.data,
      },
    };
    const stripeUpdate = vi.fn().mockResolvedValue(pendingSubscription);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn().mockResolvedValue(makeFamilyStripeInvoicePaymentList([
          makeFamilyStripeInvoicePayment({
            invoiceId: actionInvoice.id,
            paymentIntentStatus,
          }),
        ])),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(actionInvoice),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(currentSubscription),
        update: stripeUpdate,
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CAPACITY_PAYMENT_REQUIRED",
      details: {
        paymentUrl: "https://invoice.stripe.com/i/acct_test/in_member_plan",
      },
      httpStatus: 409,
      retryable: false,
    });

    expect(stripeUpdate).toHaveBeenCalledTimes(1);
    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "always_invoice",
      }),
      expect.any(Object),
    );
    expect(tx.hostedAccountGroupMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pendingPlanCode: "edge" } }),
    );
    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { planCode: "edge" } }),
    );
    },
  );

  it("keeps Pulse entitlement when the exact upgrade invoice is uncollectible", async () => {
    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: null,
        planCode: "pulse",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.update.mockResolvedValueOnce({
      id: "hbagm_mom",
      pendingPlanCode: "edge",
      planCode: "pulse",
      updatedAt: pendingStartedAt,
    });
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "edge",
      planCode: "pulse",
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
      { memberId: "member_mom", planCode: "pulse" },
    ]);
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 2, planCode: "pulse" },
    ]);

    const currentSubscription = makeFamilyStripeSubscription({
      itemQuantity: 2,
    });
    const targetSubscription = makeFamilyStripeSubscription({
      edgeItemQuantity: 1,
      itemQuantity: 1,
    });
    const terminalInvoice = makeFamilyStripeInvoice({
      status: "uncollectible",
    });
    const pendingSubscription: Stripe.Subscription = {
      ...currentSubscription,
      latest_invoice: terminalInvoice,
      pending_update: {
        ...makeFamilyStripePendingUpdate({
          quantity: 1,
          subscriptionItem: currentSubscription.items.data[0]!,
        }),
        subscription_items: targetSubscription.items.data,
      },
    };
    const stripeUpdate = vi.fn().mockResolvedValue(pendingSubscription);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn().mockResolvedValue(
          makeFamilyStripeInvoicePaymentList([]),
        ),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(terminalInvoice),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(currentSubscription),
        update: stripeUpdate,
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_BILLING_PAYMENT_TERMINAL",
      details: { collectionState: "uncollectible" },
      httpStatus: 409,
      retryable: false,
    });

    expect(stripeUpdate).toHaveBeenCalledTimes(1);
    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { planCode: "edge" } }),
    );
  });

  it("reuses the original pending timestamp and idempotency key on retry", async () => {
    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: "edge",
        planCode: "pulse",
        updatedAt: pendingStartedAt,
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "edge",
      planCode: "pulse",
    });
    tx.hostedAccountGroupMembership.findMany
      .mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "edge" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ]);
    const currentCapacities = [{ billedQuantity: 2, planCode: "pulse" }];
    tx.hostedAccountGroupPlanCapacity.findMany
      .mockResolvedValue([
        { billedQuantity: 1, planCode: "pulse" },
        { billedQuantity: 1, planCode: "edge" },
      ])
      .mockResolvedValueOnce(currentCapacities)
      .mockResolvedValueOnce(currentCapacities);
    const paidInvoice = makeFamilyStripeInvoice({ status: "paid" });
    const stripeUpdate = vi.fn().mockResolvedValue({
      ...makeFamilyStripeSubscription({
        edgeItemQuantity: 1,
        itemQuantity: 1,
      }),
      latest_invoice: paidInvoice,
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn().mockResolvedValue(
          makeFamilyStripeInvoicePaymentList([]),
        ),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(paidInvoice),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(
          makeFamilyStripeSubscription({ itemQuantity: 2 }),
        ),
        update: stripeUpdate,
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).resolves.toMatchObject({ syncing: true });

    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalled();
    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        proration_date: Math.floor(pendingStartedAt.getTime() / 1_000),
      }),
      {
        idempotencyKey: expect.stringMatching(
          new RegExp(
            `^family-member-plan:hbag_family:hbagm_mom:${pendingStartedAt.getTime()}:edge:[a-f0-9]{32}$`,
          ),
        ),
      },
    );
  });

  it("retries a locally pending upgrade after exact expired-update proof rotates provider state", async () => {
    const actualFinancialLookup = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
    >("@/src/lib/hosted-onboarding/stripe-billing-lookup");
    recurringFinancialMocks.readHostedStripeRecurringFinancialState
      .mockImplementation(
        actualFinancialLookup.readHostedStripeRecurringFinancialState,
      );
    recurringFinancialMocks.classifyHostedStripeRecurringFinancialHealth
      .mockImplementation(
        actualFinancialLookup.classifyHostedStripeRecurringFinancialHealth,
      );

    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: "edge",
        planCode: "pulse",
        updatedAt: pendingStartedAt,
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "edge",
      planCode: "pulse",
    });
    tx.hostedAccountGroupMembership.findMany
      .mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "edge" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ]);
    const currentCapacities = [{ billedQuantity: 2, planCode: "pulse" }];
    tx.hostedAccountGroupPlanCapacity.findMany
      .mockResolvedValue([
        { billedQuantity: 1, planCode: "pulse" },
        { billedQuantity: 1, planCode: "edge" },
      ])
      .mockResolvedValueOnce(currentCapacities)
      .mockResolvedValueOnce(currentCapacities);

    const expiredInvoice = makeFamilyStripeInvoice({
      amountRemaining: 700,
      billingReason: "subscription_update",
      id: "in_family_expired_edge",
      lines: [
        makeFamilyStripeInvoiceLine({
          amount: 700,
          invoiceId: "in_family_expired_edge",
          periodStart: FAMILY_STRIPE_PERIOD_START_SECONDS + 3_600,
          priceId: "price_family_edge",
          proration: true,
          quantity: 1,
          subscriptionItemId: "si_family_edge_expired",
        }),
      ],
      status: "void",
    });
    const paidBaseInvoice = makeFamilyStripeInvoice({
      amountPaid: 1_600,
      billingReason: "subscription_cycle",
      id: "in_family_paid_base",
      lines: [
        makeFamilyStripeInvoiceLine({
          amount: 1_600,
          invoiceId: "in_family_paid_base",
          priceId: "price_family",
          quantity: 2,
          subscriptionItemId: "si_family",
        }),
      ],
      status: "paid",
    });
    const retryInvoice = makeFamilyStripeInvoice({
      id: "in_family_retry_paid",
      lines: [
        makeFamilyStripeInvoiceLine({
          invoiceId: "in_family_retry_paid",
          periodStart: FAMILY_STRIPE_PERIOD_START_SECONDS + 7_200,
          priceId: "price_family_edge",
          proration: true,
          quantity: 1,
          subscriptionItemId: "si_family_edge",
        }),
      ],
      status: "paid",
    });
    const expiredSubscription: Stripe.Subscription = {
      ...makeFamilyStripeSubscription({ itemQuantity: 2 }),
      latest_invoice: expiredInvoice,
    };
    const pendingSubscription: Stripe.Subscription = {
      ...expiredSubscription,
      latest_invoice: {
        ...expiredInvoice,
        status: "open",
      },
      pending_update: makeFamilyStripePendingUpdate({
        quantity: 1,
        subscriptionItem: makeFamilyStripeSubscriptionItem({
          id: "si_family_edge_expired",
          priceId: "price_family_edge",
          quantity: 1,
          subscriptionId: "sub_family",
        }),
      }),
    };
    const updatedSubscription: Stripe.Subscription = {
      ...makeFamilyStripeSubscription({
        edgeItemQuantity: 1,
        itemQuantity: 1,
      }),
      latest_invoice: retryInvoice,
    };
    const invoiceById = new Map([
      [expiredInvoice.id, expiredInvoice],
      [paidBaseInvoice.id, paidBaseInvoice],
      [retryInvoice.id, retryInvoice],
    ]);
    const stripeUpdate = vi.fn().mockResolvedValue(updatedSubscription);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      disputes: {
        list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
      },
      invoicePayments: {
        list: vi.fn().mockImplementation(async ({ invoice }) => ({
          data: invoice === paidBaseInvoice.id
            ? [makeFamilyStripeInvoicePayment({
                amountPaid: 1_600,
                invoiceId: paidBaseInvoice.id,
                paymentIntentId: "pi_family_paid_base",
                paymentIntentStatus: "succeeded",
              })]
            : [],
          has_more: false,
          object: "list",
          url: "/v1/invoice_payments",
        })),
      },
      invoices: {
        list: vi.fn().mockResolvedValue({
          data: [expiredInvoice, paidBaseInvoice],
          has_more: false,
        }),
        retrieve: vi.fn().mockImplementation(async (invoiceId) => {
          const invoice = invoiceById.get(invoiceId);
          if (!invoice) {
            throw new Error(`Unexpected invoice fixture: ${invoiceId}`);
          }
          return invoice;
        }),
      },
      refunds: {
        list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(expiredSubscription),
        update: stripeUpdate,
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    const expiredScope =
      buildHostedStripeSubscriptionMutationScope(expiredSubscription);
    expect(expiredScope).not.toBe(
      buildHostedStripeSubscriptionMutationScope(pendingSubscription),
    );

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).resolves.toMatchObject({ syncing: true });

    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "always_invoice",
      }),
      {
        idempotencyKey:
          `family-member-plan:hbag_family:hbagm_mom:${pendingStartedAt.getTime()}:edge:${expiredScope}`,
      },
    );
  });

  it("downgrades a member at maximum capacity with one exact six-seat Stripe swap", async () => {
    const tx = createTxMock({ activeMembershipCount: 6, billedSeatCount: 6 });
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: null,
        planCode: "edge",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.update.mockResolvedValueOnce({
      id: "hbagm_mom",
      pendingPlanCode: "pulse",
      planCode: "edge",
      updatedAt: pendingStartedAt,
    });
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "pulse",
      planCode: "edge",
    });
    const currentAssignments = [
      { memberId: "member_owner", planCode: "pulse" },
      { memberId: "member_two", planCode: "pulse" },
      { memberId: "member_three", planCode: "pulse" },
      { memberId: "member_four", planCode: "pulse" },
      { memberId: "member_five", planCode: "pulse" },
      { memberId: "member_mom", planCode: "edge" },
    ];
    tx.hostedAccountGroupMembership.findMany
      .mockResolvedValue(currentAssignments.map((assignment) => (
        assignment.memberId === "member_mom"
          ? { ...assignment, planCode: "pulse" }
          : assignment
      )))
      .mockResolvedValueOnce(currentAssignments)
      .mockResolvedValueOnce(currentAssignments)
      .mockResolvedValueOnce(currentAssignments);
    const currentCapacities = [
      { billedQuantity: 5, planCode: "pulse" },
      { billedQuantity: 1, planCode: "edge" },
    ];
    tx.hostedAccountGroupPlanCapacity.findMany
      .mockResolvedValue([{ billedQuantity: 6, planCode: "pulse" }])
      .mockResolvedValueOnce(currentCapacities)
      .mockResolvedValueOnce(currentCapacities);
    const stripeUpdate = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ itemQuantity: 6 }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(
          makeFamilyStripeSubscription({ edgeItemQuantity: 1, itemQuantity: 5 }),
        ),
        update: stripeUpdate,
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "pulse",
      prisma: prisma as never,
    })).resolves.toMatchObject({ syncing: true });

    expect(stripeUpdate).toHaveBeenCalledTimes(1);
    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        items: [
          { id: "si_family", quantity: 6 },
          { deleted: true, id: "si_family_edge" },
        ],
        proration_behavior: "create_prorations",
      }),
      expect.any(Object),
    );
    expect(stripeUpdate.mock.calls[0]?.[1]).not.toHaveProperty(
      "payment_behavior",
    );
  });

  it("rejects a second pending member tier change in the same group", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: null,
        planCode: "pulse",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce({ id: "hbagm_other" });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_PLAN_SYNCING",
    });

    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalled();
    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "billing reversal",
      lockedBillingStatus: HostedBillingStatus.unpaid,
      lockedSuspendedAt: null,
    },
    {
      label: "group suspension",
      lockedBillingStatus: HostedBillingStatus.active,
      lockedSuspendedAt: new Date("2026-07-15T11:30:00.000Z"),
    },
  ])(
    "does not persist a member plan intent after concurrent $label under the owner lock",
    async ({ lockedBillingStatus, lockedSuspendedAt }) => {
      const activeGroup = {
        billingStatus: HostedBillingStatus.active,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      };
      const tx = createTxMock({ group: activeGroup });
      tx.hostedAccountGroup.findUnique
        .mockResolvedValueOnce(activeGroup)
        .mockResolvedValueOnce({
          ...activeGroup,
          billingStatus: lockedBillingStatus,
          suspendedAt: lockedSuspendedAt,
        });
      const prisma = tx as FamilyPlanTxMock & {
        $transaction: ReturnType<typeof vi.fn>;
      };
      prisma.$transaction = vi.fn((callback) => callback(tx));

      await expect(updateHostedFamilyMemberPlan({
        groupId: "hbag_family",
        memberId: "member_mom",
        ownerMemberId: "member_owner",
        planCode: "edge",
        prisma: prisma as never,
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_BILLING_INACTIVE",
      });

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.hostedAccountGroup.findUnique.mock.invocationCallOrder[1]!,
      );
      expect(tx.hostedAccountGroupMembership.findFirst).not.toHaveBeenCalled();
      expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalled();
      expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    },
  );

  it("keeps the current member tier when the Stripe swap fails", async () => {
    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_mom",
        pendingPlanCode: null,
        planCode: "pulse",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.update.mockResolvedValueOnce({
      id: "hbagm_mom",
      pendingPlanCode: "edge",
      planCode: "pulse",
      updatedAt: pendingStartedAt,
    });
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "edge",
      planCode: "pulse",
    });
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 2, planCode: "pulse" },
    ]);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(
          makeFamilyStripeSubscription({ itemQuantity: 2 }),
        ),
        update: vi.fn().mockRejectedValue(new Error("stripe unavailable")),
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).rejects.toThrow("stripe unavailable");

    expect(tx.hostedAccountGroupMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pendingPlanCode: "edge" } }),
    );
    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { planCode: "edge" } }),
    );
  });

  it("signals the accepted member activation mailbox after browser acceptance commits", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(acceptHostedFamilyInvite({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      memberId: "member_mom",
      status: "active",
    });

    expect(activationWakeMocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .toHaveBeenCalledWith({
        hostedExecutionEventId: "member.activated:family",
        mailboxItemId: "mailbox_member_activation",
        memberId: "member_mom",
        prisma,
        source: "family-invite-web-accept",
        timeoutMs: 5_000,
      });
  });

  it("replays browser acceptance by waking the existing activation mailbox", async () => {
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
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(acceptHostedFamilyInvite({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      memberId: "member_mom",
      status: "active",
    });

    expect(activationWakeMocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .toHaveBeenCalledWith({
        hostedExecutionEventId:
          "member.activated:hosted.family.sponsorship:member_mom:family-invite:hbagi_invite",
        mailboxItemId: "mailbox_member_activation",
        memberId: "member_mom",
        prisma,
        source: "family-invite-web-accept",
        timeoutMs: 5_000,
      });
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
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

  it("does not accept a Family invite while an individual Checkout attempt is open", async () => {
    const tx = createTxMock();
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingRef: {
        checkoutAttemptId: "checkout_attempt_open",
        currentBillingPhase: null,
        stripeSubscriptionLookupKey: null,
      },
      billingStatus: HostedBillingStatus.not_started,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_CHECKOUT_IN_PROGRESS",
    });

    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
  });

  it("does not accept a Family invite while any individual subscription is bound", async () => {
    const tx = createTxMock();
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingRef: {
        checkoutAttemptId: null,
        currentBillingPhase: null,
        stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:bound",
      },
      billingStatus: HostedBillingStatus.unpaid,
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
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      id: "hbagm_child",
      pendingPlanCode: null,
    });

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
        id: "hbagm_child",
        pendingPlanCode: null,
        status: "active",
      },
    }));
  });

  it("does not remove a member while their tier change is syncing", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      id: "hbagm_child",
      pendingPlanCode: "edge",
    });

    await expect(removeHostedFamilyMemberTx({
      groupId: "hbag_family",
      memberId: "member_child",
      ownerMemberId: "member_owner",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_PLAN_SYNCING",
    });

    expect(tx.hostedAccountGroupMembership.updateMany).not.toHaveBeenCalled();
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

  it("grants family access on membership alone without re-counting seats at read time", async () => {
    // Seat overage is enforced at write time: invite issuance/acceptance
    // assert seat fit and the subscription webhook fails the whole group to
    // `unpaid` when active members exceed billed seats. The read side trusts
    // that invariant instead of re-deriving it on every access check.
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
      prisma: tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
    });

    expect(tx.hostedAccountGroupMembership.count).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.count).not.toHaveBeenCalled();
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

  it("projects exact mixed-tier quantities from one Family subscription", async () => {
    const tx = createTxMock();

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        edgeItemQuantity: 1,
        itemQuantity: 2,
      }),
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          billedSeatCount: 3,
          currentBillingPhase: "paid",
        }),
      }),
    );
    expect(tx.hostedAccountGroupPlanCapacity.createMany).toHaveBeenCalledWith({
      data: [
        { billedQuantity: 2, groupId: "hbag_family", planCode: "pulse" },
        { billedQuantity: 1, groupId: "hbag_family", planCode: "edge" },
      ],
    });
  });

  it("completes a pending member tier in the same webhook transaction as capacity", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      {
        id: "hbagm_owner",
        memberId: "member_owner",
        pendingPlanCode: null,
        planCode: "pulse",
      },
      {
        id: "hbagm_mom",
        memberId: "member_mom",
        pendingPlanCode: "edge",
        planCode: "pulse",
      },
    ]);
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 2, planCode: "pulse" },
    ]);

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-07-15T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        edgeItemQuantity: 1,
        itemQuantity: 1,
      }),
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupMembership.updateMany).toHaveBeenCalledWith({
      data: {
        pendingPlanCode: null,
        planCode: "edge",
      },
      where: {
        id: "hbagm_mom",
        pendingPlanCode: "edge",
        planCode: "pulse",
        status: "active",
      },
    });
    expect(tx.hostedAccountGroupPlanCapacity.createMany).toHaveBeenCalledWith({
      data: [
        { billedQuantity: 1, groupId: "hbag_family", planCode: "pulse" },
        { billedQuantity: 1, groupId: "hbag_family", planCode: "edge" },
      ],
    });
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: { billingStatus: HostedBillingStatus.active },
      where: { id: "hbag_family" },
    });
  });

  it("recovers a paid last-Pulse upgrade by consolidating before webhook projection", async () => {
    const tx = createTxMock({ activeMembershipCount: 6, billedSeatCount: 6 });
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      {
        id: "hbagm_owner",
        memberId: "member_owner",
        pendingPlanCode: null,
        planCode: "edge",
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      {
        id: "hbagm_two",
        memberId: "member_two",
        pendingPlanCode: null,
        planCode: "edge",
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      {
        id: "hbagm_three",
        memberId: "member_three",
        pendingPlanCode: null,
        planCode: "edge",
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      {
        id: "hbagm_four",
        memberId: "member_four",
        pendingPlanCode: null,
        planCode: "edge",
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      {
        id: "hbagm_five",
        memberId: "member_five",
        pendingPlanCode: null,
        planCode: "edge",
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      {
        id: "hbagm_mom",
        memberId: "member_mom",
        pendingPlanCode: "edge",
        planCode: "pulse",
        updatedAt: pendingStartedAt,
      },
    ]);
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 1, planCode: "pulse" },
      { billedQuantity: 5, planCode: "edge" },
    ]);
    const paidInvoice = makeFamilyStripeInvoice({ status: "paid" });
    const duplicateApplied: Stripe.Subscription = {
      ...makeFamilyStripeSubscription({
        edgeItemQuantity: 5,
        itemQuantity: 1,
        priceId: "price_family_edge",
      }),
      latest_invoice: paidInvoice,
    };
    const normalizedBase = makeFamilyStripeSubscription({
      edgeItemQuantity: 6,
    });
    const normalized: Stripe.Subscription = {
      ...normalizedBase,
      items: {
        ...normalizedBase.items,
        data: [normalizedBase.items.data[1]!],
      },
      latest_invoice: paidInvoice,
    };
    const stripeUpdate = vi.fn().mockResolvedValue(normalized);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn().mockResolvedValue(
          makeFamilyStripeInvoicePaymentList([]),
        ),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(paidInvoice),
      },
      subscriptions: {
        update: stripeUpdate,
      },
    });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-07-15T12:30:00.000Z"),
      },
      subscription: duplicateApplied,
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        items: [
          { id: "si_family_edge", quantity: 6 },
          { deleted: true, id: "si_family" },
        ],
        proration_behavior: "none",
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^family-member-plan:hbag_family:hbagm_mom:\d+:edge:normalize:[a-f0-9]{32}$/u,
        ),
      }),
    );
    expect(tx.hostedAccountGroupMembership.updateMany).toHaveBeenCalledWith({
      data: {
        pendingPlanCode: null,
        planCode: "edge",
      },
      where: {
        id: "hbagm_mom",
        pendingPlanCode: "edge",
        planCode: "pulse",
        status: "active",
      },
    });
    expect(tx.hostedAccountGroupPlanCapacity.createMany).toHaveBeenCalledWith({
      data: [
        { billedQuantity: 6, groupId: "hbag_family", planCode: "edge" },
      ],
    });
  });

  it("keeps a pending member tier when a webhook has the current quantities", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      {
        id: "hbagm_owner",
        memberId: "member_owner",
        pendingPlanCode: null,
        planCode: "pulse",
      },
      {
        id: "hbagm_mom",
        memberId: "member_mom",
        pendingPlanCode: "edge",
        planCode: "pulse",
      },
    ]);
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 2, planCode: "pulse" },
    ]);

    await applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-07-15T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({ itemQuantity: 2 }),
      tx,
    });

    expect(tx.hostedAccountGroupMembership.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ planCode: "edge" }),
      }),
    );
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: { billingStatus: HostedBillingStatus.active },
      where: { id: "hbag_family" },
    });
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

  it("rejects subscription reconciliation for a synthetic Family owner before billing writes", async () => {
    const tx = createTxMock();
    tx.hostedThreadContainer.findUnique.mockResolvedValueOnce({
      memberId: "member_owner",
    });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_PERSONAL_OWNER_REQUIRED",
      httpStatus: 403,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("prepares consistent cleanup for a legacy Family invoice without a customer", async () => {
    const lastStripeEventCreatedAt = new Date("2026-06-18T12:00:00.000Z");
    const event = makeFamilyStripeSubscriptionEvent();
    Object.assign(event, { id: "evt_family_invoice", type: "invoice.paid" });
    Object.assign(event.data.object, {
      customer: null,
      id: "in_family",
      object: "invoice",
      subscription: "sub_family",
    });
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      group,
    });
    const billingRef = createBillingRefMock({ group, lastStripeEventCreatedAt });
    tx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([billingRef]);
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(billingRef);
    tx.hostedThreadContainer.findUnique.mockResolvedValue({ memberId: "member_owner" });

    await expect(prepareHostedLegacySyntheticFamilyCleanupTx({
      event,
      tx,
    })).resolves.toBe("sub_family");

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.hostedAccountGroupBillingRef.findMany.mock.invocationCallOrder[1],
    );
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        billedSeatCount: null,
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_family_monthly",
        currentPeriodEnd: null,
        currentPeriodStart: null,
        lastStripeEventCreatedAt,
        stripeCustomerLookupKey: expect.stringMatching(/^hbidx:stripe-customer:v1:/u),
        stripeSubscriptionItemLookupKey: null,
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      }),
    }));
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: { billingStatus: HostedBillingStatus.canceled },
      where: { id: "hbag_family" },
    });
  });

  it("leaves already-active legacy Family billing for explicit operator repair", async () => {
    const tx = createTxMock();
    tx.hostedThreadContainer.findUnique.mockResolvedValue({ memberId: "member_owner" });

    await expect(prepareHostedLegacySyntheticFamilyCleanupTx({
      event: makeFamilyStripeSubscriptionEvent(),
      tx,
    })).resolves.toBeNull();

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
  });

  it("does not clean up a legacy event after its Family binding changes under lock", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([]);
    tx.hostedAccountGroupBillingRef.findUnique
      .mockResolvedValueOnce(createBillingRefMock())
      .mockResolvedValueOnce(createBillingRefMock({
        stripeSubscriptionIdEncrypted: "encrypted:sub_newer",
      }));

    await expect(prepareHostedLegacySyntheticFamilyCleanupTx({
      event: makeFamilyStripeSubscriptionEvent(),
      tx,
    })).resolves.toBeNull();

    expect(tx.hostedThreadContainer.findUnique).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
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

  it("does not clear a different direct subscription during Family reconciliation", async () => {
    const tx = createTxMock();
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(
      createMemberBillingRefMock({
        stripeSubscriptionIdEncrypted: "encrypted:sub_other_direct",
      }),
    );

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({ subscriptionId: "sub_family" }),
      tx,
    })).resolves.toMatchObject({ groupId: "hbag_family" });

    expect(tx.hostedMember.update).not.toHaveBeenCalled();
    expect(tx.hostedMemberBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when Stripe seats drop below active Family memberships", async () => {
    const tx = createTxMock({
      activeMembershipCount: 3,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
      { memberId: "member_mom", planCode: "pulse" },
      { memberId: "member_dad", planCode: "pulse" },
    ]);

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

  it("derives active Family billing from memberships read under the owner lock", async () => {
    const tx = createTxMock();
    let ownerLocked = false;
    tx.$queryRaw.mockImplementation(async () => {
      ownerLocked = true;
      return [];
    });
    tx.hostedAccountGroupMembership.findMany.mockImplementation(async () =>
      ownerLocked
        ? [
            { memberId: "member_owner", planCode: "pulse" },
            { memberId: "member_mom", planCode: "pulse" },
            { memberId: "member_dad", planCode: "pulse" },
          ]
        : [
            { memberId: "member_owner", planCode: "pulse" },
            { memberId: "member_mom", planCode: "pulse" },
          ]
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
      tx.hostedAccountGroupMembership.findMany.mock.invocationCallOrder[0],
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
      { id: "inv_newest", planCode: "pulse" },
      { id: "inv_oldest", planCode: "pulse" },
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
    expect(tx.hostedAccountGroupPlanCapacity.deleteMany).toHaveBeenCalledWith({
      where: { groupId: "hbag_family" },
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);

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

  it("rejects synthetic owners before creating a Stripe Checkout Session", async () => {
    const tx = createTxMock({
      billedSeatCount: null,
      group: {
        billingStatus: HostedBillingStatus.not_started,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
    });
    tx.hostedThreadContainer.findUnique.mockResolvedValueOnce({
      memberId: "member_owner",
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
      code: "HOSTED_FAMILY_PERSONAL_OWNER_REQUIRED",
      httpStatus: 403,
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("does not reserve Family checkout after the owner suspension fence", async () => {
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
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      suspendedAt: new Date("2026-07-25T12:00:00.000Z"),
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_OWNER_SUSPENDED",
      httpStatus: 409,
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("does not start Family Checkout while the owner has an open individual Checkout", async () => {
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
    tx.hostedMemberBillingRef.findUnique.mockResolvedValueOnce({
      checkoutAttemptId: "checkout_attempt_open",
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
      code: "HOSTED_FAMILY_MEMBER_CHECKOUT_IN_PROGRESS",
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
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
    const checkoutCreate = vi.fn().mockImplementation(
      async (params: Stripe.Checkout.SessionCreateParams) =>
        makeFamilyStripeCheckoutSessionFromCreate(params, {
          sessionId: "cs_test_familyRetry123",
          status: "open",
          subscriptionId: null,
        }),
    );
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

  it("fails closed on a deterministic Family Checkout provider rejection", async () => {
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
    const checkoutCreate = vi.fn().mockRejectedValue({
      code: "parameter_unknown",
      param: "line_items[0][price]",
      requestId: "req_family_checkout_invalid",
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_PROVIDER_REJECTED",
      httpStatus: 500,
      retryable: false,
    });

    expect(checkoutCreate).toHaveBeenCalledOnce();
    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: expect.stringMatching(
        /^hosted-family-checkout:hbag_family:hbfca_/u,
      ),
    });
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          checkoutAttemptId: expect.stringMatching(/^hbfca_/u),
          checkoutSeatCount: 2,
        }),
        update: expect.objectContaining({
          stripeCheckoutSessionIdEncrypted: null,
          stripeCheckoutSessionLookupKey: null,
        }),
      }),
    );
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutSeatCount: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: {
        checkoutAttemptId: expect.stringMatching(/^hbfca_/u),
        groupId: group.id,
        stripeCheckoutSessionLookupKey: null,
        stripeSubscriptionLookupKey: null,
      },
    });
    errorSpy.mockRestore();
  });

  it("does not bind a newly created Family Checkout Session with mismatched ownership", async () => {
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
    const checkoutCreate = vi.fn().mockImplementation(
      async (params: Stripe.Checkout.SessionCreateParams) =>
        makeFamilyStripeCheckoutSessionFromCreate(params, {
          ownerMemberId: "member_other",
          sessionId: "cs_test_familyWrongOwner123",
          status: "open",
          subscriptionId: null,
        }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_ATTEMPT_STALE",
      httpStatus: 409,
      retryable: false,
    });

    expect(checkoutCreate).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("retains an unbound Family Checkout attempt when Stripe's outcome is ambiguous", async () => {
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
    const checkoutCreate = vi.fn().mockRejectedValue({
      type: "StripeConnectionError",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_STRIPE_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("binds then expires and clears a Family Checkout Session that has no redirect URL", async () => {
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
    const checkoutCreate = vi.fn().mockImplementation(
      async (params: Stripe.Checkout.SessionCreateParams) =>
        makeFamilyStripeCheckoutSessionFromCreate(params, {
          sessionId: "cs_test_familyMissingUrl123",
          status: "open",
          subscriptionId: null,
          url: null,
        }),
    );
    const checkoutExpire = vi.fn().mockResolvedValue({
      id: "cs_test_familyMissingUrl123",
      status: "expired",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          expire: checkoutExpire,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });

    expect(checkoutExpire).toHaveBeenCalledWith(
      "cs_test_familyMissingUrl123",
    );
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          stripeCheckoutSessionIdEncrypted:
            "encrypted:cs_test_familyMissingUrl123",
        }),
      }),
    );
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          checkoutAttemptId: null,
          stripeCheckoutSessionIdEncrypted: null,
        }),
        where: expect.objectContaining({
          groupId: group.id,
          stripeCheckoutSessionLookupKey: {
            in: [
              expect.stringMatching(
                /^hbidx:stripe-checkout-session:v1:/u,
              ),
            ],
          },
        }),
      }),
    );
  });

  it("expires a newly created Family Checkout when the owner is suspended before binding", async () => {
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
    tx.hostedMember.findUnique
      .mockResolvedValueOnce({ suspendedAt: null })
      .mockResolvedValueOnce({
        billingStatus: HostedBillingStatus.not_started,
        suspendedAt: null,
      })
      .mockResolvedValue({
        suspendedAt: new Date("2026-07-25T12:00:00.000Z"),
      });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn().mockImplementation(
      async (params: Stripe.Checkout.SessionCreateParams) =>
        makeFamilyStripeCheckoutSessionFromCreate(params, {
          sessionId: "cs_test_familyOwnerRace123",
          status: "open",
          subscriptionId: null,
        }),
    );
    const checkoutExpire = vi.fn().mockResolvedValue({
      id: "cs_test_familyOwnerRace123",
      status: "expired",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          expire: checkoutExpire,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_OWNER_CHANGED",
      httpStatus: 409,
      retryable: true,
    });

    expect(checkoutExpire).toHaveBeenCalledWith(
      "cs_test_familyOwnerRace123",
    );
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkoutAttemptId: null,
          stripeCheckoutSessionIdEncrypted: null,
        }),
      }),
    );
  });

  it("does not overwrite a different Family Checkout Session that won the bind race", async () => {
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
    tx.hostedAccountGroupBillingRef.updateMany.mockResolvedValue({ count: 0 });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn().mockImplementation(
      async (params: Stripe.Checkout.SessionCreateParams) =>
        makeFamilyStripeCheckoutSessionFromCreate(params, {
          sessionId: "cs_test_familyLoser123",
          status: "open",
          subscriptionId: null,
        }),
    );
    const checkoutExpire = vi.fn().mockResolvedValue({
      id: "cs_test_familyLoser123",
      status: "expired",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          expire: checkoutExpire,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_OWNER_CHANGED",
      httpStatus: 409,
    });

    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          stripeCheckoutSessionIdEncrypted:
            "encrypted:cs_test_familyLoser123",
        }),
        where: expect.objectContaining({
          OR: [
            { stripeCheckoutSessionLookupKey: null },
            {
              stripeCheckoutSessionLookupKey:
                expect.stringMatching(
                  /^hbidx:stripe-checkout-session:v1:/u,
                ),
            },
          ],
        }),
      }),
    );
    expect(checkoutExpire).toHaveBeenCalledWith("cs_test_familyLoser123");
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(createMemberBillingRefMock());

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
    directSubscription.automatic_tax = {
      disabled_reason: null,
      enabled: true,
      liability: null,
    };
    directSubscription.default_payment_method = "pm_direct";
    directSubscription.default_source = "card_direct";
    directSubscription.description = "Existing invoice description";
    directSubscription.payment_settings = {
      payment_method_options: null,
      payment_method_types: ["card"],
      save_default_payment_method: "on_subscription",
    };
    const paidFamilySubscription = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 2,
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_owner",
        murphFamilyTransition: "direct-paid-to-family-v1",
        murphFamilyTransitionGroupId: "hbag_family",
        murphFamilyTransitionOwnerMemberId: "member_owner",
        murphFamilyTransitionSeatCount: "2",
      },
      periodLocation: "subscription_item",
      priceId: "price_family",
      subscriptionId: "sub_direct",
    });
    paidFamilySubscription.latest_invoice = makeFamilyStripeInvoice({
      status: "paid",
    });
    const normalizedSubscription = {
      ...paidFamilySubscription,
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
        ownerMemberId: "member_owner",
      },
    } as Stripe.Subscription;
    let providerSubscription = directSubscription;
    const subscriptionRetrieve = vi.fn().mockImplementation(async () =>
      providerSubscription
    );
    const subscriptionUpdate = vi.fn().mockImplementation(
      async (_subscriptionId, params: Stripe.SubscriptionUpdateParams) => {
        if (hasStripeMetadataValue(params, "murphFamilyTransition")) {
          providerSubscription = {
            ...providerSubscription,
            metadata: {
              ...providerSubscription.metadata,
              murphFamilyTransition: "direct-paid-to-family-v1",
              murphFamilyTransitionGroupId: "hbag_family",
              murphFamilyTransitionOwnerMemberId: "member_owner",
              murphFamilyTransitionSeatCount: "2",
            },
          } as Stripe.Subscription;
          return providerSubscription;
        }
        if (params.items?.some((item) => item.price === "price_family")) {
          providerSubscription = paidFamilySubscription;
          return providerSubscription;
        }
        if (hasStripeMetadataValue(params, "kind", "hosted_family_plan")) {
          providerSubscription = normalizedSubscription;
          const activeGroup = {
            ...group,
            billingStatus: HostedBillingStatus.active,
          };
          tx.hostedAccountGroup.findUnique.mockResolvedValue(activeGroup);
          tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
            createBillingRefMock({
              group: activeGroup,
              stripeCustomerIdEncrypted: "encrypted:cus_direct",
              stripeSubscriptionIdEncrypted: "encrypted:sub_direct",
            }),
          );
          return providerSubscription;
        }
        throw new Error("Unexpected Stripe subscription update");
      },
    );
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
    expect(result).toEqual({ alreadyActive: false, url: null });

    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(subscriptionRetrieve).toHaveBeenCalledWith("sub_direct", {
      expand: [
        "customer",
        "items.data.price",
        "latest_invoice",
      ],
    });
    expect(subscriptionUpdate).toHaveBeenCalledTimes(3);
    expect(subscriptionUpdate.mock.calls[0]?.[1]).toMatchObject({
      metadata: {
        murphFamilyTransition: "direct-paid-to-family-v1",
        murphFamilyTransitionGroupId: "hbag_family",
        murphFamilyTransitionOwnerMemberId: "member_owner",
        murphFamilyTransitionSeatCount: "2",
      },
    });
    expect(subscriptionUpdate.mock.calls[0]?.[1]).not.toHaveProperty("items");
    expect(subscriptionUpdate.mock.calls[1]?.[1]).toMatchObject({
      items: [{
        id: "si_family",
        price: "price_family",
        quantity: 2,
      }],
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
    });
    expect(subscriptionUpdate.mock.calls[1]?.[1]).not.toHaveProperty("metadata");
    expect(subscriptionUpdate.mock.calls[2]?.[1]).toMatchObject({
      metadata: expect.objectContaining({
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        checkoutOffer: "",
        kind: "hosted_family_plan",
        memberId: "",
        ownerMemberId: "member_owner",
      }),
    });
    expect(subscriptionUpdate.mock.calls[2]?.[1]).not.toHaveProperty("items");
    for (const call of subscriptionUpdate.mock.calls) {
      expect(call[1]).not.toHaveProperty("automatic_tax");
      expect(call[1]).not.toHaveProperty("default_payment_method");
      expect(call[1]).not.toHaveProperty("default_source");
      expect(call[1]).not.toHaveProperty("default_tax_rates");
      expect(call[1]).not.toHaveProperty("description");
      expect(call[1]).not.toHaveProperty("invoice_settings");
      expect(call[1]).not.toHaveProperty("payment_settings");
    }
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedMember.update).not.toHaveBeenCalled();
    expect(tx.hostedMemberBillingRef.updateMany).not.toHaveBeenCalled();

    const webhookTx = createTxMock({ billedSeatCount: null, group });
    webhookTx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
      createBillingRefMock({
        billedSeatCount: null,
        group,
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
    );
    webhookTx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([
      createBillingRefMock({
        billedSeatCount: null,
        group,
        stripeCustomerIdEncrypted: "encrypted:cus_direct",
        stripeSubscriptionIdEncrypted: "encrypted:sub_direct",
      }),
    ]);
    webhookTx.hostedMemberBillingRef.findUnique.mockResolvedValue(
      createMemberBillingRefMock({ stripeSubscriptionIdEncrypted: "encrypted:sub_direct" }),
    );
    const eventCreatedAt = new Date("2026-07-14T12:00:00.000Z");

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: { eventCreatedAt },
      subscription: normalizedSubscription,
      tx: webhookTx,
    })).resolves.toMatchObject({ groupId: "hbag_family" });

    expect(webhookTx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: 2,
        currentBillingPhase: "paid",
        currentPeriodEnd: FAMILY_STRIPE_PERIOD_END,
        currentPeriodStart: FAMILY_STRIPE_PERIOD_START,
        lastStripeEventCreatedAt: eventCreatedAt,
        stripeSubscriptionLookupKey: expect.stringMatching(/^hbidx:stripe-subscription:v1:/u),
      }),
    }));
    expect(webhookTx.hostedMember.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.not_started,
      },
      where: {
        id: "member_owner",
      },
    });
    expect(webhookTx.hostedMemberBillingRef.updateMany).toHaveBeenCalledWith(expect.objectContaining({
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

  it("redirects direct-to-Family conversion to the exact current invoice before any Stripe mutation", async () => {
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(createMemberBillingRefMock());
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
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
    const paymentRequired = {
      advancingEvent: "invoice.paid" as const,
      deadlineUnixSeconds: 1_777_000_000,
      invoiceId: "in_direct_current",
      invoicePaymentId: "ip_direct_current",
      kind: "payment_required" as const,
      paymentIntentId: "pi_direct_current",
      paymentUrl: "https://invoice.stripe.com/i/in_direct_current",
    };
    recurringFinancialMocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce({
      collectionState: paymentRequired,
      fullyRefunded: false,
      invoiceId: paymentRequired.invoiceId,
      outstandingDispute: false,
    });
    recurringFinancialMocks.classifyHostedStripeRecurringFinancialHealth
      .mockReturnValueOnce({
        collectionState: paymentRequired,
        kind: "blocked",
        reason: "collection_unsettled",
      });
    const subscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(directSubscription),
        update: subscriptionUpdate,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_PAYMENT_REQUIRED",
      details: {
        paymentUrl: "https://invoice.stripe.com/i/in_direct_current",
      },
      httpStatus: 409,
      retryable: false,
    });

    expect(
      recurringFinancialMocks.readHostedStripeRecurringFinancialState,
    ).toHaveBeenCalledWith(directSubscription);
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("reports a deterministic Stripe direct-to-Family rejection as non-retryable", async () => {
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(createMemberBillingRefMock());
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const subscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockRejectedValue({
          code: "parameter_unknown",
          param: "default_payment_method",
          requestId: "req_family_invalid",
          statusCode: 400,
          type: "StripeInvalidRequestError",
        }),
        update: subscriptionUpdate,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_PROVIDER_REJECTED",
      httpStatus: 500,
      retryable: false,
    });

    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(
      recurringFinancialMocks.readHostedStripeRecurringFinancialState,
    ).not.toHaveBeenCalled();
  });

  it("keeps direct ownership while a Family conversion waits for payment authentication", async () => {
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(createMemberBillingRefMock());
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

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
    const preparedSubscription = {
      ...directSubscription,
      metadata: {
        ...directSubscription.metadata,
        murphFamilyTransition: "direct-paid-to-family-v1",
        murphFamilyTransitionGroupId: "hbag_family",
        murphFamilyTransitionOwnerMemberId: "member_owner",
        murphFamilyTransitionSeatCount: "2",
      },
    } as Stripe.Subscription;
    const actionInvoice = makeFamilyStripeInvoice({
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_test/in_family",
      status: "open",
    });
    const pendingSubscription: Stripe.Subscription = {
      ...preparedSubscription,
      latest_invoice: actionInvoice,
      pending_update: makeFamilyStripePendingUpdate({
        quantity: 2,
        subscriptionItem: makeFamilyStripeSubscription({
          itemQuantity: 2,
          priceId: "price_family",
        }).items.data[0]!,
      }),
    };
    const subscriptionRetrieve = vi.fn()
      .mockResolvedValueOnce(directSubscription)
      .mockResolvedValueOnce(preparedSubscription);
    const subscriptionUpdate = vi.fn()
      .mockResolvedValueOnce(preparedSubscription)
      .mockResolvedValueOnce(pendingSubscription);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn().mockResolvedValue(makeFamilyStripeInvoicePaymentList([
          makeFamilyStripeInvoicePayment({
            invoiceId: actionInvoice.id,
            paymentIntentStatus: "requires_action",
          }),
        ])),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(actionInvoice),
      },
      subscriptions: {
        retrieve: subscriptionRetrieve,
        update: subscriptionUpdate,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://invoice.stripe.com/i/acct_test/in_family",
    });

    expect(subscriptionUpdate).toHaveBeenCalledTimes(2);
    expect(subscriptionUpdate.mock.calls[0]?.[1]).toHaveProperty("metadata");
    expect(subscriptionUpdate.mock.calls[0]?.[1]).not.toHaveProperty("items");
    expect(subscriptionUpdate.mock.calls[1]?.[1]).toMatchObject({
      items: [{
        id: "si_family",
        price: "price_family",
        quantity: 2,
      }],
      payment_behavior: "pending_if_incomplete",
    });
    expect(subscriptionUpdate.mock.calls[1]?.[1]).not.toHaveProperty("metadata");
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedMember.update).not.toHaveBeenCalled();
    expect(tx.hostedMemberBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("deletes legacy metered items only after the Family conversion invoice is paid", async () => {
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(createMemberBillingRefMock());
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

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
    directSubscription.items.data.push(makeLegacyHostedUsageSubscriptionItem());
    const transitionMetadata = {
      ...directSubscription.metadata,
      murphFamilyTransition: "direct-paid-to-family-v1",
      murphFamilyTransitionGroupId: "hbag_family",
      murphFamilyTransitionOwnerMemberId: "member_owner",
      murphFamilyTransitionSeatCount: "2",
    };
    const preparedSubscription = {
      ...directSubscription,
      metadata: transitionMetadata,
    } as Stripe.Subscription;
    const paidFamilySubscription = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 2,
      metadata: transitionMetadata,
      priceId: "price_family",
      subscriptionId: "sub_direct",
    });
    paidFamilySubscription.items.data.push(makeLegacyHostedUsageSubscriptionItem());
    paidFamilySubscription.latest_invoice = makeFamilyStripeInvoice({ status: "paid" });
    const cleanedSubscription = {
      ...paidFamilySubscription,
      items: {
        ...paidFamilySubscription.items,
        data: paidFamilySubscription.items.data.filter(
          (item) => item.id !== "si_legacy_usage",
        ),
      },
    } as Stripe.Subscription;
    const normalizedSubscription = {
      ...cleanedSubscription,
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
        ownerMemberId: "member_owner",
      },
    } as Stripe.Subscription;
    let providerSubscription = directSubscription;
    const subscriptionRetrieve = vi.fn().mockImplementation(async () =>
      providerSubscription
    );
    const subscriptionUpdate = vi.fn().mockImplementation(
      async (_subscriptionId, params: Stripe.SubscriptionUpdateParams) => {
        if (hasStripeMetadataValue(params, "murphFamilyTransition")) {
          providerSubscription = preparedSubscription;
          return providerSubscription;
        }
        if (params.items?.some((item) => item.price === "price_family")) {
          providerSubscription = paidFamilySubscription;
          return providerSubscription;
        }
        if (params.items?.some((item) => item.deleted === true)) {
          providerSubscription = cleanedSubscription;
          return providerSubscription;
        }
        if (hasStripeMetadataValue(params, "kind", "hosted_family_plan")) {
          providerSubscription = normalizedSubscription;
          return providerSubscription;
        }
        throw new Error("Unexpected Stripe subscription update");
      },
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: subscriptionRetrieve,
        update: subscriptionUpdate,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: null,
    });

    expect(subscriptionUpdate).toHaveBeenCalledTimes(4);
    expect(subscriptionUpdate.mock.calls[1]?.[1]).toMatchObject({
      items: [{
        id: "si_family",
        price: "price_family",
        quantity: 2,
      }],
      payment_behavior: "pending_if_incomplete",
    });
    expect(subscriptionUpdate.mock.calls[1]?.[1].items).not.toContainEqual(
      expect.objectContaining({ deleted: true }),
    );
    expect(subscriptionUpdate.mock.calls[2]?.[1]).toMatchObject({
      items: [{
        deleted: true,
        id: "si_legacy_usage",
      }],
      proration_behavior: "none",
    });
    expect(subscriptionUpdate.mock.calls[3]?.[1]).not.toHaveProperty("items");
  });

  it("leaves a valid Edge-only Family subscription with a pending update out of legacy recovery", async () => {
    const subscription = makeFamilyStripeSubscription({
      customerId: "cus_family",
      itemQuantity: 2,
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
        ownerMemberId: "member_owner",
      },
      priceId: "price_family_edge",
      subscriptionId: "sub_family",
    });
    subscription.pending_update = makeFamilyStripePendingUpdate({
      quantity: 3,
      subscriptionItem: subscription.items.data[0]!,
    });
    const subscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        update: subscriptionUpdate,
      },
    });

    await expect(reconcileHostedFamilyDirectPaidTransitionSubscription({
      prisma: createTxMock(),
      stripe: runtimeMocks.requireHostedStripeApi(),
      subscription,
      verifiedOwnerMemberId: "member_owner",
    })).resolves.toBe(subscription);
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  it("clears an unapplied direct-paid transition only after explicit expiry proof", async () => {
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
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(createMemberBillingRefMock());
    const subscription = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 1,
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_owner",
        murphFamilyTransition: "direct-paid-to-family-v1",
        murphFamilyTransitionGroupId: "hbag_family",
        murphFamilyTransitionOwnerMemberId: "member_owner",
        murphFamilyTransitionSeatCount: "2",
      },
      priceId: "price_pulse",
      subscriptionId: "sub_direct",
    });
    const clearedSubscription = {
      ...subscription,
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_owner",
      },
    } as Stripe.Subscription;
    const subscriptionUpdate = vi.fn().mockResolvedValue(clearedSubscription);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        update: subscriptionUpdate,
      },
    });
    const stripe = runtimeMocks.requireHostedStripeApi();

    await expect(reconcileHostedFamilyDirectPaidTransitionSubscription({
      prisma: tx,
      stripe,
      subscription,
      verifiedOwnerMemberId: "member_owner",
    })).resolves.toBe(subscription);
    expect(subscriptionUpdate).not.toHaveBeenCalled();

    await expect(reconcileHostedFamilyDirectPaidTransitionSubscription({
      prisma: tx,
      stripe,
      subscription,
      terminalProviderProof: "pending_update_expired",
      verifiedOwnerMemberId: "member_owner",
    })).resolves.toBe(clearedSubscription);
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      "sub_direct",
      expect.objectContaining({
        metadata: {
          murphFamilyTransition: "",
          murphFamilyTransitionGroupId: "",
          murphFamilyTransitionOwnerMemberId: "",
          murphFamilyTransitionSeatCount: "",
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-family-direct-paid-expired:sub_direct:/u,
        ),
      }),
    );
  });

  it.each([
    {
      firstProof: "pending_update_expired" as const,
      secondProof: "invoice_voided" as const,
    },
    {
      firstProof: "invoice_voided" as const,
      secondProof: "pending_update_expired" as const,
    },
  ])(
    "clears direct-paid transition metadata after $firstProof then $secondProof provider order",
    async ({ firstProof, secondProof }) => {
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
      tx.hostedMember.findUnique.mockResolvedValue({
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      });
      tx.hostedMemberBillingRef.findUnique.mockResolvedValue(
        createMemberBillingRefMock(),
      );
      const pendingSubscription = makeFamilyStripeSubscription({
        customerId: "cus_direct",
        itemQuantity: 1,
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_owner",
          murphFamilyTransition: "direct-paid-to-family-v1",
          murphFamilyTransitionGroupId: "hbag_family",
          murphFamilyTransitionOwnerMemberId: "member_owner",
          murphFamilyTransitionSeatCount: "2",
        },
        priceId: "price_pulse",
        subscriptionId: "sub_direct",
      });
      pendingSubscription.pending_update = makeFamilyStripePendingUpdate({
        quantity: 2,
        subscriptionItem: pendingSubscription.items.data[0]!,
      });
      const terminalSubscription = {
        ...pendingSubscription,
        pending_update: null,
      } as Stripe.Subscription;
      const clearedSubscription = {
        ...terminalSubscription,
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_owner",
        },
      } as Stripe.Subscription;
      const subscriptionUpdate = vi.fn().mockResolvedValue(clearedSubscription);
      runtimeMocks.requireHostedStripeApi.mockReturnValue({
        subscriptions: {
          update: subscriptionUpdate,
        },
      });
      const stripe = runtimeMocks.requireHostedStripeApi();

      await expect(reconcileHostedFamilyDirectPaidTransitionSubscription({
        prisma: tx,
        stripe,
        subscription: pendingSubscription,
        terminalProviderProof: firstProof,
        verifiedOwnerMemberId: "member_owner",
      })).resolves.toBe(pendingSubscription);
      expect(subscriptionUpdate).not.toHaveBeenCalled();

      await expect(reconcileHostedFamilyDirectPaidTransitionSubscription({
        prisma: tx,
        stripe,
        subscription: terminalSubscription,
        terminalProviderProof: secondProof,
        verifiedOwnerMemberId: "member_owner",
      })).resolves.toBe(clearedSubscription);
      expect(subscriptionUpdate).toHaveBeenCalledOnce();
    },
  );

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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(createMemberBillingRefMock());

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

  it.each([
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.status = "past_due";
      },
      name: "a non-active subscription",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.pending_update = makeFamilyStripePendingUpdate({
          quantity: 2,
          subscriptionItem: subscription.items.data[0]!,
        });
      },
      name: "an existing pending update",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.schedule = "sub_sched_direct";
      },
      name: "a subscription schedule",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.cancel_at = 1_772_035_200;
      },
      name: "a scheduled cancellation timestamp",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.cancel_at_period_end = true;
      },
      name: "a period-end cancellation",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.pause_collection = {
          behavior: "keep_as_draft",
          resumes_at: null,
        };
      },
      name: "paused invoice collection",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.collection_method = "send_invoice";
      },
      name: "manual invoice collection",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.discounts = ["di_subscription"];
      },
      name: "a subscription discount",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.items.data[0]!.discounts = ["di_item"];
      },
      name: "a subscription-item discount",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.items.has_more = true;
      },
      name: "unretrieved subscription items",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.transfer_data = {
          amount_percent: null,
          destination: "acct_destination",
        };
      },
      name: "Connect transfer data",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.on_behalf_of = "acct_merchant";
      },
      name: "Connect on-behalf-of billing",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.application_fee_percent = 10;
      },
      name: "an application fee",
    },
    {
      mutate(subscription: Stripe.Subscription) {
        subscription.billing_mode = {
          flexible: {},
          type: "flexible",
        };
      },
      name: "flexible billing mode",
    },
  ])("rejects direct-paid Family conversion before mutation for $name", async ({
    mutate,
  }) => {
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(
      createMemberBillingRefMock(),
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const subscription = makeFamilyStripeSubscription({
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
    mutate(subscription);
    const subscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(subscription),
        update: subscriptionUpdate,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_SUBSCRIPTION_CONFIGURATION_UNSUPPORTED",
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
        checkoutCreatedAt: new Date("2026-07-25T11:00:00.000Z"),
        checkoutSeatCount: 2,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn().mockImplementation(
      async (params: Stripe.Checkout.SessionCreateParams) =>
        makeFamilyStripeCheckoutSessionFromCreate(params, {
          sessionId: "cs_test_familyRetry123",
          status: "open",
          subscriptionId: null,
        }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      now: new Date("2026-07-25T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toMatchObject({
      alreadyActive: false,
    });

    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: "hosted-family-checkout:hbag_family:hbfca_existing",
    });
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("retrieves an exact bound open Family Checkout Session without creating another", async () => {
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
    const sessionId = "cs_test_familyBoundOpen123";
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
      createBillingRefMock({
        checkoutAttemptId: "hbfca_existing",
        checkoutCreatedAt: new Date("2026-07-25T11:00:00.000Z"),
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: `encrypted:${sessionId}`,
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const retrieve = vi.fn().mockResolvedValue(makeFamilyStripeCheckoutSession({
      checkoutAttemptId: "hbfca_existing",
      sessionId,
      status: "open",
      subscriptionId: null,
    }));
    const create = vi.fn();
    const expire = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create,
          expire,
          retrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-25T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://local.withmurph.ai:3443/checkout/family/cs_test_familyBoundOpen123",
    });

    expect(retrieve).toHaveBeenCalledWith(sessionId, {
      expand: ["line_items.data.price"],
    });
    expect(create).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          checkoutAttemptId: "hbfca_existing",
          groupId: group.id,
          stripeSubscriptionLookupKey: null,
        }),
      }),
    );
  });

  it.each([
    {
      expectedActive: true,
      financiallyHealthy: true,
      name: "activates from healthy current-period funding",
    },
    {
      expectedActive: false,
      financiallyHealthy: false,
      name: "stays inactive when current-period funding is blocked",
    },
  ])("reconciles an exact bound completed Family Checkout and $name", async ({
    expectedActive,
    financiallyHealthy,
  }) => {
    let group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    const sessionId = "cs_test_familyBoundComplete123";
    let billingRef = createBillingRefMock({
      checkoutAttemptId: "hbfca_existing",
      checkoutCreatedAt: new Date("2026-07-25T11:00:00.000Z"),
      checkoutSeatCount: 2,
      group,
      stripeCheckoutSessionIdEncrypted: `encrypted:${sessionId}`,
      stripeCustomerIdEncrypted: null,
      stripeSubscriptionIdEncrypted: null,
    });
    tx.hostedAccountGroup.findUnique.mockImplementation(async () => group);
    tx.hostedAccountGroup.update.mockImplementation(async ({ data }) => {
      group = {
        ...group,
        billingStatus: data.billingStatus ?? group.billingStatus,
      };
      return group;
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(async () =>
      billingRef
    );
    tx.hostedAccountGroupBillingRef.findMany.mockImplementation(async ({ where }) => {
      const lookupFields = [
        "stripeCustomerLookupKey",
        "stripeSubscriptionItemLookupKey",
        "stripeSubscriptionLookupKey",
      ] as const;
      return lookupFields.some((field) => {
        const lookupKey = billingRef[field];
        const candidates = where?.[field]?.in;
        return lookupKey !== null &&
          Array.isArray(candidates) &&
          candidates.includes(lookupKey);
      })
        ? [billingRef]
        : [];
    });
    tx.hostedAccountGroupBillingRef.upsert.mockImplementation(async ({ update }) => {
      billingRef = {
        ...billingRef,
        ...update,
        group,
      };
      return billingRef;
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const session = makeFamilyStripeCheckoutSession({
      checkoutAttemptId: "hbfca_existing",
      sessionId,
      status: "complete",
      subscriptionId: "sub_family_completed",
    });
    const subscription = makeFamilyStripeSubscription({
      customerId: "cus_family",
      itemQuantity: 2,
      subscriptionId: "sub_family_completed",
    });
    const checkoutRetrieve = vi.fn().mockResolvedValue(session);
    const checkoutCreate = vi.fn();
    const subscriptionRetrieve = vi.fn().mockResolvedValue(subscription);
    if (!financiallyHealthy) {
      recurringFinancialMocks.classifyHostedStripeRecurringFinancialHealth
        .mockReturnValueOnce({
          collectionState: {
            invoiceId: "in_family_current",
            invoicePaymentId: "ip_family_current",
            kind: "paid",
            paymentIntentId: "pi_family_current",
          },
          kind: "blocked",
          reason: "outstanding_dispute",
        });
    }
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          retrieve: checkoutRetrieve,
        },
      },
      subscriptions: {
        retrieve: subscriptionRetrieve,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-25T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: expectedActive,
      url: null,
    });

    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(subscriptionRetrieve).toHaveBeenCalledWith(
      "sub_family_completed",
      {
        expand: [
          "customer",
          "items.data.price",
          "latest_invoice",
        ],
      },
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        timeout: 780_000,
      }),
    );
    expect(
      recurringFinancialMocks.readHostedStripeRecurringFinancialState,
    ).toHaveBeenCalledWith(subscription);
    if (expectedActive) {
      expect(tx.hostedAccountGroup.update).toHaveBeenLastCalledWith({
        data: {
          billingStatus: HostedBillingStatus.active,
        },
        where: {
          id: group.id,
        },
      });
    } else {
      expect(tx.hostedAccountGroup.update).not.toHaveBeenCalledWith({
        data: {
          billingStatus: HostedBillingStatus.active,
        },
        where: {
          id: group.id,
        },
      });
      expect(
        activationMocks.activateHostedMemberForFamilySponsorshipTx,
      ).not.toHaveBeenCalled();
    }
  });

  it("fails closed when an unbound Family Checkout attempt reaches the safe replay boundary", async () => {
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
      createBillingRefMock({
        checkoutAttemptId: "hbfca_existing",
        checkoutCreatedAt: new Date("2026-07-25T11:00:00.000Z"),
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-26T10:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_RECOVERY_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("replaces an unbound attempt when its created Family Session is already expired", async () => {
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
    let billingRef: ReturnType<typeof createBillingRefMock> | null = null;
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(async () =>
      billingRef
    );
    tx.hostedAccountGroupBillingRef.upsert.mockImplementation(async ({ create }) => {
      billingRef = createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: create.checkoutAttemptId,
        checkoutCreatedAt: create.checkoutCreatedAt,
        checkoutSeatCount: create.checkoutSeatCount,
        group,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionItemIdEncrypted: null,
      });
      return billingRef;
    });
    tx.hostedAccountGroupBillingRef.updateMany.mockImplementation(
      async ({ data, where }) => {
        const currentBillingRef = billingRef;
        if (
          currentBillingRef !== null &&
          data.checkoutAttemptId === null &&
          currentBillingRef.checkoutAttemptId === where.checkoutAttemptId &&
          currentBillingRef.stripeCheckoutSessionIdEncrypted === null
        ) {
          billingRef = null;
          return { count: 1 };
        }
        if (
          currentBillingRef !== null &&
          typeof data.stripeCheckoutSessionIdEncrypted === "string" &&
          currentBillingRef.checkoutAttemptId === where.checkoutAttemptId
        ) {
          billingRef = {
            ...currentBillingRef,
            stripeCheckoutSessionIdEncrypted:
              data.stripeCheckoutSessionIdEncrypted,
          };
          return { count: 1 };
        }
        return { count: 0 };
      },
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    let createCount = 0;
    const create = vi.fn().mockImplementation(
      async (params: Stripe.Checkout.SessionCreateParams) => {
        createCount += 1;
        return makeFamilyStripeCheckoutSessionFromCreate(params, {
          sessionId: createCount === 1
            ? "cs_test_familyExpiredReplay123"
            : "cs_test_familyFreshReplay123",
          status: createCount === 1 ? "expired" : "open",
          subscriptionId: null,
        });
      },
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-25T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url:
        "https://local.withmurph.ai:3443/checkout/family/cs_test_familyFreshReplay123",
    });

    expect(create).toHaveBeenCalledTimes(2);
    const firstKey = create.mock.calls[0]?.[1]?.idempotencyKey;
    const secondKey = create.mock.calls[1]?.[1]?.idempotencyKey;
    expect(firstKey).toMatch(
      /^hosted-family-checkout:hbag_family:hbfca_/u,
    );
    expect(secondKey).toMatch(
      /^hosted-family-checkout:hbag_family:hbfca_/u,
    );
    expect(secondKey).not.toBe(firstKey);
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutSeatCount: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: {
        checkoutAttemptId: expect.stringMatching(/^hbfca_/u),
        groupId: group.id,
        stripeCheckoutSessionLookupKey: null,
        stripeSubscriptionLookupKey: null,
      },
    });
  });

  it("clears an exact expired Family Checkout Session before reserving a new attempt", async () => {
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
    const expiredSessionId = "cs_test_familyExpired123";
    let billingRef = createBillingRefMock({
      checkoutAttemptId: "hbfca_expired",
      checkoutCreatedAt: new Date("2026-07-25T11:00:00.000Z"),
      checkoutSeatCount: 2,
      group,
      stripeCheckoutSessionIdEncrypted: `encrypted:${expiredSessionId}`,
      stripeCustomerIdEncrypted: null,
      stripeSubscriptionIdEncrypted: null,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(async () =>
      billingRef
    );
    tx.hostedAccountGroupBillingRef.updateMany.mockImplementation(async ({ data }) => {
      if (data.checkoutAttemptId === null) {
        billingRef = createBillingRefMock({
          billedSeatCount: null,
          group,
          stripeCheckoutSessionIdEncrypted: null,
          stripeCustomerIdEncrypted: null,
          stripeSubscriptionIdEncrypted: null,
        });
      } else if (typeof data.stripeCheckoutSessionIdEncrypted === "string") {
        billingRef = {
          ...billingRef,
          stripeCheckoutSessionIdEncrypted: data.stripeCheckoutSessionIdEncrypted,
        };
      }
      return { count: 1 };
    });
    tx.hostedAccountGroupBillingRef.upsert.mockImplementation(async ({ create }) => {
      billingRef = createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: create.checkoutAttemptId,
        checkoutCreatedAt: create.checkoutCreatedAt,
        checkoutSeatCount: create.checkoutSeatCount,
        group,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      });
      return billingRef;
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const retrieve = vi.fn().mockResolvedValue(
      makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_expired",
        sessionId: expiredSessionId,
        status: "expired",
        subscriptionId: null,
      }),
    );
    const create = vi.fn().mockImplementation(
      async (params: Stripe.Checkout.SessionCreateParams) =>
        makeFamilyStripeCheckoutSessionFromCreate(params, {
          sessionId: "cs_test_familyReplacement123",
          status: "open",
          subscriptionId: null,
        }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create,
          retrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-25T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url:
        "https://local.withmurph.ai:3443/checkout/family/cs_test_familyReplacement123",
    });

    expect(retrieve).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: expect.stringMatching(
        /^hosted-family-checkout:hbag_family:hbfca_/u,
      ),
    });
    expect(create.mock.calls[0]?.[1]?.idempotencyKey).not.toContain(
      "hbfca_expired",
    );
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkoutAttemptId: null,
          stripeCheckoutSessionLookupKey: null,
        }),
        where: expect.objectContaining({
          checkoutAttemptId: "hbfca_expired",
          groupId: group.id,
        }),
      }),
    );
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

  it("writes reversal state only through the exact locked Family binding", async () => {
    const tx = createTxMock();
    const subscription = makeFamilyStripeSubscription({
      metadata: {
        murphFamilyTransition: "direct-paid-to-family-v1",
        murphFamilyTransitionGroupId: "hbag_untrusted",
        murphFamilyTransitionOwnerMemberId: "member_untrusted",
        murphFamilyTransitionSeatCount: "6",
      },
    });

    await expect(setHostedFamilyStripeBillingReversalStateTx({
      billingStatus: HostedBillingStatus.unpaid,
      groupId: "hbag_family",
      subscription,
      tx,
      verifiedOwnerMemberId: "member_owner",
    })).resolves.toBe(true);

    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.unpaid,
      },
      where: {
        id: "hbag_family",
      },
    });
  });

  it("rejects reversal state when the locked Family owner no longer matches", async () => {
    const tx = createTxMock();

    await expect(setHostedFamilyStripeBillingReversalStateTx({
      billingStatus: HostedBillingStatus.active,
      groupId: "hbag_family",
      subscription: makeFamilyStripeSubscription(),
      tx,
      verifiedOwnerMemberId: "member_stale",
    })).resolves.toBe(false);

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
  });

  it("keeps Family billing unpaid when reversal recovery has fewer seats than active members", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
      { memberId: "member_mom", planCode: "pulse" },
      { memberId: "member_dad", planCode: "pulse" },
    ]);

    await expect(setHostedFamilyStripeBillingReversalStateTx({
      billingStatus: HostedBillingStatus.active,
      groupId: "hbag_family",
      subscription: makeFamilyStripeSubscription({
        itemQuantity: 2,
      }),
      tx,
      verifiedOwnerMemberId: "member_owner",
    })).resolves.toBe(true);

    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: {
        billingStatus: HostedBillingStatus.unpaid,
      },
      where: {
        id: "hbag_family",
      },
    });
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

  it("does not let Family metadata claim a subscription bound to another direct member", async () => {
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
    tx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([]);
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
      createBillingRefMock({
        checkoutAttemptId: "hbfca_current",
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_crossowner123",
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
    );
    tx.hostedMemberBillingRef.findMany.mockResolvedValue([{
      ...createMemberBillingRefMock({
        stripeCustomerIdEncrypted: "encrypted:cus_family",
        stripeSubscriptionIdEncrypted: "encrypted:sub_cross_owner",
      }),
      member: {
        id: "member_other",
      },
      memberId: "member_other",
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_cross_owner"),
    }]);

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        subscriptionId: "sub_cross_owner",
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

  it("does not first-bind a copied Family subscription claim without its completed Session", async () => {
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
    tx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([]);
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
      createBillingRefMock({
        checkoutAttemptId: "hbfca_current",
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_canonical123",
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
    );

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        metadata: {
          accountGroupId: group.id,
          billingPlanCode: "launch_family_monthly",
          checkoutAttemptId: "hbfca_current",
          kind: "hosted_family_plan",
          ownerMemberId: group.ownerMemberId,
        },
        subscriptionId: "sub_copied_metadata",
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: null,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
  });

  it("lets the exact completed Family Checkout Session establish the first subscription binding", async () => {
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
    tx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([]);
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
      createBillingRefMock({
        checkoutAttemptId: "hbfca_current",
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_canonical123",
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
    );

    await expect(applyHostedFamilyStripeCheckoutCompletedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      session: makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_current",
        sessionId: "cs_test_canonical123",
        subscriptionId: "sub_canonical",
      }),
      tx,
    })).resolves.toEqual({
      groupId: group.id,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          groupId: group.id,
          stripeSubscriptionLookupKey:
            createHostedStripeSubscriptionLookupKey("sub_canonical"),
        }),
      }),
    );
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

  it("does not accept a Family checkout subscription already owned by another direct member", async () => {
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
      createBillingRefMock({
        checkoutAttemptId: "hbfca_current",
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
    );
    tx.hostedMemberBillingRef.findMany.mockResolvedValue([{
      ...createMemberBillingRefMock({
        stripeCustomerIdEncrypted: "encrypted:cus_other",
        stripeSubscriptionIdEncrypted: "encrypted:sub_cross_owner",
      }),
      member: {
        id: "member_other",
      },
      memberId: "member_other",
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_cross_owner"),
    }]);

    await expect(applyHostedFamilyStripeCheckoutCompletedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      session: makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_current",
        sessionId: "cs_test_crossowner123",
        subscriptionId: "sub_cross_owner",
      }),
      tx,
    })).resolves.toEqual({
      groupId: null,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
  });

  it("rejects a legacy checkout completion for a synthetic Family owner before billing writes", async () => {
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
    tx.hostedThreadContainer.findUnique.mockResolvedValueOnce({
      memberId: "member_owner",
    });

    await expect(applyHostedFamilyStripeCheckoutCompletedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      session: makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_current",
        sessionId: "cs_test_current123",
      }),
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_PERSONAL_OWNER_REQUIRED",
      httpStatus: 403,
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
        stripeCheckoutSessionLookupKey: {
          in: [
            expect.stringMatching(/^hbidx:stripe-checkout-session:v1:/u),
          ],
        },
      },
    });
  });

  it("rejects a checkout redirect for a synthetic Family owner", async () => {
    const sessionId = "cs_test_syntheticowner123";
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
    tx.hostedThreadContainer.findUnique.mockResolvedValueOnce({
      memberId: "member_owner",
    });
    const retrieve = vi.fn().mockResolvedValue(makeFamilyStripeCheckoutSession({
      checkoutAttemptId: "hbfca_current",
      sessionId,
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
      code: "HOSTED_FAMILY_PERSONAL_OWNER_REQUIRED",
      httpStatus: 403,
    });

    expect(retrieve).toHaveBeenCalledWith(sessionId);
    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("updates exact mixed-tier capacity through one Stripe subscription", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
    ]);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const stripeSubscriptionRetrieve = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ itemQuantity: 2 }),
    );
    const stripeSubscriptionUpdate = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ edgeItemQuantity: 2, itemQuantity: 1 }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: stripeSubscriptionRetrieve,
        update: stripeSubscriptionUpdate,
      },
    });

    await expect(updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      now: new Date("2026-06-18T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 2, pulse: 1 },
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(stripeSubscriptionRetrieve).toHaveBeenCalledWith("sub_family", {
      expand: [
        "customer",
        "items.data.price",
        "latest_invoice",
      ],
    });
    expect(stripeSubscriptionUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        expand: [
          "customer",
          "items.data.price",
          "latest_invoice",
        ],
        items: [
          { id: "si_family", quantity: 1 },
          { price: "price_family_edge", quantity: 2 },
        ],
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "always_invoice",
      }),
      {
        idempotencyKey: expect.stringMatching(
          /^family-capacity:hbag_family:[a-f0-9]{32}:1:2$/u,
        ),
      },
    );
    expect(tx.hostedAccountGroupPlanCapacity.createMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupPlanCapacity.deleteMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.update).not.toHaveBeenCalled();
  });

  it("blocks even an already-applied Family capacity when current-period funding was fully refunded", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
    ]);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const current = makeFamilyStripeSubscription({ itemQuantity: 2 });
    const paidCollection = {
      invoiceId: "in_family_later_paid",
      invoicePaymentId: "ip_family_later_paid",
      kind: "paid" as const,
      paymentIntentId: "pi_family_later_paid",
    };
    recurringFinancialMocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce({
      collectionState: paidCollection,
      fullyRefunded: true,
      invoiceId: paidCollection.invoiceId,
      outstandingDispute: false,
    });
    recurringFinancialMocks.classifyHostedStripeRecurringFinancialHealth
      .mockReturnValueOnce({
        collectionState: paidCollection,
        kind: "blocked",
        reason: "fully_refunded",
      });
    const stripeSubscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(current),
        update: stripeSubscriptionUpdate,
      },
    });

    await expect(updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 0, pulse: 2 },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CAPACITY_SUBSCRIPTION_UNAVAILABLE",
      details: {
        collectionState: "paid",
        reason: "fully_refunded",
      },
      httpStatus: 409,
      retryable: false,
    });

    expect(
      recurringFinancialMocks.readHostedStripeRecurringFinancialState,
    ).toHaveBeenCalledWith(current);
    expect(stripeSubscriptionUpdate).not.toHaveBeenCalled();
  });

  it("returns an exact non-retryable Stripe action URL for a pending seat charge", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
    ]);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const current = makeFamilyStripeSubscription({ itemQuantity: 2 });
    const actionInvoice = makeFamilyStripeInvoice({
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_test/in_capacity",
      status: "open",
    });
    const pending: Stripe.Subscription = {
      ...current,
      latest_invoice: actionInvoice,
      pending_update: makeFamilyStripePendingUpdate({
        quantity: 3,
        subscriptionItem: current.items.data[0]!,
      }),
    };
    const portalCreate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      billingPortal: {
        sessions: {
          create: portalCreate,
        },
      },
      invoicePayments: {
        list: vi.fn().mockResolvedValue(makeFamilyStripeInvoicePaymentList([
          makeFamilyStripeInvoicePayment({
            invoiceId: actionInvoice.id,
            paymentIntentStatus: "requires_action",
          }),
        ])),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(actionInvoice),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue(pending),
      },
    });

    await expect(updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 0, pulse: 3 },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CAPACITY_PAYMENT_REQUIRED",
      details: {
        paymentUrl: "https://invoice.stripe.com/i/acct_test/in_capacity",
      },
      httpStatus: 409,
      retryable: false,
    });
    expect(portalCreate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupPlanCapacity.createMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupPlanCapacity.deleteMany).not.toHaveBeenCalled();
  });

  it("reports a processing seat charge as syncing without creating a Portal redirect", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
    ]);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const current = makeFamilyStripeSubscription({ itemQuantity: 2 });
    const processingInvoice = makeFamilyStripeInvoice({
      status: "open",
    });
    const pending: Stripe.Subscription = {
      ...current,
      latest_invoice: processingInvoice,
      pending_update: makeFamilyStripePendingUpdate({
        quantity: 3,
        subscriptionItem: current.items.data[0]!,
      }),
    };
    const portalCreate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      billingPortal: {
        sessions: {
          create: portalCreate,
        },
      },
      invoicePayments: {
        list: vi.fn().mockResolvedValue(makeFamilyStripeInvoicePaymentList([
          makeFamilyStripeInvoicePayment({
            invoiceId: processingInvoice.id,
            paymentIntentStatus: "processing",
          }),
        ])),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(processingInvoice),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue(pending),
      },
    });

    await expect(updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 0, pulse: 3 },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_BILLING_SYNCING",
      httpStatus: 409,
      retryable: true,
    });
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it("fails explicitly when Stripe omits the invoice for a pending seat charge", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
    ]);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const current = makeFamilyStripeSubscription({ itemQuantity: 2 });
    const pending: Stripe.Subscription = {
      ...current,
      latest_invoice: null,
      pending_update: makeFamilyStripePendingUpdate({
        quantity: 3,
        subscriptionItem: current.items.data[0]!,
      }),
    };
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue(pending),
      },
    });

    await expect(updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 0, pulse: 3 },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_BILLING_PAYMENT_STATE_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });
    expect(tx.hostedAccountGroupPlanCapacity.createMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupPlanCapacity.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    "past_due",
    "unpaid",
  ] as const)(
    "recovers the exact latest invoice instead of creating a new proration for a %s subscription",
    async (status) => {
      const tx = createTxMock({
        activeMembershipCount: 1,
        billedSeatCount: 2,
        pendingInviteCount: 0,
      });
      tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
      ]);
      const prisma = tx as FamilyPlanTxMock & {
        $transaction: ReturnType<typeof vi.fn>;
      };
      prisma.$transaction = vi.fn((callback) => callback(tx));
      const subscription = makeFamilyStripeSubscription({ itemQuantity: 2 });
      subscription.status = status;
      const invoice = makeFamilyStripeInvoice({
        hostedInvoiceUrl: "https://invoice.stripe.test/in_family_recovery",
        status: "open",
      });
      subscription.latest_invoice = invoice.id;
      const subscriptionUpdate = vi.fn();
      const invoiceRetrieve = vi.fn().mockResolvedValue(invoice);
      runtimeMocks.requireHostedStripeApi.mockReturnValue({
        invoicePayments: {
          list: vi.fn().mockResolvedValue(makeFamilyStripeInvoicePaymentList([
            makeFamilyStripeInvoicePayment({
              invoiceId: invoice.id,
              paymentIntentStatus: "requires_payment_method",
            }),
          ])),
        },
        invoices: {
          retrieve: invoiceRetrieve,
        },
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue(subscription),
          update: subscriptionUpdate,
        },
      });

      await expect(updateHostedFamilyPlanCapacities({
        groupId: "hbag_family",
        ownerMemberId: "member_owner",
        prisma: prisma as never,
        targetCapacities: { edge: 0, pulse: 2 },
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_CAPACITY_PAYMENT_REQUIRED",
        details: {
          paymentUrl: "https://invoice.stripe.test/in_family_recovery",
        },
      });

      expect(invoiceRetrieve).toHaveBeenCalledWith(invoice.id);
      expect(subscriptionUpdate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["canceled", (subscription: Stripe.Subscription) => {
      subscription.status = "canceled";
    }],
    ["paused", (subscription: Stripe.Subscription) => {
      subscription.status = "paused";
    }],
    ["incomplete", (subscription: Stripe.Subscription) => {
      subscription.status = "incomplete";
    }],
    ["trialing", (subscription: Stripe.Subscription) => {
      subscription.status = "trialing";
    }],
    ["send_invoice", (subscription: Stripe.Subscription) => {
      subscription.collection_method = "send_invoice";
    }],
    ["scheduled", (subscription: Stripe.Subscription) => {
      subscription.schedule = "sub_sched_family";
    }],
    ["cancel_at", (subscription: Stripe.Subscription) => {
      subscription.cancel_at = FAMILY_STRIPE_PERIOD_END_SECONDS;
    }],
    ["cancel_at_period_end", (subscription: Stripe.Subscription) => {
      subscription.cancel_at_period_end = true;
    }],
    ["pause_collection", (subscription: Stripe.Subscription) => {
      subscription.pause_collection = {
        behavior: "void",
        resumes_at: null,
      };
    }],
  ] as const)(
    "rejects a %s Family lifecycle before treating equal capacity as a no-op",
    async (_label, mutateSubscription) => {
      const tx = createTxMock({
        activeMembershipCount: 1,
        billedSeatCount: 2,
        pendingInviteCount: 0,
      });
      tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
      ]);
      const prisma = tx as FamilyPlanTxMock & {
        $transaction: ReturnType<typeof vi.fn>;
      };
      prisma.$transaction = vi.fn((callback) => callback(tx));
      const subscription = makeFamilyStripeSubscription({ itemQuantity: 2 });
      mutateSubscription(subscription);
      const subscriptionUpdate = vi.fn();
      runtimeMocks.requireHostedStripeApi.mockReturnValue({
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue(subscription),
          update: subscriptionUpdate,
        },
      });

      await expect(updateHostedFamilyPlanCapacities({
        groupId: "hbag_family",
        ownerMemberId: "member_owner",
        prisma: prisma as never,
        targetCapacities: { edge: 0, pulse: 2 },
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_CAPACITY_SUBSCRIPTION_UNAVAILABLE",
        retryable: false,
      });

      expect(subscriptionUpdate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a different price", (pending: Stripe.Subscription.PendingUpdate) => {
      const firstItem = pending.subscription_items?.[0];
      if (firstItem) {
        firstItem.price = makeFamilyStripePrice({ id: "price_unrelated" });
      }
    }],
    ["a different item id", (pending: Stripe.Subscription.PendingUpdate) => {
      const firstItem = pending.subscription_items?.[0];
      if (firstItem) {
        firstItem.id = "si_unrelated";
      }
    }],
    ["a billing anchor", (pending: Stripe.Subscription.PendingUpdate) => {
      pending.billing_cycle_anchor = FAMILY_STRIPE_PERIOD_END_SECONDS;
    }],
    ["a trial end", (pending: Stripe.Subscription.PendingUpdate) => {
      pending.trial_end = FAMILY_STRIPE_PERIOD_END_SECONDS;
    }],
  ] as const)(
    "rejects a pending capacity update with %s before reading its invoice",
    async (_label, mutatePendingUpdate) => {
      const tx = createTxMock({
        activeMembershipCount: 1,
        billedSeatCount: 2,
        pendingInviteCount: 0,
      });
      tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
      ]);
      const prisma = tx as FamilyPlanTxMock & {
        $transaction: ReturnType<typeof vi.fn>;
      };
      prisma.$transaction = vi.fn((callback) => callback(tx));
      const subscription = makeFamilyStripeSubscription({ itemQuantity: 2 });
      const pendingUpdate = makeFamilyStripePendingUpdate({
        quantity: 3,
        subscriptionItem: subscription.items.data[0]!,
      });
      mutatePendingUpdate(pendingUpdate);
      subscription.pending_update = pendingUpdate;
      const subscriptionUpdate = vi.fn();
      const invoiceRetrieve = vi.fn();
      runtimeMocks.requireHostedStripeApi.mockReturnValue({
        invoices: {
          retrieve: invoiceRetrieve,
        },
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue(subscription),
          update: subscriptionUpdate,
        },
      });

      await expect(updateHostedFamilyPlanCapacities({
        groupId: "hbag_family",
        ownerMemberId: "member_owner",
        prisma: prisma as never,
        targetCapacities: { edge: 0, pulse: 3 },
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_BILLING_SYNCING",
        retryable: true,
      });

      expect(invoiceRetrieve).not.toHaveBeenCalled();
      expect(subscriptionUpdate).not.toHaveBeenCalled();
    },
  );

  it.each([
    "revoked",
    "expired",
  ] as const)(
    "returns not_needed without Stripe when a pending invite was %s before the owner lock",
    async () => {
      const tx = createTxMock({
        activeMembershipCount: 1,
        billedSeatCount: 2,
        pendingInviteCount: 0,
      });
      tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
      ]);
      tx.hostedAccountGroupInvite.findMany.mockResolvedValue([]);
      const prisma = tx as FamilyPlanTxMock & {
        $transaction: ReturnType<typeof vi.fn>;
      };
      prisma.$transaction = vi.fn((callback) => callback(tx));

      await expect(updateHostedFamilyPlanCapacities({
        groupId: "hbag_family",
        now: new Date("2026-07-15T12:00:00.000Z"),
        ownerMemberId: "member_owner",
        prisma: prisma as never,
        requiredPlanCode: "pulse",
      })).resolves.toEqual({
        kind: "not_needed",
      });

      expect(tx.hostedAccountGroupInvite.findMany).toHaveBeenCalledWith({
        select: { planCode: true },
        where: {
          expiresAt: { gt: new Date("2026-07-15T12:00:00.000Z") },
          groupId: "hbag_family",
          status: "pending",
        },
      });
      expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    },
  );

  it("derives one invite seat from fresh capacity and usage under the owner lock", async () => {
    const tx = createTxMock({
      activeMembershipCount: 2,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
      { memberId: "member_mom", planCode: "pulse" },
    ]);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const subscriptionUpdate = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ itemQuantity: 3 }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(
          makeFamilyStripeSubscription({ itemQuantity: 2 }),
        ),
        update: subscriptionUpdate,
      },
    });

    await expect(updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      requiredPlanCode: "pulse",
    })).resolves.toMatchObject({
      kind: "updated",
      targetCapacities: { edge: 0, pulse: 3 },
    });

    expect(subscriptionUpdate).toHaveBeenCalledTimes(1);
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        items: [{ id: "si_family", quantity: 3 }],
      }),
      expect.any(Object),
    );
  });

  it("serializes concurrent tier-capacity changes through the owner Stripe lock", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 5,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
    ]);
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 3, planCode: "pulse" },
      { billedQuantity: 2, planCode: "edge" },
    ]);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    let transactionTail = Promise.resolve();
    prisma.$transaction = vi.fn(async (callback) => {
      const previous = transactionTail;
      let release = () => {};
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(tx);
      } finally {
        release();
      }
    });

    let stripeSubscription = makeFamilyStripeSubscription({
      edgeItemQuantity: 2,
      itemQuantity: 3,
    });
    const stripeSubscriptionRetrieve = vi.fn(async () => stripeSubscription);
    const stripeSubscriptionUpdate = vi.fn(async () => {
      stripeSubscription = makeFamilyStripeSubscription({
        edgeItemQuantity: 2,
        itemQuantity: 4,
      });
      return stripeSubscription;
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: stripeSubscriptionRetrieve,
        update: stripeSubscriptionUpdate,
      },
    });

    const [first, second] = await Promise.allSettled([
      updateHostedFamilyPlanCapacities({
        groupId: "hbag_family",
        now: new Date("2026-06-18T12:00:00.000Z"),
        ownerMemberId: "member_owner",
        prisma: prisma as never,
        targetCapacities: { edge: 2, pulse: 4 },
      }),
      updateHostedFamilyPlanCapacities({
        groupId: "hbag_family",
        now: new Date("2026-06-18T12:00:00.000Z"),
        ownerMemberId: "member_owner",
        prisma: prisma as never,
        targetCapacities: { edge: 3, pulse: 3 },
      }),
    ]);

    expect(first).toMatchObject({ status: "fulfilled" });
    expect(second).toMatchObject({
      reason: { code: "HOSTED_FAMILY_BILLING_SYNCING" },
      status: "rejected",
    });
    expect(stripeSubscriptionRetrieve).toHaveBeenCalledTimes(2);
    expect(stripeSubscriptionUpdate).toHaveBeenCalledTimes(1);
    expect(stripeSubscriptionUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        items: [{ id: "si_family", quantity: 4 }],
      }),
      expect.any(Object),
    );
  });

  it("does not allow manual capacity mutation while a member tier is pending", async () => {
    const tx = createTxMock({
      activeMembershipCount: 2,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "hbagm_mom" });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      now: new Date("2026-07-15T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 1, pulse: 2 },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_PLAN_SYNCING",
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.update).not.toHaveBeenCalled();
  });

  it("fails an exact-bound Family subscription closed when its metadata and items drift to direct billing", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([
      createBillingRefMock(),
    ]);

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-07-15T12:30:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription({
        itemQuantity: 1,
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          kind: "hosted_member_plan",
          memberId: "member_owner",
        },
        priceId: "price_pulse",
        subscriptionId: "sub_family",
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: { billingStatus: HostedBillingStatus.unpaid },
      where: { id: "hbag_family" },
    });
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          billedSeatCount: null,
          currentBillingPhase: null,
          currentBillingPlanCode: "launch_family_monthly",
          groupId: "hbag_family",
          stripeSubscriptionItemIdEncrypted: null,
        }),
        update: expect.objectContaining({
          billedSeatCount: null,
          currentBillingPhase: null,
          currentBillingPlanCode: "launch_family_monthly",
          stripeSubscriptionItemIdEncrypted: null,
        }),
      }),
    );
    expect(tx.hostedAccountGroupPlanCapacity.deleteMany).toHaveBeenCalledWith({
      where: { groupId: "hbag_family" },
    });
    expect(tx.hostedAccountGroupPlanCapacity.createMany).not.toHaveBeenCalled();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).not.toHaveBeenCalled();
  });

  it("does not activate a group from non-family subscription metadata", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([]);
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
  updatedAt: Date;
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
  const stripeCustomerIdEncrypted = resolveNullableOverride(
    "stripeCustomerIdEncrypted",
    "encrypted:cus_family",
  );
  const stripeSubscriptionIdEncrypted = resolveNullableOverride(
    "stripeSubscriptionIdEncrypted",
    "encrypted:sub_family",
  );
  const stripeSubscriptionItemIdEncrypted = resolveNullableOverride(
    "stripeSubscriptionItemIdEncrypted",
    "encrypted:si_family",
  );
  const readFixtureId = (value: string | null | undefined): string | null =>
    typeof value === "string" && value.startsWith("encrypted:")
      ? value.slice("encrypted:".length)
      : null;

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
    stripeCustomerIdEncrypted,
    stripeCustomerLookupKey: createHostedStripeCustomerLookupKey(
      readFixtureId(stripeCustomerIdEncrypted),
    ),
    stripeSubscriptionIdEncrypted,
    stripeSubscriptionItemIdEncrypted,
    stripeSubscriptionItemLookupKey: createHostedStripeSubscriptionItemLookupKey(
      readFixtureId(stripeSubscriptionItemIdEncrypted),
    ),
    stripeSubscriptionLookupKey: createHostedStripeSubscriptionLookupKey(
      readFixtureId(stripeSubscriptionIdEncrypted),
    ),
    updatedAt: overrides.updatedAt ?? new Date("2026-06-18T12:00:00.000Z"),
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
    planCode: "pulse",
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
      findMany: vi.fn().mockImplementation(async ({ where }) => {
        const lookupFields = [
          "stripeCustomerLookupKey",
          "stripeSubscriptionItemLookupKey",
          "stripeSubscriptionLookupKey",
        ] as const;
        return lookupFields.some((field) => {
          const lookupKey = billingRef[field];
          const candidates = where?.[field]?.in;
          return lookupKey !== null &&
            Array.isArray(candidates) &&
            candidates.includes(lookupKey);
        })
          ? [billingRef]
          : [];
      }),
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
        planCode: data.planCode,
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
    hostedMemberIdentity: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    hostedMemberBillingRef: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedMemberRouting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    hostedThreadContainer: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    hostedAccountGroupMembership: {
      count: vi.fn().mockResolvedValue(input.activeMembershipCount ?? 1),
      findMany: vi.fn().mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "pulse" },
      ]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(membership),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue(membership),
    },
    hostedAccountGroupPlanCapacity: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  });

  return tx;
}

type FamilyStripeCheckoutSessionInput = {
  checkoutAttemptId?: string | null;
  clientReferenceId?: string | null;
  customerId?: string | null;
  ownerMemberId?: string;
  priceId?: string;
  seatCount?: number;
  sessionId?: string;
  status?: Stripe.Checkout.Session["status"];
  subscriptionId?: string | null;
  url?: string | null;
};

function makeFamilyStripeCheckoutSession(
  input: FamilyStripeCheckoutSessionInput = {},
): Stripe.Checkout.Session {
  const sessionId = input.sessionId ?? "cs_test_family123";

  const session: Partial<Stripe.Checkout.Session> = {
    client_reference_id: input.clientReferenceId === undefined
      ? "hbag_family"
      : input.clientReferenceId,
    customer: input.customerId === undefined ? "cus_family" : input.customerId,
    id: sessionId,
    line_items: {
      data: [{
        id: "li_family",
        object: "item",
        price: makeFamilyStripePrice({
          id: input.priceId ?? "price_family",
        }),
        quantity: input.seatCount ?? 2,
      } as Stripe.LineItem],
      has_more: false,
      object: "list",
      url: `/v1/checkout/sessions/${sessionId}/line_items`,
    },
    metadata: {
      accountGroupId: "hbag_family",
      billingPlanCode: "launch_family_monthly",
      ...(input.checkoutAttemptId ? { checkoutAttemptId: input.checkoutAttemptId } : {}),
      kind: "hosted_family_plan",
      ownerMemberId: input.ownerMemberId ?? "member_owner",
    },
    mode: "subscription",
    object: "checkout.session",
    status: input.status === undefined ? "complete" : input.status,
    subscription: input.subscriptionId === undefined ? "sub_family" : input.subscriptionId,
    url: input.url === undefined
      ? `https://checkout.stripe.com/c/pay/${sessionId}`
      : input.url,
  };

  return session as Stripe.Checkout.Session;
}

function makeFamilyStripeCheckoutSessionFromCreate(
  params: Stripe.Checkout.SessionCreateParams,
  overrides: FamilyStripeCheckoutSessionInput = {},
): Stripe.Checkout.Session {
  const lineItem = params.line_items?.[0];
  return makeFamilyStripeCheckoutSession({
    checkoutAttemptId: typeof params.metadata?.checkoutAttemptId === "string"
      ? params.metadata.checkoutAttemptId
      : null,
    clientReferenceId: params.client_reference_id,
    customerId: typeof params.customer === "string" ? params.customer : undefined,
    ownerMemberId: typeof params.metadata?.ownerMemberId === "string"
      ? params.metadata.ownerMemberId
      : undefined,
    priceId: typeof lineItem?.price === "string" ? lineItem.price : undefined,
    seatCount: lineItem?.quantity,
    ...overrides,
  });
}

function makeFamilyStripeSubscriptionEvent(): Stripe.Event {
  return {
    created: 1_771_948_800,
    data: { object: makeFamilyStripeSubscription() },
    id: "evt_family_subscription",
    object: "event",
    type: "customer.subscription.updated",
  } as Stripe.Event;
}

function makeFamilyStripeInvoice(input: {
  amountPaid?: number;
  amountRemaining?: number;
  attempted?: boolean;
  billingReason?: Stripe.Invoice.BillingReason;
  created?: number;
  customerId?: string;
  hostedInvoiceUrl?: string | null;
  id?: string;
  lines?: Stripe.InvoiceLineItem[];
  status: Stripe.Invoice.Status;
  subscriptionId?: string;
}): Stripe.Invoice {
  const invoice: Partial<Stripe.Invoice> = {
    amount_paid: input.amountPaid ?? (input.status === "paid" ? 700 : 0),
    amount_remaining:
      input.amountRemaining ?? (input.status === "paid" ? 0 : 700),
    attempted: input.attempted ?? true,
    billing_reason: input.billingReason ?? "subscription_update",
    created: input.created ?? FAMILY_STRIPE_PERIOD_START_SECONDS,
    customer: input.customerId ?? "cus_family",
    hosted_invoice_url: input.hostedInvoiceUrl ?? null,
    id: input.id ?? "in_family_transition",
    lines: {
      data: input.lines ?? [],
      has_more: false,
      object: "list",
      url: `/v1/invoices/${input.id ?? "in_family_transition"}/lines`,
    },
    object: "invoice",
    parent: {
      quote_details: null,
      subscription_details: {
        metadata: {},
        subscription: input.subscriptionId ?? "sub_family",
      },
      type: "subscription_details",
    },
    status: input.status,
  };
  return invoice as Stripe.Invoice;
}

function makeFamilyStripeInvoiceLine(input: {
  amount?: number;
  invoiceId: string;
  periodEnd?: number;
  periodStart?: number;
  priceId: string;
  proration?: boolean;
  quantity: number;
  subscriptionItemId: string;
}): Stripe.InvoiceLineItem {
  const line: Partial<Stripe.InvoiceLineItem> = {
    amount: input.amount ?? 700,
    id: `il_${input.invoiceId}_${input.subscriptionItemId}`,
    invoice: input.invoiceId,
    object: "line_item",
    parent: {
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        proration: input.proration ?? false,
        proration_details: null,
        subscription: "sub_family",
        subscription_item: input.subscriptionItemId,
      },
      type: "subscription_item_details",
    },
    period: {
      end: input.periodEnd ?? FAMILY_STRIPE_PERIOD_END_SECONDS,
      start: input.periodStart ?? FAMILY_STRIPE_PERIOD_START_SECONDS,
    },
    pricing: {
      price_details: {
        price: input.priceId,
        product: "prod_family",
      },
      type: "price_details",
      unit_amount_decimal: null,
    },
    quantity: input.quantity,
    subscription: "sub_family",
  };
  return line as Stripe.InvoiceLineItem;
}

function makeFamilyStripeInvoicePayment(input: {
  amountPaid?: number;
  invoiceId: string;
  paymentIntentId?: string;
  paymentIntentStatus: Stripe.PaymentIntent.Status;
}): Stripe.InvoicePayment {
  const paymentIntent: Partial<Stripe.PaymentIntent> = {
    id: input.paymentIntentId ?? "pi_family_transition",
    object: "payment_intent",
    status: input.paymentIntentStatus,
  };
  const invoicePayment: Partial<Stripe.InvoicePayment> = {
    amount_paid: input.amountPaid ?? 700,
    id: "inpay_family_transition",
    invoice: input.invoiceId,
    is_default: true,
    object: "invoice_payment",
    payment: {
      payment_intent: paymentIntent as Stripe.PaymentIntent,
      type: "payment_intent",
    },
    status: input.paymentIntentStatus === "succeeded" ? "paid" : "open",
  };
  return invoicePayment as Stripe.InvoicePayment;
}

function makeFamilyStripeInvoicePaymentList(
  data: Stripe.InvoicePayment[],
): Stripe.ApiList<Stripe.InvoicePayment> {
  return {
    data,
    has_more: false,
    object: "list",
    url: "/v1/invoice_payments",
  };
}

function makeFamilyStripePendingUpdate(input: {
  quantity: number;
  subscriptionItem: Stripe.SubscriptionItem;
}): Stripe.Subscription.PendingUpdate {
  return {
    billing_cycle_anchor: null,
    expires_at: 1_772_035_200,
    subscription_items: [{
      ...input.subscriptionItem,
      quantity: input.quantity,
    }],
    trial_end: null,
    trial_from_plan: false,
  };
}

function hasStripeMetadataValue(
  params: Stripe.SubscriptionUpdateParams,
  key: string,
  expectedValue?: string,
): boolean {
  const metadata = params.metadata;
  if (!metadata || typeof metadata !== "object") {
    return false;
  }
  const value = metadata[key];
  return expectedValue === undefined
    ? typeof value === "string" && value.length > 0
    : value === expectedValue;
}

function makeFamilyStripePrice(input: {
  id: string;
  metadata?: Stripe.Metadata;
  meter?: string | null;
  usageType?: Stripe.Price.Recurring.UsageType;
}): Stripe.Price {
  return {
    active: true,
    billing_scheme: "per_unit",
    created: FAMILY_STRIPE_PERIOD_START_SECONDS,
    currency: "usd",
    custom_unit_amount: null,
    id: input.id,
    livemode: false,
    lookup_key: null,
    metadata: input.metadata ?? {},
    nickname: null,
    object: "price",
    product: "prod_family",
    recurring: {
      interval: "month",
      interval_count: 1,
      meter: input.meter ?? null,
      trial_period_days: null,
      usage_type: input.usageType ?? "licensed",
    },
    tax_behavior: "unspecified",
    tiers_mode: null,
    transform_quantity: null,
    type: "recurring",
    unit_amount: 2_500,
    unit_amount_decimal: null,
  };
}

function makeFamilyStripePlan(input: {
  price: Stripe.Price;
}): Stripe.Plan {
  const recurring = input.price.recurring;
  if (!recurring) {
    throw new Error("Expected recurring Stripe price fixture");
  }
  return {
    active: input.price.active,
    amount: input.price.unit_amount,
    amount_decimal: input.price.unit_amount_decimal,
    billing_scheme: input.price.billing_scheme,
    created: input.price.created,
    currency: input.price.currency,
    id: input.price.id,
    interval: recurring.interval,
    interval_count: recurring.interval_count,
    livemode: input.price.livemode,
    metadata: input.price.metadata,
    meter: recurring.meter,
    nickname: input.price.nickname,
    object: "plan",
    product: input.price.product,
    tiers_mode: input.price.tiers_mode,
    transform_usage: null,
    trial_period_days: recurring.trial_period_days,
    usage_type: recurring.usage_type,
  };
}

function makeFamilyStripeSubscriptionItem(input: {
  id: string;
  priceId: string;
  quantity?: number;
  subscriptionId: string;
  priceMetadata?: Stripe.Metadata;
  meter?: string | null;
  usageType?: Stripe.Price.Recurring.UsageType;
}): Stripe.SubscriptionItem {
  const price = makeFamilyStripePrice({
    id: input.priceId,
    metadata: input.priceMetadata,
    meter: input.meter,
    usageType: input.usageType,
  });
  return {
    billing_thresholds: null,
    created: FAMILY_STRIPE_PERIOD_START_SECONDS,
    current_period_end: FAMILY_STRIPE_PERIOD_END_SECONDS,
    current_period_start: FAMILY_STRIPE_PERIOD_START_SECONDS,
    discounts: [],
    id: input.id,
    metadata: {},
    object: "subscription_item",
    plan: makeFamilyStripePlan({ price }),
    price,
    ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
    subscription: input.subscriptionId,
    tax_rates: null,
  };
}

function makeLegacyHostedUsageSubscriptionItem(): Stripe.SubscriptionItem {
  return makeFamilyStripeSubscriptionItem({
    id: "si_legacy_usage",
    meter: "mtr_legacy",
    priceId: "price_legacy_usage",
    priceMetadata: {
      murphHostedAiUsagePrice: "legacy_hosted_ai_usage",
    },
    subscriptionId: "sub_family",
    usageType: "metered",
  });
}

function makeFamilyStripeSubscription(input: {
  customerId?: string;
  duplicateFamilyItems?: boolean;
  edgeItemQuantity?: number;
  itemQuantity?: number;
  metadata?: Stripe.Metadata;
  periodLocation?: "subscription" | "subscription_item";
  priceId?: string;
  subscriptionId?: string;
} = {}): Stripe.Subscription {
  const subscriptionId = input.subscriptionId ?? "sub_family";
  const priceId = input.priceId ?? "price_family";
  const periodOnSubscriptionItem = input.periodLocation === "subscription_item";
  const familyItem = makeFamilyStripeSubscriptionItem({
    id: "si_family",
    quantity: input.itemQuantity ?? 4,
    priceId,
    subscriptionId,
  });
  const edgeItem = makeFamilyStripeSubscriptionItem({
    id: "si_family_edge",
    quantity: input.edgeItemQuantity ?? 0,
    priceId: "price_family_edge",
    subscriptionId,
  });
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
            },
          ]
        : [
            familyItem,
            ...(input.edgeItemQuantity === undefined ? [] : [edgeItem]),
          ],
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
  planCode: "edge" | "pulse";
  status: string;
  targetLabel: string | null;
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
    planCode: "pulse",
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
