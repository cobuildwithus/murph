import { HostedStripeEventStatus } from "@prisma/client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  recordHostedStripeEvent: vi.fn(),
  runtime: {
    webhookSecret: "whsec_test_123" as string | null,
  },
  scheduleHostedStripePaymentFailureEventAlert: vi.fn(),
  startHostedStripeWebhookReconciliationWorkflow: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeWebhookVerificationConfig: () => ({
    stripe: {
      webhooks: {
        constructEvent: mocks.constructEvent,
      },
    },
    webhookSecret: mocks.runtime.webhookSecret,
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  recordHostedStripeEvent: mocks.recordHostedStripeEvent,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-alert-email", () => ({
  scheduleHostedStripePaymentFailureEventAlert:
    mocks.scheduleHostedStripePaymentFailureEventAlert,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-webhook-workflow-start", () => ({
  startHostedStripeWebhookReconciliationWorkflow:
    mocks.startHostedStripeWebhookReconciliationWorkflow,
}));

import { handleHostedStripeWebhook } from "@/src/lib/hosted-onboarding/webhook-service-stripe";

describe("hosted Stripe webhook service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtime.webhookSecret = "whsec_test_123";
    mocks.constructEvent.mockReturnValue(makeStripeEvent());
    mocks.recordHostedStripeEvent.mockResolvedValue({
      duplicate: false,
      type: "invoice.paid",
    });
    mocks.startHostedStripeWebhookReconciliationWorkflow.mockResolvedValue({
      runId: "run_123",
    });
  });

  it("records the event first and starts pointer-only reconciliation workflow", async () => {
    const prisma = createPrisma();

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toEqual({
      ok: true,
      type: "invoice.paid",
    });

    expect(mocks.recordHostedStripeEvent).toHaveBeenCalledWith({
      event: makeStripeEvent(),
      prisma,
    });

    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).toHaveBeenCalledWith({
      eventId: "evt_123",
    });
    expect(mocks.scheduleHostedStripePaymentFailureEventAlert).toHaveBeenCalledWith({
      eventId: "evt_123",
      eventType: "invoice.paid",
      livemode: false,
    });
  });

  it("alerts once when a new verified payment-failure event is recorded", async () => {
    const prisma = createPrisma();
    const event = makeStripeEvent({
      livemode: true,
      type: "payment_intent.payment_failed",
    });
    mocks.constructEvent.mockReturnValueOnce(event);
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: false,
      type: event.type,
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toMatchObject({
      ok: true,
      type: "payment_intent.payment_failed",
    });

    expect(mocks.scheduleHostedStripePaymentFailureEventAlert).toHaveBeenCalledWith({
      eventId: "evt_123",
      eventType: "payment_intent.payment_failed",
      livemode: true,
    });
  });

  it("does not alert again for a duplicate payment-failure event", async () => {
    const prisma = createPrisma({
      status: HostedStripeEventStatus.completed,
    });
    const event = makeStripeEvent({
      type: "invoice.payment_failed",
    });
    mocks.constructEvent.mockReturnValueOnce(event);
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: true,
      type: event.type,
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(mocks.scheduleHostedStripePaymentFailureEventAlert).not.toHaveBeenCalled();
  });

  it("starts duplicate failed receipts without resetting stored DB backoff", async () => {
    const prisma = createPrisma({
      nextAttemptAt: new Date(Date.now() + 60_000),
      status: HostedStripeEventStatus.failed,
    });
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: true,
      type: "invoice.paid",
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toEqual({
      duplicate: true,
      ok: true,
      type: "invoice.paid",
    });

    expect(mocks.recordHostedStripeEvent).toHaveBeenCalledWith({
      event: makeStripeEvent(),
      prisma,
    });
    expect(prisma.hostedStripeEvent.findUnique).toHaveBeenCalledWith({
      select: {
        activationResultJson: true,
        claimExpiresAt: true,
        nextAttemptAt: true,
        status: true,
        type: true,
        updatedAt: true,
      },
      where: {
        eventId: "evt_123",
      },
    });
    expect(prisma.hostedStripeEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).toHaveBeenCalledWith({
      eventId: "evt_123",
    });
  });

  it("starts pending duplicate receipts without resetting stored DB backoff", async () => {
    const prisma = createPrisma({
      nextAttemptAt: new Date(Date.now() + 60_000),
      status: HostedStripeEventStatus.pending,
    });
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: true,
      type: "invoice.paid",
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toEqual({
      duplicate: true,
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedStripeEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).toHaveBeenCalledWith({
      eventId: "evt_123",
    });
  });

  it("starts duplicate poisoned receipts without mutating them back to retryable", async () => {
    const prisma = createPrisma({
      status: HostedStripeEventStatus.poisoned,
    });
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: true,
      type: "invoice.paid",
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toEqual({
      duplicate: true,
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedStripeEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).toHaveBeenCalledWith({
      eventId: "evt_123",
    });
  });

  it("starts duplicate completed receipts so activation runtime wakes can be retried", async () => {
    const prisma = createPrisma({
      status: HostedStripeEventStatus.completed,
    });
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: true,
      type: "invoice.paid",
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toEqual({
      duplicate: true,
      ok: true,
      type: "invoice.paid",
    });

    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).toHaveBeenCalledWith({
      eventId: "evt_123",
    });
    expect(prisma.hostedStripeEvent.updateMany).not.toHaveBeenCalled();
  });

  it("skips duplicate workflow start when another worker holds a fresh processing lease", async () => {
    const prisma = createPrisma({
      claimExpiresAt: new Date(Date.now() + 60_000),
      status: HostedStripeEventStatus.processing,
    });
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: true,
      type: "invoice.paid",
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toEqual({
      duplicate: true,
      ok: true,
      type: "invoice.paid",
    });

    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).not.toHaveBeenCalled();
    expect(prisma.hostedStripeEvent.updateMany).not.toHaveBeenCalled();
  });

  it("rejects webhook requests without a Stripe signature", async () => {
    await expect(handleHostedStripeWebhook({
      prisma: {} as never,
      rawBody: "{}",
      signature: null,
    })).rejects.toMatchObject({
      code: "STRIPE_SIGNATURE_REQUIRED",
      httpStatus: 401,
      retryable: false,
    });

    expect(mocks.recordHostedStripeEvent).not.toHaveBeenCalled();
    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).not.toHaveBeenCalled();
  });

  it("rejects webhook requests when the Stripe webhook secret is missing", async () => {
    mocks.runtime.webhookSecret = null;

    await expect(handleHostedStripeWebhook({
      prisma: {} as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).rejects.toMatchObject({
      code: "STRIPE_WEBHOOK_SECRET_REQUIRED",
      httpStatus: 500,
      retryable: false,
    });

    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(mocks.recordHostedStripeEvent).not.toHaveBeenCalled();
    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).not.toHaveBeenCalled();
  });

  it("rejects webhook requests with an invalid Stripe signature", async () => {
    mocks.constructEvent.mockImplementationOnce(() => {
      throw new Error("Bad Stripe signature");
    });

    await expect(handleHostedStripeWebhook({
      prisma: {} as never,
      rawBody: "{}",
      signature: "sig_bad",
    })).rejects.toMatchObject({
      code: "STRIPE_SIGNATURE_INVALID",
      httpStatus: 401,
      retryable: false,
    });

    expect(mocks.recordHostedStripeEvent).not.toHaveBeenCalled();
    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).not.toHaveBeenCalled();
  });

  it("keeps workflow start failures retryable instead of acknowledging success", async () => {
    const prisma = createPrisma({
      nextAttemptAt: new Date(Date.now() - 60_000),
      status: HostedStripeEventStatus.failed,
    });
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: true,
      type: "invoice.paid",
    });
    mocks.startHostedStripeWebhookReconciliationWorkflow.mockRejectedValueOnce({
      code: "HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      httpStatus: 503,
      retryable: true,
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.recordHostedStripeEvent).toHaveBeenCalledWith({
      event: makeStripeEvent(),
      prisma,
    });
    expect(mocks.startHostedStripeWebhookReconciliationWorkflow).toHaveBeenCalledWith({
      eventId: "evt_123",
    });
  });
});

function createPrisma(
  storedEvent?: Partial<{
    claimExpiresAt: Date | null;
    nextAttemptAt: Date;
    status: HostedStripeEventStatus;
    updatedAt: Date;
  }>,
) {
  const receipt = storedEvent
    ? {
      claimExpiresAt: storedEvent.claimExpiresAt ?? null,
      nextAttemptAt: storedEvent.nextAttemptAt ?? new Date(Date.now() - 60_000),
      status: storedEvent.status ?? HostedStripeEventStatus.failed,
      type: "invoice.paid",
      updatedAt: storedEvent.updatedAt ?? new Date("2026-04-23T00:00:00.000Z"),
    }
    : null;

  return {
    __tag: "prisma",
    hostedStripeEvent: {
      findUnique: vi.fn().mockResolvedValue(receipt),
      updateMany: vi.fn().mockResolvedValue({
        count: 1,
      }),
    },
  };
}

function makeStripeEvent(
  overrides: Partial<Pick<Stripe.Event, "livemode" | "type">> = {},
): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: 1_774_708_800,
    data: {
      object: {
        id: "in_123",
      },
    },
    id: "evt_123",
    livemode: overrides.livemode ?? false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: overrides.type ?? "invoice.paid",
  } as Stripe.Event;
}
