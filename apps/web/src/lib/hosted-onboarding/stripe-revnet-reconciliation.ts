import {
  HostedRevnetIssuanceStatus,
  type PrismaClient,
} from "@prisma/client";

import {
  activateHostedMemberFromConfirmedRevnetIssuanceTx,
} from "./member-activation";
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

      await activateHostedMemberFromConfirmedRevnetIssuanceTx({
        emailLinked: await resolveHostedMemberEmailLinked({
          memberId: issuance.memberId,
        }),
        member,
        occurredAt: new Date().toISOString(),
        prisma: transaction,
        sourceEventId: issuance.id,
        sourceType: "hosted.revnet.issuance.confirmed",
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

    confirmedIssuanceIds.push(issuance.id);
  }

  return confirmedIssuanceIds;
}
