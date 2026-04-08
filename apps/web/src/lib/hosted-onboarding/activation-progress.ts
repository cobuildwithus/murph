import {
  ExecutionOutboxStatus,
  HostedBillingStatus,
  type PrismaClient,
  type Prisma,
} from "@prisma/client";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";

type HostedActivationProgressPrismaClient = PrismaClient | Prisma.TransactionClient;

const HOSTED_MEMBER_ACTIVATION_EVENT_KIND = "member.activated";

export async function isHostedMemberActivationPending(input: {
  billingStatus: HostedBillingStatus;
  memberId: string;
  prisma: HostedActivationProgressPrismaClient;
}): Promise<boolean> {
  if (input.billingStatus !== HostedBillingStatus.active) {
    return false;
  }

  const activationOutbox = await input.prisma.executionOutbox.findFirst({
    where: {
      eventKind: HOSTED_MEMBER_ACTIVATION_EVENT_KIND,
      userId: input.memberId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      eventId: true,
      status: true,
    },
  });

  if (!activationOutbox) {
    return false;
  }

  if (activationOutbox.status !== ExecutionOutboxStatus.dispatched) {
    return true;
  }

  const controlClient = readHostedExecutionControlClientIfConfigured();

  if (!controlClient) {
    return false;
  }

  try {
    const status = await controlClient.getStatus(input.memberId);
    return status.inFlight
      || status.pendingEventCount > 0
      || status.retryingEventId === activationOutbox.eventId;
  } catch {
    return false;
  }
}
