import {
  Prisma,
  HostedRevnetIssuanceStatus,
} from "@prisma/client";

import { hostedOnboardingError } from "./errors";
import { generateHostedRevnetIssuanceId } from "./shared";
import { submitHostedRevnetPayment } from "./revnet";
import type { HostedOnboardingReadClient } from "./shared";
import {
  HOSTED_REVNET_PAYMENT_ASSET_ADDRESS,
  REVNET_ISSUANCE_RECORDING_FAILED_CODE,
  buildHostedRevnetPaymentMemo,
  classifyHostedRevnetIssuanceFailure,
  computeHostedRevnetNextAttemptAt,
  loadHostedRevnetIssuanceSubmissionState,
  requireHostedRevnetIssuanceAddress,
  requireHostedRevnetIssuanceBigInt,
  type HostedRevnetIssuanceClaimState,
  type HostedRevnetIssuanceEligibilityReady,
  type HostedRevnetIssuanceRecord,
} from "./stripe-revnet-issuance-state";

export async function findOrCreateHostedRevnetIssuance(
  input: HostedRevnetIssuanceEligibilityReady,
): Promise<HostedRevnetIssuanceRecord> {
  const existingIssuance = await input.prisma.hostedRevnetIssuance.findUnique({
    where: {
      idempotencyKey: input.idempotencyKey,
    },
  });
  if (existingIssuance) {
    return existingIssuance;
  }

  try {
    return await input.prisma.hostedRevnetIssuance.create({
      data: {
        id: generateHostedRevnetIssuanceId(),
        memberId: input.memberId,
        idempotencyKey: input.idempotencyKey,
        stripeInvoiceId: input.invoiceId,
        stripePaymentIntentId: input.paymentIntentId,
        stripeChargeId: input.chargeId,
        chainId: input.config.chainId,
        projectId: input.config.projectId.toString(),
        terminalAddress: input.config.terminalAddress,
        paymentAssetAddress: HOSTED_REVNET_PAYMENT_ASSET_ADDRESS,
        beneficiaryAddress: input.beneficiaryAddress.toLowerCase(),
        stripePaymentAmountMinor: input.amountPaid,
        stripePaymentCurrency: input.config.stripeCurrency,
        paymentAmount: input.paymentAmount.toString(),
        attemptCount: 0,
        nextAttemptAt: new Date(),
        status: HostedRevnetIssuanceStatus.pending,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const issuance = await input.prisma.hostedRevnetIssuance.findUnique({
        where: {
          idempotencyKey: input.idempotencyKey,
        },
      });

      if (issuance) {
        return issuance;
      }
    }

    throw error;
  }
}

export async function patchHostedRevnetIssuanceStripeReferencesIfNeeded(input: {
  chargeId: string | null;
  issuance: HostedRevnetIssuanceRecord;
  paymentIntentId: string | null;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedRevnetIssuanceRecord> {
  const updateData: {
    stripeChargeId?: string;
    stripePaymentIntentId?: string;
  } = {};

  if (!input.issuance.stripePaymentIntentId && input.paymentIntentId) {
    updateData.stripePaymentIntentId = input.paymentIntentId;
  }

  if (!input.issuance.stripeChargeId && input.chargeId) {
    updateData.stripeChargeId = input.chargeId;
  }

  if (Object.keys(updateData).length === 0) {
    return input.issuance;
  }

  if (typeof input.prisma.hostedRevnetIssuance.update !== "function") {
    return {
      ...input.issuance,
      ...updateData,
    };
  }

  return input.prisma.hostedRevnetIssuance.update({
    where: {
      id: input.issuance.id,
    },
    data: updateData,
  });
}

export async function claimHostedRevnetIssuanceSubmission(input: {
  idempotencyKey: string;
  invoiceId: string;
  issuance: HostedRevnetIssuanceRecord;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedRevnetIssuanceClaimState> {
  const claimedIssuance = await input.prisma.hostedRevnetIssuance.updateMany({
    where: {
      id: input.issuance.id,
      status: input.issuance.status,
      updatedAt: input.issuance.updatedAt,
    },
    data: {
      attemptCount: {
        increment: 1,
      },
      status: HostedRevnetIssuanceStatus.submitting,
      failureCode: null,
      failureMessage: null,
      nextAttemptAt: new Date(),
    },
  });

  if (claimedIssuance.count === 1) {
    return {
      issuance: input.issuance,
      kind: "claimed",
    };
  }

  const latestIssuance = await input.prisma.hostedRevnetIssuance.findUnique({
    where: {
      idempotencyKey: input.idempotencyKey,
    },
  });
  const latestSubmissionState = loadHostedRevnetIssuanceSubmissionState(latestIssuance);
  if (latestSubmissionState.kind === "skip") {
    return latestSubmissionState;
  }

  throw hostedOnboardingError({
    code: "REVNET_ISSUANCE_CLAIM_FAILED",
    message: `Hosted RevNet issuance could not be claimed safely for Stripe invoice ${input.invoiceId}.`,
    httpStatus: 503,
    retryable: true,
  });
}

export async function submitAndPersistHostedRevnetIssuance(input: {
  issuance: HostedRevnetIssuanceRecord;
  prisma: HostedOnboardingReadClient;
}): Promise<void> {
  let submission;

  try {
    submission = await submitHostedRevnetPayment({
      beneficiaryAddress: requireHostedRevnetIssuanceAddress(
        input.issuance.beneficiaryAddress,
        "Hosted RevNet issuance beneficiary address",
      ),
      chainId: input.issuance.chainId,
      memo: buildHostedRevnetPaymentMemo(input.issuance.id),
      paymentAmount: requireHostedRevnetIssuanceBigInt(
        input.issuance.paymentAmount,
        "Hosted RevNet issuance payment amount",
      ),
      projectId: requireHostedRevnetIssuanceBigInt(
        input.issuance.projectId,
        "Hosted RevNet issuance project id",
      ),
      terminalAddress: requireHostedRevnetIssuanceAddress(
        input.issuance.terminalAddress,
        "Hosted RevNet issuance terminal address",
      ),
    });
  } catch (error) {
    await persistHostedRevnetIssuanceSubmissionFailure({
      attemptCount: input.issuance.attemptCount + 1,
      error,
      issuanceId: input.issuance.id,
      prisma: input.prisma,
    });
    return;
  }

  const recordSubmissionData = {
    failureCode: null,
    failureMessage: null,
    nextAttemptAt: new Date(),
    payTxHash: submission.payTxHash,
    status: HostedRevnetIssuanceStatus.submitted,
    submittedAt: new Date(),
  } as const;

  try {
    await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: input.issuance.id,
      },
      data: recordSubmissionData,
    });
  } catch (error) {
    try {
      const fallback = await input.prisma.hostedRevnetIssuance.updateMany({
        where: {
          id: input.issuance.id,
          payTxHash: null,
          status: HostedRevnetIssuanceStatus.submitting,
        },
        data: recordSubmissionData,
      });

      if (fallback.count === 1) {
        return;
      }
    } catch {
      // Fall through to the fail-closed operator error below.
    }

    throw hostedOnboardingError({
      code: REVNET_ISSUANCE_RECORDING_FAILED_CODE,
      message:
        `Hosted RevNet issuance broadcast transaction ${submission.payTxHash}, ` +
        "but recording it failed. Do not replay this issuance automatically; " +
        "inspect the existing transaction and recover it through repair tooling.",
      httpStatus: 503,
      retryable: false,
      details: {
        cause: error instanceof Error ? error.message : String(error),
        issuanceId: input.issuance.id,
        txHash: submission.payTxHash,
      },
    });
  }
}

async function persistHostedRevnetIssuanceSubmissionFailure(input: {
  attemptCount: number;
  error: unknown;
  issuanceId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<void> {
  const failure = classifyHostedRevnetIssuanceFailure(input.error);

  await input.prisma.hostedRevnetIssuance.update({
    where: {
      id: input.issuanceId,
    },
    data: {
      failureCode: failure.code,
      failureMessage: failure.message,
      nextAttemptAt:
        failure.bucket === "broadcast_unknown"
          ? new Date()
          : computeHostedRevnetNextAttemptAt(input.attemptCount),
      status:
        failure.bucket === "broadcast_unknown"
          ? HostedRevnetIssuanceStatus.submitting
          : HostedRevnetIssuanceStatus.failed,
    },
  });
}
