import {
  createDeviceSyncRegistry,
  createOuraDeviceSyncProvider,
  createWhoopDeviceSyncProvider,
  deviceSyncError,
} from "@murphai/device-syncd/public-ingress";
import type { DeviceSyncProvider, DeviceSyncRegistry } from "@murphai/device-syncd/public-ingress";
import type { HostedDeviceSyncEnvironment } from "./env";

export function createHostedDeviceSyncRegistry(env: HostedDeviceSyncEnvironment): DeviceSyncRegistry {
  const registry = createDeviceSyncRegistry();

  if (env.providers.whoop) {
    registry.register(createWhoopDeviceSyncProvider(env.providers.whoop));
  }

  if (env.providers.oura) {
    registry.register(createOuraDeviceSyncProvider(env.providers.oura));
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
