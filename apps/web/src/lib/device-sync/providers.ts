import {
  createDeviceSyncRegistry,
  createOuraDeviceSyncProvider,
  createWhoopDeviceSyncProvider,
  deviceSyncError,
} from "#device-syncd";

import type { DeviceSyncProvider, DeviceSyncRegistry } from "#device-syncd";
import type { HostedDeviceSyncEnvironment } from "./env";

export function createHostedDeviceSyncRegistry(env: HostedDeviceSyncEnvironment): DeviceSyncRegistry {
  const registry = createDeviceSyncRegistry();

  if (env.providers.whoop) {
    registry.register(
      createWhoopDeviceSyncProvider({
        clientId: env.providers.whoop.clientId,
        clientSecret: env.providers.whoop.clientSecret,
      }),
    );
  }

  if (env.providers.oura) {
    registry.register(
      createOuraDeviceSyncProvider({
        clientId: env.providers.oura.clientId,
        clientSecret: env.providers.oura.clientSecret,
      }),
    );
  }

  return registry;
}

export function requireHostedDeviceSyncProvider(registry: DeviceSyncRegistry, provider: string): DeviceSyncProvider {
  const resolved = registry.get(provider);

  if (!resolved) {
    throw deviceSyncError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: `Hosted device-sync provider ${provider} is not configured in apps/web.`,
      retryable: false,
      httpStatus: 404,
    });
  }

  return resolved;
}
