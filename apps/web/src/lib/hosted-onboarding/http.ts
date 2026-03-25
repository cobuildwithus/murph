import { NextResponse } from "next/server";

import { isHostedOnboardingError } from "./errors";

export function jsonOk(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, { status });
}

export function jsonError(error: unknown): NextResponse {
  if (isHostedOnboardingError(error)) {
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

  console.error("Hosted onboarding route failed.", error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Hosted onboarding route failed unexpectedly.",
      },
    },
    { status: 500 },
  );
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const payload = (await request.json()) as unknown;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return payload as Record<string, unknown>;
}
