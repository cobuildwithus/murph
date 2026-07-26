import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx: vi.fn(),
  createHostedPulseTrialStripeCustomer: vi.fn(),
  finalizeHostedMemberStripeCustomerReservationTx: vi.fn(),
  getPrisma: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedStripeApiMode: vi.fn(),
  reserveHostedMemberStripeCustomerReservationTx: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx:
    mocks.clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx,
  finalizeHostedMemberStripeCustomerReservationTx:
    mocks.finalizeHostedMemberStripeCustomerReservationTx,
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
  reserveHostedMemberStripeCustomerReservationTx:
    mocks.reserveHostedMemberStripeCustomerReservationTx,
}));

vi.mock("@/src/lib/hosted-onboarding/pulse-trial-customer", () => ({
  createHostedPulseTrialStripeCustomer:
    mocks.createHostedPulseTrialStripeCustomer,
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

import { ensureHostedMemberStripeCustomer } from "@/src/lib/hosted-onboarding/hosted-member-stripe-customer";

const ELIGIBLE_MEMBER = {
  suspendedAt: null,
  threadContainer: null,
};

describe("ensureHostedMemberStripeCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(null);
    mocks.requireHostedStripeApiMode.mockReturnValue({ stripe: "stripe-client" });
    mocks.reserveHostedMemberStripeCustomerReservationTx.mockResolvedValue({
      createdAt: new Date("2026-07-26T12:00:00.000Z"),
      kind: "reserved",
      reservationId: "hbscr_attempt",
    });
    mocks.createHostedPulseTrialStripeCustomer.mockResolvedValue("cus_candidate");
    mocks.finalizeHostedMemberStripeCustomerReservationTx.mockResolvedValue({
      kind: "bound",
      stripeCustomerId: "cus_candidate",
    });
    mocks.clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx
      .mockResolvedValue(true);
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

    expect(mocks.createHostedPulseTrialStripeCustomer).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("commits the durable marker before creating and exact-binding the Customer", async () => {
    const events: string[] = [];
    const prisma = createPrisma({ events });
    mocks.createHostedPulseTrialStripeCustomer.mockImplementation(async () => {
      events.push("provider:create");
      return "cus_candidate";
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_candidate");

    expect(events).toEqual([
      "transaction:start",
      "transaction:commit",
      "provider:create",
      "transaction:start",
      "transaction:commit",
    ]);
    expect(mocks.reserveHostedMemberStripeCustomerReservationTx)
      .toHaveBeenCalledWith({
        memberId: "member_payer",
        now: expect.any(Date),
        tx: prisma.tx,
      });
    expect(mocks.createHostedPulseTrialStripeCustomer).toHaveBeenCalledWith({
      memberId: "member_payer",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
      reservationId: "hbscr_attempt",
      stripe: "stripe-client",
    });
    expect(mocks.finalizeHostedMemberStripeCustomerReservationTx)
      .toHaveBeenCalledWith({
        bindAllowed: true,
        candidateStripeCustomerId: "cus_candidate",
        memberId: "member_payer",
        now: expect.any(Date),
        reservationId: "hbscr_attempt",
        tx: prisma.tx,
      });
  });

  it("uses a Customer already bound while reserving", async () => {
    const prisma = createPrisma();
    mocks.reserveHostedMemberStripeCustomerReservationTx.mockResolvedValue({
      kind: "bound",
      stripeCustomerId: "cus_race_winner",
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_race_winner");

    expect(mocks.createHostedPulseTrialStripeCustomer).not.toHaveBeenCalled();
    expect(mocks.finalizeHostedMemberStripeCustomerReservationTx)
      .not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it.each([
    ["deleted", null],
    [
      "suspended",
      {
        suspendedAt: new Date("2026-07-20T12:00:00.000Z"),
        threadContainer: null,
      },
    ],
  ])("does not create a Customer when the payer is %s before reservation", async (
    _label,
    member,
  ) => {
    const prisma = createPrisma({ members: [member] });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_PAYER_NOT_ELIGIBLE",
      httpStatus: 403,
    });
    expect(mocks.reserveHostedMemberStripeCustomerReservationTx)
      .not.toHaveBeenCalled();
    expect(mocks.createHostedPulseTrialStripeCustomer).not.toHaveBeenCalled();
  });

  it("exact-clears the marker after a definitive provider rejection", async () => {
    const prisma = createPrisma();
    const providerError = {
      statusCode: 400,
      type: "StripeInvalidRequestError",
    };
    mocks.createHostedPulseTrialStripeCustomer.mockRejectedValue(providerError);

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toBe(providerError);

    expect(mocks.clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx)
      .toHaveBeenCalledWith({
        memberId: "member_payer",
        reservationId: "hbscr_attempt",
        tx: prisma.tx,
      });
  });

  it.each([
    [
      "provider ambiguity",
      {
        statusCode: 500,
        type: "StripeAPIError",
      },
    ],
    [
      "same-key in-flight conflict even with a no-retry directive",
      {
        code: "idempotency_key_in_use",
        headers: { "stripe-should-retry": "false" },
        statusCode: 409,
        type: "StripeIdempotencyError",
      },
    ],
  ])("retains the marker after %s", async (_label, providerError) => {
    const prisma = createPrisma();
    mocks.createHostedPulseTrialStripeCustomer.mockRejectedValue(providerError);

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toBe(providerError);

    expect(mocks.clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx)
      .not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "deleted",
      null,
    ],
    [
      "suspended",
      {
        suspendedAt: new Date("2026-07-26T12:00:01.000Z"),
        threadContainer: null,
      },
    ],
  ])("retains the marker and returns ineligible when the payer becomes %s before finalization", async (
    _label,
    finalMember,
  ) => {
    const prisma = createPrisma({
      members: [ELIGIBLE_MEMBER, finalMember],
    });
    mocks.finalizeHostedMemberStripeCustomerReservationTx.mockResolvedValue({
      kind: "ineligible",
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_PAYER_NOT_ELIGIBLE",
    });

    expect(mocks.finalizeHostedMemberStripeCustomerReservationTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        bindAllowed: false,
        candidateStripeCustomerId: "cus_candidate",
        reservationId: "hbscr_attempt",
      }));
    expect(mocks.clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx)
      .not.toHaveBeenCalled();
  });

  it("retains the exact marker when the binding commit acknowledgement is ambiguous", async () => {
    const prisma = createPrisma({
      failTransactionAfterCallbackAt: 2,
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toThrow("Injected transaction acknowledgement failure.");

    expect(mocks.createHostedPulseTrialStripeCustomer).toHaveBeenCalledOnce();
    expect(mocks.clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx)
      .not.toHaveBeenCalled();
  });
});

function createPrisma(input: {
  events?: string[];
  failTransactionAfterCallbackAt?: number;
  members?: Array<Record<string, unknown> | null>;
} = {}) {
  let memberReadIndex = 0;
  let transactionIndex = 0;
  const tx = {
    hostedMember: {
      findUnique: vi.fn(async () => {
        const configuredMember = input.members?.[
          Math.min(memberReadIndex, (input.members?.length ?? 1) - 1)
        ];
        memberReadIndex += 1;
        return configuredMember === undefined
          ? ELIGIBLE_MEMBER
          : configuredMember;
      }),
    },
  };
  const prisma = {
    tx,
    $transaction: vi.fn(async (
      callback: (transaction: typeof tx) => Promise<unknown>,
    ) => {
      transactionIndex += 1;
      input.events?.push("transaction:start");
      const result = await callback(tx);
      if (input.failTransactionAfterCallbackAt === transactionIndex) {
        throw new Error("Injected transaction acknowledgement failure.");
      }
      input.events?.push("transaction:commit");
      return result;
    }),
  };
  return prisma;
}
