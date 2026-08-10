import type Stripe from "stripe";

import {
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripePriceLookupKey,
} from "./contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { hasHostedMemberOwnPaidBilling } from "./entitlement";
import {
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
} from "./usage-credit-capacity-conflict";
import { ensureHostedMemberStripeCustomer } from "./hosted-member-stripe-customer";
import { readHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import { readHostedMemberBillingSnapshot } from "./hosted-member-store";
import {
  hasHostedAccountGroupAccess,
  readHostedAccountGroupStripeBillingRef,
  resolveHostedFamilyUsageCreditCheckoutTargetTx,
  type HostedFamilyUsageCreditCheckoutTarget,
} from "./family-plan";
import {
  readHostedConfiguredUsageCreditOfferCodes,
  readHostedPersonalUsageCreditOfferCodes,
} from "./personal-usage-credit-eligibility";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApiMode,
  requireHostedStripeUsageCreditCheckoutConfig,
} from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";
import {
  filterHostedNonGroupUsageCreditOfferCodes,
  getHostedUsageCreditOfferDefinition,
  hostedUsageCreditPolicySupportsSavedCardTarget,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  parseHostedUsageCreditCheckoutRequestPolicyVersion,
  parseHostedGroupSponsorshipOfferCode,
  parseHostedUsageCreditOfferCode,
  type HostedGroupSponsorshipOfferCode,
  type HostedUsageCreditOfferCode,
} from "./usage-credit-offers";
import {
  buildHostedUsageCreditPurchaseNotFoundError,
  canRetryHostedUsageCreditCheckoutCreate,
  canRetryHostedUsageCreditSavedCardPayment,
  closeExpiredUnattachedHostedUsageCreditPurchasesTx,
  projectHostedUsageCreditCheckoutCapability,
  projectHostedUsageCreditPurchaseStatusResult,
  projectHostedUsageCreditPurchaseTarget,
  type HostedUsageCreditCheckoutResult,
  type HostedUsageCreditPurchaseTargetProjection,
} from "./usage-credit-purchase-status-service";
import {
  lockHostedUsageCreditPurchaseReservationOwnersTx,
} from "./usage-credit-purchase-reservation-lock";
import {
  assertHostedUsageCreditStripePriceMatchesPurchase,
  assertHostedUsageCreditStripeSessionMatchesPurchase,
  buildHostedUsageCreditCheckoutIdempotencyKey,
  buildHostedUsageCreditInvariantError,
  decryptHostedUsageCreditPurchaseStripeField,
  describeSafeHostedUsageCreditStripeError,
  encryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
  reconstructHostedUsageCreditStripeCheckoutRequest,
  requireHostedUsageCreditEncryptedValue,
  requireHostedUsageCreditLookupKey,
  requireHostedUsageCreditPurchasePayerMemberId,
} from "./usage-credit-purchase-stripe";
import {
  buildHostedStripeAlertCorrelationCause,
  isHostedStripeProviderError,
  logHostedStripeFailure,
  reportHostedStripeOperationFailure,
} from "./stripe-error-log";
import {
  tryChargeHostedUsageCreditSavedCard,
  type HostedUsageCreditSavedCardBillingAuthority,
} from "./usage-credit-saved-card-payment";
import { readHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import {
  readHostedUsageCreditGrantCapacityTx,
} from "../hosted-execution/usage-credit-grant-capacity";
import {
  lockHostedUsageCreditBeneficiaryTx,
  type LockedHostedUsageCreditBeneficiary,
} from "../hosted-execution/usage-credit-ledger";
import {
  classifyHostedGroupUsageCapacity,
} from "../hosted-groups/group-usage-capacity";
import {
  buildHostedGroupUsageFundingPath,
  normalizeHostedGroupUsageFundingLocator,
  readHostedGroupUsageFundingLocatorRuntimeMemberId,
  readHostedGroupUsageFundingTargetByLocator,
} from "../hosted-groups/group-usage-funding";
import {
  createHostedGroupSponsorshipAuthorizationTx,
  parseHostedGroupSponsorshipMonthlyCapMinor,
  prepareHostedGroupSponsorshipRecoveryTx,
  type HostedGroupSponsorshipMonthlyCapMinor,
  type HostedGroupSponsorshipPaymentAuthority,
} from "../hosted-groups/group-sponsorship-authorization";
import {
  assertHostedGroupSponsorshipRequestMatchesTx,
  createHostedGroupSponsorshipMomentTx,
  hasHostedGroupSponsorshipCustomizationAuthority,
  hostedGroupSponsorshipRequestMatchesTx,
  parseHostedGroupSponsorshipDraft,
  type HostedGroupSponsorshipDraft,
} from "../hosted-groups/group-sponsorship-store";
import {
  readHostedConfiguredGroupSponsorshipOfferCodes,
} from "../hosted-groups/group-sponsorship-policy";
import { hasHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { generateHostedRandomPrefixedId } from "../primitives";
import { getPrisma } from "../prisma";

export {
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
  closeHostedUsageCreditPurchasesForAccountDeletion,
} from "./usage-credit-purchase-account-deletion";
export {
  expireHostedUsageCreditCheckout,
  HOSTED_USAGE_CREDIT_PUBLIC_PURCHASE_STATUSES,
  readHostedActiveUsageCreditPurchaseForPayer,
  readHostedUsageCreditPurchaseTargetForPayer,
  readHostedUsageCreditPurchaseStatus,
} from "./usage-credit-purchase-status-service";
export type {
  HostedActiveUsageCreditPurchaseProjection,
  HostedUsageCreditCheckoutResult,
  HostedUsageCreditPublicPurchaseStatus,
  HostedUsageCreditPurchaseStatusResult,
  HostedUsageCreditSelectionConflict,
  HostedUsageCreditPurchaseTargetProjection,
} from "./usage-credit-purchase-status-service";
export {
  buildHostedUsageCreditCheckoutMetadata,
  decryptHostedUsageCreditPurchaseStripeField,
  encryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
} from "./usage-credit-purchase-stripe";
export type {
  HostedUsageCreditPurchaseStripePrivateField,
} from "./usage-credit-purchase-stripe";

const HOSTED_USAGE_CREDIT_CHECKOUT_EXPIRY_DURATION_MS = 90 * 60 * 1_000;
const HOSTED_USAGE_CREDIT_CLIENT_REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

const HOSTED_USAGE_CREDIT_NONTERMINAL_PURCHASE_STATUSES = [
  HostedUsageCreditPurchaseStatus.created,
  HostedUsageCreditPurchaseStatus.checkout_open,
  HostedUsageCreditPurchaseStatus.payment_pending,
] as const;

class HostedGroupUsageCreditCustomerRequiredError extends Error {
  constructor() {
    super("Hosted group usage-credit checkout requires a Stripe Customer.");
    this.name = "HostedGroupUsageCreditCustomerRequiredError";
  }
}

function canContinueHostedUsageCreditPurchase(
  status: HostedUsageCreditPurchaseStatus,
): boolean {
  return status === HostedUsageCreditPurchaseStatus.created
    || status === HostedUsageCreditPurchaseStatus.checkout_open
    || status === HostedUsageCreditPurchaseStatus.payment_pending;
}

export interface HostedUsageCreditCheckoutRequest {
  clientRequestKey: string;
  offerCode: HostedUsageCreditOfferCode;
  recoveryOnly: boolean;
}

export interface HostedUsageCreditCheckoutRecoveryMiss {
  recoveryMiss: true;
}

export type HostedUsageCreditCheckoutAttemptResult =
  | HostedUsageCreditCheckoutRecoveryMiss
  | HostedUsageCreditCheckoutResult;

interface HostedUsageCreditCheckoutCommonInput {
  clientRequestKey: string;
  now?: Date;
  offerCode: HostedUsageCreditOfferCode;
  prisma?: PrismaClient;
}

interface HostedPersonalUsageCreditCheckoutInput
  extends HostedUsageCreditCheckoutCommonInput {
  memberId: string;
}

export type HostedGroupSponsorshipCheckoutKind = "monthly" | "one_time";

interface HostedGroupUsageCreditCheckoutInput
  extends HostedUsageCreditCheckoutCommonInput {
  joinCode: string;
  monthlyCapMinor?: HostedGroupSponsorshipMonthlyCapMinor;
  payerMemberId: string;
  sponsorship?: HostedGroupSponsorshipDraft | null;
  sponsorshipKind?: HostedGroupSponsorshipCheckoutKind;
}

interface HostedFamilyUsageCreditCheckoutInput
  extends HostedUsageCreditCheckoutCommonInput {
  beneficiaryMemberId: string;
  payerMemberId: string;
}

export interface HostedGroupSponsorshipCheckoutRequest {
  clientRequestKey: string;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor | null;
  offerCode: HostedGroupSponsorshipOfferCode;
  recoveryOnly: boolean;
  sponsorship: HostedGroupSponsorshipDraft | null;
  sponsorshipKind: HostedGroupSponsorshipCheckoutKind;
}

type HostedUsageCreditCheckoutTarget =
  | {
      beneficiaryMemberId: string;
      kind: "personal";
      payerMemberId: string;
    }
  | {
      beneficiaryMemberId: string;
      joinCode: string;
      kind: "group";
      payerMemberId: string;
    }
  | {
      beneficiaryMemberId: string;
      groupId: string | null;
      kind: "family";
      payerMemberId: string;
    };

export function parseHostedUsageCreditCheckoutRequest(
  value: Record<string, unknown>,
): HostedUsageCreditCheckoutRequest {
  const keys = Object.keys(value).sort();
  const recoveryOnly = value.recoveryOnly === true;
  if (
    keys.length !== (recoveryOnly ? 3 : 2) ||
    keys[0] !== "clientRequestKey" ||
    keys[1] !== "offerCode" ||
    (recoveryOnly && keys[2] !== "recoveryOnly")
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_CHECKOUT_INVALID_REQUEST",
      httpStatus: 400,
      message: "Usage-credit checkout requires an offer and request key.",
    });
  }

  const offerCode = parseHostedUsageCreditOfferCode(value.offerCode);
  if (!offerCode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_OFFER_INVALID",
      httpStatus: 400,
      message: "Choose an available usage-credit offer.",
    });
  }

  const clientRequestKey = value.clientRequestKey;
  if (
    typeof clientRequestKey !== "string" ||
    !HOSTED_USAGE_CREDIT_CLIENT_REQUEST_KEY_PATTERN.test(clientRequestKey)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_CLIENT_REQUEST_KEY_INVALID",
      httpStatus: 400,
      message: "Start a fresh usage-credit checkout request.",
    });
  }

  return {
    clientRequestKey,
    offerCode,
    recoveryOnly,
  };
}

export function parseHostedGroupSponsorshipCheckoutRequest(
  value: Record<string, unknown>,
): HostedGroupSponsorshipCheckoutRequest {
  const keys = Object.keys(value);
  if (
    keys.some((key) =>
      key !== "clientRequestKey" &&
      key !== "monthlyCapMinor" &&
      key !== "offerCode" &&
      key !== "recoveryOnly" &&
      key !== "sponsorship" &&
      key !== "sponsorshipKind"
    ) ||
    !keys.includes("clientRequestKey") ||
    !keys.includes("offerCode")
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_CHECKOUT_INVALID_REQUEST",
      httpStatus: 400,
      message: "Group sponsorship requires an offer and request key.",
    });
  }
  const base = parseHostedUsageCreditCheckoutRequest({
    clientRequestKey: value.clientRequestKey,
    offerCode: value.offerCode,
    ...(keys.includes("recoveryOnly")
      ? { recoveryOnly: value.recoveryOnly }
      : {}),
  });
  const offerCode = parseHostedGroupSponsorshipOfferCode(base.offerCode);
  if (!offerCode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_OFFER_INVALID",
      httpStatus: 400,
      message: "Choose an available group sponsorship offer.",
    });
  }
  const sponsorshipKind = value.sponsorshipKind === undefined
    ? "one_time"
    : value.sponsorshipKind;
  if (sponsorshipKind !== "monthly" && sponsorshipKind !== "one_time") {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_SPONSORSHIP_KIND_INVALID",
      httpStatus: 400,
      message: "Choose monthly sponsorship or a one-time contribution.",
    });
  }
  const monthlyCapMinor = sponsorshipKind === "monthly"
    ? parseHostedGroupSponsorshipMonthlyCapMinor(value.monthlyCapMinor)
    : null;
  if (
    (sponsorshipKind === "monthly" &&
      (monthlyCapMinor === null || offerCode !== "usage_5_usd")) ||
    (sponsorshipKind === "one_time" && value.monthlyCapMinor !== undefined)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_SPONSORSHIP_CAP_INVALID",
      httpStatus: 400,
      message: "Monthly sponsorship starts with $5 and needs a $5, $10, or $20 maximum.",
    });
  }
  return {
    clientRequestKey: base.clientRequestKey,
    monthlyCapMinor,
    offerCode,
    recoveryOnly: base.recoveryOnly,
    sponsorship: parseHostedGroupSponsorshipDraft(value.sponsorship),
    sponsorshipKind,
  };
}

export function createHostedUsageCreditCheckout(
  input: HostedPersonalUsageCreditCheckoutInput & { recoveryOnly: true },
): Promise<HostedUsageCreditCheckoutAttemptResult>;
export function createHostedUsageCreditCheckout(
  input: HostedPersonalUsageCreditCheckoutInput,
): Promise<HostedUsageCreditCheckoutResult>;
export async function createHostedUsageCreditCheckout(
  input: HostedPersonalUsageCreditCheckoutInput & { recoveryOnly?: true },
): Promise<HostedUsageCreditCheckoutAttemptResult> {
  return createHostedUsageCreditCheckoutForTarget({
    clientRequestKey: input.clientRequestKey,
    now: input.now,
    offerCode: input.offerCode,
    prisma: input.prisma,
    ...(input.recoveryOnly ? { recoveryOnly: true } : {}),
    target: {
      beneficiaryMemberId: input.memberId,
      kind: "personal",
      payerMemberId: input.memberId,
    },
  });
}

export function createHostedGroupUsageCreditCheckout(
  input: HostedGroupUsageCreditCheckoutInput & { recoveryOnly: true },
): Promise<HostedUsageCreditCheckoutAttemptResult>;
export function createHostedGroupUsageCreditCheckout(
  input: HostedGroupUsageCreditCheckoutInput,
): Promise<HostedUsageCreditCheckoutResult>;
export async function createHostedGroupUsageCreditCheckout(
  input: HostedGroupUsageCreditCheckoutInput & { recoveryOnly?: true },
): Promise<HostedUsageCreditCheckoutAttemptResult> {
  const prisma = input.prisma ?? getPrisma();
  const locator = normalizeHostedGroupUsageFundingLocator(input.joinCode);
  const fundingTarget = locator
    ? await readHostedGroupUsageFundingTargetByLocator({ locator, prisma })
    : null;
  if (!fundingTarget) {
    throw buildHostedUsageCreditNotEligibleError("group");
  }
  const target = {
    beneficiaryMemberId: fundingTarget.runtimeMemberId,
    joinCode: fundingTarget.joinCode,
    kind: "group" as const,
    payerMemberId: input.payerMemberId,
  };
  const checkoutInput = {
    clientRequestKey: input.clientRequestKey,
    groupSponsorship: input.sponsorship ?? null,
    groupSponsorshipKind: input.sponsorshipKind ?? "one_time",
    groupSponsorshipMonthlyCapMinor: input.monthlyCapMinor ?? null,
    now: input.now,
    offerCode: input.offerCode,
    prisma,
    ...(input.recoveryOnly ? { recoveryOnly: true as const } : {}),
    target,
  };

  try {
    // Resolve exact or active purchases and reject hard capacity before
    // customer preparation can create provider state.
    try {
      return await createHostedUsageCreditCheckoutForTarget(checkoutInput);
    } catch (error) {
      if (!(error instanceof HostedGroupUsageCreditCustomerRequiredError)) {
        throw error;
      }
    }

    const stripeCustomerId = await ensureHostedMemberStripeCustomer({
      memberId: input.payerMemberId,
      prisma,
    });
    // Re-run the locked admission after preparation because capacity may
    // have changed while no beneficiary lock was held.
    return await createHostedUsageCreditCheckoutForTarget({
      ...checkoutInput,
      groupStripeCustomerId: stripeCustomerId,
    });
  } catch (error) {
    if (!input.recoveryOnly && isHostedStripeProviderError(error)) {
      const { stripeLiveMode } = requireHostedStripeApiMode();
      reportHostedStripeOperationFailure({
        error,
        operationIdentity:
          `${input.payerMemberId}:${input.clientRequestKey}`,
        operationName: "usage-credit.checkout",
        stripeLiveMode,
      });
    }
    throw error;
  }
}

export function createHostedFamilyMemberUsageCreditCheckout(
  input: HostedFamilyUsageCreditCheckoutInput & { recoveryOnly: true },
): Promise<HostedUsageCreditCheckoutAttemptResult>;
export function createHostedFamilyMemberUsageCreditCheckout(
  input: HostedFamilyUsageCreditCheckoutInput,
): Promise<HostedUsageCreditCheckoutResult>;
export async function createHostedFamilyMemberUsageCreditCheckout(
  input: HostedFamilyUsageCreditCheckoutInput & { recoveryOnly?: true },
): Promise<HostedUsageCreditCheckoutAttemptResult> {
  return createHostedUsageCreditCheckoutForTarget({
    clientRequestKey: input.clientRequestKey,
    now: input.now,
    offerCode: input.offerCode,
    prisma: input.prisma,
    ...(input.recoveryOnly ? { recoveryOnly: true } : {}),
    target: {
      beneficiaryMemberId: input.beneficiaryMemberId,
      groupId: null,
      kind: "family",
      payerMemberId: input.payerMemberId,
    },
  });
}

async function createHostedUsageCreditCheckoutForTarget(input: {
  clientRequestKey: string;
  groupSponsorship?: HostedGroupSponsorshipDraft | null;
  groupSponsorshipKind?: HostedGroupSponsorshipCheckoutKind;
  groupSponsorshipMonthlyCapMinor?: HostedGroupSponsorshipMonthlyCapMinor | null;
  groupStripeCustomerId?: string;
  now?: Date;
  offerCode: HostedUsageCreditOfferCode;
  prisma?: PrismaClient;
  recoveryOnly?: true;
  target: HostedUsageCreditCheckoutTarget;
}): Promise<HostedUsageCreditCheckoutAttemptResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const resolution = await prisma.$transaction(async (tx) => {
    let lockedBeneficiary: LockedHostedUsageCreditBeneficiary;
    try {
      lockedBeneficiary = await lockHostedUsageCreditBeneficiaryTx({
        beneficiaryMemberId: input.target.beneficiaryMemberId,
        tx,
      });
    } catch (error) {
      if (
        error instanceof TypeError
        && error.message
          === "Hosted usage-credit beneficiary does not exist."
      ) {
        throw buildHostedUsageCreditNotEligibleError(input.target.kind);
      }
      throw error;
    }
    if (
      input.target.payerMemberId
        !== lockedBeneficiary.beneficiaryMemberId
    ) {
      await lockHostedMemberRow(tx, input.target.payerMemberId);
    }
    const payer = await tx.hostedMember.findUnique({
      select: {
        suspendedAt: true,
        threadContainer: { select: { memberId: true } },
      },
      where: { id: input.target.payerMemberId },
    });
    if (!payer || payer.suspendedAt || payer.threadContainer) {
      throw buildHostedUsageCreditNotEligibleError(input.target.kind);
    }

    const racedExisting = await tx.hostedUsageCreditPurchase.findUnique({
      where: {
        payerMemberId_clientRequestKey: {
          clientRequestKey: input.clientRequestKey,
          payerMemberId: input.target.payerMemberId,
        },
      },
    });
    if (racedExisting) {
      if (!hostedUsageCreditTargetMatches({
        purchase: racedExisting,
        target: input.target,
      })) {
        throw hostedOnboardingError({
          code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
          httpStatus: 409,
          message: "That usage-credit request key was already used for another request.",
        });
      }
      if (input.target.kind === "family") {
        const frozenTarget = projectHostedUsageCreditPurchaseTarget(
          racedExisting,
        );
        const currentTarget = await resolveHostedFamilyUsageCreditCheckoutTargetTx({
          beneficiaryMemberId: input.target.beneficiaryMemberId,
          ownerMemberId: input.target.payerMemberId,
          tx,
        });
        if (
          frozenTarget.kind !== "family" ||
          !currentTarget ||
          currentTarget.groupId !== frozenTarget.familyGroupId
        ) {
          return {
            kind: "purchase" as const,
            purchase: racedExisting,
            recovered: true,
            requestKeyMatched: true,
            selectionConflict: null,
            targetConflict: true,
          };
        }
      }
      let recoveredPurchase = racedExisting;
      if (
        recoveredPurchase.status === HostedUsageCreditPurchaseStatus.created
        && now.getTime() >= recoveredPurchase.checkoutExpiresAt.getTime()
      ) {
        await closeExpiredUnattachedHostedUsageCreditPurchasesTx({
          now,
          payerMemberId: input.target.payerMemberId,
          purchaseId: recoveredPurchase.id,
          tx,
        });
        const closedPurchase = await tx.hostedUsageCreditPurchase.findUnique({
          where: { id: recoveredPurchase.id },
        });
        if (
          !closedPurchase
          || closedPurchase.status !== HostedUsageCreditPurchaseStatus.expired
        ) {
          throw buildHostedUsageCreditInvariantError(
            "checkout_expiry_close_failed",
          );
        }
        recoveredPurchase = closedPurchase;
      }
      if (recoveredPurchase.offerCode !== input.offerCode) {
        return {
          kind: "purchase" as const,
          purchase: recoveredPurchase,
          recovered: true,
          requestKeyMatched: true,
          selectionConflict: "offer" as const,
          targetConflict: false,
        };
      }
      if (input.target.kind === "group") {
        if (!(await hostedGroupSponsorshipCheckoutSelectionMatchesTx({
          monthlyCapMinor: input.groupSponsorshipMonthlyCapMinor ?? null,
          purchase: recoveredPurchase,
          sponsorshipKind: input.groupSponsorshipKind ?? "one_time",
          tx,
        }))) {
          return {
            kind: "purchase" as const,
            purchase: recoveredPurchase,
            recovered: true,
            requestKeyMatched: true,
            selectionConflict: "sponsorship" as const,
            targetConflict: false,
          };
        }
        const sponsorshipInput = {
          draft: input.groupSponsorship ?? null,
          purchaseId: recoveredPurchase.id,
          tx,
        };
        if (canContinueHostedUsageCreditPurchase(recoveredPurchase.status)) {
          await assertHostedGroupSponsorshipRequestMatchesTx(sponsorshipInput);
        } else if (
          !(await hostedGroupSponsorshipRequestMatchesTx(sponsorshipInput))
        ) {
          return {
            kind: "purchase" as const,
            purchase: recoveredPurchase,
            recovered: true,
            requestKeyMatched: true,
            selectionConflict: "sponsorship" as const,
            targetConflict: false,
          };
        }
      }
      return {
        kind: "purchase" as const,
        purchase: recoveredPurchase,
        recovered: false,
        requestKeyMatched: true,
        selectionConflict: null,
        targetConflict: false,
      };
    }

    let target = input.target;
    let familyTarget: HostedFamilyUsageCreditCheckoutTarget | null = null;
    if (target.kind === "family") {
      familyTarget = await resolveHostedFamilyUsageCreditCheckoutTargetTx({
        beneficiaryMemberId: target.beneficiaryMemberId,
        ownerMemberId: target.payerMemberId,
        tx,
      });
      if (!familyTarget) {
        throw buildHostedUsageCreditNotEligibleError("family");
      }
      target = {
        ...target,
        groupId: familyTarget.groupId,
      };
    }

    await closeExpiredUnattachedHostedUsageCreditPurchasesTx({
      now,
      payerMemberId: target.payerMemberId,
      tx,
    });

    const existingActive = await tx.hostedUsageCreditPurchase.findFirst({
      where: {
        OR: [
          { groupSponsorshipAuthorizationId: null },
          { groupSponsorshipChargeOrdinal: 0 },
        ],
        payerMemberId: target.payerMemberId,
        status: {
          in: [...HOSTED_USAGE_CREDIT_NONTERMINAL_PURCHASE_STATUSES],
        },
      },
    });
    if (existingActive) {
      if (hostedUsageCreditTargetMatches({
        purchase: existingActive,
        target,
      })) {
        if (existingActive.offerCode !== input.offerCode) {
          return {
            kind: "purchase" as const,
            purchase: existingActive,
            recovered: true,
            requestKeyMatched: false,
            selectionConflict: "offer" as const,
            targetConflict: false,
          };
        }
        if (target.kind === "group") {
          if (!(await hostedGroupSponsorshipCheckoutSelectionMatchesTx({
            monthlyCapMinor: input.groupSponsorshipMonthlyCapMinor ?? null,
            purchase: existingActive,
            sponsorshipKind: input.groupSponsorshipKind ?? "one_time",
            tx,
          }))) {
            return {
              kind: "purchase" as const,
              purchase: existingActive,
              recovered: true,
              requestKeyMatched: false,
              selectionConflict: "sponsorship" as const,
              targetConflict: false,
            };
          }
          await assertHostedGroupSponsorshipRequestMatchesTx({
            draft: input.groupSponsorship ?? null,
            purchaseId: existingActive.id,
            tx,
          });
        }
        return {
          kind: "purchase" as const,
          purchase: existingActive,
          recovered: true,
          requestKeyMatched: false,
          selectionConflict: null,
          targetConflict: false,
        };
      }
      return {
        kind: "purchase" as const,
        purchase: existingActive,
        recovered: true,
        requestKeyMatched: false,
        selectionConflict: null,
        targetConflict: true,
      };
    }

    if (input.recoveryOnly) {
      return { kind: "recovery_miss" as const };
    }

    let authorizedOfferCodes: HostedUsageCreditOfferCode[];
    let stripeCustomerId: string | null;
    if (target.kind === "personal") {
      authorizedOfferCodes = await readHostedPersonalUsageCreditOfferCodes({
        memberId: target.payerMemberId,
        prisma: tx,
      });
      const billingRef = await readHostedMemberStripeBillingRef({
        memberId: target.payerMemberId,
        prisma: tx,
      });
      if (!billingRef?.stripeCustomerId || !billingRef.stripeSubscriptionId) {
        throw hostedOnboardingError({
          code: "HOSTED_USAGE_CREDIT_BILLING_NOT_READY",
          httpStatus: 409,
          message: "Your subscription is not ready for usage-credit checkout yet.",
        });
      }
      stripeCustomerId = billingRef.stripeCustomerId;
    } else if (target.kind === "group") {
      // The locator is either the owner-created join code or the signed
      // funding-only locator bound to the exact runtime member.
      const locatorRuntimeMemberId =
        readHostedGroupUsageFundingLocatorRuntimeMemberId(target.joinCode);
      const fundingTargets = locatorRuntimeMemberId === null
        ? await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "group"."id"
            FROM "hosted_group" AS "group"
            INNER JOIN "hosted_thread_container" AS "container"
              ON "container"."member_id" = "group"."runtime_member_id"
            WHERE "group"."join_code" = ${target.joinCode}
              AND "group"."runtime_member_id" = ${target.beneficiaryMemberId}
            FOR SHARE OF "group", "container"
          `
        : locatorRuntimeMemberId === target.beneficiaryMemberId
          ? await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "container"."member_id" AS "id"
              FROM "hosted_thread_container" AS "container"
              WHERE "container"."member_id" = ${target.beneficiaryMemberId}
              FOR SHARE OF "container"
            `
          : [];
      if (
        fundingTargets.length !== 1
        || !(await hasHostedRuntimeActiveAccessForUpdateTx(
          target.beneficiaryMemberId,
          { prisma: tx },
        ))
      ) {
        throw buildHostedUsageCreditNotEligibleError("group");
      }
      authorizedOfferCodes = readHostedConfiguredGroupSponsorshipOfferCodes({
        configuredOfferCodes: readHostedConfiguredUsageCreditOfferCodes(),
      });
      if (
        (input.groupSponsorshipKind ?? "one_time") === "monthly" &&
        (
          input.offerCode !== "usage_5_usd" ||
          input.groupSponsorshipMonthlyCapMinor === null ||
          input.groupSponsorshipMonthlyCapMinor === undefined
        )
      ) {
        throw buildHostedUsageCreditNotEligibleError("group");
      }
      stripeCustomerId = input.groupStripeCustomerId ?? null;
    } else {
      if (!familyTarget || target.groupId !== familyTarget.groupId) {
        throw buildHostedUsageCreditInvariantError("family_target_missing");
      }
      authorizedOfferCodes = filterHostedNonGroupUsageCreditOfferCodes(
        readHostedConfiguredUsageCreditOfferCodes(),
      );
      stripeCustomerId = familyTarget.stripeCustomerId;
    }
    if (!authorizedOfferCodes.includes(input.offerCode)) {
      throw buildHostedUsageCreditNotEligibleError(target.kind);
    }

    const capacity = await readHostedUsageCreditGrantCapacityTx({
      lockedBeneficiary,
      tx,
    });
    if (capacity.state !== "available") {
      throw buildHostedUsageCreditCapacityConflictError();
    }
    if (stripeCustomerId === null) {
      if (target.kind === "group") {
        throw new HostedGroupUsageCreditCustomerRequiredError();
      }
      throw buildHostedUsageCreditInvariantError("stripe_customer_missing");
    }

    const checkoutConfig = requireHostedStripeUsageCreditCheckoutConfig({
      offerCode: input.offerCode,
    });
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    const purchaseId = generateHostedRandomPrefixedId("hucp");
    const offer = getHostedUsageCreditOfferDefinition(input.offerCode);
    const checkoutExpiresAt = new Date(
      now.getTime() + HOSTED_USAGE_CREDIT_CHECKOUT_EXPIRY_DURATION_MS,
    );
    const checkoutSuccessUrl = buildHostedUsageCreditCheckoutReturnUrl({
      outcome: "success",
      publicBaseUrl,
      purchaseId,
      target,
    });
    const checkoutCancelUrl = buildHostedUsageCreditCheckoutReturnUrl({
      outcome: "cancel",
      publicBaseUrl,
      purchaseId,
      target,
    });
    const [stripePriceIdEncrypted, stripeCustomerIdEncrypted] = await Promise.all([
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.priceId,
        payerMemberId: target.payerMemberId,
        prisma: tx,
        value: checkoutConfig.priceId,
      }),
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.customerId,
        payerMemberId: target.payerMemberId,
        prisma: tx,
        value: stripeCustomerId,
      }),
    ]);
    const stripePriceLookupKey = requireHostedUsageCreditLookupKey(
      createHostedStripePriceLookupKey(checkoutConfig.priceId),
      "price",
    );
    const stripeCustomerLookupKey = requireHostedUsageCreditLookupKey(
      createHostedStripeCustomerLookupKey(stripeCustomerId),
      "customer",
    );
    const sponsorshipAuthorization =
      target.kind === "group" &&
        (input.groupSponsorshipKind ?? "one_time") === "monthly"
        ? await (async () => {
            const monthlyCapMinor = input.groupSponsorshipMonthlyCapMinor;
            if (monthlyCapMinor === null || monthlyCapMinor === undefined) {
              throw buildHostedUsageCreditNotEligibleError("group");
            }
            return createHostedGroupSponsorshipAuthorizationTx({
              beneficiaryMemberId: target.beneficiaryMemberId,
              monthlyCapMinor,
              now,
              payerMemberId: target.payerMemberId,
              tx,
            });
          })()
        : null;

    const created = await tx.hostedUsageCreditPurchase.create({
      data: {
        beneficiaryMemberId: target.beneficiaryMemberId,
        cashAmountMinor: offer.cashAmountMinor,
        cashCurrency: offer.cashCurrency,
        checkoutCancelUrl,
        checkoutExpiresAt,
        checkoutRequestPolicyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
        clientRequestKey: input.clientRequestKey,
        createdAt: now,
        grantSlotReleasedAt: null,
        grantUsdMicros: offer.grantUsdMicros,
        ...(sponsorshipAuthorization
          ? {
              groupSponsorshipAuthorizationId:
                sponsorshipAuthorization.authorizationId,
              groupSponsorshipChargeOrdinal: 0,
              groupSponsorshipPeriodStartedAt:
                sponsorshipAuthorization.periodStartedAt,
            }
          : {}),
        id: purchaseId,
        offerCode: offer.code,
        payerMemberId: target.payerMemberId,
        status: HostedUsageCreditPurchaseStatus.created,
        stripeCustomerIdEncrypted: requireHostedUsageCreditEncryptedValue(
          stripeCustomerIdEncrypted,
          "customer",
        ),
        stripeCustomerLookupKey,
        stripeLiveMode: checkoutConfig.stripeLiveMode,
        stripePriceIdEncrypted: requireHostedUsageCreditEncryptedValue(
          stripePriceIdEncrypted,
          "price",
        ),
        stripePriceLookupKey,
        checkoutSuccessUrl,
        updatedAt: now,
      },
    });
    if (target.kind === "group") {
      const customContentAuthorized =
        await hasHostedGroupSponsorshipCustomizationAuthority({
          containerMemberId: target.beneficiaryMemberId,
          now,
          participantMemberId: target.payerMemberId,
          prisma: tx,
        });
      await createHostedGroupSponsorshipMomentTx({
        authorizedDraft: customContentAuthorized
          ? input.groupSponsorship ?? null
          : null,
        beneficiaryMemberId: target.beneficiaryMemberId,
        creatorMemberId: target.payerMemberId,
        offerCode: offer.code,
        purchaseId,
        tx,
      });
    }
    return {
      kind: "purchase" as const,
      purchase: created,
      recovered: false,
      requestKeyMatched: true,
      selectionConflict: null,
      targetConflict: false,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (resolution.kind === "recovery_miss") {
    return { recoveryMiss: true };
  }

  if (resolution.targetConflict) {
    const projected = projectHostedUsageCreditPurchaseStatusResult(
      resolution.purchase,
    );
    return {
      purchaseId: projected.purchaseId,
      recovered: true,
      ...(resolution.requestKeyMatched
        ? { requestKeyMatched: true as const }
        : {}),
      ...(projected.restartAt ? { restartAt: projected.restartAt } : {}),
      status: projected.status,
      targetConflict: true,
    };
  }

  if (resolution.selectionConflict) {
    return {
      ...projectHostedUsageCreditPurchaseStatusResult(resolution.purchase),
      recovered: true,
      ...(resolution.requestKeyMatched
        ? { requestKeyMatched: true as const }
        : {}),
      selectionConflict: resolution.selectionConflict,
    };
  }

  try {
    const checkout = await continueHostedUsageCreditCheckout({
      now,
      prisma,
      purchase: resolution.purchase,
    });
    return {
      ...checkout,
      ...(resolution.recovered ? { recovered: true as const } : {}),
      ...(resolution.requestKeyMatched
        ? { requestKeyMatched: true as const }
        : {}),
    };
  } catch (error) {
    if (
      resolution.recovered &&
      isHostedOnboardingError(error) &&
      error.code === "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE"
    ) {
      const purchase = await prepareHostedUsageCreditPurchaseForCheckout({
        now,
        prisma,
        purchase: resolution.purchase,
      });
      const projection = await projectHostedUsageCreditCheckoutForCurrentTarget({
        now,
        prisma,
        purchase,
      });
      return {
        ...projection.checkout,
        recovered: true,
        ...(resolution.requestKeyMatched
          ? { requestKeyMatched: true as const }
          : {}),
        ...(projection.retryAllowed
          ? { retryAllowed: true as const }
          : {}),
      };
    }
    reportHostedUsageCreditCheckoutActionFailure(error, resolution.purchase);
    throw error;
  }
}

function reportHostedUsageCreditCheckoutActionFailure(
  error: unknown,
  purchase: Pick<HostedUsageCreditPurchase, "id" | "stripeLiveMode">,
): void {
  if (
    !isHostedOnboardingError(error) ||
    error.code !== "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE"
  ) {
    return;
  }
  reportHostedStripeOperationFailure({
    error,
    operationIdentity: purchase.id,
    operationName: "usage-credit.checkout",
    stripeLiveMode: purchase.stripeLiveMode,
  });
}

async function hostedGroupSponsorshipCheckoutSelectionMatchesTx(input: {
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor | null;
  purchase: HostedUsageCreditPurchase;
  sponsorshipKind: HostedGroupSponsorshipCheckoutKind;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const automaticAuthorizationId = input.purchase.groupSponsorshipAuthorizationId;
  const isMonthlyActivation = Boolean(
    automaticAuthorizationId &&
    input.purchase.groupSponsorshipChargeOrdinal === 0 &&
    input.purchase.groupSponsorshipPeriodStartedAt,
  );
  if (input.sponsorshipKind === "one_time") {
    return !isMonthlyActivation && automaticAuthorizationId == null;
  }
  if (!isMonthlyActivation || input.monthlyCapMinor === null) {
    return false;
  }
  const authorization = await input.tx.hostedGroupSponsorshipAuthorization.findUnique({
    select: { monthlyCapMinor: true },
    where: { id: automaticAuthorizationId! },
  });
  return authorization?.monthlyCapMinor === input.monthlyCapMinor;
}

export async function continueHostedUsageCreditCheckout(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditCheckoutResult> {
  const purchase = await prepareHostedUsageCreditPurchaseForCheckout({
    now: input.now,
    prisma: input.prisma,
    purchase: input.purchase,
  });
  const initialProjection = await projectHostedUsageCreditCheckoutForCurrentTarget({
    now: input.now,
    prisma: input.prisma,
    purchase,
  });
  const target = projectHostedUsageCreditPurchaseTarget(purchase);
  const policyVersion = parseHostedUsageCreditCheckoutRequestPolicyVersion(
    purchase.checkoutRequestPolicyVersion,
  );
  if (!policyVersion) {
    throw buildHostedUsageCreditInvariantError("checkout_policy_mismatch");
  }
  const canRetryCheckoutCreate = canRetryHostedUsageCreditCheckoutCreate({
    now: input.now,
    purchase,
  });
  const canStartSavedCardPayment =
    canRetryCheckoutCreate &&
    hostedUsageCreditPolicySupportsSavedCardTarget({
      policyVersion,
      targetKind: target.kind,
    });
  const canRetrySavedCardPayment =
    canRetryHostedUsageCreditSavedCardPayment(purchase);
  if (
    !canRetryCheckoutCreate &&
    !canRetrySavedCardPayment
  ) {
    return initialProjection.checkout;
  }

  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
  if (stripeLiveMode !== purchase.stripeLiveMode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_STRIPE_MODE_MISMATCH",
      httpStatus: 500,
      message: "Usage-credit checkout is temporarily unavailable.",
    });
  }

  const checkoutRequest = await reconstructHostedUsageCreditStripeCheckoutRequest({
    prisma: input.prisma,
    purchase,
  });
  await assertHostedUsageCreditStripePriceMatchesPurchase({
    checkoutRequest,
    purchase,
    stripe,
  });
  const stripeCustomerId = typeof checkoutRequest.customer === "string"
    ? checkoutRequest.customer
    : null;
  if (!stripeCustomerId) {
    throw buildHostedUsageCreditInvariantError("purchase_customer_missing");
  }
  const billingAuthority =
    canStartSavedCardPayment &&
      !purchase.stripePaymentIntentLookupKey &&
      policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION
      ? await resolveHostedUsageCreditSavedCardBillingAuthority({
          payerMemberId: requireHostedUsageCreditPurchasePayerMemberId(purchase),
          prisma: input.prisma,
          purchase,
          stripeCustomerId,
          target,
        })
      : target.kind === "group"
        ? (() => {
            const automaticSponsorship =
              buildHostedGroupSponsorshipPaymentAuthority({
                mode: "payer_recovery",
                purchase,
              });
            return {
              ...(automaticSponsorship ? { automaticSponsorship } : {}),
              kind: "group" as const,
            };
          })()
        : target.kind === "family"
          ? {
              familyGroupId: target.familyGroupId,
              kind: "family" as const,
              subscription: null,
            }
          : { kind: "personal" as const, subscription: null };
  let checkoutPurchase = purchase;
  if (canStartSavedCardPayment || canRetrySavedCardPayment) {
    const directPaymentPurchase = await tryChargeHostedUsageCreditSavedCard({
      billingAuthority,
      checkoutRequest,
      now: input.now,
      policyVersion,
      prisma: input.prisma,
      purchase,
      stripe,
    });
    if (directPaymentPurchase) {
      const projection = await projectHostedUsageCreditCheckoutForCurrentTarget({
        now: input.now,
        prisma: input.prisma,
        purchase: directPaymentPurchase,
      });
      return projection.checkout;
    }
    checkoutPurchase = await prepareHostedUsageCreditPurchaseForCheckout({
      now: input.now,
      prisma: input.prisma,
      purchase,
    });
    if (
      checkoutPurchase.status !== HostedUsageCreditPurchaseStatus.created ||
      !canRetryHostedUsageCreditCheckoutCreate({
        now: input.now,
        purchase: checkoutPurchase,
      })
    ) {
      const projection = await projectHostedUsageCreditCheckoutForCurrentTarget({
        now: input.now,
        prisma: input.prisma,
        purchase: checkoutPurchase,
      });
      return projection.checkout;
    }
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(checkoutRequest, {
      idempotencyKey: buildHostedUsageCreditCheckoutIdempotencyKey(purchase.id),
    });
  } catch (error) {
    logHostedStripeFailure({
      error,
      operationName: "checkout.sessions.create.usage-credit",
    });
    throw hostedOnboardingError({
      cause: buildHostedStripeAlertCorrelationCause(error),
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      details: describeSafeHostedUsageCreditStripeError(error),
      httpStatus: 502,
      message: "Stripe checkout is temporarily unavailable. Try again with the same request.",
      retryable: true,
    });
  }

  assertHostedUsageCreditStripeSessionMatchesPurchase({
    purchase: checkoutPurchase,
    session,
  });
  const attached = await bindHostedUsageCreditCheckoutSession({
    now: input.now,
    prisma: input.prisma,
    purchase: checkoutPurchase,
    session,
  });
  const finalProjection = await projectHostedUsageCreditCheckoutForCurrentTarget({
    now: input.now,
    prisma: input.prisma,
    purchase: attached,
  });
  return finalProjection.checkout;
}

export async function recoverHostedGroupSponsorshipUsageCreditCheckout(input: {
  authorizationId: string;
  beneficiaryMemberId: string;
  now?: Date;
  payerMemberId: string;
  prisma?: PrismaClient;
}): Promise<HostedUsageCreditCheckoutResult | null> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const prepared = await prisma.$transaction(async (tx) => {
    // Keep the gate decision under the same beneficiary serialization as the
    // recovery mutation; prepare also acquires this lock for direct callers.
    await lockHostedUsageCreditBeneficiaryTx({
      beneficiaryMemberId: input.beneficiaryMemberId,
      tx,
    });
    const decision = await readHostedAiUsageGate({
      memberId: input.beneficiaryMemberId,
      now,
      prisma: tx,
    });
    if (
      decision.allowanceSource !== "thread_container" ||
      (!decision.allowed && decision.reason !== "ai_usage_limit_exceeded")
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_SPONSORSHIP_RECOVERY_UNAVAILABLE",
        httpStatus: 409,
        message: "This sponsorship recovery is no longer available.",
      });
    }
    const capacityState = classifyHostedGroupUsageCapacity({
      limitUsdMicros: decision.limitUsdMicros,
      remainingUsdMicros: decision.remainingUsdMicros,
    });
    const checkoutExpiresAt = new Date(
      now.getTime() + HOSTED_USAGE_CREDIT_CHECKOUT_EXPIRY_DURATION_MS,
    );
    const recovery = await prepareHostedGroupSponsorshipRecoveryTx({
      authorizationId: input.authorizationId,
      beneficiaryMemberId: input.beneficiaryMemberId,
      capacityState,
      checkoutExpiresAt,
      now,
      payerMemberId: input.payerMemberId,
      tx,
    });
    if (recovery.kind === "reactivated") {
      return recovery;
    }
    const purchase = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: recovery.purchaseId },
    });
    if (!purchase) {
      throw buildHostedUsageCreditInvariantError(
        "group_sponsorship_recovery_purchase_missing",
      );
    }
    return { kind: "purchase" as const, purchase };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (prepared.kind === "reactivated") {
    return null;
  }
  try {
    return await continueHostedUsageCreditCheckout({
      now,
      prisma,
      purchase: prepared.purchase,
    });
  } catch (error) {
    reportHostedUsageCreditCheckoutActionFailure(error, prepared.purchase);
    throw error;
  }
}

export function buildHostedGroupSponsorshipPaymentAuthority(input: {
  mode: HostedGroupSponsorshipPaymentAuthority["mode"];
  purchase: Pick<
    HostedUsageCreditPurchase,
    | "beneficiaryMemberId"
    | "groupSponsorshipAuthorizationId"
    | "groupSponsorshipChargeOrdinal"
    | "groupSponsorshipPeriodStartedAt"
  >;
}): HostedGroupSponsorshipPaymentAuthority | null {
  if (
    !input.purchase.groupSponsorshipAuthorizationId ||
    input.purchase.groupSponsorshipChargeOrdinal === null ||
    input.purchase.groupSponsorshipChargeOrdinal <= 0 ||
    !input.purchase.groupSponsorshipPeriodStartedAt
  ) {
    return null;
  }
  return {
    authorizationId: input.purchase.groupSponsorshipAuthorizationId,
    beneficiaryMemberId: input.purchase.beneficiaryMemberId,
    chargeOrdinal: input.purchase.groupSponsorshipChargeOrdinal,
    mode: input.mode,
    periodStartedAt: input.purchase.groupSponsorshipPeriodStartedAt,
  };
}

async function resolveHostedUsageCreditSavedCardBillingAuthority(input: {
  payerMemberId: string;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  stripeCustomerId: string;
  target: HostedUsageCreditPurchaseTargetProjection;
}): Promise<HostedUsageCreditSavedCardBillingAuthority> {
  if (input.target.kind === "group") {
    const automaticSponsorship =
      buildHostedGroupSponsorshipPaymentAuthority({
        mode: "payer_recovery",
        purchase: input.purchase,
      });
    return automaticSponsorship
      ? { automaticSponsorship, kind: "group" }
      : { kind: "group" };
  }
  if (input.target.kind === "family") {
    const billingRef = await readHostedAccountGroupStripeBillingRef({
      groupId: input.target.familyGroupId,
      prisma: input.prisma,
    });
    return {
      familyGroupId: input.target.familyGroupId,
      kind: "family",
      subscription:
        billingRef?.stripeCustomerId === input.stripeCustomerId &&
        billingRef.stripeSubscriptionId &&
        hasHostedAccountGroupAccess(billingRef.group)
          ? {
              billingStatus: billingRef.group.billingStatus,
              lastStripeEventCreatedAt:
                billingRef.lastStripeEventCreatedAt ?? null,
              stripeSubscriptionId: billingRef.stripeSubscriptionId,
              suspendedAt: billingRef.group.suspendedAt,
            }
          : null,
    };
  }
  const member = await readHostedMemberBillingSnapshot({
    memberId: input.payerMemberId,
    prisma: input.prisma,
  });
  return {
    kind: "personal",
    subscription:
      member?.billingRef?.stripeCustomerId === input.stripeCustomerId &&
      member.billingRef.stripeSubscriptionId &&
      hasHostedMemberOwnPaidBilling({
        ...member.core,
        billingRef: member.billingRef,
      })
        ? {
            billingStatus: member.core.billingStatus,
            lastStripeEventCreatedAt:
              member.billingRef.lastStripeEventCreatedAt ?? null,
            stripeSubscriptionId: member.billingRef.stripeSubscriptionId,
            suspendedAt: member.core.suspendedAt,
          }
        : null,
  };
}

async function projectHostedUsageCreditCheckoutForCurrentTarget(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<{
  checkout: HostedUsageCreditCheckoutResult;
  retryAllowed: boolean;
}> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const capability = await projectHostedUsageCreditCheckoutCapability({
    now: input.now,
    payerMemberId,
    prisma: input.prisma,
    purchase: input.purchase,
    targetApprovedByCaller: true,
  });
  if (!capability.payerAuthorized) {
    throw buildHostedUsageCreditNotEligibleError();
  }
  return {
    checkout: capability.targetAuthorized
      ? capability.checkout
      : {
          ...capability.checkout,
          targetConflict: true,
        },
    retryAllowed: capability.retryAllowed,
  };
}

async function prepareHostedUsageCreditPurchaseForCheckout(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const target = projectHostedUsageCreditPurchaseTarget(input.purchase);
  return input.prisma.$transaction(async (tx) => {
    if (target.kind === "group") {
      await lockHostedMemberRow(tx, target.beneficiaryMemberId);
    }
    await lockHostedMemberRow(tx, payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (
      !current
      || current.payerMemberId !== payerMemberId
      || current.offerCode !== input.purchase.offerCode
      || current.beneficiaryMemberId !== input.purchase.beneficiaryMemberId
    ) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    const member = await tx.hostedMember.findUnique({
      select: { suspendedAt: true },
      where: { id: current.payerMemberId },
    });
    if (!member || member.suspendedAt) {
      throw buildHostedUsageCreditNotEligibleError();
    }
    if (!parseHostedUsageCreditOfferCode(input.purchase.offerCode)) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }

    if (
      current.status === HostedUsageCreditPurchaseStatus.created &&
      input.now.getTime() >= current.checkoutExpiresAt.getTime()
    ) {
      const closed = await tx.hostedUsageCreditPurchase.updateMany({
        data: {
          reconciliationVersion: { increment: 1n },
          status: HostedUsageCreditPurchaseStatus.expired,
          terminalAt: input.now,
          updatedAt: input.now,
        },
        where: {
          checkoutExpiresAt: { lte: input.now },
          id: current.id,
          reconciliationVersion: current.reconciliationVersion,
          status: HostedUsageCreditPurchaseStatus.created,
        },
      });
      if (closed.count !== 1) {
        throw buildHostedUsageCreditInvariantError("checkout_expiry_close_failed");
      }
      return {
        ...current,
        reconciliationVersion: current.reconciliationVersion + 1n,
        status: HostedUsageCreditPurchaseStatus.expired,
        terminalAt: input.now,
        updatedAt: input.now,
      };
    }
    return current;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function bindHostedUsageCreditCheckoutSession(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  session: Stripe.Checkout.Session;
}): Promise<HostedUsageCreditPurchase> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const sessionLookupKey = requireHostedUsageCreditLookupKey(
    createHostedStripeCheckoutSessionLookupKey(input.session.id),
    "checkout_session",
  );
  const providerFinalNoPayment = input.session.status === "expired" &&
    input.session.payment_status === "unpaid";
  const target = projectHostedUsageCreditPurchaseTarget(input.purchase);

  return input.prisma.$transaction(async (tx) => {
    if (providerFinalNoPayment) {
      await lockHostedUsageCreditPurchaseReservationOwnersTx({
        beneficiaryMemberId: input.purchase.beneficiaryMemberId,
        payerMemberId,
        tx,
      });
    } else {
      if (target.kind === "group") {
        await lockHostedMemberRow(tx, target.beneficiaryMemberId);
      }
      await lockHostedMemberRow(tx, payerMemberId);
    }
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (
      !current ||
      current.payerMemberId !== payerMemberId ||
      current.beneficiaryMemberId !== input.purchase.beneficiaryMemberId
    ) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }

    if (current.stripeCheckoutSessionLookupKey) {
      const currentSessionId = await decryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
        payerMemberId,
        prisma: tx,
        value: current.stripeCheckoutSessionIdEncrypted,
      });
      if (currentSessionId !== input.session.id) {
        throw buildHostedUsageCreditInvariantError("multiple_checkout_sessions");
      }
      if (!providerFinalNoPayment) {
        return current;
      }
      if (current.grantSlotReleasedAt !== null) {
        if (
          current.status !== HostedUsageCreditPurchaseStatus.expired ||
          current.paidAt !== null
        ) {
          throw buildHostedUsageCreditInvariantError(
            "checkout_release_state_invalid",
          );
        }
        return current;
      }
      const released = await tx.hostedUsageCreditPurchase.updateMany({
        data: {
          grantSlotReleasedAt: input.now,
          lastReconciledAt: input.now,
          reconciliationVersion: { increment: 1n },
          status: HostedUsageCreditPurchaseStatus.expired,
          stripeCheckoutUrlEncrypted: null,
          terminalAt: input.now,
          updatedAt: input.now,
        },
        where: {
          grantSlotReleasedAt: null,
          id: current.id,
          paidAt: null,
          reconciliationVersion: current.reconciliationVersion,
          status: {
            in: [
              HostedUsageCreditPurchaseStatus.created,
              HostedUsageCreditPurchaseStatus.checkout_open,
              HostedUsageCreditPurchaseStatus.payment_pending,
              HostedUsageCreditPurchaseStatus.expired,
              HostedUsageCreditPurchaseStatus.payment_failed,
            ],
          },
          stripeCheckoutSessionLookupKey: sessionLookupKey,
        },
      });
      if (released.count !== 1) {
        throw buildHostedUsageCreditInvariantError(
          "checkout_attach_release_failed",
        );
      }
      const reconciled = await tx.hostedUsageCreditPurchase.findUnique({
        where: { id: current.id },
      });
      if (!reconciled) {
        throw buildHostedUsageCreditPurchaseNotFoundError();
      }
      return reconciled;
    }

    if (
      current.status !== HostedUsageCreditPurchaseStatus.created &&
      !(
        providerFinalNoPayment &&
        current.status === HostedUsageCreditPurchaseStatus.expired
      )
    ) {
      return current;
    }

    const [stripeCheckoutSessionIdEncrypted, stripeCheckoutUrlEncrypted] =
      await Promise.all([
        encryptHostedUsageCreditPurchaseStripeField({
          field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
          payerMemberId,
          prisma: tx,
          value: input.session.id,
        }),
        encryptHostedUsageCreditPurchaseStripeField({
          field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutUrl,
          payerMemberId,
          prisma: tx,
          value: input.session.url,
        }),
      ]);
    const terminal = input.session.status === "expired";
    const status = terminal
      ? HostedUsageCreditPurchaseStatus.expired
      : input.session.status === "complete" || input.session.payment_status === "paid"
        ? HostedUsageCreditPurchaseStatus.payment_pending
        : HostedUsageCreditPurchaseStatus.checkout_open;
    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        ...(providerFinalNoPayment
          ? { grantSlotReleasedAt: input.now }
          : {}),
        ...(providerFinalNoPayment ? { lastReconciledAt: input.now } : {}),
        reconciliationVersion: { increment: 1n },
        status,
        stripeCheckoutSessionIdEncrypted,
        stripeCheckoutSessionLookupKey: sessionLookupKey,
        stripeCheckoutUrlEncrypted,
        terminalAt: terminal ? input.now : null,
        updatedAt: input.now,
      },
      where: {
        id: current.id,
        ...(providerFinalNoPayment
          ? {
              grantSlotReleasedAt: null,
              paidAt: null,
              status: {
                in: [
                  HostedUsageCreditPurchaseStatus.created,
                  HostedUsageCreditPurchaseStatus.expired,
                ],
              },
            }
          : { status: HostedUsageCreditPurchaseStatus.created }),
        reconciliationVersion: current.reconciliationVersion,
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditInvariantError("checkout_attach_failed");
    }

    const attached = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!attached) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    return attached;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function buildHostedUsageCreditCheckoutReturnUrl(input: {
  outcome: "cancel" | "success";
  publicBaseUrl: string;
  purchaseId: string;
  target: HostedUsageCreditCheckoutTarget;
}): string {
  const url = new URL(input.target.kind === "group"
    ? buildHostedGroupUsageFundingPath(input.target.joinCode)
    : "/settings", input.publicBaseUrl);
  if (input.target.kind === "family") {
    if (!input.target.groupId) {
      throw buildHostedUsageCreditInvariantError("family_target_missing");
    }
    url.searchParams.set("usageFamily", input.target.groupId);
    url.searchParams.set("usageMember", input.target.beneficiaryMemberId);
  }
  url.searchParams.set("usageCheckout", input.outcome);
  url.searchParams.set("usagePurchase", input.purchaseId);
  if (input.target.kind === "personal") {
    url.hash = "subscription";
  } else if (input.target.kind === "family") {
    url.hash =
      input.target.payerMemberId === input.target.beneficiaryMemberId
        ? "subscription"
        : "family";
  }
  return url.toString();
}

function hostedUsageCreditTargetMatches(input: {
  purchase: Pick<
    HostedUsageCreditPurchase,
    "beneficiaryMemberId" | "checkoutSuccessUrl" | "id" | "payerMemberId"
  >;
  target: HostedUsageCreditCheckoutTarget;
}): boolean {
  if (
    input.purchase.payerMemberId !== input.target.payerMemberId
    || input.purchase.beneficiaryMemberId !== input.target.beneficiaryMemberId
  ) {
    return false;
  }
  const frozenTarget = projectHostedUsageCreditPurchaseTarget(input.purchase);
  switch (input.target.kind) {
    case "personal":
      return frozenTarget.kind === "personal";
    case "group":
      return frozenTarget.kind === "group";
    case "family":
      return frozenTarget.kind === "family"
        && (input.target.groupId === null
          || frozenTarget.familyGroupId === input.target.groupId);
  }
}

function buildHostedUsageCreditCapacityConflictError() {
  return hostedOnboardingError({
    code: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
    httpStatus: 409,
    message: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
  });
}

function buildHostedUsageCreditNotEligibleError(
  kind: HostedUsageCreditCheckoutTarget["kind"] = "personal",
) {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
    httpStatus: 403,
    message: kind === "group"
      ? "Usage credit is not available for this group."
      : kind === "family"
        ? "Usage credit is not available for that Family member."
        : "Usage credit is available for active paid Pulse or Edge plans.",
  });
}
