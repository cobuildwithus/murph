import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import { parseHostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { requirePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.billing-checkout");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requirePrivyMemberAuth(request);
    const { body, inviteCode } = await requireHostedInviteCodeFromRequest(request);
    const billingPlanCode = parseHostedBillingPlanCode(body.billingPlanCode);

    if (body.billingPlanCode !== undefined && !billingPlanCode) {
      throw new TypeError("billingPlanCode must be one of the configured Murph billing plans.");
    }

    await completeHostedPrivyVerification({
      identity: auth.identity,
      inviteCode,
      verifiedPrivyUser: auth.verifiedPrivyUser,
    });

    const checkout = await createHostedBillingCheckout({
      ...(billingPlanCode ? { billingPlanCode } : {}),
      inviteCode,
      linkedAccounts: auth.linkedAccounts,
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
