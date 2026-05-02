import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  FatalError,
  RetryableError,
} from "workflow";

const mocks = vi.hoisted(() => ({
  processRecordedHostedStripeWebhookEvent: vi.fn(),
  start: vi.fn(),
}));

vi.mock("workflow/api", () => ({
  start: mocks.start,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-webhook-reconciliation", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-webhook-reconciliation")
  >("@/src/lib/hosted-onboarding/stripe-webhook-reconciliation");

  return {
    ...actual,
    processRecordedHostedStripeWebhookEvent:
      mocks.processRecordedHostedStripeWebhookEvent,
  };
});

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { startHostedStripeWebhookReconciliationWorkflow } from "@/src/lib/hosted-onboarding/stripe-webhook-workflow-start";
import {
  processHostedStripeWebhookEventStep,
} from "@/src/lib/hosted-onboarding/stripe-webhook-workflow-steps";
import { hostedStripeWebhookReconciliationWorkflow } from "@/src/lib/hosted-onboarding/stripe-webhook-workflows";

describe("hosted onboarding Stripe workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({
      runId: "run_123",
    });
    mocks.processRecordedHostedStripeWebhookEvent.mockResolvedValue({
      accepted: true,
      required: true,
    });
  });

  it("starts the reconciliation workflow with only the Stripe event pointer", async () => {
    const input = {
      eventId: "evt_123",
    };

    await expect(startHostedStripeWebhookReconciliationWorkflow(input)).resolves.toEqual({
      runId: "run_123",
    });

    expect(mocks.start).toHaveBeenCalledWith(
      hostedStripeWebhookReconciliationWorkflow,
      [input],
    );
  });

  it("maps workflow start failures to Stripe-retryable errors", async () => {
    mocks.start.mockRejectedValue(new Error("workflow unavailable"));

    await expect(startHostedStripeWebhookReconciliationWorkflow({
      eventId: "evt_123",
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      httpStatus: 503,
      message: "Stripe webhook processing is temporarily unavailable.",
      retryable: true,
    });
  });

  it("processes the stored Stripe event by id without returning activation identifiers", async () => {
    await expect(processHostedStripeWebhookEventStep({
      eventId: "evt_123",
    })).resolves.toBeUndefined();

    expect(mocks.processRecordedHostedStripeWebhookEvent).toHaveBeenCalledWith({
      eventId: "evt_123",
      timeoutMs: 5_000,
    });
  });

  it("marks missing Stripe receipts fatal inside Workflow", async () => {
    mocks.processRecordedHostedStripeWebhookEvent.mockRejectedValue(
      hostedOnboardingError({
        code: "STRIPE_WEBHOOK_RECEIPT_MISSING",
        httpStatus: 500,
        message: "Stripe webhook receipt is missing.",
      }),
    );

    await expect(processHostedStripeWebhookEventStep({
      eventId: "evt_missing",
    })).rejects.toBeInstanceOf(FatalError);
  });

  it("marks poisoned Stripe receipts fatal inside Workflow", async () => {
    mocks.processRecordedHostedStripeWebhookEvent.mockRejectedValue(
      hostedOnboardingError({
        code: "STRIPE_WEBHOOK_RECONCILE_POISONED",
        httpStatus: 500,
        message: "Stripe webhook receipt is poisoned.",
        retryable: false,
      }),
    );

    await expect(processHostedStripeWebhookEventStep({
      eventId: "evt_poisoned",
    })).rejects.toBeInstanceOf(FatalError);
  });

  it("marks retryable reconciliation failures retryable inside Workflow", async () => {
    mocks.processRecordedHostedStripeWebhookEvent.mockRejectedValue(
      hostedOnboardingError({
        code: "STRIPE_WEBHOOK_RECONCILE_FAILED",
        httpStatus: 500,
        message: "Stripe webhook reconciliation did not complete. Retry later.",
        retryable: true,
      }),
    );

    await expect(processHostedStripeWebhookEventStep({
      eventId: "evt_123",
    })).rejects.toBeInstanceOf(RetryableError);
  });

  it("marks unaccepted Stripe activation nudges retryable inside Workflow", async () => {
    mocks.processRecordedHostedStripeWebhookEvent.mockResolvedValue({
      accepted: false,
      required: true,
    });

    await expect(processHostedStripeWebhookEventStep({
      eventId: "evt_123",
    })).rejects.toBeInstanceOf(RetryableError);
  });

  it("keeps the durable Stripe reconciliation retry window long enough for DB backoff and nudge outages", () => {
    expect(
      Object.getOwnPropertyDescriptor(
        processHostedStripeWebhookEventStep,
        "maxRetries",
      )?.value,
    ).toBe(120);
  });
});
