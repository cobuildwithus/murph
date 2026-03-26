import { NextResponse } from "next/server";

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
    headers: mergeHostedOnboardingHeaders(headers),
    status,
  });
}

export function jsonError(error: unknown, headers?: HeadersInit): NextResponse {
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
      {
        headers: mergeHostedOnboardingHeaders(headers),
        status: error.httpStatus,
      },
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
      {
        headers: mergeHostedOnboardingHeaders(headers),
        status: 400,
      },
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
      {
        headers: mergeHostedOnboardingHeaders(headers),
        status: 400,
      },
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
    {
      headers: mergeHostedOnboardingHeaders(headers),
      status: 500,
    },
  );
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const payload = (await request.json()) as unknown;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return payload as Record<string, unknown>;
}

function mergeHostedOnboardingHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(HOSTED_ONBOARDING_DEFAULT_HEADERS);

  if (headers) {
    const requestedHeaders = new Headers(headers);

    for (const [key, value] of requestedHeaders.entries()) {
      merged.set(key, value);
    }
  }

  return merged;
}
