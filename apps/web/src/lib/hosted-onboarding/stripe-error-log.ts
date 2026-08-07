import {
  isHostedOnboardingError,
} from "./errors";
import { sanitizeHostedOnboardingLogString } from "./http";
import type { HostedOnboardingStructuredLogDetails } from "./logging";
import {
  buildHostedStripeOperationCorrelationId,
  scheduleHostedStripeOperationFailureAlert,
} from "./stripe-alert-email";
import {
  readHostedStripeAlertCorrelationRequestId,
  readHostedStripeRequestId,
} from "./stripe-error-fields";

export { buildHostedStripeAlertCorrelationCause } from "./stripe-error-fields";

const STRIPE_ERROR_TOKEN_MAX_LENGTH = 120;
const STRIPE_ERROR_MESSAGE_MAX_LENGTH = 240;
const STRIPE_OPERATION_NAME_MAX_LENGTH = 120;
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
    requestId: readHostedStripeRequestId(error),
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
 * Records a failed Stripe call. Logging is deliberately not alert eligibility:
 * callers also use this diagnostic for provider rejections that are safely
 * absorbed by a re-read, cleanup race, or canonical reconciliation retry.
 */
export function logHostedStripeFailure(input: {
  error: unknown;
  operationName: string;
}): void {
  console.error("Hosted Stripe call failed.", describeHostedStripeErrorForLog(input));
}

/**
 * Records and alerts a Stripe rejection that is known to abort a user-visible
 * billing action. The caller owns the stable attempt identity and live/test
 * mode so the email remains both replay-safe and useful for triage.
 */
export function reportHostedStripeOperationFailure(input: {
  error: unknown;
  operationIdentity: string;
  operationName: string;
  stripeLiveMode: boolean;
}): void {
  logHostedStripeFailure(input);
  scheduleHostedStripeOperationFailureAlert({
    fields: describeHostedStripeAlertFields(input.error),
    operationCorrelationId: buildHostedStripeOperationCorrelationId(
      input.operationIdentity,
    ),
    operationName: input.operationName,
    stripeLiveMode: input.stripeLiveMode,
  });
}

/**
 * Provider wrappers intentionally replace raw Stripe errors with safe hosted
 * errors before they reach an action owner. Rehydrate only their already-safe
 * token/status detail and correlation-only cause so the alert remains useful
 * without retaining a raw provider object or message.
 */
function describeHostedStripeAlertFields(
  error: unknown,
): HostedStripeErrorFields {
  const direct = describeHostedStripeError(error);
  if (!isHostedOnboardingError(error)) {
    return direct;
  }
  const requestId = readHostedStripeAlertCorrelationRequestId(error);
  if (!error.details) {
    return {
      ...direct,
      requestId: requestId ?? direct.requestId,
    };
  }

  const providerType =
    readHostedStripeErrorToken(error.details, "providerErrorType") ??
    readHostedStripeErrorToken(error.details, "type");
  const providerCode =
    readHostedStripeErrorToken(error.details, "providerErrorCode") ??
    readHostedStripeErrorToken(error.details, "code");

  return {
    ...direct,
    code: providerCode ?? direct.code,
    param:
      readHostedStripeErrorToken(error.details, "stripeParam") ?? direct.param,
    requestId: requestId ?? direct.requestId,
    statusCode:
      readHostedStripeErrorStatusCode(error.details) ?? direct.statusCode,
    type: providerType ?? direct.type,
  };
}

/**
 * Distinguishes a Stripe SDK rejection from an arbitrary action failure. Stripe
 * errors expose either a `Stripe...` type, a raw provider type, or a request id;
 * hosted/domain errors must be classified explicitly by their action owner.
 */
export function isHostedStripeProviderError(error: unknown): boolean {
  const fields = describeHostedStripeError(error);

  return fields.requestId !== null ||
    fields.rawType !== null ||
    fields.type?.startsWith("Stripe") === true;
}

/**
 * Observes any Stripe rejection and rethrows it untouched. It never changes
 * control flow, retries or status codes.
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
 * Observes a Stripe rejection that aborts a user-visible billing action,
 * schedules a best-effort alert, and rethrows it untouched.
 */
export async function withHostedStripeActionFailureAlert<T>(
  input: {
    isTerminalStripeFailure?: (error: unknown) => boolean;
    operationIdentity: string;
    operationName: string;
    stripeLiveMode: boolean;
  },
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const isTerminalStripeFailure = input.isTerminalStripeFailure ??
      isHostedStripeProviderError;
    if (isTerminalStripeFailure(error)) {
      reportHostedStripeOperationFailure({
        error,
        operationIdentity: input.operationIdentity,
        operationName: input.operationName,
        stripeLiveMode: input.stripeLiveMode,
      });
    }
    throw error;
  }
}

/**
 * The client-visible detail shape carried on hosted onboarding domain errors.
 * Domain error details are serialized into HTTP error responses, so this stays
 * a narrow token-only projection; the provider message and request id are
 * absent from this client-visible shape. A validated request id may cross an
 * internal adapter only through the frozen, non-serialized correlation cause.
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
