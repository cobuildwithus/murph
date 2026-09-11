import { randomUUID } from "node:crypto";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readHostedMemberStripeBillingRef } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { ensureHostedMemberStripeCustomer } from "@/src/lib/hosted-onboarding/hosted-member-stripe-customer";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedOnboardingPublicBaseUrl, requireHostedStripeApiMode } from "@/src/lib/hosted-onboarding/runtime";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const prisma = getPrisma();
  const customer = await ensureHostedMemberStripeCustomer({ memberId: auth.member.id, prisma });
  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
  const returnUrl = new URL("/settings#subscription", requireHostedOnboardingPublicBaseUrl()).toString();
  const session = await stripe.checkout.sessions.create({
    cancel_url: returnUrl,
    client_reference_id: auth.member.id,
    customer,
    mode: "setup",
    payment_method_types: ["card"],
    success_url: returnUrl,
  }, {
    idempotencyKey: `image-card:${randomUUID()}`,
    maxNetworkRetries: 0,
    timeout: 5_000,
  });
  const [current, member] = await Promise.all([
    readHostedMemberStripeBillingRef({ memberId: auth.member.id, prisma }),
    prisma.hostedMember.findUnique({ where: { id: auth.member.id }, select: { suspendedAt: true } }),
  ]);
  const sessionCustomer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!member || member.suspendedAt || current?.stripeCustomerId !== customer
    || sessionCustomer !== customer || session.mode !== "setup"
    || session.livemode !== stripeLiveMode || !session.url) {
    throw hostedOnboardingError({ code: "IMAGE_CARD_SETUP_UNAVAILABLE", httpStatus: 409,
      message: "Card setup is unavailable. Refresh Settings and try again." });
  }
  return jsonOk({ url: session.url });
});
