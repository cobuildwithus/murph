import type Stripe from "stripe";

export type HostedStripeDispatchContext = {
  eventCreatedAt: Date;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
};

export function buildHostedStripeDispatchContext(
  event: Pick<Stripe.Event, "created" | "id" | "type">,
): HostedStripeDispatchContext {
  const eventCreatedAt = Number.isFinite(event.created)
    ? new Date(event.created * 1000)
    : new Date();

  return {
    eventCreatedAt,
    occurredAt: eventCreatedAt.toISOString(),
    sourceEventId: event.id,
    sourceType: normalizeHostedStripeDispatchSourceType(event.type),
  };
}

export function normalizeHostedStripeDispatchSourceType(eventType: string): string {
  return `stripe.${eventType}`;
}
