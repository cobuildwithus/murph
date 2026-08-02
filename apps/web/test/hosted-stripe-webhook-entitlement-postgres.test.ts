import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  HostedStripeEventStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

const workflowBoundary = vi.hoisted(() => ({
  start: vi.fn(async () => ({ runId: "run_hosted_stripe_fixture" })),
}));

vi.mock(
  "@/src/lib/hosted-onboarding/stripe-webhook-workflow-start",
  () => ({
    startHostedStripeWebhookReconciliationWorkflow: workflowBoundary.start,
  }),
);

import { POST as postHostedStripeWebhook } from "@/app/api/hosted-onboarding/stripe/webhook/route";
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
        expect(workflowBoundary.start).toHaveBeenCalledTimes(1);
        await expect(prisma.hostedStripeEvent.count({
          where: { eventId: stripeEventId },
        })).resolves.toBe(1);
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
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      object: "list",
      url: `/v1/subscription_items?subscription=${input.subscriptionId}`,
    },
    latest_invoice: null,
    livemode: false,
    metadata: {
      billingPlanCode: "launch_monthly",
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
  } as Stripe.Subscription;
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
