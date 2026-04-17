import {
  HostedBillingStatus,
  type PrismaClient,
  type Prisma,
} from "@prisma/client";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import {
  isExecutionLifecycleTerminal,
  readExecutionLifecycleState,
} from "../hosted-execution/outbox";
import {
  readLatestHostedWakeLifecycleByKind,
} from "../hosted-wake/store";

type HostedActivationProgressPrismaClient = PrismaClient | Prisma.TransactionClient;

const HOSTED_MEMBER_ACTIVATION_EVENT_KIND = "member.activated";
const HOSTED_MEMBER_ACTIVATION_STATUS_TIMEOUT_MS = 1_500;

export async function isHostedMemberActivationPending(input: {
  billingStatus: HostedBillingStatus;
  memberId: string;
  prisma: HostedActivationProgressPrismaClient;
}): Promise<boolean> {
  if (input.billingStatus !== HostedBillingStatus.active) {
    return false;
  }

  const activationOutbox = await readLatestHostedMemberActivationLifecycle({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!activationOutbox) {
    return false;
  }

  if (isExecutionLifecycleTerminal(activationOutbox.state)) {
    return false;
  }

  const controlClient = readHostedExecutionControlClientIfConfigured(
    HOSTED_MEMBER_ACTIVATION_STATUS_TIMEOUT_MS,
  );

  if (!controlClient) {
    return true;
  }

  try {
    const eventStatus = await controlClient.getEventStatus(
      input.memberId,
      activationOutbox.eventId,
    );

    return !isExecutionLifecycleTerminal(eventStatus?.state ?? activationOutbox.state);
  } catch {
    return true;
  }
}

async function readLatestHostedMemberActivationLifecycle(input: {
  memberId: string;
  prisma: HostedActivationProgressPrismaClient;
}) {
  const activationOutbox = await input.prisma.executionOutbox.findFirst({
    where: {
      eventKind: HOSTED_MEMBER_ACTIVATION_EVENT_KIND,
      userId: input.memberId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      dispatchState: true,
      eventId: true,
    },
  });

  if (activationOutbox) {
    return {
      eventId: activationOutbox.eventId,
      state: readExecutionLifecycleState(activationOutbox.dispatchState),
    };
  }

  if (!supportsHostedWakeLifecycleReads(input.prisma)) {
    return null;
  }

  return readLatestHostedWakeLifecycleByKind({
    kind: HOSTED_MEMBER_ACTIVATION_EVENT_KIND,
    prisma: input.prisma,
    userId: input.memberId,
  });
}

function supportsHostedWakeLifecycleReads(
  prisma: HostedActivationProgressPrismaClient,
): prisma is HostedActivationProgressPrismaClient & {
  hostedExecutionCursor: object;
  hostedWake: object;
} {
  return "hostedExecutionCursor" in prisma && "hostedWake" in prisma;
}
