import type Stripe from "stripe";

import {
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_FAMILY_MIN_SEATS,
  HOSTED_FAMILY_PLAN_CODES,
  parseHostedFamilyPlanCode,
  type HostedFamilyPlanCode,
} from "./billing-plans";

export type HostedFamilyPlanCapacities = Record<HostedFamilyPlanCode, number>;

export interface HostedFamilyStripePlanState {
  capacities: HostedFamilyPlanCapacities;
  itemsByPlan: Partial<Record<HostedFamilyPlanCode, Stripe.SubscriptionItem>>;
}

export function createEmptyHostedFamilyPlanCapacities(): HostedFamilyPlanCapacities {
  return { edge: 0, max: 0, pulse: 0 };
}

export function readHostedFamilyPlanCapacities(
  rows: readonly { billedQuantity: number; planCode: string }[],
  legacyPulseQuantity: number | null = null,
): HostedFamilyPlanCapacities | null {
  if (rows.length === 0 && legacyPulseQuantity !== null) {
    return parseHostedFamilyPlanCapacities({
      edge: 0,
      max: 0,
      pulse: legacyPulseQuantity,
    });
  }

  const capacities = createEmptyHostedFamilyPlanCapacities();
  for (const row of rows) {
    const planCode = parseHostedFamilyPlanCode(row.planCode);
    if (
      !planCode ||
      !Number.isInteger(row.billedQuantity) ||
      row.billedQuantity < 1 ||
      capacities[planCode] !== 0
    ) {
      return null;
    }
    capacities[planCode] = row.billedQuantity;
  }

  return hasValidHostedFamilyPlanCapacityTotal(capacities) ? capacities : null;
}

export function parseHostedFamilyPlanCapacities(
  value: unknown,
): HostedFamilyPlanCapacities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !parseHostedFamilyPlanCode(key))) {
    return null;
  }

  const capacities = createEmptyHostedFamilyPlanCapacities();
  for (const planCode of HOSTED_FAMILY_PLAN_CODES) {
    const quantity = record[planCode] ?? 0;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) {
      return null;
    }
    capacities[planCode] = quantity;
  }
  return hasValidHostedFamilyPlanCapacityTotal(capacities) ? capacities : null;
}

export function readHostedFamilyStripePlanState(input: {
  priceIdsByPlan: Readonly<Record<HostedFamilyPlanCode, string | null>>;
  subscription: Stripe.Subscription;
}): HostedFamilyStripePlanState | null {
  if (input.subscription.items?.has_more) {
    return null;
  }

  const planByPriceId = new Map<string, HostedFamilyPlanCode>();
  for (const planCode of HOSTED_FAMILY_PLAN_CODES) {
    const priceId = input.priceIdsByPlan[planCode];
    if (!priceId) {
      continue;
    }
    if (planByPriceId.has(priceId)) {
      return null;
    }
    planByPriceId.set(priceId, planCode);
  }

  const capacities = createEmptyHostedFamilyPlanCapacities();
  const itemsByPlan: Partial<Record<HostedFamilyPlanCode, Stripe.SubscriptionItem>> = {};
  let currency: string | null = null;
  for (const item of input.subscription.items?.data ?? []) {
    const planCode = planByPriceId.get(item.price.id);
    const quantity = item.quantity;
    const recurring = item.price.recurring;
    const itemCurrency = item.price.currency?.toLowerCase();
    if (
      !planCode ||
      itemsByPlan[planCode] ||
      quantity === undefined ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      !recurring ||
      recurring.interval !== "month" ||
      recurring.interval_count !== 1 ||
      recurring.usage_type !== "licensed" ||
      !itemCurrency ||
      (currency !== null && currency !== itemCurrency)
    ) {
      return null;
    }
    currency = itemCurrency;
    capacities[planCode] = quantity;
    itemsByPlan[planCode] = item;
  }

  return hasValidHostedFamilyPlanCapacityTotal(capacities)
    ? { capacities, itemsByPlan }
    : null;
}

export function buildHostedFamilyStripeCapacityUpdateItems(input: {
  current: HostedFamilyStripePlanState;
  priceIdsByPlan: Readonly<Record<HostedFamilyPlanCode, string | null>>;
  target: HostedFamilyPlanCapacities;
}): Stripe.SubscriptionUpdateParams.Item[] {
  if (!hasValidHostedFamilyPlanCapacityTotal(input.target)) {
    throw new RangeError("Family capacity must cover 2 to 6 people.");
  }

  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  for (const planCode of HOSTED_FAMILY_PLAN_CODES) {
    const currentItem = input.current.itemsByPlan[planCode];
    const targetQuantity = input.target[planCode];
    if (input.current.capacities[planCode] === targetQuantity) {
      continue;
    }
    if (currentItem && targetQuantity === 0) {
      items.push({ deleted: true, id: currentItem.id });
      continue;
    }
    if (currentItem) {
      items.push({ id: currentItem.id, quantity: targetQuantity });
      continue;
    }
    const priceId = input.priceIdsByPlan[planCode];
    if (!priceId) {
      throw new TypeError(`Family ${planCode} Stripe Price is not configured.`);
    }
    items.push({ price: priceId, quantity: targetQuantity });
  }
  return items;
}

export function hostedFamilyPlanCapacitiesEqual(
  left: HostedFamilyPlanCapacities,
  right: HostedFamilyPlanCapacities,
): boolean {
  return HOSTED_FAMILY_PLAN_CODES.every(
    (planCode) => left[planCode] === right[planCode],
  );
}

export function sumHostedFamilyPlanCapacities(
  capacities: HostedFamilyPlanCapacities,
): number {
  return HOSTED_FAMILY_PLAN_CODES.reduce(
    (sum, planCode) => sum + capacities[planCode],
    0,
  );
}

export function hasValidHostedFamilyPlanCapacityTotal(
  capacities: HostedFamilyPlanCapacities,
): boolean {
  const total = sumHostedFamilyPlanCapacities(capacities);
  return HOSTED_FAMILY_PLAN_CODES.every(
    (planCode) => Number.isInteger(capacities[planCode]) && capacities[planCode] >= 0,
  ) && total >= HOSTED_FAMILY_MIN_SEATS && total <= HOSTED_FAMILY_MAX_SEATS;
}
