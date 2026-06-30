import type {
  DeviceSyncProvider,
  DeviceSyncProviderCredentialPolicy,
} from "./types.ts";
import type { ConfiguredDeviceSyncProviderKey } from "./config/provider-types.ts";

export const configuredDeviceSyncProviderCredentialPolicies = Object.freeze({
  junction: Object.freeze({
    kind: "provider_config",
    providerConfigKey: "junction",
  }),
  oura: Object.freeze({
    kind: "oauth_tokens",
  }),
  whoop: Object.freeze({
    kind: "oauth_tokens",
  }),
  strava: Object.freeze({
    kind: "oauth_tokens",
  }),
} satisfies Record<ConfiguredDeviceSyncProviderKey, DeviceSyncProviderCredentialPolicy>);

export function resolveConfiguredDeviceSyncProviderCredentialPolicy(
  provider: string,
): DeviceSyncProviderCredentialPolicy | undefined {
  const key = normalizeConfiguredDeviceSyncProviderKey(provider);

  return key ? configuredDeviceSyncProviderCredentialPolicies[key] : undefined;
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

function normalizeConfiguredDeviceSyncProviderKey(
  provider: string,
): ConfiguredDeviceSyncProviderKey | null {
  const key = typeof provider === "string" ? provider.trim().toLowerCase() : "";

  if (
    key === "junction"
    || key === "oura"
    || key === "whoop"
    || key === "strava"
  ) {
    return key;
  }

  return null;
}
