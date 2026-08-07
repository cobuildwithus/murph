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
  readHostedOnboardingEnvironment,
} from "@/src/lib/hosted-onboarding/env";
import {
  processRecordedHostedStripeWebhookEvent,
} from "@/src/lib/hosted-onboarding/stripe-webhook-reconciliation";
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
      const pulsePriceId = `price_pulse_family_handoff_${fixtureId}`;
      const edgePriceId = `price_edge_family_handoff_${fixtureId}`;
      const familyPulsePriceId = `price_family_pulse_handoff_${fixtureId}`;
      const familyEdgePriceId = `price_family_edge_handoff_${fixtureId}`;
      const webhookSecret = "whsec_hosted_family_handoff_fixture";
      const nowSeconds = Math.floor(Date.now() / 1_000);
      const eventCreatedAt = new Date(nowSeconds * 1_000);
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
          where: { eventId: stripeEventId },
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

async function makeStripeReceiptImmediatelyRetryable(input: {
  eventId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedStripeEvent.update({
    data: { nextAttemptAt: new Date(0) },
    where: { eventId: input.eventId },
  });
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
