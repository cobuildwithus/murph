import { disconnectCompanionConnectSource } from "@/src/lib/device-sync/companion-connect";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { resolveDecodedRouteParam } from "@/src/lib/http";

// Stopping a source reduces authority, so it needs a signed-in member but not
// product access. The request names only the source; the server finds the
// connection and refuses anything wider than that one source.
export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) => {
  const auth = await requireHostedMemberAuthFromBearerToken(request);
  const sourceId = await resolveDecodedRouteParam(context.params, "sourceId");

  return jsonOk(await disconnectCompanionConnectSource({ auth, request, sourceId }));
});
