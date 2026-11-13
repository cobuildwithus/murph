import { syncCompanionConnectSource } from "@/src/lib/device-sync/companion-connect";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request);
  const sourceId = await resolveDecodedRouteParam(context.params, "sourceId");

  return jsonOk(await syncCompanionConnectSource({ auth, request, sourceId }));
});
