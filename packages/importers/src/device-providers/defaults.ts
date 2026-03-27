import { garminProviderAdapter } from "./garmin.ts";
import { ouraProviderAdapter } from "./oura.ts";
import { whoopProviderAdapter } from "./whoop.ts";

import type { DeviceProviderAdapter } from "./types.ts";

export const defaultDeviceProviderAdapters: readonly DeviceProviderAdapter[] = Object.freeze([
  whoopProviderAdapter,
  ouraProviderAdapter,
  garminProviderAdapter,
]);
