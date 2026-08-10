import { HostedBillingStatus, HostedStripeEventStatus, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import type {
  HostedMemberBillingSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  HostedStripeCheckoutLoserCleanupPendingError,
} from "@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const nextServerMocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
}));

vi.mock("next/server", () => ({
  after: nextServerMocks.after,
}));

const mocks = vi.hoisted(() => ({
  applyStripeCheckoutCompleted: vi.fn(),
  applyStripeCheckoutExpired: vi.fn(),
  applyStripeDisputeUpdated: vi.fn(),
  applyStripeInvoicePaid: vi.fn(),
  applyStripeInvoicePaymentFailed: vi.fn(),
  applyStripeRefundCreated: vi.fn(),
  applyStripeSubscriptionUpdated: vi.fn(),
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  cleanupHostedFamilySponsoredDirectSubscription: vi.fn(),
  cancelHostedPulseTrialCheckoutLoserSubscription: vi.fn(),
  clearHostedMemberStripeCheckoutAttemptForSessionTx: vi.fn(),
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  findMemberForStripeReversal: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  listHostedStripeCheckoutSessionMemberIds: vi.fn(),
  lookupHostedAccountGroupIdByStripeSubscriptionId: vi.fn(),
  cleanupHostedStandardCheckoutLoser: vi.fn(),
  materializeHostedGroupSponsorshipIfApplicable: vi.fn(),
  materializeHostedGroupSponsorshipNearCapNotification: vi.fn(),
  prepareHostedCryptoDomainRootCandidates: vi.fn(),
  prepareHostedStripeDirectMemberActivationCrypto: vi.fn(),
  prepareHostedFamilyStripeActivationCryptoDomainRoots: vi.fn(),
  prepareHostedLegacySyntheticFamilyCleanupTx: vi.fn(),
  prepareHostedStripeCheckoutCompletion: vi.fn(),
  prepareHostedStripeReversalProviderState: vi.fn(),
  readActiveHostedFamilySponsorship: vi.fn(),
  readHostedMemberFamilyBillingClaim: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberPulseTrialBillingDecisionSnapshot: vi.fn(),
  reconcileHostedUsageCreditStripeEvent: vi.fn(),
  readHostedMemberStripeBillingLookupState: vi.fn(),
  reconcileHostedAiUsageGateForBillingModeChangeTx: vi.fn(),
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx: vi.fn(),
  resolveStripeCustomerContext: vi.fn(),
  sendHostedSignupNotificationEmailForMemberBestEffort: vi.fn(),
  sendHostedSignupWelcomeEmailForMember: vi.fn(),
  sendHostedSubscriptionCancellationEmailForMember: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
  stripe: {
    events: {
      retrieve: vi.fn(),
    },
    invoicePayments: {
      list: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
      list: vi.fn(),
    },
    subscriptions: {
      cancel: vi.fn(),
      retrieve: vi.fn(),
    },
  },
  writeHostedMemberStripeBillingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx:
    mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-allowance")
  >("@/src/lib/hosted-execution/usage-allowance");

  return {
    ...actual,
    reconcileHostedAiUsageGateForBillingModeChangeTx:
      mocks.reconcileHostedAiUsageGateForBillingModeChangeTx,
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  prepareHostedCryptoDomainRootCandidates:
    mocks.prepareHostedCryptoDomainRootCandidates,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");

  return {
    ...actual,
    applyHostedFamilyStripeCheckoutCompletedTx: vi.fn(async () => ({
      activations: [],
      groupId: null,
    })),
    applyHostedFamilyStripeSubscriptionUpdatedTx: vi.fn(async () => ({
      activations: [],
      groupId: null,
    })),
    prepareHostedFamilyStripeActivationCryptoDomainRoots:
      mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots,
    prepareHostedLegacySyntheticFamilyCleanupTx:
      mocks.prepareHostedLegacySyntheticFamilyCleanupTx,
    lookupHostedAccountGroupIdByStripeSubscriptionId:
      mocks.lookupHostedAccountGroupIdByStripeSubscriptionId,
    readHostedMemberFamilyBillingClaim:
      mocks.readHostedMemberFamilyBillingClaim,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-billing-store")
  >("@/src/lib/hosted-onboarding/hosted-member-billing-store");

  return {
    ...actual,
    clearHostedMemberStripeCheckoutAttemptForSessionTx:
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
    readHostedMemberStripeBillingLookupState:
      mocks.readHostedMemberStripeBillingLookupState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
    readHostedMemberPulseTrialBillingDecisionSnapshot:
      mocks.readHostedMemberPulseTrialBillingDecisionSnapshot,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy")
  >("@/src/lib/hosted-onboarding/stripe-billing-policy");

  return {
    ...actual,
    writeHostedMemberStripeBillingTx: mocks.writeHostedMemberStripeBillingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx:
    mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx,
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx:
    mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeCheckoutCompleted: mocks.applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired: mocks.applyStripeCheckoutExpired,
  applyStripeDisputeUpdated: mocks.applyStripeDisputeUpdated,
  applyStripeInvoicePaid: mocks.applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed: mocks.applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated: mocks.applyStripeRefundCreated,
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
  isHostedStripeRefundEventType: (type: string) =>
    type === "refund.created" || type === "refund.updated",
  cleanupHostedFamilySponsoredDirectSubscription:
    mocks.cleanupHostedFamilySponsoredDirectSubscription,
  cleanupHostedStandardCheckoutAndRetireAttempt:
    mocks.cleanupHostedStandardCheckoutLoser,
  HostedStripeFamilySponsoredCleanupPendingError: class extends Error {},
  cancelHostedPulseTrialCheckoutLoserSubscription:
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription,
  prepareHostedStripeCheckoutCompletion:
    mocks.prepareHostedStripeCheckoutCompletion,
  prepareHostedStripeDirectMemberActivationCrypto:
    mocks.prepareHostedStripeDirectMemberActivationCrypto,
  prepareHostedStripeReversalProviderState:
    mocks.prepareHostedStripeReversalProviderState,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup")
  >("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup");

  return {
    ...actual,
    cleanupHostedStandardCheckoutLoser:
      mocks.cleanupHostedStandardCheckoutLoser,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    findMemberForStripeCheckoutSession: mocks.findMemberForStripeCheckoutSession,
    findMemberForStripeInvoice: mocks.findMemberForStripeInvoice,
    findMemberForStripeReversal: mocks.findMemberForStripeReversal,
    findMemberForStripeSubscription: mocks.findMemberForStripeSubscription,
    listHostedStripeCheckoutSessionMemberIds:
      mocks.listHostedStripeCheckoutSessionMemberIds,
    resolveStripeCustomerContext: mocks.resolveStripeCustomerContext,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-access", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >("@/src/lib/hosted-onboarding/member-access");

  return {
    ...actual,
    readActiveHostedFamilySponsorship: mocks.readActiveHostedFamilySponsorship,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeBillingPlanConfig: () => ({
      billingPlanCode: "launch_monthly",
      priceId: "price_pulse_monthly_123",
      stripe: mocks.stripe,
      stripeLiveMode: true,
    }),
    requireHostedStripeApi: () => mocks.stripe,
    requireHostedStripeApiMode: () => ({
      stripe: mocks.stripe,
      stripeLiveMode: true,
    }),
  };
});

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/signup-welcome-email")
  >("@/src/lib/hosted-onboarding/signup-welcome-email");

  return {
    ...actual,
    sendHostedSignupWelcomeEmailForMember: mocks.sendHostedSignupWelcomeEmailForMember,
    sendHostedSignupWelcomeEmailForMemberBestEffort:
      mocks.sendHostedSignupWelcomeEmailForMember,
  };
});

vi.mock("@/src/lib/hosted-onboarding/signup-notification-email", () => ({
  sendHostedSignupNotificationEmailForMemberBestEffort:
    mocks.sendHostedSignupNotificationEmailForMemberBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/subscription-cancellation-email", () => ({
  sendHostedSubscriptionCancellationEmailForMember:
    mocks.sendHostedSubscriptionCancellationEmailForMember,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation")
    >("@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation");
    return {
      ...actual,
      reconcileHostedUsageCreditStripeEvent:
        mocks.reconcileHostedUsageCreditStripeEvent,
    };
  },
);

vi.mock("@/src/lib/hosted-groups/group-sponsorship-notification", () => ({
  materializeHostedGroupSponsorshipIfApplicable:
    mocks.materializeHostedGroupSponsorshipIfApplicable,
  materializeHostedGroupSponsorshipNearCapNotification:
    mocks.materializeHostedGroupSponsorshipNearCapNotification,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime: mocks.signalHostedRuntimeRecheckRuntime,
}));

import {
  HOSTED_STRIPE_EVENT_LEASE_BUDGET,
  HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS,
  reconcileHostedStripeEventById as reconcileHostedStripeEventByIdImpl,
  recordHostedStripeEvent as recordHostedStripeEventImpl,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";
import {
  HostedStripeFamilySponsoredCleanupPendingError,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";
import { HostedUsageCreditStripeRetryableError } from
  "@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation";

type HostedStripeEventRecordInput = Parameters<typeof recordHostedStripeEventImpl>[0];
type HostedStripeEventReconcileInput = Parameters<typeof reconcileHostedStripeEventByIdImpl>[0];

type StripeEventPrismaHarnessClient = {
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
  $transaction: <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => Promise<T>;
  hostedMember: {
    findUnique: () => Promise<{
      billingRef: {
        currentBillingPhase: string | null;
      } | null;
    } | null>;
  };
  hostedStripeEvent: {
    create: ({ data }: { data: Record<string, unknown> }) => Promise<MutableStripeEventRow>;
    findMany: () => Promise<MutableStripeEventRow[]>;
    findUnique: ({ where }: { where: { eventId: string } }) => Promise<MutableStripeEventRow | null>;
    updateMany: ({ data, where }: { data: Record<string, unknown>; where: StripeEventWhere }) => Promise<{ count: number }>;
  };
};

type StripeTestEvent<TType extends Stripe.Event.Type, TObject extends Record<string, unknown>> = {
  api_version: string;
  created: number;
  data: {
    object: TObject;
  };
  id: string;
  livemode: boolean;
  object: "event";
  pending_webhooks: number;
  request: {
    id: string | null;
    idempotency_key: string | null;
  };
  type: TType;
};

async function recordHostedStripeEvent(
  input: Omit<HostedStripeEventRecordInput, "prisma"> & { prisma: StripeEventPrismaHarnessClient },
) {
  // @ts-expect-error - the Prisma harness only implements the delegate methods this test exercises.
  return recordHostedStripeEventImpl(input);
}

async function reconcileHostedStripeEventById(
  input: Omit<HostedStripeEventReconcileInput, "prisma"> & { prisma: StripeEventPrismaHarnessClient },
) {
  // @ts-expect-error - the Prisma harness only implements the delegate methods this test exercises.
  return reconcileHostedStripeEventByIdImpl(input);
}

describe("hosted Stripe event reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.applyStripeCheckoutExpired.mockResolvedValue(undefined);
    mocks.applyStripeDisputeUpdated.mockResolvedValue(undefined);
    mocks.applyStripeInvoicePaid.mockResolvedValue({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "dispatch_123",
      welcomeEmailMemberId: "member_123",
    });
    mocks.applyStripeInvoicePaymentFailed.mockResolvedValue(undefined);
    mocks.applyStripeRefundCreated.mockResolvedValue(undefined);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: false,
      hostedExecutionEventId: null,
      priorBillingStatus: HostedBillingStatus.active,
    });
    mocks.cleanupHostedFamilySponsoredDirectSubscription.mockResolvedValue(undefined);
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockResolvedValue(undefined);
    mocks.cleanupHostedStandardCheckoutLoser.mockResolvedValue(undefined);
    mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx.mockResolvedValue(undefined);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.findMemberForStripeInvoice.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.findMemberForStripeReversal.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.findMemberForStripeSubscription.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValue(["member_123"]);
    mocks.lookupHostedAccountGroupIdByStripeSubscriptionId.mockResolvedValue(
      null,
    );
    mocks.materializeHostedGroupSponsorshipIfApplicable.mockResolvedValue(true);
    mocks.materializeHostedGroupSponsorshipNearCapNotification.mockResolvedValue(false);
    mocks.prepareHostedCryptoDomainRootCandidates.mockResolvedValue(new Map());
    mocks.prepareHostedStripeDirectMemberActivationCrypto.mockResolvedValue(
      new Map(),
    );
    mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots.mockResolvedValue(
      new Map(),
    );
    mocks.prepareHostedLegacySyntheticFamilyCleanupTx.mockResolvedValue(null);
    mocks.prepareHostedStripeCheckoutCompletion.mockResolvedValue(null);
    mocks.prepareHostedStripeReversalProviderState.mockResolvedValue(null);
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(false);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);
    mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx.mockResolvedValue(
      true,
    );
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(null);
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot.mockResolvedValue(
      null,
    );
    mocks.readHostedMemberStripeBillingLookupState.mockResolvedValue(null);
    mocks.reconcileHostedUsageCreditStripeEvent.mockResolvedValue({ handled: false });
    mocks.reconcileHostedAiUsageGateForBillingModeChangeTx.mockResolvedValue(undefined);
    mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx.mockResolvedValue(undefined);
    mocks.resolveStripeCustomerContext.mockResolvedValue({
      customerId: null,
    });
    mocks.sendHostedSignupWelcomeEmailForMember.mockResolvedValue({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
    mocks.sendHostedSignupNotificationEmailForMemberBestEffort.mockResolvedValue(undefined);
    mocks.sendHostedSubscriptionCancellationEmailForMember.mockResolvedValue({
      status: "sent",
    });
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription());
    mocks.stripe.invoicePayments.list.mockResolvedValue({ data: [] });
    mocks.stripe.refunds.create.mockResolvedValue({ status: "succeeded" });
    mocks.stripe.refunds.list.mockResolvedValue({ data: [] });
    mocks.stripe.subscriptions.cancel.mockResolvedValue(makeCanonicalSubscription({
      status: "canceled",
    }));
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stores only minimal Stripe receipt state when recording an event", async () => {
    const prisma = createStripeEventPrismaHarness();

    await expect(
      recordHostedStripeEvent({
        event: makeInvoicePaidEvent(),
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      duplicate: false,
      type: "invoice.paid",
    });

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 0,
      eventId: "evt_invoice_paid_123",
      status: HostedStripeEventStatus.pending,
      type: "invoice.paid",
    }));
    expect(prisma.rows[0]).not.toHaveProperty("payloadJson");
    expect(prisma.rows[0]).not.toHaveProperty("customerId");
    expect(prisma.rows[0]).not.toHaveProperty("subscriptionId");
  });

  it("derives the receipt lease from every bounded top-up processing phase", () => {
    expect(HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs).toBe(
      HOSTED_STRIPE_EVENT_LEASE_BUDGET.eventRetrieveMs +
        HOSTED_STRIPE_EVENT_LEASE_BUDGET.usageCreditPreparationMs +
        HOSTED_STRIPE_EVENT_LEASE_BUDGET.memberMutationMs +
        HOSTED_STRIPE_EVENT_LEASE_BUDGET.postCommitMs +
        HOSTED_STRIPE_EVENT_LEASE_BUDGET.marginMs,
    );
    expect(HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs).toBe(27 * 60_000);
    expect(HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS).toBeLessThan(
      HOSTED_STRIPE_EVENT_LEASE_BUDGET.postCommitMs,
    );
    expect(HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS).toBe(90_000);
  });

  it("retrieves the live Stripe event during reconciliation and marks the receipt completed", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const preparedCryptoDomainRoots = new Map([
      ["control", { domain: "control" }],
    ]);
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.prepareHostedCryptoDomainRootCandidates.mockResolvedValueOnce(
      preparedCryptoDomainRoots,
    );

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: "dispatch_123",
      status: "completed",
    });

    expect(mocks.stripe.events.retrieve).toHaveBeenCalledWith("evt_invoice_paid_123");
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      event.data.object,
      {
        eventCreatedAt: new Date("2026-03-28T14:40:00.000Z"),
        occurredAt: "2026-03-28T14:40:00.000Z",
        sourceEventId: "evt_invoice_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      prisma.client,
      "active",
      makeCanonicalSubscription(),
      preparedCryptoDomainRoots,
      expect.any(Map),
    );
    expect(
      mocks.prepareHostedCryptoDomainRootCandidates,
    ).toHaveBeenCalledWith({
      prisma: prisma.client,
      userId: "member_123",
    });
    expect(
      mocks.prepareHostedCryptoDomainRootCandidates.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(prisma.client.$transaction).mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
    expect(prisma.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining(HOSTED_ONBOARDING_TRANSACTION_OPTIONS),
    );
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: "evt_invoice_paid_123",
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    expect(mocks.sendHostedSignupWelcomeEmailForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: "evt_invoice_paid_123",
      sourceEventType: "invoice.paid",
    });
    expect(
      mocks.sendHostedSignupWelcomeEmailForMember.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.sendHostedSignupNotificationEmailForMemberBestEffort.mock.invocationCallOrder[0],
    );
    expect(
      mocks.sendHostedSignupNotificationEmailForMemberBestEffort.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(prisma.client.hostedStripeEvent.updateMany).mock.invocationCallOrder.at(-1) ?? 0,
    );
  });

  it("emails only the first reconciliation failure across repeated event-read retries", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ id: "email_reconciliation_123" }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    ));
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv(
      "HOSTED_LINQ_ALERT_EMAIL_FROM",
      "Murph Alerts <alerts@example.com>",
    );
    vi.stubEnv("HOSTED_LINQ_ALERT_EMAILS", "operator@example.com");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockRejectedValue(
      Object.assign(new Error("Stripe event read unavailable"), {
        statusCode: 503,
        type: "StripeAPIError",
      }),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
    await nextServerMocks.after.mock.calls[0]?.[0]?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstRequest = fetchMock.mock.calls[0]?.[1];
    const firstBody = JSON.parse(String(firstRequest?.body)) as {
      subject: string;
      text: string;
    };
    expect(firstBody.subject).toBe(
      "Murph Stripe reconciliation failed — invoice.paid",
    );
    expect(firstBody.text).toContain("mode: live");
    expect(firstBody.text).not.toContain("Stripe operation failed");

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.stripe.events.retrieve).toHaveBeenCalledTimes(2);
    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes checkout completion through the live Stripe event without activating access", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.checkout.session.completed",
      }),
    );
    expect(mocks.sendHostedSignupWelcomeEmailForMember).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).not.toHaveBeenCalled();
    expect(
      mocks.prepareHostedStripeDirectMemberActivationCrypto,
    ).not.toHaveBeenCalled();
  });

  it("finishes superseded standard Checkout cleanup before completing its receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeCheckoutCompleted.mockResolvedValueOnce({
      activatedMemberId: null,
      cleanupStandardCheckout: {
        checkoutSessionId: "cs_checkout_123",
        subscriptionId: "sub_loser",
      },
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({
      status: "completed",
    });

    expect(mocks.cleanupHostedStandardCheckoutLoser).toHaveBeenCalledWith({
      checkoutSessionId: "cs_checkout_123",
      memberId: "member_123",
      prisma: prisma.client,
      subscriptionId: "sub_loser",
    });
    expect(
      mocks.cleanupHostedStandardCheckoutLoser.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(
        prisma.client.hostedStripeEvent.updateMany,
      ).mock.invocationCallOrder.at(-1) ?? 0,
    );
  });

  it("keeps a nonterminal duplicate refund claimable beyond the poison cap", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeCheckoutCompleted.mockResolvedValueOnce({
      activatedMemberId: null,
      cleanupStandardCheckout: {
        checkoutSessionId: "cs_checkout_123",
        subscriptionId: "sub_loser",
      },
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.cleanupHostedStandardCheckoutLoser.mockRejectedValueOnce(
      new HostedStripeCheckoutLoserCleanupPendingError(),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      lastErrorCode: "HOSTED_BILLING_CHECKOUT_CLEANUP_PENDING",
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    errorSpy.mockRestore();
  });

  it("poisons a permanent post-commit cleanup failure at the shared cap", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      cleanupStandardCheckout: {
        checkoutSessionId: "cs_checkout_123",
        subscriptionId: "sub_loser",
      },
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.cleanupHostedStandardCheckoutLoser.mockRejectedValue(
      Object.assign(new Error("Stripe rejected cleanup"), {
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted Stripe event reconciliation failed.",
      expect.objectContaining({ poisoned: true }),
    );
    errorSpy.mockRestore();
  });

  it("completes usage-credit reconciliation after quiet sponsorship materialization", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockResolvedValue({
      beneficiaryMemberId: "member_123",
      granted: true,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: true,
    });
    mocks.materializeHostedGroupSponsorshipIfApplicable.mockResolvedValueOnce(
      false,
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
      usageCreditGrantedMemberId: "member_123",
    });

    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledWith({
      event,
      prisma: prisma.client,
    });
    expect(
      mocks.materializeHostedGroupSponsorshipIfApplicable,
    ).toHaveBeenCalledWith({
      prisma: prisma.client,
      purchaseId: "hucp_purchase_123",
    });
    expect(
      mocks.materializeHostedGroupSponsorshipNearCapNotification,
    ).toHaveBeenCalledWith({
      prisma: prisma.client,
      purchaseId: "hucp_purchase_123",
    });
    expect(mocks.findMemberForStripeCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.prepareHostedLegacySyntheticFamilyCleanupTx).not.toHaveBeenCalled();
    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      prisma: prisma.client,
      userId: "member_123",
    });
  });

  it("wakes paid usage work before attempting the optional sponsorship moment", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const ordering: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockResolvedValue({
      beneficiaryMemberId: "member_123",
      granted: true,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: true,
    });
    mocks.signalHostedRuntimeRecheckRuntime.mockImplementationOnce(async () => {
      ordering.push("usage-recheck");
      return {
        signalAccepted: true,
        workflowId: "hosted-user-runtime:member_123",
      };
    });
    mocks.materializeHostedGroupSponsorshipIfApplicable.mockImplementationOnce(
      async () => {
        ordering.push("sponsorship-moment");
        throw new Error("Sponsorship moment unavailable");
      },
    );

    try {
      await recordHostedStripeEvent({ event, prisma: prisma.client });
      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "failed" });

      expect(ordering).toEqual(["usage-recheck", "sponsorship-moment"]);
      expect(prisma.rows[0]).toEqual(expect.objectContaining({
        processedAt: null,
        status: HostedStripeEventStatus.failed,
      }));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("materializes a replayed direct PaymentIntent success through the same owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = {
      ...makeCheckoutCompletedEvent(),
      data: {
        object: {
          id: "pi_usage_credit_123",
          object: "payment_intent",
          status: "succeeded",
        },
      },
      id: "evt_usage_credit_payment_intent_succeeded",
      type: "payment_intent.succeeded",
    } as Stripe.Event;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockResolvedValue({
      beneficiaryMemberId: "member_123",
      granted: false,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: false,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(
      mocks.materializeHostedGroupSponsorshipIfApplicable,
    ).toHaveBeenCalledWith({
      prisma: prisma.client,
      purchaseId: "hucp_purchase_123",
    });
  });

  it("keeps a paid usage-credit grant claimable after Stripe directs a sixth-attempt retry", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let grantCount = 0;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent
      .mockRejectedValueOnce(new HostedUsageCreditStripeRetryableError(
        Object.assign(new Error("Stripe requested a retry"), {
          headers: {
            "StRiPe-ShOuLd-ReTrY": "TRUE",
          },
          statusCode: 400,
          type: "StripeInvalidRequestError",
        }),
      ))
      .mockImplementationOnce(async () => {
        grantCount += 1;
        return {
          beneficiaryMemberId: "member_123",
          granted: true,
          handled: true,
          purchaseId: "hucp_purchase_123",
          wakeRequired: true,
        };
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
      usageCreditGrantedMemberId: "member_123",
    });

    expect(grantCount).toBe(1);
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledOnce();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("keeps a generic operational timeout claimable after attempt six", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockRejectedValueOnce(
      Object.assign(new Error("database request timed out"), {
        code: "ETIMEDOUT",
      }),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("poisons a permanent retryable domain wrapper at the shared cap", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockRejectedValue(
      hostedOnboardingError({
        code: "HOSTED_PERMANENT_BILLING_FAILURE",
        httpStatus: 502,
        message: "Permanent billing failure.",
        retryable: true,
      }),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      status: HostedStripeEventStatus.poisoned,
    }));
    errorSpy.mockRestore();
  });

  it("honors a transient Stripe cause inside a retryable domain wrapper", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockRejectedValue(
      hostedOnboardingError({
        cause: Object.assign(new Error("Stripe rate limited the request."), {
          statusCode: 429,
          type: "StripeRateLimitError",
        }),
        code: "HOSTED_TRANSIENT_BILLING_FAILURE",
        httpStatus: 502,
        message: "Transient billing failure.",
        retryable: true,
      }),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      status: HostedStripeEventStatus.failed,
    }));
    errorSpy.mockRestore();
  });

  it("honors Stripe's no-retry directive inside a retryable domain wrapper", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockRejectedValue(
      hostedOnboardingError({
        cause: Object.assign(new Error("Stripe rejected the request."), {
          headers: { "Stripe-Should-Retry": "false" },
          statusCode: 500,
          type: "StripeAPIError",
        }),
        code: "HOSTED_DEFINITIVE_BILLING_FAILURE",
        httpStatus: 502,
        message: "Definitive billing failure.",
        retryable: true,
      }),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      status: HostedStripeEventStatus.poisoned,
    }));
    errorSpy.mockRestore();
  });

  it("keeps a concrete transient Prisma initialization failure claimable", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockRejectedValueOnce(
      new Prisma.PrismaClientInitializationError(
        "database unavailable",
        "7.8.0",
        "P1001",
      ),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      status: HostedStripeEventStatus.failed,
    }));
    errorSpy.mockRestore();
  });

  it.each([
    [
      "a permanent Prisma initialization failure",
      new Prisma.PrismaClientInitializationError(
        "database authentication failed",
        "7.8.0",
        "P1000",
      ),
    ],
    [
      "an unclassified Prisma request failure",
      Object.assign(new Error("unknown database request failure"), {
        name: "PrismaClientUnknownRequestError",
      }),
    ],
  ])("poisons %s at the shared cap", async (_label, failure) => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockRejectedValueOnce(failure);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      status: HostedStripeEventStatus.poisoned,
    }));
    errorSpy.mockRestore();
  });

  it("keeps a committed billing wake claimable after a generic sixth-attempt post-commit failure", async () => {
    const prisma = createStripeEventPrismaHarness({
      currentBillingPhase: "paid",
    });
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid
      .mockResolvedValueOnce({
        activatedMemberId: null,
        hostedExecutionEventId: null,
        runtimeRecheckMemberIds: ["member_123"],
        welcomeEmailMemberId: null,
      })
      .mockResolvedValueOnce({
        activatedMemberId: null,
        hostedExecutionEventId: null,
        runtimeRecheckMemberIds: [],
        welcomeEmailMemberId: null,
      });
    mocks.signalHostedRuntimeRecheckRuntime
      .mockRejectedValueOnce(new Error("runtime unavailable"))
      .mockResolvedValueOnce({
        signalAccepted: true,
        workflowId: "hosted-user-runtime:member_123",
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      lastErrorCode: "HOSTED_STRIPE_RUNTIME_RECHECK_PENDING",
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("reissues a paid direct-billing wake after an expired processing lease", async () => {
    const prisma = createStripeEventPrismaHarness({
      currentBillingPhase: "paid",
    });
    const event = makeInvoicePaidEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockResolvedValueOnce({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    Object.assign(prisma.rows[0]!, {
      attemptCount: 1,
      claimExpiresAt: new Date(0),
      status: HostedStripeEventStatus.processing,
    });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledOnce();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledOnce();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      prisma: prisma.client,
      userId: "member_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 2,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
  });

  it.each([
    ["invoice-first", "invoice"],
    ["subscription-first", "subscription"],
  ] as const)(
    "keeps the real %s handler's paid wake retry-owned after commit",
    async (_label, eventKind) => {
      const prisma = createStripeEventPrismaHarness({
        currentBillingPhase: "paid",
      });
      const actualBillingEvents = await vi.importActual<
        typeof import("@/src/lib/hosted-onboarding/stripe-billing-events")
      >("@/src/lib/hosted-onboarding/stripe-billing-events");
      const event = eventKind === "invoice"
        ? makeInvoicePaidEvent()
        : makeSubscriptionEvent("customer.subscription.created");
      const starterMember: HostedMemberBillingSnapshot = {
        billingRef: {
          currentBillingPhase: null,
          currentCheckoutOffer: "standard",
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
        core: {
          billingStatus: HostedBillingStatus.active,
          createdAt: new Date("2026-03-28T12:00:00.000Z"),
          id: "member_123",
          suspendedAt: null,
          updatedAt: new Date("2026-03-28T12:00:00.000Z"),
        },
      };
      const paidMember: HostedMemberBillingSnapshot = {
        billingRef: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "standard",
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
        core: starterMember.core,
      };
      let currentMember = starterMember;
      mocks.findMemberForStripeInvoice.mockImplementation(async () => currentMember);
      mocks.findMemberForStripeSubscription.mockImplementation(async () => currentMember);
      mocks.readHostedMemberBillingSnapshot.mockImplementation(async () => currentMember);
      mocks.writeHostedMemberStripeBillingTx.mockImplementation(async () => {
        currentMember = paidMember;
        return paidMember;
      });
      if (eventKind === "invoice") {
        mocks.applyStripeInvoicePaid.mockImplementation(
          actualBillingEvents.applyStripeInvoicePaid,
        );
      } else {
        mocks.applyStripeSubscriptionUpdated.mockImplementation(
          actualBillingEvents.applyStripeSubscriptionUpdated,
        );
      }
      mocks.stripe.events.retrieve.mockResolvedValue(event);
      mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
        status: "active",
      }));
      mocks.signalHostedRuntimeRecheckRuntime
        .mockRejectedValueOnce(new Error("runtime unavailable"))
        .mockResolvedValueOnce({
          signalAccepted: true,
          workflowId: "hosted-user-runtime:member_123",
        });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await recordHostedStripeEvent({ event, prisma: prisma.client });
      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "failed" });

      prisma.rows[0]!.nextAttemptAt = new Date(0);
      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "completed" });

      expect(mocks.reconcileHostedAiUsageGateForBillingModeChangeTx)
        .toHaveBeenCalledOnce();
      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(2);
      expect(prisma.rows[0]).toEqual(expect.objectContaining({
        lastErrorCode: null,
        processedAt: expect.any(Date),
        status: HostedStripeEventStatus.completed,
      }));
      errorSpy.mockRestore();
    },
  );

  it("keeps a top-up receipt claimable when Stripe directs live retrieval retry on attempt six", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const session = event.data.object as Stripe.Checkout.Session;
    session.client_reference_id = "hucp_purchase_123";
    session.metadata = {
      policyVersion: "hosted-usage-credit-checkout-v1",
      purchaseId: "hucp_purchase_123",
      purpose: "hosted_usage_credit",
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let grantCount = 0;
    mocks.stripe.events.retrieve
      .mockRejectedValueOnce(Object.assign(
        new Error("Stripe requested a retry"),
        {
          headers: {
            "StRiPe-ShOuLd-ReTrY": " TRUE ",
          },
          statusCode: 400,
          type: "StripeInvalidRequestError",
        },
      ))
      .mockResolvedValueOnce(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockImplementation(async () => {
      grantCount += 1;
      return {
        beneficiaryMemberId: "member_123",
        granted: true,
        handled: true,
        purchaseId: "hucp_purchase_123",
        wakeRequired: true,
      };
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      lastErrorCode: "HOSTED_STRIPE_EVENT_RETRIEVE_RETRYABLE",
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    expect(mocks.reconcileHostedUsageCreditStripeEvent).not.toHaveBeenCalled();

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
      usageCreditGrantedMemberId: "member_123",
    });

    expect(grantCount).toBe(1);
    expect(mocks.stripe.events.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledOnce();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledOnce();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("poisons a top-up receipt when Stripe directs no retry on attempt six", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockRejectedValue(Object.assign(
      new Error("Stripe rejected the event read"),
      {
        headers: {
          "STRIPE-SHOULD-RETRY": "false",
        },
        statusCode: 500,
        type: "StripeAPIError",
      },
    ));

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    expect(mocks.reconcileHostedUsageCreditStripeEvent).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("still poisons a definitive live event lookup rejection at the shared cap", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockRejectedValue(Object.assign(
      new Error("No such Stripe event"),
      {
        headers: {
          "Stripe-Should-Retry": "not-a-directive",
        },
        statusCode: 404,
        type: "StripeInvalidRequestError",
      },
    ));

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    expect(mocks.reconcileHostedUsageCreditStripeEvent).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("poisons a usage-credit receipt when Stripe directs no retry on attempt six", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stripeError = Object.assign(new Error("Stripe rejected the read"), {
      headers: {
        "StRiPe-ShOuLd-ReTrY": "FALSE",
      },
      statusCode: 500,
      type: "StripeAPIError",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockRejectedValue(stripeError);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toBeNull();
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("keeps a usage-credit reversal claimable after a transient sixth attempt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeRefundCreatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let reversalCount = 0;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent
      .mockRejectedValueOnce(new HostedUsageCreditStripeRetryableError(
        new Error("database unavailable"),
      ))
      .mockImplementationOnce(async () => {
        reversalCount += 1;
        return {
          beneficiaryMemberId: "member_123",
          granted: false,
          handled: true,
          purchaseId: "hucp_purchase_123",
          wakeRequired: true,
        };
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(reversalCount).toBe(1);
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeRefundCreated).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("still poisons a proven permanent usage-credit invariant at the shared cap", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockRejectedValue(
      new Error("Usage-credit Checkout metadata did not match."),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toBeNull();
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("retries a fulfilled usage-credit runtime recheck before completing its receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent
      .mockResolvedValueOnce({
        beneficiaryMemberId: "member_123",
        granted: true,
        handled: true,
        purchaseId: "hucp_purchase_123",
        wakeRequired: true,
      })
      .mockResolvedValueOnce({
        beneficiaryMemberId: "member_123",
        granted: false,
        handled: true,
        purchaseId: "hucp_purchase_123",
        wakeRequired: true,
      });
    mocks.signalHostedRuntimeRecheckRuntime
      .mockRejectedValueOnce(new Error("Temporal unavailable"))
      .mockResolvedValueOnce({
        signalAccepted: true,
        workflowId: "hosted-user-runtime:member_123",
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("keeps the receipt retryable when a usage-credit runtime recheck times out", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const prisma = createStripeEventPrismaHarness();
      const event = makeCheckoutCompletedEvent();
      mocks.stripe.events.retrieve.mockResolvedValue(event);
      mocks.reconcileHostedUsageCreditStripeEvent.mockResolvedValue({
        beneficiaryMemberId: "member_123",
        granted: true,
        handled: true,
        purchaseId: "hucp_purchase_123",
        wakeRequired: true,
      });
      mocks.signalHostedRuntimeRecheckRuntime.mockImplementation(
        async () => await new Promise<never>(() => {}),
      );

      await recordHostedStripeEvent({ event, prisma: prisma.client });
      const reconciliation = reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      });
      const result = expect(reconciliation).resolves.toMatchObject({
        status: "failed",
      });

      await vi.advanceTimersByTimeAsync(
        HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS,
      );
      await result;

      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
        abortSignal: expect.objectContaining({ aborted: true }),
        prisma: prisma.client,
        userId: "member_123",
      });
      expect(prisma.rows[0]).toEqual(expect.objectContaining({
        attemptCount: 1,
        processedAt: null,
        status: HostedStripeEventStatus.failed,
      }));
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("prepares standard Checkout bindings before taking the member lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const ordering: string[] = [];
    const preparedCheckoutCompletion = {
      billingCompletion: {
        memberId: "member_123",
        stripeCustomerId: "cus_checkout",
        stripeCustomerIdEncrypted: "encrypted-customer",
        stripeCustomerLookupKey: "customer-lookup",
        stripeSubscriptionId: "sub_checkout_123",
        stripeSubscriptionIdEncrypted: "encrypted-subscription",
        stripeSubscriptionLookupKey: "subscription-lookup",
      },
      canonicalSubscription: null,
      memberId: "member_123",
      stripeCheckoutEmail: null,
    };
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.prepareHostedStripeCheckoutCompletion.mockImplementationOnce(
      async () => {
        ordering.push("bindings-prepared");
        return preparedCheckoutCompletion;
      },
    );
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(ordering).toEqual(["bindings-prepared", "member-locked"]);
    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cs_checkout_123" }),
      expect.anything(),
      expect.any(Object),
      undefined,
      preparedCheckoutCompletion,
    );
  });

  it("fails before standard Checkout handling when ownership changes under the member lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const ordering: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeCheckoutSession
      .mockImplementationOnce(async () => {
        ordering.push("owner-resolved");
        return { core: { id: "member_123" } };
      });
    mocks.listHostedStripeCheckoutSessionMemberIds
      .mockImplementationOnce(async () => {
        ordering.push("owner-revalidated");
        return ["member_456"];
      });
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(ordering).toEqual([
      "owner-resolved",
      "member-locked",
      "owner-revalidated",
    ]);
    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    errorSpy.mockRestore();
  });

  it("processes a no-owner family Checkout without the ordinary billing-owner gate", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const session = event.data.object as Stripe.Checkout.Session;
    session.metadata = {
      ...session.metadata,
      kind: "hosted_family_plan",
    };
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(null);

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledOnce();
  });

  it("processes a no-owner family subscription without the ordinary billing-owner gate", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      metadata: {
        kind: "hosted_family_plan",
      },
      status: "active",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.anything(),
      expect.anything(),
      expect.any(Map),
      undefined,
    );
  });

  it("processes a no-owner family invoice without the ordinary billing-owner gate", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      metadata: {
        kind: "hosted_family_plan",
      },
      status: "active",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeInvoice.mockResolvedValue(null);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.applyStripeInvoicePaid.mockResolvedValue({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.anything(),
      HostedBillingStatus.active,
      canonicalSubscription,
      undefined,
      expect.any(Map),
    );
  });

  it("keeps a transient legacy Family cleanup failure within the ordinary poison bound", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.prepareHostedLegacySyntheticFamilyCleanupTx.mockResolvedValue("sub_123");
    mocks.stripe.subscriptions.cancel
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce(makeCanonicalSubscription({ status: "canceled" }));

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 1,
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted Stripe event reconciliation failed.",
      expect.objectContaining({
        errorMessage: "Stripe unavailable",
        poisoned: false,
      }),
    );
    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_123",
      {},
      { idempotencyKey: "hosted-family-legacy-cancel:sub_123" },
    );
    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("retries the exact legacy Family invoice refund without duplicating it", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const invoice = event.data.object as Stripe.Invoice & {
      charge?: string | null;
      payment_intent?: string | null;
    };
    invoice.charge = null;
    invoice.payment_intent = null;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeInvoice.mockResolvedValue(null);
    mocks.prepareHostedLegacySyntheticFamilyCleanupTx.mockResolvedValue("sub_123");
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      status: "canceled",
    }));
    mocks.stripe.invoicePayments.list.mockResolvedValue({
      data: [{
        amount_paid: 2_000,
        amount_requested: 2_000,
        payment: {
          payment_intent: {
            amount_received: 2_000,
            id: "pi_exact",
            status: "succeeded",
          },
          type: "payment_intent",
        },
        status: "paid",
      }],
      has_more: false,
    });
    mocks.stripe.refunds.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{
          amount: 2_000,
          id: "re_legacy",
          metadata: { hosted_family_legacy_invoice_id: "in_123" },
          status: "succeeded",
        }],
        has_more: false,
      });
    mocks.stripe.refunds.create.mockResolvedValue({
      amount: 2_000,
      status: "pending",
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      lastErrorCode: "HOSTED_LEGACY_FAMILY_CLEANUP_PENDING",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.stripe.invoicePayments.list).toHaveBeenCalledWith(expect.objectContaining({
      invoice: "in_123",
      status: "paid",
    }));
    expect(mocks.stripe.refunds.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.refunds.create).toHaveBeenCalledWith({
      amount: 2_000,
      metadata: { hosted_family_legacy_invoice_id: "in_123" },
      payment_intent: "pi_exact",
      reason: "duplicate",
    }, {
      idempotencyKey: "hosted-family-legacy-refund:in_123",
    });
    errorSpy.mockRestore();
  });

  it("requires support instead of guessing after a partial legacy Family refund", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeInvoice.mockResolvedValue(null);
    mocks.prepareHostedLegacySyntheticFamilyCleanupTx.mockResolvedValue("sub_123");
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      status: "canceled",
    }));
    mocks.stripe.invoicePayments.list.mockResolvedValue({
      data: [{
        amount_paid: 2_000,
        amount_requested: 2_000,
        payment: {
          payment_intent: {
            amount_received: 2_000,
            id: "pi_exact",
            status: "succeeded",
          },
          type: "payment_intent",
        },
        status: "paid",
      }],
      has_more: false,
    });
    mocks.stripe.refunds.list.mockResolvedValue({
      data: [{
        amount: 1_000,
        id: "re_partial",
        metadata: { hosted_family_legacy_invoice_id: "in_123" },
        status: "succeeded",
      }],
      has_more: false,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      lastErrorCode: "HOSTED_BILLING_CHECKOUT_CLEANUP_REQUIRES_SUPPORT",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.poisoned,
    }));
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted Stripe event reconciliation failed.",
      expect.objectContaining({
        errorMessage:
          "A superseded Stripe subscription was canceled, but its payment allocation requires support review before refunding.",
        poisoned: true,
      }),
    );
    expect(mocks.stripe.refunds.create).not.toHaveBeenCalled();
    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toBeNull();
    expect(mocks.stripe.refunds.list).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("does not send the Resend welcome when a later paid invoice has no new activation", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent({
      id: "evt_invoice_paid_renewal",
      invoiceId: "in_renewal_123",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockResolvedValueOnce({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.sendHostedSignupWelcomeEmailForMember).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("uses checkout completion as a welcome candidate so invoice-before-checkout email ordering can recover", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeCheckoutCompleted.mockResolvedValueOnce({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: "member_123",
    });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.sendHostedSignupWelcomeEmailForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: event.id,
      sourceEventType: event.type,
    });
  });

  it("defers Pulse Trial provider authority to the locked checkout owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    const preparedCryptoDomainRoots = new Map([
      ["control", { domain: "control" }],
    ]);
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.prepareHostedStripeDirectMemberActivationCrypto.mockResolvedValueOnce(
      preparedCryptoDomainRoots,
    );

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    const transactionMock = vi.mocked(prisma.client.$transaction);
    expect(
      mocks.prepareHostedStripeDirectMemberActivationCrypto,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
    expect(
      mocks.prepareHostedStripeDirectMemberActivationCrypto.mock
        .invocationCallOrder[0],
    ).toBeLessThan(transactionMock.mock.invocationCallOrder[0] ?? 0);
    expect(transactionMock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.applyStripeCheckoutCompleted.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.objectContaining({
        sourceType: "stripe.checkout.session.completed",
      }),
      preparedCryptoDomainRoots,
    );
  });

  it("retries delayed Pulse Trial loser cleanup before completing the receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const subscription = makeCanonicalSubscription({
      customer: "cus_checkout",
      id: "sub_checkout_123",
      metadata: {
        checkoutOffer: "pulse_trial_7d",
      },
      status: "trialing",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription);
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: "sub_checkout_123",
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0].nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.cancelHostedPulseTrialCheckoutLoserSubscription).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("retries Family-sponsored direct checkout cleanup before completing the receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      cleanupFamilySponsoredCheckout: {
        checkoutSessionId: "cs_trial_123",
        subscriptionId: "sub_checkout_123",
      },
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.cleanupHostedFamilySponsoredDirectSubscription
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    prisma.rows[0].nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.cleanupHostedFamilySponsoredDirectSubscription).toHaveBeenCalledTimes(2);
    expect(mocks.cleanupHostedFamilySponsoredDirectSubscription).toHaveBeenCalledWith({
      checkoutSessionId: "cs_trial_123",
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: `${event.id}:family-sponsored-checkout-cleanup`,
      subscriptionId: "sub_checkout_123",
    });
    errorSpy.mockRestore();
  });

  it("keeps changed Family authority retryable beyond the receipt poison cap", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      cleanupFamilySponsoredCheckout: {
        checkoutSessionId: "cs_trial_123",
        subscriptionId: "sub_checkout_123",
      },
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.cleanupHostedFamilySponsoredDirectSubscription.mockRejectedValueOnce(
      new HostedStripeFamilySponsoredCleanupPendingError(),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    errorSpy.mockRestore();
  });

  it("cleans up a Family-sponsored direct subscription without a stored billing reference", async () => {
    const prisma = createStripeEventPrismaHarness();
    const metadata = {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "standard",
      memberId: "member_123",
    };
    const event = makeSubscriptionEvent("customer.subscription.created", { metadata });
    const canonicalSubscription = makeCanonicalSubscription({ metadata });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(true);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      activatedMemberId: null,
      activatedMembers: [],
      cleanupFamilySponsoredStripeSubscriptionId: "sub_123",
      hostedExecutionEventId: null,
      subscriptionCancellationEmail: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.readActiveHostedFamilySponsorship).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.anything(),
      prisma.client,
      expect.any(Map),
      undefined,
    );
    expect(mocks.cleanupHostedFamilySponsoredDirectSubscription).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: `${event.id}:family-sponsored-cleanup`,
      subscriptionId: "sub_123",
    });
  });

  it("cleans up a Family-sponsored paid invoice without a stored billing reference", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeInvoice.mockResolvedValue(null);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(true);
    mocks.applyStripeInvoicePaid.mockResolvedValue({
      activatedMemberId: null,
      cleanupFamilySponsoredStripeSubscriptionId: "sub_123",
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      prisma.client,
      "active",
      canonicalSubscription,
      undefined,
      expect.any(Map),
    );
    expect(mocks.cleanupHostedFamilySponsoredDirectSubscription).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: `${event.id}:family-sponsored-cleanup`,
      subscriptionId: "sub_123",
    });
  });

  it("retries a subscription-created Pulse Trial loser cleanup before completing the receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.created");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      id: "sub_123",
      status: "trialing",
    }));
    mocks.findMemberForStripeSubscription.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: "sub_123",
      hostedExecutionEventId: null,
      subscriptionCancellationEmail: null,
      welcomeEmailMemberId: null,
    });
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription
      .mockRejectedValueOnce(new Error("temporary cleanup failure"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    prisma.rows[0].nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.cancelHostedPulseTrialCheckoutLoserSubscription).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it.each([
    ["customer.subscription.created", "checkout.session.completed"],
    ["checkout.session.completed", "customer.subscription.created"],
  ] as const)("keeps active non-trial access authoritative when %s precedes %s", async (
    firstType,
    secondType,
  ) => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_monthly_123",
    );
    const actualBillingEvents = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/stripe-billing-events")
    >("@/src/lib/hosted-onboarding/stripe-billing-events");
    const member = makeActiveNonTrialMemberWithoutSubscription();
    const checkoutEvent = makeExactPulseTrialCheckoutCompletedEvent();
    const subscriptionEvent = makeExactPulseTrialSubscriptionCreatedEvent();
    const eventsById = new Map([
      [checkoutEvent.id, checkoutEvent],
      [subscriptionEvent.id, subscriptionEvent],
    ]);
    let cacheWasActiveDuringPreparation = false;
    let cacheWasActiveDuringLockedProcessing = false;
    let providerStatus: Stripe.Subscription.Status = "trialing";
    mocks.applyStripeCheckoutCompleted.mockImplementation(
      (
        ...args: Parameters<
          typeof actualBillingEvents.applyStripeCheckoutCompleted
        >
      ) => {
        cacheWasActiveDuringLockedProcessing =
          getHostedDomainRootUnwrapCache() !== undefined;
        return actualBillingEvents.applyStripeCheckoutCompleted(...args);
      },
    );
    mocks.applyStripeSubscriptionUpdated.mockImplementation(
      actualBillingEvents.applyStripeSubscriptionUpdated,
    );
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockImplementation(
      actualBillingEvents.cancelHostedPulseTrialCheckoutLoserSubscription,
    );
    mocks.prepareHostedStripeCheckoutCompletion.mockImplementation(
      async () => {
        cacheWasActiveDuringPreparation =
          getHostedDomainRootUnwrapCache() !== undefined;
        return {
          billingCompletion: {
            memberId: "member_123",
            stripeCustomerId: "cus_checkout",
            stripeCustomerIdEncrypted: "encrypted-customer",
            stripeCustomerLookupKey: "customer-lookup",
            stripeSubscriptionId: "sub_checkout_123",
            stripeSubscriptionIdEncrypted: "encrypted-subscription",
            stripeSubscriptionLookupKey: "subscription-lookup",
          },
          canonicalSubscription:
            await mocks.stripe.subscriptions.retrieve("sub_checkout_123"),
          memberId: "member_123",
          stripeCheckoutEmail: null,
        };
      },
    );
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(member);
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot.mockResolvedValue({
      core: member.core,
      currentBillingPhase: member.billingRef?.currentBillingPhase ?? null,
      currentTrialStartedAt: null,
      pulseTrialRedeemedAt: member.billingRef?.pulseTrialRedeemedAt ?? null,
      stripeSubscriptionLookupKey: null,
    });
    mocks.stripe.events.retrieve.mockImplementation(async (eventId: string) => {
      const event = eventsById.get(eventId);
      if (!event) {
        throw new Error("Unexpected Stripe event.");
      }
      return event;
    });
    mocks.stripe.subscriptions.retrieve.mockImplementation(async () =>
      makeExactPulseTrialSubscription(providerStatus)
    );
    mocks.stripe.subscriptions.cancel.mockImplementation(async () => {
      providerStatus = "canceled";
      return makeExactPulseTrialSubscription("canceled");
    });
    const eventByType = {
      "checkout.session.completed": checkoutEvent,
      "customer.subscription.created": subscriptionEvent,
    };
    const prisma = createStripeEventPrismaHarness();

    for (const type of [firstType, secondType]) {
      const event = eventByType[type];
      await recordHostedStripeEvent({ event, prisma: prisma.client });
      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "completed" });
    }

    expect(member.core.billingStatus).toBe(HostedBillingStatus.active);
    expect(member.billingRef?.stripeSubscriptionId).toBeNull();
    expect(member.billingRef?.pulseTrialRedeemedAt).toBeNull();
    expect(cacheWasActiveDuringPreparation).toBe(true);
    expect(cacheWasActiveDuringLockedProcessing).toBe(true);
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledOnce();
    expect(prisma.rows).toEqual([
      expect.objectContaining({ status: HostedStripeEventStatus.completed }),
      expect.objectContaining({ status: HostedStripeEventStatus.completed }),
    ]);
    vi.unstubAllEnvs();
  });

  it("keeps the real loser receipt retryable until resource_missing proves cleanup terminal", async () => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_monthly_123",
    );
    const actualBillingEvents = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/stripe-billing-events")
    >("@/src/lib/hosted-onboarding/stripe-billing-events");
    const member = makeActiveNonTrialMemberWithoutSubscription();
    const event = makeExactPulseTrialSubscriptionCreatedEvent();
    const prisma = createStripeEventPrismaHarness();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.applyStripeSubscriptionUpdated.mockImplementation(
      actualBillingEvents.applyStripeSubscriptionUpdated,
    );
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockImplementation(
      actualBillingEvents.cancelHostedPulseTrialCheckoutLoserSubscription,
    );
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(
      makeExactPulseTrialSubscription("trialing"),
    );
    mocks.stripe.subscriptions.cancel
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockRejectedValueOnce({ code: "resource_missing" });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("leaves welcome provider failure handling inside the centralized best-effort helper", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.sendHostedSignupWelcomeEmailForMember.mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: "dispatch_123",
      status: "completed",
    });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      status: HostedStripeEventStatus.completed,
    }));
    expect(mocks.sendHostedSignupWelcomeEmailForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: "evt_invoice_paid_123",
      sourceEventType: "invoice.paid",
    });
  });

  it("uses the live Stripe subscription state instead of a stale subscription event payload", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const preparedFamilyCryptoDomainRoots = new Map([
      ["member_family_owner", new Map()],
      ["member_family_child", new Map()],
    ]);
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
      },
      status: "active",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots.mockResolvedValueOnce(
      preparedFamilyCryptoDomainRoots,
    );
    mocks.applyStripeSubscriptionUpdated.mockResolvedValueOnce({
      activatedMemberId: "member_family_owner",
      activatedMembers: [
        {
          activatedMemberId: "member_family_owner",
          hostedExecutionEventId: "member.activated:family:owner",
        },
        {
          activatedMemberId: "member_family_child",
          hostedExecutionEventId: "member.activated:family:child",
        },
      ],
      hostedExecutionEventId: "member.activated:family:owner",
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: "member_family_owner",
      activatedMembers: [
        {
          activatedMemberId: "member_family_owner",
          hostedExecutionEventId: "member.activated:family:owner",
        },
        {
          activatedMemberId: "member_family_child",
          hostedExecutionEventId: "member.activated:family:child",
        },
      ],
      eventId: event.id,
      hostedExecutionEventId: "member.activated:family:owner",
      status: "completed",
    });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.customer.subscription.updated",
      }),
      expect.anything(),
      preparedFamilyCryptoDomainRoots,
      undefined,
    );
    expect(mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots)
      .toHaveBeenCalledWith({
        prisma: prisma.client,
        subscription: canonicalSubscription,
      });
    expect(
      mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(prisma.client.$transaction).mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(
      mocks.prepareHostedStripeDirectMemberActivationCrypto,
    ).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
  });

  it("prepares Family candidates when a reused subscription still resolves its direct owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const eventSubscription = event.data.object as Stripe.Subscription;
    eventSubscription.metadata = {
      ...eventSubscription.metadata,
      kind: "hosted_family_plan",
    };
    const preparedFamilyCryptoDomainRoots = new Map([
      ["member_123", new Map([["control", { domain: "control" }]])],
      ["member_family_child", new Map([["control", { domain: "control" }]])],
    ]);
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
      },
      status: "active",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeSubscription.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots.mockResolvedValue(
      preparedFamilyCryptoDomainRoots,
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots)
      .toHaveBeenCalledWith({
        prisma: prisma.client,
        subscription: canonicalSubscription,
      });
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.anything(),
      expect.anything(),
      preparedFamilyCryptoDomainRoots,
      undefined,
    );
    expect(
      mocks.prepareHostedStripeDirectMemberActivationCrypto,
    ).not.toHaveBeenCalled();
  });

  it("prepares Family candidates for a paid invoice still owned by the prior direct billing ref", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const preparedFamilyCryptoDomainRoots = new Map([
      ["member_123", new Map([["control", { domain: "control" }]])],
      ["member_family_child", new Map([["control", { domain: "control" }]])],
    ]);
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
      },
      status: "active",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeInvoice.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.findMemberForStripeSubscription.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots.mockResolvedValue(
      preparedFamilyCryptoDomainRoots,
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.prepareHostedFamilyStripeActivationCryptoDomainRoots)
      .toHaveBeenCalledWith({
        prisma: prisma.client,
        subscription: canonicalSubscription,
      });
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.anything(),
      HostedBillingStatus.active,
      canonicalSubscription,
      undefined,
      preparedFamilyCryptoDomainRoots,
    );
    expect(
      mocks.prepareHostedStripeDirectMemberActivationCrypto,
    ).not.toHaveBeenCalled();
  });

  it("prepares the live subscription before the member lock and revalidates its durable owner inside", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "trialing",
    });
    const ordering: string[] = [];
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeSubscription.mockImplementation(async (input: {
      subscription: Stripe.Subscription;
    }) => {
      ordering.push("member-resolved");
      return input.subscription.metadata.memberId === "member_123"
        ? { core: { id: "member_123" } }
        : null;
    });
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });
    mocks.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      ordering.push("subscription-prepared");
      return canonicalSubscription;
    });
    mocks.applyStripeSubscriptionUpdated.mockImplementationOnce(async () => {
      ordering.push("billing-written");
      return {
        activatedMemberId: null,
        activatedMembers: [],
        hostedExecutionEventId: null,
        welcomeEmailMemberId: null,
      };
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(ordering).toEqual([
      "subscription-prepared",
      "member-resolved",
      "member-locked",
      "member-resolved",
      "billing-written",
    ]);
    expect(mocks.findMemberForStripeSubscription).toHaveBeenCalledWith({
      prisma: prisma.client,
      subscription: canonicalSubscription,
    });
    expect(mocks.findMemberForStripeSubscription).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(prisma.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 780_000,
      },
    );
    expect(
      mocks.prepareHostedStripeDirectMemberActivationCrypto,
    ).not.toHaveBeenCalled();
  });

  it("fails closed when durable subscription ownership changes under the member lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(
      makeCanonicalSubscription({
        metadata: { memberId: "member_123" },
      }),
    );
    mocks.findMemberForStripeSubscription
      .mockResolvedValueOnce({ core: { id: "member_123" } })
      .mockResolvedValueOnce({ core: { id: "member_456" } });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);
    errorSpy.mockRestore();
  });

  it("rereads a discovered subscription owner after locking it", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(
      makeCanonicalSubscription({
        metadata: { memberId: "member_123" },
      }),
    );
    mocks.findMemberForStripeSubscription
      .mockResolvedValueOnce({ core: { id: "member_123" } })
      .mockResolvedValueOnce(null);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);
    errorSpy.mockRestore();
  });

  it("does not let an unowned subscription handler rediscover a member without its lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeSubscription
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ core: { id: "member_123" } });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.findMemberForStripeSubscription).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);
    errorSpy.mockRestore();
  });

  it("keeps an ambiguous Pulse Checkout as an explicit no-op", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.listHostedStripeCheckoutSessionMemberIds
      .mockResolvedValueOnce(["member_123", "member_456"])
      .mockResolvedValueOnce(["member_123", "member_456"])
      .mockResolvedValue(["member_123"]);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.listHostedStripeCheckoutSessionMemberIds).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
  });

  it("does not let an expired first attempt finalize a reclaimed second attempt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const firstApplyStarted = makeDeferred<void>();
    const releaseFirstApply = makeDeferred<void>();
    const secondApplyStarted = makeDeferred<void>();
    const releaseSecondApply = makeDeferred<void>();
    let applyCount = 0;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeSubscription.mockResolvedValue({ core: { id: "member_123" } });
    mocks.applyStripeSubscriptionUpdated.mockImplementation(async () => {
      applyCount += 1;
      if (applyCount === 1) {
        firstApplyStarted.resolve(undefined);
        await releaseFirstApply.promise;
      } else {
        secondApplyStarted.resolve(undefined);
        await releaseSecondApply.promise;
      }

      return {
        activatedMemberId: null,
        activatedMembers: [],
        hostedExecutionEventId: null,
        welcomeEmailMemberId: null,
      };
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    const claimStartedAt = Date.now();
    const firstAttempt = reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });

    await firstApplyStarted.promise;
    const claimExpiresAtMs = prisma.rows[0]?.claimExpiresAt?.getTime() ?? 0;
    expect(claimExpiresAtMs).toBeGreaterThanOrEqual(
      claimStartedAt + HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs,
    );
    expect(claimExpiresAtMs).toBeLessThanOrEqual(
      Date.now() + HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs,
    );

    const row = prisma.rows[0];
    if (!row) {
      throw new Error("Expected the Stripe event receipt to exist.");
    }
    row.claimExpiresAt = new Date(0);

    const secondAttempt = reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });
    await secondApplyStarted.promise;
    expect(row).toEqual(expect.objectContaining({
      attemptCount: 2,
      status: HostedStripeEventStatus.processing,
    }));

    releaseFirstApply.resolve(undefined);
    await expect(firstAttempt).resolves.toMatchObject({ status: "failed" });
    expect(row).toEqual(expect.objectContaining({
      attemptCount: 2,
      processedAt: null,
      status: HostedStripeEventStatus.processing,
    }));

    releaseSecondApply.resolve(undefined);
    await expect(secondAttempt).resolves.toMatchObject({ status: "completed" });
    expect(row).toEqual(expect.objectContaining({
      attemptCount: 2,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("routes subscription schedule updates to pending switch refresh only", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionScheduleEvent("subscription_schedule.updated");
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx).toHaveBeenCalledWith({
      schedule: event.data.object,
      tx: prisma.client,
    });
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  it.each([
    "subscription_schedule.released",
    "subscription_schedule.completed",
    "subscription_schedule.canceled",
    "subscription_schedule.aborted",
  ] as const)("routes %s to pending switch cleanup only", async (type) => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionScheduleEvent(type);
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx).toHaveBeenCalledWith({
      stripeSubscriptionScheduleId: "sched_123",
      tx: prisma.client,
    });
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  it.each([
    "subscription_schedule.created",
    "subscription_schedule.expiring",
  ] as const)("ignores %s for local pending switch state", async (type) => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionScheduleEvent(type);
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx).not.toHaveBeenCalled();
    expect(mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx).not.toHaveBeenCalled();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  it("routes invoice.payment_failed through the live Stripe subscription instead of the stale event payload", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "past_due",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.applyStripeInvoicePaymentFailed).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.invoice.payment_failed",
      }),
      expect.anything(),
      HostedBillingStatus.past_due,
      canonicalSubscription,
      expect.any(Map),
    );
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
  });

  it("prepares the live invoice subscription before the member lock and revalidates its durable owner inside", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      status: "past_due",
    });
    const ordering: string[] = [];
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeInvoice.mockImplementation(async () => {
      ordering.push("member-resolved");
      return { core: { id: "member_123" } };
    });
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });
    mocks.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      ordering.push("subscription-prepared");
      return canonicalSubscription;
    });
    mocks.applyStripeInvoicePaymentFailed.mockImplementationOnce(async () => {
      ordering.push("billing-written");
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(ordering).toEqual([
      "subscription-prepared",
      "member-resolved",
      "member-locked",
      "member-resolved",
      "billing-written",
    ]);
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
  });

  it("fails closed when an invoice owner disagrees with its canonical subscription", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      metadata: { memberId: "member_456" },
      status: "past_due",
    }));
    mocks.findMemberForStripeInvoice.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.findMemberForStripeSubscription.mockResolvedValue({
      core: { id: "member_456" },
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.applyStripeInvoicePaymentFailed).not.toHaveBeenCalled();
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);
    errorSpy.mockRestore();
  });

  it("reuses the prepared invoice subscription while revalidating durable identity under the lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "past_due",
    });
    const ordering: string[] = [];
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeInvoice.mockImplementation(async () => {
      ordering.push("identity-resolved");
      return { core: { id: "member_123" } };
    });
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });
    mocks.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      ordering.push("subscription-prepared");
      return canonicalSubscription;
    });
    mocks.applyStripeInvoicePaymentFailed.mockImplementationOnce(async () => {
      ordering.push("billing-written");
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(ordering).toEqual([
      "subscription-prepared",
      "identity-resolved",
      "member-locked",
      "identity-resolved",
      "billing-written",
    ]);
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.applyStripeInvoicePaymentFailed).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.anything(),
      HostedBillingStatus.past_due,
      canonicalSubscription,
      expect.any(Map),
    );
  });

  it.each([
    ["customer.subscription.deleted", "canceled"],
    ["customer.subscription.paused", "paused"],
    ["customer.subscription.resumed", "active"],
  ] as const)("routes %s through the live Stripe subscription", async (type, status) => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent(type);
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status,
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: `stripe.${type}`,
      }),
      expect.anything(),
      expect.any(Map),
      undefined,
    );
  });

  it("sends the cancellation feedback email after a cancellation billing write", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.deleted");
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "canceled",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValueOnce({
      subscriptionCancellationEmail: {
        memberId: "member_123",
        stripeSubscriptionId: "sub_123",
      },
    });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember)
      .toHaveBeenCalledWith({
        memberId: "member_123",
        prisma: prisma.client,
        stripeSubscriptionId: "sub_123",
      });
    expect(
      mocks.sendHostedSubscriptionCancellationEmailForMember.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(prisma.client.hostedStripeEvent.updateMany).mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      subscriptionCancellationEmailSentAt: expect.any(Date),
    }));
    expect(mocks.sendHostedSignupWelcomeEmailForMember).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("retries cancellation feedback email provider failures before completing the receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.deleted");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "canceled",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      subscriptionCancellationEmail: {
        memberId: "member_123",
        stripeSubscriptionId: "sub_123",
      },
    });
    mocks.sendHostedSubscriptionCancellationEmailForMember
      .mockRejectedValueOnce(new Error("resend down"))
      .mockResolvedValueOnce({
        status: "sent",
      });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "failed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: event.id,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0].nextAttemptAt = new Date(0);

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: event.id,
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));

    errorSpy.mockRestore();
  });

  it("does not resend cancellation feedback when provider success was marked before receipt completion failed", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.deleted");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "canceled",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      subscriptionCancellationEmail: {
        memberId: "member_123",
        stripeSubscriptionId: "sub_123",
      },
    });
    mocks.sendHostedSubscriptionCancellationEmailForMember.mockResolvedValue({
      status: "sent",
    });

    let failedCompletion = false;
    const defaultUpdateMany = vi.mocked(prisma.client.hostedStripeEvent.updateMany)
      .getMockImplementation();
    vi.mocked(prisma.client.hostedStripeEvent.updateMany).mockImplementation(async (input) => {
      if (
        !failedCompletion &&
        input.data.status === HostedStripeEventStatus.completed
      ) {
        failedCompletion = true;
        throw new Error("receipt completion failed");
      }

      if (!defaultUpdateMany) {
        throw new Error("missing default hostedStripeEvent.updateMany mock");
      }

      return defaultUpdateMany(input);
    });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "failed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
      subscriptionCancellationEmailSentAt: expect.any(Date),
    }));

    prisma.rows[0].nextAttemptAt = new Date(0);

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
      subscriptionCancellationEmailSentAt: expect.any(Date),
    }));

    errorSpy.mockRestore();
  });

  it("does not send the cancellation feedback email when the cancellation billing write fails", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.deleted");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "canceled",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.applyStripeSubscriptionUpdated.mockRejectedValueOnce(
      new Error("billing write failed"),
    );

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember)
      .not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: event.id,
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    expect(errorSpy).toHaveBeenCalledWith("Hosted Stripe event reconciliation failed.", {
      attemptCount: 1,
      errorMessage: "billing write failed",
      errorName: "Error",
      eventIdSuffix: "ed_123",
      eventType: "customer.subscription.deleted",
      poisoned: false,
    });
    errorSpy.mockRestore();
  });

  it("reconciles trial_will_end through the canonical subscription owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const metadata = {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
    };
    const event = makeSubscriptionEvent(
      "customer.subscription.trial_will_end",
      { metadata },
    );
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata,
      status: "trialing",
    });
    const preparedCryptoDomainRoots = new Map([
      ["runtime", { domain: "runtime" }],
    ]);
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(
      canonicalSubscription,
    );
    mocks.prepareHostedCryptoDomainRootCandidates.mockResolvedValueOnce(
      preparedCryptoDomainRoots,
    );

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalled();
    expect(mocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledWith({
      prisma: prisma.client,
      userId: "member_123",
    });
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.customer.subscription.trial_will_end",
      }),
      prisma.client,
      expect.any(Map),
      preparedCryptoDomainRoots,
    );
  });

  it("resolves refund customer context from the live Stripe event", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeRefundCreatedEvent();
    const operationOrder: string[] = [];
    const preparedProviderState = {
      memberId: "member_123",
      refundCoversCurrentEntitlement: true,
      stripeSubscriptionId: "sub_123",
      subscription: null,
    };
    mocks.resolveStripeCustomerContext.mockResolvedValue({
      customerId: "cus_refund",
    });
    mocks.prepareHostedStripeReversalProviderState.mockImplementationOnce(
      async () => {
        operationOrder.push("provider-prepared");
        return preparedProviderState;
      },
    );
    prisma.client.$queryRaw = vi.fn(async () => {
      operationOrder.push("member-locked");
      return [];
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.resolveStripeCustomerContext).toHaveBeenCalledWith({
      chargeId: "ch_refund",
      paymentIntentId: "pi_refund",
    });
    expect(mocks.findMemberForStripeReversal).toHaveBeenCalledWith({
      chargeId: "ch_refund",
      customerId: "cus_refund",
      paymentIntentId: "pi_refund",
      prisma: prisma.client,
      subscriptionId: null,
    });
    expect(mocks.prepareHostedStripeReversalProviderState).toHaveBeenCalledWith({
      event,
      memberId: "member_123",
      prisma: prisma.client,
    });
    expect(operationOrder).toEqual([
      "provider-prepared",
      "member-locked",
    ]);
    expect(mocks.applyStripeRefundCreated).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.refund.created",
      }),
      expect.anything(),
      "cus_refund",
      preparedProviderState,
    );
  });

  it("dispatches refund.updated through the same live reversal owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = {
      ...makeRefundCreatedEvent(),
      id: "evt_refund_updated_123",
      type: "refund.updated",
    } as Stripe.Event;
    const preparedProviderState = {
      memberId: "member_123",
      refundCoversCurrentEntitlement: true,
      stripeSubscriptionId: "sub_123",
      subscription: null,
    };
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.resolveStripeCustomerContext.mockResolvedValue({
      customerId: "cus_refund",
    });
    mocks.prepareHostedStripeReversalProviderState.mockResolvedValueOnce(
      preparedProviderState,
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeRefundCreated).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.refund.updated",
      }),
      expect.anything(),
      "cus_refund",
      preparedProviderState,
    );
  });

  it("rejects reversal processing when durable ownership changes under the member lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeRefundCreatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeReversal
      .mockResolvedValueOnce({ core: { id: "member_123" } })
      .mockResolvedValueOnce({ core: { id: "member_other" } });
    mocks.prepareHostedStripeReversalProviderState.mockResolvedValueOnce({
      memberId: "member_123",
      refundCoversCurrentEntitlement: true,
      stripeSubscriptionId: "sub_123",
      subscription: null,
    });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "failed",
    });

    expect(mocks.findMemberForStripeReversal).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeRefundCreated).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("marks the receipt failed when Stripe event retrieval fails", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockRejectedValue(new Error("Stripe unavailable"));

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: "evt_invoice_paid_123",
      lastErrorCode: "HOSTED_STRIPE_EVENT_RETRIEVE_RETRYABLE",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
    expect(errorSpy).toHaveBeenCalledWith("Hosted Stripe event reconciliation failed.", {
      attemptCount: 1,
      errorMessage: "Stripe unavailable",
      errorName: "HostedStripeEventRetrieveRetryableError",
      eventIdSuffix: "id_123",
      eventType: "invoice.paid",
      poisoned: false,
    });
  });

  it("logs bounded Prisma diagnostics when Stripe reconciliation fails after retrieval", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        "Raw query failed. Code: `42P01`. Message: `relation \"missing_table\" does not exist while reading /tmp/app with token=secret`",
        {
          clientVersion: "7.5.0",
          code: "P2010",
          meta: {
            code: "42P01",
            modelName: "HostedMailboxItem",
            secretValue: "do-not-log",
            table: "missing_table",
          },
        },
      ),
    );

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(errorSpy).toHaveBeenCalledWith("Hosted Stripe event reconciliation failed.", {
      attemptCount: 1,
      errorCode: "P2010",
      errorName: "PrismaClientKnownRequestError",
      eventIdSuffix: "id_123",
      eventType: "invoice.paid",
      poisoned: false,
      prismaClientVersion: "7.5.0",
      prismaCode: "P2010",
      prismaMessage:
        "Raw query failed. Code: `42P01`. Message: `relation \"missing_table\" does not exist while reading <redacted-path> with token=<redacted-secret>",
      prismaMeta: {
        modelName: "HostedMailboxItem",
        table: "missing_table",
      },
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      lastErrorCode: "P2010",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
  });

});

function makeInvoicePaidEvent(overrides?: {
  id?: string;
  invoiceId?: string;
}): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708800,
    data: {
      object: {
        amount_due: 2000,
        amount_paid: 2000,
        amount_remaining: 0,
        charge: "ch_123",
        currency: "usd",
        customer: "cus_123",
        id: overrides?.invoiceId ?? "in_123",
        payment_intent: "pi_123",
        post_payment_credit_notes_amount: 0,
        pre_payment_credit_notes_amount: 0,
        starting_balance: 0,
        status: "paid",
        subscription: "sub_123",
      },
    },
    id: overrides?.id ?? "evt_invoice_paid_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "invoice.paid",
  });
}

function makeInvoicePaymentFailedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708804,
    data: {
      object: {
        amount_due: 2000,
        charge: "ch_123",
        currency: "usd",
        customer: "cus_123",
        id: "in_123",
        payment_intent: "pi_123",
        subscription: "sub_123",
      },
    },
    id: "evt_invoice_payment_failed_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "invoice.payment_failed",
  });
}

function makeCheckoutCompletedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708801,
    data: {
      object: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        id: "cs_checkout_123",
        metadata: {
          memberId: "member_123",
        },
        subscription: "sub_checkout_123",
      },
    },
    id: "evt_checkout_completed_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "checkout.session.completed",
  });
}

function makePulseTrialCheckoutCompletedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708801,
    data: {
      object: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        id: "cs_trial_123",
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_123",
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        },
        mode: "subscription",
        status: "complete",
        subscription: "sub_checkout_123",
      },
    },
    id: "evt_trial_checkout_completed_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "checkout.session.completed",
  });
}

function makeExactPulseTrialCheckoutCompletedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1_774_708_801,
    data: {
      object: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        id: "cs_exact_trial_123",
        metadata: makeExactPulseTrialMetadata(),
        mode: "subscription",
        status: "complete",
        subscription: "sub_checkout_123",
      },
    },
    id: "evt_exact_trial_checkout_completed_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "checkout.session.completed",
  });
}

function makeExactPulseTrialSubscriptionCreatedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1_774_708_800,
    data: {
      object: {
        customer: "cus_checkout",
        id: "sub_checkout_123",
        metadata: makeExactPulseTrialMetadata(),
        status: "trialing",
      },
    },
    id: "evt_exact_trial_subscription_created_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "customer.subscription.created",
  });
}

function makeExactPulseTrialSubscription(
  status: Stripe.Subscription.Status,
): Stripe.Subscription {
  return {
    customer: "cus_checkout",
    id: "sub_checkout_123",
    items: {
      data: [{
        id: "si_pulse_123",
        price: {
          id: "price_pulse_monthly_123",
          recurring: {
            interval: "month",
            usage_type: "licensed",
          },
        },
        quantity: 1,
      }],
      has_more: false,
    },
    metadata: makeExactPulseTrialMetadata(),
    status,
    trial_end: 1_775_313_600,
    trial_start: 1_774_708_000,
  } as Stripe.Subscription;
}

function makeExactPulseTrialMetadata(): Record<string, string> {
  return {
    billingPlanCode: "launch_monthly",
    checkoutOffer: "pulse_trial_7d",
    memberId: "member_123",
    trialDurationDays: "10",
    trialPolicyVersion: "pulse-trial-2026-06-30-v2",
    trialUsageLimitUsdMicros: "4500000",
  };
}

function makeActiveNonTrialMemberWithoutSubscription() {
  return {
    billingRef: {
      currentBillingPhase: null,
      memberId: "member_123",
      pulseTrialRedeemedAt: null,
      stripeCustomerId: "cus_checkout",
      stripeSubscriptionId: null,
    },
    core: {
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-03-28T12:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-03-28T12:00:00.000Z"),
    },
  };
}

function makeSubscriptionUpdatedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708802,
    data: {
      object: {
        customer: "cus_subscription",
        id: "sub_123",
        metadata: {
          memberId: "member_123",
        },
        status: "past_due",
      },
    },
    id: "evt_subscription_updated_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "customer.subscription.updated",
  });
}

function makeSubscriptionEvent(
  type:
    | "customer.subscription.created"
    | "customer.subscription.deleted"
    | "customer.subscription.paused"
    | "customer.subscription.resumed"
    | "customer.subscription.trial_will_end",
  overrides?: {
    metadata?: Record<string, string>;
  },
): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708805,
    data: {
      object: {
        customer: "cus_subscription",
        id: "sub_123",
        metadata: overrides?.metadata ?? {
          memberId: "member_123",
        },
        status: type === "customer.subscription.deleted"
          ? "canceled"
          : type === "customer.subscription.paused"
          ? "paused"
          : type === "customer.subscription.trial_will_end"
            ? "trialing"
            : "active",
      },
    },
    id: `evt_${type.replace(/\./gu, "_")}_123`,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  });
}

function makeRefundCreatedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708803,
    data: {
      object: {
        charge: "ch_refund",
        id: "re_123",
        payment_intent: "pi_refund",
      },
    },
    id: "evt_refund_created_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "refund.created",
  });
}

function makeSubscriptionScheduleEvent(
  type:
    | "subscription_schedule.created"
    | "subscription_schedule.updated"
    | "subscription_schedule.released"
    | "subscription_schedule.completed"
    | "subscription_schedule.canceled"
    | "subscription_schedule.aborted"
    | "subscription_schedule.expiring",
): Stripe.Event {
  const scheduleStatusByType: Record<typeof type, Stripe.SubscriptionSchedule.Status> = {
    "subscription_schedule.aborted": "canceled",
    "subscription_schedule.canceled": "canceled",
    "subscription_schedule.completed": "completed",
    "subscription_schedule.created": "active",
    "subscription_schedule.expiring": "active",
    "subscription_schedule.released": "released",
    "subscription_schedule.updated": "active",
  };

  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708804,
    data: {
      object: {
        id: "sched_123",
        object: "subscription_schedule",
        status: scheduleStatusByType[type],
      },
    },
    id: `evt_${type.replace(/\./gu, "_")}_123`,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  });
}

function makeCanonicalSubscription(overrides?: Partial<{
  customer: string;
  id: string;
  metadata: Record<string, string>;
  status: Stripe.Subscription.Status;
}>): Stripe.Subscription {
  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "sub_123",
    metadata: overrides?.metadata ?? {},
    status: overrides?.status ?? "active",
  } as Stripe.Subscription;
}

function makeStripeEvent<
  TType extends Stripe.Event.Type,
  TObject extends Record<string, unknown>,
>(event: StripeTestEvent<TType, TObject>): Stripe.Event {
  // The synthetic fixtures are intentionally narrower than Stripe's generated event union.
  // Keep the boundary explicit instead of widening the test data shape.
  // @ts-expect-error - synthetic Stripe event fixtures are narrower than Stripe.Event.
  return event as Stripe.Event;
}

function createStripeEventPrismaHarness(input?: {
  currentBillingPhase?: string | null;
}) {
  const rows: MutableStripeEventRow[] = [];
  const transaction = vi.fn(
    async <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => callback(client),
  ) as StripeEventPrismaHarnessClient["$transaction"];

  const client: StripeEventPrismaHarnessClient = {
    $queryRaw: vi.fn(async () => []),
    $transaction: transaction,
    hostedMember: {
      findUnique: vi.fn(async () => input?.currentBillingPhase === undefined
        ? null
        : {
            billingRef: {
              currentBillingPhase: input.currentBillingPhase,
            },
          }),
    },
    hostedStripeEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: MutableStripeEventRow = {
          attemptCount: data.attemptCount as number,
          claimExpiresAt: null,
          createdAt: new Date(),
          eventId: data.eventId as string,
          lastErrorCode: null,
          lastErrorMessage: null,
          nextAttemptAt: data.nextAttemptAt as Date,
          processedAt: null,
          receivedAt: data.receivedAt as Date,
          status: data.status as HostedStripeEventStatus,
          stripeCreatedAt: data.stripeCreatedAt as Date,
          subscriptionCancellationEmailSentAt: null,
          type: data.type as string,
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) => {
        const row = rows.find((candidate) => candidate.eventId === where.eventId);
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: StripeEventWhere }) => {
        const row = rows.find((candidate) => matchesStripeEventWhere(candidate, where));

        if (!row) {
          return { count: 0 };
        }

        if ("subscriptionCancellationEmailSentAt" in data) {
          row.subscriptionCancellationEmailSentAt =
            data.subscriptionCancellationEmailSentAt as Date;
          row.updatedAt = new Date();
          return { count: 1 };
        }

        if (data.attemptCount && typeof data.attemptCount === "object") {
          row.attemptCount += (data.attemptCount as { increment: number }).increment;
          row.claimExpiresAt = data.claimExpiresAt as Date;
          row.lastErrorCode = data.lastErrorCode as string | null;
          row.lastErrorMessage = data.lastErrorMessage as string | null;
          row.nextAttemptAt = data.nextAttemptAt as Date;
          row.status = data.status as HostedStripeEventStatus;
        } else {
          Object.assign(row, data);
        }
        row.updatedAt = new Date();
        return { count: 1 };
      }),
    },
  };

  return {
    client,
    rows,
  };
}

function makeDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function matchesStripeEventWhere(row: MutableStripeEventRow, where: StripeEventWhere): boolean {
  if (where.eventId && row.eventId !== where.eventId) {
    return false;
  }

  if (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime()) {
    return false;
  }

  if (where.attemptCount !== undefined && row.attemptCount !== where.attemptCount) {
    return false;
  }

  if (where.status !== undefined && row.status !== where.status) {
    return false;
  }

  if (
    where.subscriptionCancellationEmailSentAt === null
    && row.subscriptionCancellationEmailSentAt !== null
  ) {
    return false;
  }

  if (!where.OR) {
    return true;
  }

  return where.OR.some((condition) => {
    if ("claimExpiresAt" in condition) {
      return row.status === HostedStripeEventStatus.processing
        && row.claimExpiresAt !== null
        && condition.claimExpiresAt?.lte instanceof Date
        && row.claimExpiresAt.getTime() <= condition.claimExpiresAt.lte.getTime();
    }

    const retryCondition = condition as {
      nextAttemptAt?: {
        lte: Date;
      };
      status: "failed" | "pending";
    };

    return row.status === retryCondition.status
      && retryCondition.nextAttemptAt?.lte instanceof Date
      && row.nextAttemptAt.getTime() <= retryCondition.nextAttemptAt.lte.getTime();
  });
}

type MutableStripeEventRow = {
  attemptCount: number;
  claimExpiresAt: Date | null;
  createdAt: Date;
  eventId: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextAttemptAt: Date;
  processedAt: Date | null;
  receivedAt: Date;
  status: HostedStripeEventStatus;
  stripeCreatedAt: Date;
  subscriptionCancellationEmailSentAt: Date | null;
  type: string;
  updatedAt: Date;
};

type StripeEventWhere = {
  attemptCount?: number;
  eventId?: string;
  status?: HostedStripeEventStatus;
  subscriptionCancellationEmailSentAt?: null;
  updatedAt?: Date;
  OR?: Array<
    | {
        claimExpiresAt?: {
          lte: Date;
        };
        status: "processing";
      }
    | {
        nextAttemptAt?: {
          lte: Date;
        };
        status:
          | "pending"
          | "failed";
      }
  >;
};
