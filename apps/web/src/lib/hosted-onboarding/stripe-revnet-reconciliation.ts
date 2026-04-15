import {
  HostedRevnetIssuanceStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  activateHostedMemberFromConfirmedRevnetIssuance,
} from "./member-activation";
import { readHostedMemberSnapshot } from "./hosted-member-store";
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
  const issuances = await input.prisma.hostedRevnetIssuance.findMany({
    where: {
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

    await input.prisma.$transaction(async (transaction) => {
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

      await activateHostedMemberFromConfirmedRevnetIssuance({
        member,
        occurredAt: new Date().toISOString(),
        prisma: transaction as Prisma.TransactionClient,
        sourceEventId: issuance.id,
        sourceType: "hosted.revnet.issuance.confirmed",
      });
    });

    confirmedIssuanceIds.push(issuance.id);
  }

  return confirmedIssuanceIds;
}
