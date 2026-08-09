import { beforeEach, describe, expect, it } from "vitest";

import {
  createHostedBillingPlanQuote,
  verifyHostedBillingPlanQuote,
  type HostedBillingPlanQuoteState,
} from "@/src/lib/hosted-onboarding/billing-plan-quote";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const STATE: HostedBillingPlanQuoteState = {
  billingStatus: "active",
  currentBillingPhase: "paid",
  currentBillingPlanCode: "launch_group_monthly",
  currentCheckoutOffer: "standard",
  currentPeriodEnd: "2026-08-27T04:00:00.000Z",
  hasStripeCustomerId: true,
  hasStripeSubscriptionId: true,
  scheduledBillingEffectiveAt: null,
  scheduledBillingPlanCode: null,
};

describe("hosted billing plan quotes", () => {
  beforeEach(() => {
    process.env.HOSTED_APP_SESSION_HMAC_KEY =
      Buffer.alloc(32, 29).toString("base64url");
  });

  it("binds the member, billing state, target, exact price, timing, and expiry", () => {
    const quote = createHostedBillingPlanQuote({
      memberId: "member_quote",
      now: NOW,
      state: STATE,
      targetPlanCode: "launch_monthly",
      timing: "immediate",
    });

    expect(quote).toMatchObject({
      action: "change_plan",
      expiresAt: "2026-07-27T12:10:00.000Z",
      label: "Upgrade to Pulse ($8/month)",
      monthlyPriceUsdCents: 800,
      targetPlanCode: "launch_monthly",
      timing: "immediate",
    });
    expect(verifyHostedBillingPlanQuote({
      memberId: "member_quote",
      now: NOW,
      quoteId: quote.quoteId,
      state: STATE,
      targetPlanCode: "launch_monthly",
    })).toBe("immediate");
  });

  it("quotes an immediate paid Core start from a retained legacy trial state", () => {
    const quote = createHostedBillingPlanQuote({
      memberId: "member_trial_quote",
      now: NOW,
      state: {
        ...STATE,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
      },
      targetPlanCode: "launch_group_monthly",
      timing: "now",
    });

    expect(quote).toMatchObject({
      label: "Start Core now ($3.50/month)",
      monthlyPriceUsdCents: 350,
      targetPlanCode: "launch_group_monthly",
      timing: "now",
    });
  });

  it.each([
    {
      appliedState: {
        ...STATE,
        currentBillingPlanCode: "launch_monthly",
      },
      name: "immediate upgrade",
      targetPlanCode: "launch_monthly" as const,
      timing: "immediate" as const,
    },
    {
      appliedState: {
        ...STATE,
        scheduledBillingEffectiveAt: STATE.currentPeriodEnd,
        scheduledBillingPlanCode: "launch_monthly",
      },
      name: "period-end switch",
      targetPlanCode: "launch_monthly" as const,
      timing: "period_end" as const,
    },
  ])("accepts an expired $name quote after that exact change is applied", ({
    appliedState,
    targetPlanCode,
    timing,
  }) => {
    const quote = createHostedBillingPlanQuote({
      memberId: "member_quote",
      now: NOW,
      state: STATE,
      targetPlanCode,
      timing,
    });

    expect(verifyHostedBillingPlanQuote({
      memberId: "member_quote",
      now: new Date("2026-07-27T12:30:00.000Z"),
      quoteId: quote.quoteId,
      state: appliedState,
      targetPlanCode,
    })).toBe(timing);
  });

  it.each([
    {
      name: "another member",
      verify: (quoteId: string) => verifyHostedBillingPlanQuote({
        memberId: "member_other",
        now: NOW,
        quoteId,
        state: STATE,
        targetPlanCode: "launch_monthly",
      }),
    },
    {
      name: "another target",
      verify: (quoteId: string) => verifyHostedBillingPlanQuote({
        memberId: "member_quote",
        now: NOW,
        quoteId,
        state: STATE,
        targetPlanCode: "launch_edge_monthly",
      }),
    },
    {
      name: "changed billing state",
      verify: (quoteId: string) => verifyHostedBillingPlanQuote({
        memberId: "member_quote",
        now: NOW,
        quoteId,
        state: {
          ...STATE,
          scheduledBillingPlanCode: "launch_monthly",
        },
        targetPlanCode: "launch_monthly",
      }),
    },
    {
      name: "changed billing period",
      verify: (quoteId: string) => verifyHostedBillingPlanQuote({
        memberId: "member_quote",
        now: NOW,
        quoteId,
        state: {
          ...STATE,
          currentPeriodEnd: "2026-09-27T04:00:00.000Z",
        },
        targetPlanCode: "launch_monthly",
      }),
    },
    {
      name: "expired time",
      verify: (quoteId: string) => verifyHostedBillingPlanQuote({
        memberId: "member_quote",
        now: new Date("2026-07-27T12:10:00.000Z"),
        quoteId,
        state: STATE,
        targetPlanCode: "launch_monthly",
      }),
    },
    {
      name: "tampered signature",
      verify: (quoteId: string) => verifyHostedBillingPlanQuote({
        memberId: "member_quote",
        now: NOW,
        quoteId: `${quoteId.slice(0, -1)}${quoteId.endsWith("x") ? "y" : "x"}`,
        state: STATE,
        targetPlanCode: "launch_monthly",
      }),
    },
  ])("rejects a quote bound to $name", ({ verify }) => {
    const quote = createHostedBillingPlanQuote({
      memberId: "member_quote",
      now: NOW,
      state: STATE,
      targetPlanCode: "launch_monthly",
      timing: "immediate",
    });

    expect(() => verify(quote.quoteId)).toThrow(
      "That plan quote is no longer current.",
    );
  });
});
