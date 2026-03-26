import { NextResponse } from "next/server";

import {
  createJsonErrorResponse,
  mapDomainJsonError,
  mergeJsonHeaders,
  readJsonObject,
} from "../http";
import { isHostedOnboardingError } from "./errors";

const HOSTED_ONBOARDING_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export function jsonOk(
  payload: unknown,
  status = 200,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json(payload, {
    headers: mergeJsonHeaders(HOSTED_ONBOARDING_DEFAULT_HEADERS, headers),
    status,
  });
}

export function jsonError(error: unknown, headers?: HeadersInit): NextResponse {
  return createJsonErrorResponse(error, {
    defaultHeaders: HOSTED_ONBOARDING_DEFAULT_HEADERS,
    headers,
    internalMessage: "Hosted onboarding route failed unexpectedly.",
    logMessage: "Hosted onboarding route failed.",
    matchers: [mapHostedOnboardingError],
  });
}

export { readJsonObject };

function mapHostedOnboardingError(error: unknown) {
  return isHostedOnboardingError(error) ? mapDomainJsonError(error) : null;
}
