import { isDeviceSyncError } from "@healthybob/device-syncd";
import { isLinqWebhookPayloadError, isLinqWebhookVerificationError } from "@healthybob/inboxd";
import { NextResponse } from "next/server";

import { isHostedLinqError } from "./errors";

export function jsonError(error: unknown): NextResponse {
  if (isHostedLinqError(error)) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          details: error.details,
        },
      },
      { status: error.httpStatus },
    );
  }

  if (isDeviceSyncError(error)) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          details: error.details,
        },
      },
      { status: error.httpStatus },
    );
  }

  if (isLinqWebhookVerificationError(error)) {
    return NextResponse.json(
      {
        error: {
          code: "LINQ_WEBHOOK_SIGNATURE_INVALID",
          message: error.message,
        },
      },
      { status: 401 },
    );
  }

  if (isLinqWebhookPayloadError(error)) {
    return NextResponse.json(
      {
        error: {
          code: "LINQ_WEBHOOK_PAYLOAD_INVALID",
          message: error.message,
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: error.message,
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: error.message,
        },
      },
      { status: 400 },
    );
  }

  console.error("Hosted Linq route failed.", error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Hosted Linq route failed unexpectedly.",
      },
    },
    { status: 500 },
  );
}
