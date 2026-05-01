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
  nudgeHostedStripeWebhookActivationRunner: vi.fn(),
  reconcileRecordedHostedStripeWebhookEvent: vi.fn(),
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
    nudgeHostedStripeWebhookActivationRunner:
      mocks.nudgeHostedStripeWebhookActivationRunner,
    reconcileRecordedHostedStripeWebhookEvent:
      mocks.reconcileRecordedHostedStripeWebhookEvent,
  };
});

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { startHostedStripeWebhookReconciliationWorkflow } from "@/src/lib/hosted-onboarding/stripe-webhook-workflow-start";
import {
  nudgeHostedStripeWebhookActivationStep,
  reconcileHostedStripeWebhookEventStep,
} from "@/src/lib/hosted-onboarding/stripe-webhook-workflow-steps";
import { hostedStripeWebhookReconciliationWorkflow } from "@/src/lib/hosted-onboarding/stripe-webhook-workflows";

describe("hosted onboarding Stripe workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({
      runId: "run_123",
    });
    mocks.reconcileRecordedHostedStripeWebhookEvent.mockResolvedValue(
      makeReconciliationResult(),
    );
    mocks.nudgeHostedStripeWebhookActivationRunner.mockResolvedValue({
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

  it("reconciles the stored Stripe event by id", async () => {
    await expect(reconcileHostedStripeWebhookEventStep({
      eventId: "evt_123",
    })).resolves.toEqual(makeReconciliationResult());

    expect(mocks.reconcileRecordedHostedStripeWebhookEvent).toHaveBeenCalledWith({
      eventId: "evt_123",
    });
  });

  it("marks missing Stripe receipts fatal inside Workflow", async () => {
    mocks.reconcileRecordedHostedStripeWebhookEvent.mockRejectedValue(
      hostedOnboardingError({
        code: "STRIPE_WEBHOOK_RECEIPT_MISSING",
        httpStatus: 500,
        message: "Stripe webhook receipt is missing.",
      }),
    );

    await expect(reconcileHostedStripeWebhookEventStep({
      eventId: "evt_missing",
    })).rejects.toBeInstanceOf(FatalError);
  });

  it("marks retryable reconciliation failures retryable inside Workflow", async () => {
    mocks.reconcileRecordedHostedStripeWebhookEvent.mockRejectedValue(
      hostedOnboardingError({
        code: "STRIPE_WEBHOOK_RECONCILE_FAILED",
        httpStatus: 500,
        message: "Stripe webhook reconciliation did not complete. Retry later.",
        retryable: true,
      }),
    );

    await expect(reconcileHostedStripeWebhookEventStep({
      eventId: "evt_123",
    })).rejects.toBeInstanceOf(RetryableError);
  });

  it("nudges the hosted runner from the reconciliation result", async () => {
    await expect(nudgeHostedStripeWebhookActivationStep(
      makeReconciliationResult(),
    )).resolves.toBeUndefined();

    expect(mocks.nudgeHostedStripeWebhookActivationRunner).toHaveBeenCalledWith({
      ...makeReconciliationResult(),
      timeoutMs: 5_000,
    });
  });

  it("marks unaccepted Stripe activation nudges retryable inside Workflow", async () => {
    mocks.nudgeHostedStripeWebhookActivationRunner.mockResolvedValue({
      accepted: false,
      required: true,
    });

    await expect(nudgeHostedStripeWebhookActivationStep(
      makeReconciliationResult(),
    )).rejects.toBeInstanceOf(RetryableError);
  });
});

function makeReconciliationResult() {
  return {
    activatedMemberId: "member_123",
    eventId: "evt_123",
    eventType: "invoice.paid",
    hostedExecutionEventId: "member.activated:member_123:stripe:evt_123",
  };
}
