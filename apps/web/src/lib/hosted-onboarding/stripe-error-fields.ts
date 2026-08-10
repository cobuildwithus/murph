const HOSTED_STRIPE_ALERT_CORRELATION_CAUSE_KIND =
  "hosted_stripe_alert_correlation";
// Stripe request ids are opaque correlation handles (`req_...`); anything else is dropped.
const STRIPE_REQUEST_ID_PATTERN = /^req_[A-Za-z0-9_-]{1,64}$/u;

/**
 * Retains only Stripe's validated opaque request id when a provider adapter
 * replaces the raw SDK error with a client-safe hosted error. This module stays
 * free of Next request-lifecycle imports because general runtime and migration
 * entry points share the parser.
 */
export function buildHostedStripeAlertCorrelationCause(
  error: unknown,
): Readonly<{
  kind: typeof HOSTED_STRIPE_ALERT_CORRELATION_CAUSE_KIND;
  requestId: string;
}> | undefined {
  const requestId = readHostedStripeRequestId(error);
  return requestId
    ? Object.freeze({
        kind: HOSTED_STRIPE_ALERT_CORRELATION_CAUSE_KIND,
        requestId,
      })
    : undefined;
}

export function readHostedStripeAlertCorrelationRequestId(
  error: { readonly cause?: unknown },
): string | null {
  const cause = error.cause;
  if (!cause || typeof cause !== "object") {
    return null;
  }
  if (
    readHostedStripeErrorString(cause, "kind") !==
      HOSTED_STRIPE_ALERT_CORRELATION_CAUSE_KIND
  ) {
    return null;
  }
  return readHostedStripeRequestId(cause);
}

export function readHostedStripeRequestId(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const requestId = readHostedStripeErrorString(error, "requestId");
  return requestId && STRIPE_REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
}

function readHostedStripeErrorString(error: object, field: string): string | null {
  const value = readHostedStripeErrorField(error, field);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readHostedStripeErrorField(error: object, field: string): unknown {
  try {
    return Reflect.get(error, field);
  } catch {
    return null;
  }
}
