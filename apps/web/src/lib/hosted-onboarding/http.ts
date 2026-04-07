import {
  createJsonRouteHelpers,
  mapDomainJsonError,
  readOptionalJsonObject,
  readJsonObject,
} from "../http";
import { isHostedWebConfigurationError } from "../hosted-web/encryption";
import { isHostedOnboardingError } from "./errors";

const HOSTED_ONBOARDING_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export { readJsonObject, readOptionalJsonObject };

function mapHostedOnboardingError(error: unknown) {
  return isHostedOnboardingError(error) ? mapDomainJsonError(error) : null;
}

function mapHostedWebConfigurationError(error: unknown) {
  return isHostedWebConfigurationError(error) ? mapDomainJsonError(error) : null;
}

const hostedOnboardingJsonRouteHelpers = createJsonRouteHelpers({
  defaultHeaders: HOSTED_ONBOARDING_DEFAULT_HEADERS,
  internalMessage: "Hosted onboarding route failed unexpectedly.",
  logMessage: "Hosted onboarding route failed.",
  matchers: [mapHostedOnboardingError, mapHostedWebConfigurationError],
});

export const jsonOk = hostedOnboardingJsonRouteHelpers.jsonOk;
export const jsonError = hostedOnboardingJsonRouteHelpers.jsonError;
export const withJsonError = hostedOnboardingJsonRouteHelpers.withJsonError;
