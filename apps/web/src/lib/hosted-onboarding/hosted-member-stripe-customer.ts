import "server-only";

import { randomUUID } from "node:crypto";

import type {
  HostedMemberBillingRef,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  assertHostedStripeEffectClaimAbsent,
  bindHostedMemberStripeCustomerIdIfMissingTx,
  projectHostedMemberStripeBillingRefSnapshot,
  readHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import { requireHostedStripeApiMode } from "./runtime";
import { withHostedStripeFailureLog } from "./stripe-error-log";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";

type HostedMemberStripeCustomerPreparation =
  | {
      claimId: string;
      kind: "create";
    }
  | {
      kind: "existing";
      stripeCustomerId: string;
    };

const HOSTED_MEMBER_STRIPE_CUSTOMER_EFFECT_KIND = "member.customer-create";
const HOSTED_MEMBER_STRIPE_CUSTOMER_CLAIM_PREFIX = "member-customer-create:";

/**
 * Reuses the member-scoped Stripe Customer identity and its existing provider
 * idempotency key, including for a member who does not have a paid plan.
 */
export async function ensureHostedMemberStripeCustomer(input: {
  memberId: string;
  prisma?: PrismaClient;
}): Promise<string> {
  const prisma = input.prisma ?? getPrisma();
  const existing = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma,
  });
  if (existing?.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  const { stripe } = requireHostedStripeApiMode();
  const prepared = await prepareHostedMemberStripeCustomer({
    memberId: input.memberId,
    prisma,
  });
  if (prepared.kind === "existing") {
    return prepared.stripeCustomerId;
  }

  // Keep the committed claim on any provider error. A later call reuses both
  // the claim and Stripe idempotency key, so an ambiguous success is reconciled
  // without admitting account deletion or a second Customer identity.
  const candidateStripeCustomerId = await createOrReconcileHostedMemberStripeCustomer({
    memberId: input.memberId,
    requestOptions: {
      maxNetworkRetries: 0,
      timeout: 5_000,
    },
    stripe,
  });

  return finalizeHostedMemberStripeCustomer({
    candidateStripeCustomerId,
    claimId: prepared.claimId,
    memberId: input.memberId,
    prisma,
  });
}

async function prepareHostedMemberStripeCustomer(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<HostedMemberStripeCustomerPreparation> {
  return input.prisma.$transaction(async (tx) => {
    const billingRef = await readHostedMemberStripeCustomerOwnerStateTx({
      memberId: input.memberId,
      tx,
    });
    if (billingRef?.stripeCustomerLookupKey) {
      const current = await projectHostedMemberStripeBillingRefSnapshot(
        billingRef,
        tx,
      );
      if (current.stripeCustomerId) {
        return {
          kind: "existing",
          stripeCustomerId: current.stripeCustomerId,
        } as const;
      }
    }

    if (billingRef?.stripeEffectClaimId) {
      if (isExactHostedMemberStripeCustomerClaim(billingRef)) {
        return {
          claimId: billingRef.stripeEffectClaimId,
          kind: "create",
        } as const;
      }
      assertHostedStripeEffectClaimAbsent(billingRef.stripeEffectClaimId);
    }

    const claimId = `${HOSTED_MEMBER_STRIPE_CUSTOMER_CLAIM_PREFIX}${randomUUID()}`;
    const claim = {
      stripeEffectClaimedAt: new Date(),
      stripeEffectClaimId: claimId,
      stripeEffectExecutionId: null,
      stripeEffectExecutionStartedAt: null,
      stripeEffectKind: HOSTED_MEMBER_STRIPE_CUSTOMER_EFFECT_KIND,
      stripeEffectTargetPlanCode: null,
    } as const;
    await tx.hostedMemberBillingRef.upsert({
      create: {
        memberId: input.memberId,
        ...claim,
      },
      update: claim,
      where: { memberId: input.memberId },
    });

    return {
      claimId,
      kind: "create",
    } as const;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function finalizeHostedMemberStripeCustomer(input: {
  candidateStripeCustomerId: string;
  claimId: string;
  memberId: string;
  prisma: PrismaClient;
}): Promise<string> {
  return input.prisma.$transaction(async (tx) => {
    const currentBillingRef = await readHostedMemberStripeCustomerOwnerStateTx({
      memberId: input.memberId,
      tx,
    });
    if (currentBillingRef?.stripeCustomerLookupKey) {
      const current = await projectHostedMemberStripeBillingRefSnapshot(
        currentBillingRef,
        tx,
      );
      if (current.stripeCustomerId) {
        return current.stripeCustomerId;
      }
    }

    if (currentBillingRef?.stripeEffectClaimId !== input.claimId) {
      assertHostedStripeEffectClaimAbsent(
        currentBillingRef?.stripeEffectClaimId,
      );
      throw buildHostedUsageCreditCustomerBindFailedError();
    }
    if (!isExactHostedMemberStripeCustomerClaim(currentBillingRef)) {
      throw buildHostedUsageCreditCustomerBindFailedError();
    }

    const billingRef = await bindHostedMemberStripeCustomerIdIfMissingTx({
      memberId: input.memberId,
      stripeCustomerId: input.candidateStripeCustomerId,
      tx,
    });
    if (!billingRef?.stripeCustomerId) {
      throw buildHostedUsageCreditCustomerBindFailedError();
    }
    const clearedClaim = await tx.hostedMemberBillingRef.updateMany({
      data: {
        stripeEffectClaimedAt: null,
        stripeEffectClaimId: null,
        stripeEffectExecutionId: null,
        stripeEffectExecutionStartedAt: null,
        stripeEffectKind: null,
        stripeEffectTargetPlanCode: null,
      },
      where: {
        memberId: input.memberId,
        stripeEffectClaimId: input.claimId,
        stripeEffectKind: HOSTED_MEMBER_STRIPE_CUSTOMER_EFFECT_KIND,
      },
    });
    if (clearedClaim.count !== 1) {
      throw buildHostedUsageCreditCustomerBindFailedError();
    }
    return billingRef.stripeCustomerId;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function readHostedMemberStripeCustomerOwnerStateTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberBillingRef | null> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await input.tx.hostedMember.findUnique({
    select: {
      suspendedAt: true,
      threadContainer: { select: { memberId: true } },
    },
    where: { id: input.memberId },
  });
  if (!member || member.suspendedAt || member.threadContainer) {
    throw buildHostedUsageCreditPayerNotEligibleError();
  }

  const billingRef = await input.tx.hostedMemberBillingRef.findUnique({
    where: { memberId: input.memberId },
  });
  return billingRef;
}

function isExactHostedMemberStripeCustomerClaim(
  billingRef: HostedMemberBillingRef,
): boolean {
  return billingRef.stripeEffectClaimId !== null
    && billingRef.stripeEffectClaimId.startsWith(
      HOSTED_MEMBER_STRIPE_CUSTOMER_CLAIM_PREFIX,
    )
    && billingRef.stripeEffectKind
      === HOSTED_MEMBER_STRIPE_CUSTOMER_EFFECT_KIND
    && billingRef.stripeEffectClaimedAt !== null
    && billingRef.stripeEffectExecutionId === null
    && billingRef.stripeEffectExecutionStartedAt === null
    && billingRef.stripeEffectTargetPlanCode === null;
}

type HostedMemberStripeCustomerRequestOptions = Pick<
  Stripe.RequestOptions,
  "maxNetworkRetries" | "timeout"
>;

/**
 * Creates or replays the reusable member-scoped Stripe Customer. The legacy
 * idempotency key and request metadata are intentionally preserved so an
 * unknown provider outcome is reconciled by repeating this exact request,
 * rather than by creating a new provider identity.
 */
async function createOrReconcileHostedMemberStripeCustomer(input: {
  memberId: string;
  requestOptions?: HostedMemberStripeCustomerRequestOptions;
  stripe: Stripe;
}): Promise<string> {
  const requestOptions: Stripe.RequestOptions = {
    idempotencyKey: `hosted-auto-pulse-trial-customer:${input.memberId}`,
  };
  if (input.requestOptions?.maxNetworkRetries !== undefined) {
    requestOptions.maxNetworkRetries = input.requestOptions.maxNetworkRetries;
  }
  if (input.requestOptions?.timeout !== undefined) {
    requestOptions.timeout = input.requestOptions.timeout;
  }

  const customer = await withHostedStripeFailureLog(
    "customers.create.member",
    () => input.stripe.customers.create({
      metadata: {
        memberId: input.memberId,
        source: "hosted.auto_pulse_trial",
      },
    }, requestOptions),
  );

  return customer.id;
}

function buildHostedUsageCreditCustomerBindFailedError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_CUSTOMER_BIND_FAILED",
    httpStatus: 409,
    message: "Murph could not prepare Stripe checkout. Try again.",
    retryable: true,
  });
}

function buildHostedUsageCreditPayerNotEligibleError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_PAYER_NOT_ELIGIBLE",
    httpStatus: 403,
    message: "This Murph account cannot start a usage-credit checkout.",
  });
}
