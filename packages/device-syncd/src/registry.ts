import { normalizeString } from "./shared.ts";

import type { DeviceSyncProvider, DeviceSyncRegistry } from "./types.ts";

export function createDeviceSyncRegistry(providers: readonly DeviceSyncProvider[] = []): DeviceSyncRegistry {
  const registry = new Map<string, DeviceSyncProvider>();

  const api: DeviceSyncRegistry = {
    register(provider) {
      const key = normalizeString(provider.provider)?.toLowerCase();

      if (!key) {
        throw new TypeError("provider.provider must be a non-empty string");
      }

      if (registry.has(key)) {
        throw new TypeError(`device sync provider \"${key}\" is already registered`);
      }

      registry.set(key, provider);
    },
    get(provider) {
      const key = normalizeString(provider)?.toLowerCase();
      return key ? registry.get(key) : undefined;
    },
    list() {
      return [...registry.values()];
    },
  };

  for (const provider of providers) {
    api.register(provider);
  }

  return api;
}
