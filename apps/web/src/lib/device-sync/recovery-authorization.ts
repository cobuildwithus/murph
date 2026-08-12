import "server-only";

import {
  isDeviceConnectSourceAvailableForExistingConnectionRecovery,
  type DeviceSyncConnectTarget,
} from "@murphai/device-syncd/connect-config";
import {
  DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  isDeviceSyncConnectionSetupConfirmed,
} from "@murphai/device-syncd/public-account";

import { HOSTED_DEVICE_CONNECTION_SOURCE_RECONNECT_ERROR_CODES } from "./browser-connection-source";
import { getPrisma } from "../prisma";

export async function isHostedDeviceSyncExistingConnectionRecoveryAuthorized(input: {
  memberId: string;
  target: DeviceSyncConnectTarget;
}): Promise<boolean> {
  if (
    !isDeviceConnectSourceAvailableForExistingConnectionRecovery(
      input.target.connectSourceId,
    )
  ) {
    return false;
  }

  const sourceProviderSlug = input.target.sourceProviderSlug?.trim() ?? "";
  if (!sourceProviderSlug) {
    return false;
  }

  const prisma = getPrisma();
  const connection = await prisma.deviceConnection.findFirst({
    where: {
      provider: input.target.provider,
      setupPhase: "source_confirmed",
      userId: input.memberId,
      sources: {
        some: {
          sourceProviderSlug,
          status: { not: "disconnected" },
        },
      },
      OR: [
        {
          status: "reauthorization_required",
          OR: [
            { lastErrorCode: null },
            {
              lastErrorCode: {
                not: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
              },
            },
          ],
        },
        {
          status: "active",
          sources: {
            some: {
              lastErrorCode: {
                in: [...HOSTED_DEVICE_CONNECTION_SOURCE_RECONNECT_ERROR_CODES],
              },
              sourceProviderSlug,
              status: "error",
            },
          },
        },
        {
          status: "active",
          lastSyncErrorAt: { not: null },
          OR: [
            { lastSyncCompletedAt: null },
            {
              lastSyncErrorAt: {
                gt: prisma.deviceConnection.fields.lastSyncCompletedAt,
              },
            },
          ],
        },
      ],
    },
    select: {
      id: true,
    },
  });

  return connection !== null;
}
