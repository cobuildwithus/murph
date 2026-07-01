import { deviceSyncError } from "@murphai/device-syncd/errors";
import { createConfiguredDeviceSyncRegistry } from "@murphai/device-syncd/config";
import type { DeviceSyncProvider, DeviceSyncRegistry } from "@murphai/device-syncd/types";

export function createHostedDeviceSyncRegistry(
  env: NodeJS.ProcessEnv = process.env,
): DeviceSyncRegistry {
  return createConfiguredDeviceSyncRegistry(env);
}

export function requireHostedDeviceSyncProvider(registry: DeviceSyncRegistry, provider: string): DeviceSyncProvider {
  const resolved = registry.get(provider);

  if (!resolved) {
    throw deviceSyncError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: `Hosted device-sync provider ${provider} is not configured in the shared device-sync provider registry.`,
      retryable: false,
      httpStatus: 404,
    });
  }

  return resolved;
}
