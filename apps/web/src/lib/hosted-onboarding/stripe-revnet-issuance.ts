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
const HOSTED_REVNET_SUBMITTING_STALE_MS = 5 * 60 * 1000;

type HostedRevnetIssuanceRecord = Pick<
  HostedRevnetIssuance,
  | "beneficiaryAddress"
  | "chainId"
  | "failureCode"
  | "id"
  | "idempotencyKey"
  | "payTxHash"
  | "paymentAmount"
  | "projectId"
  | "status"
  | "stripeChargeId"
  | "stripePaymentIntentId"
  | "terminalAddress"
  | "updatedAt"
>;

export async function maybeIssueHostedRevnetForStripeInvoice(input: {
  invoice: Stripe.Invoice;
  member: HostedMember;
  prisma: PrismaClient;
}): Promise<void> {
  if (input.member.status === HostedMemberStatus.suspended) {
    return;
  }

  if (!isHostedOnboardingRevnetEnabled()) {
    return;
  }

  const amountPaid = typeof input.invoice.amount_paid === "number" ? input.invoice.amount_paid : 0;

  if (amountPaid < 1) {
    return;
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

  const beneficiaryAddress = requireHostedMemberWalletAddressForRevnet(input.member);
  const idempotencyKey = `stripe:invoice:${input.invoice.id}`;
  const paymentAmount = convertStripeMinorAmountToRevnetPaymentAmount(
    amountPaid,
    config.weiPerStripeMinorUnit,
  );
  const paymentIntentId = coerceStripeObjectId(
    (input.invoice as Stripe.Invoice & { payment_intent?: string | { id?: unknown } | null }).payment_intent ??
      null,
  );
  const chargeId = coerceStripeObjectId(
    (input.invoice as Stripe.Invoice & { charge?: string | { id?: unknown } | null }).charge ?? null,
  );

  let issuance = await findOrCreateHostedRevnetIssuance({
    amountPaid,
    beneficiaryAddress,
    chargeId,
    config,
    idempotencyKey,
    invoiceId: input.invoice.id,
    memberId: input.member.id,
    paymentAmount,
    paymentIntentId,
    prisma: input.prisma,
  });

  issuance = await patchHostedRevnetIssuanceStripeReferences({
    chargeId,
    issuance,
    paymentIntentId,
    prisma: input.prisma,
  });

  if (shouldSkipHostedRevnetIssuanceSubmission(issuance)) {
    return;
  }

  const claimedIssuance = await input.prisma.hostedRevnetIssuance.updateMany({
    where: {
      id: issuance.id,
      status: issuance.status,
      updatedAt: issuance.updatedAt,
    },
    data: {
      status: HostedRevnetIssuanceStatus.submitting,
      failureCode: null,
      failureMessage: null,
    },
  });

  if (claimedIssuance.count !== 1) {
    const latestIssuance = await input.prisma.hostedRevnetIssuance.findUnique({
      where: {
        idempotencyKey,
      },
    });

    if (shouldSkipHostedRevnetIssuanceSubmission(latestIssuance)) {
      return;
    }

    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_CLAIM_FAILED",
      message: `Hosted RevNet issuance could not be claimed safely for Stripe invoice ${input.invoice.id}.`,
      httpStatus: 503,
      retryable: true,
    });
  }

  try {
    const submission = await submitHostedRevnetPayment({
      beneficiaryAddress: requireHostedRevnetIssuanceAddress(
        issuance.beneficiaryAddress,
        "Hosted RevNet issuance beneficiary address",
      ),
      chainId: issuance.chainId,
      memo: buildHostedRevnetPaymentMemo(issuance.id),
      paymentAmount: requireHostedRevnetIssuanceBigInt(
        issuance.paymentAmount,
        "Hosted RevNet issuance payment amount",
      ),
      projectId: requireHostedRevnetIssuanceBigInt(
        issuance.projectId,
        "Hosted RevNet issuance project id",
      ),
      terminalAddress: requireHostedRevnetIssuanceAddress(
        issuance.terminalAddress,
        "Hosted RevNet issuance terminal address",
      ),
    });

    await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: issuance.id,
      },
      data: {
        failureCode: null,
        failureMessage: null,
        payTxHash: submission.payTxHash,
        status: HostedRevnetIssuanceStatus.submitted,
        submittedAt: new Date(),
      },
    });
  } catch (error) {
    const failure = classifyHostedRevnetIssuanceFailure(error);

    await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: issuance.id,
      },
      data: {
        failureCode: failure.code,
        failureMessage: failure.message,
        status: failure.bucket === "broadcast_unknown"
          ? HostedRevnetIssuanceStatus.submitting
          : HostedRevnetIssuanceStatus.failed,
      },
    });
  }
}

function buildHostedRevnetPaymentMemo(issuanceId: string): string {
  return `issuance:${issuanceId}`;
}

function isHostedRevnetIssuanceSubmittingStale(updatedAt: Date): boolean {
  return updatedAt.getTime() <= Date.now() - HOSTED_REVNET_SUBMITTING_STALE_MS;
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

function shouldSkipHostedRevnetIssuanceSubmission(
  issuance: HostedRevnetIssuanceRecord | null,
): boolean {
  return Boolean(
    !issuance ||
      issuance.status === HostedRevnetIssuanceStatus.confirmed ||
      issuance.status === HostedRevnetIssuanceStatus.submitted ||
      issuance.payTxHash ||
      isHostedRevnetIssuanceBroadcastStatusUnknown(issuance) ||
      (issuance.status === HostedRevnetIssuanceStatus.submitting &&
        !isHostedRevnetIssuanceSubmittingStale(issuance.updatedAt)),
  );
}

async function findOrCreateHostedRevnetIssuance(input: {
  amountPaid: number;
  beneficiaryAddress: ReturnType<typeof requireHostedMemberWalletAddressForRevnet>;
  chargeId: string | null;
  config: ReturnType<typeof requireHostedRevnetConfig>;
  idempotencyKey: string;
  invoiceId: string;
  memberId: string;
  paymentAmount: bigint;
  paymentIntentId: string | null;
  prisma: PrismaClient;
}): Promise<HostedRevnetIssuanceRecord> {
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

async function patchHostedRevnetIssuanceStripeReferences(input: {
  chargeId: string | null;
  issuance: HostedRevnetIssuanceRecord;
  paymentIntentId: string | null;
  prisma: PrismaClient;
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

  return input.prisma.hostedRevnetIssuance.update({
    where: {
      id: input.issuance.id,
    },
    data: updateData,
  });
}
