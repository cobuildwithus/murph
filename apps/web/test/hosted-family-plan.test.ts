import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";

const encryptionMocks = vi.hoisted(() => ({
  decryptHostedWebNullableFields: vi.fn(),
  decryptHostedWebNullableString: vi.fn(),
  encryptHostedWebNullableString: vi.fn(),
}));
const activationMocks = vi.hoisted(() => ({
  activateHostedMemberForFamilySponsorshipTx: vi.fn(),
  buildHostedMemberActivationEventId: vi.fn(),
}));
const cryptoRootMocks = vi.hoisted(() => ({
  prepareHostedCryptoDomainRootCandidates: vi.fn(),
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
  requireHostedStripeApiMode: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  requireHostedStripeFamilyPlanConfig: vi.fn(),
}));
const nextServerMocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
}));
const activationWakeMocks = vi.hoisted(() => ({
  signalHostedMemberActivationRuntimeWakeBestEffortResult: vi.fn(),
}));
const groupJoinConfirmationMocks = vi.hoisted(() => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableFields: encryptionMocks.decryptHostedWebNullableFields,
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
  prepareHostedCryptoDomainRootCandidates:
    cryptoRootMocks.prepareHostedCryptoDomainRootCandidates,
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
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: runtimeMocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApi: runtimeMocks.requireHostedStripeApi,
  requireHostedStripeApiMode: runtimeMocks.requireHostedStripeApiMode,
  requireHostedStripeBillingPlanConfig: runtimeMocks.requireHostedStripeBillingPlanConfig,
  requireHostedStripeFamilyPlanConfig: runtimeMocks.requireHostedStripeFamilyPlanConfig,
}));
vi.mock("next/server", () => ({
  after: nextServerMocks.after,
}));

import {
  createHostedEmailLookupKey,
  createHostedPhoneLookupKey,
  createHostedStripeCheckoutSessionLookupKey,
  createHostedTelegramUserLookupKey,
  createHostedTelegramUsernameLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  parseHostedFamilyInviteCode,
  parseHostedFamilyInviteReturnPath,
} from "@/src/lib/hosted-onboarding/app-routes";
import {
  applyStripeCheckoutCompleted,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";
import {
  abandonHostedFamilyDraftForOwner,
  acceptHostedFamilyInvite,
  acceptHostedFamilyInviteFromTelegramTx,
  acceptHostedFamilyInviteFromPhoneTx,
  acceptHostedFamilyInviteTx,
  applyHostedFamilyStripeCheckoutExpiredTx,
  applyHostedFamilyStripeCheckoutCompletedTx,
  applyHostedFamilyStripeSubscriptionUpdatedTx,
  buildHostedFamilyCheckoutRedirectUrl,
  buildHostedFamilyInviteReplyText,
  buildHostedFamilyTelegramInviteUrl,
  createHostedAccountGroupForOwnerTx,
  createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx,
  hasHostedAccountGroupMembershipAccess,
  HOSTED_FAMILY_MAX_SEATS,
  hostedFamilyInviteHasReusableTarget,
  issueHostedFamilyInviteFromOwnerTx,
  issueHostedFamilyInviteTx,
  prepareHostedFamilyStripeActivationCryptoDomainRoots,
  prepareHostedLegacySyntheticFamilyCleanupTx,
  readHostedFamilyBillingRecoveryForOwner,
  readHostedFamilyDraftRecoveryStateForOwner,
  readHostedFamilyCheckoutSessionIdFromUrl,
  resolveHostedFamilyChatNotificationRouteTx,
  resolveHostedFamilyCheckoutRedirectUrl,
  writeHostedAccountGroupStripeBillingTx,
  parseHostedFamilyInviteStartToken,
  readHostedFamilyAccessForMember,
  readHostedMemberFamilyBillingClaim,
  resolveHostedFamilyUsageCreditCheckoutTargetTx,
  resolveHostedFamilyInviteTokenForInbound,
  removeHostedFamilyMemberTx,
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
    deleteMany: MockFn;
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
  it("accepts only a canonical Family invite code", () => {
    expect(parseHostedFamilyInviteCode("invite_return-target_123")).toBe(
      "invite_return-target_123",
    );
    expect(parseHostedFamilyInviteCode("/family/accept/invite_123")).toBeNull();
    expect(parseHostedFamilyInviteCode("invite 123")).toBeNull();
    expect(parseHostedFamilyInviteCode(123)).toBeNull();
  });

  it("accepts only an exact local Family invite as a recovery return path", () => {
    expect(parseHostedFamilyInviteReturnPath(
      "/family/accept/invite_return_target",
    )).toBe("/family/accept/invite_return_target");
    expect(parseHostedFamilyInviteReturnPath(
      "https://example.test/family/accept/invite_return_target",
    )).toBeNull();
    expect(parseHostedFamilyInviteReturnPath(
      "//example.test/family/accept/invite_return_target",
    )).toBeNull();
    expect(parseHostedFamilyInviteReturnPath("/settings")).toBeNull();
  });

  const previousHostedContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousHostedContactPrivacyCurrentKeyVersion =
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  const previousHostedFamilyStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY;
  const previousHostedFamilyEdgeStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY;
  const previousHostedFamilyMaxStripePriceId =
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY;
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
    process.env.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY =
      "price_family_max";
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
    encryptionMocks.decryptHostedWebNullableFields.mockImplementation(async ({ entries }) =>
      entries.map(({ value }: { value: string | null | undefined }) =>
        typeof value === "string" && value.startsWith("encrypted:")
          ? value.slice("encrypted:".length)
          : null
      )
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
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptionItems: {
        update: vi.fn().mockResolvedValue({
          id: "si_family",
          quantity: 3,
        }),
      },
    });
    runtimeMocks.requireHostedStripeApiMode.mockImplementation(() => ({
      stripe: runtimeMocks.requireHostedStripeApi(),
      stripeLiveMode: false,
    }));
    runtimeMocks.requireHostedStripeBillingPlanConfig.mockImplementation(({ billingPlanCode }) => ({
      billingPlanCode,
      priceId: billingPlanCode === "launch_edge_monthly"
        ? "price_edge"
        : billingPlanCode === "launch_max_monthly"
          ? "price_max"
          : "price_pulse",
      stripe: runtimeMocks.requireHostedStripeApi(),
    }));
    runtimeMocks.requireHostedStripeFamilyPlanConfig.mockImplementation(({ planCode }) => ({
      planCode,
      priceId: planCode === "edge"
        ? "price_family_edge"
        : planCode === "max"
          ? "price_family_max"
          : "price_family",
      stripe: runtimeMocks.requireHostedStripeApi(),
    }));
    runtimeMocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue(
      "https://local.withmurph.ai:3443",
    );
    cryptoRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly.mockResolvedValue(undefined);
    cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mockResolvedValue(new Map());
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
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY",
      previousHostedFamilyMaxStripePriceId,
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearHostedOnboardingEnvCache();
  });

  it.each([
    {
      expected: {
        groupId: "hbag_active",
        kind: "active_sponsorship",
        ownerMemberId: "member_owner",
      },
      group: {
        billingRef: null,
        billingStatus: HostedBillingStatus.active,
        id: "hbag_active",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      label: "an active sponsorship",
    },
    {
      expected: {
        groupId: "hbag_subscription",
        kind: "bound_subscription",
        ownerMemberId: "member_owner",
      },
      group: {
        billingRef: {
          checkoutAttemptId: null,
          checkoutCreatedAt: null,
          stripeSubscriptionIdEncrypted: "encrypted:sub_family",
        },
        billingStatus: HostedBillingStatus.not_started,
        id: "hbag_subscription",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      label: "a bound Family subscription",
    },
    {
      expected: {
        groupId: "hbag_canceled_retry",
        kind: "bound_subscription",
        ownerMemberId: "member_owner",
      },
      group: {
        billingRef: {
          checkoutAttemptId: null,
          checkoutCreatedAt: null,
          stripeSubscriptionIdEncrypted: "encrypted:sub_family_retry",
        },
        billingStatus: HostedBillingStatus.canceled,
        id: "hbag_canceled_retry",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      label: "a bound subscription awaiting canceled-Family retry reconciliation",
    },
    {
      expected: {
        checkoutAttemptId: "family_attempt_123",
        groupId: "hbag_attempt",
        kind: "checkout_attempt",
        ownerMemberId: "member_owner",
      },
      group: {
        billingRef: {
          checkoutAttemptId: "family_attempt_123",
          checkoutCreatedAt: new Date("2026-07-27T00:00:00.000Z"),
          stripeSubscriptionIdEncrypted: null,
        },
        billingStatus: HostedBillingStatus.not_started,
        id: "hbag_attempt",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      label: "a persisted Family checkout attempt",
    },
  ])("reports $label as the member's Family billing claim", async ({
    expected,
    group,
  }) => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValueOnce([{ group }]);

    await expect(readHostedMemberFamilyBillingClaim({
      memberId: "member_mom",
      prisma: tx,
    })).resolves.toEqual(expected);

    expect(tx.hostedAccountGroupMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          memberId: "member_mom",
          status: "active",
        },
      }),
    );
  });

  it("converts an active direct trial into Family on the same subscription", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUnique.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(
      createMemberBillingRefMock({ currentBillingPhase: "trial" }),
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn();
    const directTrial = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 1,
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_owner",
      },
      priceId: "price_pulse",
      status: "trialing",
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
      priceId: "price_family",
      subscriptionId: "sub_direct",
    });
    const subscriptionUpdate = vi.fn().mockResolvedValue(updatedSubscription);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: { sessions: { create: checkoutCreate } },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(directTrial),
        update: subscriptionUpdate,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_TRIAL_CONVERSION_CONFIRMATION_REQUIRED",
      httpStatus: 409,
    });
    expect(subscriptionUpdate).not.toHaveBeenCalled();

    await expect(createHostedFamilyBillingCheckout({
      confirmedTrialConversion: true,
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({ alreadyActive: false, url: null });

    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      "sub_direct",
      expect.objectContaining({
        items: [{ id: "si_family", price: "price_family", quantity: 2 }],
        trial_end: "now",
      }),
      {
        idempotencyKey:
          "hosted-family-direct-trial-upgrade:hbag_family:sub_direct:launch_monthly:price_pulse:price_family:seats-2",
      },
    );
  });

  it.each([
    ["scheduled cancellation", { cancelAt: FAMILY_STRIPE_PERIOD_END_SECONDS }],
    ["period-end cancellation", { cancelAtPeriodEnd: true }],
    ["manual collection", { collectionMethod: "send_invoice" as const }],
    ["paused collection", {
      pauseCollection: { behavior: "void" as const, resumes_at: null },
    }],
    ["pending provider update", { pendingUpdate: { expires_at: FAMILY_STRIPE_PERIOD_END_SECONDS } as NonNullable<Stripe.Subscription["pending_update"]> }],
    ["attached schedule", { schedule: "sched_direct" }],
  ])("rejects a direct-to-Family conversion with %s before mutation", async (_label, state) => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
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
    const subscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(makeFamilyStripeSubscription({
          ...state,
          customerId: "cus_direct",
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
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_SUBSCRIPTION_STATE_UNSUPPORTED",
    });

    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  it("does not convert a direct subscription after account suspension wins the owner lock", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
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
    let transactionCount = 0;
    prisma.$transaction = vi.fn((callback) => {
      transactionCount += 1;
      if (transactionCount === 2) {
        tx.hostedMember.findUnique.mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          suspendedAt: new Date("2026-08-10T12:00:00.000Z"),
        });
      }
      return callback(tx);
    });
    const subscriptionRetrieve = vi.fn();
    const subscriptionUpdate = vi.fn();
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
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_UPGRADE_STALE",
    });

    expect(subscriptionRetrieve).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  it("retains a stale unbound Family attempt as ambiguous billing ownership", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValueOnce([{
      group: {
        billingRef: {
          checkoutAttemptId: "family_attempt_stale",
          checkoutCreatedAt: new Date("2026-07-25T00:00:00.000Z"),
          stripeSubscriptionIdEncrypted: null,
        },
        billingStatus: HostedBillingStatus.not_started,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
    }]);

    await expect(readHostedMemberFamilyBillingClaim({
      memberId: "member_mom",
      prisma: tx,
    })).resolves.toEqual({
      checkoutAttemptId: "family_attempt_stale",
      groupId: "hbag_family",
      kind: "checkout_attempt",
      ownerMemberId: "member_owner",
    });
  });

  it("retains a sponsored Family claim while a raced direct subscription is cleaned up", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValueOnce([{
      group: {
        billingRef: {
          checkoutAttemptId: "family_attempt_123",
          checkoutCreatedAt: new Date("2026-07-27T00:00:00.000Z"),
          stripeSubscriptionIdEncrypted: null,
        },
        billingStatus: HostedBillingStatus.not_started,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
    }]);

    await expect(readHostedMemberFamilyBillingClaim({
      memberId: "member_mom",
      prisma: tx,
    })).resolves.toEqual({
      checkoutAttemptId: "family_attempt_123",
      groupId: "hbag_family",
      kind: "checkout_attempt",
      ownerMemberId: "member_owner",
    });
    expect(tx.hostedMember.findUnique).not.toHaveBeenCalled();
  });

  it("retains the Family owner's claim until the event proves the exact handoff subscription", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValueOnce([{
      group: {
        billingRef: {
          checkoutAttemptId: "family_attempt_owner",
          checkoutCreatedAt: new Date("2026-07-27T00:00:00.000Z"),
          stripeSubscriptionIdEncrypted: "encrypted:sub_family",
        },
        billingStatus: HostedBillingStatus.active,
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
    }]);

    await expect(readHostedMemberFamilyBillingClaim({
      memberId: "member_owner",
      prisma: tx,
    })).resolves.toEqual({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_owner",
    });
    expect(tx.hostedMember.findUnique).not.toHaveBeenCalled();
  });

  it("clears only the exact expired Family Checkout attempt", async () => {
    const tx = createTxMock();
    const session = makeFamilyStripeCheckoutSession({
      checkoutAttemptId: "family_attempt_expired",
      sessionId: "cs_test_familyexpired",
      subscriptionId: null,
    });

    await expect(applyHostedFamilyStripeCheckoutExpiredTx({
      session,
      tx,
    })).resolves.toBe(true);

    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutSeatCount: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: {
        checkoutAttemptId: "family_attempt_expired",
        groupId: "hbag_family",
        stripeCheckoutSessionLookupKey: expect.any(String),
      },
    });
  });

  it("fails closed when more than one Family billing owner claims the member", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValueOnce([
      {
        group: {
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          id: "hbag_first",
          ownerMemberId: "member_first",
          suspendedAt: null,
        },
      },
      {
        group: {
          billingRef: {
            checkoutAttemptId: "family_attempt_second",
            checkoutCreatedAt: new Date("2026-07-27T00:00:00.000Z"),
            stripeSubscriptionIdEncrypted: null,
          },
          billingStatus: HostedBillingStatus.not_started,
          id: "hbag_second",
          ownerMemberId: "member_second",
          suspendedAt: null,
        },
      },
    ]);

    await expect(readHostedMemberFamilyBillingClaim({
      memberId: "member_mom",
      prisma: tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_BILLING_CLAIM_AMBIGUOUS",
      httpStatus: 500,
    });
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValueOnce(null);

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

  it("requires an explicit capacity rebalance when a reused invite changes to a full tier", async () => {
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
      code: "HOSTED_FAMILY_INVITE_PLAN_CAPACITY_REQUIRED",
    });

    expect(tx.hostedAccountGroupInvite.update).not.toHaveBeenCalled();
  });

  it("rejects a verified contact already active in the same Family before reserving a seat", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      id: "hbagm_existing",
    });

    await expect(issueHostedFamilyInviteTx({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      targetEmail: "owner@example.test",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_IN_GROUP",
    });

    expect(tx.hostedAccountGroupInvite.count).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.create).not.toHaveBeenCalled();
  });

  it("rejects invite acceptance by a member already active in the same Family", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(
      createPendingInvite({ targetEmailLookupKey: null }),
    );
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_existing",
        planCode: "pulse",
      });

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_relative",
      inviteCode: "FAMILY123",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_IN_GROUP",
    });

    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
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
    expect(
      activationMocks.activateHostedMemberForFamilySponsorshipTx.mock.calls[0]?.[0],
    ).not.toHaveProperty("preparedCryptoDomainRoots");
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
    expect(
      activationMocks.activateHostedMemberForFamilySponsorshipTx.mock.calls[0]?.[0],
    ).not.toHaveProperty("preparedCryptoDomainRoots");
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

  it("records and resumes a pending member tier before atomically swapping Stripe quantities", async () => {
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
      pendingPlanCode: "max",
      planCode: "pulse",
      updatedAt: pendingStartedAt,
    });
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValueOnce({
      pendingPlanCode: "max",
      planCode: "pulse",
    });
    tx.hostedAccountGroupMembership.findMany
      .mockResolvedValue([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_mom", planCode: "max" },
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
      { billedQuantity: 1, planCode: "max" },
    ];
    tx.hostedAccountGroupPlanCapacity.findMany
      .mockResolvedValue(targetCapacities)
      .mockResolvedValueOnce(currentCapacities)
      .mockResolvedValueOnce(currentCapacities);
    const stripeRetrieve = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ itemQuantity: 2 }),
    );
    const stripeUpdate = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ itemQuantity: 1, maxItemQuantity: 1 }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
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
      planCode: "max",
      prisma: prisma as never,
    })).resolves.toMatchObject({ syncing: false });

    expect(tx.hostedAccountGroupMembership.update).toHaveBeenCalledWith({
      data: { pendingPlanCode: "max" },
      select: { id: true, pendingPlanCode: true, planCode: true, updatedAt: true },
      where: { id: "hbagm_mom" },
    });
    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        items: [
          { id: "si_family", quantity: 1 },
          { price: "price_family_max", quantity: 1 },
        ],
        proration_behavior: "create_prorations",
        proration_date: Math.floor(pendingStartedAt.getTime() / 1_000),
      }),
      {
        idempotencyKey:
          `family-member-plan:hbag_family:hbagm_mom:${pendingStartedAt.getTime()}:max`,
      },
    );
    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { planCode: "max" } }),
    );
    expect(nextServerMocks.after).not.toHaveBeenCalled();
  });

  it("lets a Family owner with a separate direct trial change a member tier", async () => {
    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedMember.findUnique.mockResolvedValue({
      billingRef: {
        currentBillingPhase: "trial",
        stripeSubscriptionIdEncrypted: "encrypted:sub_direct_trial",
      },
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_member",
        pendingPlanCode: null,
        planCode: "pulse",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.update.mockResolvedValueOnce({
      id: "hbagm_member",
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
        { memberId: "member_relative", planCode: "edge" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_relative", planCode: "pulse" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_relative", planCode: "pulse" },
      ]);
    const currentCapacities = [{ billedQuantity: 2, planCode: "pulse" }];
    tx.hostedAccountGroupPlanCapacity.findMany
      .mockResolvedValue([
        { billedQuantity: 1, planCode: "pulse" },
        { billedQuantity: 1, planCode: "edge" },
      ])
      .mockResolvedValueOnce(currentCapacities)
      .mockResolvedValueOnce(currentCapacities);
    const stripeUpdate = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ edgeItemQuantity: 1, itemQuantity: 1 }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
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
      memberId: "member_relative",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).resolves.toMatchObject({ syncing: false });

    expect(stripeUpdate).toHaveBeenCalledOnce();
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
    const stripeUpdate = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({ edgeItemQuantity: 1, itemQuantity: 1 }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
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
        idempotencyKey:
          `family-member-plan:hbag_family:hbagm_mom:${pendingStartedAt.getTime()}:edge`,
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
      .mockResolvedValueOnce({
        group: {
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          id: "hbag_other",
          ownerMemberId: "member_other_owner",
          suspendedAt: null,
        },
        role: "member",
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
      code: "HOSTED_FAMILY_MEMBER_PLAN_SYNCING",
    });

    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalled();
    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(nextServerMocks.after).not.toHaveBeenCalled();
  });

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

  it("clears a fresh pending member tier when validation fails before Stripe mutation", async () => {
    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce({
        id: "hbagm_member",
        pendingPlanCode: null,
        planCode: "pulse",
        updatedAt: new Date("2026-07-15T11:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.update.mockResolvedValueOnce({
      id: "hbagm_member",
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
        { memberId: "member_relative", planCode: "edge" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_relative", planCode: "pulse" },
      ])
      .mockResolvedValueOnce([
        { memberId: "member_owner", planCode: "pulse" },
        { memberId: "member_relative", planCode: "pulse" },
      ]);
    const currentCapacities = [{ billedQuantity: 2, planCode: "pulse" }];
    tx.hostedAccountGroupPlanCapacity.findMany
      .mockResolvedValue([
        { billedQuantity: 1, planCode: "pulse" },
        { billedQuantity: 1, planCode: "edge" },
      ])
      .mockResolvedValueOnce(currentCapacities)
      .mockResolvedValueOnce(currentCapacities);
    const stripeUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(
          makeFamilyStripeSubscription({ priceId: "price_unknown" }),
        ),
        update: stripeUpdate,
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    const transactionOutcomes: string[] = [];
    prisma.$transaction = vi.fn(async (callback) => {
      try {
        const result = await callback(tx);
        transactionOutcomes.push("committed");
        return result;
      } catch (error) {
        transactionOutcomes.push("rolled_back");
        throw error;
      }
    });

    await expect(updateHostedFamilyMemberPlan({
      groupId: "hbag_family",
      memberId: "member_relative",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_SUBSCRIPTION_INVALID",
    });

    expect(stripeUpdate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.updateMany).toHaveBeenCalledWith({
      data: { pendingPlanCode: null },
      where: {
        id: "hbagm_member",
        pendingPlanCode: "edge",
        planCode: "pulse",
        updatedAt: pendingStartedAt,
      },
    });
    expect(transactionOutcomes).toEqual(["committed", "committed"]);
  });

  it("alerts for request-id-free member-tier failures with stable transition identity", async () => {
    const tx = createTxMock();
    const pendingStartedAt = new Date("2026-07-15T12:00:00.000Z");
    const pendingMembership = {
      id: "hbagm_mom",
      pendingPlanCode: "edge",
      planCode: "pulse",
      updatedAt: pendingStartedAt,
    };
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(pendingMembership)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pendingMembership)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroupMembership.findUnique.mockResolvedValue({
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
    const providerError = buildFamilyStripeConnectionErrorWithoutRequestId();
    const stripeUpdate = vi.fn().mockRejectedValue(providerError);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
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
    const fetchMock = stubFamilyStripeAlertEmailDelivery();
    const input = {
      groupId: "hbag_family",
      memberId: "member_mom",
      ownerMemberId: "member_owner",
      planCode: "edge",
      prisma: prisma as never,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(updateHostedFamilyMemberPlan(input)).rejects.toBe(providerError);
      await runOnlyScheduledFamilyStripeAlert();
      if (attempt === 0) {
        nextServerMocks.after.mockClear();
      }
    }

    expect(tx.hostedAccountGroupMembership.update).not.toHaveBeenCalled();
    expect(stripeUpdate).toHaveBeenCalledTimes(2);
    expect(stripeUpdate.mock.calls[0]?.[2]).toEqual({
      idempotencyKey:
        `family-member-plan:hbag_family:hbagm_mom:${pendingStartedAt.getTime()}:edge`,
    });
    expect(stripeUpdate.mock.calls[1]?.[2]).toEqual(stripeUpdate.mock.calls[0]?.[2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readResendIdempotencyKey(fetchMock, 0)).toBe(
      readResendIdempotencyKey(fetchMock, 1),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      fetchMock.mock.calls[1]?.[1]?.body,
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "family.billing.member-plan",
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("member_mom");
  });

  it("signals the accepted member activation mailbox after browser acceptance commits", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());
    const preparedCryptoDomainRoots = new Map([
      ["control", { domain: "control" }],
    ]);
    cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mockResolvedValueOnce(
      preparedCryptoDomainRoots,
    );
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
    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledWith({
      prisma,
      userId: "member_mom",
    });
    expect(
      cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0] ?? 0);
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedCryptoDomainRoots,
      }),
    );
  });

  it("returns a missing browser invite before crypto preparation", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(null);
    cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mockRejectedValue(
      new Error("KMS unavailable"),
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(acceptHostedFamilyInvite({
      acceptedMemberId: "member_mom",
      inviteCode: "missing_invite",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_NOT_FOUND",
      httpStatus: 404,
    });

    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a wrong-phone browser identity before crypto preparation", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValue({
      ...createPendingInvite(),
      targetPhoneLookupKey: createHostedPhoneLookupKey("+48600000000"),
    });
    cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mockRejectedValue(
      new Error("KMS unavailable"),
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(acceptHostedFamilyInvite({
        acceptedMemberId: "member_mom",
        inviteCode: "invite_phone",
        phoneNumber: "+48 700 000 000",
        prisma: prisma as never,
        requireWebBinding: true,
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
        httpStatus: 403,
      });
    }

    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a wrong-email browser identity before crypto preparation", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValue({
      ...createPendingInvite(),
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
    });
    cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mockRejectedValue(
      new Error("KMS unavailable"),
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(acceptHostedFamilyInvite({
      acceptedMemberId: "member_mom",
      email: "someone-else@example.com",
      inviteCode: "invite_email",
      prisma: prisma as never,
      requireWebBinding: true,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_EMAIL_MISMATCH",
      httpStatus: 403,
    });

    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("replays browser acceptance by waking the existing activation mailbox", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValue({
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
    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).not.toHaveBeenCalled();
  });

  it.each([
    {
      invite: createPendingInvite({
        expiresAt: new Date("2026-06-18T11:59:59.999Z"),
      }),
      label: "expired",
    },
    {
      invite: createPendingInvite({
        status: "revoked",
      }),
      label: "revoked",
    },
  ])("rejects an already-$label browser invite before crypto preparation", async ({
    invite,
  }) => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(invite);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(acceptHostedFamilyInvite({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      now: new Date("2026-06-18T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
      httpStatus: 410,
    });

    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("revalidates a browser invite retarget inside the acceptance transaction", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce({
        ...createPendingInvite(),
        targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
      })
      .mockResolvedValueOnce({
        ...createPendingInvite(),
        targetEmailLookupKey: createHostedEmailLookupKey("other@example.com"),
      });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(acceptHostedFamilyInvite({
      acceptedMemberId: "member_mom",
      email: "mom@example.com",
      inviteCode: "invite_email",
      prisma: prisma as never,
      requireWebBinding: true,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_EMAIL_MISMATCH",
      httpStatus: 403,
    });

    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledWith({
      prisma,
      userId: "member_mom",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "expiry",
      transactionInvite: createPendingInvite({
        expiresAt: new Date("2026-06-18T11:59:59.999Z"),
      }),
    },
    {
      label: "revocation",
      transactionInvite: createPendingInvite({
        status: "revoked",
      }),
    },
  ])("revalidates browser invite $label inside the acceptance transaction", async ({
    transactionInvite,
  }) => {
    const tx = createTxMock();
    const matchingInvite = createPendingInvite({
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
    });
    tx.hostedAccountGroupInvite.findUnique
      .mockResolvedValueOnce(matchingInvite)
      .mockResolvedValueOnce({
        ...transactionInvite,
        targetEmailLookupKey: matchingInvite.targetEmailLookupKey,
      });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(acceptHostedFamilyInvite({
      acceptedMemberId: "member_mom",
      email: "mom@example.com",
      inviteCode: "invite_email",
      now: new Date("2026-06-18T12:00:00.000Z"),
      prisma: prisma as never,
      requireWebBinding: true,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
      httpStatus: 410,
    });

    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("uses a fresh transaction clock when an invite expires during crypto preparation", async () => {
    vi.useFakeTimers();
    try {
      const tx = createTxMock();
      const expiresAt = new Date("2026-06-18T12:00:00.000Z");
      tx.hostedAccountGroupInvite.findUnique.mockResolvedValue(
        createPendingInvite({
          expiresAt,
          targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
        }),
      );
      const prisma = tx as FamilyPlanTxMock & {
        $transaction: ReturnType<typeof vi.fn>;
      };
      prisma.$transaction = vi.fn((callback) => callback(tx));
      vi.setSystemTime(new Date("2026-06-18T11:59:59.000Z"));
      cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mockImplementationOnce(
        async () => {
          vi.setSystemTime(expiresAt);
          return new Map();
        },
      );

      await expect(acceptHostedFamilyInvite({
        acceptedMemberId: "member_mom",
        email: "mom@example.com",
        inviteCode: "invite_email",
        prisma: prisma as never,
        requireWebBinding: true,
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
        httpStatus: 410,
      });

      expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates)
        .toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
      expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("revalidates Family seat authority inside the browser acceptance transaction", async () => {
    const tx = createTxMock({
      activeMembershipCount: 4,
      billedSeatCount: 4,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValue(createPendingInvite({
      targetEmailLookupKey: createHostedEmailLookupKey("mom@example.com"),
    }));
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(acceptHostedFamilyInvite({
      acceptedMemberId: "member_mom",
      email: "mom@example.com",
      inviteCode: "invite_email",
      prisma: prisma as never,
      requireWebBinding: true,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
    });

    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("accepts a paid Family invite after an abandoned owner checkout expires", async () => {
    const expiredCheckoutAttemptId = "hbfca_expired_draft";
    const expiredCheckoutSessionId = "cs_test_expired_draft";
    const expiredSession = makeFamilyDraftStripeCheckoutSession({
      checkoutAttemptId: expiredCheckoutAttemptId,
      sessionId: expiredCheckoutSessionId,
      status: "expired",
      subscriptionId: null,
    });
    const expiryTx = createTxMock({
      billedSeatCount: null,
      group: {
        billingStatus: HostedBillingStatus.not_started,
        id: "hbag_draft",
        ownerMemberId: "member_mom",
        suspendedAt: null,
      },
    });
    expiryTx.hostedAccountGroup.findUnique.mockResolvedValueOnce({
      id: "hbag_draft",
      ownerMemberId: "member_mom",
    });

    await expect(applyHostedFamilyStripeCheckoutExpiredTx({
      session: expiredSession,
      tx: expiryTx,
    })).resolves.toBe(true);

    expect(expiryTx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutSeatCount: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: {
        checkoutAttemptId: expiredCheckoutAttemptId,
        groupId: "hbag_draft",
        stripeCheckoutSessionLookupKey:
          createHostedStripeCheckoutSessionLookupKey(expiredCheckoutSessionId),
      },
    });

    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
      pendingInviteCountExcludingCurrent: 0,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(
      createPendingInvite(),
    );
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createNeverPaidFamilyDraftMembership())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const draft = createNeverPaidFamilyDraftRecord();
    tx.hostedAccountGroup.findUnique
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    const transitionOrder: string[] = [];
    tx.hostedAccountGroupInvite.updateMany.mockImplementation(async () => {
      transitionOrder.push("claim-invite");
      return { count: 1 };
    });
    tx.hostedAccountGroupMembership.upsert.mockImplementation(async () => {
      transitionOrder.push("join-paid-family");
      return {
        group: {
          billingStatus: HostedBillingStatus.active,
          id: "hbag_family",
          ownerMemberId: "member_dad",
          suspendedAt: null,
        },
        groupId: "hbag_family",
        memberId: "member_mom",
        planCode: "pulse",
        role: "member",
        status: "active",
        updatedAt: new Date("2026-08-01T12:00:00.000Z"),
        usagePlanTransitionAt: null,
        usagePlanTransitionFromCode: null,
        usagePlanTransitionKind: null,
        usagePlanTransitionToCode: null,
      };
    });
    tx.hostedAccountGroup.deleteMany.mockImplementation(async () => {
      transitionOrder.push("delete-owner-draft");
      return { count: 1 };
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

    expect(tx.hostedAccountGroup.deleteMany).toHaveBeenCalledWith({
      where: {
        billingStatus: HostedBillingStatus.not_started,
        id: "hbag_draft",
        ownerMemberId: "member_mom",
        suspendedAt: null,
      },
    });
    expect(tx.hostedAccountGroupInvite.updateMany).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroupMembership.upsert).toHaveBeenCalledOnce();
    expect(transitionOrder).toEqual([
      "claim-invite",
      "join-paid-family",
      "delete-owner-draft",
    ]);
    expect(tx.hostedAccountGroupPlanCapacity.deleteMany).not.toHaveBeenCalled();
  });

  it("does not abandon an inert draft when the paid invite later fails validation", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 1,
      pendingInviteCountExcludingCurrent: 0,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(
      createPendingInvite(),
    );
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createNeverPaidFamilyDraftMembership())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(
      createNeverPaidFamilyDraftRecord(),
    );

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
    });

    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("keeps a paid invite pending while the member's own Checkout can still complete", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
      pendingInviteCountExcludingCurrent: 0,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(
      createPendingInvite(),
    );
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createNeverPaidFamilyDraftMembership({
        checkoutAttemptId: "hbfca_live_draft",
        stripeCheckoutSessionId: "cs_test_live_draft",
      }));
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(
      createNeverPaidFamilyDraftRecord({
        checkoutAttemptId: "hbfca_live_draft",
        checkoutCreatedAt: new Date("2026-08-01T12:00:00.000Z"),
        checkoutSeatCount: 2,
        stripeCheckoutSessionId: "cs_test_live_draft",
      }),
    );

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DRAFT_CHECKOUT_ACTIVE",
      details: { inviteCode: "invite_phone" },
      message: expect.stringContaining(
        "familyInviteReturn=%2Ffamily%2Faccept%2Finvite_phone",
      ),
    });

    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupPlanCapacity.findMany).not.toHaveBeenCalled();
  });

  it("lets a concurrent billing bind win over automatic draft abandonment", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(
      createPendingInvite(),
    );
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createNeverPaidFamilyDraftMembership());
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(
      createNeverPaidFamilyDraftRecord({
        stripeSubscriptionId: "sub_race_winner",
      }),
    );

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DRAFT_BILLING_SYNCING",
    });

    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupMembership.upsert).not.toHaveBeenCalled();
  });

  it("expires an open owner Checkout before deleting the exact unpaid draft", async () => {
    const checkoutAttemptId = "hbfca_owner_recovery";
    const checkoutCreatedAt = new Date("2026-08-01T12:00:00.000Z");
    const checkoutSessionId = "cs_test_owner_recovery";
    const draftAccess = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_draft",
      ownerMemberId: "member_mom",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group: draftAccess });
    const draft = createNeverPaidFamilyDraftRecord({
      checkoutAttemptId,
      checkoutCreatedAt,
      checkoutSeatCount: 2,
      stripeCheckoutSessionId: checkoutSessionId,
    });
    tx.hostedAccountGroup.findUnique
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    const openSession = makeFamilyDraftStripeCheckoutSession({
      checkoutAttemptId,
      sessionId: checkoutSessionId,
      status: "open",
      subscriptionId: null,
    });
    const expiredSession = makeFamilyDraftStripeCheckoutSession({
      checkoutAttemptId,
      sessionId: checkoutSessionId,
      status: "expired",
      subscriptionId: null,
    });
    const order: string[] = [];
    const retrieve = vi.fn()
      .mockImplementationOnce(async () => {
        order.push("retrieve-candidate");
        return openSession;
      })
      .mockImplementationOnce(async () => {
        order.push("retrieve-before-expire");
        return openSession;
      });
    const expire = vi.fn().mockImplementation(async () => {
      order.push("expire");
      return expiredSession;
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: { sessions: { expire, retrieve } },
    });
    tx.hostedAccountGroup.deleteMany.mockImplementation(async ({ where }) => {
      order.push(`delete:${where.id}`);
      return { count: 1 };
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn(async (callback) => {
      order.push("transaction");
      return callback(tx);
    });

    await expect(abandonHostedFamilyDraftForOwner({
      now: new Date("2026-08-01T12:05:00.000Z"),
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).resolves.toEqual({ abandoned: true });

    expect(order).toEqual([
      "retrieve-candidate",
      "retrieve-before-expire",
      "expire",
      "transaction",
      "delete:hbag_draft",
    ]);
    expect(expire).toHaveBeenCalledWith(checkoutSessionId);
  });

  it("abandons the exact draft when Stripe proves its Checkout no longer exists", async () => {
    const checkoutAttemptId = "hbfca_missing_checkout";
    const checkoutCreatedAt = new Date("2026-08-01T12:00:00.000Z");
    const checkoutSessionId = "cs_test_missing_checkout";
    const draft = createNeverPaidFamilyDraftRecord({
      checkoutAttemptId,
      checkoutCreatedAt,
      checkoutSeatCount: 2,
      stripeCheckoutSessionId: checkoutSessionId,
    });
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    const retrieve = vi.fn().mockRejectedValue({
      code: "resource_missing",
      type: "StripeInvalidRequestError",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: { sessions: { retrieve } },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(abandonHostedFamilyDraftForOwner({
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).resolves.toEqual({ abandoned: true });

    expect(retrieve).toHaveBeenCalledWith(checkoutSessionId);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroup.deleteMany).toHaveBeenCalledOnce();
  });

  it("accepts exact expiry reconciliation that clears the prepared Checkout claim", async () => {
    const checkoutAttemptId = "hbfca_expiry_reconciliation";
    const checkoutCreatedAt = new Date("2026-08-01T12:00:00.000Z");
    const checkoutSessionId = "cs_test_expiry_reconciliation";
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique
      .mockResolvedValueOnce(createNeverPaidFamilyDraftRecord({
        checkoutAttemptId,
        checkoutCreatedAt,
        checkoutSeatCount: 2,
        stripeCheckoutSessionId: checkoutSessionId,
      }))
      .mockResolvedValueOnce(createNeverPaidFamilyDraftRecord());
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue(
            makeFamilyDraftStripeCheckoutSession({
              checkoutAttemptId,
              sessionId: checkoutSessionId,
              status: "expired",
              subscriptionId: null,
            }),
          ),
        },
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(abandonHostedFamilyDraftForOwner({
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).resolves.toEqual({ abandoned: true });

    expect(tx.hostedAccountGroup.deleteMany).toHaveBeenCalledOnce();
  });

  it("starts no transaction when Stripe cannot establish a terminal Checkout state", async () => {
    const checkoutSessionId = "cs_test_provider_failure";
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(
      createNeverPaidFamilyDraftRecord({
        checkoutAttemptId: "hbfca_provider_failure",
        checkoutCreatedAt: new Date("2026-08-01T12:00:00.000Z"),
        checkoutSeatCount: 2,
        stripeCheckoutSessionId: checkoutSessionId,
      }),
    );
    const providerError = {
      code: "api_connection_error",
      type: "StripeConnectionError",
    };
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockRejectedValue(providerError),
        },
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(abandonHostedFamilyDraftForOwner({
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).rejects.toBe(providerError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
  });

  it("lets a replacement Checkout claim win after provider preparation", async () => {
    const checkoutAttemptId = "hbfca_original_claim";
    const checkoutCreatedAt = new Date("2026-08-01T12:00:00.000Z");
    const checkoutSessionId = "cs_test_original_claim";
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique
      .mockResolvedValueOnce(createNeverPaidFamilyDraftRecord({
        checkoutAttemptId,
        checkoutCreatedAt,
        checkoutSeatCount: 2,
        stripeCheckoutSessionId: checkoutSessionId,
      }))
      .mockResolvedValueOnce(createNeverPaidFamilyDraftRecord({
        checkoutAttemptId: "hbfca_replacement_claim",
        checkoutCreatedAt: new Date("2026-08-01T12:10:00.000Z"),
        checkoutSeatCount: 3,
        stripeCheckoutSessionId: "cs_test_replacement_claim",
      }));
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue(
            makeFamilyDraftStripeCheckoutSession({
              checkoutAttemptId,
              sessionId: checkoutSessionId,
              status: "expired",
              subscriptionId: null,
            }),
          ),
        },
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(abandonHostedFamilyDraftForOwner({
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DRAFT_CHANGED",
    });

    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ["group", "hbag_original", "hbfca_original"],
    ["attempt", "hbag_draft", "hbfca_original"],
  ])(
    "rejects a replacement %s before provider cleanup",
    async (_replacementKind, expectedGroupId, expectedCheckoutAttemptId) => {
      const currentCheckoutAttemptId = "hbfca_replacement";
      const currentCheckoutSessionId = "cs_test_replacement";
      const currentDraft = createNeverPaidFamilyDraftRecord({
        checkoutAttemptId: currentCheckoutAttemptId,
        checkoutCreatedAt: new Date("2026-08-01T12:10:00.000Z"),
        checkoutSeatCount: 3,
        stripeCheckoutSessionId: currentCheckoutSessionId,
      });
      const tx = createTxMock();
      tx.hostedAccountGroup.findUnique
        .mockResolvedValueOnce(currentDraft)
        .mockResolvedValueOnce(currentDraft);
      runtimeMocks.requireHostedStripeApi.mockReturnValue({
        checkout: {
          sessions: {
            retrieve: vi.fn().mockResolvedValue(
              makeFamilyDraftStripeCheckoutSession({
                checkoutAttemptId: currentCheckoutAttemptId,
                sessionId: currentCheckoutSessionId,
                status: "expired",
                subscriptionId: null,
              }),
            ),
          },
        },
      });
      const prisma = tx as FamilyPlanTxMock & {
        $transaction: ReturnType<typeof vi.fn>;
      };
      prisma.$transaction = vi.fn((callback) => callback(tx));

      await expect(abandonHostedFamilyDraftForOwner({
        expectedCheckoutClaim: {
          checkoutAttemptId: expectedCheckoutAttemptId,
          groupId: expectedGroupId,
        },
        ownerMemberId: "member_mom",
        prisma: prisma as never,
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_DRAFT_CHANGED",
        httpStatus: 409,
      });

      expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
    },
  );

  it("preserves a stale unbound Checkout claim without provider proof", async () => {
    const staleDraft = createNeverPaidFamilyDraftRecord({
      checkoutAttemptId: "hbfca_stale_unbound",
      checkoutCreatedAt: new Date("2026-07-30T12:00:00.000Z"),
      checkoutSeatCount: 2,
    });
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(staleDraft);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(abandonHostedFamilyDraftForOwner({
      now: new Date("2026-08-01T12:00:00.000Z"),
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DRAFT_RECOVERY_REQUIRED",
      retryable: false,
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      "exact inert draft",
      createNeverPaidFamilyDraftRecord(),
      "abandonable",
    ],
    [
      "bound Checkout draft",
      createNeverPaidFamilyDraftRecord({
        checkoutAttemptId: "hbfca_bound_projection",
        checkoutCreatedAt: new Date("2026-08-01T12:00:00.000Z"),
        checkoutSeatCount: 2,
        stripeCheckoutSessionId: "cs_test_bound_projection",
      }),
      "abandonable",
    ],
    [
      "recent unbound Checkout draft",
      createNeverPaidFamilyDraftRecord({
        checkoutAttemptId: "hbfca_recent_projection",
        checkoutCreatedAt: new Date("2026-08-01T12:00:00.000Z"),
        checkoutSeatCount: 2,
      }),
      "checkout_starting",
    ],
    [
      "stale unbound Checkout draft",
      createNeverPaidFamilyDraftRecord({
        checkoutAttemptId: "hbfca_stale_projection",
        checkoutCreatedAt: new Date("2026-07-30T12:00:00.000Z"),
        checkoutSeatCount: 2,
      }),
      "recovery_required",
    ],
    [
      "draft with a pending invite",
      createNeverPaidFamilyDraftRecord({ invites: [{ id: "invite_pending" }] }),
      "not_abandonable",
    ],
    [
      "draft with another active member",
      createNeverPaidFamilyDraftRecord({
        memberships: [
          { memberId: "member_mom", role: "owner", status: "active" },
          { memberId: "member_other", role: "member", status: "active" },
        ],
      }),
      "not_abandonable",
    ],
    [
      "draft with paid capacity",
      createNeverPaidFamilyDraftRecord({
        planCapacities: [{ groupId: "hbag_draft" }],
      }),
      "not_abandonable",
    ],
    [
      "suspended draft",
      createNeverPaidFamilyDraftRecord({
        suspendedAt: new Date("2026-08-01T12:00:00.000Z"),
      }),
      "recovery_required",
    ],
    [
      "draft with inconsistent Checkout authority",
      createNeverPaidFamilyDraftRecord({
        stripeCheckoutSessionId: "cs_test_inconsistent_projection",
      }),
      "recovery_required",
    ],
    [
      "draft with subscription authority",
      createNeverPaidFamilyDraftRecord({
        stripeSubscriptionId: "sub_projection_authority",
      }),
      "recovery_required",
    ],
  ] as const)(
    "projects %s to %s Settings recovery state",
    async (_label, draft, expectedState) => {
      const tx = createTxMock();
      tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(draft);

      await expect(readHostedFamilyDraftRecoveryStateForOwner({
        now: new Date("2026-08-01T12:30:00.000Z"),
        ownerMemberId: "member_mom",
        prisma: tx,
      })).resolves.toEqual(expectedState === "checkout_starting"
        ? {
            checkoutAttemptId: "hbfca_recent_projection",
            groupId: "hbag_draft",
            state: expectedState,
          }
        : { state: expectedState });
    },
  );

  it("does not advertise abandonment during a direct-paid conversion", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(
      createNeverPaidFamilyDraftRecord(),
    );
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingRef: { stripeSubscriptionIdEncrypted: "encrypted_subscription" },
      billingStatus: HostedBillingStatus.active,
    });

    await expect(readHostedFamilyDraftRecoveryStateForOwner({
      ownerMemberId: "member_mom",
      prisma: tx,
    })).resolves.toEqual({ state: "not_abandonable" });
  });

  it.each([
    ["a pending invite", { invites: [{ id: "invite_draft" }] }],
    [
      "another membership",
      {
        memberships: [
          { memberId: "member_mom", role: "owner", status: "active" },
          { memberId: "member_other", role: "member", status: "active" },
        ],
      },
    ],
    ["paid capacity", { planCapacities: [{ groupId: "hbag_draft" }] }],
  ])("does not abandon an owner group with %s", async (_label, relations) => {
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(
      createNeverPaidFamilyDraftRecord(relations),
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(abandonHostedFamilyDraftForOwner({
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DRAFT_NOT_ABANDONABLE",
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
  });

  it("does not delete a draft when Checkout completes during abandonment", async () => {
    const checkoutAttemptId = "hbfca_completion_race";
    const checkoutCreatedAt = new Date("2026-08-01T12:00:00.000Z");
    const checkoutSessionId = "cs_test_completion_race";
    const draftAccess = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_draft",
      ownerMemberId: "member_mom",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group: draftAccess });
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(
      createNeverPaidFamilyDraftRecord({
        checkoutAttemptId,
        checkoutCreatedAt,
        checkoutSeatCount: 2,
        stripeCheckoutSessionId: checkoutSessionId,
      }),
    );
    const openSession = makeFamilyDraftStripeCheckoutSession({
      checkoutAttemptId,
      sessionId: checkoutSessionId,
      status: "open",
      subscriptionId: null,
    });
    const completedSession = makeFamilyDraftStripeCheckoutSession({
      checkoutAttemptId,
      sessionId: checkoutSessionId,
      status: "complete",
      subscriptionId: "sub_completion_race",
    });
    const expire = vi.fn();
    const retrieve = vi.fn()
      .mockResolvedValueOnce(openSession)
      .mockResolvedValueOnce(completedSession);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: { sessions: { expire, retrieve } },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(abandonHostedFamilyDraftForOwner({
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DRAFT_BILLING_SYNCING",
    });

    expect(expire).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
  });

  it("does not delete a draft while a direct subscription can still convert to Family", async () => {
    const tx = createTxMock({ billedSeatCount: null });
    const draft = createNeverPaidFamilyDraftRecord();
    tx.hostedAccountGroup.findUnique
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingRef: {
        stripeSubscriptionIdEncrypted: "encrypted:sub_direct_conversion",
      },
      billingStatus: HostedBillingStatus.active,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(abandonHostedFamilyDraftForOwner({
      ownerMemberId: "member_mom",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED",
    });

    expect(tx.hostedAccountGroup.deleteMany).not.toHaveBeenCalled();
  });

  it("ignores a delayed Checkout completion after its draft group was deleted", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce(null);
    tx.hostedAccountGroupBillingRef.findMany.mockResolvedValue([]);

    await expect(applyHostedFamilyStripeCheckoutCompletedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-08-01T12:10:00.000Z"),
      },
      session: makeFamilyDraftStripeCheckoutSession({
        checkoutAttemptId: "hbfca_deleted_draft",
        sessionId: "cs_test_deleted_draft",
        status: "complete",
        subscriptionId: "sub_deleted_draft",
      }),
      tx,
    })).resolves.toEqual({ groupId: null });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.create).not.toHaveBeenCalled();
  });

  it("does not let one member use active sponsorship from two family plans", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        group: {
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          id: "hbag_other",
          ownerMemberId: "member_other_owner",
          suspendedAt: null,
        },
        role: "member",
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
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        group: {
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          id: "hbag_other",
          ownerMemberId: "member_other_owner",
          suspendedAt: null,
        },
        role: "member",
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

  it.each([
    ["not-started", HostedBillingStatus.not_started],
    ["incomplete", HostedBillingStatus.incomplete],
    ["active", HostedBillingStatus.active],
    ["past-due", HostedBillingStatus.past_due],
    ["paused", HostedBillingStatus.paused],
    ["unpaid", HostedBillingStatus.unpaid],
  ])(
    "does not silently sponsor a member with a bound %s direct subscription",
    async (_label, billingStatus) => {
      const tx = createTxMock();
      tx.hostedMember.findUnique.mockResolvedValueOnce({
        billingRef: {
          stripeSubscriptionIdEncrypted: "encrypted:sub_direct",
        },
        billingStatus,
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
    },
  );

  it("admits a migrated Starter member after legacy retirement clears the binding", async () => {
    const tx = createTxMock();
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingRef: null,
      billingStatus: HostedBillingStatus.active,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      status: "active",
    });

    expect(tx.hostedAccountGroupMembership.upsert).toHaveBeenCalledOnce();
  });

  it("admits a member only after the bound direct subscription is canceled", async () => {
    const tx = createTxMock();
    tx.hostedMember.findUnique.mockResolvedValueOnce({
      billingRef: {
        stripeSubscriptionIdEncrypted: "encrypted:sub_canceled",
      },
      billingStatus: HostedBillingStatus.canceled,
    });
    tx.hostedAccountGroupInvite.findUnique.mockResolvedValueOnce(createPendingInvite());

    await expect(acceptHostedFamilyInviteTx({
      acceptedMemberId: "member_mom",
      inviteCode: "invite_phone",
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      memberId: "member_mom",
      status: "active",
    });

    expect(tx.hostedAccountGroupMembership.upsert).toHaveBeenCalledOnce();
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
    const ownerPrepared = new Map();
    const memberPrepared = new Map();
    const preparedCryptoDomainRootsByMember = new Map([
      ["member_mom", memberPrepared],
      ["member_owner", ownerPrepared],
    ]);

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt,
      },
      preparedCryptoDomainRootsByMember,
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
        preparedCryptoDomainRoots: ownerPrepared,
        prisma: tx,
        sourceEventId: "family-subscription:sub_family",
      },
    );
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenNthCalledWith(
      2,
      {
        memberId: "member_mom",
        occurredAt: eventCreatedAt,
        preparedCryptoDomainRoots: memberPrepared,
        prisma: tx,
        sourceEventId: "family-subscription:sub_family",
      },
    );
  });

  it("prepares at most six Family members sequentially before reconciliation", async () => {
    const tx = createTxMock();
    const memberships = Array.from(
      { length: HOSTED_FAMILY_MAX_SEATS },
      (_, index) => ({
        memberId: `member_${index}`,
      }),
    );
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue(memberships);
    let activeCalls = 0;
    let maxConcurrentCalls = 0;
    cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mockImplementation(
      async ({ userId }) => {
        activeCalls += 1;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeCalls -= 1;
        return new Map([["control", { domain: "control", userId }]]);
      },
    );

    const prepared = await prepareHostedFamilyStripeActivationCryptoDomainRoots({
      prisma: tx as never,
      subscription: makeFamilyStripeSubscription({
        itemQuantity: HOSTED_FAMILY_MAX_SEATS,
      }),
    });

    expect([...prepared.keys()]).toEqual(memberships.map(({ memberId }) => memberId));
    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates)
      .toHaveBeenCalledTimes(HOSTED_FAMILY_MAX_SEATS);
    expect(maxConcurrentCalls).toBe(1);
    expect(tx.hostedAccountGroupMembership.findMany).toHaveBeenCalledWith({
      orderBy: {
        memberId: "asc",
      },
      select: {
        memberId: true,
      },
      take: HOSTED_FAMILY_MAX_SEATS + 1,
      where: {
        groupId: "hbag_family",
        status: "active",
      },
    });
  });

  it("prepares owner and sponsored-member candidates before resolving a direct-subscription race", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner" },
      { memberId: "member_mom" },
    ]);
    cryptoRootMocks.prepareHostedCryptoDomainRootCandidates.mockImplementation(
      async ({ userId }) => new Map([["control", { domain: "control", userId }]]),
    );

    const prepared = await prepareHostedFamilyStripeActivationCryptoDomainRoots({
      prisma: tx as never,
      subscription: makeFamilyStripeSubscription(),
    });

    expect([...prepared.keys()]).toEqual(["member_owner", "member_mom"]);
    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates)
      .toHaveBeenNthCalledWith(1, {
        prisma: tx,
        userId: "member_owner",
      });
    expect(cryptoRootMocks.prepareHostedCryptoDomainRootCandidates)
      .toHaveBeenNthCalledWith(2, {
        prisma: tx,
        userId: "member_mom",
      });
    expect(tx.hostedMember.findUnique).not.toHaveBeenCalled();
  });

  it("bounds active Family reconciliation to six sequential prepared commits", async () => {
    const tx = createTxMock();
    const memberships = Array.from(
      { length: HOSTED_FAMILY_MAX_SEATS },
      (_, index) => ({
        id: `hbagm_member_${index}`,
        memberId: index === 0 ? "member_owner" : `member_${index}`,
        pendingPlanCode: null,
        planCode: "pulse",
        role: index === 0 ? "owner" : "member",
      }),
    );
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue(memberships);
    const preparedCryptoDomainRootsByMember = new Map(
      memberships.map(({ memberId }) => [
        memberId,
        new Map(),
      ] as const),
    );
    let activeCalls = 0;
    let maxConcurrentCalls = 0;
    activationMocks.activateHostedMemberForFamilySponsorshipTx.mockImplementation(
      async ({ memberId }) => {
        activeCalls += 1;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeCalls -= 1;
        return {
          activated: true,
          hostedExecutionEventId: "member.activated:family",
          hostedExecutionMailboxItemId: "mailbox_member_activation",
          memberId,
        };
      },
    );

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
      },
      preparedCryptoDomainRootsByMember,
      subscription: makeFamilyStripeSubscription({
        itemQuantity: HOSTED_FAMILY_MAX_SEATS,
      }),
      tx,
    })).resolves.toMatchObject({
      activations: memberships.map(({ memberId }) => ({ memberId })),
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupMembership.findMany).toHaveBeenCalledTimes(5);
    expect(tx.hostedAccountGroupMembership.findMany).toHaveBeenNthCalledWith(5, {
      orderBy: {
        memberId: "asc",
      },
      select: {
        memberId: true,
        role: true,
      },
      where: {
        groupId: "hbag_family",
        status: "active",
      },
    });
    expect(tx.hostedAccountGroupMembership.findFirst)
      .toHaveBeenCalledTimes(HOSTED_FAMILY_MAX_SEATS);
    expect(tx.hostedMember.findUnique).toHaveBeenCalledOnce();
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx)
      .toHaveBeenCalledTimes(HOSTED_FAMILY_MAX_SEATS);
    expect(
      activationMocks.activateHostedMemberForFamilySponsorshipTx.mock.calls.every(
        ([activationInput]) =>
          activationInput.preparedCryptoDomainRoots
          === preparedCryptoDomainRootsByMember.get(activationInput.memberId),
      ),
    ).toBe(true);
    expect(maxConcurrentCalls).toBe(1);
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
        maxItemQuantity: 1,
      }),
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          billedSeatCount: 4,
          currentBillingPhase: "paid",
        }),
      }),
    );
    expect(tx.hostedAccountGroupPlanCapacity.createMany).toHaveBeenCalledWith({
      data: [
        { billedQuantity: 2, groupId: "hbag_family", planCode: "pulse" },
        { billedQuantity: 1, groupId: "hbag_family", planCode: "edge" },
        { billedQuantity: 1, groupId: "hbag_family", planCode: "max" },
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
        pendingPlanCode: "max",
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
        itemQuantity: 1,
        maxItemQuantity: 1,
      }),
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      runtimeRecheckMemberIds: ["member_mom"],
    });

    expect(tx.hostedAccountGroupMembership.updateMany).toHaveBeenCalledWith({
      data: {
        pendingPlanCode: null,
        planCode: "max",
        usagePlanTransitionAt: new Date("2026-07-15T12:30:00.000Z"),
        usagePlanTransitionFromCode: "launch_monthly",
        usagePlanTransitionKind: "plan_upgrade",
        usagePlanTransitionToCode: "launch_max_monthly",
      },
      where: {
        id: "hbagm_mom",
        pendingPlanCode: "max",
        planCode: "pulse",
        status: "active",
      },
    });
    expect(tx.hostedAccountGroupPlanCapacity.createMany).toHaveBeenCalledWith({
      data: [
        { billedQuantity: 1, groupId: "hbag_family", planCode: "pulse" },
        { billedQuantity: 1, groupId: "hbag_family", planCode: "max" },
      ],
    });
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
      data: { billingStatus: HostedBillingStatus.active },
      where: { id: "hbag_family" },
    });
  });

  it("replays the exact Family upgrade wake without another tier transition", async () => {
    const tx = createTxMock();
    const eventCreatedAt = new Date("2026-07-15T12:30:00.000Z");
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      {
        id: "hbagm_owner",
        memberId: "member_owner",
        pendingPlanCode: null,
        planCode: "pulse",
        usagePlanTransitionAt: null,
        usagePlanTransitionFromCode: null,
        usagePlanTransitionKind: null,
        usagePlanTransitionToCode: null,
      },
      {
        id: "hbagm_mom",
        memberId: "member_mom",
        pendingPlanCode: null,
        planCode: "edge",
        usagePlanTransitionAt: eventCreatedAt,
        usagePlanTransitionFromCode: "launch_monthly",
        usagePlanTransitionKind: "plan_upgrade",
        usagePlanTransitionToCode: "launch_edge_monthly",
      },
    ]);
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 1, planCode: "pulse" },
      { billedQuantity: 1, planCode: "edge" },
    ]);

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: { eventCreatedAt },
      subscription: makeFamilyStripeSubscription({
        edgeItemQuantity: 1,
        itemQuantity: 1,
      }),
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      runtimeRecheckMemberIds: ["member_mom"],
    });

    expect(tx.hostedAccountGroupMembership.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ planCode: "edge" }),
      }),
    );
  });

  it("replays the exact active Family owner wake after the direct binding is cleared", async () => {
    const tx = createTxMock();
    const eventCreatedAt = new Date("2026-07-15T12:30:00.000Z");
    const billingRef = createBillingRefMock({
      lastStripeEventCreatedAt: eventCreatedAt,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(billingRef);
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([]);
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(null);

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: { eventCreatedAt },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      runtimeRecheckMemberIds: ["member_owner"],
    });

    expect(tx.hostedMember.update).not.toHaveBeenCalled();
    expect(tx.hostedMemberBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("replays the current active Family owner wake after a newer event", async () => {
    const tx = createTxMock();
    const eventCreatedAt = new Date("2026-07-15T12:30:00.000Z");
    const billingRef = createBillingRefMock({
      lastStripeEventCreatedAt: new Date("2026-07-15T12:31:00.000Z"),
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(billingRef);
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([]);
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(null);

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: { eventCreatedAt },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).resolves.toMatchObject({
      groupId: "hbag_family",
      runtimeRecheckMemberIds: ["member_owner"],
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(tx.hostedMember.update).not.toHaveBeenCalled();
    expect(tx.hostedMemberBillingRef.updateMany).not.toHaveBeenCalled();
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

  it("reconciles active Family billing while retaining a raced direct member for cleanup", async () => {
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
        { memberId: "member_mom" },
      ],
      groupId: "hbag_family",
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        billedSeatCount: 4,
      }),
    }));
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenCalledTimes(2);
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenNthCalledWith(1, {
      memberId: "member_owner",
      occurredAt: eventCreatedAt,
      preparedCryptoDomainRoots: new Map(),
      prisma: tx,
      sourceEventId: "family-subscription:sub_family",
    });
    expect(activationMocks.activateHostedMemberForFamilySponsorshipTx).toHaveBeenNthCalledWith(2, {
      memberId: "member_mom",
      occurredAt: eventCreatedAt,
      preparedCryptoDomainRoots: new Map(),
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

  it.each(["canceled", "incomplete_expired"] as const)(
    "releases the bound Family subscription after %s",
    async (terminalStatus) => {
      const tx = createTxMock();

      await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-06-18T12:30:00.000Z"),
        },
        subscription: makeFamilyStripeSubscription({
          status: terminalStatus,
        }),
        tx,
      })).resolves.toEqual({
        activations: [],
        billingModeChangedMemberIds: [],
        groupId: "hbag_family",
        runtimeRecheckMemberIds: [],
      });

      expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            billedSeatCount: null,
            currentBillingPhase: null,
            currentPeriodEnd: null,
            currentPeriodStart: null,
            stripeSubscriptionIdEncrypted: null,
            stripeSubscriptionItemIdEncrypted: null,
            stripeSubscriptionItemLookupKey: null,
            stripeSubscriptionLookupKey: null,
          }),
          update: expect.objectContaining({
            billedSeatCount: null,
            currentBillingPhase: null,
            currentPeriodEnd: null,
            currentPeriodStart: null,
            stripeSubscriptionIdEncrypted: null,
            stripeSubscriptionItemIdEncrypted: null,
            stripeSubscriptionItemLookupKey: null,
            stripeSubscriptionLookupKey: null,
          }),
        }),
      );
      expect(tx.hostedAccountGroup.update).toHaveBeenCalledWith({
        data: {
          billingStatus: HostedBillingStatus.canceled,
        },
        where: {
          id: "hbag_family",
        },
      });
      expect(tx.hostedAccountGroupPlanCapacity.deleteMany).toHaveBeenCalledWith({
        where: { groupId: "hbag_family" },
      });
    },
  );

  it("releases direct and Family retry when terminal state wins before active handoff", async () => {
    const terminalEventCreatedAt = new Date("2026-06-18T12:30:00.000Z");
    const group = {
      billingStatus: HostedBillingStatus.incomplete,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ group });
    let currentBillingRef = createBillingRefMock({
      group,
      lastStripeEventCreatedAt: new Date("2026-06-18T12:00:00.000Z"),
      stripeSubscriptionIdEncrypted: null,
    });
    let ownerBillingStatus = HostedBillingStatus.active;
    const directBillingRef = createMemberBillingRefMock({
      checkoutAttemptId: "attempt_A",
      checkoutCreatedAt: new Date("2026-06-18T11:55:00.000Z"),
      checkoutIntentHash: "intent_A",
      stripeCheckoutSessionIdEncrypted: "encrypted:cs_S",
      stripeCheckoutSessionLookupKey: "hbidx:stripe-checkout-session:v1:S",
      stripeCustomerIdEncrypted: "encrypted:cus_family",
      stripeSubscriptionIdEncrypted: "encrypted:sub_family",
    });
    tx.hostedAccountGroup.findUnique.mockImplementation(async () => ({
      ...group,
      owner: { suspendedAt: null },
    }));
    tx.hostedAccountGroup.update.mockImplementation(async ({ data }) => {
      Object.assign(group, data);
      return group;
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(
      async () => currentBillingRef,
    );
    tx.hostedAccountGroupBillingRef.findMany.mockImplementation(async ({ where }) => {
      if (
        where?.stripeSubscriptionLookupKey
        && !currentBillingRef.stripeSubscriptionIdEncrypted
      ) {
        return [];
      }
      return [currentBillingRef];
    });
    tx.hostedAccountGroupBillingRef.upsert.mockImplementation(
      async ({ create, update }) => {
        currentBillingRef = {
          ...currentBillingRef,
          ...(currentBillingRef ? update : create),
          group,
          groupId: group.id,
        };
        return currentBillingRef;
      },
    );
    tx.hostedMember.findUnique.mockImplementation(async () => ({
      billingRef: directBillingRef,
      billingStatus: ownerBillingStatus,
      suspendedAt: null,
    }));
    tx.hostedMember.update.mockImplementation(async ({ data }) => {
      ownerBillingStatus = data.billingStatus;
      return {
        billingStatus: ownerBillingStatus,
        id: group.ownerMemberId,
        suspendedAt: null,
      };
    });
    tx.hostedMemberBillingRef.findUnique.mockImplementation(
      async () => directBillingRef,
    );
    tx.hostedMemberBillingRef.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(directBillingRef, data);
      return { count: 1 };
    });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: { eventCreatedAt: terminalEventCreatedAt },
      subscription: makeFamilyStripeSubscription({
        status: "incomplete_expired",
      }),
      tx,
    })).resolves.toEqual({
      activations: [],
      billingModeChangedMemberIds: ["member_owner"],
      groupId: "hbag_family",
      runtimeRecheckMemberIds: ["member_owner"],
    });

    expect(group.billingStatus).toBe(HostedBillingStatus.canceled);
    expect(ownerBillingStatus).toBe(HostedBillingStatus.not_started);
    expect(currentBillingRef).toMatchObject({
      lastStripeEventCreatedAt: terminalEventCreatedAt,
      stripeSubscriptionIdEncrypted: null,
      stripeSubscriptionItemIdEncrypted: null,
    });
    expect(directBillingRef).toMatchObject({
      checkoutAttemptId: null,
      checkoutCreatedAt: null,
      checkoutIntentHash: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripeCustomerIdEncrypted: null,
      stripeCustomerLookupKey: null,
      stripeSubscriptionIdEncrypted: null,
      stripeSubscriptionLookupKey: null,
    });
    tx.hostedAccountGroup.findUnique.mockImplementation(async () => ({
      ...group,
      billingRef: {
        checkoutAttemptId: currentBillingRef.checkoutAttemptId,
        checkoutCreatedAt: currentBillingRef.checkoutCreatedAt,
        stripeSubscriptionIdEncrypted:
          currentBillingRef.stripeSubscriptionIdEncrypted,
      },
      owner: { suspendedAt: null },
    }));
    await expect(readHostedFamilyBillingRecoveryForOwner({
      ownerMemberId: group.ownerMemberId,
      prisma: tx,
    })).resolves.toBe("available");

    tx.hostedAccountGroupMembership.findMany.mockResolvedValueOnce([{
      group: {
        billingRef: {
          checkoutAttemptId: currentBillingRef.checkoutAttemptId,
          checkoutCreatedAt: currentBillingRef.checkoutCreatedAt,
          stripeSubscriptionIdEncrypted:
            currentBillingRef.stripeSubscriptionIdEncrypted,
        },
        billingStatus: group.billingStatus,
        id: group.id,
        ownerMemberId: group.ownerMemberId,
        suspendedAt: group.suspendedAt,
      },
    }]);
    await expect(readHostedMemberFamilyBillingClaim({
      memberId: "member_owner",
      prisma: tx,
    })).resolves.toBeNull();

    const groupWriteCount = tx.hostedAccountGroup.update.mock.calls.length;
    for (const eventCreatedAt of [
      new Date("2026-06-18T12:15:00.000Z"),
      terminalEventCreatedAt,
    ]) {
      await expect(applyHostedFamilyStripeCheckoutCompletedTx({
        dispatchContext: { eventCreatedAt },
        session: makeFamilyStripeCheckoutSession(),
        tx,
      })).resolves.toEqual({
        groupId: "hbag_family",
      });
    }
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledTimes(groupWriteCount);
    expect(currentBillingRef).toMatchObject({
      lastStripeEventCreatedAt: terminalEventCreatedAt,
      stripeSubscriptionIdEncrypted: null,
    });

    await expect(applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-06-18T12:15:00.000Z"),
      },
      subscription: makeFamilyStripeSubscription(),
      tx,
    })).resolves.toEqual({
      activations: [],
      groupId: "hbag_family",
      runtimeRecheckMemberIds: [],
    });
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledTimes(groupWriteCount);
    expect(tx.hostedMember.update).toHaveBeenCalledOnce();

    const checkoutCreate = vi.fn().mockResolvedValue({
      id: "cs_test_familyRecovery123",
      url: "https://checkout.stripe.com/c/pay/cs_test_familyRecovery123",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-06-18T12:31:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://local.withmurph.ai:3443/checkout/family/cs_test_familyRecovery123",
    });
    expect(checkoutCreate).toHaveBeenCalledOnce();
    await expect(readHostedFamilyBillingRecoveryForOwner({
      ownerMemberId: group.ownerMemberId,
      prisma: tx,
    })).resolves.toBe("checkout");
    await expect(readHostedFamilyBillingRecoveryForOwner({
      ownerMemberId: group.ownerMemberId,
      prisma: tx,
    })).resolves.toBe("checkout");
    currentBillingRef.stripeSubscriptionIdEncrypted = "encrypted:sub_family";
    await expect(readHostedFamilyBillingRecoveryForOwner({
      ownerMemberId: group.ownerMemberId,
      prisma: tx,
    })).resolves.toBe("syncing");
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

  it.each([
    HostedBillingStatus.incomplete,
    HostedBillingStatus.past_due,
    HostedBillingStatus.paused,
    HostedBillingStatus.unpaid,
  ])("offers Family billing management while an exact subscription is %s", async (billingStatus) => {
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce({
      billingRef: {
        checkoutAttemptId: null,
        stripeSubscriptionIdEncrypted: "encrypted:sub_family",
      },
      billingStatus,
      suspendedAt: null,
    });

    await expect(readHostedFamilyBillingRecoveryForOwner({
      ownerMemberId: "member_owner",
      prisma: tx,
    })).resolves.toBe("manage");
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
      .mockResolvedValueOnce({
        group: {
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          id: "hbag_other",
          ownerMemberId: "member_other_owner",
          suspendedAt: null,
        },
        role: "member",
      });

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
    tx.hostedAccountGroupMembership.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
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
      runtimeRecheckMemberIds: [],
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

  it("preserves an idempotent Family Checkout session when binding fails indeterminately", async () => {
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
    const bindError = new Error("binding result unavailable");
    let transactionCount = 0;
    prisma.$transaction = vi.fn(async (callback) => {
      transactionCount += 1;
      if (transactionCount === 2) {
        throw bindError;
      }
      return callback(tx);
    });
    const checkoutCreate = vi.fn().mockResolvedValue({
      id: "cs_test_familyRetry123",
      url: "https://checkout.stripe.com/c/pay/cs_test_familyRetry123",
    });
    const checkoutExpire = vi.fn();
    const checkoutRetrieve = vi.fn();
    const subscriptionCancel = vi.fn();
    const customerDelete = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          expire: checkoutExpire,
          retrieve: checkoutRetrieve,
        },
      },
      customers: {
        del: customerDelete,
      },
      subscriptions: {
        cancel: subscriptionCancel,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      now: new Date("2026-07-27T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toBe(bindError);

    expect(checkoutRetrieve).not.toHaveBeenCalled();
    expect(checkoutExpire).not.toHaveBeenCalled();
    expect(subscriptionCancel).not.toHaveBeenCalled();
    expect(customerDelete).not.toHaveBeenCalled();

    const firstUpsertInput = tx.hostedAccountGroupBillingRef.upsert.mock.calls[0]?.[0];
    const checkoutAttemptId = firstUpsertInput?.create?.checkoutAttemptId;
    if (typeof checkoutAttemptId !== "string") {
      throw new TypeError("Expected the first Family checkout attempt to be persisted.");
    }
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(createBillingRefMock({
      billedSeatCount: null,
      checkoutAttemptId,
      checkoutCreatedAt: new Date("2026-07-27T00:00:00.000Z"),
      checkoutSeatCount: 2,
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_family_monthly",
      group,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCustomerIdEncrypted: null,
      stripeSubscriptionIdEncrypted: null,
      stripeSubscriptionItemIdEncrypted: null,
    }));

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      now: new Date("2026-07-27T12:01:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://local.withmurph.ai:3443/checkout/family/cs_test_familyRetry123",
    });

    expect(checkoutCreate).toHaveBeenCalledTimes(2);
    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual(checkoutCreate.mock.calls[1]?.[1]);
    expect(checkoutExpire).not.toHaveBeenCalled();
  });

  it("preserves a completed subscription when a duplicate provider response binds late", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
    let billingRefState: ReturnType<typeof createBillingRefMock> | null = null;
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(
      async () => billingRefState,
    );
    tx.hostedAccountGroupBillingRef.upsert.mockImplementation(async ({ create }) => {
      billingRefState = createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: create.checkoutAttemptId,
        checkoutCreatedAt: create.checkoutCreatedAt,
        checkoutSeatCount: create.checkoutSeatCount,
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_family_monthly",
        group,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCustomerIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionItemIdEncrypted: null,
      });
      return billingRefState;
    });
    tx.hostedAccountGroupBillingRef.updateMany.mockImplementation(async ({ where }) => ({
      count: billingRefState?.checkoutAttemptId === where.checkoutAttemptId
        ? 1
        : 0,
    }));
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    let signalFirstCreate: (() => void) | undefined;
    const firstCreateStarted = new Promise<void>((resolve) => {
      signalFirstCreate = resolve;
    });
    let releaseFirstCreate: (() => void) | undefined;
    const firstCreateRelease = new Promise<void>((resolve) => {
      releaseFirstCreate = resolve;
    });
    let createCount = 0;
    let checkoutAttemptId: string | null = null;
    const checkoutCreate = vi.fn().mockImplementation(async (params) => {
      checkoutAttemptId = String(params.metadata?.checkoutAttemptId ?? "");
      const session = makeFamilyStripeCheckoutSession({
        checkoutAttemptId,
        sessionId: "cs_test_familyDuplicateBind123",
        status: "open",
        subscriptionId: null,
        url: "https://checkout.stripe.com/c/pay/cs_test_familyDuplicateBind123",
      });
      const callIndex = createCount;
      createCount += 1;
      if (callIndex === 0) {
        signalFirstCreate?.();
        await firstCreateRelease;
      }
      return session;
    });
    const checkoutRetrieve = vi.fn().mockImplementation(async () =>
      makeFamilyStripeCheckoutSession({
        checkoutAttemptId,
        sessionId: "cs_test_familyDuplicateBind123",
        status: "complete",
        subscriptionId: "sub_family_duplicate_bind",
        url: null,
      })
    );
    const checkoutExpire = vi.fn();
    const subscriptionRetrieve = vi.fn();
    const subscriptionCancel = vi.fn();
    const customerDelete = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          expire: checkoutExpire,
          retrieve: checkoutRetrieve,
        },
      },
      customers: {
        del: customerDelete,
      },
      subscriptions: {
        cancel: subscriptionCancel,
        retrieve: subscriptionRetrieve,
      },
    });

    const firstRequest = createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    });
    await firstCreateStarted;

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url:
        "https://local.withmurph.ai:3443/checkout/family/cs_test_familyDuplicateBind123",
    });

    billingRefState = createBillingRefMock({
      billedSeatCount: 2,
      checkoutAttemptId: null,
      checkoutCreatedAt: null,
      checkoutSeatCount: null,
      group: {
        ...group,
        billingStatus: HostedBillingStatus.active,
      },
      stripeCheckoutSessionIdEncrypted: null,
      stripeCustomerIdEncrypted: "encrypted:cus_family",
      stripeSubscriptionIdEncrypted: "encrypted:sub_family_duplicate_bind",
      stripeSubscriptionItemIdEncrypted: "encrypted:si_family_duplicate_bind",
    });
    releaseFirstCreate?.();

    await expect(firstRequest).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_ATTEMPT_STALE",
    });

    expect(checkoutCreate).toHaveBeenCalledTimes(2);
    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual(
      checkoutCreate.mock.calls[1]?.[1],
    );
    expect(checkoutRetrieve).toHaveBeenCalledOnce();
    expect(checkoutExpire).not.toHaveBeenCalled();
    expect(subscriptionRetrieve).not.toHaveBeenCalled();
    expect(subscriptionCancel).not.toHaveBeenCalled();
    expect(customerDelete).not.toHaveBeenCalled();
    expect(billingRefState).toMatchObject({
      checkoutAttemptId: null,
      stripeSubscriptionIdEncrypted: "encrypted:sub_family_duplicate_bind",
    });
  });

  it("expires a Family Checkout session when account deletion wins the owner fence", async () => {
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
    let transactionCount = 0;
    prisma.$transaction = vi.fn((callback) => {
      transactionCount += 1;
      if (transactionCount === 2) {
        tx.hostedMember.findUnique.mockResolvedValueOnce({
          suspendedAt: new Date("2026-07-27T00:00:00.000Z"),
        });
      }
      return callback(tx);
    });
    const checkoutExpire = vi.fn().mockResolvedValue({
      customer: null,
      status: "expired",
      subscription: null,
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: "cs_test_familyDelete123",
            url: "https://checkout.stripe.com/c/pay/cs_test_familyDelete123",
          }),
          expire: checkoutExpire,
          retrieve: vi.fn().mockResolvedValue({
            customer: null,
            status: "open",
            subscription: null,
          }),
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
    });

    expect(checkoutExpire).toHaveBeenCalledWith("cs_test_familyDelete123");
    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("expires a newly created Checkout when draft abandonment removes its claim before binding", async () => {
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
    tx.hostedAccountGroupBillingRef.updateMany.mockResolvedValueOnce({ count: 0 });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutExpire = vi.fn().mockResolvedValue({
      customer: null,
      status: "expired",
      subscription: null,
    });
    const checkoutRetrieve = vi.fn().mockResolvedValue({
      customer: null,
      status: "open",
      subscription: null,
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: "cs_test_familyDraftAbandoned123",
            url: "https://checkout.stripe.com/c/pay/cs_test_familyDraftAbandoned123",
          }),
          expire: checkoutExpire,
          retrieve: checkoutRetrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_ATTEMPT_STALE",
    });

    expect(checkoutRetrieve).toHaveBeenCalledWith(
      "cs_test_familyDraftAbandoned123",
    );
    expect(checkoutExpire).toHaveBeenCalledWith(
      "cs_test_familyDraftAbandoned123",
    );
  });

  it.each([
    {
      currentPlanCode: "launch_monthly" as const,
      currentPriceId: "price_pulse",
      label: "Pulse",
    },
    {
      currentPlanCode: "launch_max_monthly" as const,
      currentPriceId: "price_max",
      label: "Max",
    },
  ])("converts an active direct-paid $label owner subscription into Family billing without creating a second checkout", async ({
    currentPlanCode,
    currentPriceId,
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
      billingRef: {
        stripeSubscriptionIdEncrypted: "encrypted:sub_direct",
      },
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    });
    tx.hostedMemberBillingRef.findUnique.mockResolvedValue(createMemberBillingRefMock({
      currentBillingPlanCode: currentPlanCode,
    }));

    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn();
    const directSubscription = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 1,
      metadata: {
        billingPlanCode: currentPlanCode,
        checkoutOffer: "standard",
        memberId: "member_owner",
      },
      priceId: currentPriceId,
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
    await expect(createHostedFamilyBillingCheckout({
      allowDirectPaidUpgrade: false,
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED",
      httpStatus: 409,
    });
    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(subscriptionRetrieve).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();

    const result = await createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    });
    expect(result).toEqual({ alreadyActive: false, url: null });

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
      idempotencyKey: `hosted-family-direct-paid-upgrade:hbag_family:sub_direct:${currentPlanCode}:${currentPriceId}:price_family:seats-2`,
    });
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
    webhookTx.hostedMemberBillingRef.findUnique.mockResolvedValue(
      createMemberBillingRefMock({
        checkoutAttemptId: "attempt_A",
        checkoutCreatedAt: new Date("2026-07-14T11:55:00.000Z"),
        checkoutIntentHash: "intent_A",
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_S",
        stripeCheckoutSessionLookupKey: "hbidx:stripe-checkout-session:v1:S",
        stripeSubscriptionIdEncrypted: "encrypted:sub_direct",
      }),
    );
    const eventCreatedAt = new Date("2026-07-14T12:00:00.000Z");

    const reconciliation = await applyHostedFamilyStripeSubscriptionUpdatedTx({
      dispatchContext: { eventCreatedAt },
      subscription: updatedSubscription,
      tx: webhookTx,
    });
    expect(reconciliation).toMatchObject({
      billingModeChangedMemberIds: ["member_owner"],
      groupId: "hbag_family",
    });

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
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutIntentHash: null,
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
        stripeCustomerLookupKey: null,
        stripeSubscriptionLookupKey: null,
      }),
      where: {
        memberId: "member_owner",
      },
    }));
  });

  it("normalizes metadata on an already-applied direct-to-Family retry without rebuilding the obsolete direct item swap", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
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

    const alreadyApplied = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 2,
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_owner",
      },
      priceId: "price_family",
      subscriptionId: "sub_direct",
    });
    const normalized = makeFamilyStripeSubscription({
      customerId: "cus_direct",
      itemQuantity: 2,
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
        ownerMemberId: "member_owner",
      },
      priceId: "price_family",
      subscriptionId: "sub_direct",
    });
    const subscriptionUpdate = vi.fn().mockResolvedValue(normalized);
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(alreadyApplied),
        update: subscriptionUpdate,
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({ alreadyActive: false, url: null });

    expect(subscriptionUpdate).toHaveBeenCalledWith(
      "sub_direct",
      {
        expand: ["items.data.price"],
        metadata: expect.objectContaining({
          accountGroupId: "hbag_family",
          billingPlanCode: "launch_family_monthly",
          checkoutOffer: "",
          kind: "hosted_family_plan",
          ownerMemberId: "member_owner",
        }),
      },
      {
        idempotencyKey:
          "hosted-family-direct-paid-metadata:hbag_family:sub_direct",
      },
    );
    expect(subscriptionUpdate.mock.calls[0]?.[1]).not.toHaveProperty("items");
  });

  it("distinguishes direct-paid Family actions by their complete provider effect", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
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
    const fetchMock = stubFamilyStripeAlertEmailDelivery();
    const subscriptionRetrieve = vi.fn().mockRejectedValue(
      buildFamilyStripeConnectionErrorWithoutRequestId(),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: subscriptionRetrieve,
      },
    });

    for (const seatCount of [2, 3, 3]) {
      await expect(createHostedFamilyBillingCheckout({
        groupId: group.id,
        ownerMemberId: group.ownerMemberId,
        prisma: prisma as never,
        seatCount,
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_DIRECT_PAID_STRIPE_UNAVAILABLE",
      });
      await runOnlyScheduledFamilyStripeAlert();
      nextServerMocks.after.mockClear();
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(readResendIdempotencyKey(fetchMock, 0)).not.toBe(
      readResendIdempotencyKey(fetchMock, 1),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).not.toBe(
      fetchMock.mock.calls[1]?.[1]?.body,
    );
    expect(readResendIdempotencyKey(fetchMock, 1)).toBe(
      readResendIdempotencyKey(fetchMock, 2),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      fetchMock.mock.calls[2]?.[1]?.body,
    );
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
        checkoutCreatedAt: new Date("2026-07-28T11:00:00.000Z"),
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
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toMatchObject({
      alreadyActive: false,
    });

    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: expect.stringContaining(":hbfca_existing:"),
    });
    expect(checkoutCreate.mock.calls[0]?.[0]).toMatchObject({
      cancel_url: "https://local.withmurph.ai:3443/settings",
      success_url:
        "https://local.withmurph.ai:3443/join?family_checkout=success&session_id={CHECKOUT_SESSION_ID}",
    });
  });

  it("replays a Session-before-bind attempt with provider-identical neutral parameters", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const billingRef = {
      ...createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: "hbfca_existing",
        checkoutCreatedAt: new Date("2026-07-28T11:00:00.000Z"),
        checkoutSeatCount: 3,
        group,
        stripeCheckoutSessionIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(billingRef);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const sessionId = "cs_test_familyNeutralReplay123";
    const metadata = {
      accountGroupId: group.id,
      billingPlanCode: "launch_family_monthly",
      checkoutAttemptId: "hbfca_existing",
      kind: "hosted_family_plan",
      ownerMemberId: group.ownerMemberId,
    };
    const originalParams: Stripe.Checkout.SessionCreateParams = {
      cancel_url: "https://local.withmurph.ai:3443/settings",
      client_reference_id: group.id,
      customer: "cus_family",
      line_items: [{ price: "price_family", quantity: 3 }],
      metadata,
      mode: "subscription",
      payment_method_types: ["card"],
      subscription_data: { metadata },
      success_url:
        "https://local.withmurph.ai:3443/join?family_checkout=success&session_id={CHECKOUT_SESSION_ID}",
    };
    const replayedSession = makeFamilyStripeCheckoutSession({
      cancelUrl: originalParams.cancel_url,
      checkoutAttemptId: "hbfca_existing",
      sessionId,
      status: "open",
      subscriptionId: null,
      url: `https://checkout.stripe.com/c/pay/${sessionId}`,
    });
    const checkoutCreate = vi.fn().mockImplementation(async (params) => {
      if (!isDeepStrictEqual(params, originalParams)) {
        throw Object.assign(
          new Error("Keys for idempotent requests can only be used with the same parameters."),
          { type: "StripeIdempotencyError" },
        );
      }
      return replayedSession;
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      requiredCheckoutAttemptId: "hbfca_existing",
    })).resolves.toEqual({
      alreadyActive: false,
      url: `https://local.withmurph.ai:3443/checkout/family/${sessionId}`,
    });

    expect(checkoutCreate).toHaveBeenCalledOnce();
    expect(checkoutCreate.mock.calls[0]?.[0]).toMatchObject({
      cancel_url: "https://local.withmurph.ai:3443/settings",
    });
    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: expect.stringContaining(":hbfca_existing:"),
    });
    expect(JSON.stringify(checkoutCreate.mock.calls[0]?.[0])).not.toContain(
      "invite_return_target",
    );
    expect(JSON.stringify(replayedSession)).not.toContain("invite_return_target");
  });

  it("does not create a new Family attempt when invite recovery loses its existing claim", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(createHostedFamilyBillingCheckout({
      allowDirectPaidUpgrade: false,
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      requiredCheckoutAttemptId: "hbfca_existing",
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DRAFT_CHANGED",
      httpStatus: 409,
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("does not replay a replacement Family attempt during invite recovery", async () => {
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const replacementAttemptId = "hbfca_replacement";
    const tx = createTxMock({ billedSeatCount: null, group });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
      ...createBillingRefMock({
        checkoutAttemptId: replacementAttemptId,
        checkoutCreatedAt: new Date("2026-07-28T11:00:00.000Z"),
        checkoutSeatCount: 2,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn().mockResolvedValue(
      makeFamilyStripeCheckoutSession({
        cancelUrl: "https://local.withmurph.ai:3443/settings",
        checkoutAttemptId: replacementAttemptId,
        sessionId: "cs_test_replacement",
        status: "open",
        subscriptionId: null,
        url: "https://checkout.stripe.test/replacement",
      }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: { sessions: { create: checkoutCreate } },
    });

    await expect(createHostedFamilyBillingCheckout({
      allowDirectPaidUpgrade: false,
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      requiredCheckoutAttemptId: "hbfca_original",
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_DRAFT_CHANGED",
      httpStatus: 409,
    });

    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("retains a freshly bound Family Session past the attempt cutoff", async () => {
    const group = {
      billingStatus: HostedBillingStatus.canceled,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_existing",
        checkoutCreatedAt: new Date("2026-07-27T12:00:00.000Z"),
        checkoutSeatCount: 2,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_familyLate123",
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn().mockResolvedValue({
      id: "cs_test_familyRestart123",
      url: "https://checkout.stripe.com/c/pay/cs_test_familyRestart123",
    });
    const checkoutRetrieve = vi.fn().mockResolvedValue({
      ...makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_existing",
        sessionId: "cs_test_familyLate123",
        subscriptionId: null,
        url: "https://checkout.stripe.com/c/pay/cs_test_familyLate123",
      }),
      status: "open",
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          create: checkoutCreate,
          retrieve: checkoutRetrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://local.withmurph.ai:3443/checkout/family/cs_test_familyLate123",
    });

    expect(checkoutRetrieve).toHaveBeenCalledWith("cs_test_familyLate123");
    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("applies a completed bound Family Session instead of replacing it", async () => {
    const group = {
      billingStatus: HostedBillingStatus.canceled,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const billingRef = {
      ...createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: "hbfca_existing",
        checkoutCreatedAt: new Date("2026-07-27T12:00:00.000Z"),
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_familyComplete123",
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(billingRef);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn();
    const checkoutRetrieve = vi.fn().mockResolvedValue(
      makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_existing",
        sessionId: "cs_test_familyComplete123",
        status: "complete",
        subscriptionId: "sub_family_complete",
        url: null,
      }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          retrieve: checkoutRetrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: null,
    });

    expect(checkoutRetrieve).toHaveBeenCalledWith("cs_test_familyComplete123");
    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          checkoutAttemptId: null,
          stripeCheckoutSessionIdEncrypted: null,
          stripeSubscriptionIdEncrypted: "encrypted:sub_family_complete",
        }),
      }),
    );
  });

  it("does not rebind a completed Family Session after terminal reconciliation releases it", async () => {
    const group = {
      billingStatus: HostedBillingStatus.canceled,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    let billingRef = {
      ...createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: "hbfca_existing",
        checkoutCreatedAt: new Date("2026-07-27T12:00:00.000Z"),
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_familyComplete123",
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(
      async () => billingRef,
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn();
    const checkoutRetrieve = vi.fn().mockImplementation(async () => {
      billingRef = {
        ...billingRef,
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutSeatCount: null,
        lastStripeEventCreatedAt: new Date("2026-07-28T12:00:00.000Z"),
        stripeCheckoutSessionIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      };
      return makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_existing",
        sessionId: "cs_test_familyComplete123",
        status: "complete",
        subscriptionId: "sub_family_complete",
        url: null,
      });
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          retrieve: checkoutRetrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_ATTEMPT_STALE",
      httpStatus: 409,
      retryable: true,
    });

    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
    expect(billingRef).toMatchObject({
      checkoutAttemptId: null,
      lastStripeEventCreatedAt: new Date("2026-07-28T12:00:00.000Z"),
      stripeCheckoutSessionIdEncrypted: null,
      stripeSubscriptionIdEncrypted: null,
    });
  });

  it("does not downgrade active Family billing when reconciliation wins during Session retrieval", async () => {
    const group: {
      billingStatus: HostedBillingStatus;
      id: string;
      ownerMemberId: string;
      suspendedAt: Date | null;
    } = {
      billingStatus: HostedBillingStatus.canceled,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    let billingRef = {
      ...createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: "hbfca_existing",
        checkoutCreatedAt: new Date("2026-07-27T12:00:00.000Z"),
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_familyComplete123",
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(
      async () => billingRef,
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn();
    const checkoutRetrieve = vi.fn().mockImplementation(async () => {
      billingRef = {
        ...billingRef,
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutSeatCount: null,
        group: {
          ...group,
          billingStatus: HostedBillingStatus.active,
        },
        lastStripeEventCreatedAt: new Date("2026-07-28T12:00:00.000Z"),
        stripeCheckoutSessionIdEncrypted: null,
        stripeSubscriptionIdEncrypted: "encrypted:sub_family_complete",
      };
      return makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_existing",
        sessionId: "cs_test_familyComplete123",
        status: "complete",
        subscriptionId: "sub_family_complete",
        url: null,
      });
    });
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          retrieve: checkoutRetrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: null,
    });

    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(billingRef).toMatchObject({
      checkoutAttemptId: null,
      group: {
        billingStatus: HostedBillingStatus.active,
      },
      stripeCheckoutSessionIdEncrypted: null,
      stripeSubscriptionIdEncrypted: "encrypted:sub_family_complete",
    });
  });

  it("restarts only after Stripe proves the exact Family Session expired", async () => {
    const group = {
      billingStatus: HostedBillingStatus.canceled,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    let billingRef = {
      ...createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: "hbfca_expired",
        checkoutCreatedAt: new Date("2026-07-27T12:00:00.000Z"),
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_familyExpired123",
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(
      async () => billingRef,
    );
    tx.hostedAccountGroupBillingRef.updateMany.mockImplementation(
      async ({ data }) => {
        if (data.checkoutAttemptId === null) {
          billingRef = {
            ...billingRef,
            checkoutAttemptId: null,
            checkoutCreatedAt: null,
            checkoutSeatCount: null,
            stripeCheckoutSessionIdEncrypted: null,
          };
        }
        return { count: 1 };
      },
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const checkoutCreate = vi.fn().mockResolvedValue({
      id: "cs_test_familyRestart123",
      url: "https://checkout.stripe.com/c/pay/cs_test_familyRestart123",
    });
    const checkoutRetrieve = vi.fn().mockResolvedValue(
      makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_expired",
        sessionId: "cs_test_familyExpired123",
        status: "expired",
        subscriptionId: null,
        url: null,
      }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          retrieve: checkoutRetrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://local.withmurph.ai:3443/checkout/family/cs_test_familyRestart123",
    });

    expect(checkoutRetrieve).toHaveBeenCalledWith("cs_test_familyExpired123");
    expect(checkoutCreate).toHaveBeenCalledOnce();
    expect(checkoutCreate.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: expect.not.stringContaining(":hbfca_expired:"),
    });
    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          checkoutAttemptId: "hbfca_expired",
          groupId: group.id,
        }),
      }),
    );
    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledOnce();
  });

  it("rebinds a failed replacement Family checkout alert to the replacement attempt", async () => {
    const group = {
      billingStatus: HostedBillingStatus.canceled,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    let billingRef = {
      ...createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: "hbfca_expired",
        checkoutCreatedAt: new Date("2026-07-27T12:00:00.000Z"),
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_familyExpired123",
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
    tx.hostedAccountGroupBillingRef.findUnique.mockImplementation(
      async () => billingRef,
    );
    tx.hostedAccountGroupBillingRef.updateMany.mockImplementation(
      async ({ data }) => {
        if (data.checkoutAttemptId === null) {
          billingRef = {
            ...billingRef,
            checkoutAttemptId: null,
            checkoutCreatedAt: null,
            checkoutSeatCount: null,
            stripeCheckoutSessionIdEncrypted: null,
          };
        }
        return { count: 1 };
      },
    );
    tx.hostedAccountGroupBillingRef.upsert.mockImplementation(
      async ({ update }) => {
        billingRef = {
          ...billingRef,
          checkoutAttemptId: update.checkoutAttemptId,
          checkoutCreatedAt: update.checkoutCreatedAt,
          checkoutSeatCount: update.checkoutSeatCount,
          currentBillingPlanCode: update.currentBillingPlanCode,
          stripeCheckoutSessionIdEncrypted: null,
        };
        return billingRef;
      },
    );
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const fetchMock = stubFamilyStripeAlertEmailDelivery();
    const checkoutCreate = vi.fn().mockRejectedValue(
      buildFamilyStripeConnectionErrorWithoutRequestId(),
    );
    const checkoutRetrieve = vi.fn().mockResolvedValue(
      makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_expired",
        sessionId: "cs_test_familyExpired123",
        status: "expired",
        subscriptionId: null,
        url: null,
      }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: checkoutCreate,
          retrieve: checkoutRetrieve,
        },
      },
    });

    const checkoutInput = {
      groupId: group.id,
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: group.ownerMemberId,
      prisma: prisma as never,
      seatCount: 2,
    };
    await expect(createHostedFamilyBillingCheckout(checkoutInput))
      .rejects.toBeTruthy();
    const replacementAttemptId = billingRef.checkoutAttemptId;
    expect(replacementAttemptId).not.toBe("hbfca_expired");
    expect(replacementAttemptId).toMatch(/^hbfca_/u);
    await runOnlyScheduledFamilyStripeAlert();
    nextServerMocks.after.mockClear();

    await expect(createHostedFamilyBillingCheckout(checkoutInput))
      .rejects.toBeTruthy();
    expect(billingRef.checkoutAttemptId).toBe(replacementAttemptId);
    await runOnlyScheduledFamilyStripeAlert();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readResendIdempotencyKey(fetchMock, 0)).toBe(
      readResendIdempotencyKey(fetchMock, 1),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      fetchMock.mock.calls[1]?.[1]?.body,
    );
  });

  it("fails closed for a stale unbound Family attempt", async () => {
    const group = {
      billingStatus: HostedBillingStatus.canceled,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
      ...createBillingRefMock({
        billedSeatCount: null,
        checkoutAttemptId: "hbfca_ambiguous",
        checkoutCreatedAt: new Date("2026-07-27T11:59:59.999Z"),
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: null,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(createHostedFamilyBillingCheckout({
      groupId: group.id,
      now: new Date("2026-07-28T12:00:00.000Z"),
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
    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a delivered Family Checkout owned when Session retrieval fails", async () => {
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_existing",
        checkoutCreatedAt: new Date("2026-07-28T11:00:00.000Z"),
        checkoutSeatCount: 2,
        stripeCheckoutSessionIdEncrypted: "encrypted:cs_test_delivered123",
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv(
      "HOSTED_LINQ_ALERT_EMAIL_FROM",
      "Murph Alerts <alerts@example.com>",
    );
    vi.stubEnv("HOSTED_LINQ_ALERT_EMAILS", "operator@example.com");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ id: "email_family_failure" }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const retrievalError = Object.assign(
      new Error("Stripe Session retrieval unavailable"),
      {
        rawType: "api_connection_error",
        requestId: "req_family_checkout_failed",
        statusCode: 503,
        type: "StripeConnectionError",
      },
    );
    const checkoutCreate = vi.fn();
    const checkoutRetrieve = vi.fn().mockRejectedValue(retrievalError);
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          create: checkoutCreate,
          retrieve: checkoutRetrieve,
        },
      },
    });

    await expect(createHostedFamilyBillingCheckout({
      groupId: "hbag_family",
      now: new Date("2026-07-28T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      seatCount: 2,
    })).rejects.toBe(retrievalError);

    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
    await nextServerMocks.after.mock.calls[0]?.[0]?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)))
      .toMatchObject({
        subject: "Murph Stripe operation failed — family.billing.checkout",
      });
    expect(checkoutRetrieve).toHaveBeenCalledWith("cs_test_delivered123");
    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
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
        checkoutCreatedAt: new Date("2026-07-28T11:00:00.000Z"),
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
      now: new Date("2026-07-28T12:00:00.000Z"),
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

  it("does not bind Family Stripe identifiers after the owner is suspended", async () => {
    const tx = createTxMock();
    tx.hostedAccountGroup.findUnique
      .mockResolvedValueOnce(createPendingInvite().group)
      .mockResolvedValueOnce({
        owner: {
          suspendedAt: new Date("2026-06-18T12:29:00.000Z"),
        },
        suspendedAt: null,
      });

    await expect(writeHostedAccountGroupStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      groupId: "hbag_family",
      stripeCustomerId: "cus_family",
      stripeSubscriptionId: "sub_family",
      tx,
    })).resolves.toBeNull();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
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

  it("alerts for a provider failure that blocks a currently bound Family redirect", async () => {
    const sessionId = "cs_test_familyRedirectFailure123";
    const tx = createTxMock({ billedSeatCount: null });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
      checkoutAttemptId: "hbfca_redirect_current",
    });
    const retrieve = vi.fn().mockRejectedValue(
      buildFamilyStripeConnectionErrorWithoutRequestId(),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: { sessions: { retrieve } },
    });
    const fetchMock = stubFamilyStripeAlertEmailDelivery();
    const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(resolveHostedFamilyCheckoutRedirectUrl({
        prisma: tx as never,
        sessionId,
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_CHECKOUT_SESSION_UNAVAILABLE",
        httpStatus: 409,
        retryable: true,
      });
      await runOnlyScheduledFamilyStripeAlert();
      if (attempt === 0) {
        nextServerMocks.after.mockClear();
      }
    }
    consoleErrorMock.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readResendIdempotencyKey(fetchMock, 0)).toBe(
      readResendIdempotencyKey(fetchMock, 1),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      fetchMock.mock.calls[1]?.[1]?.body,
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "family.billing.checkout-redirect",
    );
    expect(tx.hostedAccountGroupBillingRef.findUnique).toHaveBeenCalledWith({
      select: { checkoutAttemptId: true },
      where: {
        stripeCheckoutSessionLookupKey: expect.stringMatching(
          /^hbidx:stripe-checkout-session:v1:/u,
        ),
      },
    });
  });

  it("keeps an unbound Family redirect provider failure alert-silent", async () => {
    const sessionId = "cs_test_familyRedirectUnknown123";
    const tx = createTxMock({ billedSeatCount: null });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(null);
    const retrieve = vi.fn().mockRejectedValue(
      buildFamilyStripeConnectionErrorWithoutRequestId(),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: { sessions: { retrieve } },
    });
    const fetchMock = stubFamilyStripeAlertEmailDelivery();
    const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );

    await expect(resolveHostedFamilyCheckoutRedirectUrl({
      prisma: tx as never,
      sessionId,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_UNAVAILABLE",
      httpStatus: 409,
      retryable: true,
    });
    consoleErrorMock.mockRestore();

    expect(nextServerMocks.after).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates an exact invite return on a current Family redirect", async () => {
    const sessionId = "cs_test_familyRedirectOpen123";
    const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;
    const group = {
      billingStatus: HostedBillingStatus.not_started,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({ billedSeatCount: null, group });
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_redirect_current",
        checkoutSeatCount: 2,
        group,
        stripeCheckoutSessionIdEncrypted: `encrypted:${sessionId}`,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const retrieve = vi.fn().mockResolvedValue(makeFamilyStripeCheckoutSession({
      checkoutAttemptId: "hbfca_redirect_current",
      sessionId,
      status: "open",
      subscriptionId: null,
      url: checkoutUrl,
    }));
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: { sessions: { retrieve } },
    });

    await expect(resolveHostedFamilyCheckoutRedirectUrl({
      prisma: tx as never,
      sessionId,
    })).resolves.toBe(checkoutUrl);

    expect(nextServerMocks.after).not.toHaveBeenCalled();
  });

  it("routes a completed URL-less Family Session to verified success without clearing it", async () => {
    const sessionId = "cs_test_unavailable123";
    const checkoutCreatedAt = new Date("2026-07-28T12:00:00.000Z");
    const group = {
      billingStatus: HostedBillingStatus.canceled,
      id: "hbag_family",
      ownerMemberId: "member_owner",
      suspendedAt: null,
    };
    const tx = createTxMock({
      billedSeatCount: null,
      group,
    });
    const pendingBillingRef = {
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_current",
        checkoutCreatedAt,
        checkoutSeatCount: 2,
        stripeCheckoutSessionIdEncrypted: `encrypted:${sessionId}`,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    };
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue(
      pendingBillingRef,
    );
    const completedSession = makeFamilyStripeCheckoutSession({
      checkoutAttemptId: "hbfca_current",
      sessionId,
      subscriptionId: null,
      url: null,
    });
    const retrieve = vi.fn().mockResolvedValue(completedSession);
    const create = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValueOnce({
      checkout: {
        sessions: {
          create,
          retrieve,
        },
      },
    });

    await expect(resolveHostedFamilyCheckoutRedirectUrl({
      prisma: tx as never,
      sessionId,
    })).resolves.toBe(
      `https://local.withmurph.ai:3443/join?family_checkout=success&session_id=${sessionId}`,
    );

    await expect(applyStripeCheckoutCompleted(
      completedSession,
      tx,
      {
        eventCreatedAt: new Date("2026-07-28T12:01:00.000Z"),
        occurredAt: "2026-07-28T12:01:00.000Z",
        sourceEventId: "checkout.session:cs_test_unavailable123",
        sourceType: "stripe.checkout.session.completed",
      },
    )).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.upsert).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroup.update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    tx.hostedAccountGroup.findUnique.mockResolvedValueOnce({
      ...group,
      billingRef: {
        checkoutAttemptId: pendingBillingRef.checkoutAttemptId,
        checkoutCreatedAt: pendingBillingRef.checkoutCreatedAt,
        stripeSubscriptionIdEncrypted:
          pendingBillingRef.stripeSubscriptionIdEncrypted,
      },
      owner: { suspendedAt: null },
    });
    await expect(readHostedFamilyBillingRecoveryForOwner({
      ownerMemberId: group.ownerMemberId,
      prisma: tx,
    })).resolves.toBe("checkout");

    await expect(applyStripeCheckoutCompleted(
      makeFamilyStripeCheckoutSession({
        checkoutAttemptId: "hbfca_current",
        sessionId,
        subscriptionId: "sub_family",
        url: null,
      }),
      tx,
      {
        eventCreatedAt: new Date("2026-07-28T12:02:00.000Z"),
        occurredAt: "2026-07-28T12:02:00.000Z",
        sourceEventId: "checkout.session:cs_test_unavailable123",
        sourceType: "stripe.checkout.session.completed",
      },
    )).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(tx.hostedAccountGroupBillingRef.upsert).toHaveBeenCalledOnce();
    expect(tx.hostedAccountGroup.update).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("clears only an exact Stripe-expired Family checkout session", async () => {
    const sessionId = "cs_test_expired123";
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
      ...createBillingRefMock({
        checkoutAttemptId: "hbfca_current",
        checkoutSeatCount: 2,
        stripeCheckoutSessionIdEncrypted: `encrypted:${sessionId}`,
        stripeSubscriptionIdEncrypted: null,
      }),
      group,
    });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const retrieve = vi.fn().mockResolvedValue(makeFamilyStripeCheckoutSession({
      checkoutAttemptId: "hbfca_current",
      sessionId,
      status: "expired",
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
      prisma: prisma as never,
      sessionId,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_UNAVAILABLE",
      httpStatus: 410,
    });

    expect(tx.hostedAccountGroupBillingRef.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          checkoutAttemptId: "hbfca_current",
          groupId: "hbag_family",
          stripeCheckoutSessionLookupKey: expect.stringMatching(
            /^hbidx:stripe-checkout-session:v1:/u,
          ),
        }),
      }),
    );
  });

  it("preserves an open Family checkout claim when Stripe omits its URL", async () => {
    const sessionId = "cs_test_openMissingUrl123";
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
    tx.hostedAccountGroupBillingRef.findUnique.mockResolvedValue({
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
      status: "open",
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
      httpStatus: 409,
      retryable: true,
    });

    expect(tx.hostedAccountGroupBillingRef.updateMany).not.toHaveBeenCalled();
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
      targetCapacities: { edge: 2, max: 0, pulse: 1 },
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(stripeSubscriptionRetrieve).toHaveBeenCalledWith("sub_family", {
      expand: ["items.data.price"],
    });
    expect(stripeSubscriptionUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        expand: ["items.data.price"],
        items: [
          { id: "si_family", quantity: 1 },
          { price: "price_family_edge", quantity: 2 },
        ],
        payment_behavior: "error_if_incomplete",
        proration_behavior: "always_invoice",
      }),
      {
        idempotencyKey: expect.stringMatching(
          /^family-capacity:hbag_family:[0-9]+:1:2:0$/u,
        ),
      },
    );
    expect(tx.hostedAccountGroupPlanCapacity.createMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupPlanCapacity.deleteMany).not.toHaveBeenCalled();
    expect(tx.hostedAccountGroupBillingRef.update).not.toHaveBeenCalled();
    expect(nextServerMocks.after).not.toHaveBeenCalled();
  });

  it("revalidates an automatic-seat invite target under the capacity owner lock", async () => {
    const tx = createTxMock({
      activeMembershipCount: 2,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
      { memberId: "member_target", planCode: "pulse" },
    ]);
    tx.hostedAccountGroupMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "hbagm_target" });
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));

    await expect(updateHostedFamilyPlanCapacities({
      autoSeatInviteTarget: {
        targetEmail: "target@example.test",
        targetPhoneNumber: null,
      },
      groupId: "hbag_family",
      now: new Date("2026-08-10T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 0, max: 0, pulse: 3 },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_IN_GROUP",
    });

    expect(tx.hostedAccountGroupMembership.findFirst).toHaveBeenLastCalledWith({
      select: { id: true },
      where: {
        groupId: "hbag_family",
        member: {
          OR: [
            {
              emailAuthorization: {
                verifiedEmailLookupKey: {
                  in: expect.arrayContaining([
                    expect.stringMatching(/^hbidx:email:/u),
                  ]),
                },
                verifiedEmailVerifiedAt: { not: null },
              },
            },
          ],
        },
        status: "active",
      },
    });
    expect(runtimeMocks.requireHostedStripeApi).not.toHaveBeenCalled();
  });

  it("lets an active Family owner with a separate direct trial add capacity", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 2,
      pendingInviteCount: 0,
    });
    tx.hostedMember.findUnique.mockResolvedValue({
      billingRef: {
        currentBillingPhase: "trial",
        stripeSubscriptionIdEncrypted: "encrypted:sub_direct_trial",
      },
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
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
      makeFamilyStripeSubscription({ itemQuantity: 3 }),
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
      targetCapacities: { edge: 0, pulse: 3 },
    })).resolves.toMatchObject({
      groupId: "hbag_family",
    });

    expect(stripeSubscriptionRetrieve).toHaveBeenCalledWith("sub_family", {
      expand: ["items.data.price"],
    });
    expect(stripeSubscriptionUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        items: [{ id: "si_family", quantity: 3 }],
        payment_behavior: "error_if_incomplete",
        proration_behavior: "always_invoice",
      }),
      expect.any(Object),
    );
  });

  it("alerts for request-id-free Family capacity failures with stable effect identity", async () => {
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
    const providerError = buildFamilyStripeConnectionErrorWithoutRequestId();
    const stripeSubscriptionRetrieve = vi.fn().mockRejectedValue(providerError);
    const stripeSubscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: stripeSubscriptionRetrieve,
        update: stripeSubscriptionUpdate,
      },
    });
    const fetchMock = stubFamilyStripeAlertEmailDelivery();
    const input = {
      groupId: "hbag_family",
      now: new Date("2026-06-18T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 2, max: 0, pulse: 1 },
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(updateHostedFamilyPlanCapacities(input)).rejects.toBe(providerError);
      await runOnlyScheduledFamilyStripeAlert();
      if (attempt === 0) {
        nextServerMocks.after.mockClear();
      }
    }

    expect(stripeSubscriptionRetrieve).toHaveBeenCalledTimes(2);
    expect(stripeSubscriptionUpdate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readResendIdempotencyKey(fetchMock, 0)).toBe(
      readResendIdempotencyKey(fetchMock, 1),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      fetchMock.mock.calls[1]?.[1]?.body,
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "family.billing.capacity",
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("member_owner");
  });

  it("keeps an already-applied Family capacity update alert-silent", async () => {
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
    const stripeSubscriptionUpdate = vi.fn();
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(
          makeFamilyStripeSubscription({ edgeItemQuantity: 2, itemQuantity: 1 }),
        ),
        update: stripeSubscriptionUpdate,
      },
    });

    await expect(updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      now: new Date("2026-06-18T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 2, max: 0, pulse: 1 },
    })).resolves.toMatchObject({ groupId: "hbag_family" });

    expect(stripeSubscriptionUpdate).not.toHaveBeenCalled();
    expect(nextServerMocks.after).not.toHaveBeenCalled();
  });

  it("invoices a Family capacity reduction instead of silently discarding proration", async () => {
    const tx = createTxMock({
      activeMembershipCount: 1,
      billedSeatCount: 4,
      pendingInviteCount: 0,
    });
    tx.hostedAccountGroupMembership.findMany.mockResolvedValue([
      { memberId: "member_owner", planCode: "pulse" },
    ]);
    tx.hostedAccountGroupPlanCapacity.findMany.mockResolvedValue([
      { billedQuantity: 2, planCode: "pulse" },
      { billedQuantity: 2, planCode: "edge" },
    ]);
    const prisma = tx as FamilyPlanTxMock & {
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.$transaction = vi.fn((callback) => callback(tx));
    const stripeSubscriptionUpdate = vi.fn().mockResolvedValue(
      makeFamilyStripeSubscription({
        edgeItemQuantity: 1,
        itemQuantity: 1,
      }),
    );
    runtimeMocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(
          makeFamilyStripeSubscription({
            edgeItemQuantity: 2,
            itemQuantity: 2,
          }),
        ),
        update: stripeSubscriptionUpdate,
      },
    });

    await updateHostedFamilyPlanCapacities({
      groupId: "hbag_family",
      now: new Date("2026-06-18T12:00:00.000Z"),
      ownerMemberId: "member_owner",
      prisma: prisma as never,
      targetCapacities: { edge: 1, max: 0, pulse: 1 },
    });

    expect(stripeSubscriptionUpdate).toHaveBeenCalledWith(
      "sub_family",
      expect.objectContaining({
        items: [
          { id: "si_family", quantity: 1 },
          { id: "si_family_edge", quantity: 1 },
        ],
        proration_behavior: "always_invoice",
      }),
      expect.any(Object),
    );
    const updateParams = stripeSubscriptionUpdate.mock.calls[0]?.[1];
    expect(updateParams).not.toHaveProperty("payment_behavior");
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
        targetCapacities: { edge: 2, max: 0, pulse: 4 },
      }),
      updateHostedFamilyPlanCapacities({
        groupId: "hbag_family",
        now: new Date("2026-06-18T12:00:00.000Z"),
        ownerMemberId: "member_owner",
        prisma: prisma as never,
        targetCapacities: { edge: 3, max: 0, pulse: 3 },
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
      targetCapacities: { edge: 1, max: 0, pulse: 2 },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_PLAN_SYNCING",
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

function stubFamilyStripeAlertEmailDelivery() {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv(
    "HOSTED_LINQ_ALERT_EMAIL_FROM",
    "Murph Alerts <alerts@example.com>",
  );
  vi.stubEnv("HOSTED_LINQ_ALERT_EMAILS", "operator@example.com");
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify({ id: "email_family_failure" }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200,
    },
  ));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function buildFamilyStripeConnectionErrorWithoutRequestId() {
  return Object.assign(new Error("Stripe API unavailable"), {
    code: "api_connection_error",
    rawType: "api_connection_error",
    statusCode: 503,
    type: "StripeConnectionError",
  });
}

async function runOnlyScheduledFamilyStripeAlert(): Promise<void> {
  expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
  const task = nextServerMocks.after.mock.calls[0]?.[0];
  expect(task).toBeTypeOf("function");
  await task?.();
}

function readResendIdempotencyKey(
  fetchMock: ReturnType<typeof stubFamilyStripeAlertEmailDelivery>,
  callIndex: number,
): string | null {
  return new Headers(fetchMock.mock.calls[callIndex]?.[1]?.headers)
    .get("Idempotency-Key");
}

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
    updatedAt: overrides.updatedAt ?? new Date("2026-06-18T12:00:00.000Z"),
  };
}

function createMemberBillingRefMock(overrides: Partial<{
  checkoutAttemptId: string | null;
  checkoutCreatedAt: Date | null;
  checkoutIntentHash: string | null;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  stripeCheckoutSessionIdEncrypted: string | null;
  stripeCheckoutSessionLookupKey: string | null;
  stripeCustomerIdEncrypted: string | null;
  stripeSubscriptionIdEncrypted: string | null;
}> = {}) {
  return {
    checkoutAttemptId: overrides.checkoutAttemptId ?? null,
    checkoutCreatedAt: overrides.checkoutCreatedAt ?? null,
    checkoutIntentHash: overrides.checkoutIntentHash ?? null,
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
    stripeCheckoutSessionIdEncrypted:
      overrides.stripeCheckoutSessionIdEncrypted ?? null,
    stripeCheckoutSessionLookupKey:
      overrides.stripeCheckoutSessionLookupKey ?? null,
    stripeCustomerIdEncrypted: overrides.stripeCustomerIdEncrypted ?? "encrypted:cus_direct",
    stripeCustomerLookupKey: "hbidx:stripe-customer:v1:direct",
    stripeSubscriptionIdEncrypted: overrides.stripeSubscriptionIdEncrypted ?? "encrypted:sub_direct",
    stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:direct",
    stripeSubscriptionScheduleIdEncrypted: null,
    stripeSubscriptionScheduleLookupKey: null,
  };
}

function createNeverPaidFamilyDraftRecord(input: {
  checkoutAttemptId?: string | null;
  checkoutCreatedAt?: Date | null;
  checkoutSeatCount?: number | null;
  groupId?: string;
  invites?: Array<{ id: string }>;
  memberships?: Array<{
    memberId: string;
    role: string;
    status: string;
  }>;
  ownerMemberId?: string;
  planCapacities?: Array<{ groupId: string }>;
  stripeCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  suspendedAt?: Date | null;
} = {}) {
  const groupId = input.groupId ?? "hbag_draft";
  const ownerMemberId = input.ownerMemberId ?? "member_mom";
  const stripeCheckoutSessionId = input.stripeCheckoutSessionId ?? null;
  const stripeSubscriptionId = input.stripeSubscriptionId ?? null;
  return {
    billingRef: {
      billedSeatCount: null,
      checkoutAttemptId: input.checkoutAttemptId ?? null,
      checkoutCreatedAt: input.checkoutCreatedAt ?? null,
      checkoutSeatCount: input.checkoutSeatCount ?? null,
      currentBillingPhase: null,
      currentPeriodEnd: null,
      currentPeriodStart: null,
      lastStripeEventCreatedAt: null,
      stripeCheckoutSessionIdEncrypted: stripeCheckoutSessionId
        ? `encrypted:${stripeCheckoutSessionId}`
        : null,
      stripeCheckoutSessionLookupKey:
        createHostedStripeCheckoutSessionLookupKey(stripeCheckoutSessionId),
      stripeCustomerIdEncrypted: null,
      stripeCustomerLookupKey: null,
      stripeSubscriptionIdEncrypted: stripeSubscriptionId
        ? `encrypted:${stripeSubscriptionId}`
        : null,
      stripeSubscriptionItemIdEncrypted: null,
      stripeSubscriptionItemLookupKey: null,
      stripeSubscriptionLookupKey: stripeSubscriptionId
        ? `subscription-lookup:${stripeSubscriptionId}`
        : null,
    },
    billingStatus: HostedBillingStatus.not_started,
    id: groupId,
    invites: input.invites ?? [],
    memberships: input.memberships ?? [{
      memberId: ownerMemberId,
      role: "owner",
      status: "active",
    }],
    ownerMemberId,
    planCapacities: input.planCapacities ?? [],
    suspendedAt: input.suspendedAt ?? null,
  };
}

function createNeverPaidFamilyDraftMembership(input: {
  checkoutAttemptId?: string | null;
  groupId?: string;
  ownerMemberId?: string;
  stripeCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
} = {}) {
  const groupId = input.groupId ?? "hbag_draft";
  const ownerMemberId = input.ownerMemberId ?? "member_mom";
  const stripeCheckoutSessionId = input.stripeCheckoutSessionId ?? null;
  const stripeSubscriptionId = input.stripeSubscriptionId ?? null;
  return {
    group: {
      billingRef: {
        checkoutAttemptId: input.checkoutAttemptId ?? null,
        stripeCheckoutSessionLookupKey:
          createHostedStripeCheckoutSessionLookupKey(stripeCheckoutSessionId),
        stripeSubscriptionIdEncrypted: stripeSubscriptionId
          ? `encrypted:${stripeSubscriptionId}`
          : null,
      },
      billingStatus: HostedBillingStatus.not_started,
      id: groupId,
      ownerMemberId,
      suspendedAt: null,
    },
    role: "owner",
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
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(group),
      findUnique: vi.fn().mockResolvedValue({
        ...group,
        owner: {
          suspendedAt: null,
        },
      }),
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
        { memberId: "member_owner", planCode: "pulse", role: "owner" },
        { memberId: "member_mom", planCode: "pulse", role: "member" },
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

function makeFamilyStripeCheckoutSession(input: {
  cancelUrl?: string | null;
  checkoutAttemptId?: string | null;
  sessionId?: string;
  status?: Stripe.Checkout.Session["status"];
  subscriptionId?: string | null;
  url?: string | null;
} = {}): Stripe.Checkout.Session {
  const sessionId = input.sessionId ?? "cs_test_family123";

  const session: Partial<Stripe.Checkout.Session> = {
    cancel_url: input.cancelUrl === undefined
      ? "https://local.withmurph.ai:3443/settings"
      : input.cancelUrl,
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
    status: input.status ?? "complete",
    subscription: input.subscriptionId === undefined ? "sub_family" : input.subscriptionId,
    url: input.url === undefined
      ? "https://checkout.stripe.com/c/pay/cs_test_family123"
      : input.url,
  };

  return session as Stripe.Checkout.Session;
}

function makeFamilyDraftStripeCheckoutSession(input: {
  checkoutAttemptId: string;
  groupId?: string;
  ownerMemberId?: string;
  sessionId?: string;
  status: Stripe.Checkout.Session["status"];
  subscriptionId?: string | null;
}): Stripe.Checkout.Session {
  const session = makeFamilyStripeCheckoutSession({
    checkoutAttemptId: input.checkoutAttemptId,
    sessionId: input.sessionId,
    status: input.status,
    subscriptionId: input.subscriptionId,
  });
  return {
    ...session,
    metadata: {
      ...(session.metadata ?? {}),
      accountGroupId: input.groupId ?? "hbag_draft",
      ownerMemberId: input.ownerMemberId ?? "member_mom",
    },
  };
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

function makeFamilyStripeSubscription(input: {
  cancelAt?: number | null;
  cancelAtPeriodEnd?: boolean;
  collectionMethod?: Stripe.Subscription["collection_method"];
  customerId?: string;
  duplicateFamilyItems?: boolean;
  edgeItemQuantity?: number;
  itemQuantity?: number;
  maxItemQuantity?: number;
  metadata?: Stripe.Metadata;
  pauseCollection?: Stripe.Subscription["pause_collection"];
  pendingUpdate?: Stripe.Subscription["pending_update"];
  periodLocation?: "subscription" | "subscription_item";
  priceId?: string;
  schedule?: string | null;
  status?: Stripe.Subscription.Status;
  subscriptionId?: string;
} = {}): Stripe.Subscription {
  const subscriptionId = input.subscriptionId ?? "sub_family";
  const priceId = input.priceId ?? "price_family";
  const periodOnSubscriptionItem = input.periodLocation === "subscription_item";
  const familyItem = {
    id: "si_family",
    quantity: input.itemQuantity ?? 4,
    price: {
      currency: "usd",
      id: priceId,
      recurring: {
        interval: "month",
        interval_count: 1,
        meter: null,
        trial_period_days: null,
        usage_type: "licensed",
      },
    },
    ...(periodOnSubscriptionItem
      ? {
          current_period_end: FAMILY_STRIPE_PERIOD_END_SECONDS,
          current_period_start: FAMILY_STRIPE_PERIOD_START_SECONDS,
        }
      : {}),
  } as Stripe.SubscriptionItem;
  const edgeItem = {
    ...familyItem,
    id: "si_family_edge",
    price: {
      ...familyItem.price,
      id: "price_family_edge",
    },
    quantity: input.edgeItemQuantity,
  } as Stripe.SubscriptionItem;
  const maxItem = {
    ...familyItem,
    id: "si_family_max",
    price: {
      ...familyItem.price,
      id: "price_family_max",
    },
    quantity: input.maxItemQuantity,
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
    cancel_at: input.cancelAt ?? null,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    canceled_at: null,
    cancellation_details: null,
    collection_method: input.collectionMethod ?? "charge_automatically",
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
        : [
            familyItem,
            ...(input.edgeItemQuantity === undefined ? [] : [edgeItem]),
            ...(input.maxItemQuantity === undefined ? [] : [maxItem]),
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
    pause_collection: input.pauseCollection ?? null,
    payment_settings: null,
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: input.pendingUpdate ?? null,
    schedule: input.schedule ?? null,
    start_date: 1_771_948_800,
    status: input.status ?? "active",
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
  planCode: "edge" | "max" | "pulse";
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
