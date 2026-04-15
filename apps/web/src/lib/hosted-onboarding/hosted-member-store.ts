/**
 * Owns the core hosted_member row plus composed reads over the specialized
 * identity, routing, and billing store slices without flattening them back into
 * one wide row.
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
import { type HostedOnboardingReadClient } from "./shared";

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

/**
 * Billing orchestration should depend on the core+billing slice instead of the
 * full hosted member snapshot so Stripe flows do not silently couple to
 * identity and routing ownership.
 */
export interface HostedMemberBillingSnapshot {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  core: HostedMemberCoreState;
}

export interface HostedMemberSnapshot extends HostedMemberBillingSnapshot {
  identity: HostedMemberIdentityState | null;
  routing: HostedMemberRoutingStateSnapshot | null;
}

export async function createHostedMember(input: {
  billingStatus: HostedMember["billingStatus"];
  memberId: string;
  prisma: Prisma.TransactionClient;
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
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberCoreState | null> {
  return input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: hostedMemberCoreStateSelect,
  });
}

export async function readHostedMemberBillingSnapshot(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberBillingSnapshot | null> {
  const memberRecord = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    include: {
      billingRef: true,
    },
  });

  if (!memberRecord) {
    return null;
  }

  return composeHostedMemberBillingSnapshot(
    projectHostedMemberCoreState(memberRecord),
    memberRecord.billingRef
      ? projectHostedMemberStripeBillingRefSnapshot(memberRecord.billingRef)
      : null,
  );
}

export async function readHostedMemberSnapshot(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
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
  const billing = composeHostedMemberBillingSnapshot(
    projectHostedMemberCoreState(memberRecord),
    memberRecord.billingRef
      ? projectHostedMemberStripeBillingRefSnapshot(memberRecord.billingRef)
      : null,
  );

  return composeHostedMemberSnapshot(billing.core, {
    billingRef: billing.billingRef,
    identity,
    routing,
  });
}

export async function updateHostedMemberCoreState(input: {
  billingStatus?: HostedMember["billingStatus"];
  memberId: string;
  prisma: Prisma.TransactionClient;
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

export function composeHostedMemberBillingSnapshot(
  core: HostedMemberCoreState,
  billingRef: HostedMemberStripeBillingRefSnapshot | null,
): HostedMemberBillingSnapshot {
  return {
    billingRef,
    core,
  };
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

function projectHostedMemberCoreState(
  member: Pick<
    HostedMember,
    "billingStatus" | "createdAt" | "id" | "suspendedAt" | "updatedAt"
  >,
): HostedMemberCoreState {
  return {
    billingStatus: member.billingStatus,
    createdAt: member.createdAt,
    id: member.id,
    suspendedAt: member.suspendedAt,
    updatedAt: member.updatedAt,
  };
}
