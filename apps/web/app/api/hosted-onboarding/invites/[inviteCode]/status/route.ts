import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/member-service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
    const { inviteCode } = await context.params;
    const sessionRecord = await resolveHostedSessionFromRequest(request);
    return jsonOk(
      await getHostedInviteStatus({
        inviteCode: decodeURIComponent(inviteCode),
        sessionRecord,
      }),
    );
});
