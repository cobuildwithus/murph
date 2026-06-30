import "server-only";

import type { HostedMember } from "@prisma/client";
import {
  listConfiguredDeviceSyncReconnectTargets,
  readConfiguredDeviceSyncConnectTargetConfigs,
} from "@murphai/device-syncd/connect-config";

import { createHostedDeviceSyncControlPlane } from "./control-plane";
import {
  buildHostedDeviceSyncSettingsSources,
  type HostedDeviceSyncSettingsConnectTarget,
  type HostedDeviceSyncSettingsResponse,
} from "./settings-surface";
import {
  readHostedDeviceSyncPublicBaseUrl,
  readHostedPublicBaseUrl,
} from "../hosted-web/public-url";
import {
  assertHostedMemberEffectiveActiveAccessAllowed,
} from "../hosted-onboarding/family-plan";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";

export async function buildHostedDeviceSyncSettingsResponse(input: {
  member: Pick<HostedMember, "billingStatus" | "id" | "suspendedAt">;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedDeviceSyncSettingsResponse> {
  await assertHostedMemberEffectiveActiveAccessAllowed({
    member: input.member,
    prisma: input.prisma,
  });
  const controlPlane = createHostedDeviceSyncControlPlane(
    new Request(buildHostedDeviceSyncSyntheticRequestUrl()),
  );
  const { connectionSources, connections, providers } = await controlPlane.listConnections(input.member.id);

  return {
    generatedAt: new Date().toISOString(),
    ok: true,
    sources: buildHostedDeviceSyncSettingsSources({
      connectionSources,
      connections,
      connectTargets: listConfiguredDeviceSyncReconnectTargets(
        readConfiguredDeviceSyncConnectTargetConfigs(process.env),
      ).map((target): HostedDeviceSyncSettingsConnectTarget => ({
        connectSourceId: target.connectSourceId,
        connectTarget: target.connectTarget,
        provider: target.provider,
        sourceProviderSlug: target.sourceProviderSlug ?? null,
      })),
      providers,
    }),
  };
}

function buildHostedDeviceSyncSyntheticRequestUrl(): string {
  const deviceSyncBaseUrl = readHostedDeviceSyncPublicBaseUrl();
  if (deviceSyncBaseUrl) {
    return `${deviceSyncBaseUrl.replace(/\/+$/u, "")}/settings/device-sync`;
  }

  const hostedPublicBaseUrl = readHostedPublicBaseUrl();
  if (hostedPublicBaseUrl) {
    return `${hostedPublicBaseUrl.replace(/\/+$/u, "")}/settings`;
  }

  return "http://localhost/settings";
}
