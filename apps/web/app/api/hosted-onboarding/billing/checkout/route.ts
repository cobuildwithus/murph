import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedPrivyRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";

export const POST = withJsonError(async (request: Request) => {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requireHostedPrivyRequestAuthContext(request);
    const { body, inviteCode } = await requireHostedInviteCodeFromRequest(request);
    return jsonOk(
      await createHostedBillingCheckout({
        inviteCode,
        member: auth.member,
        ...(typeof body.shareCode === "string" ? { shareCode: body.shareCode } : {}),
      }),
    );
});
