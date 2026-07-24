import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { readHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import {
  calculateHostedGroupUsageRemainingPercent,
  classifyHostedGroupUsageCapacity,
  type HostedGroupUsageCapacityState,
} from "./group-usage-capacity";

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
  capacityState: HostedGroupUsageCapacityState;
  fundingUrl: string | null;
  periodEnd: string;
  remainingPercent: number;
}

export async function readHostedGroupUsageFundingTargetByJoinCode(input: {
  joinCode: string;
  prisma?: HostedGroupUsageFundingClient;
}): Promise<HostedGroupUsageFundingTarget | null> {
  const joinCode = normalizeHostedGroupUsageJoinCode(input.joinCode);
  if (!joinCode) {
    return null;
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
}): Promise<HostedGroupUsageStatus | null> {
  const prisma = input.prisma ?? getPrisma();
  const [decision, group, container, hasActiveAccess] = await Promise.all([
    readHostedAiUsageGate({
      memberId: input.runtimeMemberId,
      prisma,
    }),
    prisma.hostedGroup.findUnique({
      select: { joinCode: true },
      where: { runtimeMemberId: input.runtimeMemberId },
    }),
    prisma.hostedThreadContainer.findUnique({
      select: { memberId: true },
      where: { memberId: input.runtimeMemberId },
    }),
    hasHostedRuntimeActiveAccess(input.runtimeMemberId, { prisma }),
  ]);
  if (
    !group
    || !container
    || !hasActiveAccess
    || decision.allowanceSource !== "thread_container"
    || (!decision.allowed && decision.reason !== "ai_usage_limit_exceeded")
  ) {
    return null;
  }

  return {
    capacityState: classifyHostedGroupUsageCapacity({
      limitUsdMicros: decision.limitUsdMicros,
      remainingUsdMicros: decision.remainingUsdMicros,
    }),
    fundingUrl: group.joinCode
      ? buildHostedGroupUsageFundingUrl({ joinCode: group.joinCode })
      : null,
    periodEnd: decision.periodEnd.toISOString(),
    remainingPercent: calculateHostedGroupUsageRemainingPercent({
      limitUsdMicros: decision.limitUsdMicros,
      remainingUsdMicros: decision.remainingUsdMicros,
    }),
  };
}

export function buildHostedGroupUsageFundingUrl(input: {
  joinCode: string;
  publicBaseUrl?: string | null;
}): string | null {
  const joinCode = normalizeHostedGroupUsageJoinCode(input.joinCode);
  const publicBaseUrl = input.publicBaseUrl === undefined
    ? resolveHostedPublicBaseUrl()
    : input.publicBaseUrl;
  if (!joinCode || !publicBaseUrl) {
    return null;
  }

  try {
    return new URL(
      buildHostedGroupUsageFundingPath(joinCode),
      `${publicBaseUrl.replace(/\/+$/u, "")}/`,
    ).toString();
  } catch {
    return null;
  }
}

export function buildHostedGroupUsageFundingPath(joinCode: string): string {
  return `/groups/fund/${encodeURIComponent(joinCode)}`;
}

export function normalizeHostedGroupUsageJoinCode(value: unknown): string | null {
  const normalized = typeof value === "string"
    ? normalizeNullableString(value)
    : null;
  return normalized && /^[A-Za-z0-9_-]{16,128}$/u.test(normalized)
    ? normalized
    : null;
}
