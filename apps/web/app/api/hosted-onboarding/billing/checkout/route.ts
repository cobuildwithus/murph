import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import {
  parseHostedPublicBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.billing-checkout");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const prisma = getPrisma();
    const auth = await requireHostedAppSessionFromRequest(request);
    const { body, inviteCode } = await requireHostedInviteCodeFromRequest(request);
    const billingPlanCode = parseHostedPublicBillingPlanCode(
      body.billingPlanCode,
    );
    if (body.billingPlanCode !== undefined && !billingPlanCode) {
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_PLAN_INVALID",
        httpStatus: 400,
        message: "billingPlanCode must be one of the configured Murph billing plans.",
      });
    }

    await assertHostedLaunchRequiredConsentGranted({
      memberId: auth.member.id,
      prisma,
    });

    const checkout = await createHostedBillingCheckout({
      ...(billingPlanCode ? { billingPlanCode } : {}),
      inviteCode,
      member: {
        id: auth.member.id,
        suspendedAt: auth.member.suspendedAt,
      },
    });

    finishHostedOnboardingTiming(timing, "completed", {
      alreadyActive: checkout.alreadyActive,
    });

    return jsonOk(checkout);
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
});
