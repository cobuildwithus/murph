import type { HostedExecutionDirectRoute } from "@murphai/hosted-execution/contracts";

import {
  readHostedMemberVerifiedEmailSnapshots,
  type HostedMemberVerifiedEmailSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  assertActiveHostedThreadRouteContainerAccess,
} from "@/src/lib/hosted-routing/thread-route-store";

export async function readCurrentHostedMemberDirectRoute(input: {
  memberId: string;
  prisma: Parameters<typeof readHostedMemberRoutingState>[0]["prisma"];
}): Promise<HostedExecutionDirectRoute | null> {
  const routing = await readHostedMemberRoutingState(input);
  let route = resolveHostedMemberDirectRoute(routing);
  if (!route) {
    const emailSnapshot = await readHostedMemberVerifiedEmailSnapshot(input);
    route = resolveHostedMemberDirectRoute(routing, emailSnapshot);
  }
  if (!route) {
    return null;
  }

  await assertActiveHostedThreadRouteContainerAccess({
    containerMemberId: input.memberId,
    prisma: input.prisma,
  });
  return route;
}

export async function readCurrentHostedMemberVerifiedEmailAddress(input: {
  memberId: string;
  prisma: Parameters<typeof readHostedMemberVerifiedEmailSnapshots>[0]["prisma"];
}): Promise<string | null> {
  const emailSnapshot = await readHostedMemberVerifiedEmailSnapshot(input);
  const address = normalizeRouteId(emailSnapshot?.verifiedEmail?.address);
  if (!address) {
    return null;
  }

  await assertActiveHostedThreadRouteContainerAccess({
    containerMemberId: input.memberId,
    prisma: input.prisma,
  });
  return address;
}

export function resolveHostedMemberDirectRoute(
  routing: HostedMemberRoutingStateSnapshot | null,
  emailSnapshot: HostedMemberVerifiedEmailSnapshot | null = null,
): HostedExecutionDirectRoute | null {
  const linqThreadId = normalizeRouteId(routing?.linqChatId);
  const telegramThreadId = normalizeRouteId(routing?.telegramThreadId);
  const verifiedEmail = normalizeRouteId(emailSnapshot?.verifiedEmail?.address);
  return linqThreadId
    ? { channel: "linq" as const, threadId: linqThreadId }
    : telegramThreadId
      ? { channel: "telegram" as const, threadId: telegramThreadId }
      : verifiedEmail
        ? { channel: "email" as const, deliveryTarget: verifiedEmail }
        : null;
}

async function readHostedMemberVerifiedEmailSnapshot(input: {
  memberId: string;
  prisma: Parameters<typeof readHostedMemberVerifiedEmailSnapshots>[0]["prisma"];
}): Promise<HostedMemberVerifiedEmailSnapshot | null> {
  const emailSnapshots = await readHostedMemberVerifiedEmailSnapshots({
    memberIds: [input.memberId],
    prisma: input.prisma,
  });
  return emailSnapshots[0] ?? null;
}

function normalizeRouteId(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
