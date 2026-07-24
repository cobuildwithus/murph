import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { readHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { readHostedAppSessionHmacKey } from "../hosted-onboarding/app-session-config";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import {
  classifyHostedGroupUsageCapacity,
  type HostedGroupUsageCapacityState,
} from "./group-usage-capacity";

// A group funding locator is either the group's owner-created opaque join
// code, or, for a group chat that never minted one, a signed funding-only
// locator bound to the exact runtime member. The signed form is accepted only
// by the funding page and checkout target resolution; it is not a join code,
// resolves to no HostedGroup row, and grants no enrollment.
const HOSTED_GROUP_USAGE_FUNDING_LOCATOR_PREFIX = "gf1";
const HOSTED_GROUP_USAGE_FUNDING_LOCATOR_DOMAIN =
  "murph.hosted-group-usage-funding-locator";
const HOSTED_GROUP_USAGE_FUNDING_LOCATOR_VERSION = 1;

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
    !container
    || !hasActiveAccess
    || decision.allowanceSource !== "thread_container"
    || (!decision.allowed && decision.reason !== "ai_usage_limit_exceeded")
  ) {
    return null;
  }

  // A group without an owner-created join code (including one with no
  // HostedGroup row at all) still gets a funding URL through the signed
  // funding-only locator.
  const locator = group?.joinCode
    ?? buildHostedGroupUsageFundingLocatorForRuntimeMember(input.runtimeMemberId);

  return {
    capacityState: classifyHostedGroupUsageCapacity({
      limitUsdMicros: decision.limitUsdMicros,
      remainingUsdMicros: decision.remainingUsdMicros,
    }),
    fundingUrl: locator
      ? buildHostedGroupUsageFundingUrl({ joinCode: locator })
      : null,
    periodEnd: decision.periodEnd.toISOString(),
  };
}

export function buildHostedGroupUsageFundingLocatorForRuntimeMember(
  runtimeMemberId: string,
): string | null {
  const normalized = normalizeNullableString(runtimeMemberId);
  if (!normalized) {
    return null;
  }

  try {
    return [
      HOSTED_GROUP_USAGE_FUNDING_LOCATOR_PREFIX,
      normalized,
      buildHostedGroupUsageFundingLocatorSignature(normalized),
    ].join(".");
  } catch {
    return null;
  }
}

export function readHostedGroupUsageFundingLocatorRuntimeMemberId(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split(".");
  if (
    parts.length !== 3
    || parts[0] !== HOSTED_GROUP_USAGE_FUNDING_LOCATOR_PREFIX
    || !parts[1]
    || !parts[2]
  ) {
    return null;
  }

  try {
    const supplied = Buffer.from(parts[2], "utf8");
    const expected = Buffer.from(
      buildHostedGroupUsageFundingLocatorSignature(parts[1]),
      "utf8",
    );
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
      return null;
    }
  } catch {
    return null;
  }

  return parts[1];
}

export function normalizeHostedGroupUsageFundingLocator(value: unknown): string | null {
  const joinCode = normalizeHostedGroupUsageJoinCode(value);
  if (joinCode) {
    return joinCode;
  }
  return readHostedGroupUsageFundingLocatorRuntimeMemberId(value) !== null
    ? (value as string)
    : null;
}

export async function readHostedGroupUsageFundingTargetByLocator(input: {
  locator: string;
  prisma?: HostedGroupUsageFundingClient;
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

function buildHostedGroupUsageFundingLocatorSignature(runtimeMemberId: string): string {
  const payload = JSON.stringify([
    HOSTED_GROUP_USAGE_FUNDING_LOCATOR_DOMAIN,
    HOSTED_GROUP_USAGE_FUNDING_LOCATOR_VERSION,
    runtimeMemberId,
  ]);
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(payload, "utf8")
    .digest("base64url");
}

export function buildHostedGroupUsageFundingUrl(input: {
  joinCode: string;
  publicBaseUrl?: string | null;
}): string | null {
  const locator = normalizeHostedGroupUsageFundingLocator(input.joinCode);
  const publicBaseUrl = input.publicBaseUrl === undefined
    ? resolveHostedPublicBaseUrl()
    : input.publicBaseUrl;
  if (!locator || !publicBaseUrl) {
    return null;
  }

  try {
    return new URL(
      buildHostedGroupUsageFundingPath(locator),
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
