import "server-only";

import type { DeviceSyncConnectTarget } from "@murphai/device-syncd/connect-config";

import { createHostedDeviceSyncPublicIngressService } from "./public-ingress-service";
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
  assertHostedOnboardingMutationOrigin(input.request);
  const prisma = getPrisma();
  const auth = await requireActiveHostedAppSessionFromRequest(input.request);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
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
