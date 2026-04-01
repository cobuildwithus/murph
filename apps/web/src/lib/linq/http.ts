import { isDeviceSyncError } from "@murph/device-syncd";
import { isLinqWebhookPayloadError, isLinqWebhookVerificationError } from "@murph/inboxd/linq-webhook";
import { NextResponse } from "next/server";

import {
  createJsonErrorResponse,
  mapDomainJsonError,
  type JsonErrorMapping,
  withJsonErrorHandling,
} from "../http";
import { isHostedLinqError } from "./errors";

export function withJsonError<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return withJsonErrorHandling(handler, jsonError);
}

export function jsonError(error: unknown): NextResponse {
  return createJsonErrorResponse(error, {
    internalMessage: "Hosted Linq route failed unexpectedly.",
    logMessage: "Hosted Linq route failed.",
    matchers: [
      mapHostedLinqError,
      mapDeviceSyncError,
      mapLinqWebhookVerificationError,
      mapLinqWebhookPayloadError,
    ],
  });
}

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
