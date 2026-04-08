import {
  ExecutionOutboxStatus,
  HostedBillingStatus,
  type PrismaClient,
  type Prisma,
} from "@prisma/client";
import {
  HOSTED_EXECUTION_EVENT_DISPATCH_STATES,
  type HostedExecutionEventDispatchState,
} from "@murphai/hosted-execution";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";

type HostedActivationProgressPrismaClient = PrismaClient | Prisma.TransactionClient;

const HOSTED_MEMBER_ACTIVATION_EVENT_KIND = "member.activated";
const HOSTED_EXECUTION_EVENT_DISPATCH_STATE_SET = new Set<HostedExecutionEventDispatchState>(
  HOSTED_EXECUTION_EVENT_DISPATCH_STATES,
);
const DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE: HostedExecutionEventDispatchState = "queued";

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
      dispatchState: true,
      eventId: true,
      status: true,
    },
  });

  if (!activationOutbox) {
    return false;
  }

  const dispatchState = readHostedExecutionEventDispatchState(activationOutbox.dispatchState);

  if (isHostedExecutionEventDispatchTerminal(dispatchState)) {
    return false;
  }

  if (activationOutbox.status !== ExecutionOutboxStatus.dispatched) {
    return true;
  }

  const controlClient = readHostedExecutionControlClientIfConfigured();

  if (!controlClient) {
    return true;
  }

  try {
    const status = await controlClient.getStatus(input.memberId);
    if (status.poisonedEventIds.includes(activationOutbox.eventId)) {
      return false;
    }

    return status.inFlight
      || status.pendingEventCount > 0
      || status.retryingEventId === activationOutbox.eventId;
  } catch {
    return true;
  }
}

function readHostedExecutionEventDispatchState(
  value: string | null | undefined,
): HostedExecutionEventDispatchState {
  if (
    value
    && HOSTED_EXECUTION_EVENT_DISPATCH_STATE_SET.has(value as HostedExecutionEventDispatchState)
  ) {
    return value as HostedExecutionEventDispatchState;
  }

  return DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE;
}

function isHostedExecutionEventDispatchTerminal(
  state: HostedExecutionEventDispatchState,
): boolean {
  return state === "duplicate_consumed"
    || state === "completed"
    || state === "poisoned";
}
