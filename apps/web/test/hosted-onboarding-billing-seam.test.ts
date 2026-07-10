import { describe, expect, expectTypeOf, it } from "vitest";

import {
  composeHostedMemberBillingSnapshot,
  composeHostedMemberSnapshot,
  type HostedMemberBillingSnapshot,
  type HostedMemberCoreState,
} from "@/src/lib/hosted-onboarding/hosted-member-store";

type PositiveSourceMemberIdInput = Parameters<
  typeof import("@/src/lib/hosted-onboarding/member-activation").activateHostedMemberForPositiveSourceTx
>[0]["memberId"];

type StripeLookupResult = Awaited<
  ReturnType<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup").findMemberForStripeObject
  >
>;

type StripeBillingPolicyMemberInput = Parameters<
  typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy").writeHostedMemberStripeBillingTx
>[0]["member"];

describe("hosted onboarding billing seam", () => {
  it("keeps the billing-only member view separate from the full snapshot", () => {
    const core: HostedMemberCoreState = {
      billingStatus: "active",
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-14T00:00:00.000Z"),
    };
    const billingRef = {
      memberId: core.id,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };

    const billing = composeHostedMemberBillingSnapshot(core, billingRef);
    const full = composeHostedMemberSnapshot(core, {
      billingRef,
      identity: null,
      routing: null,
    });

    expect(billing).toEqual({
      billingRef,
      core,
    });
    expect("identity" in billing).toBe(false);
    expect("routing" in billing).toBe(false);
    expect(full).toEqual({
      ...billing,
      identity: null,
      routing: null,
    });
  });

  it("keeps Stripe lookup and billing policy on the billing-only member view", () => {
    expectTypeOf<StripeLookupResult>().toEqualTypeOf<
      HostedMemberBillingSnapshot | null
    >();
    expectTypeOf<StripeBillingPolicyMemberInput>().toEqualTypeOf<
      HostedMemberBillingSnapshot
    >();
  });

  it("lets positive activation depend on the member id instead of a billing snapshot", () => {
    expectTypeOf<PositiveSourceMemberIdInput>().toEqualTypeOf<string>();
  });
});
