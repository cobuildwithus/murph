import { normalizeOptionalString } from "../shared.js";

import type { DeviceProviderAdapter } from "./types.js";

export interface DeviceProviderRegistry {
  register<TSnapshot>(adapter: DeviceProviderAdapter<TSnapshot>): void;
  get(provider: string): DeviceProviderAdapter | undefined;
  list(): DeviceProviderAdapter[];
}

export function createDeviceProviderRegistry(
  adapters: readonly DeviceProviderAdapter[] = [],
): DeviceProviderRegistry {
  const providers = new Map<string, DeviceProviderAdapter>();

  const registry: DeviceProviderRegistry = {
    register<TSnapshot>(adapter: DeviceProviderAdapter<TSnapshot>) {
      const provider = normalizeOptionalString(adapter.provider, "provider")?.toLowerCase();

      if (!provider) {
        throw new TypeError("provider must be a non-empty string");
      }

      if (providers.has(provider)) {
        throw new TypeError(`device provider "${provider}" is already registered`);
      }

      providers.set(provider, adapter as DeviceProviderAdapter);
    },
    get(provider: string) {
      const normalized = normalizeOptionalString(provider, "provider")?.toLowerCase();
      return normalized ? providers.get(normalized) : undefined;
    },
    list() {
      return [...providers.values()];
    },
  };

  for (const adapter of adapters) {
    registry.register(adapter);
  }

  return registry;
}
