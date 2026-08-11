import { deviceSyncError } from "@murphai/device-syncd/errors";

import { buildHostedDeviceConnectCompletionReturnTo } from "@/src/lib/device-sync/connect-completion-return";
import { assertHostedDeviceSyncBrowserCallbackHostname } from "@/src/lib/device-sync/public-base-url";
import {
  createMemberOwnedProviderSetupService,
  readMemberOwnedProviderSetupRegistration,
} from "@/src/lib/device-sync/provider-setup";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { readHostedDeviceSyncPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const providerParam = await resolveDecodedRouteParam(context.params, "provider");
  const registration = readMemberOwnedProviderSetupRegistration(providerParam);
  if (!registration) {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_PROVIDER_UNSUPPORTED",
      httpStatus: 404,
      message: "Private provider setup is not available for this source.",
      retryable: false,
    });
  }

  const auth = await requireActiveHostedAppSessionFromRequest(request);
  assertHostedDeviceSyncBrowserCallbackHostname({
    appSessionUrl: request.url,
    callbackBaseUrl: readHostedDeviceSyncPublicBaseUrl(),
  });
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: auth.member.id,
    prisma: getPrisma(),
  });
  const coordinates = registration.coordinates;
  const started = await createMemberOwnedProviderSetupService(coordinates.provider)
    .startOAuth({
      memberId: auth.member.id,
      request,
      returnTo: buildHostedDeviceConnectCompletionReturnTo({
        connectSourceId: coordinates.connectSourceId,
        connectTarget: coordinates.connectTarget,
        source: "connect",
      }),
      sessionId: auth.sessionId,
    });
  const response = jsonOk({
    authorizationUrl: started.authorizationUrl,
    presentation: registration.presentation,
    setup: started.setup,
  });
  response.headers.append("Set-Cookie", started.callbackProofCookie);
  return response;
});
