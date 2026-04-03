import { garminProviderAdapter } from "./garmin.ts";
import { ouraProviderAdapter } from "./oura.ts";
import {
  defaultDeviceProviderDescriptors,
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
} from "./provider-descriptors.ts";
import { whoopProviderAdapter } from "./whoop.ts";

import type { DeviceProviderAdapter } from "./types.ts";

export {
  defaultDeviceProviderDescriptors,
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
};

export const defaultDeviceProviderAdapters: readonly DeviceProviderAdapter[] = Object.freeze([
  whoopProviderAdapter,
  ouraProviderAdapter,
  garminProviderAdapter,
]);
