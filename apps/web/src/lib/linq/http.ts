import { NextResponse } from "next/server";

import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";
import { isLinqWebhookPayloadError, isLinqWebhookVerificationError } from "@murphai/inboxd/linq-webhook";

import {
  createJsonRouteHelpers,
  mapDomainJsonError,
  readOptionalJsonObject,
  type JsonErrorMapping,
} from "../http";
import { isHostedLinqError } from "./errors";

const HOSTED_LINQ_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function mapHostedLinqError(error: unknown): JsonErrorMapping | null {
  return isHostedLinqError(error) ? mapDomainJsonError(error) : null;
}

function mapDeviceSyncError(error: unknown): JsonErrorMapping | null {
  return isDeviceSyncError(error) ? mapDomainJsonError(error) : null;
}

function mapLinqWebhookVerificationError(error: unknown): JsonErrorMapping | null {
  return isLinqWebhookVerificationError(error)
    ? {
        error: {
          code: "LINQ_WEBHOOK_SIGNATURE_INVALID",
          message: error.message,
        },
        status: 401,
      }
    : null;
}

function mapLinqWebhookPayloadError(error: unknown): JsonErrorMapping | null {
  return isLinqWebhookPayloadError(error)
    ? {
        error: {
          code: "LINQ_WEBHOOK_PAYLOAD_INVALID",
          message: error.message,
        },
        status: 400,
      }
    : null;
}

const linqJsonRouteHelpers = createJsonRouteHelpers({
  defaultHeaders: HOSTED_LINQ_DEFAULT_HEADERS,
  internalMessage: "Hosted Linq route failed unexpectedly.",
  logMessage: "Hosted Linq route failed.",
  matchers: [
    mapHostedLinqError,
    mapDeviceSyncError,
    mapLinqWebhookVerificationError,
    mapLinqWebhookPayloadError,
  ],
});

export function jsonOk(
  payload: unknown,
  status = 200,
  headers?: HeadersInit,
): NextResponse {
  return linqJsonRouteHelpers.jsonOk(payload, status, headers);
}

export { readOptionalJsonObject };
export const jsonError = linqJsonRouteHelpers.jsonError;
export const withJsonError = linqJsonRouteHelpers.withJsonError;
