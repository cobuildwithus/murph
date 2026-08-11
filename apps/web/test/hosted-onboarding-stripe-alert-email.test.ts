import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServerMocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
}));

vi.mock("next/server", () => ({
  after: nextServerMocks.after,
}));

import {
  buildHostedStripeOperationCorrelationId,
  sendHostedStripeOperationFailureAlert,
  sendHostedStripePaymentFailureEventAlert,
  sendHostedStripeReconciliationFailureAlert,
  scheduleHostedStripeOperationFailureAlert,
} from "@/src/lib/hosted-onboarding/stripe-alert-email";

const ALERT_ENV = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.com>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.com",
  RESEND_API_KEY: "re_test",
};
type StripeAlertEmailSend = NonNullable<
  Parameters<typeof sendHostedStripeOperationFailureAlert>[0]["sendEmail"]
>;

function createSendEmailMock() {
  return vi.fn<StripeAlertEmailSend>(async () => ({
    providerMessageId: "email_123",
  }));
}

describe("hosted Stripe alert email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends a metadata-only operation alert with stable request idempotency", async () => {
    const sendEmail = createSendEmailMock();
    const fields = {
      code: "card_declined",
      declineCode: "insufficient_funds",
      message: "Customer user@example.com failed at https://example.test/checkout",
      param: "payment_method",
      rawType: "card_error",
      requestId: "req_abc123",
      statusCode: 402,
      type: "StripeCardError",
    };
    const operationCorrelationId = buildHostedStripeOperationCorrelationId(
      "checkout-attempt-123",
    );

    await expect(sendHostedStripeOperationFailureAlert({
      env: ALERT_ENV,
      fields,
      operationCorrelationId,
      operationName: "checkout.sessions.create",
      sendEmail,
      stripeLiveMode: true,
    })).resolves.toBe("sent");
    await sendHostedStripeOperationFailureAlert({
      env: ALERT_ENV,
      fields,
      operationCorrelationId,
      operationName: "checkout.sessions.create",
      sendEmail,
      stripeLiveMode: true,
    });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const first = sendEmail.mock.calls[0]?.[0];
    const second = sendEmail.mock.calls[1]?.[0];
    expect(first).toMatchObject({
      idempotencyKey: expect.stringMatching(/^hosted-stripe-alert\/operation\/[a-f0-9]{64}$/u),
      subject: "Murph Stripe operation failed — checkout.sessions.create",
      to: ["operator@example.com"],
    });
    expect(second).toEqual(first);
    expect(first?.text).toContain("Stripe request id: req_abc123");
    expect(first?.text).toContain(
      `operation correlation: ${operationCorrelationId}`,
    );
    expect(first?.text).toContain("mode: live");
    expect(first?.text).toContain("decline code: insufficient_funds");
    expect(first?.text).not.toContain(fields.message);
    expect(first?.text).not.toContain("user@example.com");
    expect(first?.text).not.toContain("https://example.test");
  });

  it.each([
    { expectedMode: "live", stripeLiveMode: true },
    { expectedMode: "test", stripeLiveMode: false },
  ])(
    "keeps a no-request-id $expectedMode operation alert stable and visibly correlated",
    async ({ expectedMode, stripeLiveMode }) => {
      const sendEmail = createSendEmailMock();
      const operationCorrelationId = buildHostedStripeOperationCorrelationId(
        `stable-${expectedMode}-attempt`,
      );
      const input = {
        env: ALERT_ENV,
        fields: {
          code: "api_error",
          declineCode: null,
          message: null,
          param: null,
          rawType: "api_error",
          requestId: null,
          statusCode: 503,
          type: "StripeAPIError",
        },
        operationCorrelationId,
        operationName: "checkout.sessions.create",
        sendEmail,
        stripeLiveMode,
      };

      await sendHostedStripeOperationFailureAlert(input);
      await sendHostedStripeOperationFailureAlert(input);

      const first = sendEmail.mock.calls[0]?.[0];
      expect(sendEmail.mock.calls[1]?.[0]).toEqual(first);
      expect(first?.text).toContain(
        `operation correlation: ${operationCorrelationId}`,
      );
      expect(first?.text).toContain(`mode: ${expectedMode}`);
      expect(first?.text).toContain("Stripe request id: unavailable");
    },
  );

  it("keeps distinct Stripe request failures on one checkout attempt distinct", async () => {
    const sendEmail = createSendEmailMock();
    const operationCorrelationId = buildHostedStripeOperationCorrelationId(
      "retried-checkout-attempt",
    );
    const baseInput = {
      env: ALERT_ENV,
      fields: {
        code: "api_error",
        declineCode: null,
        message: null,
        param: null,
        rawType: "api_error",
        requestId: "req_first_failure",
        statusCode: 503,
        type: "StripeAPIError",
      },
      operationCorrelationId,
      operationName: "checkout.sessions.create",
      sendEmail,
      stripeLiveMode: true,
    };

    await sendHostedStripeOperationFailureAlert(baseInput);
    await sendHostedStripeOperationFailureAlert({
      ...baseInput,
      fields: {
        ...baseInput.fields,
        requestId: "req_second_failure",
      },
    });

    expect(sendEmail.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      sendEmail.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(sendEmail.mock.calls[0]?.[0].text).toContain(
      `operation correlation: ${operationCorrelationId}`,
    );
    expect(sendEmail.mock.calls[1]?.[0].text).toContain(
      `operation correlation: ${operationCorrelationId}`,
    );
  });

  it.each([
    "checkout.session.async_payment_failed",
    "invoice.finalization_failed",
    "invoice.payment_failed",
    "payment_intent.payment_failed",
  ])("sends one replay-safe alert shape for %s", async (eventType) => {
    const sendEmail = createSendEmailMock();
    const input = {
      env: ALERT_ENV,
      eventId: "evt_failure_123",
      eventType,
      livemode: true,
      sendEmail,
    };

    await expect(sendHostedStripePaymentFailureEventAlert(input)).resolves.toBe("sent");
    await sendHostedStripePaymentFailureEventAlert(input);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const first = sendEmail.mock.calls[0]?.[0];
    expect(sendEmail.mock.calls[1]?.[0]).toEqual(first);
    expect(first).toMatchObject({
      idempotencyKey: expect.stringMatching(/^hosted-stripe-alert\/payment-event\/[a-f0-9]{64}$/u),
      subject: `Murph Stripe payment failed — ${eventType}`,
      to: ["operator@example.com"],
    });
    expect(first?.text).toContain(`event type: ${eventType}`);
    expect(first?.text).toContain("Stripe event id: evt_failure_123");
    expect(first?.text).toContain("mode: live");
  });

  it.each([
    "charge.failed",
    "checkout.session.expired",
    "invoice.payment_action_required",
    "payment_intent.canceled",
  ])("ignores non-canonical or non-failure event %s", async (eventType) => {
    const sendEmail = vi.fn();

    await expect(sendHostedStripePaymentFailureEventAlert({
      env: ALERT_ENV,
      eventId: "evt_ignored_123",
      eventType,
      livemode: false,
      sendEmail,
    })).resolves.toBe("ignored_event");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("uses an event-scoped reconciliation alert without provider payloads", async () => {
    const sendEmail = createSendEmailMock();

    await expect(sendHostedStripeReconciliationFailureAlert({
      env: ALERT_ENV,
      errorCode: "HOSTED_STRIPE_EVENT_RETRIEVE_RETRY_REQUIRED",
      eventId: "evt_reconcile_123",
      eventType: "invoice.payment_failed",
      livemode: false,
      sendEmail,
    })).resolves.toBe("sent");

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^hosted-stripe-alert\/reconciliation\/[a-f0-9]{64}$/u),
      subject: "Murph Stripe reconciliation failed — invoice.payment_failed",
      to: ["operator@example.com"],
    }));
    expect(sendEmail.mock.calls[0]?.[0].text).toContain(
      "error code: HOSTED_STRIPE_EVENT_RETRIEVE_RETRY_REQUIRED",
    );
    expect(sendEmail.mock.calls[0]?.[0].text).toContain("mode: test");
  });

  it("does not send when the shared operational email channel is unconfigured", async () => {
    const sendEmail = vi.fn();

    await expect(sendHostedStripeOperationFailureAlert({
      env: {},
      fields: {
        code: null,
        declineCode: null,
        message: null,
        param: null,
        rawType: null,
        requestId: null,
        statusCode: null,
        type: null,
      },
      operationCorrelationId: buildHostedStripeOperationCorrelationId(
        "unconfigured-attempt",
      ),
      operationName: "customers.retrieve",
      sendEmail,
      stripeLiveMode: false,
    })).resolves.toBe("not_configured");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps an alert-provider failure out of the original Stripe control flow", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("HOSTED_LINQ_ALERT_EMAIL_FROM", "Murph Alerts <alerts@example.com>");
    vi.stubEnv("HOSTED_LINQ_ALERT_EMAILS", "operator@example.com");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 503,
    })));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    scheduleHostedStripeOperationFailureAlert({
      fields: {
        code: "api_error",
        declineCode: null,
        message: "Provider unavailable",
        param: null,
        rawType: "api_error",
        requestId: "req_delivery_failure_123",
        statusCode: 503,
        type: "StripeAPIError",
      },
      operationCorrelationId: buildHostedStripeOperationCorrelationId(
        "delivery-failure-attempt",
      ),
      operationName: "checkout.sessions.create",
      stripeLiveMode: true,
    });

    const scheduledTask = nextServerMocks.after.mock.calls[0]?.[0];
    expect(scheduledTask).toBeTypeOf("function");
    if (!scheduledTask) {
      throw new Error("Expected a scheduled Stripe alert task.");
    }
    await expect(scheduledTask()).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted Stripe alert email failed.",
      {
        alertKind: "operation",
        errorCode: "RESEND_SEND_FAILED",
        providerStatus: 503,
        stripeType: "StripeAPIError",
      },
    );
  });
});
