import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import {
  applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired,
  applyStripeDisputeUpdated,
  applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated,
  applyStripeSubscriptionUpdated,
} from "./stripe-billing-policy";
import type { HostedWebhookPlan, HostedWebhookSideEffect } from "./webhook-receipts";

export type HostedStripeWebhookResponse = {
  duplicate?: boolean;
  ok: true;
  type: string;
};

type HostedStripeWebhookHandlerInput = {
  event: Stripe.Event;
  occurredAt: string;
  prisma: PrismaClient;
};

type HostedStripeWebhookHandler = (
  input: HostedStripeWebhookHandlerInput,
) => Promise<HostedWebhookSideEffect[]>;

export async function planHostedStripeWebhook(input: {
  event: Stripe.Event;
  prisma: PrismaClient;
}): Promise<HostedWebhookPlan<HostedStripeWebhookResponse>> {
  const occurredAt = Number.isFinite(input.event.created)
    ? new Date(input.event.created * 1000).toISOString()
    : new Date().toISOString();
  const handler = HOSTED_STRIPE_WEBHOOK_HANDLERS[input.event.type];
  const desiredSideEffects = handler
    ? await handler({
      event: input.event,
      occurredAt,
      prisma: input.prisma,
    })
    : [];

  return {
    desiredSideEffects,
    response: {
      ok: true,
      type: input.event.type,
    },
  };
}

const HOSTED_STRIPE_WEBHOOK_HANDLERS = createHostedStripeWebhookHandlerRegistry();

function createHostedStripeWebhookHandlerRegistry(): Record<string, HostedStripeWebhookHandler> {
  const registry: Record<string, HostedStripeWebhookHandler> = {};

  registerHostedStripeWebhookHandler(registry, ["checkout.session.completed"], handleStripeCheckoutCompleted);
  registerHostedStripeWebhookHandler(registry, ["checkout.session.expired"], handleStripeCheckoutExpired);
  registerHostedStripeWebhookHandler(
    registry,
    [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ],
    handleStripeSubscriptionUpdated,
  );
  registerHostedStripeWebhookHandler(registry, ["invoice.paid"], handleStripeInvoicePaid);
  registerHostedStripeWebhookHandler(registry, ["invoice.payment_failed"], handleStripeInvoicePaymentFailed);
  registerHostedStripeWebhookHandler(registry, ["refund.created"], handleStripeRefundCreated);
  registerHostedStripeWebhookHandler(
    registry,
    [
      "charge.dispute.created",
      "charge.dispute.closed",
      "charge.dispute.funds_reinstated",
      "charge.dispute.funds_withdrawn",
    ],
    handleStripeDisputeUpdated,
  );

  return registry;
}

function registerHostedStripeWebhookHandler(
  registry: Record<string, HostedStripeWebhookHandler>,
  eventTypes: string[],
  handler: HostedStripeWebhookHandler,
): void {
  for (const eventType of eventTypes) {
    registry[eventType] = handler;
  }
}

async function handleStripeCheckoutCompleted(
  input: HostedStripeWebhookHandlerInput,
): Promise<HostedWebhookSideEffect[]> {
  return applyStripeCheckoutCompleted(
    input.event.data.object as Stripe.Checkout.Session,
    {
      occurredAt: input.occurredAt,
      sourceEventId: input.event.id,
    },
    input.prisma,
  );
}

async function handleStripeCheckoutExpired(
  input: HostedStripeWebhookHandlerInput,
): Promise<HostedWebhookSideEffect[]> {
  await applyStripeCheckoutExpired(input.event.data.object as Stripe.Checkout.Session, input.prisma);

  return [];
}

async function handleStripeSubscriptionUpdated(
  input: HostedStripeWebhookHandlerInput,
): Promise<HostedWebhookSideEffect[]> {
  return applyStripeSubscriptionUpdated(
    input.event.data.object as Stripe.Subscription,
    {
      occurredAt: input.occurredAt,
      sourceEventId: input.event.id,
      sourceType: input.event.type,
    },
    input.prisma,
  );
}

async function handleStripeInvoicePaid(
  input: HostedStripeWebhookHandlerInput,
): Promise<HostedWebhookSideEffect[]> {
  return applyStripeInvoicePaid(
    input.event.data.object as Stripe.Invoice,
    {
      occurredAt: input.occurredAt,
      sourceEventId: input.event.id,
    },
    input.prisma,
  );
}

async function handleStripeInvoicePaymentFailed(
  input: HostedStripeWebhookHandlerInput,
): Promise<HostedWebhookSideEffect[]> {
  await applyStripeInvoicePaymentFailed(input.event.data.object as Stripe.Invoice, input.prisma);

  return [];
}

async function handleStripeRefundCreated(
  input: HostedStripeWebhookHandlerInput,
): Promise<HostedWebhookSideEffect[]> {
  await applyStripeRefundCreated(input.event.data.object as Stripe.Refund, input.event.type, input.prisma);

  return [];
}

async function handleStripeDisputeUpdated(
  input: HostedStripeWebhookHandlerInput,
): Promise<HostedWebhookSideEffect[]> {
  await applyStripeDisputeUpdated(input.event.data.object as Stripe.Dispute, input.event.type, input.prisma);

  return [];
}
