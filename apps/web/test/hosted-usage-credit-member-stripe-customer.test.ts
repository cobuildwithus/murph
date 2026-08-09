import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bindHostedMemberStripeCustomerIdIfMissingTx: vi.fn(),
  createStripeCustomer: vi.fn(),
  getPrisma: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedStripeApiMode: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  bindHostedMemberStripeCustomerIdIfMissingTx:
    mocks.bindHostedMemberStripeCustomerIdIfMissingTx,
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

import { ensureHostedMemberStripeCustomer } from "@/src/lib/hosted-onboarding/hosted-member-stripe-customer";

describe("ensureHostedMemberStripeCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedStripeApiMode.mockReturnValue({
      stripe: { customers: { create: mocks.createStripeCustomer } },
    });
    mocks.createStripeCustomer.mockResolvedValue({ id: "cus_candidate" });
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

  it("creates and binds one customer after locking an eligible payer", async () => {
    const prisma = createPrisma();
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.bindHostedMemberStripeCustomerIdIfMissingTx.mockResolvedValue({
      stripeCustomerId: "cus_candidate",
    });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_candidate");

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
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(
      prisma.tx,
      "member_payer",
    );
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).toHaveBeenCalledWith({
      memberId: "member_payer",
      stripeCustomerId: "cus_candidate",
      tx: prisma.tx,
    });
  });

  it("uses a customer that won the lock race instead of rebinding", async () => {
    const prisma = createPrisma();
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ stripeCustomerId: "cus_race_winner" });

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toBe("cus_race_winner");

    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });

  it("fails closed when the payer becomes suspended before binding", async () => {
    const prisma = createPrisma({ suspendedAt: new Date("2026-07-20T12:00:00.000Z") });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(null);

    await expect(ensureHostedMemberStripeCustomer({
      memberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_PAYER_NOT_ELIGIBLE",
      httpStatus: 403,
    });
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).not.toHaveBeenCalled();
  });
});

function createPrisma(memberOverride: Record<string, unknown> = {}) {
  const tx = {
    hostedMember: {
      findUnique: vi.fn(async () => ({
        suspendedAt: null,
        threadContainer: null,
        ...memberOverride,
      })),
    },
  };
  const prisma = {
    tx,
    $transaction: vi.fn(async (
      callback: (transaction: typeof tx) => Promise<unknown>,
    ) => callback(tx)),
  };
  return prisma;
}
