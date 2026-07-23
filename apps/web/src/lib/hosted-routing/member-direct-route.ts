import type { HostedExecutionDirectRoute } from "@murphai/hosted-execution/contracts";

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
  const route = resolveHostedMemberDirectRoute(routing);
  if (!route) {
    return null;
  }

  await assertActiveHostedThreadRouteContainerAccess({
    containerMemberId: input.memberId,
    prisma: input.prisma,
  });
  return route;
}

export function resolveHostedMemberDirectRoute(
  routing: HostedMemberRoutingStateSnapshot | null,
): HostedExecutionDirectRoute | null {
  const linqThreadId = normalizeRouteId(routing?.linqChatId);
  const telegramThreadId = normalizeRouteId(routing?.telegramThreadId);
  return linqThreadId
    ? { channel: "linq" as const, threadId: linqThreadId }
    : telegramThreadId
      ? { channel: "telegram" as const, threadId: telegramThreadId }
      : null;
}

function normalizeRouteId(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
