import { jsonError } from "@/src/lib/hosted-onboarding/http";
import { finishHostedPasskeyAuthentication } from "@/src/lib/hosted-onboarding/service";
import {
  createHostedStageSessionResponse,
  requireHostedInviteCodeFromRequest,
} from "@/src/lib/hosted-onboarding/route-helpers";

export async function POST(request: Request) {
  try {
    const { body, inviteCode } = await requireHostedInviteCodeFromRequest(request);
    const result = await finishHostedPasskeyAuthentication({
      inviteCode,
      response: body.response,
      userAgent: request.headers.get("user-agent"),
    });
    return createHostedStageSessionResponse(result);
  } catch (error) {
    return jsonError(error);
  }
}
