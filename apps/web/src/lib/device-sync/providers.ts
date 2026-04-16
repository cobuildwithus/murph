import {
  createDeviceSyncRegistry,
  deviceSyncError,
} from "@murphai/device-syncd/public-ingress";
import { createConfiguredDeviceSyncProviders } from "@murphai/device-syncd/config";
import type { DeviceSyncProvider, DeviceSyncRegistry } from "@murphai/device-syncd/public-ingress";

export function createHostedDeviceSyncRegistry(
  env: NodeJS.ProcessEnv = process.env,
): DeviceSyncRegistry {
  return createDeviceSyncRegistry(
    createConfiguredDeviceSyncProviders(env),
  );
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
