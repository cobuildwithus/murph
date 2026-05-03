import "server-only";

import type { DeviceSyncConnectTarget } from "@murphai/device-syncd/config";

import { createHostedDeviceSyncControlPlane } from "./control-plane";
import { requireActiveHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { readOptionalJsonObject } from "../hosted-onboarding/http";
import {
  assertHostedLaunchRequiredConsentGranted,
} from "../legal/consent";
import { getPrisma } from "../prisma";

const HOSTED_CONNECT_START_BODY_LIMIT_BYTES = 4096;

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
  const body = await readOptionalJsonObject(input.request, {
    limitBytes: HOSTED_CONNECT_START_BODY_LIMIT_BYTES,
  });
  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : input.defaultReturnTo;
  const started = await controlPlane.startConnection(
    auth.member.id,
    input.target.provider,
    returnTo,
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
