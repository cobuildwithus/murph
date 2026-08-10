import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  buildHostedFamilyStripeCapacityUpdateItems,
  createEmptyHostedFamilyPlanCapacities,
  hostedFamilyPlanCapacitiesEqual,
  parseHostedFamilyPlanCapacities,
  readHostedFamilyPlanCapacities,
  readHostedFamilyStripePlanState,
  sumHostedFamilyPlanCapacities,
} from "@/src/lib/hosted-onboarding/family-plan-capacity";

const PRICE_IDS = {
  edge: "price_family_edge",
  max: "price_family_max",
  pulse: "price_family_pulse",
} as const;

describe("hosted Family exact-tier capacity", () => {
  it("parses bounded exact quantities and rejects unknown tiers", () => {
    expect(parseHostedFamilyPlanCapacities({ edge: 1, max: 1, pulse: 1 })).toEqual({
      edge: 1,
      max: 1,
      pulse: 1,
    });
    expect(parseHostedFamilyPlanCapacities({ pulse: 2 })).toEqual({
      edge: 0,
      max: 0,
      pulse: 2,
    });
    expect(parseHostedFamilyPlanCapacities({ edge: 0, future: 1, pulse: 2 })).toBeNull();
    expect(parseHostedFamilyPlanCapacities({ edge: 0, pulse: 1 })).toBeNull();
    expect(parseHostedFamilyPlanCapacities({ edge: 2, pulse: 5 })).toBeNull();
    expect(parseHostedFamilyPlanCapacities({ edge: -1, pulse: 3 })).toBeNull();
    expect(parseHostedFamilyPlanCapacities({ edge: 0.5, pulse: 2 })).toBeNull();
    expect(sumHostedFamilyPlanCapacities({ edge: 1, max: 1, pulse: 2 })).toBe(4);
    expect(hostedFamilyPlanCapacitiesEqual(
      { edge: 1, max: 1, pulse: 2 },
      { edge: 1, max: 1, pulse: 2 },
    )).toBe(true);
    expect(createEmptyHostedFamilyPlanCapacities()).toEqual({
      edge: 0,
      max: 0,
      pulse: 0,
    });
  });

  it("reads one positive persisted row per known tier with a Pulse legacy fallback", () => {
    expect(readHostedFamilyPlanCapacities([
      { billedQuantity: 2, planCode: "pulse" },
      { billedQuantity: 1, planCode: "edge" },
      { billedQuantity: 1, planCode: "max" },
    ])).toEqual({ edge: 1, max: 1, pulse: 2 });
    expect(readHostedFamilyPlanCapacities([], 3)).toEqual({ edge: 0, max: 0, pulse: 3 });
    expect(readHostedFamilyPlanCapacities([], 2)).toEqual({ edge: 0, max: 0, pulse: 2 });
    expect(readHostedFamilyPlanCapacities([
      { billedQuantity: 2, planCode: "pulse" },
      { billedQuantity: 1, planCode: "edge" },
    ], 6)).toEqual({ edge: 1, max: 0, pulse: 2 });
    expect(readHostedFamilyPlanCapacities([
      { billedQuantity: 2, planCode: "pulse" },
      { billedQuantity: 1, planCode: "pulse" },
    ])).toBeNull();
    expect(readHostedFamilyPlanCapacities([
      { billedQuantity: 2, planCode: "future" },
    ])).toBeNull();
    expect(readHostedFamilyPlanCapacities([
      { billedQuantity: 0, planCode: "pulse" },
      { billedQuantity: 2, planCode: "edge" },
    ])).toBeNull();
  });

  it("maps one monthly licensed Stripe subscription item per exact tier", () => {
    const pulseItem = subscriptionItem("si_pulse", PRICE_IDS.pulse, 2);
    const edgeItem = subscriptionItem("si_edge", PRICE_IDS.edge, 1);
    const maxItem = subscriptionItem("si_max", PRICE_IDS.max, 1);
    const mixedSubscription = subscription([pulseItem, edgeItem, maxItem]);

    expect(readPreMaxHostedFamilyStripePlanState(mixedSubscription)).toBeNull();

    const state = readHostedFamilyStripePlanState({
      priceIdsByPlan: PRICE_IDS,
      subscription: mixedSubscription,
    });

    expect(state?.capacities).toEqual({ edge: 1, max: 1, pulse: 2 });
    expect(state?.itemsByPlan).toEqual({
      edge: edgeItem,
      max: maxItem,
      pulse: pulseItem,
    });
  });

  it("rejects unknown, duplicate, paginated, and incompatible Stripe items", () => {
    expect(readHostedFamilyStripePlanState({
      priceIdsByPlan: PRICE_IDS,
      subscription: subscription([subscriptionItem("si_unknown", "price_unknown", 2)]),
    })).toBeNull();
    expect(readHostedFamilyStripePlanState({
      priceIdsByPlan: PRICE_IDS,
      subscription: subscription([
        subscriptionItem("si_pulse_1", PRICE_IDS.pulse, 1),
        subscriptionItem("si_pulse_2", PRICE_IDS.pulse, 1),
      ]),
    })).toBeNull();
    expect(readHostedFamilyStripePlanState({
      priceIdsByPlan: PRICE_IDS,
      subscription: subscription([
        subscriptionItem("si_pulse", PRICE_IDS.pulse, 1),
        subscriptionItem("si_edge", PRICE_IDS.edge, 1, { currency: "eur" }),
      ]),
    })).toBeNull();
    expect(readHostedFamilyStripePlanState({
      priceIdsByPlan: PRICE_IDS,
      subscription: subscription([
        subscriptionItem("si_pulse", PRICE_IDS.pulse, 2, { usageType: "metered" }),
      ]),
    })).toBeNull();
    expect(readHostedFamilyStripePlanState({
      priceIdsByPlan: PRICE_IDS,
      subscription: subscription([
        subscriptionItem("si_pulse", PRICE_IDS.pulse, 2, { interval: "year" }),
      ]),
    })).toBeNull();
    expect(readHostedFamilyStripePlanState({
      priceIdsByPlan: PRICE_IDS,
      subscription: subscription([
        subscriptionItem("si_pulse", PRICE_IDS.pulse, 2),
      ], true),
    })).toBeNull();
  });

  it("builds a stable item delta with explicit deletion and exact additions", () => {
    const pulseItem = subscriptionItem("si_pulse", PRICE_IDS.pulse, 2);
    const edgeItem = subscriptionItem("si_edge", PRICE_IDS.edge, 1);

    expect(buildHostedFamilyStripeCapacityUpdateItems({
      current: {
        capacities: { edge: 1, max: 0, pulse: 2 },
        itemsByPlan: { edge: edgeItem, pulse: pulseItem },
      },
      priceIdsByPlan: PRICE_IDS,
      target: { edge: 0, max: 3, pulse: 0 },
    })).toEqual([
      { deleted: true, id: "si_pulse" },
      { deleted: true, id: "si_edge" },
      { price: PRICE_IDS.max, quantity: 3 },
    ]);

    expect(buildHostedFamilyStripeCapacityUpdateItems({
      current: {
        capacities: { edge: 0, max: 0, pulse: 2 },
        itemsByPlan: { pulse: pulseItem },
      },
      priceIdsByPlan: PRICE_IDS,
      target: { edge: 1, max: 0, pulse: 2 },
    })).toEqual([{ price: PRICE_IDS.edge, quantity: 1 }]);
  });
});

function readPreMaxHostedFamilyStripePlanState(
  value: Stripe.Subscription,
): Stripe.Subscription | null {
  const supportedPriceIds = new Set<string>([PRICE_IDS.edge, PRICE_IDS.pulse]);
  return value.items.data.every((item) => supportedPriceIds.has(item.price.id))
    ? value
    : null;
}

function subscriptionItem(
  id: string,
  priceId: string,
  quantity: number,
  overrides: {
    currency?: string;
    interval?: Stripe.Price.Recurring.Interval;
    usageType?: Stripe.Price.Recurring.UsageType;
  } = {},
): Stripe.SubscriptionItem {
  return {
    id,
    price: {
      currency: overrides.currency ?? "usd",
      id: priceId,
      recurring: {
        interval: overrides.interval ?? "month",
        interval_count: 1,
        usage_type: overrides.usageType ?? "licensed",
      },
    },
    quantity,
  } as Stripe.SubscriptionItem;
}

function subscription(
  items: Stripe.SubscriptionItem[],
  hasMore = false,
): Stripe.Subscription {
  return {
    items: {
      data: items,
      has_more: hasMore,
    },
  } as Stripe.Subscription;
}
