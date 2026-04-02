import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedPrivyRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
    const { inviteCode } = await context.params;
    const auth = await resolveHostedPrivyRequestAuthContext(request);
    return jsonOk(
      await getHostedInviteStatus({
        authenticatedMember: auth?.member ?? null,
        inviteCode: decodeURIComponent(inviteCode),
      }),
    );
});
