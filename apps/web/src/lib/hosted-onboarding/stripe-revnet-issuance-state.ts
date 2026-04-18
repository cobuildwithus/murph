import { REVNET_NATIVE_TOKEN } from "@cobuild/wire";
import {
  HostedRevnetIssuanceStatus,
  type HostedRevnetIssuance,
} from "@prisma/client";
import type Stripe from "stripe";

import { requireHostedMemberWalletAddressForRevnet } from "./billing-service";
import { coerceStripeObjectId } from "./billing";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import type { HostedMemberSnapshot } from "./hosted-member-store";
import {
  coerceHostedWalletAddress,
  convertStripeMinorAmountToRevnetPaymentAmount,
  isHostedRevnetBroadcastStatusUnknownError,
  isHostedOnboardingRevnetEnabled,
  requireHostedRevnetConfig,
} from "./revnet";
import {
  type HostedOnboardingReadClient,
  normalizeNullableString,
} from "./shared";

export const REVNET_BROADCAST_STATUS_UNKNOWN_CODE =
  "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN";
export const REVNET_ISSUANCE_RECORDING_FAILED_CODE =
  "REVNET_ISSUANCE_RECORDING_FAILED";

const HOSTED_REVNET_SUBMITTING_STALE_MS = 5 * 60 * 1000;
const HOSTED_REVNET_RETRY_DELAYS_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
] as const;

export type HostedRevnetIssuanceRecord = Pick<
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

export type HostedRevnetIssuanceEligibility =
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
      prisma: HostedOnboardingReadClient;
    };

export type HostedRevnetIssuanceEligibilityReady = Extract<
  HostedRevnetIssuanceEligibility,
  { kind: "ready" }
>;

export type HostedRevnetIssuanceSubmissionState =
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

export type HostedRevnetIssuanceClaimState =
  | {
      issuance: HostedRevnetIssuanceRecord;
      kind: "claimed";
    }
  | {
      issuance: HostedRevnetIssuanceRecord | null;
      kind: "skip";
      reason: Extract<HostedRevnetIssuanceSubmissionState, { kind: "skip" }>["reason"];
    };

export function computeHostedRevnetNextAttemptAt(
  attemptCount: number,
  now = new Date(),
): Date {
  const delayMs =
    HOSTED_REVNET_RETRY_DELAYS_MS[
      Math.min(Math.max(attemptCount - 1, 0), HOSTED_REVNET_RETRY_DELAYS_MS.length - 1)
    ];
  return new Date(now.getTime() + delayMs);
}

export function buildHostedRevnetPaymentMemo(issuanceId: string): string {
  return `issuance:${issuanceId}`;
}

export function requireHostedRevnetIssuanceBigInt(value: string, label: string): bigint {
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

export function requireHostedRevnetIssuanceAddress(value: string, label: string) {
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

export function classifyHostedRevnetIssuanceFailure(error: unknown): {
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

export function loadHostedRevnetIssuanceEligibility(input: {
  invoice: Stripe.Invoice;
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingReadClient;
}): HostedRevnetIssuanceEligibility {
  if (input.member.core.suspendedAt) {
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
      message:
        `Stripe invoice ${input.invoice.id} used ${invoiceCurrency}, ` +
        `but Hosted RevNet issuance is configured for ${config.stripeCurrency}.`,
      httpStatus: 502,
    });
  }

  return {
    amountPaid,
    beneficiaryAddress: requireHostedMemberWalletAddressForRevnet({
      id: input.member.core.id,
      walletAddress: input.member.identity?.walletAddress ?? null,
    }),
    chargeId: coerceStripeObjectId(
      (input.invoice as Stripe.Invoice & { charge?: string | { id?: unknown } | null }).charge ??
        null,
    ),
    config,
    idempotencyKey: `stripe:invoice:${input.invoice.id}`,
    invoiceId: input.invoice.id,
    kind: "ready",
    memberId: input.member.core.id,
    paymentAmount: convertStripeMinorAmountToRevnetPaymentAmount(
      amountPaid,
      config.weiPerStripeMinorUnit,
    ),
    paymentIntentId: coerceStripeObjectId(
      (
        input.invoice as Stripe.Invoice & {
          payment_intent?: string | { id?: unknown } | null;
        }
      ).payment_intent ?? null,
    ),
    prisma: input.prisma,
  };
}

export function loadHostedRevnetIssuanceSubmissionState(
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

function isHostedRevnetIssuanceSubmittingStale(updatedAt: Date): boolean {
  return updatedAt.getTime() <= Date.now() - HOSTED_REVNET_SUBMITTING_STALE_MS;
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

function isHostedRevnetIssuanceBroadcastStatusUnknown(
  issuance: HostedRevnetIssuanceRecord,
): boolean {
  return (
    issuance.status === HostedRevnetIssuanceStatus.submitting &&
    issuance.failureCode === REVNET_BROADCAST_STATUS_UNKNOWN_CODE
  );
}

export const HOSTED_REVNET_PAYMENT_ASSET_ADDRESS = REVNET_NATIVE_TOKEN;
