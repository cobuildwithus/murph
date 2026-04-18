import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrivySession } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
  const inviteCode = await resolveDecodedRouteParam(context.params, "inviteCode");
  const session = await getPrivySession(request);
  return jsonOk(
    await getHostedInviteStatus({
      authenticatedSessionIdentity: session?.identity ?? null,
      inviteCode,
    }),
  );
});
