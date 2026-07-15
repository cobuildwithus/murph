import {
  createJsonRouteHelpers,
  mapDomainJsonError,
} from "../http";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { isClinicalRecordsControlPlaneError } from "./errors";

const helpers = createJsonRouteHelpers({
  defaultHeaders: {
    "Cache-Control": "no-store",
  },
  internalMessage: "Clinical Records request failed unexpectedly.",
  logMessage: "Clinical Records control-plane request failed.",
  matchers: [
    (error) => isClinicalRecordsControlPlaneError(error) ? mapDomainJsonError(error) : null,
    (error) => isHostedOnboardingError(error) ? mapDomainJsonError(error) : null,
  ],
});

export const clinicalJsonOk = helpers.jsonOk;
export const withClinicalJsonError = helpers.withJsonError;
