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
  const hasGenericConnection = Boolean(
    provider.connectionHandler
      ?? (provider.beginConnection && provider.completeConnection),
  );
  const hasOAuthCompatibilityConnection = Boolean(
    provider.buildConnectUrl && provider.exchangeAuthorizationCode,
  );

  if (connection.kind === "oauth2" && !hasGenericConnection && !hasOAuthCompatibilityConnection) {
    throw new TypeError(
      `Device sync provider ${provider.provider} declares oauth2 connection support but does not expose connectionHandler, beginConnection/completeConnection, or OAuth compatibility methods.`,
    );
  }

  if (connection.kind === "external_link" && !hasGenericConnection) {
    throw new TypeError(
      `Device sync provider ${provider.provider} declares external_link connection support but does not expose connectionHandler or beginConnection/completeConnection.`,
    );
  }

  const credentialPolicy = provider.credentialPolicy
    ?? (provider.descriptor.oauth ? { kind: "oauth_tokens" as const } : { kind: "none" as const });
  const explicitlyNonRefreshable = provider.descriptor.sync?.supportsTokenRefresh === false;
  const hasTokenRefresh = Boolean(provider.connectionHandler?.refreshTokens ?? provider.refreshTokens);

  if (credentialPolicy.kind === "oauth_tokens" && !explicitlyNonRefreshable && !hasTokenRefresh) {
    throw new TypeError(
      `Device sync provider ${provider.provider} declares oauth_tokens credentials but does not expose token refresh support.`,
    );
  }
}
