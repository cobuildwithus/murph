import "server-only";

import {
  isDeviceConnectSourceAvailableForConnection,
  listConfiguredDeviceSyncConnectTargets,
  normalizeDeviceConnectSourceId,
  readConfiguredDeviceSyncConnectTargetConfigs,
  resolveConfiguredDeviceSyncConnectTargetBySourceId,
  type DeviceSyncConnectTarget,
} from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import type {
  BeginConnectionResult,
  DeviceSyncAppConnectReturn,
} from "@murphai/device-syncd/types";

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
  assertHostedDeviceConnectSourceOffered(input.target);
  assertHostedOnboardingMutationOrigin(input.request);
  const browserOrigin = input.request.headers.get("origin")?.trim();
  const auth = await requireActiveHostedAppSessionFromRequest(input.request);
  assertHostedDeviceSyncBrowserCallbackHostname({
    appSessionUrl: browserOrigin || input.request.url,
    callbackBaseUrl: readHostedDeviceSyncPublicBaseUrl(),
  });
  const started = await beginHostedDeviceSyncConnectionForMember({
    memberId: auth.member.id,
    request: input.request,
    returnTo: input.defaultReturnTo,
    target: input.target,
  });
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

export function assertHostedDeviceConnectSourceOffered(target: DeviceSyncConnectTarget): void {
  if (!isDeviceConnectSourceAvailableForConnection(target.connectSourceId)) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED",
      httpStatus: 404,
      message: "Hosted device connect source is not configured.",
      retryable: false,
    });
  }
}

/**
 * The part of a connection start the website and the Murph app share, for a
 * member the caller has already authenticated: the health-data grant, the
 * WHOOP cap, then the provider start. `appReturn` names the app's return
 * bridge; without it the provider returns to the website callback.
 */
export async function beginHostedDeviceSyncConnectionForMember(input: {
  appReturn?: DeviceSyncAppConnectReturn;
  memberId: string;
  request: Request;
  returnTo: string | null;
  target: DeviceSyncConnectTarget;
}): Promise<BeginConnectionResult> {
  const prisma = getPrisma();
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: input.memberId,
    prisma,
  });
  await assertHostedWhoopConnectCapacityAvailable({
    memberId: input.memberId,
    prisma,
    target: input.target,
  });
  const publicIngress = createHostedDeviceSyncPublicIngressService(input.request);
  await publicIngress.prepareConnectionStart(input.memberId, input.target);
  return publicIngress.startConnection(
    input.memberId,
    input.target.provider,
    input.returnTo,
    {
      ...(input.appReturn ? { appReturn: input.appReturn } : {}),
      connectSourceId: input.target.connectSourceId,
      connectTarget: input.target.connectTarget,
      sourceProviderSlug: input.target.sourceProviderSlug ?? null,
    },
  );
}

export type HostedConnectSourceTargetSelector = {
  connectTarget: string | null;
  provider: string | null;
  sourceProviderSlug: string | null;
};

export function resolveHostedConnectSourceTarget(
  sourceId: string,
  selector: HostedConnectSourceTargetSelector | null,
) {
  const configs = readHostedConnectSourceTargetConfigs();
  const target = selector && isSpecificHostedConnectSourceTargetSelector(selector)
    ? resolveSelectedHostedConnectSourceTarget(
        listConfiguredDeviceSyncConnectTargets(configs),
        sourceId,
        selector,
      )
    : resolvePreferredHostedConnectSourceTarget(configs, sourceId, selector);

  if (!target) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED",
      httpStatus: 404,
      message: "Hosted device connect source is not configured.",
      retryable: false,
    });
  }

  return target;
}

function isSpecificHostedConnectSourceTargetSelector(
  selector: HostedConnectSourceTargetSelector,
): boolean {
  return Boolean(selector.provider || selector.sourceProviderSlug);
}

function resolveSelectedHostedConnectSourceTarget(
  targets: readonly DeviceSyncConnectTarget[],
  sourceId: string,
  selector: HostedConnectSourceTargetSelector,
): DeviceSyncConnectTarget | null {
  const requestedSourceId = normalizeDeviceConnectSourceId(sourceId);
  if (!requestedSourceId) {
    return null;
  }

  return targets.find((target) =>
    target.connectSourceId === requestedSourceId
    && (!selector.provider || selector.provider === target.provider)
    && (!selector.connectTarget || selector.connectTarget === target.connectTarget)
    && (
      !selector.sourceProviderSlug
      || selector.sourceProviderSlug === (target.sourceProviderSlug ?? null)
    )
  ) ?? null;
}

function resolvePreferredHostedConnectSourceTarget(
  configs: Parameters<typeof resolveConfiguredDeviceSyncConnectTargetBySourceId>[0],
  sourceId: string,
  selector: HostedConnectSourceTargetSelector | null,
): DeviceSyncConnectTarget | null {
  const target = resolveConfiguredDeviceSyncConnectTargetBySourceId(
    configs,
    sourceId,
  );

  if (!target || (selector?.connectTarget && selector.connectTarget !== target.connectTarget)) {
    return null;
  }

  return target;
}

function readHostedConnectSourceTargetConfigs() {
  try {
    return readConfiguredDeviceSyncConnectTargetConfigs(process.env);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw deviceSyncError({
        cause: {
          errorObservabilityClass: "configuration",
          errorPhase: "connect_target_config",
        },
        code: "HOSTED_DEVICE_CONNECT_SOURCE_CONFIGURATION_UNAVAILABLE",
        httpStatus: 503,
        message: "Hosted device connect source configuration is temporarily unavailable.",
        retryable: true,
      });
    }

    throw error;
  }
}
