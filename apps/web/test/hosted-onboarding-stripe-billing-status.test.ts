import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  resolveHostedStripeBillingStatusForWrite,
} from "../src/lib/hosted-onboarding/stripe-billing-status";

describe("resolveHostedStripeBillingStatusForWrite", () => {
  it.each([
    [HostedBillingStatus.active, HostedBillingStatus.active],
    [HostedBillingStatus.not_started, HostedBillingStatus.incomplete],
  ])("maps an active canonical subscription for a %s member to %s", (currentBillingStatus, expectedStatus) => {
    expect(
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingStatus,
        sourceType: "stripe.customer.subscription.updated",
      }),
    ).toBe(expectedStatus);
  });

  it("treats trial_will_end as a canonical subscription event", () => {
    expect(
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.paused,
        currentBillingStatus: HostedBillingStatus.active,
        sourceType: "stripe.customer.subscription.trial_will_end",
      }),
    ).toBe(HostedBillingStatus.paused);

    expect(() =>
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: null,
        currentBillingStatus: HostedBillingStatus.active,
        sourceType: "stripe.customer.subscription.trial_will_end",
      })
    ).toThrow("Canonical Stripe subscription state is required");
  });

  it("keeps a resumed expired Pulse Trial incomplete until invoice.paid confirms conversion", () => {
    expect(
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.paused,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingStatus: HostedBillingStatus.paused,
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
        eventCreatedAt: new Date("2026-06-22T12:00:00.000Z"),
        sourceType: "stripe.customer.subscription.resumed",
      }),
    ).toBe(HostedBillingStatus.incomplete);
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

  it("lets successful refund updates write the explicit reversal status", () => {
    expect(
      resolveHostedStripeBillingStatusForWrite({
        billingStatus: HostedBillingStatus.unpaid,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingStatus: HostedBillingStatus.active,
        sourceType: "stripe.refund.updated",
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
