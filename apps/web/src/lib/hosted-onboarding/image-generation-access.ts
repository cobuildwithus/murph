import "server-only";

import type { PrismaClient } from "@prisma/client";
import { readHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { getPrisma } from "../prisma";
import { readHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import { requireHostedStripeApiMode } from "./runtime";

export async function readHostedImageGenerationAccess(input: {
  memberId: string;
  prisma?: PrismaClient;
}): Promise<{ allowed: boolean; reason: "allowed" | "card_required" | "usage_unavailable" }> {
  const prisma = input.prisma ?? getPrisma();
  const gate = await readHostedAiUsageGate({ memberId: input.memberId, prisma });
  if (!gate.allowed) return { allowed: false, reason: "usage_unavailable" };
  if (gate.allowanceSource !== "direct_starter") {
    return { allowed: true, reason: "allowed" };
  }
  const billingRef = await readHostedMemberStripeBillingRef({ memberId: input.memberId, prisma });
  if (!billingRef?.stripeCustomerId) return { allowed: false, reason: "card_required" };
  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
  // Stripe owns current card attachment. Do not cache an ever-added-card flag:
  // a detached card must stop authorizing later image requests.
  const cards = await stripe.paymentMethods.list({
    customer: billingRef.stripeCustomerId,
    limit: 1,
    type: "card",
  }, { maxNetworkRetries: 0, timeout: 5_000 });
  const card = cards.data[0];
  const attachedCustomer = typeof card?.customer === "string"
    ? card.customer : card?.customer?.id;
  const current = await readHostedMemberStripeBillingRef({ memberId: input.memberId, prisma });
  const allowed = Boolean(card?.type === "card"
    && card.livemode === stripeLiveMode
    && attachedCustomer === billingRef.stripeCustomerId
    && current?.stripeCustomerId === billingRef.stripeCustomerId);
  return { allowed, reason: allowed ? "allowed" : "card_required" };
}
