import { resolveConfiguredDeviceSyncProviderManifest } from "./config/provider-manifests.ts";

import type {
  DeviceSyncProvider,
  DeviceSyncProviderCredentialPolicy,
} from "./types.ts";
import type { ConfiguredDeviceSyncProviderKey } from "./config/provider-types.ts";

export const configuredDeviceSyncProviderCredentialPolicies = Object.freeze(
  Object.fromEntries(
    (["junction", "oura", "whoop", "strava"] satisfies ConfiguredDeviceSyncProviderKey[])
      .map((provider) => [
        provider,
        Object.freeze({ ...resolveConfiguredDeviceSyncProviderManifest(provider)!.credentialPolicy }),
      ]),
  ),
) as Readonly<Record<ConfiguredDeviceSyncProviderKey, DeviceSyncProviderCredentialPolicy>>;

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

  return provider.descriptor.oauth
    ? { kind: "oauth_tokens" }
    : { kind: "none" };
}
