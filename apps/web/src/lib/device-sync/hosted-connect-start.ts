import "server-only";

import {
  isDeviceConnectSourceAvailableForConnection,
  type DeviceSyncConnectTarget,
} from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { createHostedDeviceSyncPublicIngressService } from "./public-ingress-service";
import { assertHostedWhoopConnectCapacityAvailable } from "./whoop-connect-capacity";
import { requireActiveHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import {
  assertHostedLaunchRequiredConsentGranted,
} from "../legal/consent";
import { getPrisma } from "../prisma";

export interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
}

export async function startHostedDeviceSyncConnection(input: {
  defaultReturnTo: string;
  request: Request;
  target: DeviceSyncConnectTarget;
}): Promise<HostedDeviceSyncConnectResponse> {
  if (!isDeviceConnectSourceAvailableForConnection(input.target.connectSourceId)) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED",
      httpStatus: 404,
      message: "Hosted device connect source is not configured.",
      retryable: false,
    });
  }

  assertHostedOnboardingMutationOrigin(input.request);
  const prisma = getPrisma();
  const auth = await requireActiveHostedAppSessionFromRequest(input.request);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  await assertHostedWhoopConnectCapacityAvailable({
    memberId: auth.member.id,
    prisma,
    target: input.target,
  });
  const publicIngress = createHostedDeviceSyncPublicIngressService(input.request);
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

  return {
    authorizationUrl: started.authorizationUrl,
  };
}
