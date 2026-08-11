import type Stripe from "stripe";

import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedAccountGroupStripeBillingRef,
  readHostedFamilyOwnerSnapshotForMember,
} from "@/src/lib/hosted-onboarding/family-plan";
import { readHostedMemberStripeBillingRef } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { requireHostedStripeApi } from "@/src/lib/hosted-onboarding/runtime";
import { normalizeNullableString } from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readOptionalJsonObject(request, { limitBytes: 1_024 });
  const billingScope = body.billingScope === "family" ? "family" : "member";
  const stripeCustomerId =
    billingScope === "family"
      ? await readFamilyStripeCustomerId({
          memberId: auth.member.id,
          prisma,
        })
      : await readMemberStripeCustomerId({
          memberId: auth.member.id,
          prisma,
        });

  if (!stripeCustomerId) {
    throw hostedOnboardingError({
      code: "STRIPE_CUSTOMER_NOT_READY",
      message:
        billingScope === "family"
          ? "Your Family subscription is not ready for management yet."
          : "Your subscription is not ready for management yet.",
      httpStatus: 409,
    });
  }

  const stripe = requireHostedStripeApi();
  const familyPortalConfigurationId = normalizeNullableString(
    process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID,
  );
  const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
    customer: stripeCustomerId,
    return_url: new URL("/settings", request.url).toString(),
  };
  if (billingScope === "family" && familyPortalConfigurationId) {
    sessionParams.configuration = familyPortalConfigurationId;
  }
  const session = await stripe.billingPortal.sessions.create(sessionParams);

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

async function readMemberStripeCustomerId(input: {
  memberId: string;
  prisma: ReturnType<typeof getPrisma>;
}): Promise<string | null> {
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  return billingRef?.stripeCustomerId ?? null;
}

async function readFamilyStripeCustomerId(input: {
  memberId: string;
  prisma: ReturnType<typeof getPrisma>;
}): Promise<string | null> {
  const familyOwner = await readHostedFamilyOwnerSnapshotForMember({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!familyOwner) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_NOT_FOUND",
      httpStatus: 403,
      message: "Only the Family plan owner can manage Family billing.",
    });
  }

  const billingRef = await readHostedAccountGroupStripeBillingRef({
    groupId: familyOwner.groupId,
    prisma: input.prisma,
  });

  return billingRef?.stripeCustomerId ?? null;
}
