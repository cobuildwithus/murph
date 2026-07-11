import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildHostedRuntimeBillingPlanActionApprovalRequest,
  buildHostedRuntimeFamilyActionApprovalRequest,
} from "@/src/lib/hosted-execution/billing-family-action-approval";

const BILLING_STATUS = {
  billingStatus: "active",
  canStartPaidPulse: false,
  canSwitchToPulseAtRenewal: false,
  canUpgradeToEdge: true,
  currentBillingPhase: "paid",
  currentBillingPlanCode: "launch_monthly",
  currentCheckoutOffer: "standard",
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  planPresentations: [
    {
      code: "launch_monthly" as const,
      displayName: "Pulse",
      interval: "month" as const,
      recurringAmountUsdCents: 800,
    },
    {
      code: "launch_edge_monthly" as const,
      displayName: "Edge",
      interval: "month" as const,
      recurringAmountUsdCents: 2_000,
    },
  ],
  portalAvailable: true,
  scheduledBillingEffectiveAt: null,
  scheduledBillingPlanCode: null,
  sponsoredFamilyAccess: false,
};

const FAMILY_STATUS = {
  billingActive: true,
  billingStatus: "active",
  members: [],
  owner: true,
  pendingInvites: [],
  pricing: {
    currency: "USD" as const,
    currentRecurringAmountUsdCents: 2_100,
    interval: "month" as const,
    recurringAmountUsdCentsPerSeat: 700,
    seatDecreaseTiming: "immediate_without_proration" as const,
    seatIncreaseTiming: "immediate_with_proration_and_immediate_invoice" as const,
  },
  seats: {
    active: 2,
    billed: 3,
    invited: 0,
    max: 6,
    min: 2,
    remaining: 1,
    used: 2,
  },
};

describe("hosted billing and Family exact-action approvals", () => {
  it("binds billing approval to canonical price, cadence, and charge timing", () => {
    const original = buildHostedRuntimeBillingPlanActionApprovalRequest({
      action: "upgrade_to_edge",
      returnContactKind: "text",
      status: BILLING_STATUS,
    });
    const repriced = buildHostedRuntimeBillingPlanActionApprovalRequest({
      action: "upgrade_to_edge",
      returnContactKind: "text",
      status: {
        ...BILLING_STATUS,
        planPresentations: BILLING_STATUS.planPresentations.map((plan) =>
          plan.code === "launch_edge_monthly"
            ? { ...plan, recurringAmountUsdCents: 2_500 }
            : plan
        ),
      },
    });

    expect(original.actionFingerprint).not.toBe(repriced.actionFingerprint);
    expect(original.actionId).not.toBe(repriced.actionId);
    expect(original.presentation.body).toContain("$20.00 USD per month");
    expect(original.presentation.body).toContain("prorate");
    expect(original.presentation.body).toContain("immediately invoice");
    expect(original.returnContactKind).toBe("text");
  });

  it("binds target seat total and increase/decrease behavior", () => {
    const increase = buildHostedRuntimeFamilyActionApprovalRequest({
      action: "change_seat_count",
      returnContactKind: "telegram",
      status: FAMILY_STATUS,
      targetSeatCount: 4,
    });
    const decrease = buildHostedRuntimeFamilyActionApprovalRequest({
      action: "change_seat_count",
      returnContactKind: "telegram",
      status: {
        ...FAMILY_STATUS,
        pricing: {
          ...FAMILY_STATUS.pricing,
          currentRecurringAmountUsdCents: 2_800,
        },
        seats: { ...FAMILY_STATUS.seats, billed: 4, remaining: 2 },
      },
      targetSeatCount: 3,
    });

    expect(increase.actionFingerprint).not.toBe(decrease.actionFingerprint);
    expect(increase.presentation.body).toContain("$28.00 USD per month");
    expect(increase.presentation.body).toContain("immediately invoices");
    expect(decrease.presentation.body).toContain("without a prorated credit or refund");
    expect(decrease.presentation.body).toContain("next renewal");
  });
});
