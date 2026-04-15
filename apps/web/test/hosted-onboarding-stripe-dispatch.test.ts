import { describe, expect, it } from "vitest";

import {
  buildHostedStripeDispatchContext,
  normalizeHostedStripeDispatchSourceType,
} from "@/src/lib/hosted-onboarding/stripe-dispatch";

describe("stripe dispatch context", () => {
  it("derives one shared dispatch record from a Stripe event envelope", () => {
    const context = buildHostedStripeDispatchContext({
      created: 1_700_000_000,
      id: "evt_123",
      type: "invoice.paid",
    });

    expect(context).toEqual({
      eventCreatedAt: new Date(1_700_000_000 * 1000),
      occurredAt: new Date(1_700_000_000 * 1000).toISOString(),
      sourceEventId: "evt_123",
      sourceType: "stripe.invoice.paid",
    });
  });

  it("keeps the source-type mapping in one owner", () => {
    expect(normalizeHostedStripeDispatchSourceType("charge.dispute.closed")).toBe(
      "stripe.charge.dispute.closed",
    );
  });
});
