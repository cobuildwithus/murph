import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stripeAlertMocks = vi.hoisted(() => ({
  scheduleHostedStripeOperationFailureAlert: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-alert-email", () => ({
  buildHostedStripeOperationCorrelationId: () =>
    `stripe_op_${"a".repeat(24)}`,
  scheduleHostedStripeOperationFailureAlert:
    stripeAlertMocks.scheduleHostedStripeOperationFailureAlert,
}));

import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  logHostedOnboardingDiagnostic,
  logHostedOnboardingWarning,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import {
  describeHostedStripeError,
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
  reportHostedStripeOperationFailure,
  withHostedStripeFailureLog,
} from "@/src/lib/hosted-onboarding/stripe-error-log";

describe("hosted onboarding timing logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a sanitized elapsed timing payload", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const dateNow = vi.spyOn(Date, "now");

    dateNow.mockReturnValueOnce(1_000).mockReturnValueOnce(1_245);

    const timing = startHostedOnboardingTiming("hosted-onboarding.route.billing-checkout", {
      checkoutUrl: "https://stripe.example.test/session_123",
      inviteCode: "invite_123",
      nonFiniteNumber: Number.NaN,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      memberEmail: "user@example.com",
      stage: "checkout",
    });

    expect(consoleInfo).toHaveBeenCalledWith("Hosted onboarding timing.", {
      checkoutUrl: "<redacted-url>",
      elapsedMs: 245,
      inviteCode: "invite_123",
      memberEmail: "<redacted-email>",
      outcome: "completed",
      stage: "checkout",
      step: "hosted-onboarding.route.billing-checkout",
    });
  });

  it("normalizes timing error names without exposing messages", () => {
    expect(deriveHostedOnboardingTimingErrorName(new TypeError("boom"))).toBe("TypeError");
    expect(deriveHostedOnboardingTimingErrorName("boom")).toBe("StringError");
    expect(deriveHostedOnboardingTimingErrorName({})).toBe("UnknownError");
  });

  it("emits sanitized searchable diagnostic payloads", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    logHostedOnboardingDiagnostic("hosted.test-diagnostic", {
      decision: "ignored-no-active-route",
      eventIdSuffix: "abc123",
      memberEmail: "user@example.com",
      responseReason: "ignored-no-active-route",
      unsafeUrl: "https://example.test/raw",
    });

    expect(consoleInfo).toHaveBeenCalledWith(
      "Hosted onboarding diagnostic: hosted.test-diagnostic.",
      {
        decision: "ignored-no-active-route",
        diagnostic: "hosted.test-diagnostic",
        eventIdSuffix: "abc123",
        memberEmail: "<redacted-email>",
        responseReason: "ignored-no-active-route",
        unsafeUrl: "<redacted-url>",
      },
    );
  });

  it("emits sanitized searchable warning payloads", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logHostedOnboardingWarning("hosted.test-warning", {
      eventIdSuffix: "abc123",
      partsKind: "missing",
      unsafeEmail: "user@example.com",
      unsafeUrl: "https://example.test/raw",
    });

    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted onboarding warning: hosted.test-warning.",
      {
        eventIdSuffix: "abc123",
        partsKind: "missing",
        unsafeEmail: "<redacted-email>",
        unsafeUrl: "<redacted-url>",
        warning: "hosted.test-warning",
      },
    );
  });
});

describe("hosted Stripe failure logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts every diagnosable Stripe field including the request id", () => {
    expect(describeHostedStripeError({
      code: "resource_missing",
      decline_code: "insufficient_funds",
      message: "No such subscription: sub_123",
      param: "items[0][price]",
      rawType: "invalid_request_error",
      requestId: "req_abc123",
      statusCode: 400,
      type: "StripeInvalidRequestError",
    })).toEqual({
      code: "resource_missing",
      declineCode: "insufficient_funds",
      message: "No such subscription: sub_123",
      param: "items[0][price]",
      rawType: "invalid_request_error",
      requestId: "req_abc123",
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });
  });

  it("logs the request id instead of only its presence", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    logHostedStripeFailure({
      error: Object.assign(new Error("Cannot update a paused subscription."), {
        code: "subscription_paused",
        param: "pause_collection",
        rawType: "invalid_request_error",
        requestId: "req_abc123",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }),
      operationName: "subscription.update.paused-pre-resume-cleanup",
    });

    expect(consoleError).toHaveBeenCalledWith("Hosted Stripe call failed.", {
      operationName: "subscription.update.paused-pre-resume-cleanup",
      stripeCode: "subscription_paused",
      stripeMessage: "Cannot update a paused subscription.",
      stripeParam: "pause_collection",
      stripeRawType: "invalid_request_error",
      stripeRequestId: "req_abc123",
      stripeStatusCode: 400,
      stripeType: "StripeInvalidRequestError",
    });
    expect(
      stripeAlertMocks.scheduleHostedStripeOperationFailureAlert,
    ).not.toHaveBeenCalled();
  });

  it("alerts only when an action owner classifies the rejection as terminal", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = {
      code: "api_error",
      rawType: "api_error",
      requestId: "req_checkout_123",
      statusCode: 503,
      type: "StripeAPIError",
    };

    reportHostedStripeOperationFailure({
      error,
      operationIdentity: "checkout-attempt-123",
      operationName: "checkout.sessions.create.billing-start",
      stripeLiveMode: true,
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(
      stripeAlertMocks.scheduleHostedStripeOperationFailureAlert,
    ).toHaveBeenCalledWith({
      fields: {
        code: "api_error",
        declineCode: null,
        message: null,
        param: null,
        rawType: "api_error",
        requestId: "req_checkout_123",
        statusCode: 503,
        type: "StripeAPIError",
      },
      operationCorrelationId: expect.stringMatching(/^stripe_op_[a-f0-9]{24}$/u),
      operationName: "checkout.sessions.create.billing-start",
      stripeLiveMode: true,
    });
  });

  it("redacts secrets and caps provider messages", () => {
    const fields = describeHostedStripeError({
      message: `Invalid API key sk_live_${"a".repeat(24)} for user@example.com at https://api.stripe.com/v1 ${"x".repeat(400)}`,
    });

    expect(fields.message).not.toMatch(/sk_live_|@example\.com|https:/u);
    expect(fields.message).toContain("<redacted-secret>");
    expect(fields.message).toContain("<redacted-email>");
    expect(fields.message?.length).toBe(240);
  });

  it("drops unexpected request ids and status codes and redacts secret-shaped tokens", () => {
    expect(describeHostedStripeError({
      code: `whsec_${"a".repeat(20)}`,
      param: "not a token",
      requestId: "sub_1234567890",
      statusCode: 600,
    })).toMatchObject({
      code: "<redacted-secret>",
      param: null,
      requestId: null,
      statusCode: null,
    });
  });

  it("degrades safely for non-Stripe errors and throwing getters", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(describeHostedStripeError("boom")).toEqual({
      code: null,
      declineCode: null,
      message: null,
      param: null,
      rawType: null,
      requestId: null,
      statusCode: null,
      type: null,
    });

    logHostedStripeFailure({
      error: Object.defineProperties({}, {
        message: {
          get: () => {
            throw new Error("sensitive");
          },
        },
        requestId: {
          get: () => {
            throw new Error("sensitive");
          },
        },
      }),
      operationName: "subscription.retrieve",
    });

    expect(consoleError).toHaveBeenCalledWith("Hosted Stripe call failed.", {
      operationName: "subscription.retrieve",
    });
  });

  it("keeps domain error details free of the provider message and request id", () => {
    expect(describeHostedStripeErrorDetails({
      error: {
        code: "resource_missing",
        message: "No such subscription: sub_123",
        param: "items[0][price]",
        requestId: "req_abc123",
        statusCode: 404,
        type: "StripeInvalidRequestError",
      },
      operationName: "subscription.retrieve",
    })).toEqual({
      code: "resource_missing",
      operationName: "subscription.retrieve",
      requestIdPresent: true,
      statusCode: 404,
      stripeParam: "items[0][price]",
      type: "StripeInvalidRequestError",
    });
  });

  it("logs and rethrows without changing the rejection", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejection = Object.assign(new Error("Stripe is down."), {
      requestId: "req_abc123",
      statusCode: 503,
      type: "StripeConnectionError",
    });

    await expect(withHostedStripeFailureLog(
      "subscription.retrieve",
      () => Promise.reject(rejection),
    )).rejects.toBe(rejection);
    await expect(withHostedStripeFailureLog(
      "subscription.retrieve",
      () => Promise.resolve("ok"),
    )).resolves.toBe("ok");

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("Hosted Stripe call failed.", {
      operationName: "subscription.retrieve",
      stripeMessage: "Stripe is down.",
      stripeRequestId: "req_abc123",
      stripeStatusCode: 503,
      stripeType: "StripeConnectionError",
    });
  });
});
