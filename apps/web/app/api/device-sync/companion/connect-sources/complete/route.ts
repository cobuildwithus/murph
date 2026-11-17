import { completeCompanionConnection } from "@/src/lib/device-sync/companion-connect";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readHostedOnboardingJsonObject } from "@/src/lib/hosted-onboarding/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

// The app posts the provider's return query and the proof its own start gave
// it. Nothing here trusts the query alone: the bearer names the member and
// session, and the proof binds both to the pending state.
export const POST = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request);
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 4 * 1024,
    tooLargeErrorCode: "COMPANION_CONNECT_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "The connect request is too large.",
  });

  return jsonOk(await completeCompanionConnection({ auth, body, request }));
});
