import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
  const inviteCode = await resolveDecodedRouteParam(context.params, "inviteCode");
  const auth = await getPrivyMemberAuth(request);
  return jsonOk(
    await getHostedInviteStatus({
      authenticatedMember: auth?.member ?? null,
      authenticatedSessionIdentity: auth?.identity ?? null,
      inviteCode,
    }),
  );
});
