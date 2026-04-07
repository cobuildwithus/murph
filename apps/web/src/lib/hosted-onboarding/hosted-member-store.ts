/**
 * Owns the core hosted_member row plus composed reads over the specialized
 * identity, routing, and billing store slices without flattening them back into
 * a pre-cutover wide row.
 */
import { type HostedMember, Prisma } from "@prisma/client";

import {
  type HostedMemberStripeBillingRefSnapshot,
  projectHostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import {
  type HostedMemberIdentityState,
  projectHostedMemberIdentityState,
} from "./hosted-member-identity-store";
import {
  type HostedMemberRoutingStateSnapshot,
  projectHostedMemberRoutingState,
} from "./hosted-member-routing-store";
import { type HostedOnboardingPrismaClient } from "./shared";

const hostedMemberCoreStateSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  billingStatus: true,
  createdAt: true,
  id: true,
  suspendedAt: true,
  updatedAt: true,
});

export type HostedMemberCoreState = Prisma.HostedMemberGetPayload<{
  select: typeof hostedMemberCoreStateSelect;
}>;

export interface HostedMemberSnapshot {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  core: HostedMemberCoreState;
  identity: HostedMemberIdentityState | null;
  routing: HostedMemberRoutingStateSnapshot | null;
}

export async function createHostedMember(input: {
  billingStatus: HostedMember["billingStatus"];
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  suspendedAt?: Date | null;
}): Promise<HostedMemberCoreState> {
  return input.prisma.hostedMember.create({
    data: {
      billingStatus: input.billingStatus,
      id: input.memberId,
      ...(input.suspendedAt !== undefined
        ? {
            suspendedAt: input.suspendedAt,
          }
        : {}),
    },
    select: hostedMemberCoreStateSelect,
  });
}

export async function readHostedMemberCoreState(input: {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMemberCoreState | null> {
  return input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: hostedMemberCoreStateSelect,
  });
}

export async function readHostedMemberSnapshot(input: {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMemberSnapshot | null> {
  const memberRecord = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    include: {
      billingRef: true,
      identity: true,
      routing: true,
    },
  });

  if (!memberRecord) {
    return null;
  }

  const identity = memberRecord.identity
    ? projectHostedMemberIdentityState(memberRecord.identity)
    : null;
  const routing = memberRecord.routing
    ? projectHostedMemberRoutingState(memberRecord.routing)
    : null;
  const billingRef = memberRecord.billingRef
    ? projectHostedMemberStripeBillingRefSnapshot(memberRecord.billingRef)
    : null;

  return composeHostedMemberSnapshot(
    {
      billingStatus: memberRecord.billingStatus,
      createdAt: memberRecord.createdAt,
      id: memberRecord.id,
      suspendedAt: memberRecord.suspendedAt,
      updatedAt: memberRecord.updatedAt,
    },
    {
      billingRef,
      identity,
      routing,
    },
  );
}

export async function updateHostedMemberCoreState(input: {
  billingStatus?: HostedMember["billingStatus"];
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  suspendedAt?: Date | null;
}): Promise<HostedMemberCoreState> {
  const data = {
    ...(input.billingStatus !== undefined
      ? {
          billingStatus: input.billingStatus,
        }
      : {}),
    ...(input.suspendedAt !== undefined
      ? {
          suspendedAt: input.suspendedAt,
        }
      : {}),
  };

  if (Object.keys(data).length === 0) {
    throw new TypeError("Hosted member core state updates require at least one field.");
  }

  return input.prisma.hostedMember.update({
    where: {
      id: input.memberId,
    },
    data,
    select: hostedMemberCoreStateSelect,
  });
}

export function composeHostedMemberSnapshot(
  core: HostedMemberCoreState,
  input: {
    billingRef: HostedMemberStripeBillingRefSnapshot | null;
    identity: HostedMemberIdentityState | null;
    routing: HostedMemberRoutingStateSnapshot | null;
  },
): HostedMemberSnapshot {
  return {
    billingRef: input.billingRef,
    core,
    identity: input.identity,
    routing: input.routing,
  };
}
