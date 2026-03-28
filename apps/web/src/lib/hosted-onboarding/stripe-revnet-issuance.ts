import { REVNET_NATIVE_TOKEN } from "@cobuild/wire";
import {
  Prisma,
  type HostedMember,
  type HostedRevnetIssuance,
  type PrismaClient,
} from "@prisma/client";
import { HostedMemberStatus, HostedRevnetIssuanceStatus } from "@prisma/client";
import type Stripe from "stripe";

import { requireHostedMemberWalletAddressForRevnet } from "./billing-service";
import { coerceStripeObjectId } from "./billing";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  coerceHostedWalletAddress,
  convertStripeMinorAmountToRevnetPaymentAmount,
  isHostedRevnetBroadcastStatusUnknownError,
  isHostedOnboardingRevnetEnabled,
  requireHostedRevnetConfig,
  submitHostedRevnetPayment,
} from "./revnet";
import { generateHostedRevnetIssuanceId, normalizeNullableString } from "./shared";

const REVNET_BROADCAST_STATUS_UNKNOWN_CODE = "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN";
const REVNET_ISSUANCE_RECORDING_FAILED_CODE = "REVNET_ISSUANCE_RECORDING_FAILED";
const HOSTED_REVNET_SUBMITTING_STALE_MS = 5 * 60 * 1000;
const HOSTED_REVNET_RETRY_DELAYS_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
] as const;

type HostedRevnetIssuanceRecord = Pick<
  HostedRevnetIssuance,
  | "attemptCount"
  | "beneficiaryAddress"
  | "chainId"
  | "failureCode"
  | "id"
  | "idempotencyKey"
  | "nextAttemptAt"
  | "payTxHash"
  | "paymentAmount"
  | "projectId"
  | "status"
  | "stripeChargeId"
  | "stripeInvoiceId"
  | "stripePaymentIntentId"
  | "terminalAddress"
  | "updatedAt"
>;

type HostedRevnetIssuanceEligibility =
  | {
    kind: "skip";
    reason: "amount_paid_missing" | "member_suspended" | "revnet_disabled";
  }
  | {
    amountPaid: number;
    beneficiaryAddress: ReturnType<typeof requireHostedMemberWalletAddressForRevnet>;
    chargeId: string | null;
    config: ReturnType<typeof requireHostedRevnetConfig>;
    idempotencyKey: string;
    invoiceId: string;
    kind: "ready";
    memberId: string;
    paymentAmount: bigint;
    paymentIntentId: string | null;
    prisma: PrismaClient | Prisma.TransactionClient;
  };

type HostedRevnetIssuanceSubmissionState =
  | {
    issuance: HostedRevnetIssuanceRecord | null;
    kind: "skip";
    reason:
      | "broadcast_status_unknown"
      | "confirmed"
      | "missing"
      | "pay_tx_hash_recorded"
      | "submitted"
      | "submitting_recent"
      | "retry_scheduled";
  }
  | {
    issuance: HostedRevnetIssuanceRecord;
    kind: "ready";
  };

type HostedRevnetIssuanceClaimState =
  | {
    issuance: HostedRevnetIssuanceRecord;
    kind: "claimed";
  }
  | {
    issuance: HostedRevnetIssuanceRecord | null;
    kind: "skip";
    reason: Extract<HostedRevnetIssuanceSubmissionState, { kind: "skip" }>["reason"];
  };

export async function maybeIssueHostedRevnetForStripeInvoice(input: {
  invoice: Stripe.Invoice;
  member: HostedMember;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<void> {
  const issuance = await ensureHostedRevnetIssuanceForStripeInvoice(input);

  if (!issuance) {
    return;
  }

  const submissionState = loadHostedRevnetIssuanceSubmissionState(issuance);

  if (submissionState.kind === "skip") {
    return;
  }

  const claimState = await claimHostedRevnetIssuanceSubmission({
    idempotencyKey: issuance.idempotencyKey,
    invoiceId: issuance.stripeInvoiceId,
    issuance: submissionState.issuance,
    prisma: input.prisma,
  });

  if (claimState.kind === "skip") {
    return;
  }

  await submitAndPersistHostedRevnetIssuance({
    issuance: claimState.issuance,
    prisma: input.prisma,
  });
}

export async function ensureHostedRevnetIssuanceForStripeInvoice(input: {
  invoice: Stripe.Invoice;
  member: HostedMember;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedRevnetIssuanceRecord | null> {
  const eligibility = loadHostedRevnetIssuanceEligibility(input);

  if (eligibility.kind === "skip") {
    return null;
  }

  let issuance = await findOrCreateHostedRevnetIssuance(eligibility);
  return patchHostedRevnetIssuanceStripeReferencesIfNeeded({
    chargeId: eligibility.chargeId,
    issuance,
    paymentIntentId: eligibility.paymentIntentId,
    prisma: eligibility.prisma,
  });
}

export async function drainHostedRevnetIssuanceSubmissionQueue(input: {
  limit?: number;
  prisma: PrismaClient;
}): Promise<string[]> {
  const submittedIssuanceIds: string[] = [];
  const staleSubmittingThreshold = new Date(Date.now() - HOSTED_REVNET_SUBMITTING_STALE_MS);
  const issuances = await input.prisma.hostedRevnetIssuance.findMany({
    where: {
      payTxHash: null,
      OR: [
        {
          status: HostedRevnetIssuanceStatus.pending,
          nextAttemptAt: {
            lte: new Date(),
          },
        },
        {
          status: HostedRevnetIssuanceStatus.failed,
          nextAttemptAt: {
            lte: new Date(),
          },
        },
        {
          failureCode: null,
          status: HostedRevnetIssuanceStatus.submitting,
          updatedAt: {
            lte: staleSubmittingThreshold,
          },
        },
      ],
    },
    orderBy: [
      {
        createdAt: "asc",
      },
    ],
    take: input.limit ?? 25,
  });

  for (const issuance of issuances) {
    const submissionState = loadHostedRevnetIssuanceSubmissionState(issuance);

    if (submissionState.kind === "skip") {
      continue;
    }

    const claimState = await claimHostedRevnetIssuanceSubmission({
      idempotencyKey: issuance.idempotencyKey,
      invoiceId: issuance.stripeInvoiceId,
      issuance: submissionState.issuance,
      prisma: input.prisma,
    });

    if (claimState.kind === "skip") {
      continue;
    }

    try {
      await submitAndPersistHostedRevnetIssuance({
        issuance: claimState.issuance,
        prisma: input.prisma,
      });
      submittedIssuanceIds.push(claimState.issuance.id);
    } catch (error) {
      if (
        isHostedOnboardingError(error) &&
        error.code === REVNET_ISSUANCE_RECORDING_FAILED_CODE
      ) {
        continue;
      }

      throw error;
    }
  }

  return submittedIssuanceIds;
}

function buildHostedRevnetPaymentMemo(issuanceId: string): string {
  return `issuance:${issuanceId}`;
}

function isHostedRevnetIssuanceSubmittingStale(updatedAt: Date): boolean {
  return updatedAt.getTime() <= Date.now() - HOSTED_REVNET_SUBMITTING_STALE_MS;
}

function computeHostedRevnetNextAttemptAt(attemptCount: number, now = new Date()): Date {
  const delayMs =
    HOSTED_REVNET_RETRY_DELAYS_MS[
      Math.min(Math.max(attemptCount - 1, 0), HOSTED_REVNET_RETRY_DELAYS_MS.length - 1)
    ];
  return new Date(now.getTime() + delayMs);
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
  if (isHostedOnboardingError(error)) {
    return {
      code: error.code,
      message: error.message,
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

function isHostedRevnetIssuanceBroadcastStatusUnknown(issuance: HostedRevnetIssuanceRecord): boolean {
  return (
    issuance.status === HostedRevnetIssuanceStatus.submitting &&
    issuance.failureCode === REVNET_BROADCAST_STATUS_UNKNOWN_CODE
  );
}

function loadHostedRevnetIssuanceEligibility(input: {
  invoice: Stripe.Invoice;
  member: HostedMember;
  prisma: PrismaClient | Prisma.TransactionClient;
}): HostedRevnetIssuanceEligibility {
  if (input.member.status === HostedMemberStatus.suspended) {
    return {
      kind: "skip",
      reason: "member_suspended",
    };
  }

  if (!isHostedOnboardingRevnetEnabled()) {
    return {
      kind: "skip",
      reason: "revnet_disabled",
    };
  }

  const amountPaid = typeof input.invoice.amount_paid === "number" ? input.invoice.amount_paid : 0;

  if (amountPaid < 1) {
    return {
      kind: "skip",
      reason: "amount_paid_missing",
    };
  }

  const config = requireHostedRevnetConfig();
  const invoiceCurrency = normalizeNullableString(input.invoice.currency)?.toLowerCase() ?? null;

  if (invoiceCurrency && invoiceCurrency !== config.stripeCurrency) {
    throw hostedOnboardingError({
      code: "REVNET_PAYMENT_CURRENCY_MISMATCH",
      message: `Stripe invoice ${input.invoice.id} used ${invoiceCurrency}, but Hosted RevNet issuance is configured for ${config.stripeCurrency}.`,
      httpStatus: 502,
    });
  }

  return {
    amountPaid,
    beneficiaryAddress: requireHostedMemberWalletAddressForRevnet(input.member),
    chargeId: coerceStripeObjectId(
      (input.invoice as Stripe.Invoice & { charge?: string | { id?: unknown } | null }).charge ?? null,
    ),
    config,
    idempotencyKey: `stripe:invoice:${input.invoice.id}`,
    invoiceId: input.invoice.id,
    kind: "ready",
    memberId: input.member.id,
    paymentAmount: convertStripeMinorAmountToRevnetPaymentAmount(
      amountPaid,
      config.weiPerStripeMinorUnit,
    ),
    paymentIntentId: coerceStripeObjectId(
      (input.invoice as Stripe.Invoice & { payment_intent?: string | { id?: unknown } | null }).payment_intent ??
        null,
    ),
    prisma: input.prisma,
  };
}

function loadHostedRevnetIssuanceSubmissionState(
  issuance: HostedRevnetIssuanceRecord | null,
): HostedRevnetIssuanceSubmissionState {
  if (!issuance) {
    return {
      issuance,
      kind: "skip",
      reason: "missing",
    };
  }

  if (issuance.status === HostedRevnetIssuanceStatus.confirmed) {
    return {
      issuance,
      kind: "skip",
      reason: "confirmed",
    };
  }

  if (issuance.status === HostedRevnetIssuanceStatus.submitted) {
    return {
      issuance,
      kind: "skip",
      reason: "submitted",
    };
  }

  if (issuance.payTxHash) {
    return {
      issuance,
      kind: "skip",
      reason: "pay_tx_hash_recorded",
    };
  }

  if (isHostedRevnetIssuanceBroadcastStatusUnknown(issuance)) {
    return {
      issuance,
      kind: "skip",
      reason: "broadcast_status_unknown",
    };
  }

  if (
    (issuance.status === HostedRevnetIssuanceStatus.pending ||
      issuance.status === HostedRevnetIssuanceStatus.failed) &&
    issuance.nextAttemptAt.getTime() > Date.now()
  ) {
    return {
      issuance,
      kind: "skip",
      reason: "retry_scheduled",
    };
  }

  if (
    issuance.status === HostedRevnetIssuanceStatus.submitting &&
    !isHostedRevnetIssuanceSubmittingStale(issuance.updatedAt)
  ) {
    return {
      issuance,
      kind: "skip",
      reason: "submitting_recent",
    };
  }

  return {
    issuance,
    kind: "ready",
  };
}

async function findOrCreateHostedRevnetIssuance(
  input: Extract<HostedRevnetIssuanceEligibility, { kind: "ready" }>,
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
        paymentAssetAddress: REVNET_NATIVE_TOKEN,
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

async function patchHostedRevnetIssuanceStripeReferencesIfNeeded(input: {
  chargeId: string | null;
  issuance: HostedRevnetIssuanceRecord;
  paymentIntentId: string | null;
  prisma: PrismaClient | Prisma.TransactionClient;
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

async function claimHostedRevnetIssuanceSubmission(input: {
  idempotencyKey: string;
  invoiceId: string;
  issuance: HostedRevnetIssuanceRecord;
  prisma: PrismaClient | Prisma.TransactionClient;
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

async function submitAndPersistHostedRevnetIssuance(input: {
  issuance: HostedRevnetIssuanceRecord;
  prisma: PrismaClient | Prisma.TransactionClient;
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
        `Hosted RevNet issuance broadcast transaction ${submission.payTxHash}, but recording it failed. ` +
        "Do not replay this issuance automatically; inspect the existing transaction and recover it through repair tooling.",
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
  prisma: PrismaClient | Prisma.TransactionClient;
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
      status: failure.bucket === "broadcast_unknown"
        ? HostedRevnetIssuanceStatus.submitting
        : HostedRevnetIssuanceStatus.failed,
    },
  });
}
