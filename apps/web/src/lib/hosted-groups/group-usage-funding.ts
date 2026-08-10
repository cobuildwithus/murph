import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { readHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import {
  calculateHostedGroupIncludedUsageUsedPercent,
  classifyHostedGroupUsageCapacity,
} from "./group-usage-capacity";
import {
  hasHostedGroupAutomaticRefillAvailable,
  readHostedGroupSponsorshipPublicState,
} from "./group-sponsorship-authorization";
import {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingPath,
  buildHostedGroupUsageFundingUrl,
  normalizeHostedGroupUsageJoinCode,
  readHostedGroupUsageFundingLocatorRuntimeMemberId,
} from "./group-usage-funding-locator";

export {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingPath,
  buildHostedGroupUsageFundingUrl,
  normalizeHostedGroupUsageFundingLocator,
  normalizeHostedGroupUsageJoinCode,
  readHostedGroupUsageFundingLocatorRuntimeMemberId,
} from "./group-usage-funding-locator";

// A group funding locator is either the group's owner-created opaque join
// code, or, for a group chat that never minted one, a signed funding-only
// locator bound to the exact runtime member. The signed form is accepted only
// by the funding page and checkout target resolution; it is not a join code,
// resolves to no HostedGroup row, and grants no enrollment.
export type HostedGroupUsageFundingClient =
  | PrismaClient
  | Prisma.TransactionClient;

export interface HostedGroupUsageFundingTarget {
  displayName: string | null;
  fundingPath: string;
  joinCode: string;
  kind: string;
  runtimeMemberId: string;
}

export interface HostedGroupUsageStatus {
  /** Private Web state for the funding page; runtime serializers must omit it. */
  sponsorshipStatus: "not_sponsored" | "sponsored";
}

export interface HostedGroupFundingRecoveryStatus {
  /** Whether an assistant-initiated low-capacity funding prompt is timely. */
  fundingNeeded: boolean;
  /** Current explicit funding capability, independent of urgency. */
  fundingUrl: string | null;
  /** Whole-number share of the room's included usage consumed this period. */
  includedUsageUsedPercent?: number;
}

// Accepts the full funding-locator namespace: an owner-created join code or
// the signed funding-only locator.
export async function readHostedGroupUsageFundingTargetByJoinCode(input: {
  joinCode: string;
  prisma?: PrismaClient;
}): Promise<HostedGroupUsageFundingTarget | null> {
  const joinCode = normalizeHostedGroupUsageJoinCode(input.joinCode);
  if (!joinCode) {
    return readHostedGroupUsageFundingLocatorRuntimeMemberId(input.joinCode) !== null
      ? readHostedGroupUsageFundingTargetByLocator({
          locator: input.joinCode,
          prisma: input.prisma,
        })
      : null;
  }

  const prisma = input.prisma ?? getPrisma();
  const group = await prisma.hostedGroup.findUnique({
    select: {
      displayName: true,
      joinCode: true,
      kind: true,
      runtimeMemberId: true,
    },
    where: { joinCode },
  });
  if (!group?.joinCode || !group.runtimeMemberId) {
    return null;
  }
  const [container, hasActiveAccess] = await Promise.all([
    prisma.hostedThreadContainer.findUnique({
      select: { memberId: true },
      where: { memberId: group.runtimeMemberId },
    }),
    hasHostedRuntimeActiveAccess(group.runtimeMemberId, { prisma }),
  ]);
  if (!container || !hasActiveAccess) {
    return null;
  }

  return {
    displayName: normalizeNullableString(group.displayName),
    fundingPath: buildHostedGroupUsageFundingPath(group.joinCode),
    joinCode: group.joinCode,
    kind: group.kind,
    runtimeMemberId: group.runtimeMemberId,
  };
}

export async function readHostedGroupUsageStatus(input: {
  prisma?: HostedGroupUsageFundingClient;
  runtimeMemberId: string;
}): Promise<HostedGroupUsageStatus> {
  const prisma = input.prisma ?? getPrisma();
  return {
    sponsorshipStatus: await readHostedGroupSponsorshipPublicState({
      beneficiaryMemberId: input.runtimeMemberId,
      prisma,
    }),
  };
}

export async function readHostedGroupFundingRecoveryStatus(input: {
  prisma?: HostedGroupUsageFundingClient;
  runtimeMemberId: string;
}): Promise<HostedGroupFundingRecoveryStatus | null> {
  const prisma = input.prisma ?? getPrisma();
  const decision = await readHostedAiUsageGate({
    memberId: input.runtimeMemberId,
    prisma,
  });
  const group = await prisma.hostedGroup.findUnique({
    select: { joinCode: true },
    where: { runtimeMemberId: input.runtimeMemberId },
  });
  const container = await prisma.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: input.runtimeMemberId },
  });
  const hasActiveAccess = await hasHostedRuntimeActiveAccess(
    input.runtimeMemberId,
    { prisma },
  );
  if (
    !container
    || !hasActiveAccess
    || decision.allowanceSource !== "thread_container"
    || (!decision.allowed && decision.reason !== "ai_usage_limit_exceeded")
  ) {
    return null;
  }

  const includedUsageUsedPercent =
    calculateHostedGroupIncludedUsageUsedPercent({
      limitUsdMicros: decision.limitUsdMicros,
      spentUsdMicros: decision.spentUsdMicros,
    });

  const capacityState = classifyHostedGroupUsageCapacity({
    limitUsdMicros: decision.limitUsdMicros,
    remainingUsdMicros: decision.remainingUsdMicros,
  });
  // Exhaustion always gets a recovery link. While merely low, keep the room
  // out of the billing loop only when Web can prove an automatic refill is
  // available or already pending.
  const automaticRefillAvailable = capacityState === "low"
    ? await hasHostedGroupAutomaticRefillAvailable({
        beneficiaryMemberId: input.runtimeMemberId,
        prisma,
      }).catch(() => false)
    : false;
  const fundingNeeded = capacityState === "exhausted" ||
    (capacityState === "low" && !automaticRefillAvailable);
  // A group without an owner-created join code (including one with no
  // HostedGroup row at all) still gets a funding URL through the signed
  // funding-only locator.
  const locator = group?.joinCode
    ?? buildHostedGroupUsageFundingLocatorForRuntimeMember(input.runtimeMemberId);

  return {
    fundingNeeded,
    fundingUrl: locator
      ? buildHostedGroupUsageFundingUrl({ joinCode: locator })
      : null,
    ...(includedUsageUsedPercent === null
      ? {}
      : { includedUsageUsedPercent }),
  };
}

export async function readHostedGroupUsageFundingTargetByLocator(input: {
  locator: string;
  prisma?: PrismaClient;
}): Promise<HostedGroupUsageFundingTarget | null> {
  const joinCode = normalizeHostedGroupUsageJoinCode(input.locator);
  if (joinCode) {
    return readHostedGroupUsageFundingTargetByJoinCode({
      joinCode,
      prisma: input.prisma,
    });
  }

  const runtimeMemberId = readHostedGroupUsageFundingLocatorRuntimeMemberId(input.locator);
  if (!runtimeMemberId) {
    return null;
  }

  const prisma = input.prisma ?? getPrisma();
  const [container, group, hasActiveAccess] = await Promise.all([
    prisma.hostedThreadContainer.findUnique({
      select: { memberId: true },
      where: { memberId: runtimeMemberId },
    }),
    prisma.hostedGroup.findUnique({
      select: { displayName: true, kind: true },
      where: { runtimeMemberId },
    }),
    hasHostedRuntimeActiveAccess(runtimeMemberId, { prisma }),
  ]);
  if (!container || !hasActiveAccess) {
    return null;
  }

  return {
    displayName: normalizeNullableString(group?.displayName ?? null),
    fundingPath: buildHostedGroupUsageFundingPath(input.locator),
    joinCode: input.locator,
    kind: group?.kind ?? "custom",
    runtimeMemberId,
  };
}
