import { listCompanionConnectedApps } from "@/src/lib/connected-apps/service";
import { requirePersonalConnectedAppsMember } from "@/src/lib/connected-apps/personal-member";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (request: Request) => {
  const { member } = await requireActiveHostedMemberAuthFromBearerToken(request);
  await requirePersonalConnectedAppsMember(member.id);
  return jsonOk(await listCompanionConnectedApps(member.id));
});
