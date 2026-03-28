import { HostedRevnetIssuanceStatus, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "./errors";
import {
  coerceHostedWalletAddress,
  isHostedRevnetBroadcastStatusUnknownError,
  submitHostedRevnetPayment,
} from "./revnet";

const REVNET_BROADCAST_STATUS_UNKNOWN_CODE = "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN";
const REVNET_REPAIR_IN_PROGRESS_CODE = "REVNET_REPAIR_IN_PROGRESS";

export const HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS = 5 * 60 * 1000;

type HostedRevnetRepairableIssuance = {
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
};

export type HostedRevnetRepairCandidate = HostedRevnetRepairableIssuance & {
  replayAllowedWithoutForce: boolean;
  repairCategory: "broadcast_unknown_stale" | "failed" | "repair_in_progress_stale" | "submitting_stale";
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
    select: repairIssuanceSelect,
    take: input.limit ?? 100,
  });

  return rows.map((row) =>
    requireHostedRevnetRepairCandidate({
      issuance: row,
      now: input.now ?? new Date(),
      staleAfterMs: input.staleAfterMs ?? HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS,
    }),
  );
}

export async function replayHostedRevnetIssuanceById(input: {
  allowUnknownBroadcastReplay?: boolean;
  issuanceId: string;
  now?: Date;
  prisma: PrismaClient;
  staleAfterMs?: number;
}): Promise<HostedRevnetRepairCandidate> {
  const now = input.now ?? new Date();
  const issuance = await input.prisma.hostedRevnetIssuance.findUnique({
    where: {
      id: input.issuanceId,
    },
    select: repairIssuanceSelect,
  });

  if (!issuance) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_NOT_FOUND",
      message: `Hosted RevNet issuance ${input.issuanceId} was not found.`,
      httpStatus: 404,
    });
  }

  const candidate = requireHostedRevnetRepairCandidate({
    issuance,
    now,
    staleAfterMs: input.staleAfterMs ?? HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS,
  });

  if (
    (candidate.repairCategory === "broadcast_unknown_stale" ||
      candidate.repairCategory === "repair_in_progress_stale" ||
      candidate.repairCategory === "submitting_stale") &&
    candidate.payTxHash
  ) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_REPLAY_UNSAFE",
      message:
        "This repair candidate already has a transaction hash. Investigate the onchain result before any manual replay.",
      httpStatus: 409,
    });
  }

  if (
    (candidate.repairCategory === "broadcast_unknown_stale" ||
      candidate.repairCategory === "repair_in_progress_stale" ||
      candidate.repairCategory === "submitting_stale") &&
    !input.allowUnknownBroadcastReplay
  ) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_REPLAY_UNSAFE",
      message:
        "This stale submitting issuance needs explicit operator confirmation before replay. Re-run with allowUnknownBroadcastReplay only after verifying no broadcast happened or after deciding on the manual recovery path.",
      httpStatus: 409,
    });
  }

  if (candidate.repairCategory === "failed" && candidate.payTxHash) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_REPLAY_UNSAFE",
      message:
        "This failed issuance already has a transaction hash. Investigate the existing onchain submission instead of replaying it blindly.",
      httpStatus: 409,
    });
  }

  const claimed = await input.prisma.hostedRevnetIssuance.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      failureCode: candidate.failureCode,
      payTxHash: candidate.payTxHash,
      updatedAt: candidate.updatedAt,
    },
    data: {
      confirmedAt: null,
      failureCode: REVNET_REPAIR_IN_PROGRESS_CODE,
      failureMessage: "Repair replay in progress.",
      payTxHash: null,
      status: HostedRevnetIssuanceStatus.submitting,
      submittedAt: null,
    },
  });

  if (claimed.count !== 1) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_REPAIR_CONFLICT",
      message: `Hosted RevNet issuance ${input.issuanceId} changed while the repair was being claimed. Refresh the row and try again.`,
      httpStatus: 409,
    });
  }

  let submission;
  try {
    submission = await submitHostedRevnetPayment({
      beneficiaryAddress: requireHostedRevnetIssuanceAddress(
        candidate.beneficiaryAddress,
        "Hosted RevNet issuance beneficiary address",
      ),
      chainId: candidate.chainId,
      memo: `issuance:${candidate.id}`,
      paymentAmount: requireHostedRevnetIssuanceBigInt(
        candidate.paymentAmount,
        "Hosted RevNet issuance payment amount",
      ),
      projectId: requireHostedRevnetIssuanceBigInt(
        candidate.projectId,
        "Hosted RevNet issuance project id",
      ),
      terminalAddress: requireHostedRevnetIssuanceAddress(
        candidate.terminalAddress,
        "Hosted RevNet issuance terminal address",
      ),
    });
  } catch (error) {
    const failure = classifyHostedRevnetIssuanceFailure(error);
    const repaired = await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: candidate.id,
      },
      data: {
        failureCode: failure.code,
        failureMessage: failure.message,
        payTxHash: null,
        status: failure.bucket === "broadcast_unknown"
          ? HostedRevnetIssuanceStatus.submitting
          : HostedRevnetIssuanceStatus.failed,
        submittedAt: null,
      },
      select: repairIssuanceSelect,
    });

    return {
      ...repaired,
      replayAllowedWithoutForce: false,
      repairCategory: candidate.repairCategory,
    };
  }

  const recordSubmissionData = {
    failureCode: null,
    failureMessage: null,
    payTxHash: submission.payTxHash,
    status: HostedRevnetIssuanceStatus.submitted,
    submittedAt: now,
  } as const;

  try {
    const repaired = await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: candidate.id,
      },
      data: recordSubmissionData,
      select: repairIssuanceSelect,
    });

    return {
      ...repaired,
      replayAllowedWithoutForce: false,
      repairCategory: candidate.repairCategory,
    };
  } catch (error) {
    try {
      const fallback = await input.prisma.hostedRevnetIssuance.updateMany({
        where: {
          id: candidate.id,
          failureCode: REVNET_REPAIR_IN_PROGRESS_CODE,
          status: HostedRevnetIssuanceStatus.submitting,
        },
        data: recordSubmissionData,
      });

      if (fallback.count === 1) {
        const repaired = await input.prisma.hostedRevnetIssuance.findUnique({
          where: {
            id: candidate.id,
          },
          select: repairIssuanceSelect,
        });

        if (repaired) {
          return {
            ...repaired,
            replayAllowedWithoutForce: false,
            repairCategory: candidate.repairCategory,
          };
        }
      }
    } catch {
      // Fall through to the fail-closed operator error below.
    }

    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_RECORDING_FAILED",
      message:
        `Hosted RevNet repair broadcast transaction ${submission.payTxHash}, but recording it failed. ` +
        "Do not replay this issuance; inspect the existing transaction and persist it manually.",
      httpStatus: 503,
      retryable: false,
      details: {
        cause: error instanceof Error ? error.message : String(error),
        issuanceId: candidate.id,
        txHash: submission.payTxHash,
      },
    });
  }
}

const repairIssuanceSelect = {
  beneficiaryAddress: true,
  chainId: true,
  confirmedAt: true,
  createdAt: true,
  failureCode: true,
  failureMessage: true,
  id: true,
  idempotencyKey: true,
  memberId: true,
  payTxHash: true,
  paymentAmount: true,
  projectId: true,
  status: true,
  submittedAt: true,
  terminalAddress: true,
  updatedAt: true,
} as const;

function requireHostedRevnetRepairCandidate(input: {
  issuance: HostedRevnetRepairableIssuance;
  now: Date;
  staleAfterMs: number;
}): HostedRevnetRepairCandidate {
  const candidate = classifyHostedRevnetRepairCandidate(input);

  if (candidate) {
    return candidate;
  }

  throw hostedOnboardingError({
    code: "REVNET_ISSUANCE_NOT_REPAIRABLE",
    message: `Hosted RevNet issuance ${input.issuance.id} is not in a repairable state.`,
    httpStatus: 409,
  });
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

  if (
    input.issuance.status === HostedRevnetIssuanceStatus.submitting &&
    input.issuance.failureCode === REVNET_REPAIR_IN_PROGRESS_CODE &&
    input.issuance.updatedAt.getTime() <= input.now.getTime() - input.staleAfterMs
  ) {
    return {
      ...input.issuance,
      replayAllowedWithoutForce: false,
      repairCategory: "repair_in_progress_stale",
    };
  }

  if (
    input.issuance.status === HostedRevnetIssuanceStatus.submitting &&
    input.issuance.updatedAt.getTime() <= input.now.getTime() - input.staleAfterMs
  ) {
    return {
      ...input.issuance,
      replayAllowedWithoutForce: false,
      repairCategory: "submitting_stale",
    };
  }

  return null;
}

function requireHostedRevnetIssuanceBigInt(value: string, label: string): bigint {
  if (!/^\d+$/u.test(value)) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_INVALID",
      message: `${label} must be an unsigned integer string.`,
      httpStatus: 503,
      retryable: true,
    });
  }

  return BigInt(value);
}

function requireHostedRevnetIssuanceAddress(value: string, label: string) {
  const address = coerceHostedWalletAddress(value);

  if (!address) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_INVALID",
      message: `${label} must be a valid EVM address.`,
      httpStatus: 503,
      retryable: true,
    });
  }

  return address;
}

function serializeHostedRevnetIssuanceFailure(error: unknown): {
  code: string;
  message: string;
} {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const code = typeof error.code === "string" ? error.code : "REVNET_PAYMENT_FAILED";
    const message = typeof error.message === "string" ? error.message : "Unknown Hosted RevNet issuance failure.";
    return {
      code,
      message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "REVNET_PAYMENT_FAILED",
      message: error.message,
    };
  }

  return {
    code: "REVNET_PAYMENT_FAILED",
    message: "Unknown Hosted RevNet issuance failure.",
  };
}

function classifyHostedRevnetIssuanceFailure(error: unknown): {
  bucket: "broadcast_unknown" | "definitely_not_broadcast";
  code: string;
  message: string;
} {
  if (isHostedRevnetBroadcastStatusUnknownError(error)) {
    const failure = serializeHostedRevnetIssuanceFailure(error);

    return {
      bucket: "broadcast_unknown",
      code: REVNET_BROADCAST_STATUS_UNKNOWN_CODE,
      message: failure.message,
    };
  }

  const failure = serializeHostedRevnetIssuanceFailure(error);

  return {
    bucket: "definitely_not_broadcast",
    code: failure.code,
    message: failure.message,
  };
}
