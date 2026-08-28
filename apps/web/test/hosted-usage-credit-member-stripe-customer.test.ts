import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedStripeEffectClaimAbsent: vi.fn(),
  bindHostedMemberStripeCustomerIdIfMissingTx: vi.fn(),
  createStripeCustomer: vi.fn(),
  getPrisma: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  projectHostedMemberStripeBillingRefSnapshot: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedStripeApiMode: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  assertHostedStripeEffectClaimAbsent: mocks.assertHostedStripeEffectClaimAbsent,
  bindHostedMemberStripeCustomerIdIfMissingTx:
    mocks.bindHostedMemberStripeCustomerIdIfMissingTx,
  projectHostedMemberStripeBillingRefSnapshot:
    mocks.projectHostedMemberStripeBillingRefSnapshot,
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-error-log", () => ({
  withHostedStripeFailureLog: vi.fn(async (
    _operation: string,
    run: () => Promise<unknown>,
  ) => run()),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApiMode: mocks.requireHostedStripeApiMode,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {},
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import {
  ensureHostedMemberStripeCustomer,
  resumeHostedMemberStripeCustomerClaimForAccountDeletion,
} from "@/src/lib/hosted-onboarding/hosted-member-stripe-customer";

describe("ensureHostedMemberStripeCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedStripeEffectClaimAbsent.mockImplementation(
      (claimId: string | null | undefined) => {
        if (claimId) {
          throw Object.assign(new Error("Billing is already changing."), {
            code: "HOSTED_STRIPE_EFFECT_PENDING",
            retryable: true,
          });
        }
      },
    );
    mocks.requireHostedStripeApiMode.mockReturnValue({
      stripe: { customers: { create: mocks.createStripeCustomer } },
    });
    mocks.bindHostedMemberStripeCustomerIdIfMissingTx.mockResolvedValue({
      stripeCustomerId: "cus_candidate",
    });
    mocks.createStripeCustomer.mockResolvedValue({ id: "cus_candidate" });
    mocks.projectHostedMemberStripeBillingRefSnapshot.mockImplementation(
      async (billingRef: { memberId: string; stripeCustomerIdEncrypted: string | null }) => ({
        memberId: billingRef.memberId,
        stripeCustomerId: billingRef.stripeCustomerIdEncrypted?.replace(
          "encrypted:",
          "",
        ) ?? null,
        stripeSubscriptionId: null,
      }),
    );
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(null);
  });

  it("reuses an existing member customer without provider or transaction work", async () => {
    const prisma = createPrisma();
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
      stripeCustomerId: "cus_existing",
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_existing");

    expect(mocks.createStripeCustomer).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("calls Stripe only between short interactive transactions, then binds", async () => {
    const prisma = createPrisma();
    mocks.createStripeCustomer.mockImplementation(async () => {
      expect(prisma.isInteractiveTransactionOpen()).toBe(false);
      return { id: "cus_candidate" };
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_candidate");

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.createStripeCustomer).toHaveBeenCalledWith(
      {
        metadata: {
          memberId: "member_payer",
          source: "hosted.auto_pulse_trial",
        },
      },
      {
        idempotencyKey: "hosted-auto-pulse-trial-customer:member_payer",
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    const claimId = prisma.tx.hostedMemberBillingRef.upsert.mock.calls[0]?.[0]
      .create.stripeEffectClaimId;
    expect(claimId).toEqual(
      expect.stringMatching(/^member-customer-create:/),
    );
    expect(prisma.tx.hostedMemberBillingRef.upsert).toHaveBeenCalledWith({
      create: expect.objectContaining({
        memberId: "member_payer",
        stripeEffectClaimId: claimId,
        stripeEffectKind: "member.customer-create",
      }),
      update: expect.objectContaining({
        stripeEffectClaimId: claimId,
        stripeEffectKind: "member.customer-create",
      }),
      where: { memberId: "member_payer" },
    });
    expect(prisma.tx.hostedMemberBillingRef.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stripeEffectClaimId: null,
        stripeEffectKind: null,
      }),
      where: {
        memberId: "member_payer",
        stripeEffectClaimId: claimId,
        stripeEffectKind: "member.customer-create",
      },
    });
    expect(
      prisma.tx.hostedMemberBillingRef.upsert.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.createStripeCustomer.mock.invocationCallOrder[0]!);
    expect(
      mocks.createStripeCustomer.mock.invocationCallOrder[0]!,
    ).toBeLessThan(
      prisma.tx.hostedMemberBillingRef.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(2);
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).toHaveBeenCalledWith({
      memberId: "member_payer",
      stripeCustomerId: "cus_candidate",
      tx: prisma.tx,
    });
  });

  it("does not create a customer while a future Stripe effect owns the member", async () => {
    const prisma = createPrisma({
      billingRefStates: [createBillingRef({
        stripeEffectClaimId: "member-customer:active-claim",
        stripeEffectKind: "member.customer-create",
      })],
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(mocks.createStripeCustomer).not.toHaveBeenCalled();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });

  it("does not claim Customer creation while direct Checkout owns a Session", async () => {
    const prisma = createPrisma({
      billingRefStates: [createBillingRef({
        stripeCheckoutSessionLookupKey: "lookup:cs_open",
      })],
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(prisma.tx.hostedMemberBillingRef.upsert).not.toHaveBeenCalled();
    expect(mocks.createStripeCustomer).not.toHaveBeenCalled();
  });

  it("does not bind when a Stripe effect claims the member during provider work", async () => {
    const prisma = createPrisma({
      billingRefStates: [
        null,
        createBillingRef({
          stripeEffectClaimId: "member-customer:raced-claim",
          updatedAt: new Date("2026-07-20T12:00:01.000Z"),
        }),
      ],
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(mocks.createStripeCustomer).toHaveBeenCalledOnce();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });

  it("uses a customer that won the preparation lock race without provider work", async () => {
    const prisma = createPrisma({
      billingRefStates: [createBillingRef({ stripeCustomerId: "cus_race_winner" })],
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_race_winner");

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.createStripeCustomer).not.toHaveBeenCalled();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });

  it("keeps a finalization race winner instead of binding stale provider state", async () => {
    const prisma = createPrisma({
      billingRefStates: [
        null,
        createBillingRef({ stripeCustomerId: "cus_race_winner" }),
      ],
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_race_winner");

    expect(mocks.createStripeCustomer).toHaveBeenCalledOnce();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous provider success with the same stable identity", async () => {
    const prisma = createPrisma();
    const providerCustomers = new Map<string, string>();
    let firstResponse = true;
    mocks.createStripeCustomer.mockImplementation(async (
      _params: unknown,
      requestOptions: { idempotencyKey: string },
    ) => {
      const customerId = providerCustomers.get(requestOptions.idempotencyKey)
        ?? "cus_reconciled";
      providerCustomers.set(requestOptions.idempotencyKey, customerId);
      if (firstResponse) {
        firstResponse = false;
        throw Object.assign(new Error("connection closed after provider commit"), {
          code: "ECONNRESET",
        });
      }
      return { id: customerId };
    });
    mocks.bindHostedMemberStripeCustomerIdIfMissingTx.mockResolvedValue({
      stripeCustomerId: "cus_reconciled",
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({ code: "ECONNRESET" });

    await expect(resumeHostedMemberStripeCustomerClaimForAccountDeletion({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_reconciled");

    expect(providerCustomers).toEqual(new Map([
      ["hosted-auto-pulse-trial-customer:member_payer", "cus_reconciled"],
    ]));
    expect(mocks.createStripeCustomer).toHaveBeenCalledTimes(2);
    expect(mocks.createStripeCustomer.mock.calls.map(
      (call: readonly unknown[]) => call[1],
    )).toEqual([
      {
        idempotencyKey: "hosted-auto-pulse-trial-customer:member_payer",
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
      {
        idempotencyKey: "hosted-auto-pulse-trial-customer:member_payer",
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    ]);
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).toHaveBeenCalledWith({
      memberId: "member_payer",
      stripeCustomerId: "cus_reconciled",
      tx: prisma.tx,
    });
  });

  it("does not admit Customer creation when account deletion has no claim", async () => {
    const prisma = createPrisma();

    await expect(
      resumeHostedMemberStripeCustomerClaimForAccountDeletion({
        memberId: "member_payer",
        prisma: prisma as never,
      }),
    ).resolves.toBeNull();

    expect(prisma.tx.hostedMemberBillingRef.upsert).not.toHaveBeenCalled();
    expect(mocks.requireHostedStripeApiMode).not.toHaveBeenCalled();
    expect(mocks.createStripeCustomer).not.toHaveBeenCalled();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });

  it("rejects an unrelated claim without calling Stripe for account deletion", async () => {
    const prisma = createPrisma({
      billingRefStates: [createBillingRef({
        stripeEffectClaimId: "future-effect:active-claim",
        stripeEffectKind: "future.effect",
      })],
    });

    await expect(
      resumeHostedMemberStripeCustomerClaimForAccountDeletion({
        memberId: "member_payer",
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(prisma.tx.hostedMemberBillingRef.upsert).not.toHaveBeenCalled();
    expect(mocks.requireHostedStripeApiMode).not.toHaveBeenCalled();
    expect(mocks.createStripeCustomer).not.toHaveBeenCalled();
  });

  it("keeps the exact claim when Stripe is unavailable during deletion recovery", async () => {
    const exactClaim = createBillingRef({
      stripeEffectClaimId: "member-customer-create:active-claim",
      stripeEffectKind: "member.customer-create",
    });
    const prisma = createPrisma({ billingRefStates: [exactClaim] });
    mocks.createStripeCustomer.mockRejectedValue(
      Object.assign(new Error("stripe unavailable"), { code: "ETIMEDOUT" }),
    );

    await expect(
      resumeHostedMemberStripeCustomerClaimForAccountDeletion({
        memberId: "member_payer",
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });

    expect(prisma.tx.hostedMemberBillingRef.upsert).not.toHaveBeenCalled();
    expect(mocks.createStripeCustomer).toHaveBeenCalledOnce();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
    expect(prisma.tx.hostedMemberBillingRef.updateMany).not.toHaveBeenCalled();
  });

  it("does not bind when member authority changes while Stripe is in flight", async () => {
    const prisma = createPrisma({
      memberStates: [
        activeMemberState(),
        activeMemberState({
          suspendedAt: new Date("2026-07-20T12:00:00.000Z"),
        }),
      ],
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_PAYER_NOT_ELIGIBLE",
      httpStatus: 403,
    });

    expect(mocks.createStripeCustomer).toHaveBeenCalledOnce();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });

  it("does not bind when the prepared billing state changes while Stripe is in flight", async () => {
    const preparedBillingRef = createBillingRef({
      currentBillingPhase: "not_started",
      updatedAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const racedBillingRef = createBillingRef({
      currentBillingPhase: "checkout_pending",
      updatedAt: new Date("2026-07-20T12:00:01.000Z"),
    });
    const prisma = createPrisma({
      billingRefStates: [preparedBillingRef, racedBillingRef],
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_CUSTOMER_BIND_FAILED",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.createStripeCustomer).toHaveBeenCalledOnce();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });
});

function activeMemberState(
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    suspendedAt: null,
    threadContainer: null,
    ...override,
  };
}

function createBillingRef(input: {
  currentBillingPhase?: string | null;
  stripeCheckoutSessionLookupKey?: string | null;
  stripeCustomerId?: string | null;
  stripeEffectClaimId?: string | null;
  stripeEffectKind?: string | null;
  updatedAt?: Date;
} = {}): Record<string, unknown> {
  const stripeCustomerId = input.stripeCustomerId ?? null;
  return {
    createdAt: new Date("2026-07-20T11:00:00.000Z"),
    currentBillingPhase: input.currentBillingPhase ?? null,
    memberId: "member_payer",
    stripeCheckoutSessionLookupKey:
      input.stripeCheckoutSessionLookupKey ?? null,
    stripeCustomerIdEncrypted: stripeCustomerId
      ? `encrypted:${stripeCustomerId}`
      : null,
    stripeCustomerLookupKey: stripeCustomerId
      ? `lookup:${stripeCustomerId}`
      : null,
    stripeEffectClaimId: input.stripeEffectClaimId ?? null,
    stripeEffectClaimedAt: input.stripeEffectClaimId
      ? new Date("2026-07-20T12:00:00.000Z")
      : null,
    stripeEffectExecutionId: null,
    stripeEffectExecutionStartedAt: null,
    stripeEffectKind: input.stripeEffectKind ?? null,
    stripeEffectTargetPlanCode: null,
    updatedAt: input.updatedAt ?? new Date("2026-07-20T12:00:00.000Z"),
  };
}

function createPrisma(input: {
  billingRefStates?: Array<Record<string, unknown> | null>;
  memberStates?: Array<Record<string, unknown>>;
} = {}) {
  const billingRefStates = [...(input.billingRefStates ?? [])];
  const memberStates = input.memberStates ?? [activeMemberState()];
  let billingRefState: Record<string, unknown> | null = null;
  let memberReadIndex = 0;
  let interactiveTransactionOpen = false;
  const tx = {
    hostedMember: {
      findUnique: vi.fn(async () => readSequencedState(
        memberStates,
        memberReadIndex++,
      )),
    },
    hostedMemberBillingRef: {
      findUnique: vi.fn(async () => {
        if (billingRefStates.length > 0) {
          billingRefState = billingRefStates.shift() ?? null;
        }
        return billingRefState;
      }),
      updateMany: vi.fn(async (input: {
        data: Record<string, unknown>;
        where: {
          memberId: string;
          stripeEffectClaimId: string;
          stripeEffectKind: string;
        };
      }) => {
        if (
          billingRefState?.memberId !== input.where.memberId
          || billingRefState.stripeEffectClaimId
            !== input.where.stripeEffectClaimId
          || billingRefState.stripeEffectKind !== input.where.stripeEffectKind
        ) {
          return { count: 0 };
        }
        billingRefState = { ...billingRefState, ...input.data };
        return { count: 1 };
      }),
      upsert: vi.fn(async (input: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        billingRefState = billingRefState
          ? { ...billingRefState, ...input.update }
          : { ...createBillingRef(), ...input.create };
        return billingRefState;
      }),
    },
  };
  const prisma = {
    tx,
    isInteractiveTransactionOpen: () => interactiveTransactionOpen,
    $transaction: vi.fn(async (
      callback: (transaction: typeof tx) => Promise<unknown>,
    ) => {
      expect(interactiveTransactionOpen).toBe(false);
      interactiveTransactionOpen = true;
      try {
        return await callback(tx);
      } finally {
        interactiveTransactionOpen = false;
      }
    }),
  };
  return prisma;
}

function readSequencedState<T>(states: readonly T[], index: number): T {
  const state = states[Math.min(index, states.length - 1)];
  if (state === undefined) {
    throw new Error("Test state sequence must not be empty.");
  }
  return state;
}
