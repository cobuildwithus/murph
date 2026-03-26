import { beginHostedPasskeyAuthentication } from "@/src/lib/hosted-onboarding/service";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";

export async function POST(request: Request) {
  try {
    const { inviteCode } = await requireHostedInviteCodeFromRequest(request);
    return jsonOk(await beginHostedPasskeyAuthentication({ inviteCode }));
  } catch (error) {
    return jsonError(error);
  }
}
