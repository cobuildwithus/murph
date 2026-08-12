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
        findMany: vi.fn().mockResolvedValue([{
          dedupeKey: "member.activated:stripe.invoice.paid:member_123:invoice:in_123",
          id: "mailbox_item_activation_123",
          userId: "member_123",
        }]),
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
    expect(prisma.hostedMailboxItem.findMany).toHaveBeenCalledWith({
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

  it.each([
    {
      eventObject: {
        id: "cs_legacy_trial",
        subscription: "sub_legacy_trial",
      },
      eventType: "checkout.session.completed",
    },
    {
      eventObject: {
        id: "sub_legacy_trial",
      },
      eventType: "customer.subscription.trial_will_end",
    },
  ])("rederives mixed-version legacy-trial activation for $eventType", async ({
    eventObject,
    eventType,
  }) => {
    const findMany = vi.fn(async (args: {
      where: {
        dedupeKey: {
          endsWith: string;
          startsWith: string;
        };
      };
    }) => {
      if (
        args.where.dedupeKey.endsWith === ":evt_legacy_trial"
        && args.where.dedupeKey.startsWith
          === "member.activated:hosted.legacy_trial.converted_to_starter:"
      ) {
        return [{
          dedupeKey:
            "member.activated:hosted.legacy_trial.converted_to_starter:member_legacy_trial:evt_legacy_trial",
          id: "mailbox_item_legacy_trial",
          userId: "member_legacy_trial",
        }];
      }

      return [];
    });
    const prisma = createPrisma({
      hostedMailboxItem: { findMany },
      hostedStripeEvent: {
        findUnique: vi.fn().mockResolvedValue({
          claimExpiresAt: null,
          nextAttemptAt: new Date("2026-04-23T00:00:00.000Z"),
          status: HostedStripeEventStatus.completed,
          type: eventType,
          updatedAt: new Date("2026-04-23T00:00:00.000Z"),
        }),
      },
    });
    mocks.reconcileHostedStripeEventById.mockResolvedValue(null);
    mocks.stripeEventsRetrieve.mockResolvedValue({
      data: {
        object: eventObject,
      },
      id: "evt_legacy_trial",
      type: eventType,
    });

    await expect(processRecordedHostedStripeWebhookEvent({
      eventId: "evt_legacy_trial",
      prisma: prisma as never,
      timeoutMs: 5_000,
    })).resolves.toEqual({
      accepted: true,
      required: true,
    });

    expect(findMany).toHaveBeenCalledWith({
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
          endsWith: ":evt_legacy_trial",
          startsWith:
            "member.activated:hosted.legacy_trial.converted_to_starter:",
        },
        kind: "member.activated",
      },
    });
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .toHaveBeenCalledWith({
        hostedExecutionEventId:
          "member.activated:hosted.legacy_trial.converted_to_starter:member_legacy_trial:evt_legacy_trial",
        mailboxItemId: "mailbox_item_legacy_trial",
        memberId: "member_legacy_trial",
        prisma,
        source: "stripe.webhook.activation",
        timeoutMs: 5_000,
      });
  });

  it("reads completed activation pointers from the Stripe receipt without rescanning", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      dedupeKey:
        "member.activated:stripe.invoice.paid:member_123:evt_123",
      id: "mailbox_item_activation_123",
      userId: "member_123",
    }]);
    const prisma = createPrisma({
      hostedMailboxItem: { findMany },
      hostedStripeEvent: {
        findUnique: vi.fn().mockResolvedValue({
          activationResultJson: {
            activationMailboxItemIds: ["mailbox_item_activation_123"],
            schema: "hosted.stripe.activation-result.v1",
          },
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
    })).resolves.toEqual({ accepted: true, required: true });

    expect(findMany).toHaveBeenCalledWith({
      select: { dedupeKey: true, id: true, userId: true },
      where: {
        id: { in: ["mailbox_item_activation_123"] },
        kind: "member.activated",
      },
    });
    expect(prisma.hostedStripeEvent.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.stripeEventsRetrieve).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .toHaveBeenCalledWith(expect.objectContaining({
        hostedExecutionEventId:
          "member.activated:stripe.invoice.paid:member_123:evt_123",
        mailboxItemId: "mailbox_item_activation_123",
        memberId: "member_123",
      }));
  });

  it("replays the maximum current Family activation set in receipt order without fanout", async () => {
    const activationPointers = Array.from({ length: 6 }, (_, index) => {
      const ordinal = index + 1;
      return {
        dedupeKey: `member.activated:family:${ordinal}`,
        id: `mailbox_family_${ordinal}`,
        userId: `member_family_${ordinal}`,
      };
    });
    const findMany = vi.fn().mockResolvedValue([...activationPointers].reverse());
    const prisma = createPrisma({
      hostedMailboxItem: { findMany },
      hostedStripeEvent: {
        findUnique: vi.fn().mockResolvedValue({
          activationResultJson: {
            activationMailboxItemIds: activationPointers.map((pointer) => pointer.id),
            schema: "hosted.stripe.activation-result.v1",
          },
          claimExpiresAt: null,
          nextAttemptAt: new Date("2026-04-23T00:00:00.000Z"),
          status: HostedStripeEventStatus.completed,
          type: "customer.subscription.updated",
          updatedAt: new Date("2026-04-23T00:00:00.000Z"),
        }),
      },
    });
    let activeWakeCalls = 0;
    let peakWakeCalls = 0;
    mocks.reconcileHostedStripeEventById.mockResolvedValue(null);
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult.mockImplementation(
      async () => {
        activeWakeCalls += 1;
        peakWakeCalls = Math.max(peakWakeCalls, activeWakeCalls);
        await Promise.resolve();
        activeWakeCalls -= 1;
        return {
          accepted: true,
          configured: true,
          errorCode: null,
          mailboxItemIdPresent: true,
          signalAccepted: true,
          workflowIdPresent: true,
        };
      },
    );

    await expect(processRecordedHostedStripeWebhookEvent({
      eventId: "evt_family_current",
      prisma: prisma as never,
      timeoutMs: 5_000,
    })).resolves.toEqual({ accepted: true, required: true });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      select: { dedupeKey: true, id: true, userId: true },
      where: {
        id: { in: activationPointers.map((pointer) => pointer.id) },
        kind: "member.activated",
      },
    });
    expect(mocks.stripeEventsRetrieve).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .toHaveBeenCalledTimes(activationPointers.length);
    expect(peakWakeCalls).toBe(1);
    for (const [index, activation] of activationPointers.entries()) {
      expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
        .toHaveBeenNthCalledWith(index + 1, {
          hostedExecutionEventId: activation.dedupeKey,
          mailboxItemId: activation.id,
          memberId: activation.userId,
          prisma,
          source: "stripe.webhook.activation",
          timeoutMs: 5_000,
        });
    }
  });

  it("preserves completed receipt convergence when account deletion removed a pointed mailbox row", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = createPrisma({
      hostedMailboxItem: { findMany },
      hostedStripeEvent: {
        findUnique: vi.fn().mockResolvedValue({
          activationResultJson: {
            activationMailboxItemIds: ["mailbox_item_deleted_member"],
            schema: "hosted.stripe.activation-result.v1",
          },
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
    })).resolves.toEqual({ accepted: true, required: false });

    expect(findMany).toHaveBeenCalledWith({
      select: { dedupeKey: true, id: true, userId: true },
      where: {
        id: { in: ["mailbox_item_deleted_member"] },
        kind: "member.activated",
      },
    });
    expect(prisma.hostedStripeEvent.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.stripeEventsRetrieve).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .not.toHaveBeenCalled();
  });

  it.each([
    {
      activationMailboxItemIds: ["mailbox_duplicate", "mailbox_duplicate"],
      schema: "hosted.stripe.activation-result.v1",
    },
    {
      activationMailboxItemIds: Array.from(
        { length: 7 },
        (_, index) => `mailbox_${index}`,
      ),
      schema: "hosted.stripe.activation-result.v1",
    },
    {
      activationMailboxItemIds: [],
      schema: "hosted.stripe.activation-result.v2",
    },
    {
      activationMailboxItemIds: [""],
      schema: "hosted.stripe.activation-result.v1",
    },
  ])("fails closed on malformed completed activation pointers", async (
    activationResultJson,
  ) => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = createPrisma({
      hostedMailboxItem: { findMany },
      hostedStripeEvent: {
        findUnique: vi.fn().mockResolvedValue({
          activationResultJson,
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
    })).rejects.toThrow(/Stored Stripe activation result/u);

    expect(findMany).not.toHaveBeenCalled();
    expect(mocks.stripeEventsRetrieve).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .not.toHaveBeenCalled();
  });

  it("rederives every completed family activation target for runtime wake retries", async () => {
    const prisma = createPrisma({
      hostedMailboxItem: {
        findMany: vi.fn(async (args: { where: { dedupeKey: { endsWith: string } } }) => {
          if (args.where.dedupeKey.endsWith === ":family-subscription:sub_family") {
            return [
              {
                dedupeKey:
                  "member.activated:hosted.family.sponsorship:member_owner:family-subscription:sub_family",
                id: "mailbox_item_family_owner",
                userId: "member_owner",
              },
              {
                dedupeKey:
                  "member.activated:hosted.family.sponsorship:member_child:family-subscription:sub_family",
                id: "mailbox_item_family_child",
                userId: "member_child",
              },
            ];
          }

          return [];
        }),
      },
      hostedStripeEvent: {
        findUnique: vi.fn().mockResolvedValue({
          claimExpiresAt: null,
          nextAttemptAt: new Date("2026-04-23T00:00:00.000Z"),
          status: HostedStripeEventStatus.completed,
          type: "customer.subscription.updated",
          updatedAt: new Date("2026-04-23T00:00:00.000Z"),
        }),
      },
    });
    mocks.reconcileHostedStripeEventById.mockResolvedValue(null);
    mocks.stripeEventsRetrieve.mockResolvedValue({
      data: {
        object: {
          id: "sub_family",
        },
      },
      id: "evt_family",
      type: "customer.subscription.updated",
    });

    await expect(processRecordedHostedStripeWebhookEvent({
      eventId: "evt_family",
      prisma: prisma as never,
      timeoutMs: 5_000,
    })).resolves.toEqual({
      accepted: true,
      required: true,
    });

    expect(prisma.hostedMailboxItem.findMany).toHaveBeenCalledWith({
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
          endsWith: ":family-subscription:sub_family",
          startsWith: "member.activated:hosted.family.sponsorship:",
        },
        kind: "member.activated",
      },
    });
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenNthCalledWith(
      1,
      {
        hostedExecutionEventId:
          "member.activated:hosted.family.sponsorship:member_owner:family-subscription:sub_family",
        mailboxItemId: "mailbox_item_family_owner",
        memberId: "member_owner",
        prisma,
        source: "stripe.webhook.activation",
        timeoutMs: 5_000,
      },
    );
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenNthCalledWith(
      2,
      {
        hostedExecutionEventId:
          "member.activated:hosted.family.sponsorship:member_child:family-subscription:sub_family",
        mailboxItemId: "mailbox_item_family_child",
        memberId: "member_child",
        prisma,
        source: "stripe.webhook.activation",
        timeoutMs: 5_000,
      },
    );
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

  it("signals every activated family member from one Stripe reconciliation", async () => {
    await expect(signalHostedStripeWebhookActivationRuntimeWake({
      activatedMemberId: "member_owner",
      activatedMembers: [
        {
          activatedMemberId: "member_owner",
          hostedExecutionEventId: "member.activated:family:owner",
        },
        {
          activatedMemberId: "member_child",
          hostedExecutionEventId: "member.activated:family:child",
        },
      ],
      eventId: "evt_family",
      eventType: "customer.subscription.updated",
      hostedExecutionEventId: "member.activated:family:owner",
      timeoutMs: 5_000,
    })).resolves.toEqual({
      accepted: true,
      required: true,
    });

    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenNthCalledWith(
      1,
      {
        hostedExecutionEventId: "member.activated:family:owner",
        mailboxItemId: null,
        memberId: "member_owner",
        prisma: undefined,
        source: "stripe.webhook.activation",
        timeoutMs: 5_000,
      },
    );
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenNthCalledWith(
      2,
      {
        hostedExecutionEventId: "member.activated:family:child",
        mailboxItemId: null,
        memberId: "member_child",
        prisma: undefined,
        source: "stripe.webhook.activation",
        timeoutMs: 5_000,
      },
    );
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
	      findMany: ReturnType<typeof vi.fn>;
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
	      findMany: vi.fn().mockResolvedValue([]),
	    },
    hostedStripeEvent: {
      findUnique: vi.fn().mockResolvedValue(storedEvent),
    },
  };
}
