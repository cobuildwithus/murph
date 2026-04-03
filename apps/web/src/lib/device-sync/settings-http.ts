import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";

import {
  createJsonRouteHelpers,
  mapDomainJsonError,
} from "../http";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";

const HOSTED_DEVICE_SYNC_SETTINGS_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function mapSettingsDeviceSyncError(error: unknown) {
  return isDeviceSyncError(error) ? mapDomainJsonError(error) : null;
}

function mapSettingsHostedOnboardingError(error: unknown) {
  return isHostedOnboardingError(error) ? mapDomainJsonError(error) : null;
}

const hostedDeviceSyncSettingsJsonRouteHelpers = createJsonRouteHelpers({
  defaultHeaders: HOSTED_DEVICE_SYNC_SETTINGS_DEFAULT_HEADERS,
  internalMessage: "Hosted device-sync settings route failed unexpectedly.",
  logMessage: "Hosted device-sync settings route failed.",
  matchers: [mapSettingsHostedOnboardingError, mapSettingsDeviceSyncError],
});

export const jsonOk = hostedDeviceSyncSettingsJsonRouteHelpers.jsonOk;
export const jsonError = hostedDeviceSyncSettingsJsonRouteHelpers.jsonError;
export const withJsonError = hostedDeviceSyncSettingsJsonRouteHelpers.withJsonError;
