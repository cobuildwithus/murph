import {
  createNamedDeviceProviderRegistry,
  resolveDeviceProviderConnectionDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import type { DeviceSyncProvider, DeviceSyncRegistry } from "./types.ts";

export function createDeviceSyncRegistry(providers: readonly DeviceSyncProvider[] = []): DeviceSyncRegistry {
  const registry = createNamedDeviceProviderRegistry<DeviceSyncProvider>(
    "device sync provider",
  );

  const api: DeviceSyncRegistry = {
    register(provider) {
      assertDeviceSyncProviderCapabilities(provider);
      registry.register(provider);
    },
    get(provider) {
      return registry.get(provider);
    },
    list() {
      return registry.list();
    },
  };

  for (const provider of providers) {
    api.register(provider);
  }

  return api;
}

export function assertDeviceSyncProviderCapabilities(provider: DeviceSyncProvider): void {
  const connection = resolveDeviceProviderConnectionDescriptor(provider.descriptor);
  const hasConnectionHandler = Boolean(provider.connectionHandler);

  if (connection.kind === "oauth2" && !hasConnectionHandler) {
    throw new TypeError(
      `Device sync provider ${provider.provider} declares oauth2 connection support but does not expose connectionHandler.`,
    );
  }

  if (connection.kind === "external_link" && !hasConnectionHandler) {
    throw new TypeError(
      `Device sync provider ${provider.provider} declares external_link connection support but does not expose connectionHandler.`,
    );
  }

  const credentialPolicy = provider.credentialPolicy
    ?? (provider.descriptor.oauth || connection.kind === "oauth2"
      ? { kind: "oauth_tokens" as const }
      : { kind: "none" as const });
  const explicitlyNonRefreshable = provider.descriptor.sync?.supportsTokenRefresh === false;
  const hasTokenRefresh = Boolean(provider.connectionHandler?.refreshTokens);

  if (credentialPolicy.kind === "oauth_tokens" && !explicitlyNonRefreshable && !hasTokenRefresh) {
    throw new TypeError(
      `Device sync provider ${provider.provider} declares oauth_tokens credentials but does not expose token refresh support.`,
    );
  }
}
