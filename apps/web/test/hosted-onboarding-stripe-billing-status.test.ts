import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  resolveHostedStripeBillingStatusForWrite,
  resolveHostedSubscriptionBillingStatus,
} from "../src/lib/hosted-onboarding/stripe-billing-status";

describe("resolveHostedSubscriptionBillingStatus", () => {
  it("keeps active subscriptions active when billing is already active", () => {
    expect(
      resolveHostedSubscriptionBillingStatus({
        currentBillingStatus: HostedBillingStatus.active,
        nextBillingStatus: HostedBillingStatus.active,
      }),
    ).toBe(HostedBillingStatus.active);
  });

  it("downgrades first active subscription events to incomplete until invoice confirmation arrives", () => {
    expect(
      resolveHostedSubscriptionBillingStatus({
        currentBillingStatus: HostedBillingStatus.not_started,
        nextBillingStatus: HostedBillingStatus.active,
      }),
    ).toBe(HostedBillingStatus.incomplete);
  });
});

describe("resolveHostedStripeBillingStatusForWrite", () => {
  it("prefers canonical subscription state for subscription events", () => {
    expect(
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingStatus: HostedBillingStatus.active,
        sourceType: "stripe.customer.subscription.updated",
      }),
    ).toBe(HostedBillingStatus.active);
  });

  it("upgrades invoice.paid writes to active when Stripe reports an active subscription", () => {
    expect(
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.incomplete,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingStatus: HostedBillingStatus.incomplete,
        sourceType: "stripe.invoice.paid",
      }),
    ).toBe(HostedBillingStatus.active);
  });

  it("lets billing reversals write the explicit reversal status without canonical lookup", () => {
    expect(
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.unpaid,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingStatus: HostedBillingStatus.active,
        sourceType: "stripe.refund.created",
      }),
    ).toBe(HostedBillingStatus.unpaid);
  });

  it("throws when subscription or invoice events are missing canonical Stripe state", () => {
    expect(() =>
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: null,
        currentBillingStatus: HostedBillingStatus.active,
        sourceType: "stripe.invoice.payment_failed",
      })
    ).toThrow("Canonical Stripe subscription state is required");
  });

  it("falls back to the requested status for non-Stripe-canonical writes", () => {
    expect(
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: null,
        currentBillingStatus: HostedBillingStatus.active,
        sourceType: "hosted.manual.override",
      }),
    ).toBe(HostedBillingStatus.past_due);
  });
});
