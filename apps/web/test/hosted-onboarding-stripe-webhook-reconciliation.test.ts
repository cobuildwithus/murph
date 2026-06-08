import { HostedStripeEventStatus } from "@prisma/client";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  reconcileHostedStripeEventById: vi.fn(),
  signalHostedMemberActivationRuntimeWakeBestEffortResult: vi.fn(),
  stripeEventsRetrieve: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  reconcileHostedStripeEventById: mocks.reconcileHostedStripeEventById,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation-runtime-wake", () => ({
  signalHostedMemberActivationRuntimeWakeBestEffortResult:
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: () => ({
    events: {
      retrieve: mocks.stripeEventsRetrieve,
    },
  }),
}));

import {
  processRecordedHostedStripeWebhookEvent,
  reconcileRecordedHostedStripeWebhookEvent,
  signalHostedStripeWebhookActivationRuntimeWake,
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
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult.mockResolvedValue({
      accepted: true,
      configured: true,
      errorCode: null,
      mailboxItemIdPresent: true,
      signalAccepted: true,
      workflowIdPresent: true,
    });
    mocks.stripeEventsRetrieve.mockResolvedValue({
      data: {
        object: {
          id: "in_123",
        },
      },
      id: "evt_123",
      type: "invoice.paid",
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
      hostedExecutionMailboxItemId: null,
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

  it("uses the stored retry timestamp when the workflow finds a not-yet-due receipt", async () => {
    mocks.reconcileHostedStripeEventById.mockResolvedValue(null);

    await expect(reconcileRecordedHostedStripeWebhookEvent({
      eventId: "evt_123",
      prisma: createPrisma({
        claimExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + 15 * 60_000),
        status: HostedStripeEventStatus.failed,
        type: "invoice.paid",
        updatedAt: new Date("2026-04-23T00:00:00.000Z"),
      }) as never,
    })).rejects.toMatchObject({
      code: "STRIPE_WEBHOOK_RECONCILE_FAILED",
      details: {
        eventId: "evt_123",
        stripeEventStatus: HostedStripeEventStatus.failed,
        workflowRetryAfter: expect.stringMatching(/^\d+s$/u),
      },
      retryable: true,
    });
  });

  it("marks poisoned receipts fatal for Workflow retries", async () => {
    mocks.reconcileHostedStripeEventById.mockResolvedValue(null);

    await expect(reconcileRecordedHostedStripeWebhookEvent({
      eventId: "evt_123",
      prisma: createPrisma({
        claimExpiresAt: null,
        nextAttemptAt: new Date("2026-04-23T00:00:00.000Z"),
        status: HostedStripeEventStatus.poisoned,
        type: "invoice.paid",
        updatedAt: new Date("2026-04-23T00:00:00.000Z"),
      }) as never,
    })).rejects.toMatchObject({
      code: "STRIPE_WEBHOOK_RECONCILE_POISONED",
      retryable: false,
    });
  });

  it("rederives completed activation pointers from the mailbox for Temporal runtime wake retries", async () => {
    const prisma = createPrisma({
      hostedMailboxItem: {
        findFirst: vi.fn().mockResolvedValue({
          dedupeKey: "member.activated:stripe.invoice.paid:member_123:invoice:in_123",
          id: "mailbox_item_activation_123",
          userId: "member_123",
        }),
      },
      hostedStripeEvent: {
        findUnique: vi.fn().mockResolvedValue({
          claimExpiresAt: null,
          nextAttemptAt: new Date("2026-04-23T00:00:00.000Z"),
          status: HostedStripeEventStatus.completed,
          type: "invoice.paid",
          updatedAt: new Date("2026-04-23T00:00:00.000Z"),
        }),
      },
    });
    mocks.reconcileHostedStripeEventById.mockResolvedValue(null);

    await expect(processRecordedHostedStripeWebhookEvent({
      eventId: "evt_123",
      prisma: prisma as never,
      timeoutMs: 5_000,
    })).resolves.toEqual({
      accepted: true,
      required: true,
    });

    expect(mocks.stripeEventsRetrieve).toHaveBeenCalledWith("evt_123");
    expect(prisma.hostedMailboxItem.findFirst).toHaveBeenCalledWith({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        dedupeKey: true,
        id: true,
        userId: true,
      },
      where: {
        dedupeKey: {
          endsWith: ":invoice:in_123",
          startsWith: "member.activated:stripe.invoice.paid:",
        },
        kind: "member.activated",
      },
    });
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenCalledWith({
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:invoice:in_123",
      mailboxItemId: "mailbox_item_activation_123",
      memberId: "member_123",
      prisma,
      source: "stripe.webhook.activation",
      timeoutMs: 5_000,
    });
  });

  it("signals activated members without requiring member ids in workflow input", async () => {
    await expect(signalHostedStripeWebhookActivationRuntimeWake({
      activatedMemberId: "member_123",
      eventId: "evt_123",
      eventType: "invoice.paid",
      hostedExecutionEventId: "member.activated:member_123:stripe:evt_123",
      timeoutMs: 5_000,
    })).resolves.toEqual({
      accepted: true,
      required: true,
    });

    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenCalledWith({
      hostedExecutionEventId: "member.activated:member_123:stripe:evt_123",
      mailboxItemId: null,
      memberId: "member_123",
      prisma: undefined,
      source: "stripe.webhook.activation",
      timeoutMs: 5_000,
    });
  });

  it("does not signal the runtime when reconciliation did not activate a member", async () => {
    await expect(signalHostedStripeWebhookActivationRuntimeWake({
      activatedMemberId: null,
      eventId: "evt_123",
      eventType: "customer.subscription.updated",
      hostedExecutionEventId: null,
    })).resolves.toEqual({
      accepted: true,
      required: false,
    });

    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
  });
});

function createPrisma(
  storedEvent: {
    claimExpiresAt: Date | null;
    nextAttemptAt: Date;
    status: HostedStripeEventStatus;
    type: string;
    updatedAt: Date;
  } | null | {
    hostedMailboxItem: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    hostedStripeEvent: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  } = {
    claimExpiresAt: null,
    nextAttemptAt: new Date("2026-04-23T00:00:00.000Z"),
    status: HostedStripeEventStatus.pending,
    type: "invoice.paid",
    updatedAt: new Date("2026-04-23T00:00:00.000Z"),
  },
) {
  if (
    storedEvent
    && "hostedStripeEvent" in storedEvent
    && "hostedMailboxItem" in storedEvent
  ) {
    return storedEvent;
  }

  return {
    hostedMailboxItem: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    hostedStripeEvent: {
      findUnique: vi.fn().mockResolvedValue(storedEvent),
    },
  };
}
