import { createNamedDeviceProviderRegistry, type NamedDeviceProviderRegistry } from "./provider-descriptors.ts";

import type { DeviceProviderAdapter } from "./types.ts";

export interface DeviceProviderRegistry extends NamedDeviceProviderRegistry<DeviceProviderAdapter> {
  register<TSnapshot>(adapter: DeviceProviderAdapter<TSnapshot>): void;
  get(provider: string): DeviceProviderAdapter | undefined;
  list(): DeviceProviderAdapter[];
}

export function createDeviceProviderRegistry(
  adapters: readonly DeviceProviderAdapter[] = [],
): DeviceProviderRegistry {
  return createNamedDeviceProviderRegistry<DeviceProviderAdapter>(
    "device provider",
    adapters,
  ) as DeviceProviderRegistry;
}
