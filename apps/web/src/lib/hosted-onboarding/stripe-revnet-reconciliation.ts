import {
  HostedRevnetIssuanceStatus,
  type PrismaClient,
} from "@prisma/client";

import {
  activateHostedMemberFromConfirmedRevnetIssuanceTx,
} from "./member-activation";
import { nudgeHostedRunBestEffort } from "../hosted-ingress/control";
import { resolveHostedMemberEmailLinked } from "./member-channel-sync";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  isHostedOnboardingRevnetEnabled,
  readHostedRevnetPaymentReceipt,
} from "./revnet";

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

    const activationEventId = await input.prisma.$transaction(async (transaction) => {
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
        return;
      }

      const activation = await activateHostedMemberFromConfirmedRevnetIssuanceTx({
        emailLinked: await resolveHostedMemberEmailLinked({
          memberId: issuance.memberId,
        }),
        member,
        occurredAt: new Date().toISOString(),
        prisma: transaction,
        sourceEventId: issuance.id,
        sourceType: "hosted.revnet.issuance.confirmed",
      });

      return activation.hostedExecutionEventId;
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

    if (activationEventId) {
      await nudgeHostedRunBestEffort({
        context: "stripe-revnet-reconciliation",
        eventId: activationEventId,
        prisma: input.prisma,
        userId: issuance.memberId,
      });
    }

    confirmedIssuanceIds.push(issuance.id);
  }

  return confirmedIssuanceIds;
}
