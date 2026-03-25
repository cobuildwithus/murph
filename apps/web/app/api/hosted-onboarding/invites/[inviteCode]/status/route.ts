import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/service";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export async function GET(
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) {
  try {
    const { inviteCode } = await context.params;
    const sessionRecord = await resolveHostedSessionFromRequest(request);
    return jsonOk(
      await getHostedInviteStatus({
        inviteCode: decodeURIComponent(inviteCode),
        sessionRecord,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
