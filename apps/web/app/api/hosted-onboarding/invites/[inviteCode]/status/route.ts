import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
  const inviteCode = await resolveDecodedRouteParam(context.params, "inviteCode");
  const appSession = await getHostedAppSessionFromRequest(request);
  return jsonOk(
    await getHostedInviteStatus({
      authenticatedMember: appSession?.member ?? null,
      inviteCode,
    }),
  );
});
