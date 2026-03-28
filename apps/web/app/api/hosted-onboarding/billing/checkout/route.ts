import { cookies } from "next/headers";

import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";
import { requireHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    return jsonError(error);
  }
}
