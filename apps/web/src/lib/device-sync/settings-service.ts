import "server-only";

import type { HostedMember } from "@prisma/client";
import {
  listConfiguredDeviceSyncReconnectTargets,
  readConfiguredDeviceSyncConnectTargetConfigs,
} from "@murphai/device-syncd/connect-config";

import {
  type HostedDeviceSyncSettingsConnectTarget,
  type HostedDeviceSyncSettingsResponse,
} from "./settings-surface";
import { readHostedDeviceSyncEnvironment } from "./env";
import { resolveConfiguredHostedDeviceSyncPublicBaseUrl } from "./public-base-url";
import { buildHostedDeviceSyncSettingsSurfaceResponse } from "./sidebar-status-service";
import {
  assertHostedMemberEffectiveActiveAccessAllowed,
} from "../hosted-onboarding/family-plan";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";

export async function buildHostedDeviceSyncSettingsResponse(input: {
  member: Pick<HostedMember, "billingStatus" | "id" | "suspendedAt">;
  prisma?: HostedOnboardingReadClient;
  publicBaseUrl?: string | null;
}): Promise<HostedDeviceSyncSettingsResponse> {
  await assertHostedMemberEffectiveActiveAccessAllowed({
    member: input.member,
    prisma: input.prisma,
  });
  const env = readHostedDeviceSyncEnvironment(process.env);

  return buildHostedDeviceSyncSettingsSurfaceResponse({
    connectTargets: listConfiguredDeviceSyncReconnectTargets(
      readConfiguredDeviceSyncConnectTargetConfigs(process.env),
    ).map((target): HostedDeviceSyncSettingsConnectTarget => ({
      connectSourceId: target.connectSourceId,
      connectTarget: target.connectTarget,
      provider: target.provider,
      sourceProviderSlug: target.sourceProviderSlug ?? null,
    })),
    memberId: input.member.id,
    publicBaseUrl:
      input.publicBaseUrl ?? resolveConfiguredHostedDeviceSyncPublicBaseUrl(env),
  });
}
