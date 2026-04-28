import { HostedStripeEventStatus } from "@prisma/client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
  reconcileHostedStripeEventById: vi.fn(),
  recordHostedStripeEvent: vi.fn(),
  runtime: {
    webhookSecret: "whsec_test_123" as string | null,
  },
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
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
  reconcileHostedStripeEventById: mocks.reconcileHostedStripeEventById,
  recordHostedStripeEvent: mocks.recordHostedStripeEvent,
}));

import { handleHostedStripeWebhook } from "@/src/lib/hosted-onboarding/webhook-service-stripe";

describe("hosted Stripe webhook service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtime.webhookSecret = "whsec_test_123";
    mocks.constructEvent.mockReturnValue(makeStripeEvent());
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.reconcileHostedStripeEventById.mockResolvedValue({
      activatedMemberId: "member_123",
      eventId: "evt_123",
      hostedExecutionEventId: "dispatch_123",
      status: "completed",
    });
    mocks.recordHostedStripeEvent.mockResolvedValue({
      duplicate: false,
      type: "invoice.paid",
    });
  });

  it("records the event first and reconciles inline", async () => {
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

    expect(mocks.reconcileHostedStripeEventById).toHaveBeenCalledWith({
      eventId: "evt_123",
      prisma,
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "stripe.webhook",
      userId: "member_123",
    });
  });

  it("retries inline reconciliation for duplicate Stripe events instead of skipping the stored receipt", async () => {
    const updatedAt = new Date("2026-04-23T00:00:00.000Z");
    const prisma = createPrisma({
      nextAttemptAt: new Date(Date.now() + 60_000),
      status: HostedStripeEventStatus.failed,
      updatedAt,
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
        claimExpiresAt: true,
        nextAttemptAt: true,
        status: true,
        updatedAt: true,
      },
      where: {
        eventId: "evt_123",
      },
    });
    expect(prisma.hostedStripeEvent.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimExpiresAt: null,
        nextAttemptAt: expect.any(Date),
      }),
      where: {
        eventId: "evt_123",
        updatedAt,
      },
    });
    expect(mocks.reconcileHostedStripeEventById).toHaveBeenCalledWith({
      eventId: "evt_123",
      prisma,
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "stripe.webhook",
      userId: "member_123",
    });
  });

  it("skips duplicate inline reconciliation when the stored Stripe receipt is already completed", async () => {
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

    expect(mocks.reconcileHostedStripeEventById).not.toHaveBeenCalled();
    expect(prisma.hostedStripeEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("skips duplicate inline reconciliation when another worker holds a fresh processing lease", async () => {
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

    expect(mocks.reconcileHostedStripeEventById).not.toHaveBeenCalled();
    expect(prisma.hostedStripeEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
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
    expect(mocks.reconcileHostedStripeEventById).not.toHaveBeenCalled();
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
    expect(mocks.reconcileHostedStripeEventById).not.toHaveBeenCalled();
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
    expect(mocks.reconcileHostedStripeEventById).not.toHaveBeenCalled();
  });

  it("keeps duplicate reconciliation failures retryable instead of acknowledging success", async () => {
    const prisma = createPrisma({
      nextAttemptAt: new Date(Date.now() - 60_000),
      status: HostedStripeEventStatus.failed,
    });
    mocks.recordHostedStripeEvent.mockResolvedValueOnce({
      duplicate: true,
      type: "invoice.paid",
    });
    mocks.reconcileHostedStripeEventById.mockResolvedValueOnce({
      activatedMemberId: null,
      eventId: "evt_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).rejects.toMatchObject({
      code: "STRIPE_WEBHOOK_RECONCILE_FAILED",
      httpStatus: 500,
      retryable: true,
    });

    expect(mocks.recordHostedStripeEvent).toHaveBeenCalledWith({
      event: makeStripeEvent(),
      prisma,
    });
    expect(mocks.reconcileHostedStripeEventById).toHaveBeenCalledWith({
      eventId: "evt_123",
      prisma,
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
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

function makeStripeEvent(): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: 1_774_708_800,
    data: {
      object: {
        id: "in_123",
      },
    },
    id: "evt_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "invoice.paid",
  } as Stripe.Event;
}
