import { startCompanionConnection } from "@/src/lib/device-sync/companion-connect";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readHostedOnboardingJsonObject } from "@/src/lib/hosted-onboarding/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { resolveDecodedRouteParam } from "@/src/lib/http";

// The body names which app build the provider returns to ("ios" or "ios-dev").
// It is a name from a closed set, never a URL.
export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request);
  const sourceId = await resolveDecodedRouteParam(context.params, "sourceId");
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 1024,
    tooLargeErrorCode: "COMPANION_CONNECT_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "The connect request is too large.",
  });

  return jsonOk(await startCompanionConnection({
    appReturn: body.appReturn,
    auth,
    request,
    sourceId,
  }));
});
