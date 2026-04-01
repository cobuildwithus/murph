import { cookies } from "next/headers";

import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";
import { requireHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";

export const POST = withJsonError(async (request: Request) => {
    assertHostedOnboardingMutationOrigin(request);
    const cookieStore = await cookies();
    const { body, inviteCode } = await requireHostedInviteCodeFromRequest(request);
    const sessionRecord = await requireHostedSessionFromCookieStore(cookieStore);
    return jsonOk(
      await createHostedBillingCheckout({
        cookieStore,
        inviteCode,
        sessionRecord,
        ...(typeof body.shareCode === "string" ? { shareCode: body.shareCode } : {}),
      }),
    );
});
