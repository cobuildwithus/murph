import { describe, expect, it, vi } from "vitest";

const familyMocks = vi.hoisted(() => ({
  readHostedMemberFamilyBillingClaim: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedMemberFamilyBillingClaim:
    familyMocks.readHostedMemberFamilyBillingClaim,
}));

import { createHostedStripeSubscriptionLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedCheckoutSubscriptionCleanupCandidate,
  executeHostedCheckoutSubscriptionCleanup,
} from "@/src/lib/hosted-onboarding/stripe-checkout-subscription-cleanup";

describe("hosted Checkout subscription cleanup", () => {
  it("cancels and refunds an exact loser after the member and billing ref are gone", async () => {
    const harness = createCleanupHarness({
      memberBillingRefMissing: true,
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.billingRefFindUnique).toHaveBeenCalledOnce();
    expect(await harness.billingRefFindUnique.mock.results[0]?.value).toBeNull();
    expect(harness.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_loser",
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: 5_000,
      }),
    );
    expect(harness.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 800,
        payment_intent: "pi_checkout",
      }),
      expect.any(Object),
    );
  });

  it("checks superseded ownership through the narrow subscription blind index", async () => {
    const harness = createCleanupHarness();

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.billingRefFindUnique).toHaveBeenCalledWith({
      select: {
        stripeSubscriptionLookupKey: true,
      },
      where: {
        memberId: "member_123",
      },
    });
    expect(harness.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_loser",
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: 5_000,
      }),
    );
    expect(harness.stripe.invoices.retrieve).toHaveBeenCalledWith(
      "in_checkout",
      {},
      expect.any(Object),
    );
    expect(harness.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 800,
        payment_intent: "pi_checkout",
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(
          "hosted-checkout-cleanup-refund:cs_checkout:in_checkout:pi_checkout:",
        ),
      }),
    );
  });

  it("never cancels a candidate that became the member's authoritative subscription", async () => {
    const harness = createCleanupHarness({
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_loser"),
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_OWNERSHIP_CHANGED",
      retryable: true,
    });

    expect(harness.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      familySubscriptionOwnerGroupIds: [],
      label: "another member",
      memberSubscriptionOwnerIds: ["member_other"],
    },
    {
      familySubscriptionOwnerGroupIds: ["family_other"],
      label: "a Family group",
      memberSubscriptionOwnerIds: [],
    },
    {
      familySubscriptionOwnerGroupIds: ["family_other"],
      label: "ambiguous member and Family owners",
      memberSubscriptionOwnerIds: ["member_other"],
    },
  ])("never mutates a loser subscription owned by $label", async ({
    familySubscriptionOwnerGroupIds,
    memberSubscriptionOwnerIds,
  }) => {
    const harness = createCleanupHarness({
      familySubscriptionOwnerGroupIds,
      memberSubscriptionOwnerIds,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_OWNERSHIP_CHANGED",
      retryable: true,
    });

    expect(harness.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it("fails retryably without provider mutation when orphan cleanup is already running", async () => {
    const harness = createCleanupHarness({
      advisoryLockAcquired: false,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_OWNER_BUSY",
      retryable: true,
    });

    expect(harness.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("deletes a distinct unowned Customer after canceling and refunding a first-time loser", async () => {
    const harness = createCleanupHarness({
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_winner"),
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.customers.del).toHaveBeenCalledWith(
      "cus_loser",
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: 5_000,
      }),
    );
  });

  it("preserves a Checkout Customer that another local billing owner references", async () => {
    const harness = createCleanupHarness({
      memberCustomerOwner: true,
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.list).not.toHaveBeenCalled();
  });

  it("rotates the refund retry key only after terminal failed-refund proof", async () => {
    const failedRefund = {
      amount: 800,
      charge: "ch_checkout",
      id: "re_failed",
      payment_intent: "pi_checkout",
      status: "failed",
    };
    const harness = createCleanupHarness();
    harness.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription("active"))
      .mockResolvedValueOnce(makeSubscription("canceled"));
    harness.stripe.refunds.list
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [failedRefund],
        has_more: false,
      });
    harness.stripe.refunds.create
      .mockResolvedValueOnce(failedRefund)
      .mockResolvedValueOnce({
        ...failedRefund,
        id: "re_succeeded",
        status: "succeeded",
      });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_REFUND_FAILED",
    });
    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).resolves.toBeUndefined();

    const firstOptions = harness.stripe.refunds.create.mock.calls[0]?.[1];
    const secondOptions = harness.stripe.refunds.create.mock.calls[1]?.[1];
    expect(firstOptions?.idempotencyKey).toEqual(expect.any(String));
    expect(secondOptions?.idempotencyKey).toEqual(expect.any(String));
    expect(secondOptions?.idempotencyKey).not.toBe(firstOptions?.idempotencyKey);
  });

  it("fails closed instead of partially reconciling paginated refunds", async () => {
    const harness = createCleanupHarness();
    harness.stripe.refunds.list.mockResolvedValueOnce({
      data: [],
      has_more: true,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    });

    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("validates and refunds every paid invoice allocation before retaining cancellation", async () => {
    const harness = createCleanupHarness();
    harness.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [
        {
          amount_paid: 300,
          id: "ip_checkout_a",
          invoice: "in_checkout",
          payment: {
            payment_intent: "pi_checkout_a",
            type: "payment_intent",
          },
          status: "paid",
        },
        {
          amount_paid: 500,
          id: "ip_checkout_b",
          invoice: "in_checkout",
          payment: {
            payment_intent: "pi_checkout_b",
            type: "payment_intent",
          },
          status: "paid",
        },
      ],
      has_more: false,
    });
    harness.stripe.refunds.list
      .mockResolvedValueOnce({ data: [], has_more: false })
      .mockResolvedValueOnce({ data: [], has_more: false });
    harness.stripe.refunds.create.mockImplementation(async (params: {
      amount: number;
      payment_intent?: string;
    }) => ({
      amount: params.amount,
      id: `re_${String(params.payment_intent)}`,
      payment_intent: params.payment_intent,
      status: "succeeded",
    }));

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.refunds.create).toHaveBeenCalledTimes(2);
    expect(harness.stripe.refunds.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        amount: 300,
        payment_intent: "pi_checkout_a",
      }),
      expect.any(Object),
    );
    expect(harness.stripe.refunds.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        amount: 500,
        payment_intent: "pi_checkout_b",
      }),
      expect.any(Object),
    );
    expect(
      harness.stripe.refunds.list.mock.invocationCallOrder[1],
    ).toBeLessThan(
      harness.stripe.subscriptions.cancel.mock.invocationCallOrder[0]!,
    );
  });

  it("fails before cancellation for an unsupported invoice payment allocation", async () => {
    const harness = createCleanupHarness();
    harness.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [{
        amount_paid: 800,
        id: "ip_checkout_record",
        invoice: "in_checkout",
        payment: {
          payment_record: "pyr_checkout",
          type: "payment_record",
        },
        status: "paid",
      }],
      has_more: false,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    });

    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("fails before cancellation when paid allocations exceed the owner-lock budget", async () => {
    const harness = createCleanupHarness();
    harness.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: Array.from({ length: 5 }, (_, index) => ({
        amount_paid: 160,
        id: `ip_checkout_${index}`,
        invoice: "in_checkout",
        payment: {
          payment_intent: `pi_checkout_${index}`,
          type: "payment_intent",
        },
        status: "paid",
      })),
      has_more: false,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    });

    expect(harness.stripe.refunds.list).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("locks the Family owner before the sponsored member and rechecks the exact sponsorship", async () => {
    const harness = createCleanupHarness({
      reason: "family_sponsored",
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    const lockedMemberIds = harness.queryRaw.mock.calls
      .filter(([strings]) => Array.from(strings).join("?").includes('from "hosted_member"'))
      .map((call) => call[1]);
    expect(lockedMemberIds).toEqual(["owner_123", "member_123"]);
    expect(familyMocks.readHostedMemberFamilyBillingClaim).toHaveBeenCalledOnce();
    expect(harness.billingRefFindUnique).not.toHaveBeenCalled();
  });

  it("does not cancel direct Checkout when the exact Family claim disappears", async () => {
    const harness = createCleanupHarness({
      reason: "family_sponsored",
    });
    familyMocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce(null);

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_OWNERSHIP_CHANGED",
      retryable: true,
    });

    expect(harness.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });
});

function createCleanupHarness(input: {
  advisoryLockAcquired?: boolean;
  familySubscriptionOwnerGroupIds?: readonly string[];
  memberBillingRefMissing?: boolean;
  memberCustomerOwner?: boolean;
  memberSubscriptionOwnerIds?: readonly string[];
  reason?: "family_sponsored" | "superseded";
  stripeSubscriptionLookupKey?: string | null;
} = {}) {
  const familyBillingClaim = input.reason === "family_sponsored"
    ? {
        checkoutAttemptId: "family_attempt_123",
        groupId: "family_123",
        kind: "checkout_attempt" as const,
        ownerMemberId: "owner_123",
      }
    : null;
  familyMocks.readHostedMemberFamilyBillingClaim.mockReset();
  familyMocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(
    familyBillingClaim,
  );
  const queryRaw = vi.fn().mockImplementation(
    async (strings: TemplateStringsArray) =>
      Array.from(strings).join("?").includes("pg_try_advisory_xact_lock")
        ? [{ acquired: input.advisoryLockAcquired ?? true }]
        : [],
  );
  const billingRefFindUnique = vi.fn().mockResolvedValue(
    input.memberBillingRefMissing
      ? null
      : {
          stripeSubscriptionLookupKey:
            input.stripeSubscriptionLookupKey ?? null,
        },
  );
  const memberCustomerOwnerFindFirst = vi.fn().mockResolvedValue(
    input.memberCustomerOwner
      ? { memberId: "member_winner" }
      : null,
  );
  const familyCustomerOwnerFindFirst = vi.fn().mockResolvedValue(null);
  const tx = {
    $queryRaw: queryRaw,
    hostedAccountGroupBillingRef: {
      findFirst: familyCustomerOwnerFindFirst,
      findMany: vi.fn().mockResolvedValue(
        (input.familySubscriptionOwnerGroupIds ?? []).map((groupId) => ({
          groupId,
        })),
      ),
    },
    hostedMemberBillingRef: {
      findFirst: memberCustomerOwnerFindFirst,
      findMany: vi.fn().mockResolvedValue(
        (input.memberSubscriptionOwnerIds ?? []).map((memberId) => ({
          memberId,
        })),
      ),
      findUnique: billingRefFindUnique,
    },
  };
  const prisma = {
    $transaction: vi.fn(async (
      run: (innerTx: typeof tx) => Promise<unknown>,
    ) => run(tx)),
  };
  const session = {
    client_reference_id: "member_123",
    customer: "cus_loser",
    id: "cs_checkout",
    invoice: "in_checkout",
    metadata: {
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      memberId: "member_123",
    },
    mode: "subscription",
    payment_status: "paid",
    status: "complete",
    subscription: "sub_loser",
  };
  const stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn().mockResolvedValue(session),
      },
    },
    invoicePayments: {
      list: vi.fn().mockResolvedValue({
        data: [{
          amount_paid: 800,
          id: "ip_checkout",
          invoice: "in_checkout",
          payment: {
            payment_intent: "pi_checkout",
            type: "payment_intent",
          },
          status: "paid",
        }],
        has_more: false,
      }),
    },
    customers: {
      del: vi.fn().mockResolvedValue({
        deleted: true,
        id: "cus_loser",
      }),
    },
    invoices: {
      retrieve: vi.fn().mockResolvedValue({
        amount_paid: 800,
        id: "in_checkout",
        status: "paid",
        subscription: "sub_loser",
      }),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({
        amount: 800,
        charge: "ch_checkout",
        id: "re_checkout",
        payment_intent: "pi_checkout",
        status: "succeeded",
      }),
      list: vi.fn().mockResolvedValue({
        data: [],
        has_more: false,
      }),
    },
    subscriptions: {
      cancel: vi.fn().mockResolvedValue(makeSubscription("canceled")),
      list: vi.fn().mockResolvedValue({
        data: [makeSubscription("canceled")],
        has_more: false,
      }),
      retrieve: vi.fn().mockResolvedValue(makeSubscription("active")),
    },
  };
  const candidate = buildHostedCheckoutSubscriptionCleanupCandidate({
    familyBillingClaim,
    memberId: "member_123",
    reason: input.reason ?? "superseded",
    session: session as never,
    stripeSubscriptionId: "sub_loser",
  });

  return {
    billingRefFindUnique,
    candidate,
    prisma: prisma as never,
    queryRaw,
    stripe,
    stripeClient: stripe as never,
  };
}

function makeSubscription(status: "active" | "canceled") {
  return {
    id: "sub_loser",
    metadata: {
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      memberId: "member_123",
    },
    status,
  };
}
