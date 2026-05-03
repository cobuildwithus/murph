import "server-only";

import type { HostedMember } from "@prisma/client";

import { createHostedDeviceSyncControlPlane } from "./control-plane";
import {
  buildHostedDeviceSyncSettingsSources,
  type HostedDeviceSyncSettingsResponse,
} from "./settings-surface";
import {
  readHostedDeviceSyncPublicBaseUrl,
  readHostedPublicBaseUrl,
} from "../hosted-web/public-url";
import { assertHostedMemberActiveAccessAllowed } from "../hosted-onboarding/entitlement";
import { getPrisma } from "../prisma";

export async function buildHostedDeviceSyncSettingsResponse(input: {
  member: Pick<HostedMember, "billingStatus" | "id" | "suspendedAt">;
}): Promise<HostedDeviceSyncSettingsResponse> {
  assertHostedMemberActiveAccessAllowed({
    billingStatus: input.member.billingStatus,
    suspendedAt: input.member.suspendedAt,
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
      providers,
    }),
  };
}

export async function hasActiveHostedDeviceSyncConnectionForMember(input: {
  member: Pick<HostedMember, "billingStatus" | "id" | "suspendedAt">;
}): Promise<boolean> {
  assertHostedMemberActiveAccessAllowed({
    billingStatus: input.member.billingStatus,
    suspendedAt: input.member.suspendedAt,
  });

  const activeConnectionCount = await getPrisma().deviceConnection.count({
    where: {
      userId: input.member.id,
      status: "active",
      OR: [
        {
          setupPhase: null,
        },
        {
          setupPhase: "source_confirmed",
        },
      ],
    },
  });

  return activeConnectionCount > 0;
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
