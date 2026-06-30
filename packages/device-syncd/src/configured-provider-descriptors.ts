import {
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  normalizeDeviceProviderKey,
  type DeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import type { ConfiguredDeviceSyncProviderKey } from "./config/provider-types.ts";

export const configuredDeviceSyncProviderDescriptors = Object.freeze({
  junction: JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  oura: OURA_DEVICE_PROVIDER_DESCRIPTOR,
  whoop: WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  strava: STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
} satisfies Record<ConfiguredDeviceSyncProviderKey, DeviceProviderDescriptor>);

export function getConfiguredDeviceSyncProviderDescriptor<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(provider: TProvider): (typeof configuredDeviceSyncProviderDescriptors)[TProvider] {
  return configuredDeviceSyncProviderDescriptors[provider];
}

export function resolveConfiguredDeviceSyncProviderDescriptor(
  provider: string,
): DeviceProviderDescriptor | undefined {
  const key = normalizeDeviceProviderKey(provider);

  return key && isConfiguredDeviceSyncProviderKey(key)
    ? configuredDeviceSyncProviderDescriptors[key]
    : undefined;
}

function isConfiguredDeviceSyncProviderKey(
  value: string,
): value is ConfiguredDeviceSyncProviderKey {
  return Object.prototype.hasOwnProperty.call(configuredDeviceSyncProviderDescriptors, value);
}
