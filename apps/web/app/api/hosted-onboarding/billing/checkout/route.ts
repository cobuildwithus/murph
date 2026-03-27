import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";
import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/service";
import { requireHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export async function POST(request: Request) {
  try {
    const { body, inviteCode } = await requireHostedInviteCodeFromRequest(request);
    const sessionRecord = await requireHostedSessionFromRequest(request);
    return jsonOk(
      await createHostedBillingCheckout({
        inviteCode,
        sessionRecord,
        ...(typeof body.shareCode === "string" ? { shareCode: body.shareCode } : {}),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
