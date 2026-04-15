import {
  ExecutionOutboxStatus,
  HostedBillingStatus,
  type PrismaClient,
  type Prisma,
} from "@prisma/client";
import {
  HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATES,
  type HostedExecutionDispatchLifecycleState,
} from "@murphai/hosted-execution";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";

type HostedActivationProgressPrismaClient = PrismaClient | Prisma.TransactionClient;

const HOSTED_MEMBER_ACTIVATION_EVENT_KIND = "member.activated";
const HOSTED_MEMBER_ACTIVATION_STATUS_TIMEOUT_MS = 1_500;
const HOSTED_EXECUTION_EVENT_DISPATCH_STATE_SET = new Set<HostedExecutionDispatchLifecycleState>(
  HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATES,
);
const DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE: HostedExecutionDispatchLifecycleState = "queued";

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

    if (!eventStatus) {
      return false;
    }

    return !isHostedExecutionEventDispatchTerminal(eventStatus.state);
  } catch {
    return true;
  }
}

function readHostedExecutionEventDispatchState(
  value: string | null | undefined,
): HostedExecutionDispatchLifecycleState {
  if (
    value
    && HOSTED_EXECUTION_EVENT_DISPATCH_STATE_SET.has(value as HostedExecutionDispatchLifecycleState)
  ) {
    return value as HostedExecutionDispatchLifecycleState;
  }

  return DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE;
}

function isHostedExecutionEventDispatchTerminal(
  state: HostedExecutionDispatchLifecycleState,
): boolean {
  return state === "completed"
    || state === "poisoned";
}
