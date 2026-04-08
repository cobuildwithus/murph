import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readHostedMemberStripeBillingRef } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedPrivyActiveRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";
import { requireHostedStripeApi } from "@/src/lib/hosted-onboarding/runtime";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedPrivyActiveRequestAuthContext(request, prisma);
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: auth.member.id,
    prisma,
  });
  const stripeCustomerId = billingRef?.stripeCustomerId ?? null;

  if (!stripeCustomerId) {
    throw hostedOnboardingError({
      code: "STRIPE_CUSTOMER_NOT_READY",
      message: "Your subscription is not ready for management yet.",
      httpStatus: 409,
    });
  }

  const stripe = requireHostedStripeApi();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: new URL("/settings", request.url).toString(),
  });

  if (!session.url) {
    throw hostedOnboardingError({
      code: "STRIPE_PORTAL_SESSION_MISSING_URL",
      message: "Stripe did not return a billing portal URL.",
      httpStatus: 502,
    });
  }

  return jsonOk({
    url: session.url,
  });
});
