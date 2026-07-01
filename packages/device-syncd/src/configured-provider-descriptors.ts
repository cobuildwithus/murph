import {
  configuredDeviceSyncProviderKeys,
  getConfiguredDeviceSyncProviderDescriptor,
  resolveConfiguredDeviceSyncProviderDescriptor,
} from "./config/provider-manifests.ts";

import type { DeviceProviderDescriptor } from "@murphai/importers/device-providers/provider-descriptors";
import type { ConfiguredDeviceSyncProviderKey } from "./config/provider-types.ts";

export const configuredDeviceSyncProviderDescriptors = Object.freeze(
  Object.fromEntries(
    configuredDeviceSyncProviderKeys.map((provider) => [
      provider,
      getConfiguredDeviceSyncProviderDescriptor(provider),
    ]),
  ),
) as Readonly<Record<ConfiguredDeviceSyncProviderKey, DeviceProviderDescriptor>>;

export {
  getConfiguredDeviceSyncProviderDescriptor,
  resolveConfiguredDeviceSyncProviderDescriptor,
};
