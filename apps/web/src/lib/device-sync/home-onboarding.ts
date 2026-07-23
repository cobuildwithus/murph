import "server-only";

import {
  listConfiguredDeviceSyncProviderNames,
  readConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/provider-configs";

import type { HostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

export async function shouldShowHomeDeviceSyncStep(input: {
  member: HostedMemberCoreState | null;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  if (!input.member) {
    return true;
  }

  const prisma = input.prisma ?? getPrisma();
  await assertActiveHostedMemberAccessAllowed({
    memberId: input.member.id,
    prisma,
  });
  const configuredProviders = new Set<string>(
    listConfiguredDeviceSyncProviderNames(
      readConfiguredDeviceSyncProviderConfigs(process.env),
    ),
  );
  const connections = await prisma.deviceConnection.findMany({
    select: {
      provider: true,
      setupExpiresAt: true,
      setupPhase: true,
      status: true,
    },
    where: {
      userId: input.member.id,
    },
  });
  const now = new Date();

  return !connections.some((connection) => {
    if (!configuredProviders.has(connection.provider.trim().toLowerCase())) {
      return false;
    }

    if (connection.status === "disconnected" || connection.setupPhase === "failed") {
      return false;
    }

    if (connection.setupPhase === "pending_link" || connection.setupPhase === "link_returned") {
      return connection.setupExpiresAt !== null && connection.setupExpiresAt > now;
    }

    return true;
  });
}
