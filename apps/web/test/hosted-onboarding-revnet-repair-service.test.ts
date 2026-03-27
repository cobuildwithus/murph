import { HostedRevnetIssuanceStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS,
  listHostedRevnetRepairCandidates,
  replayHostedRevnetIssuanceById,
} from "@/src/lib/hosted-onboarding/revnet-repair-service";

const NOW = new Date("2026-03-27T12:00:00.000Z");

describe("hosted RevNet repair service", () => {
  it("lists failed rows plus stale broadcast-unknown submissions as repair candidates", async () => {
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
    ]);
  });

  it("replays a failed issuance by resetting it to pending", async () => {
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
            payTxHash: null,
            status: HostedRevnetIssuanceStatus.pending,
            submittedAt: null,
          }),
          ...data,
          updatedAt: NOW,
        })),
      },
    };

    const result = await replayHostedRevnetIssuanceById({
      issuanceId: "iss_failed_123",
      now: NOW,
      prisma,
    });

    expect(prisma.hostedRevnetIssuance.update).toHaveBeenCalledWith({
      where: {
        id: "iss_failed_123",
      },
      data: {
        confirmedAt: null,
        failureCode: null,
        failureMessage: null,
        payTxHash: null,
        status: HostedRevnetIssuanceStatus.pending,
        submittedAt: null,
      },
      select: expect.any(Object),
    });
    expect(result).toMatchObject({
      id: "iss_failed_123",
      repairCategory: "failed",
      status: HostedRevnetIssuanceStatus.pending,
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
            payTxHash: null,
            status: HostedRevnetIssuanceStatus.pending,
            submittedAt: null,
          }),
          ...data,
          updatedAt: NOW,
        })),
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
      repairCategory: "broadcast_unknown_stale",
      status: HostedRevnetIssuanceStatus.pending,
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
});

function makeIssuance(overrides: Partial<{
  confirmedAt: Date | null;
  createdAt: Date;
  failureCode: string | null;
  failureMessage: string | null;
  id: string;
  idempotencyKey: string;
  memberId: string;
  payTxHash: string | null;
  status: HostedRevnetIssuanceStatus;
  submittedAt: Date | null;
  updatedAt: Date;
}> = {}) {
  return {
    confirmedAt: null,
    createdAt: new Date("2026-03-26T12:00:00.000Z"),
    failureCode: null,
    failureMessage: null,
    id: "iss_123",
    idempotencyKey: "stripe:invoice:in_123",
    memberId: "member_123",
    payTxHash: null,
    status: HostedRevnetIssuanceStatus.pending,
    submittedAt: null,
    updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    ...overrides,
  };
}
