import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  drainHostedRevnetIssuanceSubmissionQueue: vi.fn(),
  nudgeHostedRunBestEffort: vi.fn(),
  reconcileHostedStripeEventById: vi.fn(),
  recordHostedStripeEvent: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ingress/control", () => ({
  nudgeHostedRunBestEffort: mocks.nudgeHostedRunBestEffort,
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
  reconcileHostedStripeEventById: mocks.reconcileHostedStripeEventById,
  recordHostedStripeEvent: mocks.recordHostedStripeEvent,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-revnet-issuance", () => ({
  drainHostedRevnetIssuanceSubmissionQueue: mocks.drainHostedRevnetIssuanceSubmissionQueue,
}));

import { handleHostedStripeWebhook } from "@/src/lib/hosted-onboarding/webhook-service-stripe";

describe("hosted Stripe webhook service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.constructEvent.mockReturnValue(makeStripeEvent());
    mocks.drainHostedRevnetIssuanceSubmissionQueue.mockResolvedValue([]);
    mocks.nudgeHostedRunBestEffort.mockResolvedValue("outbox");
    mocks.reconcileHostedStripeEventById.mockResolvedValue({
      activatedMemberId: "member_123",
      createdOrUpdatedRevnetIssuance: false,
      eventId: "evt_123",
      hostedExecutionEventId: "dispatch_123",
      status: "completed",
    });
    mocks.recordHostedStripeEvent.mockResolvedValue({
      duplicate: false,
      type: "invoice.paid",
    });
  });

  it("records the event first and defers reconciliation when defer is available", async () => {
    const prisma = {
      __tag: "prisma",
    };
    let deferredDrain: (() => Promise<void>) | null = null;

    await expect(handleHostedStripeWebhook({
      defer: vi.fn(async (drain) => {
        deferredDrain = drain;
      }),
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
    expect(deferredDrain).not.toBeNull();
    expect(mocks.reconcileHostedStripeEventById).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunBestEffort).not.toHaveBeenCalled();

    await deferredDrain?.();

    expect(mocks.reconcileHostedStripeEventById).toHaveBeenCalledWith({
      eventId: "evt_123",
      prisma,
    });
    expect(mocks.nudgeHostedRunBestEffort).toHaveBeenCalledWith({
      context: "stripe.webhook",
      eventId: "dispatch_123",
      prisma,
      userId: "member_123",
    });
  });

  it("reconciles inline when defer is unavailable", async () => {
    const prisma = {
      __tag: "prisma",
    };

    await expect(handleHostedStripeWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: "sig_test_123",
    })).resolves.toEqual({
      ok: true,
      type: "invoice.paid",
    });

    expect(mocks.reconcileHostedStripeEventById).toHaveBeenCalledWith({
      eventId: "evt_123",
      prisma,
    });
    expect(mocks.nudgeHostedRunBestEffort).toHaveBeenCalledWith({
      context: "stripe.webhook",
      eventId: "dispatch_123",
      prisma,
      userId: "member_123",
    });
  });
});

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
