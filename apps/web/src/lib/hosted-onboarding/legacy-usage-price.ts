import type Stripe from "stripe";

export const HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY =
  "murphHostedAiUsagePrice";
export const HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE =
  "legacy_hosted_ai_usage";

export function isHostedStripeLegacyAiUsageMeteredItem(
  item: Stripe.SubscriptionItem,
): boolean {
  const recurring = item.price?.recurring;
  return recurring?.interval === "month" &&
    (recurring.interval_count ?? 1) === 1 &&
    recurring.usage_type === "metered" &&
    item.price?.metadata?.[HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY] ===
      HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE &&
    !hasHostedStripeSubscriptionItemQuantity(item);
}

function hasHostedStripeSubscriptionItemQuantity(item: Stripe.SubscriptionItem): boolean {
  return typeof item.quantity === "number" && Number.isFinite(item.quantity);
}
