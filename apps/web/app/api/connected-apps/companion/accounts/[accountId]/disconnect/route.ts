import { requirePersonalConnectedAppsMember } from "@/src/lib/connected-apps/personal-member";
import { disconnectCompanionConnectedApp } from "@/src/lib/connected-apps/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request, context: { params: Promise<{ accountId: string }> }) => {
  const { member } = await requireHostedMemberAuthFromBearerToken(request);
  await requirePersonalConnectedAppsMember(member.id);
  const { accountId } = await context.params;
  return jsonOk(await disconnectCompanionConnectedApp(member.id, accountId));
});
