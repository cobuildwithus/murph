import { HostedRevnetIssuanceStatus, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "./errors";

const REVNET_BROADCAST_STATUS_UNKNOWN_CODE = "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN";
export const HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS = 5 * 60 * 1000;

type HostedRevnetRepairableIssuance = {
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
};

export type HostedRevnetRepairCandidate = HostedRevnetRepairableIssuance & {
  replayAllowedWithoutForce: boolean;
  repairCategory: "broadcast_unknown_stale" | "failed";
};

export async function listHostedRevnetRepairCandidates(input: {
  limit?: number;
  now?: Date;
  prisma: PrismaClient;
  staleAfterMs?: number;
}): Promise<HostedRevnetRepairCandidate[]> {
  const staleBefore = new Date(
    (input.now ?? new Date()).getTime() - (input.staleAfterMs ?? HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS),
  );
  const rows = await input.prisma.hostedRevnetIssuance.findMany({
    where: {
      OR: [
        {
          status: HostedRevnetIssuanceStatus.failed,
        },
        {
          status: HostedRevnetIssuanceStatus.submitting,
          failureCode: REVNET_BROADCAST_STATUS_UNKNOWN_CODE,
          updatedAt: {
            lte: staleBefore,
          },
        },
      ],
    },
    orderBy: [
      {
        updatedAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    select: {
      confirmedAt: true,
      createdAt: true,
      failureCode: true,
      failureMessage: true,
      id: true,
      idempotencyKey: true,
      memberId: true,
      payTxHash: true,
      status: true,
      submittedAt: true,
      updatedAt: true,
    },
    take: input.limit ?? 100,
  });

  return rows.map((row) => ({
    ...row,
    replayAllowedWithoutForce:
      row.status === HostedRevnetIssuanceStatus.failed && row.payTxHash === null,
    repairCategory:
      row.status === HostedRevnetIssuanceStatus.failed
        ? "failed"
        : "broadcast_unknown_stale",
  }));
}

export async function replayHostedRevnetIssuanceById(input: {
  allowUnknownBroadcastReplay?: boolean;
  issuanceId: string;
  now?: Date;
  prisma: PrismaClient;
  staleAfterMs?: number;
}): Promise<HostedRevnetRepairCandidate> {
  const issuance = await input.prisma.hostedRevnetIssuance.findUnique({
    where: {
      id: input.issuanceId,
    },
    select: {
      confirmedAt: true,
      createdAt: true,
      failureCode: true,
      failureMessage: true,
      id: true,
      idempotencyKey: true,
      memberId: true,
      payTxHash: true,
      status: true,
      submittedAt: true,
      updatedAt: true,
    },
  });

  if (!issuance) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_NOT_FOUND",
      message: `Hosted RevNet issuance ${input.issuanceId} was not found.`,
      httpStatus: 404,
    });
  }

  const candidate = classifyHostedRevnetRepairCandidate({
    issuance,
    now: input.now ?? new Date(),
    staleAfterMs: input.staleAfterMs ?? HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS,
  });

  if (candidate === null) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_NOT_REPAIRABLE",
      message: `Hosted RevNet issuance ${input.issuanceId} is not in a repairable state.`,
      httpStatus: 409,
    });
  }

  if (candidate.repairCategory === "broadcast_unknown_stale") {
    if (candidate.payTxHash) {
      throw hostedOnboardingError({
        code: "REVNET_ISSUANCE_REPLAY_UNSAFE",
        message:
          "This broadcast-unknown issuance already has a transaction hash. Investigate the onchain result before any manual replay.",
        httpStatus: 409,
      });
    }

    if (!input.allowUnknownBroadcastReplay) {
      throw hostedOnboardingError({
        code: "REVNET_ISSUANCE_REPLAY_UNSAFE",
        message:
          "This broadcast-unknown issuance needs explicit operator confirmation before replay. Re-run with allowUnknownBroadcastReplay after verifying no broadcast happened.",
        httpStatus: 409,
      });
    }
  }

  if (candidate.repairCategory === "failed" && candidate.payTxHash) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_REPLAY_UNSAFE",
      message:
        "This failed issuance already has a transaction hash. Investigate the existing onchain submission instead of replaying it blindly.",
      httpStatus: 409,
    });
  }

  const repaired = await input.prisma.hostedRevnetIssuance.update({
    where: {
      id: candidate.id,
    },
    data: {
      confirmedAt: null,
      failureCode: null,
      failureMessage: null,
      payTxHash: null,
      status: HostedRevnetIssuanceStatus.pending,
      submittedAt: null,
    },
    select: {
      confirmedAt: true,
      createdAt: true,
      failureCode: true,
      failureMessage: true,
      id: true,
      idempotencyKey: true,
      memberId: true,
      payTxHash: true,
      status: true,
      submittedAt: true,
      updatedAt: true,
    },
  });

  return {
    ...repaired,
    replayAllowedWithoutForce: true,
    repairCategory: candidate.repairCategory,
  };
}

function classifyHostedRevnetRepairCandidate(input: {
  issuance: HostedRevnetRepairableIssuance;
  now: Date;
  staleAfterMs: number;
}): HostedRevnetRepairCandidate | null {
  if (input.issuance.status === HostedRevnetIssuanceStatus.failed) {
    return {
      ...input.issuance,
      replayAllowedWithoutForce: input.issuance.payTxHash === null,
      repairCategory: "failed",
    };
  }

  if (
    input.issuance.status === HostedRevnetIssuanceStatus.submitting &&
    input.issuance.failureCode === REVNET_BROADCAST_STATUS_UNKNOWN_CODE &&
    input.issuance.updatedAt.getTime() <= input.now.getTime() - input.staleAfterMs
  ) {
    return {
      ...input.issuance,
      replayAllowedWithoutForce: false,
      repairCategory: "broadcast_unknown_stale",
    };
  }

  return null;
}
