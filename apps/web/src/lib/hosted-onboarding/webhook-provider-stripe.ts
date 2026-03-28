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

export async function planHostedStripeWebhook(input: {
  event: Stripe.Event;
  prisma: PrismaClient;
}): Promise<HostedWebhookPlan<HostedStripeWebhookResponse>> {
  const occurredAt = Number.isFinite(input.event.created)
    ? new Date(input.event.created * 1000).toISOString()
    : new Date().toISOString();
  let desiredSideEffects: HostedWebhookSideEffect[] = [];

  switch (input.event.type) {
    case "checkout.session.completed":
      desiredSideEffects = await applyStripeCheckoutCompleted(
        input.event.data.object as Stripe.Checkout.Session,
        {
          occurredAt,
          sourceEventId: input.event.id,
        },
        input.prisma,
      );
      break;
    case "checkout.session.expired":
      await applyStripeCheckoutExpired(input.event.data.object as Stripe.Checkout.Session, input.prisma);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      desiredSideEffects = await applyStripeSubscriptionUpdated(
        input.event.data.object as Stripe.Subscription,
        {
          occurredAt,
          sourceEventId: input.event.id,
          sourceType: input.event.type,
        },
        input.prisma,
      );
      break;
    case "invoice.paid":
      desiredSideEffects = await applyStripeInvoicePaid(
        input.event.data.object as Stripe.Invoice,
        {
          occurredAt,
          sourceEventId: input.event.id,
        },
        input.prisma,
      );
      break;
    case "invoice.payment_failed":
      await applyStripeInvoicePaymentFailed(input.event.data.object as Stripe.Invoice, input.prisma);
      break;
    case "refund.created":
      await applyStripeRefundCreated(input.event.data.object as Stripe.Refund, input.event.type, input.prisma);
      break;
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_reinstated":
    case "charge.dispute.funds_withdrawn":
      await applyStripeDisputeUpdated(input.event.data.object as Stripe.Dispute, input.event.type, input.prisma);
      break;
    default:
      break;
  }

  return {
    desiredSideEffects,
    response: {
      ok: true,
      type: input.event.type,
    },
  };
}
