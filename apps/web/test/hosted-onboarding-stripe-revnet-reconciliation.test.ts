import { HostedRevnetIssuanceStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

const mocks = vi.hoisted(() => ({
  activateHostedMemberFromConfirmedRevnetIssuanceTx: vi.fn(),
  nudgeHostedRunBestEffort: vi.fn(async () => "outbox"),
  isHostedOnboardingRevnetEnabled: vi.fn(),
  readHostedRevnetPaymentReceipt: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-activation")
  >("@/src/lib/hosted-onboarding/member-activation");

  return {
    ...actual,
    activateHostedMemberFromConfirmedRevnetIssuanceTx:
      mocks.activateHostedMemberFromConfirmedRevnetIssuanceTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/revnet", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/revnet")
  >("@/src/lib/hosted-onboarding/revnet");

  return {
    ...actual,
    isHostedOnboardingRevnetEnabled: mocks.isHostedOnboardingRevnetEnabled,
    readHostedRevnetPaymentReceipt: mocks.readHostedRevnetPaymentReceipt,
  };
});
vi.mock("@/src/lib/hosted-ingress/control", () => ({
  nudgeHostedRunBestEffort: mocks.nudgeHostedRunBestEffort,
}));

import { reconcileSubmittedHostedRevnetIssuances } from "@/src/lib/hosted-onboarding/stripe-revnet-reconciliation";

type ReconcileSubmittedHostedRevnetIssuancesPrisma =
  Parameters<typeof reconcileSubmittedHostedRevnetIssuances>[0]["prisma"];

describe("hosted Stripe RevNet reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activateHostedMemberFromConfirmedRevnetIssuanceTx.mockResolvedValue({
      activated: true,
      hostedExecutionEventId:
        "member.activated:hosted.revnet.issuance.confirmed:member_123:iss_confirmed_123",
      memberId: "member_123",
    });
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.readHostedRevnetPaymentReceipt.mockResolvedValue({
      status: "confirmed",
    });
  });

  it("confirms submitted issuances and activates the matching member", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const transactionClient = {
      hostedRevnetIssuance: {
        update,
      },
    };
    const transaction = vi.fn(async <T>(callback: (tx: typeof transactionClient) => Promise<T>) =>
      callback(transactionClient));
    const prisma = asReconcilePrisma({
      $transaction: transaction,
      hostedRevnetIssuance: {
        findMany: vi.fn().mockResolvedValue([
          makeIssuance({
            id: "iss_confirmed_123",
            payTxHash: "0xabc123",
            status: HostedRevnetIssuanceStatus.submitted,
          }),
        ]),
        update: vi.fn(),
        updateMany,
      },
    });

    await expect(
      reconcileSubmittedHostedRevnetIssuances({
        prisma,
      }),
    ).resolves.toEqual(["iss_confirmed_123"]);

    expect(mocks.readHostedRevnetPaymentReceipt).toHaveBeenCalledWith({
      chainId: 8453,
      payTxHash: "0xabc123",
    });
    expect(prisma.hostedRevnetIssuance.findMany).toHaveBeenCalledWith({
      where: {
        nextAttemptAt: {
          lte: expect.any(Date),
        },
        payTxHash: {
          not: null,
        },
        status: HostedRevnetIssuanceStatus.submitted,
      },
      orderBy: [
        {
          createdAt: "asc",
        },
      ],
      take: 25,
    });
    expect(update).toHaveBeenCalledWith({
      where: {
        id: "iss_confirmed_123",
      },
      data: expect.objectContaining({
        confirmedAt: expect.any(Date),
        failureCode: null,
        failureMessage: null,
        status: HostedRevnetIssuanceStatus.confirmed,
      }),
    });
    expect(mocks.activateHostedMemberFromConfirmedRevnetIssuanceTx).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: transactionClient,
      sourceEventId: "iss_confirmed_123",
      sourceType: "hosted.revnet.issuance.confirmed",
    });
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("marks reverted submitted issuances failed without attempting activation", async () => {
    mocks.readHostedRevnetPaymentReceipt.mockResolvedValue({
      status: "reverted",
    });
    const update = vi.fn().mockResolvedValue(undefined);
    const prisma = asReconcilePrisma({
      $transaction: vi.fn(),
      hostedRevnetIssuance: {
        findMany: vi.fn().mockResolvedValue([
          makeIssuance({
            id: "iss_reverted_123",
            payTxHash: "0xdef456",
            status: HostedRevnetIssuanceStatus.submitted,
          }),
        ]),
        update,
      },
    });

    await expect(
      reconcileSubmittedHostedRevnetIssuances({
        prisma,
      }),
    ).resolves.toEqual([]);

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "iss_reverted_123",
      },
      data: {
        failureCode: "REVNET_PAYMENT_REVERTED",
        failureMessage: "The submitted Hosted RevNet payment reverted onchain.",
        status: HostedRevnetIssuanceStatus.failed,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberFromConfirmedRevnetIssuanceTx).not.toHaveBeenCalled();
  });
});

function makeIssuance(overrides: Partial<{
  attemptCount: number;
  chainId: number;
  createdAt: Date;
  id: string;
  memberId: string;
  nextAttemptAt: Date;
  payTxHash: string | null;
  status: HostedRevnetIssuanceStatus;
}> = {}) {
  return {
    attemptCount: 0,
    chainId: 8453,
    createdAt: new Date("2026-03-26T12:00:00.000Z"),
    id: "iss_123",
    memberId: "member_123",
    nextAttemptAt: new Date("2026-03-26T12:00:00.000Z"),
    payTxHash: null,
    status: HostedRevnetIssuanceStatus.pending,
    ...overrides,
  };
}

function asReconcilePrisma<T extends Record<string, unknown>>(
  prisma: T,
): T & ReconcileSubmittedHostedRevnetIssuancesPrisma {
  return prisma as T & ReconcileSubmittedHostedRevnetIssuancesPrisma;
}
