import { isDeviceSyncAppConnectReturn } from "@murphai/device-syncd/types";

import { requirePersonalConnectedAppsMember } from "@/src/lib/connected-apps/personal-member";
import { startCompanionConnectedApp } from "@/src/lib/connected-apps/service";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request, context: { params: Promise<{ appId: string }> }) => {
  const { member } = await requireActiveHostedMemberAuthFromBearerToken(request);
  await requirePersonalConnectedAppsMember(member.id);
  const { appId } = await context.params;
  const { appReturn } = await readHostedOnboardingJsonObject(request, {
    limitBytes: 1024,
    tooLargeErrorCode: "CONNECTED_APPS_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "The connect request is too large.",
  });
  if (!isDeviceSyncAppConnectReturn(appReturn)) {
    throw hostedOnboardingError({ code: "CONNECTED_APPS_REQUEST_INVALID", httpStatus: 400, message: "Choose a supported app build." });
  }
  return jsonOk(await startCompanionConnectedApp({ appReturn, memberId: member.id, toolkit: appId }));
});
