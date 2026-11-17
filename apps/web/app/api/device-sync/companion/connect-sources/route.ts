import { readCompanionConnectSources } from "@/src/lib/device-sync/companion-connect-sources";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (request: Request) => {
  const { member } = await requireHostedMemberAuthFromBearerToken(request);
  return jsonOk(await readCompanionConnectSources(member));
});
