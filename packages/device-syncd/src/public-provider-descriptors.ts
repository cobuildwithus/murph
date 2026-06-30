import {
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  resolveDeviceProviderConnectionDescriptor,
  type DeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { resolveConfiguredDeviceSyncProviderCredentialPolicy } from "./provider-credential-policy.ts";
import {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./config/provider-keys.ts";

import type {
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
} from "./config/provider-types.ts";
import type { PublicProviderDescriptor } from "./types.ts";

const CONFIGURED_DEVICE_SYNC_PROVIDER_DESCRIPTORS = Object.freeze({
  junction: JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  oura: OURA_DEVICE_PROVIDER_DESCRIPTOR,
  whoop: WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  strava: STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
} satisfies Record<ConfiguredDeviceSyncProviderKey, DeviceProviderDescriptor>);

export interface DeviceSyncPublicProviderDescriptorOptions {
  publicBaseUrl?: string | null;
}

export function listConfiguredDeviceSyncPublicProviderDescriptors(
  configs: ConfiguredDeviceSyncProviderPresence,
  options: DeviceSyncPublicProviderDescriptorOptions = {},
): PublicProviderDescriptor[] {
  return listConfiguredDeviceSyncProviderNames(configs).map((provider) =>
    describeConfiguredDeviceSyncPublicProvider(provider, options)
  );
}

export function describeConfiguredDeviceSyncPublicProvider(
  provider: ConfiguredDeviceSyncProviderKey,
  options: DeviceSyncPublicProviderDescriptorOptions = {},
): PublicProviderDescriptor {
  const descriptor = CONFIGURED_DEVICE_SYNC_PROVIDER_DESCRIPTORS[provider];
  const connection = resolveDeviceProviderConnectionDescriptor(descriptor);
  const callbackPath = connection.callbackPath ?? null;
  const webhookPath = descriptor.webhook?.path ?? null;

  return {
    provider,
    callbackPath,
    callbackUrl: joinPublicUrl(options.publicBaseUrl, callbackPath),
    connectionKind: connection.kind,
    credentialPolicy:
      resolveConfiguredDeviceSyncProviderCredentialPolicy(provider)?.kind ?? "none",
    defaultScopes: [...(connection.defaultScopes ?? [])],
    supportsWebhooks: Boolean(webhookPath),
    webhookPath,
    webhookUrl: joinPublicUrl(options.publicBaseUrl, webhookPath),
  };
}

export function resolveConfiguredDeviceSyncProviderDescriptor(
  provider: string,
): DeviceProviderDescriptor | undefined {
  const normalized = provider.trim().toLowerCase();
  return configuredDeviceSyncProviderKeys.find((key) => key === normalized)
    ? CONFIGURED_DEVICE_SYNC_PROVIDER_DESCRIPTORS[normalized as ConfiguredDeviceSyncProviderKey]
    : undefined;
}

function joinPublicUrl(
  publicBaseUrl: string | null | undefined,
  path: string | null,
): string | null {
  if (!publicBaseUrl || !path) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/+$/u, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
