import { HostedStripeEventStatus } from "@prisma/client";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
  reconcileHostedStripeEventById: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  reconcileHostedStripeEventById: mocks.reconcileHostedStripeEventById,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

import {
  nudgeHostedStripeWebhookActivationRunner,
  reconcileRecordedHostedStripeWebhookEvent,
} from "@/src/lib/hosted-onboarding/stripe-webhook-reconciliation";

describe("hosted Stripe webhook reconciliation helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcileHostedStripeEventById.mockResolvedValue({
      activatedMemberId: "member_123",
      eventId: "evt_123",
      hostedExecutionEventId: "member.activated:member_123:stripe:evt_123",
      status: "completed",
    });
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
  });

  it("reconciles a stored Stripe event by id and returns activation pointers", async () => {
    const prisma = createPrisma();

    await expect(reconcileRecordedHostedStripeWebhookEvent({
      eventId: "evt_123",
      prisma: prisma as never,
    })).resolves.toEqual({
      activatedMemberId: "member_123",
      eventId: "evt_123",
      eventType: "invoice.paid",
      hostedExecutionEventId: "member.activated:member_123:stripe:evt_123",
    });

    expect(mocks.reconcileHostedStripeEventById).toHaveBeenCalledWith({
      eventId: "evt_123",
      prisma,
    });
  });

  it("treats a missing Stripe receipt as fatal for Workflow retries", async () => {
    await expect(reconcileRecordedHostedStripeWebhookEvent({
      eventId: "evt_missing",
      prisma: createPrisma(null) as never,
    })).rejects.toMatchObject({
      code: "STRIPE_WEBHOOK_RECEIPT_MISSING",
      retryable: false,
    });

    expect(mocks.reconcileHostedStripeEventById).not.toHaveBeenCalled();
  });

  it("keeps failed reconciliation retryable for Workflow", async () => {
    mocks.reconcileHostedStripeEventById.mockResolvedValue({
      activatedMemberId: null,
      eventId: "evt_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    await expect(reconcileRecordedHostedStripeWebhookEvent({
      eventId: "evt_123",
      prisma: createPrisma() as never,
    })).rejects.toMatchObject({
      code: "STRIPE_WEBHOOK_RECONCILE_FAILED",
      retryable: true,
    });
  });

  it("nudges activated members without requiring member ids in workflow input", async () => {
    await expect(nudgeHostedStripeWebhookActivationRunner({
      activatedMemberId: "member_123",
      eventId: "evt_123",
      eventType: "invoice.paid",
      hostedExecutionEventId: "member.activated:member_123:stripe:evt_123",
      timeoutMs: 5_000,
    })).resolves.toEqual({
      accepted: true,
      required: true,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "stripe.webhook:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
  });

  it("does not nudge when reconciliation did not activate a member", async () => {
    await expect(nudgeHostedStripeWebhookActivationRunner({
      activatedMemberId: null,
      eventId: "evt_123",
      eventType: "customer.subscription.updated",
      hostedExecutionEventId: null,
    })).resolves.toEqual({
      accepted: true,
      required: false,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });
});

function createPrisma(
  storedEvent: {
    claimExpiresAt: Date | null;
    nextAttemptAt: Date;
    status: HostedStripeEventStatus;
    type: string;
    updatedAt: Date;
  } | null = {
    claimExpiresAt: null,
    nextAttemptAt: new Date("2026-04-23T00:00:00.000Z"),
    status: HostedStripeEventStatus.pending,
    type: "invoice.paid",
    updatedAt: new Date("2026-04-23T00:00:00.000Z"),
  },
) {
  return {
    hostedStripeEvent: {
      findUnique: vi.fn().mockResolvedValue(storedEvent),
    },
  };
}
