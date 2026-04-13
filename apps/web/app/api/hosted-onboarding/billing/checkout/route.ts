import { after } from "next/server";

import { preProvisionManagedUserCryptoInHostedExecutionBestEffort } from "@/src/lib/hosted-execution/control";
import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedPrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";

export const POST = withJsonError(async (request: Request) => {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requireHostedPrivyMemberAuth(request);
    const { body, inviteCode } = await requireHostedInviteCodeFromRequest(request);
    const checkout = await createHostedBillingCheckout({
      inviteCode,
      member: auth.member,
      ...(typeof body.shareCode === "string" ? { shareCode: body.shareCode } : {}),
    });

    if (!checkout.alreadyActive) {
      after(async () => {
        await preProvisionManagedUserCryptoInHostedExecutionBestEffort({
          trigger: "billing-checkout-route",
          userId: auth.member.id,
        });
      });
    }

    return jsonOk(checkout);
});
