import "server-only";

import {
  isDeviceConnectSourceAvailableForConnection,
  type DeviceSyncConnectTarget,
} from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { assertHostedDeviceSyncBrowserCallbackHostname } from "./public-base-url";
import { createHostedDeviceSyncPublicIngressService } from "./public-ingress-service";
import { buildHostedDeviceSyncCallbackProof } from "./browser-callback-proof";
import { assertHostedWhoopConnectCapacityAvailable } from "./whoop-connect-capacity";
import { requireActiveHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { readHostedDeviceSyncPublicBaseUrl } from "../hosted-web/public-url";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";
import { getPrisma } from "../prisma";

export interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
  callbackProofCookie: string;
}

export async function startHostedDeviceSyncConnection(input: {
  defaultReturnTo: string;
  request: Request;
  target: DeviceSyncConnectTarget;
}): Promise<HostedDeviceSyncConnectResponse> {
  if (input.target.provider === "strava") {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_REQUIRED",
      httpStatus: 409,
      message: "Direct Strava connections must use the private provider setup journey.",
      retryable: false,
    });
  }
  if (!isDeviceConnectSourceAvailableForConnection(input.target.connectSourceId)) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED",
      httpStatus: 404,
      message: "Hosted device connect source is not configured.",
      retryable: false,
    });
  }

  assertHostedOnboardingMutationOrigin(input.request);
  const auth = await requireActiveHostedAppSessionFromRequest(input.request);
  assertHostedDeviceSyncBrowserCallbackHostname({
    appSessionUrl: input.request.url,
    callbackBaseUrl: readHostedDeviceSyncPublicBaseUrl(),
  });
  const prisma = getPrisma();
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  await assertHostedWhoopConnectCapacityAvailable({
    memberId: auth.member.id,
    prisma,
    target: input.target,
  });
  const publicIngress = createHostedDeviceSyncPublicIngressService(input.request);
  await publicIngress.prepareConnectionStart(auth.member.id, input.target);
  const started = await publicIngress.startConnection(
    auth.member.id,
    input.target.provider,
    input.defaultReturnTo,
    {
      connectSourceId: input.target.connectSourceId,
      connectTarget: input.target.connectTarget,
      sourceProviderSlug: input.target.sourceProviderSlug ?? null,
    },
  );
  const callbackProof = buildHostedDeviceSyncCallbackProof({
    memberId: auth.member.id,
    provider: input.target.provider,
    sessionId: auth.sessionId,
    state: started.state,
  });

  return {
    authorizationUrl: started.authorizationUrl,
    callbackProofCookie: callbackProof.cookie,
  };
}
