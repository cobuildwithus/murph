import {
  HostedBillingStatus,
  HostedMemberStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  buildHostedActivationWelcomeReply,
  sendHostedLinqChatMessage,
} from "./linq";

type HostedActivationWelcomeClient = PrismaClient | Prisma.TransactionClient;
const DEFAULT_WELCOME_DRAIN_LIMIT = 25;

export async function drainHostedActivationWelcomeMessages(input: {
  limit?: number;
  memberIds?: readonly string[];
  prisma?: HostedActivationWelcomeClient;
  signal?: AbortSignal;
} = {}): Promise<string[]> {
  const prisma = input.prisma ?? getPrisma();
  const memberIds = input.memberIds ? [...new Set(input.memberIds.filter(Boolean))] : null;

  if (memberIds && memberIds.length === 0) {
    return [];
  }

  const queuedMembers = await prisma.hostedMember.findMany({
    where: {
      ...(memberIds
        ? {
            id: {
              in: memberIds,
            },
          }
        : {}),
      billingStatus: HostedBillingStatus.active,
      linqChatId: {
        not: null,
      },
      onboardingWelcomeQueuedAt: {
        not: null,
      },
      onboardingWelcomeSentAt: null,
      status: HostedMemberStatus.active,
    },
    orderBy: [
      {
        onboardingWelcomeQueuedAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    select: {
      id: true,
      linqChatId: true,
    },
    take: Math.max(1, input.limit ?? (memberIds?.length ?? DEFAULT_WELCOME_DRAIN_LIMIT)),
  });

  const sentMemberIds: string[] = [];

  for (const member of queuedMembers) {
    if (!member.linqChatId) {
      continue;
    }

    try {
      await sendHostedLinqChatMessage({
        chatId: member.linqChatId,
        idempotencyKey: buildHostedActivationWelcomeIdempotencyKey(member.id),
        message: buildHostedActivationWelcomeReply(),
        signal: input.signal,
      });
      const updated = await prisma.hostedMember.updateMany({
        where: {
          billingStatus: HostedBillingStatus.active,
          id: member.id,
          linqChatId: member.linqChatId,
          onboardingWelcomeQueuedAt: {
            not: null,
          },
          onboardingWelcomeSentAt: null,
          status: HostedMemberStatus.active,
        },
        data: {
          onboardingWelcomeSentAt: new Date(),
        },
      });

      if (updated.count === 1) {
        sentMemberIds.push(member.id);
      }
    } catch (error) {
      console.error(
        "Hosted activation welcome send failed.",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return sentMemberIds;
}

function buildHostedActivationWelcomeIdempotencyKey(memberId: string): string {
  return `hosted-activation-welcome:${memberId}`;
}
