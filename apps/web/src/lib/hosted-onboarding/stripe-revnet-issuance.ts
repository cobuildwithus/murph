import type {
  PrismaClient,
} from "@prisma/client";
import { HostedRevnetIssuanceStatus } from "@prisma/client";
import type Stripe from "stripe";

import type { HostedMemberSnapshot } from "./hosted-member-store";
import type { HostedOnboardingReadClient } from "./shared";
import {
  REVNET_ISSUANCE_RECORDING_FAILED_CODE,
  loadHostedRevnetIssuanceEligibility,
  loadHostedRevnetIssuanceSubmissionState,
} from "./stripe-revnet-issuance-state";
import {
  claimHostedRevnetIssuanceSubmission,
  findOrCreateHostedRevnetIssuance,
  patchHostedRevnetIssuanceStripeReferencesIfNeeded,
  submitAndPersistHostedRevnetIssuance,
} from "./stripe-revnet-issuance-persistence";
import { isHostedOnboardingError } from "./errors";

export { computeHostedRevnetNextAttemptAt } from "./stripe-revnet-issuance-state";

export async function maybeIssueHostedRevnetForStripeInvoice(input: {
  invoice: Stripe.Invoice;
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingReadClient;
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
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingReadClient;
}) {
  const eligibility = loadHostedRevnetIssuanceEligibility(input);
  if (eligibility.kind === "skip") {
    return null;
  }

  const issuance = await findOrCreateHostedRevnetIssuance(eligibility);
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
  const staleSubmittingThreshold = new Date(Date.now() - 5 * 60 * 1000);
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
