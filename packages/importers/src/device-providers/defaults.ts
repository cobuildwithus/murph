import { garminProviderAdapter } from "./garmin.js";
import { ouraProviderAdapter } from "./oura.js";
import { whoopProviderAdapter } from "./whoop.js";

import type { DeviceProviderAdapter } from "./types.js";

export const defaultDeviceProviderAdapters: readonly DeviceProviderAdapter[] = Object.freeze([
  whoopProviderAdapter,
  ouraProviderAdapter,
  garminProviderAdapter,
]);
