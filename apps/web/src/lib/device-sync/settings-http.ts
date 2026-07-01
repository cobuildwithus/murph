import {
  isDeviceSyncError,
  type DeviceSyncError,
} from "@murphai/device-syncd/errors";

import {
  createJsonRouteHelpers,
  mapDomainJsonError,
  type JsonErrorMapping,
} from "../http";
import {
  isHostedOnboardingError,
  type HostedOnboardingError,
} from "../hosted-onboarding/errors";

const HOSTED_DEVICE_SYNC_SETTINGS_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function mapSettingsDeviceSyncError(error: unknown): JsonErrorMapping | null {
  if (!isDeviceSyncError(error)) {
    return null;
  }

  return {
    ...mapDomainJsonError(error),
    log: describeHostedDeviceSyncDomainErrorLog("device-sync", error),
  };
}

function mapSettingsHostedOnboardingError(error: unknown): JsonErrorMapping | null {
  if (!isHostedOnboardingError(error)) {
    return null;
  }

  return {
    ...mapDomainJsonError(error),
    log: describeHostedDeviceSyncDomainErrorLog("hosted-onboarding", error),
  };
}

function describeHostedDeviceSyncDomainErrorLog(
  domain: "device-sync" | "hosted-onboarding",
  error: DeviceSyncError | HostedOnboardingError,
): NonNullable<JsonErrorMapping["log"]> {
  const causeDetails = describeHostedDeviceSyncDomainErrorCause(error.cause);

  return {
    details: {
      errorClass: causeDetails.errorObservabilityClass
        ?? classifyHostedDeviceSyncDomainError(error),
      errorDomain: domain,
      errorHttpStatus: error.httpStatus,
      errorRetryable: error.retryable,
      ...(isDeviceSyncError(error) && error.accountStatus
        ? { errorAccountStatus: error.accountStatus }
        : {}),
      ...(causeDetails.errorPhase ? { errorPhase: causeDetails.errorPhase } : {}),
    },
  };
}

function classifyHostedDeviceSyncDomainError(
  error: DeviceSyncError | HostedOnboardingError,
): string {
  if (error.httpStatus === 401 || error.httpStatus === 403) {
    return "authorization";
  }

  if (error.httpStatus === 400) {
    return "client_request";
  }

  if (error.httpStatus === 404) {
    return "not_found";
  }

  if (error.httpStatus === 409) {
    return "state_conflict";
  }

  if (error.httpStatus >= 500 && error.retryable) {
    return "backend_unavailable";
  }

  if (error.httpStatus >= 500) {
    return "backend_failure";
  }

  return "domain_error";
}

function describeHostedDeviceSyncDomainErrorCause(cause: unknown): {
  errorObservabilityClass?: string;
  errorPhase?: string;
} {
  return {
    ...readSafeCauseString(cause, "errorObservabilityClass"),
    ...readSafeCauseString(cause, "errorPhase"),
  };
}

function readSafeCauseString(
  cause: unknown,
  property: "errorObservabilityClass" | "errorPhase",
): Record<typeof property, string> | null {
  if (!cause || typeof cause !== "object") {
    return null;
  }

  const value = Reflect.get(cause, property);

  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]+$/u.test(value)) {
    return null;
  }

  return { [property]: value } as Record<typeof property, string>;
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
