import { after } from "next/server";

import { preProvisionManagedUserCryptoInHostedExecutionBestEffort } from "@/src/lib/hosted-execution/control";
import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { requireHostedPrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.billing-checkout");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requireHostedPrivyMemberAuth(request);
    const { body, inviteCode } = await requireHostedInviteCodeFromRequest(request);
    const checkout = await createHostedBillingCheckout({
      inviteCode,
      member: auth.member,
      ...(typeof body.shareCode === "string" ? { shareCode: body.shareCode } : {}),
    });
    const warmupScheduled = !checkout.alreadyActive;

    if (warmupScheduled) {
      after(async () => {
        await preProvisionManagedUserCryptoInHostedExecutionBestEffort({
          trigger: "billing-checkout-route",
          userId: auth.member.id,
        });
      });
    }

    finishHostedOnboardingTiming(timing, "completed", {
      alreadyActive: checkout.alreadyActive,
      shareCodeProvided: typeof body.shareCode === "string",
      warmupScheduled,
    });

    return jsonOk(checkout);
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
});
