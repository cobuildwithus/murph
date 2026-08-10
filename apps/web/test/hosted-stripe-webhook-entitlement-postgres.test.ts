import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  HostedStripeEventStatus,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

const workflowBoundary = vi.hoisted(() => ({
  start: vi.fn(async () => ({ runId: "run_hosted_stripe_fixture" })),
}));
const runtimeRecheckBoundary = vi.hoisted(() => ({
  signal: vi.fn(async () => ({
    signalAccepted: true,
    workflowId: "hosted-user-runtime:fixture",
  })),
}));
const familyPreparationBoundary = vi.hoisted(() => ({
  prepare: vi.fn(async () => new Map()),
}));
const directPreparationBoundary = vi.hoisted(() => ({
  prepare: vi.fn(async () => new Map()),
}));

vi.mock(
  "@/src/lib/hosted-onboarding/stripe-webhook-workflow-start",
  () => ({
    startHostedStripeWebhookReconciliationWorkflow: workflowBoundary.start,
  }),
);

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >("@/src/lib/hosted-crypto/domain-root-store");

  return {
    ...actual,
    prepareHostedCryptoDomainRootCandidates: directPreparationBoundary.prepare,
  };
});

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-orchestration/signal-runtime")
  >("@/src/lib/hosted-orchestration/signal-runtime");

  return {
    ...actual,
    signalHostedRuntimeRecheckRuntime: runtimeRecheckBoundary.signal,
  };
});

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");

  return {
    ...actual,
    prepareHostedFamilyStripeActivationCryptoDomainRoots:
      familyPreparationBoundary.prepare,
  };
});

import { POST as postHostedStripeWebhook } from "@/app/api/hosted-onboarding/stripe/webhook/route";
import {
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  readHostedPersonalAiUsageStatus,
} from "@/src/lib/hosted-execution/usage-status";
import {
  removeHostedFamilyMemberTx,
  writeHostedAccountGroupStripeBillingTx,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  bindHostedMemberStripeCheckoutSessionTx,
  prepareHostedMemberStripeCheckoutCompletion,
  prepareHostedMemberStripeCheckoutSession,
  reserveHostedMemberStripeCheckoutAttemptUnderLockTx,
  writeHostedMemberStripeBillingRefTx,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  readHostedMemberBillingSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  suspendHostedMemberForBillingReversalTx,
  terminalizeHostedFamilySponsoredDirectBillingTx,
} from "@/src/lib/hosted-onboarding/stripe-billing-policy";
import {
  bindHostedStripeBillingRefsFromCheckoutSessionTx,
  cleanupHostedFamilySponsoredDirectSubscription,
  HostedStripeFamilySponsoredCleanupPendingError,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";
import {
  readHostedOnboardingEnvironment,
} from "@/src/lib/hosted-onboarding/env";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import {
  processRecordedHostedStripeWebhookEvent,
} from "@/src/lib/hosted-onboarding/stripe-webhook-reconciliation";
import {
  recordHostedStripeEvent,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  startHostedStripeHttpFixture,
} from "./support/hosted-stripe-http-fixture";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted Stripe webhook entitlement proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted Stripe webhook entitlement with PostgreSQL",
  () => {
    it("applies an older proven-current full refund without moving the billing cursor backward", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const memberId = `hbm_refund_freshness_${fixtureId}`;
      const stripeCustomerId = `cus_refund_freshness_${fixtureId}`;
      const stripeSubscriptionId = `sub_refund_freshness_${fixtureId}`;
      const refundCreatedAt = new Date("2026-07-01T12:00:00.000Z");
      const newerBillingCursor = new Date("2026-07-01T12:05:00.000Z");

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        await prisma.$transaction((tx) =>
          writeHostedMemberStripeBillingRefTx({
            memberId,
            stripeCustomerId,
            stripeEventCreatedAt: newerBillingCursor,
            stripeSubscriptionId,
            tx,
          })
        );
        const member = await readHostedMemberBillingSnapshot({
          memberId,
          prisma,
        });
        expect(member).not.toBeNull();
        if (!member) {
          throw new Error("Refund freshness fixture member was not created.");
        }

        await prisma.$transaction((tx) =>
          suspendHostedMemberForBillingReversalTx({
            canonicalBillingStatus: HostedBillingStatus.active,
            dispatchContext: {
              eventCreatedAt: refundCreatedAt,
              sourceEventId: `evt_refund_freshness_${fixtureId}`,
              sourceType: "stripe.refund.updated",
            },
            freshnessPolicy: "proven-current-refund",
            member,
            stripeCustomerId,
            stripeSubscriptionId,
            tx,
          })
        );

        await expect(readHostedMemberBillingSnapshot({ memberId, prisma }))
          .resolves.toMatchObject({
            billingRef: {
              lastStripeEventCreatedAt: newerBillingCursor,
              stripeCustomerId,
              stripeSubscriptionId,
            },
            core: {
              billingStatus: HostedBillingStatus.unpaid,
              suspendedAt: newerBillingCursor,
            },
          });
      } finally {
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });

    it("terminalizes only the exact Family-sponsored direct subscription", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const memberId = `hbm_family_cleanup_${fixtureId}`;
      const stripeCustomerId = `cus_family_cleanup_${fixtureId}`;
      const losingSubscriptionId = `sub_family_cleanup_loser_${fixtureId}`;
      const replacementSubscriptionId = `sub_family_cleanup_replacement_${fixtureId}`;
      const cleanupCreatedAt = new Date("2026-07-01T13:00:00.000Z");

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        await prisma.$transaction((tx) =>
          writeHostedMemberStripeBillingRefTx({
            memberId,
            stripeCustomerId,
            stripeSubscriptionId: losingSubscriptionId,
            tx,
          })
        );

        await expect(prisma.$transaction((tx) =>
          terminalizeHostedFamilySponsoredDirectBillingTx({
            dispatchContext: {
              eventCreatedAt: cleanupCreatedAt,
              occurredAt: cleanupCreatedAt.toISOString(),
              sourceEventId: `evt_family_cleanup_${fixtureId}`,
              sourceType: "stripe.customer.subscription.deleted",
            },
            memberId,
            stripeSubscriptionId: losingSubscriptionId,
            tx,
          })
        )).resolves.toBe(true);
        await expect(readHostedMemberBillingSnapshot({ memberId, prisma }))
          .resolves.toMatchObject({
            billingRef: { stripeSubscriptionId: losingSubscriptionId },
            core: { billingStatus: HostedBillingStatus.canceled },
          });

        await prisma.hostedMember.update({
          data: { billingStatus: HostedBillingStatus.active },
          where: { id: memberId },
        });
        await prisma.$transaction((tx) =>
          writeHostedMemberStripeBillingRefTx({
            memberId,
            stripeCustomerId,
            stripeEventCreatedAt: new Date(cleanupCreatedAt.getTime() + 1_000),
            stripeSubscriptionId: replacementSubscriptionId,
            tx,
          })
        );

        await expect(prisma.$transaction((tx) =>
          terminalizeHostedFamilySponsoredDirectBillingTx({
            dispatchContext: {
              eventCreatedAt: new Date(cleanupCreatedAt.getTime() + 2_000),
              occurredAt: new Date(
                cleanupCreatedAt.getTime() + 2_000,
              ).toISOString(),
              sourceEventId: `evt_family_cleanup_replay_${fixtureId}`,
              sourceType: "stripe.customer.subscription.deleted",
            },
            memberId,
            stripeSubscriptionId: losingSubscriptionId,
            tx,
          })
        )).resolves.toBe(false);
        await expect(readHostedMemberBillingSnapshot({ memberId, prisma }))
          .resolves.toMatchObject({
            billingRef: { stripeSubscriptionId: replacementSubscriptionId },
            core: { billingStatus: HostedBillingStatus.active },
          });
      } finally {
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });

    it("lets Family removal win before Checkout loser cleanup without touching Stripe", async () => {
      const ownerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const cleanupClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixture = await seedFamilySponsoredDirectCleanupFixture(
        ownerClient,
        { pendingCheckout: true },
      );
      const ownerLocked = createDeferred();
      const continueRemoval = createDeferred();
      const cleanupPid = await readBackendPid(cleanupClient);
      const stripe = buildFamilyCleanupStripe({
        familyCustomerId: fixture.familyCustomerId,
        familySubscriptionId: fixture.familySubscriptionId,
        groupId: fixture.groupId,
        memberId: fixture.memberId,
        ownerMemberId: fixture.ownerMemberId,
        subscriptionId: fixture.directSubscriptionId,
      });

      const removal = ownerClient.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, fixture.ownerMemberId);
        ownerLocked.resolve();
        await continueRemoval.promise;
        return removeHostedFamilyMemberTx({
          groupId: fixture.groupId,
          memberId: fixture.memberId,
          ownerMemberId: fixture.ownerMemberId,
          tx,
        });
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

      try {
        await ownerLocked.promise;
        const cleanup = cleanupHostedFamilySponsoredDirectSubscription({
          checkoutSessionId: fixture.checkoutSessionId,
          memberId: fixture.memberId,
          prisma: cleanupClient,
          refundCheckoutPayment: true,
          sourceEventId: `evt_family_checkout_cleanup_${fixture.fixtureId}`,
          stripe: stripe.client,
          subscriptionId: fixture.directSubscriptionId,
        });
        await waitForBlockedBackend({ observer, pid: cleanupPid });
        continueRemoval.resolve();

        await expect(removal).resolves.toBe(true);
        await expect(cleanup).rejects.toBeInstanceOf(
          HostedStripeFamilySponsoredCleanupPendingError,
        );

        expect(stripe.retrieve).not.toHaveBeenCalled();
        expect(stripe.cancel).not.toHaveBeenCalled();
        expect(stripe.listInvoices).not.toHaveBeenCalled();
        const preparedCompletion =
          await prepareHostedMemberStripeCheckoutCompletion({
            memberId: fixture.memberId,
            prisma: cleanupClient,
            stripeCustomerId: fixture.directCustomerId,
            stripeSubscriptionId: fixture.directSubscriptionId,
          });
        await expect(cleanupClient.$transaction((tx) =>
          bindHostedStripeBillingRefsFromCheckoutSessionTx({
            billingIdentityDisposition: "bind",
            dispatchContext: {
              eventCreatedAt: new Date("2026-07-01T12:01:00.000Z"),
              sourceEventId: `evt_family_checkout_replay_${fixture.fixtureId}`,
            },
            memberId: fixture.memberId,
            preparedCompletion,
            preparedStripeCheckoutEmail: null,
            session: {
              customer: fixture.directCustomerId,
              id: fixture.checkoutSessionId,
              metadata: {
                checkoutAttemptId: fixture.checkoutAttemptId,
                checkoutIntentHash: fixture.checkoutIntentHash,
              },
              subscription: fixture.directSubscriptionId,
            } as never,
            tx,
          })
        )).resolves.toMatchObject({ kind: "accepted" });
        await expect(readHostedMemberBillingSnapshot({
          memberId: fixture.memberId,
          prisma: observer,
        })).resolves.toMatchObject({
          billingRef: {
            stripeSubscriptionId: fixture.directSubscriptionId,
          },
          core: { billingStatus: HostedBillingStatus.active },
        });
      } finally {
        continueRemoval.resolve();
        await Promise.allSettled([removal]);
        await deleteFamilyCleanupFixture(observer, fixture);
        await Promise.all([
          ownerClient.$disconnect(),
          cleanupClient.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });

    it("refunds a terminal direct Checkout replay before retiring its exact attempt and receipt", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixture = await seedFamilySponsoredDirectCleanupFixture(
        prisma,
        { pendingCheckout: true },
      );
      const eventId = `evt_family_checkout_partial_${fixture.fixtureId}`;
      const event = {
        created: Math.floor(Date.now() / 1_000),
        data: {
          object: {
            customer: fixture.directCustomerId,
            id: fixture.checkoutSessionId,
            metadata: {
              billingPlanCode: "launch_monthly",
              checkoutAttemptId: fixture.checkoutAttemptId,
              checkoutIntentHash: fixture.checkoutIntentHash,
              checkoutOffer: "standard",
              memberId: fixture.memberId,
            },
            object: "checkout.session",
            status: "complete",
            subscription: fixture.directSubscriptionId,
          },
        },
        id: eventId,
        object: "event",
        type: "checkout.session.completed",
      } as never;
      let directStatus: Stripe.Subscription.Status = "active";
      const directSubscription = () => ({
        customer: fixture.directCustomerId,
        id: fixture.directSubscriptionId,
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: fixture.memberId,
        },
        status: directStatus,
      }) as never;
      const familySubscription = {
        customer: fixture.familyCustomerId,
        id: fixture.familySubscriptionId,
        metadata: {
          accountGroupId: fixture.groupId,
          billingPlanCode: "launch_family_monthly",
          kind: "hosted_family_plan",
          ownerMemberId: fixture.ownerMemberId,
        },
        status: "active",
      } as never;
      const retrieve = vi.fn(async (subscriptionId: string) => {
        if (subscriptionId === fixture.directSubscriptionId) {
          return directSubscription();
        }
        if (subscriptionId === fixture.familySubscriptionId) {
          return familySubscription;
        }
        throw Object.assign(new Error("Stripe subscription was not found."), {
          code: "resource_missing",
        });
      });
      const cancel = vi.fn(async () => {
        directStatus = "canceled";
        return directSubscription();
      });
      const listInvoices = vi.fn()
        .mockRejectedValueOnce(new Error("Stripe invoice lookup unavailable"))
        .mockResolvedValue({
          data: [{
            amount_due: 5_000,
            amount_paid: 5_000,
            amount_remaining: 0,
            id: `in_family_checkout_partial_${fixture.fixtureId}`,
            post_payment_credit_notes_amount: 0,
            pre_payment_credit_notes_amount: 0,
            starting_balance: 0,
            status: "paid",
          }],
          has_more: false,
        });
      const listInvoicePayments = vi.fn(async () => ({
        data: [{
          amount_paid: 5_000,
          amount_requested: 5_000,
          payment: {
            payment_intent: {
              amount_received: 5_000,
              id: `pi_family_checkout_partial_${fixture.fixtureId}`,
              status: "succeeded",
            },
            type: "payment_intent",
          },
        }],
        has_more: false,
      }));
      const listRefunds = vi.fn(async () => ({ data: [], has_more: false }));
      const createRefund = vi.fn(async () => ({
        amount: 5_000,
        id: `re_family_checkout_partial_${fixture.fixtureId}`,
        status: "succeeded",
      }));
      const stripe = {
        events: { retrieve: vi.fn(async () => event) },
        invoicePayments: { list: listInvoicePayments },
        invoices: { list: listInvoices },
        refunds: { create: createRefund, list: listRefunds },
        subscriptions: { cancel, retrieve },
      } as never;
      const runtimeGlobals = readHostedStripeRuntimeGlobals();

      configureHostedStripeFixtureEnvironment({
        edgePriceId: `price_edge_${fixture.fixtureId}`,
        pulsePriceId: `price_pulse_${fixture.fixtureId}`,
        stripe,
        webhookSecret: "whsec_family_checkout_partial_fixture",
      });

      try {
        await recordHostedStripeEvent({ event, prisma });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId,
          prisma,
          timeoutMs: 5_000,
        })).rejects.toBeDefined();

        expect(directStatus).toBe("canceled");
        expect(cancel).toHaveBeenCalledOnce();
        expect(createRefund).not.toHaveBeenCalled();
        await expect(readStripeReceiptProof({ eventId, prisma }))
          .resolves.toMatchObject({
            attemptCount: 1,
            processedAt: null,
            status: HostedStripeEventStatus.failed,
          });
        await expect(readFamilyCheckoutAttemptProof({
          memberId: fixture.memberId,
          prisma,
        })).resolves.toMatchObject({
          checkoutAttemptId: fixture.checkoutAttemptId,
          stripeCheckoutSessionLookupKey: expect.any(String),
          stripeSubscriptionLookupKey: null,
        });

        await expect(prisma.$transaction((tx) =>
          removeHostedFamilyMemberTx({
            groupId: fixture.groupId,
            memberId: fixture.memberId,
            ownerMemberId: fixture.ownerMemberId,
            tx,
          }),
          HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
        )).resolves.toBe(true);
        await makeStripeReceiptImmediatelyRetryable({ eventId, prisma });

        await expect(processRecordedHostedStripeWebhookEvent({
          eventId,
          prisma,
          timeoutMs: 5_000,
        })).resolves.toEqual({ accepted: true, required: false });

        expect(cancel).toHaveBeenCalledOnce();
        expect(listInvoices).toHaveBeenCalledTimes(2);
        expect(listInvoicePayments).toHaveBeenCalledOnce();
        expect(listRefunds).toHaveBeenCalledOnce();
        expect(createRefund).toHaveBeenCalledOnce();
        await expect(readStripeReceiptProof({ eventId, prisma }))
          .resolves.toMatchObject({
            attemptCount: 2,
            processedAt: expect.any(Date),
            status: HostedStripeEventStatus.completed,
          });
        await expect(readFamilyCheckoutAttemptProof({
          memberId: fixture.memberId,
          prisma,
        })).resolves.toEqual({
          checkoutAttemptId: null,
          stripeCheckoutSessionLookupKey: null,
          stripeSubscriptionLookupKey: null,
        });
      } finally {
        clearHostedStripeFixtureEnvironment(runtimeGlobals);
        await prisma.hostedStripeEvent.deleteMany({ where: { eventId } });
        await deleteFamilyCleanupFixture(prisma, fixture);
        await prisma.$disconnect();
      }
    }, 60_000);

    it("completes an accepted terminal Checkout replay without refund cleanup", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const memberId = `hbm_accepted_terminal_checkout_${fixtureId}`;
      const stripeCustomerId = `cus_accepted_terminal_checkout_${fixtureId}`;
      const stripeSubscriptionId = `sub_accepted_terminal_checkout_${fixtureId}`;
      const checkoutSessionId = `cs_accepted_terminal_checkout_${fixtureId}`;
      const eventId = `evt_accepted_terminal_checkout_${fixtureId}`;
      const event = {
        created: Math.floor(Date.now() / 1_000),
        data: {
          object: {
            customer: stripeCustomerId,
            id: checkoutSessionId,
            metadata: {
              billingPlanCode: "launch_monthly",
              checkoutAttemptId: `attempt_accepted_terminal_${fixtureId}`,
              checkoutIntentHash: `intent_accepted_terminal_${fixtureId}`,
              checkoutOffer: "standard",
              memberId,
            },
            object: "checkout.session",
            status: "complete",
            subscription: stripeSubscriptionId,
          },
        },
        id: eventId,
        object: "event",
        type: "checkout.session.completed",
      } as never;
      const subscription = {
        customer: stripeCustomerId,
        id: stripeSubscriptionId,
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId,
        },
        status: "canceled",
      } as never;
      const retrieve = vi.fn(async () => subscription);
      const cancel = vi.fn();
      const listInvoices = vi.fn();
      const listInvoicePayments = vi.fn();
      const listRefunds = vi.fn();
      const createRefund = vi.fn();
      const stripe = {
        events: { retrieve: vi.fn(async () => event) },
        invoicePayments: { list: listInvoicePayments },
        invoices: { list: listInvoices },
        refunds: { create: createRefund, list: listRefunds },
        subscriptions: { cancel, retrieve },
      } as never;
      const runtimeGlobals = readHostedStripeRuntimeGlobals();

      configureHostedStripeFixtureEnvironment({
        edgePriceId: `price_edge_${fixtureId}`,
        pulsePriceId: `price_pulse_${fixtureId}`,
        stripe,
        webhookSecret: "whsec_accepted_terminal_checkout_fixture",
      });

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        await prisma.$transaction((tx) =>
          writeHostedMemberStripeBillingRefTx({
            memberId,
            stripeCustomerId,
            stripeEventCreatedAt: new Date("2026-07-01T12:00:00.000Z"),
            stripeSubscriptionId,
            tx,
          })
        );
        await recordHostedStripeEvent({ event, prisma });

        await expect(processRecordedHostedStripeWebhookEvent({
          eventId,
          prisma,
          timeoutMs: 5_000,
        })).resolves.toEqual({ accepted: true, required: false });

        expect(retrieve).toHaveBeenCalledOnce();
        expect(cancel).not.toHaveBeenCalled();
        expect(listInvoices).not.toHaveBeenCalled();
        expect(listInvoicePayments).not.toHaveBeenCalled();
        expect(listRefunds).not.toHaveBeenCalled();
        expect(createRefund).not.toHaveBeenCalled();
        await expect(readStripeReceiptProof({ eventId, prisma }))
          .resolves.toMatchObject({
            attemptCount: 1,
            processedAt: expect.any(Date),
            status: HostedStripeEventStatus.completed,
          });
        await expect(readHostedMemberBillingSnapshot({ memberId, prisma }))
          .resolves.toMatchObject({
            billingRef: {
              stripeCustomerId,
              stripeSubscriptionId,
            },
            core: { billingStatus: HostedBillingStatus.active },
          });
      } finally {
        clearHostedStripeFixtureEnvironment(runtimeGlobals);
        await prisma.hostedStripeEvent.deleteMany({ where: { eventId } });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    }, 60_000);

    it("holds the Family owner lock through Stripe cleanup and exact local terminalization", async () => {
      const cleanupClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const removalClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixture = await seedFamilySponsoredDirectCleanupFixture(cleanupClient);
      const providerReached = createDeferred();
      const continueProvider = createDeferred();
      const removalPid = await readBackendPid(removalClient);
      const stripe = buildFamilyCleanupStripe({
        beforeRetrieve: async () => {
          providerReached.resolve();
          await continueProvider.promise;
        },
        familyCustomerId: fixture.familyCustomerId,
        familySubscriptionId: fixture.familySubscriptionId,
        groupId: fixture.groupId,
        memberId: fixture.memberId,
        ownerMemberId: fixture.ownerMemberId,
        subscriptionId: fixture.directSubscriptionId,
      });
      const cleanup = cleanupHostedFamilySponsoredDirectSubscription({
        memberId: fixture.memberId,
        prisma: cleanupClient,
        sourceEventId: `evt_family_subscription_cleanup_${fixture.fixtureId}`,
        stripe: stripe.client,
        subscriptionId: fixture.directSubscriptionId,
      });

      let removal: Promise<boolean> | null = null;
      try {
        await providerReached.promise;
        removal = removalClient.$transaction((tx) =>
          removeHostedFamilyMemberTx({
            groupId: fixture.groupId,
            memberId: fixture.memberId,
            ownerMemberId: fixture.ownerMemberId,
            tx,
          }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
        await waitForBlockedBackend({ observer, pid: removalPid });
        expect(stripe.cancel).not.toHaveBeenCalled();

        continueProvider.resolve();
        await expect(cleanup).resolves.toBeUndefined();
        await expect(removal).resolves.toBe(true);

        expect(stripe.retrieve).toHaveBeenCalledTimes(2);
        expect(stripe.retrieve).toHaveBeenNthCalledWith(
          1,
          fixture.directSubscriptionId,
        );
        expect(stripe.retrieve).toHaveBeenNthCalledWith(
          2,
          fixture.familySubscriptionId,
        );
        expect(stripe.cancel).toHaveBeenCalledOnce();
        await expect(readHostedMemberBillingSnapshot({
          memberId: fixture.memberId,
          prisma: observer,
        })).resolves.toMatchObject({
          billingRef: {
            stripeSubscriptionId: fixture.directSubscriptionId,
          },
          core: { billingStatus: HostedBillingStatus.canceled },
        });
      } finally {
        continueProvider.resolve();
        await Promise.allSettled([
          cleanup,
          ...(removal ? [removal] : []),
        ]);
        await deleteFamilyCleanupFixture(observer, fixture);
        await Promise.all([
          cleanupClient.$disconnect(),
          removalClient.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });

    it("preserves direct billing when Stripe ended Family authority before its local projection", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixture = await seedFamilySponsoredDirectCleanupFixture(prisma);
      const stripe = buildFamilyCleanupStripe({
        familyCustomerId: fixture.familyCustomerId,
        familyStatus: "canceled",
        familySubscriptionId: fixture.familySubscriptionId,
        groupId: fixture.groupId,
        memberId: fixture.memberId,
        ownerMemberId: fixture.ownerMemberId,
        subscriptionId: fixture.directSubscriptionId,
      });

      try {
        await expect(cleanupHostedFamilySponsoredDirectSubscription({
          memberId: fixture.memberId,
          prisma,
          sourceEventId: `evt_family_provider_ended_${fixture.fixtureId}`,
          stripe: stripe.client,
          subscriptionId: fixture.directSubscriptionId,
        })).rejects.toBeInstanceOf(
          HostedStripeFamilySponsoredCleanupPendingError,
        );

        expect(stripe.retrieve).toHaveBeenNthCalledWith(
          1,
          fixture.directSubscriptionId,
        );
        expect(stripe.retrieve).toHaveBeenNthCalledWith(
          2,
          fixture.familySubscriptionId,
        );
        expect(stripe.cancel).not.toHaveBeenCalled();
        await expect(readHostedMemberBillingSnapshot({
          memberId: fixture.memberId,
          prisma,
        })).resolves.toMatchObject({
          billingRef: {
            stripeSubscriptionId: fixture.directSubscriptionId,
          },
          core: { billingStatus: HostedBillingStatus.active },
        });
      } finally {
        await deleteFamilyCleanupFixture(prisma, fixture);
        await prisma.$disconnect();
      }
    });

    it("verifies, records, reconciles, and idempotently projects one subscription event", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const memberId = `hbm_stripe_entitlement_${randomUUID()}`;
      const stripeCustomerId = `cus_entitlement_${randomUUID()}`;
      const stripeSubscriptionId = `sub_entitlement_${randomUUID()}`;
      const stripeEventId = `evt_entitlement_${randomUUID()}`;
      const priceId = `price_entitlement_${randomUUID()}`;
      const webhookSecret = "whsec_hosted_entitlement_fixture";
      const nowSeconds = Math.floor(Date.now() / 1_000);
      const subscription = buildActivePulseSubscription({
        customerId: stripeCustomerId,
        nowSeconds,
        priceId,
        subscriptionId: stripeSubscriptionId,
      });
      const event = buildSubscriptionUpdatedEvent({
        created: nowSeconds,
        eventId: stripeEventId,
        subscription,
      });
      const stripeFixture = await startHostedStripeHttpFixture({
        events: { [stripeEventId]: event },
        subscriptions: { [stripeSubscriptionId]: subscription },
      });
      const runtimeGlobals = globalThis as typeof globalThis & {
        __murphHostedOnboardingEnv?: unknown;
        __murphHostedOnboardingStripe?: Stripe | null;
      };

      workflowBoundary.start.mockClear();
      vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://join.example.test");
      vi.stubEnv(
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
        priceId,
      );
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_hosted_entitlement_fixture");
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
      runtimeGlobals.__murphHostedOnboardingEnv =
        readHostedOnboardingEnvironment(process.env);
      runtimeGlobals.__murphHostedOnboardingStripe = stripeFixture.stripe;

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        await prisma.$transaction((tx) =>
          writeHostedMemberStripeBillingRefTx({
            currentBillingPhase: null,
            currentBillingPlanCode: null,
            currentCheckoutOffer: null,
            memberId,
            stripeCustomerId,
            stripeSubscriptionId,
            tx,
          })
        );

        const payload = JSON.stringify(event);
        const signature = stripeFixture.stripe.webhooks.generateTestHeaderString({
          payload,
          secret: webhookSecret,
        });
        const firstResponse = await postHostedStripeWebhook(
          buildStripeWebhookRequest({ payload, signature }),
        );

        expect(firstResponse.status).toBe(200);
        await expect(firstResponse.json()).resolves.toEqual({
          ok: true,
          type: "customer.subscription.updated",
        });
        expect(workflowBoundary.start).toHaveBeenCalledTimes(1);
        expect(workflowBoundary.start).toHaveBeenCalledWith({
          eventId: stripeEventId,
        });

        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).resolves.toEqual({
          accepted: true,
          required: false,
        });

        const billing = await readHostedMemberBillingSnapshot({
          memberId,
          prisma,
        });
        expect(billing).toMatchObject({
          billingRef: {
            currentBillingPhase: "paid",
            currentBillingPlanCode: "launch_monthly",
            currentCheckoutOffer: "standard",
            stripeCustomerId,
            stripeSubscriptionId,
          },
          core: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        await expect(readHostedPersonalAiUsageStatus({
          includeScheduledPlan: true,
          memberId,
          prisma,
        })).resolves.toMatchObject({
          accessKind: "paid",
          planCode: "launch_monthly",
          planName: "Pulse",
          status: "active",
        });
        await expect(prisma.hostedStripeEvent.findUnique({
          where: { eventId: stripeEventId },
        })).resolves.toMatchObject({
          attemptCount: 1,
          processedAt: expect.any(Date),
          status: HostedStripeEventStatus.completed,
          type: "customer.subscription.updated",
        });
        expect(stripeFixture.observedRequests.map((request) => ({
          method: request.method,
          pathname: request.pathname,
        }))).toEqual([
          {
            method: "GET",
            pathname: `/v1/events/${stripeEventId}`,
          },
          {
            method: "GET",
            pathname: `/v1/subscriptions/${stripeSubscriptionId}`,
          },
        ]);
        expect(stripeFixture.observedRequests.every((request) =>
          request.authorization?.startsWith("Bearer sk_test_") === true
        )).toBe(true);

        const replayResponse = await postHostedStripeWebhook(
          buildStripeWebhookRequest({ payload, signature }),
        );
        expect(replayResponse.status).toBe(200);
        await expect(replayResponse.json()).resolves.toEqual({
          duplicate: true,
          ok: true,
          type: "customer.subscription.updated",
        });
        expect(workflowBoundary.start).toHaveBeenCalledTimes(2);
        expect(workflowBoundary.start).toHaveBeenLastCalledWith({
          eventId: stripeEventId,
        });
        await expect(prisma.hostedStripeEvent.count({
          where: { eventId: stripeEventId },
        })).resolves.toBe(1);
        expect(stripeFixture.observedRequests).toHaveLength(2);
      } finally {
        delete runtimeGlobals.__murphHostedOnboardingEnv;
        delete runtimeGlobals.__murphHostedOnboardingStripe;
        vi.unstubAllEnvs();
        await stripeFixture.stop();
        await prisma.hostedStripeEvent.deleteMany({
          where: { eventId: stripeEventId },
        });
        await prisma.hostedMember.deleteMany({
          where: { id: memberId },
        });
        await prisma.$disconnect();
      }
    }, 60_000);

    it("resets an exhausted direct Pulse period and replays the post-commit Edge wake", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const memberId = `hbm_direct_capacity_${fixtureId}`;
      const stripeCustomerId = `cus_direct_capacity_${fixtureId}`;
      const stripeSubscriptionId = `sub_direct_capacity_${fixtureId}`;
      const stripeEventId = `evt_direct_capacity_${fixtureId}`;
      const pulsePriceId = `price_pulse_capacity_${fixtureId}`;
      const edgePriceId = `price_edge_capacity_${fixtureId}`;
      const webhookSecret = "whsec_hosted_direct_capacity_fixture";
      const nowSeconds = Math.floor(Date.now() / 1_000);
      const eventCreatedAt = new Date(nowSeconds * 1_000);
      const periodStart = new Date((nowSeconds - 60) * 1_000);
      const periodEnd = new Date((nowSeconds + 30 * 24 * 60 * 60) * 1_000);
      const subscription = buildActiveDirectSubscription({
        billingPlanCode: "launch_edge_monthly",
        customerId: stripeCustomerId,
        nowSeconds,
        priceId: edgePriceId,
        subscriptionId: stripeSubscriptionId,
      });
      const event = buildSubscriptionUpdatedEvent({
        created: nowSeconds,
        eventId: stripeEventId,
        subscription,
      });
      const stripeFixture = await startHostedStripeHttpFixture({
        events: { [stripeEventId]: event },
        subscriptions: { [stripeSubscriptionId]: subscription },
      });
      const runtimeGlobals = readHostedStripeRuntimeGlobals();

      workflowBoundary.start.mockClear();
      runtimeRecheckBoundary.signal.mockReset();
      runtimeRecheckBoundary.signal
        .mockRejectedValueOnce(new Error("Temporal fixture unavailable"))
        .mockResolvedValue({
          signalAccepted: true,
          workflowId: `hosted-user-runtime:${memberId}`,
        });
      configureHostedStripeFixtureEnvironment({
        edgePriceId,
        pulsePriceId,
        stripe: stripeFixture.stripe,
        webhookSecret,
      });

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        await prisma.$transaction((tx) =>
          writeHostedMemberStripeBillingRefTx({
            currentBillingPhase: "paid",
            currentBillingPlanCode: "launch_monthly",
            currentCheckoutOffer: "standard",
            currentPeriodEnd: periodEnd,
            currentPeriodStart: periodStart,
            memberId,
            stripeCustomerId,
            stripeEventCreatedAt: new Date(eventCreatedAt.getTime() - 1_000),
            stripeSubscriptionId,
            tx,
          })
        );
        const pendingMailboxItemId = await seedUsageBlockedPendingWork({
          billingPlanCode: "launch_monthly",
          memberId,
          periodEnd,
          periodStart,
          prisma,
        });

        await postSignedHostedStripeEvent({
          event,
          stripe: stripeFixture.stripe,
          webhookSecret,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).rejects.toBeDefined();

        await expect(readUsageResetProof({ memberId, periodStart, prisma }))
          .resolves.toEqual({
            billingPlanCode: "launch_edge_monthly",
            blockedAt: null,
            highestBillingPlanCode: "launch_edge_monthly",
            planResetAt: eventCreatedAt,
            spentUsdMicros: 0n,
          });
        await expect(readPendingMailboxProof({
          mailboxItemId: pendingMailboxItemId,
          prisma,
        })).resolves.toMatchObject({
          aiUsageDeniedAt: expect.any(Date),
          consumedAt: null,
        });
        await expect(readStripeReceiptProof({
          eventId: stripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 1,
          processedAt: null,
          status: HostedStripeEventStatus.failed,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(1);
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledWith(
          expect.objectContaining({ userId: memberId }),
        );

        await makeStripeReceiptImmediatelyRetryable({
          eventId: stripeEventId,
          prisma,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).resolves.toEqual({ accepted: true, required: false });

        await expect(readUsageResetProof({ memberId, periodStart, prisma }))
          .resolves.toEqual({
            billingPlanCode: "launch_edge_monthly",
            blockedAt: null,
            highestBillingPlanCode: "launch_edge_monthly",
            planResetAt: eventCreatedAt,
            spentUsdMicros: 0n,
          });
        await expect(readStripeReceiptProof({
          eventId: stripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 2,
          processedAt: expect.any(Date),
          status: HostedStripeEventStatus.completed,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(2);
      } finally {
        clearHostedStripeFixtureEnvironment(runtimeGlobals);
        await stripeFixture.stop();
        await prisma.hostedStripeEvent.deleteMany({
          where: { eventId: stripeEventId },
        });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    }, 60_000);

    it("resets an exhausted Pulse Trial and replays the paid-conversion wake", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const memberId = `hbm_trial_conversion_${fixtureId}`;
      const stripeCustomerId = `cus_trial_conversion_${fixtureId}`;
      const stripeSubscriptionId = `sub_trial_conversion_${fixtureId}`;
      const stripeEventId = `evt_trial_conversion_${fixtureId}`;
      const stripeInvoiceId = `in_trial_conversion_${fixtureId}`;
      const pulsePriceId = `price_pulse_trial_conversion_${fixtureId}`;
      const edgePriceId = `price_edge_trial_conversion_${fixtureId}`;
      const webhookSecret = "whsec_hosted_trial_conversion_fixture";
      const nowSeconds = Math.floor(Date.now() / 1_000);
      const eventCreatedAt = new Date(nowSeconds * 1_000);
      const trialStart = new Date(
        (nowSeconds - 14 * 24 * 60 * 60) * 1_000,
      );
      const trialEnd = eventCreatedAt;
      const paidPeriodStart = eventCreatedAt;
      const subscription = buildActiveTrialConversionSubscription({
        customerId: stripeCustomerId,
        nowSeconds,
        priceId: pulsePriceId,
        subscriptionId: stripeSubscriptionId,
      });
      const event = buildInvoicePaidEvent({
        created: nowSeconds,
        customerId: stripeCustomerId,
        eventId: stripeEventId,
        invoiceId: stripeInvoiceId,
        subscriptionId: stripeSubscriptionId,
      });
      const stripeFixture = await startHostedStripeHttpFixture({
        events: { [stripeEventId]: event },
        subscriptions: { [stripeSubscriptionId]: subscription },
      });
      const runtimeGlobals = readHostedStripeRuntimeGlobals();

      workflowBoundary.start.mockClear();
      runtimeRecheckBoundary.signal.mockReset();
      runtimeRecheckBoundary.signal
        .mockRejectedValueOnce(new Error("Temporal fixture unavailable"))
        .mockResolvedValue({
          signalAccepted: true,
          workflowId: `hosted-user-runtime:${memberId}`,
        });
      configureHostedStripeFixtureEnvironment({
        edgePriceId,
        pulsePriceId,
        stripe: stripeFixture.stripe,
        webhookSecret,
      });

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        await prisma.$transaction((tx) =>
          writeHostedMemberStripeBillingRefTx({
            currentBillingPhase: "trial",
            currentBillingPlanCode: "launch_monthly",
            currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
            currentPeriodEnd: trialEnd,
            currentPeriodStart: trialStart,
            currentTrialEndsAt: trialEnd,
            currentTrialStartedAt: trialStart,
            memberId,
            pulseTrialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
            pulseTrialRedeemedAt: trialStart,
            stripeCustomerId,
            stripeEventCreatedAt: new Date(eventCreatedAt.getTime() - 1_000),
            stripeSubscriptionId,
            tx,
          })
        );
        const pendingMailboxItemId = await seedUsageBlockedPendingWork({
          billingPlanCode: "launch_monthly",
          limitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
          memberId,
          periodEnd: trialEnd,
          periodStart: trialStart,
          prisma,
        });

        await postSignedHostedStripeEvent({
          event,
          stripe: stripeFixture.stripe,
          webhookSecret,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).rejects.toBeDefined();

        await expect(readHostedMemberBillingSnapshot({ memberId, prisma }))
          .resolves.toMatchObject({
            billingRef: {
              currentBillingPhase: "paid",
              currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
              usagePlanTransitionAt: eventCreatedAt,
              usagePlanTransitionKind: "trial_conversion",
            },
            core: { billingStatus: HostedBillingStatus.active },
          });
        await expect(readUsageResetProof({
          memberId,
          periodStart: paidPeriodStart,
          prisma,
        })).resolves.toEqual({
          billingPlanCode: "launch_monthly",
          blockedAt: null,
          highestBillingPlanCode: "launch_monthly",
          planResetAt: null,
          spentUsdMicros: 0n,
        });
        await expect(readPendingMailboxProof({
          mailboxItemId: pendingMailboxItemId,
          prisma,
        })).resolves.toMatchObject({
          aiUsageDeniedAt: expect.any(Date),
          consumedAt: null,
        });
        await expect(readStripeReceiptProof({
          eventId: stripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 1,
          processedAt: null,
          status: HostedStripeEventStatus.failed,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(1);
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledWith(
          expect.objectContaining({ userId: memberId }),
        );

        await makeStripeReceiptImmediatelyRetryable({
          eventId: stripeEventId,
          prisma,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).resolves.toEqual({ accepted: true, required: false });

        await expect(readUsageResetProof({
          memberId,
          periodStart: paidPeriodStart,
          prisma,
        })).resolves.toEqual({
          billingPlanCode: "launch_monthly",
          blockedAt: null,
          highestBillingPlanCode: "launch_monthly",
          planResetAt: null,
          spentUsdMicros: 0n,
        });
        await expect(readStripeReceiptProof({
          eventId: stripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 2,
          processedAt: expect.any(Date),
          status: HostedStripeEventStatus.completed,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(2);
      } finally {
        clearHostedStripeFixtureEnvironment(runtimeGlobals);
        await stripeFixture.stop();
        await prisma.hostedStripeEvent.deleteMany({
          where: { eventId: stripeEventId },
        });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    }, 60_000);

    it("resets an exhausted sponsored member and replays the Family tier-increase wake", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const ownerMemberId = `hbm_family_owner_${fixtureId}`;
      const memberId = `hbm_family_member_${fixtureId}`;
      const groupId = `hbag_capacity_${fixtureId}`;
      const stripeCustomerId = `cus_family_capacity_${fixtureId}`;
      const stripeSubscriptionId = `sub_family_capacity_${fixtureId}`;
      const stripeEventId = `evt_family_capacity_${fixtureId}`;
      const pulsePriceId = `price_pulse_capacity_${fixtureId}`;
      const edgePriceId = `price_edge_capacity_${fixtureId}`;
      const familyPulsePriceId = `price_family_pulse_capacity_${fixtureId}`;
      const familyEdgePriceId = `price_family_edge_capacity_${fixtureId}`;
      const webhookSecret = "whsec_hosted_family_capacity_fixture";
      const nowSeconds = Math.floor(Date.now() / 1_000);
      const eventCreatedAt = new Date(nowSeconds * 1_000);
      const periodStart = new Date((nowSeconds - 60) * 1_000);
      const periodEnd = new Date((nowSeconds + 30 * 24 * 60 * 60) * 1_000);
      const subscription = buildActiveFamilySubscription({
        customerId: stripeCustomerId,
        edgePriceId: familyEdgePriceId,
        groupId,
        nowSeconds,
        pulsePriceId: familyPulsePriceId,
        subscriptionId: stripeSubscriptionId,
      });
      const event = buildSubscriptionUpdatedEvent({
        created: nowSeconds,
        eventId: stripeEventId,
        subscription,
      });
      const stripeFixture = await startHostedStripeHttpFixture({
        events: { [stripeEventId]: event },
        subscriptions: { [stripeSubscriptionId]: subscription },
      });
      const runtimeGlobals = readHostedStripeRuntimeGlobals();

      workflowBoundary.start.mockClear();
      runtimeRecheckBoundary.signal.mockReset();
      runtimeRecheckBoundary.signal
        .mockRejectedValueOnce(new Error("Temporal fixture unavailable"))
        .mockResolvedValue({
          signalAccepted: true,
          workflowId: `hosted-user-runtime:${memberId}`,
        });
      configureHostedStripeFixtureEnvironment({
        edgePriceId,
        familyEdgePriceId,
        familyPulsePriceId,
        pulsePriceId,
        stripe: stripeFixture.stripe,
        webhookSecret,
      });

      try {
        await prisma.hostedMember.createMany({
          data: [
            { billingStatus: HostedBillingStatus.active, id: ownerMemberId },
            { billingStatus: HostedBillingStatus.active, id: memberId },
          ],
        });
        await prisma.hostedAccountGroup.create({
          data: {
            billingRef: {
              create: {
                billedSeatCount: 2,
                currentBillingPhase: "paid",
                currentBillingPlanCode: "launch_family_monthly",
                currentPeriodEnd: periodEnd,
                currentPeriodStart: periodStart,
                lastStripeEventCreatedAt: new Date(
                  eventCreatedAt.getTime() - 1_000,
                ),
              },
            },
            billingStatus: HostedBillingStatus.active,
            id: groupId,
            memberships: {
              create: [
                {
                  id: `hbagm_owner_${fixtureId}`,
                  joinedAt: periodStart,
                  memberId: ownerMemberId,
                  planCode: "pulse",
                  role: "owner",
                  status: "active",
                },
                {
                  id: `hbagm_member_${fixtureId}`,
                  joinedAt: periodStart,
                  memberId,
                  pendingPlanCode: "edge",
                  planCode: "pulse",
                  role: "member",
                  status: "active",
                },
              ],
            },
            ownerMemberId,
            planCapacities: {
              create: {
                billedQuantity: 2,
                planCode: "pulse",
              },
            },
          },
        });
        const pendingMailboxItemId = await seedUsageBlockedPendingWork({
          billingPlanCode: "launch_monthly",
          memberId,
          periodEnd,
          periodStart,
          prisma,
        });
        await seedHostedMemberActivationProof({
          memberId: ownerMemberId,
          prisma,
          sequence: 1n,
        });
        await seedHostedMemberActivationProof({
          memberId,
          prisma,
          sequence: 2n,
        });

        await postSignedHostedStripeEvent({
          event,
          stripe: stripeFixture.stripe,
          webhookSecret,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).rejects.toBeDefined();

        await expect(prisma.hostedAccountGroupMembership.findUniqueOrThrow({
          select: {
            pendingPlanCode: true,
            planCode: true,
            usagePlanTransitionAt: true,
            usagePlanTransitionKind: true,
          },
          where: { id: `hbagm_member_${fixtureId}` },
        })).resolves.toEqual({
          pendingPlanCode: null,
          planCode: "edge",
          usagePlanTransitionAt: eventCreatedAt,
          usagePlanTransitionKind: "plan_upgrade",
        });
        await expect(readUsageResetProof({ memberId, periodStart, prisma }))
          .resolves.toEqual({
            billingPlanCode: "launch_edge_monthly",
            blockedAt: null,
            highestBillingPlanCode: "launch_edge_monthly",
            planResetAt: eventCreatedAt,
            spentUsdMicros: 0n,
          });
        await expect(readPendingMailboxProof({
          mailboxItemId: pendingMailboxItemId,
          prisma,
        })).resolves.toMatchObject({
          aiUsageDeniedAt: expect.any(Date),
          consumedAt: null,
        });
        await expect(readStripeReceiptProof({
          eventId: stripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 1,
          processedAt: null,
          status: HostedStripeEventStatus.failed,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(1);
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledWith(
          expect.objectContaining({ userId: memberId }),
        );

        await makeStripeReceiptImmediatelyRetryable({
          eventId: stripeEventId,
          prisma,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).resolves.toEqual({ accepted: true, required: false });

        await expect(readUsageResetProof({ memberId, periodStart, prisma }))
          .resolves.toEqual({
            billingPlanCode: "launch_edge_monthly",
            blockedAt: null,
            highestBillingPlanCode: "launch_edge_monthly",
            planResetAt: eventCreatedAt,
            spentUsdMicros: 0n,
          });
        await expect(readStripeReceiptProof({
          eventId: stripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 2,
          processedAt: expect.any(Date),
          status: HostedStripeEventStatus.completed,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(3);
        expect(runtimeRecheckBoundary.signal).toHaveBeenLastCalledWith(
          expect.objectContaining({ userId: ownerMemberId }),
        );
      } finally {
        clearHostedStripeFixtureEnvironment(runtimeGlobals);
        await stripeFixture.stop();
        await prisma.hostedStripeEvent.deleteMany({
          where: { eventId: stripeEventId },
        });
        await prisma.hostedAccountGroup.deleteMany({ where: { id: groupId } });
        await prisma.hostedMember.deleteMany({
          where: { id: { in: [ownerMemberId, memberId] } },
        });
        await prisma.$disconnect();
      }
    }, 60_000);

    it("replays the direct-to-Family owner wake after the direct binding is cleared", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const ownerMemberId = `hbm_family_handoff_${fixtureId}`;
      const groupId = `hbag_family_handoff_${fixtureId}`;
      const stripeCustomerId = `cus_family_handoff_${fixtureId}`;
      const stripeSubscriptionId = `sub_family_handoff_${fixtureId}`;
      const stripeEventId = `evt_family_handoff_${fixtureId}`;
      const newerStripeEventId = `evt_family_handoff_newer_${fixtureId}`;
      const pulsePriceId = `price_pulse_family_handoff_${fixtureId}`;
      const edgePriceId = `price_edge_family_handoff_${fixtureId}`;
      const familyPulsePriceId = `price_family_pulse_handoff_${fixtureId}`;
      const familyEdgePriceId = `price_family_edge_handoff_${fixtureId}`;
      const webhookSecret = "whsec_hosted_family_handoff_fixture";
      const nowSeconds = Math.floor(Date.now() / 1_000);
      const eventCreatedAt = new Date(nowSeconds * 1_000);
      const newerEventCreatedAt = new Date((nowSeconds + 1) * 1_000);
      const periodStart = new Date((nowSeconds - 60) * 1_000);
      const periodEnd = new Date(
        (nowSeconds + 30 * 24 * 60 * 60) * 1_000,
      );
      const directAllowance = getHostedAiUsageMonthlyAllowanceUsdMicros(
        "launch_group_monthly",
      );
      const subscription = buildActiveFamilySubscription({
        customerId: stripeCustomerId,
        edgePriceId: familyEdgePriceId,
        groupId,
        nowSeconds,
        pulsePriceId: familyPulsePriceId,
        subscriptionId: stripeSubscriptionId,
      });
      const event = buildSubscriptionUpdatedEvent({
        created: nowSeconds,
        eventId: stripeEventId,
        subscription,
      });
      const newerEvent = buildSubscriptionUpdatedEvent({
        created: nowSeconds + 1,
        eventId: newerStripeEventId,
        subscription,
      });
      const stripeFixture = await startHostedStripeHttpFixture({
        events: {
          [newerStripeEventId]: newerEvent,
          [stripeEventId]: event,
        },
        subscriptions: { [stripeSubscriptionId]: subscription },
      });
      const runtimeGlobals = readHostedStripeRuntimeGlobals();

      workflowBoundary.start.mockClear();
      runtimeRecheckBoundary.signal.mockReset();
      runtimeRecheckBoundary.signal
        .mockRejectedValueOnce(new Error("Temporal fixture unavailable"))
        .mockResolvedValue({
          signalAccepted: true,
          workflowId: `hosted-user-runtime:${ownerMemberId}`,
        });
      configureHostedStripeFixtureEnvironment({
        edgePriceId,
        familyEdgePriceId,
        familyPulsePriceId,
        pulsePriceId,
        stripe: stripeFixture.stripe,
        webhookSecret,
      });

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: ownerMemberId,
          },
        });
        await prisma.$transaction((tx) =>
          writeHostedMemberStripeBillingRefTx({
            currentBillingPhase: "paid",
            currentBillingPlanCode: "launch_group_monthly",
            currentCheckoutOffer: "standard",
            currentPeriodEnd: periodEnd,
            currentPeriodStart: periodStart,
            memberId: ownerMemberId,
            stripeCustomerId,
            stripeEventCreatedAt: new Date(eventCreatedAt.getTime() - 1_000),
            stripeSubscriptionId,
            tx,
          })
        );
        await prisma.hostedAccountGroup.create({
          data: {
            billingRef: {
              create: {
                currentBillingPhase: null,
                currentBillingPlanCode: "launch_family_monthly",
              },
            },
            billingStatus: HostedBillingStatus.not_started,
            id: groupId,
            memberships: {
              create: {
                id: `hbagm_family_handoff_${fixtureId}`,
                joinedAt: periodStart,
                memberId: ownerMemberId,
                planCode: "pulse",
                role: "owner",
                status: "active",
              },
            },
            ownerMemberId,
          },
        });
        const pendingMailboxItemId = await seedUsageBlockedPendingWork({
          billingPlanCode: "launch_group_monthly",
          memberId: ownerMemberId,
          periodEnd,
          periodStart,
          prisma,
        });
        await seedHostedMemberActivationProof({
          memberId: ownerMemberId,
          prisma,
          sequence: 1n,
        });

        await postSignedHostedStripeEvent({
          event,
          stripe: stripeFixture.stripe,
          webhookSecret,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).rejects.toBeDefined();

        await expect(readHostedMemberBillingSnapshot({
          memberId: ownerMemberId,
          prisma,
        })).resolves.toMatchObject({
          billingRef: {
            currentBillingPhase: null,
            currentBillingPlanCode: null,
            stripeSubscriptionId: null,
          },
          core: { billingStatus: HostedBillingStatus.not_started },
        });
        await expect(prisma.hostedAccountGroup.findUniqueOrThrow({
          select: {
            billingRef: {
              select: {
                currentBillingPhase: true,
                currentBillingPlanCode: true,
                lastStripeEventCreatedAt: true,
              },
            },
            billingStatus: true,
          },
          where: { id: groupId },
        })).resolves.toEqual({
          billingRef: {
            currentBillingPhase: "paid",
            currentBillingPlanCode: "launch_family_monthly",
            lastStripeEventCreatedAt: eventCreatedAt,
          },
          billingStatus: HostedBillingStatus.active,
        });
        await expect(readUsageResetProof({
          memberId: ownerMemberId,
          periodStart,
          prisma,
        })).resolves.toEqual({
          billingPlanCode: "launch_monthly",
          blockedAt: null,
          highestBillingPlanCode: "launch_monthly",
          planResetAt: null,
          spentUsdMicros: directAllowance,
        });
        await expect(readPendingMailboxProof({
          mailboxItemId: pendingMailboxItemId,
          prisma,
        })).resolves.toMatchObject({
          aiUsageDeniedAt: expect.any(Date),
          consumedAt: null,
        });
        await expect(readStripeReceiptProof({
          eventId: stripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 1,
          processedAt: null,
          status: HostedStripeEventStatus.failed,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(1);
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledWith(
          expect.objectContaining({ userId: ownerMemberId }),
        );

        await postSignedHostedStripeEvent({
          event: newerEvent,
          stripe: stripeFixture.stripe,
          webhookSecret,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: newerStripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).resolves.toEqual({ accepted: true, required: false });
        await expect(readStripeReceiptProof({
          eventId: newerStripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 1,
          processedAt: expect.any(Date),
          status: HostedStripeEventStatus.completed,
        });
        await expect(prisma.hostedAccountGroupBillingRef.findUniqueOrThrow({
          select: { lastStripeEventCreatedAt: true },
          where: { groupId },
        })).resolves.toEqual({
          lastStripeEventCreatedAt: newerEventCreatedAt,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(1);

        await makeStripeReceiptImmediatelyRetryable({
          eventId: stripeEventId,
          prisma,
        });
        await expect(processRecordedHostedStripeWebhookEvent({
          eventId: stripeEventId,
          prisma,
          timeoutMs: 5_000,
        })).resolves.toEqual({ accepted: true, required: false });

        await expect(readUsageResetProof({
          memberId: ownerMemberId,
          periodStart,
          prisma,
        })).resolves.toEqual({
          billingPlanCode: "launch_monthly",
          blockedAt: null,
          highestBillingPlanCode: "launch_monthly",
          planResetAt: null,
          spentUsdMicros: directAllowance,
        });
        await expect(readStripeReceiptProof({
          eventId: stripeEventId,
          prisma,
        })).resolves.toMatchObject({
          attemptCount: 2,
          processedAt: expect.any(Date),
          status: HostedStripeEventStatus.completed,
        });
        expect(runtimeRecheckBoundary.signal).toHaveBeenCalledTimes(2);
        expect(runtimeRecheckBoundary.signal).toHaveBeenLastCalledWith(
          expect.objectContaining({ userId: ownerMemberId }),
        );
      } finally {
        clearHostedStripeFixtureEnvironment(runtimeGlobals);
        await stripeFixture.stop();
        await prisma.hostedStripeEvent.deleteMany({
          where: { eventId: { in: [newerStripeEventId, stripeEventId] } },
        });
        await prisma.hostedAccountGroup.deleteMany({ where: { id: groupId } });
        await prisma.hostedMember.deleteMany({ where: { id: ownerMemberId } });
        await prisma.$disconnect();
      }
    }, 60_000);
  },
);

function buildStripeWebhookRequest(input: {
  payload: string;
  signature: string;
}): Request {
  return new Request(
    "https://join.example.test/api/hosted-onboarding/stripe/webhook",
    {
      body: input.payload,
      headers: {
        "content-type": "application/json",
        "stripe-signature": input.signature,
      },
      method: "POST",
    },
  );
}

function buildActivePulseSubscription(input: {
  customerId: string;
  nowSeconds: number;
  priceId: string;
  subscriptionId: string;
}): Stripe.Subscription {
  return buildActiveDirectSubscription({
    ...input,
    billingPlanCode: "launch_monthly",
  });
}

function buildActiveTrialConversionSubscription(input: {
  customerId: string;
  nowSeconds: number;
  priceId: string;
  subscriptionId: string;
}): Stripe.Subscription {
  const subscription = buildActivePulseSubscription(input);

  return {
    ...subscription,
    current_period_start: input.nowSeconds,
    items: {
      ...subscription.items,
      data: subscription.items.data.map((item) => ({
        ...item,
        current_period_start: input.nowSeconds,
      })),
    },
    metadata: {
      ...subscription.metadata,
      checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    },
    trial_end: input.nowSeconds,
    trial_start: input.nowSeconds - 14 * 24 * 60 * 60,
  } as Stripe.Subscription;
}

function buildActiveDirectSubscription(input: {
  billingPlanCode: "launch_edge_monthly" | "launch_monthly";
  customerId: string;
  nowSeconds: number;
  priceId: string;
  subscriptionId: string;
}): Stripe.Subscription {
  const currentPeriodStart = input.nowSeconds - 60;
  const currentPeriodEnd = input.nowSeconds + 30 * 24 * 60 * 60;
  return {
    cancel_at_period_end: false,
    collection_method: "charge_automatically",
    created: input.nowSeconds - 60,
    current_period_end: currentPeriodEnd,
    current_period_start: currentPeriodStart,
    customer: input.customerId,
    id: input.subscriptionId,
    items: {
      data: [
        {
          current_period_end: currentPeriodEnd,
          current_period_start: currentPeriodStart,
          id: `si_${input.subscriptionId}`,
          object: "subscription_item",
          price: {
            active: true,
            billing_scheme: "per_unit",
            created: input.nowSeconds - 60,
            currency: "usd",
            id: input.priceId,
            livemode: false,
            metadata: {},
            object: "price",
            recurring: {
              interval: "month",
              interval_count: 1,
              meter: null,
              trial_period_days: null,
              usage_type: "licensed",
            },
            tax_behavior: "unspecified",
            type: "recurring",
            unit_amount: 800,
            unit_amount_decimal: "800",
          },
          quantity: 1,
          subscription: input.subscriptionId,
        } as unknown as Stripe.SubscriptionItem,
      ],
      has_more: false,
      object: "list",
      url: `/v1/subscription_items?subscription=${input.subscriptionId}`,
    },
    latest_invoice: null,
    livemode: false,
    metadata: {
      billingPlanCode: input.billingPlanCode,
      checkoutOffer: "standard",
    },
    object: "subscription",
    pause_collection: null,
    pending_update: null,
    schedule: null,
    start_date: input.nowSeconds - 60,
    status: "active",
    trial_end: null,
    trial_start: null,
  } as unknown as Stripe.Subscription;
}

function buildSubscriptionUpdatedEvent(input: {
  created: number;
  eventId: string;
  subscription: Stripe.Subscription;
}): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: input.created,
    data: {
      object: input.subscription,
      previous_attributes: {
        status: "trialing",
      },
    },
    id: input.eventId,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "customer.subscription.updated",
  } as Stripe.Event;
}

function buildInvoicePaidEvent(input: {
  created: number;
  customerId: string;
  eventId: string;
  invoiceId: string;
  subscriptionId: string;
}): Stripe.Event {
  const invoiceFields = {
    amount_paid: 800,
    billing_reason: "subscription_cycle",
    charge: `ch_${input.invoiceId}`,
    customer: input.customerId,
    id: input.invoiceId,
    object: "invoice",
    payment_intent: `pi_${input.invoiceId}`,
    payments: {
      data: [],
      has_more: false,
      object: "list",
      url: `/v1/invoices/${input.invoiceId}/payments`,
    },
    subscription: input.subscriptionId,
  };
  // @ts-expect-error - the synthetic invoice includes only billing fields used by this proof.
  const invoice: Stripe.Invoice = invoiceFields;

  return {
    api_version: "2025-03-31.basil",
    created: input.created,
    data: {
      object: invoice,
    },
    id: input.eventId,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "invoice.paid",
  } as Stripe.Event;
}

function buildActiveFamilySubscription(input: {
  customerId: string;
  edgePriceId: string;
  groupId: string;
  nowSeconds: number;
  pulsePriceId: string;
  subscriptionId: string;
}): Stripe.Subscription {
  const base = buildActiveDirectSubscription({
    billingPlanCode: "launch_monthly",
    customerId: input.customerId,
    nowSeconds: input.nowSeconds,
    priceId: input.pulsePriceId,
    subscriptionId: input.subscriptionId,
  });
  const pulseItem = base.items.data[0];
  if (!pulseItem) {
    throw new Error("Family Stripe fixture requires a Pulse item.");
  }

  return {
    ...base,
    items: {
      ...base.items,
      data: [
        {
          ...pulseItem,
          id: `si_family_pulse_${input.subscriptionId}`,
          price: {
            ...pulseItem.price,
            id: input.pulsePriceId,
          },
          quantity: 1,
        },
        {
          ...pulseItem,
          id: `si_family_edge_${input.subscriptionId}`,
          price: {
            ...pulseItem.price,
            id: input.edgePriceId,
          },
          quantity: 1,
        },
      ],
    },
    metadata: {
      accountGroupId: input.groupId,
      billingPlanCode: "launch_family_monthly",
      kind: "hosted_family_plan",
    },
  };
}

type HostedStripeRuntimeGlobals = typeof globalThis & {
  __murphHostedOnboardingEnv?: unknown;
  __murphHostedOnboardingStripe?: Stripe | null;
};

function readHostedStripeRuntimeGlobals(): HostedStripeRuntimeGlobals {
  return globalThis as HostedStripeRuntimeGlobals;
}

function configureHostedStripeFixtureEnvironment(input: {
  edgePriceId: string;
  familyEdgePriceId?: string;
  familyPulsePriceId?: string;
  pulsePriceId: string;
  stripe: Stripe;
  webhookSecret: string;
}): void {
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://join.example.test");
  vi.stubEnv(
    "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
    input.pulsePriceId,
  );
  vi.stubEnv(
    "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
    input.edgePriceId,
  );
  if (input.familyPulsePriceId) {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
      input.familyPulsePriceId,
    );
  }
  if (input.familyEdgePriceId) {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
      input.familyEdgePriceId,
    );
  }
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_hosted_capacity_fixture");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", input.webhookSecret);

  const runtimeGlobals = readHostedStripeRuntimeGlobals();
  runtimeGlobals.__murphHostedOnboardingEnv =
    readHostedOnboardingEnvironment(process.env);
  runtimeGlobals.__murphHostedOnboardingStripe = input.stripe;
}

function clearHostedStripeFixtureEnvironment(
  runtimeGlobals: HostedStripeRuntimeGlobals,
): void {
  delete runtimeGlobals.__murphHostedOnboardingEnv;
  delete runtimeGlobals.__murphHostedOnboardingStripe;
  vi.unstubAllEnvs();
}

async function postSignedHostedStripeEvent(input: {
  event: Stripe.Event;
  stripe: Stripe;
  webhookSecret: string;
}): Promise<void> {
  const payload = JSON.stringify(input.event);
  const signature = input.stripe.webhooks.generateTestHeaderString({
    payload,
    secret: input.webhookSecret,
  });
  const response = await postHostedStripeWebhook(
    buildStripeWebhookRequest({ payload, signature }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    type: input.event.type,
  });
}

async function seedUsageBlockedPendingWork(input: {
  billingPlanCode:
    | "launch_edge_monthly"
    | "launch_group_monthly"
    | "launch_monthly";
  limitUsdMicros?: bigint;
  memberId: string;
  periodEnd: Date;
  periodStart: Date;
  prisma: PrismaClient;
}): Promise<string> {
  const deniedAt = new Date(input.periodStart.getTime() + 30_000);
  const mailboxItemId = `hmi_usage_blocked_${input.memberId}`;
  const allowance = input.limitUsdMicros
    ?? getHostedAiUsageMonthlyAllowanceUsdMicros(input.billingPlanCode);

  await input.prisma.hostedWorkspace.create({
    data: { userId: input.memberId },
  });
  await input.prisma.hostedMailboxItem.create({
    data: {
      aiUsageDeniedAt: deniedAt,
      causalSeq: 1n,
      dedupeKey: `usage-blocked:${input.memberId}`,
      id: mailboxItemId,
      kind: "linq.message",
      lane: "conversation",
      laneSeq: 1n,
      occurredAt: deniedAt,
      payloadSchema: "murph.hosted-execution.test-pending-input.v1",
      userId: input.memberId,
    },
  });
  await input.prisma.hostedAiUsagePeriod.create({
    data: {
      billingPlanCode: input.billingPlanCode,
      blockedAt: deniedAt,
      highestBillingPlanCode: input.billingPlanCode,
      limitUsdMicros: allowance,
      memberId: input.memberId,
      periodEnd: input.periodEnd,
      periodStart: input.periodStart,
      spentUsdMicros: allowance,
    },
  });

  return mailboxItemId;
}

async function seedHostedMemberActivationProof(input: {
  memberId: string;
  prisma: PrismaClient;
  sequence: bigint;
}): Promise<void> {
  await input.prisma.hostedWorkspace.upsert({
    create: { userId: input.memberId },
    update: {},
    where: { userId: input.memberId },
  });
  await input.prisma.hostedMailboxItem.create({
    data: {
      dedupeKey: `member.activated:fixture:${input.memberId}`,
      id: `hmi_activation_${input.memberId}`,
      kind: "member.activated",
      lane: "system",
      laneSeq: input.sequence,
      occurredAt: new Date(),
      payloadSchema: "murph.hosted-execution.member-activated.v1",
      userId: input.memberId,
    },
  });
}

function readUsageResetProof(input: {
  memberId: string;
  periodStart: Date;
  prisma: PrismaClient;
}) {
  return input.prisma.hostedAiUsagePeriod.findUniqueOrThrow({
    select: {
      billingPlanCode: true,
      blockedAt: true,
      highestBillingPlanCode: true,
      planResetAt: true,
      spentUsdMicros: true,
    },
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: input.periodStart,
      },
    },
  });
}

function readPendingMailboxProof(input: {
  mailboxItemId: string;
  prisma: PrismaClient;
}) {
  return input.prisma.hostedMailboxItem.findUniqueOrThrow({
    select: {
      aiUsageDeniedAt: true,
      consumedAt: true,
    },
    where: { id: input.mailboxItemId },
  });
}

function readStripeReceiptProof(input: {
  eventId: string;
  prisma: PrismaClient;
}) {
  return input.prisma.hostedStripeEvent.findUniqueOrThrow({
    select: {
      attemptCount: true,
      processedAt: true,
      status: true,
    },
    where: { eventId: input.eventId },
  });
}

function readFamilyCheckoutAttemptProof(input: {
  memberId: string;
  prisma: PrismaClient;
}) {
  return input.prisma.hostedMemberBillingRef.findUniqueOrThrow({
    select: {
      checkoutAttemptId: true,
      stripeCheckoutSessionLookupKey: true,
      stripeSubscriptionLookupKey: true,
    },
    where: { memberId: input.memberId },
  });
}

async function makeStripeReceiptImmediatelyRetryable(input: {
  eventId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedStripeEvent.update({
    data: { nextAttemptAt: new Date(0) },
    where: { eventId: input.eventId },
  });
}

interface FamilyCleanupFixture {
  checkoutAttemptId: string;
  checkoutIntentHash: string;
  checkoutSessionId: string;
  directCustomerId: string;
  directSubscriptionId: string;
  familyCustomerId: string;
  familySubscriptionId: string;
  fixtureId: string;
  groupId: string;
  memberId: string;
  ownerMemberId: string;
}

async function seedFamilySponsoredDirectCleanupFixture(
  prisma: PrismaClient,
  options: { pendingCheckout?: boolean } = {},
): Promise<FamilyCleanupFixture> {
  const fixtureId = randomUUID();
  const fixture = {
    checkoutAttemptId: `hbca_cleanup_${fixtureId}`,
    checkoutIntentHash: `intent_cleanup_${fixtureId}`,
    checkoutSessionId: `cs_cleanup_${fixtureId}`,
    directCustomerId: `cus_direct_cleanup_${fixtureId}`,
    directSubscriptionId: `sub_direct_cleanup_${fixtureId}`,
    familyCustomerId: `cus_family_authority_${fixtureId}`,
    familySubscriptionId: `sub_family_authority_${fixtureId}`,
    fixtureId,
    groupId: `hbag_cleanup_${fixtureId}`,
    memberId: `hbm_cleanup_member_${fixtureId}`,
    ownerMemberId: `hbm_cleanup_owner_${fixtureId}`,
  };
  await prisma.hostedMember.createMany({
    data: [
      { billingStatus: HostedBillingStatus.active, id: fixture.ownerMemberId },
      { billingStatus: HostedBillingStatus.active, id: fixture.memberId },
    ],
  });
  await prisma.hostedAccountGroup.create({
    data: {
      billingStatus: HostedBillingStatus.active,
      id: fixture.groupId,
      memberships: {
        create: [
          {
            id: `hbagm_cleanup_owner_${fixtureId}`,
            joinedAt: new Date("2026-07-01T12:00:00.000Z"),
            memberId: fixture.ownerMemberId,
            planCode: "pulse",
            role: "owner",
            status: "active",
          },
          {
            id: `hbagm_cleanup_member_${fixtureId}`,
            joinedAt: new Date("2026-07-01T12:00:00.000Z"),
            memberId: fixture.memberId,
            planCode: "pulse",
            role: "member",
            status: "active",
          },
        ],
      },
      ownerMemberId: fixture.ownerMemberId,
    },
  });
  await prisma.$transaction((tx) =>
    writeHostedAccountGroupStripeBillingTx({
      billedSeatCount: 2,
      billingStatus: HostedBillingStatus.active,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_family_monthly",
      groupId: fixture.groupId,
      stripeCustomerId: fixture.familyCustomerId,
      stripeSubscriptionId: fixture.familySubscriptionId,
      tx,
    })
  );
  if (options.pendingCheckout) {
    await prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, fixture.memberId);
      await reserveHostedMemberStripeCheckoutAttemptUnderLockTx({
        attemptId: fixture.checkoutAttemptId,
        createdAt: new Date("2026-07-01T12:00:00.000Z"),
        expectedBillingRef: null,
        intentHash: fixture.checkoutIntentHash,
        memberId: fixture.memberId,
        tx,
      });
    });
    const preparedSession = await prepareHostedMemberStripeCheckoutSession({
      memberId: fixture.memberId,
      prisma,
      sessionId: fixture.checkoutSessionId,
    });
    await prisma.$transaction((tx) =>
      bindHostedMemberStripeCheckoutSessionTx({
        attemptId: fixture.checkoutAttemptId,
        intentHash: fixture.checkoutIntentHash,
        memberId: fixture.memberId,
        preparedSession,
        tx,
      })
    );
  } else {
    await prisma.$transaction((tx) =>
      writeHostedMemberStripeBillingRefTx({
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        memberId: fixture.memberId,
        stripeCustomerId: fixture.directCustomerId,
        stripeSubscriptionId: fixture.directSubscriptionId,
        tx,
      })
    );
  }
  return fixture;
}

async function deleteFamilyCleanupFixture(
  prisma: PrismaClient,
  fixture: FamilyCleanupFixture,
): Promise<void> {
  await prisma.hostedAccountGroup.deleteMany({
    where: { id: fixture.groupId },
  });
  await prisma.hostedMember.deleteMany({
    where: { id: { in: [fixture.memberId, fixture.ownerMemberId] } },
  });
}

function buildFamilyCleanupStripe(input: {
  beforeRetrieve?: () => Promise<void>;
  familyCustomerId: string;
  familyStatus?: Stripe.Subscription["status"];
  familySubscriptionId: string;
  groupId: string;
  memberId: string;
  ownerMemberId: string;
  subscriptionId: string;
}) {
  const directSubscription: Stripe.Subscription = {
    id: input.subscriptionId,
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "standard",
      memberId: input.memberId,
    },
    status: "active",
  } as never;
  const familySubscription: Stripe.Subscription = {
    customer: input.familyCustomerId,
    id: input.familySubscriptionId,
    metadata: {
      accountGroupId: input.groupId,
      billingPlanCode: "launch_family_monthly",
      kind: "hosted_family_plan",
      ownerMemberId: input.ownerMemberId,
    },
    status: input.familyStatus ?? "active",
  } as never;
  const retrieve = vi.fn(async (subscriptionId: string) => {
    await input.beforeRetrieve?.();
    if (subscriptionId === input.subscriptionId) {
      return directSubscription;
    }
    if (subscriptionId === input.familySubscriptionId) {
      return familySubscription;
    }
    throw Object.assign(new Error("Stripe subscription was not found."), {
      code: "resource_missing",
    });
  });
  const cancel = vi.fn(async () => ({
    ...directSubscription,
    status: "canceled" as const,
  }));
  const listInvoices = vi.fn(async () => ({
    data: [],
    has_more: false,
  }));
  return {
    cancel,
    client: {
      invoices: { list: listInvoices },
      subscriptions: { cancel, retrieve },
    } as never,
    listInvoices,
    retrieve,
  };
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (!resolvePromise) {
        throw new Error("Deferred promise is not initialized.");
      }
      resolvePromise();
    },
  };
}

async function readBackendPid(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid()::integer AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the Family billing transaction to wait on the owner lock.");
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:"
      ? url.hostname === "127.0.0.1"
        || url.hostname === "localhost"
        || url.hostname === "::1"
      : false;
  } catch {
    return false;
  }
}
