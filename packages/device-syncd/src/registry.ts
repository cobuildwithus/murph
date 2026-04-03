import { createNamedDeviceProviderRegistry } from "@murphai/importers/device-providers/provider-descriptors";

import type { DeviceSyncProvider, DeviceSyncRegistry } from "./types.ts";

export function createDeviceSyncRegistry(providers: readonly DeviceSyncProvider[] = []): DeviceSyncRegistry {
  return createNamedDeviceProviderRegistry<DeviceSyncProvider>(
    "device sync provider",
    providers,
  ) as DeviceSyncRegistry;
}
