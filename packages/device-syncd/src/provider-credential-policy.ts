import { resolveDeviceProviderConnectionDescriptor } from "@murphai/importers/device-providers/provider-descriptors";

import { resolveConfiguredDeviceSyncProviderManifest } from "./config/provider-manifests.ts";

import type {
  DeviceSyncProvider,
  DeviceSyncProviderCredentialPolicy,
} from "./types.ts";

export function resolveConfiguredDeviceSyncProviderCredentialPolicy(
  provider: string,
): DeviceSyncProviderCredentialPolicy | undefined {
  return resolveConfiguredDeviceSyncProviderManifest(provider)?.credentialPolicy;
}

export function resolveDeviceSyncProviderCredentialPolicy(
  provider: Pick<DeviceSyncProvider, "credentialPolicy" | "descriptor" | "provider">,
): DeviceSyncProviderCredentialPolicy {
  const configuredPolicy = resolveConfiguredDeviceSyncProviderCredentialPolicy(provider.provider);
  if (configuredPolicy) {
    return configuredPolicy;
  }

  if (provider.credentialPolicy) {
    return provider.credentialPolicy;
  }

  return resolveDeviceProviderConnectionDescriptor(provider.descriptor).kind === "oauth2"
    ? { kind: "oauth_tokens" }
    : { kind: "none" };
}
