import type {
  DeviceConnectionHandler,
  DeviceSyncRegistry,
} from "@murphai/device-syncd/types";

import type { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import {
  isRepairableDeviceProviderApplicationStateError,
  resolveDeviceProviderApplicationForConnection,
} from "./provider-applications";
import { createHostedDeviceSyncRegistryWithProviderConfigs } from "./providers";

const PROVIDER_APPLICATION_REPAIR_WARNING = {
  code: "DEVICE_PROVIDER_APPLICATION_REPAIR_REQUIRED",
  message: "Provider access could not be revoked because the private provider application must be repaired.",
} as const;

export interface HostedDeviceSyncConnectionCleanup {
  repairRequired: boolean;
  registry: DeviceSyncRegistry | null;
  revokeAccessOverride?: NonNullable<DeviceConnectionHandler["revokeAccess"]> | null;
  warning: { code: string; message: string } | null;
}

export async function resolveHostedDeviceSyncConnectionCleanup(input: {
  connectionId: string;
  memberId: string;
  prisma: PrismaDeviceSyncControlPlaneStore["prisma"];
  provider: string;
  resolveSharedRegistry: () => DeviceSyncRegistry;
}): Promise<HostedDeviceSyncConnectionCleanup> {
  try {
    const application = await resolveDeviceProviderApplicationForConnection({
      connectionId: input.connectionId,
      memberId: input.memberId,
      prisma: input.prisma,
    });
    const registry = application
      ? createHostedDeviceSyncRegistryWithProviderConfigs({
          providerConfigs: application.providerConfigs,
        })
      : input.resolveSharedRegistry();

    return {
      repairRequired: false,
      registry,
      warning: null,
    };
  } catch (error) {
    if (!isRepairableDeviceProviderApplicationStateError(error)) {
      throw error;
    }

    return {
      repairRequired: true,
      registry: null,
      revokeAccessOverride: null,
      warning: PROVIDER_APPLICATION_REPAIR_WARNING,
    };
  }
}
