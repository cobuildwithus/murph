import {
  HostedBillingStatus,
  type PrismaClient,
  type Prisma,
} from "@prisma/client";

import {
  isHostedIngressLifecycleTerminal,
} from "../hosted-ingress/lifecycle";
import {
  readLatestHostedIngressLifecycleByKind,
} from "../hosted-ingress/store";

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

  const activationLifecycle = await readLatestHostedIngressLifecycleByKind({
    kind: HOSTED_MEMBER_ACTIVATION_EVENT_KIND,
    prisma: input.prisma,
    userId: input.memberId,
  });

  if (!activationLifecycle) {
    return false;
  }

  return !isHostedIngressLifecycleTerminal(activationLifecycle.state);
}
