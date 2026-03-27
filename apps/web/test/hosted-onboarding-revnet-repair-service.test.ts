import { HostedRevnetIssuanceStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isHostedRevnetBroadcastStatusUnknownError: vi.fn(),
  submitHostedRevnetPayment: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/revnet", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/revnet")>(
    "@/src/lib/hosted-onboarding/revnet",
  );

  return {
    ...actual,
    isHostedRevnetBroadcastStatusUnknownError: mocks.isHostedRevnetBroadcastStatusUnknownError,
    submitHostedRevnetPayment: mocks.submitHostedRevnetPayment,
  };
});

import {
  HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS,
  listHostedRevnetRepairCandidates,
  replayHostedRevnetIssuanceById,
} from "@/src/lib/hosted-onboarding/revnet-repair-service";

const NOW = new Date("2026-03-27T12:00:00.000Z");

describe("hosted RevNet repair service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHostedRevnetBroadcastStatusUnknownError.mockImplementation((error: unknown) =>
      String(error instanceof Error ? error.message : error).toLowerCase().includes("already known"),
    );
    mocks.submitHostedRevnetPayment.mockResolvedValue({
      payTxHash: "0xabc123",
      paymentAmount: 42n,
    });
  });

  it("lists failed rows plus stale submitting rows as repair candidates", async () => {
    const prisma: any = {
      hostedRevnetIssuance: {
        findMany: vi.fn().mockResolvedValue([
          makeIssuance({
            id: "iss_failed_123",
            status: HostedRevnetIssuanceStatus.failed,
          }),
          makeIssuance({
            failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
            id: "iss_unknown_123",
            status: HostedRevnetIssuanceStatus.submitting,
            updatedAt: new Date(NOW.getTime() - HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS - 1),
          }),
          makeIssuance({
            failureCode: "REVNET_REPAIR_IN_PROGRESS",
            id: "iss_repairing_123",
            status: HostedRevnetIssuanceStatus.submitting,
            updatedAt: new Date(NOW.getTime() - HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS - 1),
          }),
        ]),
      },
    };

    const result = await listHostedRevnetRepairCandidates({
      now: NOW,
      prisma,
    });

    expect(prisma.hostedRevnetIssuance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: "iss_failed_123",
        repairCategory: "failed",
        replayAllowedWithoutForce: true,
      }),
      expect.objectContaining({
        id: "iss_unknown_123",
        repairCategory: "broadcast_unknown_stale",
        replayAllowedWithoutForce: false,
      }),
      expect.objectContaining({
        id: "iss_repairing_123",
        repairCategory: "repair_in_progress_stale",
        replayAllowedWithoutForce: false,
      }),
    ]);
  });

  it("replays a failed issuance by resubmitting it with the stored issuance fields", async () => {
    const prisma: any = {
      hostedRevnetIssuance: {
        findUnique: vi.fn().mockResolvedValue(
          makeIssuance({
            failureCode: "REVNET_PAYMENT_FAILED",
            id: "iss_failed_123",
            status: HostedRevnetIssuanceStatus.failed,
          }),
        ),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...makeIssuance({
            failureCode: null,
            failureMessage: null,
            id: "iss_failed_123",
            payTxHash: "0xabc123",
            status: HostedRevnetIssuanceStatus.submitted,
            submittedAt: NOW,
          }),
          ...data,
          updatedAt: NOW,
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await replayHostedRevnetIssuanceById({
      issuanceId: "iss_failed_123",
      now: NOW,
      prisma,
    });

    expect(prisma.hostedRevnetIssuance.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        failureCode: "REVNET_PAYMENT_FAILED",
        id: "iss_failed_123",
        payTxHash: null,
        status: HostedRevnetIssuanceStatus.failed,
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      }),
      data: expect.objectContaining({
        failureCode: "REVNET_REPAIR_IN_PROGRESS",
        status: HostedRevnetIssuanceStatus.submitting,
      }),
    });
    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledWith({
      beneficiaryAddress: "0x00000000000000000000000000000000000000AA",
      chainId: 8453,
      memo: "issuance:iss_failed_123",
      paymentAmount: 42n,
      projectId: 1n,
      terminalAddress: "0x0000000000000000000000000000000000000001",
    });
    expect(result).toMatchObject({
      id: "iss_failed_123",
      payTxHash: "0xabc123",
      repairCategory: "failed",
      status: HostedRevnetIssuanceStatus.submitted,
    });
  });

  it("blocks stale broadcast-unknown replays until the operator explicitly forces them", async () => {
    const prisma: any = {
      hostedRevnetIssuance: {
        findUnique: vi.fn().mockResolvedValue(
          makeIssuance({
            failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
            id: "iss_unknown_123",
            status: HostedRevnetIssuanceStatus.submitting,
            updatedAt: new Date(NOW.getTime() - HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS - 1),
          }),
        ),
      },
    };

    await expect(
      replayHostedRevnetIssuanceById({
        issuanceId: "iss_unknown_123",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "REVNET_ISSUANCE_REPLAY_UNSAFE",
      httpStatus: 409,
    });
  });

  it("allows a forced replay for a stale broadcast-unknown row only when no tx hash exists", async () => {
    const prisma: any = {
      hostedRevnetIssuance: {
        findUnique: vi.fn().mockResolvedValue(
          makeIssuance({
            failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
            id: "iss_unknown_123",
            status: HostedRevnetIssuanceStatus.submitting,
            updatedAt: new Date(NOW.getTime() - HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS - 1),
          }),
        ),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...makeIssuance({
            failureCode: null,
            failureMessage: null,
            id: "iss_unknown_123",
            payTxHash: "0xabc123",
            status: HostedRevnetIssuanceStatus.submitted,
            submittedAt: NOW,
          }),
          ...data,
          updatedAt: NOW,
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await replayHostedRevnetIssuanceById({
      allowUnknownBroadcastReplay: true,
      issuanceId: "iss_unknown_123",
      now: NOW,
      prisma,
    });

    expect(result).toMatchObject({
      id: "iss_unknown_123",
      payTxHash: "0xabc123",
      repairCategory: "broadcast_unknown_stale",
      status: HostedRevnetIssuanceStatus.submitted,
    });
  });

  it("refuses to replay a stale broadcast-unknown row that already has a tx hash", async () => {
    const prisma: any = {
      hostedRevnetIssuance: {
        findUnique: vi.fn().mockResolvedValue(
          makeIssuance({
            failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
            id: "iss_unknown_tx_123",
            payTxHash: "0xabc123",
            status: HostedRevnetIssuanceStatus.submitting,
            updatedAt: new Date(NOW.getTime() - HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS - 1),
          }),
        ),
      },
    };

    await expect(
      replayHostedRevnetIssuanceById({
        allowUnknownBroadcastReplay: true,
        issuanceId: "iss_unknown_tx_123",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "REVNET_ISSUANCE_REPLAY_UNSAFE",
      httpStatus: 409,
    });
  });

  it("fails closed when another actor changes the row before the repair claim lands", async () => {
    const prisma: any = {
      hostedRevnetIssuance: {
        findUnique: vi.fn().mockResolvedValue(
          makeIssuance({
            failureCode: "REVNET_PAYMENT_FAILED",
            id: "iss_failed_123",
            status: HostedRevnetIssuanceStatus.failed,
          }),
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await expect(
      replayHostedRevnetIssuanceById({
        issuanceId: "iss_failed_123",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "REVNET_ISSUANCE_REPAIR_CONFLICT",
      httpStatus: 409,
    });
    expect(mocks.submitHostedRevnetPayment).not.toHaveBeenCalled();
  });

  it("records broadcast-unknown failures when the replay submission outcome is unknown", async () => {
    mocks.submitHostedRevnetPayment.mockRejectedValue(new Error("already known"));
    const prisma: any = {
      hostedRevnetIssuance: {
        findUnique: vi.fn().mockResolvedValue(
          makeIssuance({
            failureCode: "REVNET_PAYMENT_FAILED",
            id: "iss_failed_123",
            status: HostedRevnetIssuanceStatus.failed,
          }),
        ),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...makeIssuance({
            failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
            failureMessage: "already known",
            id: "iss_failed_123",
            status: HostedRevnetIssuanceStatus.submitting,
          }),
          ...data,
          updatedAt: NOW,
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await replayHostedRevnetIssuanceById({
      issuanceId: "iss_failed_123",
      now: NOW,
      prisma,
    });

    expect(result).toMatchObject({
      failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
      repairCategory: "failed",
      status: HostedRevnetIssuanceStatus.submitting,
    });
  });

  it("fails closed if the replacement tx broadcasts but recording the hash still fails", async () => {
    const issuance = makeIssuance({
      failureCode: "REVNET_PAYMENT_FAILED",
      id: "iss_failed_123",
      status: HostedRevnetIssuanceStatus.failed,
    });
    const prisma: any = {
      hostedRevnetIssuance: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(issuance)
          .mockResolvedValueOnce(null),
        update: vi.fn().mockRejectedValue(new Error("db write failed")),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    };

    await expect(
      replayHostedRevnetIssuanceById({
        issuanceId: "iss_failed_123",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "REVNET_ISSUANCE_RECORDING_FAILED",
      httpStatus: 503,
    });

    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledTimes(1);
    expect(prisma.hostedRevnetIssuance.updateMany).toHaveBeenCalledTimes(2);
  });
});

function makeIssuance(overrides: Partial<{
  beneficiaryAddress: string;
  chainId: number;
  confirmedAt: Date | null;
  createdAt: Date;
  failureCode: string | null;
  failureMessage: string | null;
  id: string;
  idempotencyKey: string;
  memberId: string;
  payTxHash: string | null;
  paymentAmount: string;
  projectId: string;
  status: HostedRevnetIssuanceStatus;
  submittedAt: Date | null;
  terminalAddress: string;
  updatedAt: Date;
}> = {}) {
  return {
    beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
    chainId: 8453,
    confirmedAt: null,
    createdAt: new Date("2026-03-26T12:00:00.000Z"),
    failureCode: null,
    failureMessage: null,
    id: "iss_123",
    idempotencyKey: "stripe:invoice:in_123",
    memberId: "member_123",
    payTxHash: null,
    paymentAmount: "42",
    projectId: "1",
    status: HostedRevnetIssuanceStatus.pending,
    submittedAt: null,
    terminalAddress: "0x0000000000000000000000000000000000000001",
    updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    ...overrides,
  };
}
