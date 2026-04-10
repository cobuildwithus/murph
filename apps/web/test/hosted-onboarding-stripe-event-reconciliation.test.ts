import { HostedStripeEventStatus } from "@prisma/client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyStripeCheckoutCompleted: vi.fn(),
  applyStripeCheckoutExpired: vi.fn(),
  applyStripeDisputeUpdated: vi.fn(),
  applyStripeInvoicePaid: vi.fn(),
  applyStripeInvoicePaymentFailed: vi.fn(),
  applyStripeRefundCreated: vi.fn(),
  applyStripeSubscriptionUpdated: vi.fn(),
  drainHostedRevnetIssuanceSubmissionQueue: vi.fn(),
  provisionManagedUserCryptoInHostedExecution: vi.fn(),
  resolveStripeCustomerContext: vi.fn(),
  stripe: {
    events: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeCheckoutCompleted: mocks.applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired: mocks.applyStripeCheckoutExpired,
  applyStripeDisputeUpdated: mocks.applyStripeDisputeUpdated,
  applyStripeInvoicePaid: mocks.applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed: mocks.applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated: mocks.applyStripeRefundCreated,
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    resolveStripeCustomerContext: mocks.resolveStripeCustomerContext,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeApi: () => mocks.stripe,
  };
});

vi.mock("@/src/lib/hosted-execution/control", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/control")
  >("@/src/lib/hosted-execution/control");

  return {
    ...actual,
    provisionManagedUserCryptoInHostedExecution:
      mocks.provisionManagedUserCryptoInHostedExecution,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-revnet-issuance", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-revnet-issuance")
  >("@/src/lib/hosted-onboarding/stripe-revnet-issuance");

  return {
    ...actual,
    drainHostedRevnetIssuanceSubmissionQueue: mocks.drainHostedRevnetIssuanceSubmissionQueue,
  };
});

import {
  reconcileHostedStripeEventById,
  recordHostedStripeEvent,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";

describe("hosted Stripe event reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      hostedExecutionEventId: null,
    });
    mocks.applyStripeCheckoutExpired.mockResolvedValue(undefined);
    mocks.applyStripeDisputeUpdated.mockResolvedValue(undefined);
    mocks.applyStripeInvoicePaid.mockResolvedValue({
      activatedMemberId: "member_123",
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: "dispatch_123",
      postCommitProvisionUserId: "member_123",
    });
    mocks.applyStripeInvoicePaymentFailed.mockResolvedValue(undefined);
    mocks.applyStripeRefundCreated.mockResolvedValue(undefined);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue(undefined);
    mocks.resolveStripeCustomerContext.mockResolvedValue({
      customerId: null,
    });
    mocks.drainHostedRevnetIssuanceSubmissionQueue.mockResolvedValue([]);
    mocks.provisionManagedUserCryptoInHostedExecution.mockResolvedValue(undefined);
  });

  it("stores only minimal Stripe receipt state when recording an event", async () => {
    const prisma = createStripeEventPrismaHarness();

    await expect(
      recordHostedStripeEvent({
        event: makeInvoicePaidEvent(),
        prisma: prisma.client as never,
      }),
    ).resolves.toEqual({
      duplicate: false,
      type: "invoice.paid",
    });

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 0,
      eventId: "evt_invoice_paid_123",
      status: HostedStripeEventStatus.pending,
      type: "invoice.paid",
    }));
    expect(prisma.rows[0]).not.toHaveProperty("payloadJson");
    expect(prisma.rows[0]).not.toHaveProperty("customerId");
    expect(prisma.rows[0]).not.toHaveProperty("subscriptionId");
  });

  it("retrieves the live Stripe event during reconciliation and marks the receipt completed", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client as never,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client as never,
      }),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      createdOrUpdatedRevnetIssuance: false,
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: "dispatch_123",
      status: "completed",
    });

    expect(mocks.stripe.events.retrieve).toHaveBeenCalledWith("evt_invoice_paid_123");
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: "evt_invoice_paid_123",
        sourceType: "stripe.invoice.paid",
      }),
      expect.anything(),
    );
    expect(mocks.provisionManagedUserCryptoInHostedExecution).toHaveBeenCalledWith("member_123");
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: "evt_invoice_paid_123",
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
  });

  it("routes checkout completion through the live Stripe event without activating access", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client as never,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client as never,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.checkout.session.completed",
      }),
      expect.anything(),
    );
  });

  it("routes subscription updates through the live Stripe event", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client as never,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client as never,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.customer.subscription.updated",
      }),
      expect.anything(),
    );
  });

  it("resolves refund customer context from the live Stripe event", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeRefundCreatedEvent();
    mocks.resolveStripeCustomerContext.mockResolvedValue({
      customerId: "cus_refund",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client as never,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client as never,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.resolveStripeCustomerContext).toHaveBeenCalledWith({
      chargeId: "ch_refund",
      paymentIntentId: "pi_refund",
    });
    expect(mocks.applyStripeRefundCreated).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.refund.created",
      }),
      expect.anything(),
      "cus_refund",
    );
  });

  it("marks the receipt failed when Stripe event retrieval fails", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    mocks.stripe.events.retrieve.mockRejectedValue(new Error("Stripe unavailable"));

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client as never,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client as never,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: "evt_invoice_paid_123",
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
  });

  it("marks the receipt failed when post-commit provisioning fails", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.provisionManagedUserCryptoInHostedExecution.mockRejectedValue(
      new Error("Cloudflare provisioning failed"),
    );

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client as never,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client as never,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledTimes(1);
    expect(mocks.provisionManagedUserCryptoInHostedExecution).toHaveBeenCalledWith("member_123");
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: "evt_invoice_paid_123",
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
  });
});

function makeInvoicePaidEvent(): Stripe.Event {
  return {
    created: 1774708800,
    data: {
      object: {
        amount_paid: 2000,
        charge: "ch_123",
        currency: "usd",
        customer: "cus_123",
        id: "in_123",
        payment_intent: "pi_123",
        subscription: "sub_123",
      },
    },
    id: "evt_invoice_paid_123",
    type: "invoice.paid",
  } as unknown as Stripe.Event;
}

function makeCheckoutCompletedEvent(): Stripe.Event {
  return {
    created: 1774708801,
    data: {
      object: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        id: "cs_checkout_123",
        metadata: {
          memberId: "member_123",
        },
        subscription: "sub_checkout_123",
      },
    },
    id: "evt_checkout_completed_123",
    type: "checkout.session.completed",
  } as unknown as Stripe.Event;
}

function makeSubscriptionUpdatedEvent(): Stripe.Event {
  return {
    created: 1774708802,
    data: {
      object: {
        customer: "cus_subscription",
        id: "sub_123",
        metadata: {
          memberId: "member_123",
        },
        status: "past_due",
      },
    },
    id: "evt_subscription_updated_123",
    type: "customer.subscription.updated",
  } as unknown as Stripe.Event;
}

function makeRefundCreatedEvent(): Stripe.Event {
  return {
    created: 1774708803,
    data: {
      object: {
        charge: "ch_refund",
        id: "re_123",
        payment_intent: "pi_refund",
      },
    },
    id: "evt_refund_created_123",
    type: "refund.created",
  } as unknown as Stripe.Event;
}

function createStripeEventPrismaHarness() {
  const rows: MutableStripeEventRow[] = [];

  const client: StripeEventPrismaHarnessClient = {
    $transaction: async <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => callback(client),
    hostedStripeEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: MutableStripeEventRow = {
          attemptCount: data.attemptCount as number,
          claimExpiresAt: null,
          createdAt: new Date(),
          eventId: data.eventId as string,
          lastErrorCode: null,
          lastErrorMessage: null,
          nextAttemptAt: data.nextAttemptAt as Date,
          processedAt: null,
          receivedAt: data.receivedAt as Date,
          status: data.status as HostedStripeEventStatus,
          stripeCreatedAt: data.stripeCreatedAt as Date,
          type: data.type as string,
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) =>
        rows.find((row) => row.eventId === where.eventId) ?? null,
      ),
      update: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: { eventId: string } }) => {
        const row = rows.find((candidate) => candidate.eventId === where.eventId);

        if (!row) {
          throw new Error(`Missing stripe event ${where.eventId}`);
        }

        Object.assign(row, data, {
          updatedAt: new Date(),
        });
        return row;
      }),
      updateMany: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: StripeEventWhere }) => {
        const row = rows.find((candidate) => matchesStripeEventWhere(candidate, where));

        if (!row) {
          return { count: 0 };
        }

        row.attemptCount += (data.attemptCount as { increment: number }).increment;
        row.claimExpiresAt = data.claimExpiresAt as Date;
        row.lastErrorCode = data.lastErrorCode as string | null;
        row.lastErrorMessage = data.lastErrorMessage as string | null;
        row.nextAttemptAt = data.nextAttemptAt as Date;
        row.status = data.status as HostedStripeEventStatus;
        row.updatedAt = new Date();
        return { count: 1 };
      }),
    },
  };

  return {
    client,
    rows,
  };
}

function matchesStripeEventWhere(row: MutableStripeEventRow, where: StripeEventWhere): boolean {
  if (where.eventId && row.eventId !== where.eventId) {
    return false;
  }

  if (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime()) {
    return false;
  }

  if (!where.OR) {
    return true;
  }

  return where.OR.some((condition) => {
    if ("claimExpiresAt" in condition) {
      return row.status === HostedStripeEventStatus.processing
        && row.claimExpiresAt !== null
        && condition.claimExpiresAt?.lte instanceof Date
        && row.claimExpiresAt.getTime() <= condition.claimExpiresAt.lte.getTime();
    }

    const retryCondition = condition as {
      nextAttemptAt?: {
        lte: Date;
      };
      status: "failed" | "pending";
    };

    return row.status === retryCondition.status
      && retryCondition.nextAttemptAt?.lte instanceof Date
      && row.nextAttemptAt.getTime() <= retryCondition.nextAttemptAt.lte.getTime();
  });
}

type MutableStripeEventRow = {
  attemptCount: number;
  claimExpiresAt: Date | null;
  createdAt: Date;
  eventId: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextAttemptAt: Date;
  processedAt: Date | null;
  receivedAt: Date;
  status: HostedStripeEventStatus;
  stripeCreatedAt: Date;
  type: string;
  updatedAt: Date;
};

type StripeEventWhere = {
  eventId?: string;
  updatedAt?: Date;
  OR?: Array<
    | {
        claimExpiresAt?: {
          lte: Date;
        };
        status: "processing";
      }
    | {
        nextAttemptAt?: {
          lte: Date;
        };
        status:
          | "pending"
          | "failed";
      }
  >;
};

type StripeEventPrismaHarnessClient = {
  $transaction: <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => Promise<T>;
  hostedStripeEvent: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};
