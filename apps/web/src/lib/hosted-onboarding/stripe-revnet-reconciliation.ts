import {
  HostedRevnetIssuanceStatus,
  type PrismaClient,
} from "@prisma/client";

import {
  activateHostedMemberFromConfirmedRevnetIssuanceTx,
  runHostedMemberActivationPostCommitEffects,
} from "./member-activation";
import { resolveHostedMemberEmailLinked } from "./member-channel-sync";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  isHostedOnboardingRevnetEnabled,
  readHostedRevnetPaymentReceipt,
} from "./revnet";
import {
  computeHostedRevnetNextAttemptAt,
} from "./stripe-revnet-issuance";

export async function reconcileSubmittedHostedRevnetIssuances(input: {
  limit?: number;
  prisma: PrismaClient;
}): Promise<string[]> {
  if (!isHostedOnboardingRevnetEnabled()) {
    return [];
  }

  const confirmedIssuanceIds: string[] = [];
  const now = new Date();
  const issuances = await input.prisma.hostedRevnetIssuance.findMany({
    where: {
      nextAttemptAt: {
        lte: now,
      },
      payTxHash: {
        not: null,
      },
      status: HostedRevnetIssuanceStatus.submitted,
    },
    orderBy: [
      {
        createdAt: "asc",
      },
    ],
    take: input.limit ?? 25,
  });

  for (const issuance of issuances) {
    const receipt = await readHostedRevnetPaymentReceipt({
      chainId: issuance.chainId,
      payTxHash: issuance.payTxHash as `0x${string}`,
    });

    if (!receipt) {
      continue;
    }

    if (receipt.status === "reverted") {
      await input.prisma.hostedRevnetIssuance.update({
        where: {
          id: issuance.id,
        },
        data: {
          failureCode: "REVNET_PAYMENT_REVERTED",
          failureMessage: "The submitted Hosted RevNet payment reverted onchain.",
          status: HostedRevnetIssuanceStatus.failed,
        },
      });
      continue;
    }

    const activationResult = await input.prisma.$transaction(async (transaction) => {
      await transaction.hostedRevnetIssuance.update({
        where: {
          id: issuance.id,
        },
        data: {
          confirmedAt: new Date(),
          failureCode: null,
          failureMessage: null,
          status: HostedRevnetIssuanceStatus.confirmed,
        },
      });

      const member = await readHostedMemberSnapshot({
        memberId: issuance.memberId,
        prisma: transaction,
      });

      if (!member) {
        return null;
      }

      return activateHostedMemberFromConfirmedRevnetIssuanceTx({
        emailLinked: await resolveHostedMemberEmailLinked({
          memberId: issuance.memberId,
          onUnconfirmed: "disable",
        }),
        member,
        occurredAt: new Date().toISOString(),
        prisma: transaction,
        sourceEventId: issuance.id,
        sourceType: "hosted.revnet.issuance.confirmed",
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    try {
      await runHostedMemberActivationPostCommitEffects({
        postCommitProvisionUserId: activationResult?.postCommitProvisionUserId ?? null,
      });
    } catch (error) {
      await scheduleHostedRevnetConfirmationRetry({
        attemptCount: issuance.attemptCount + 1,
        error,
        issuanceId: issuance.id,
        prisma: input.prisma,
      });
      throw error;
    }

    confirmedIssuanceIds.push(issuance.id);
  }

  return confirmedIssuanceIds;
}

async function scheduleHostedRevnetConfirmationRetry(input: {
  attemptCount: number;
  error: unknown;
  issuanceId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedRevnetIssuance.updateMany({
    where: {
      id: input.issuanceId,
      status: HostedRevnetIssuanceStatus.confirmed,
    },
    data: {
      attemptCount: input.attemptCount,
      confirmedAt: null,
      failureCode: deriveHostedRevnetConfirmationRetryErrorCode(input.error),
      failureMessage: deriveHostedRevnetConfirmationRetryErrorMessage(input.error),
      nextAttemptAt: computeHostedRevnetConfirmationNextAttemptAt(input.attemptCount),
      status: HostedRevnetIssuanceStatus.submitted,
    },
  });
}

function computeHostedRevnetConfirmationNextAttemptAt(
  attemptCount: number,
  now = new Date(),
): Date {
  return computeHostedRevnetNextAttemptAt(attemptCount, now);
}

function deriveHostedRevnetConfirmationRetryErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  if (error instanceof Error && error.name) {
    return error.name;
  }

  return "REVNET_CONFIRMATION_POST_COMMIT_FAILED";
}

function deriveHostedRevnetConfirmationRetryErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Hosted RevNet confirmation post-commit work failed.";
}
