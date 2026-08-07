import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
  constructEvent: vi.fn(),
  prepareDuplicateEvent: vi.fn(),
  recordEvent: vi.fn(),
  startWorkflow: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeWebhookVerificationConfig: () => ({
    stripe: {
      webhooks: {
        constructEvent: mocks.constructEvent,
      },
    },
    webhookSecret: "whsec_test_123",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  recordHostedStripeEvent: mocks.recordEvent,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-webhook-reconciliation", () => ({
  prepareDuplicateHostedStripeWebhookEventForWorkflowRetry:
    mocks.prepareDuplicateEvent,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-webhook-workflow-start", () => ({
  startHostedStripeWebhookReconciliationWorkflow: mocks.startWorkflow,
}));

import {
  logHostedStripeFailure,
  withHostedStripeActionFailureAlert,
} from "@/src/lib/hosted-onboarding/stripe-error-log";
import { handleHostedStripeWebhook } from
  "@/src/lib/hosted-onboarding/webhook-service-stripe";

function makeFailureEvent(
  override: Partial<Stripe.Event> = {},
): Stripe.Event {
  return {
    api_version: "2025-06-30.basil",
    created: 1_751_400_000,
    data: {
      object: {
        id: "pi_failure_123",
        object: "payment_intent",
      } as Stripe.PaymentIntent,
    },
    id: "evt_failure_123",
    livemode: true,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: "payment_intent.payment_failed",
    ...override,
  } as Stripe.Event;
}

function createStripeError() {
  return Object.assign(new Error("Stripe API unavailable"), {
    code: "api_error",
    rawType: "api_error",
    requestId: "req_checkout_failure_123",
    statusCode: 503,
    type: "StripeAPIError",
  });
}

function stubAlertEnvironment(): void {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv(
    "HOSTED_LINQ_ALERT_EMAIL_FROM",
    "Murph Alerts <alerts@example.com>",
  );
  vi.stubEnv("HOSTED_LINQ_ALERT_EMAILS", "operator@example.com");
}

function createResendFetch(status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(
    status === 200 ? JSON.stringify({ id: "email_123" }) : null,
    {
      headers: { "Content-Type": "application/json" },
      status,
    },
  ));
}

describe("hosted Stripe alert integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    stubAlertEnvironment();
    mocks.constructEvent.mockReturnValue(makeFailureEvent());
    mocks.prepareDuplicateEvent.mockResolvedValue(false);
    mocks.recordEvent.mockResolvedValue({
      duplicate: false,
      type: "payment_intent.payment_failed",
    });
    mocks.startWorkflow.mockResolvedValue({ runId: "run_123" });
  });

  it("delivers a failed checkout operation through the real Resend transport", async () => {
    const fetchMock = createResendFetch();
    vi.stubGlobal("fetch", fetchMock);
    const stripeError = createStripeError();

    await expect(withHostedStripeActionFailureAlert({
      operationIdentity: "checkout-attempt-123",
      operationName: "checkout.sessions.create.billing-start",
      stripeLiveMode: true,
    }, async () => Promise.reject(stripeError))).rejects.toBe(stripeError);

    const task = mocks.after.mock.calls[0]?.[0];
    expect(task).toBeTypeOf("function");
    await task?.();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("https://api.resend.com/emails");
    expect(request?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "Idempotency-Key": expect.stringMatching(
          /^hosted-stripe-alert\/operation\/[a-f0-9]{64}$/u,
        ),
      }),
      method: "POST",
    });
  });

  it("keeps handled diagnostics log-only", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    logHostedStripeFailure({
      error: Object.assign(new Error("already expired"), {
        code: "resource_missing",
      }),
      operationName: "checkout.sessions.expire.subscription-cleanup-race",
    });

    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("does not alert for a non-Stripe action failure", async () => {
    const applicationError = new Error("database unavailable");

    await expect(withHostedStripeActionFailureAlert({
      operationIdentity: "checkout-attempt-application-failure",
      operationName: "billing.checkout",
      stripeLiveMode: false,
    }, async () => Promise.reject(applicationError))).rejects.toBe(
      applicationError,
    );

    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("delivers a new verified payment failure but suppresses its duplicate", async () => {
    const fetchMock = createResendFetch();
    vi.stubGlobal("fetch", fetchMock);

    await expect(handleHostedStripeWebhook({
      prisma: {} as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toMatchObject({ ok: true });
    await mocks.after.mock.calls[0]?.[0]?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mocks.after.mockClear();
    mocks.recordEvent.mockResolvedValueOnce({
      duplicate: true,
      type: "payment_intent.payment_failed",
    });
    mocks.prepareDuplicateEvent.mockResolvedValueOnce(true);
    await expect(handleHostedStripeWebhook({
      prisma: {} as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toMatchObject({ duplicate: true, ok: true });

    expect(mocks.after).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let an invalid signature trigger email", async () => {
    mocks.constructEvent.mockImplementationOnce(() => {
      throw new Error("invalid signature");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(handleHostedStripeWebhook({
      prisma: {} as never,
      rawBody: "{}",
      signature: "sig_invalid",
    })).rejects.toMatchObject({ code: "STRIPE_SIGNATURE_INVALID" });

    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("preserves the Stripe failure when after throws and Resend returns 503", async () => {
    const fetchMock = createResendFetch(503);
    vi.stubGlobal("fetch", fetchMock);
    mocks.after.mockImplementationOnce(() => {
      throw new Error("request context closed");
    });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stripeError = createStripeError();

    await expect(withHostedStripeActionFailureAlert({
      operationIdentity: "checkout-attempt-fallback",
      operationName: "checkout.sessions.create.billing-start",
      stripeLiveMode: false,
    }, async () => Promise.reject(stripeError))).rejects.toBe(stripeError);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted Stripe alert email failed.",
        expect.objectContaining({
          errorCode: "RESEND_SEND_FAILED",
          providerStatus: 503,
        }),
      );
    });
  });
});
