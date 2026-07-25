import { sanitizeHostedOnboardingLogString } from "./http";
import type { HostedOnboardingStructuredLogDetails } from "./logging";

const STRIPE_ERROR_TOKEN_MAX_LENGTH = 120;
const STRIPE_ERROR_MESSAGE_MAX_LENGTH = 240;
const STRIPE_OPERATION_NAME_MAX_LENGTH = 120;
// Stripe request ids are opaque correlation handles (`req_...`); anything else is dropped.
const STRIPE_REQUEST_ID_PATTERN = /^req_[A-Za-z0-9_-]{1,64}$/u;
const STRIPE_ERROR_TOKEN_PATTERN = /^[A-Za-z0-9_.\-[\]]{1,120}$/u;

export interface HostedStripeErrorFields {
  readonly code: string | null;
  readonly declineCode: string | null;
  readonly message: string | null;
  readonly param: string | null;
  readonly rawType: string | null;
  readonly requestId: string | null;
  readonly statusCode: number | null;
  readonly type: string | null;
}

/**
 * Reads the diagnosable fields off a rejected Stripe SDK call. Every field is
 * sanitized through the hosted onboarding log sanitizer and length capped, so a
 * provider-authored message that echoes a submitted value cannot leak secrets,
 * emails, phone numbers, URLs or paths into logs.
 */
export function describeHostedStripeError(error: unknown): HostedStripeErrorFields {
  if (!error || typeof error !== "object") {
    return {
      code: null,
      declineCode: null,
      message: null,
      param: null,
      rawType: null,
      requestId: null,
      statusCode: null,
      type: null,
    };
  }

  const requestId = readHostedStripeErrorString(error, "requestId");

  return {
    code: readHostedStripeErrorToken(error, "code"),
    declineCode: readHostedStripeErrorToken(error, "decline_code") ??
      readHostedStripeErrorToken(error, "declineCode"),
    message: sanitizeHostedOnboardingLogString(
      readHostedStripeErrorString(error, "message"),
      STRIPE_ERROR_MESSAGE_MAX_LENGTH,
    ),
    param: readHostedStripeErrorToken(error, "param"),
    rawType: readHostedStripeErrorToken(error, "rawType"),
    requestId: requestId && STRIPE_REQUEST_ID_PATTERN.test(requestId) ? requestId : null,
    statusCode: readHostedStripeErrorStatusCode(error),
    type: readHostedStripeErrorToken(error, "type"),
  };
}

/**
 * The structured log payload for a failed Stripe call. Keys are prefixed so a
 * Stripe failure is greppable and never collides with surrounding log context.
 */
function describeHostedStripeErrorForLog(input: {
  error: unknown;
  operationName: string;
}): HostedOnboardingStructuredLogDetails {
  const fields = describeHostedStripeError(input.error);

  return {
    operationName: sanitizeHostedOnboardingLogString(
      input.operationName,
      STRIPE_OPERATION_NAME_MAX_LENGTH,
    ) ?? "unknown",
    ...(fields.type ? { stripeType: fields.type } : {}),
    ...(fields.rawType ? { stripeRawType: fields.rawType } : {}),
    ...(fields.code ? { stripeCode: fields.code } : {}),
    ...(fields.declineCode ? { stripeDeclineCode: fields.declineCode } : {}),
    ...(fields.param ? { stripeParam: fields.param } : {}),
    ...(fields.statusCode === null ? {} : { stripeStatusCode: fields.statusCode }),
    ...(fields.requestId ? { stripeRequestId: fields.requestId } : {}),
    ...(fields.message ? { stripeMessage: fields.message } : {}),
  };
}

/**
 * Records a failed Stripe call so it stays diagnosable even when the caller
 * swallows or reshapes the rejection.
 */
export function logHostedStripeFailure(input: {
  error: unknown;
  operationName: string;
}): void {
  console.error("Hosted Stripe call failed.", describeHostedStripeErrorForLog(input));
}

/**
 * Logs any Stripe rejection and rethrows it untouched. Observability only: it
 * never changes control flow, retries or status codes.
 */
export async function withHostedStripeFailureLog<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logHostedStripeFailure({ error, operationName });
    throw error;
  }
}

/**
 * The client-visible detail shape carried on hosted onboarding domain errors.
 * Domain error details are serialized into HTTP error responses, so this stays
 * a narrow token-only projection; the provider message and request id are
 * log-only and live in {@link logHostedStripeFailure}.
 */
export function describeHostedStripeErrorDetails(input: {
  error: unknown;
  operationName: string;
}): HostedOnboardingStructuredLogDetails {
  const fields = describeHostedStripeError(input.error);

  return {
    operationName: sanitizeHostedOnboardingLogString(
      input.operationName,
      STRIPE_OPERATION_NAME_MAX_LENGTH,
    ) ?? "unknown",
    ...((fields.type ?? fields.rawType)
      ? { type: fields.type ?? fields.rawType }
      : {}),
    ...(fields.code ? { code: fields.code } : {}),
    ...(fields.param ? { stripeParam: fields.param } : {}),
    ...(fields.statusCode === null ? {} : { statusCode: fields.statusCode }),
    requestIdPresent: fields.requestId !== null,
  };
}

function readHostedStripeErrorToken(error: object, field: string): string | null {
  const value = readHostedStripeErrorString(error, field);

  if (!value || !STRIPE_ERROR_TOKEN_PATTERN.test(value)) {
    return null;
  }

  return sanitizeHostedOnboardingLogString(value, STRIPE_ERROR_TOKEN_MAX_LENGTH);
}

function readHostedStripeErrorString(error: object, field: string): string | null {
  const value = readHostedStripeErrorField(error, field);

  return typeof value === "string" && value.length > 0 ? value : null;
}

function readHostedStripeErrorStatusCode(error: object): number | null {
  const value = readHostedStripeErrorField(error, "statusCode");

  return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    ? value
    : null;
}

function readHostedStripeErrorField(error: object, field: string): unknown {
  try {
    return Reflect.get(error, field);
  } catch {
    // Provider objects can expose throwing getters; a failed read is no field.
    return null;
  }
}
