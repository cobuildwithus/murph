import type { HostedExecutionDirectRoute } from "@murphai/hosted-execution/contracts";

import {
  hostedMemberVerifiedEmailRecordsEqual,
  lockHostedMemberVerifiedEmailRecordTx,
  projectHostedMemberVerifiedEmailRecord,
  readHostedMemberVerifiedEmailRecord,
  readHostedMemberVerifiedEmailSnapshots,
  type HostedMemberVerifiedEmailRecord,
  type HostedMemberVerifiedEmailSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  hostedMemberRoutingRecordsEqual,
  lockHostedMemberRoutingStateTx,
  projectHostedMemberRoutingState,
  readHostedMemberRoutingRecord,
  readHostedMemberRoutingState,
  type HostedMemberRoutingRecord,
  type HostedMemberRoutingStateSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  assertActiveHostedThreadRouteContainerAccess,
} from "@/src/lib/hosted-routing/thread-route-store";

export interface PreparedHostedMemberDirectRoute {
  directRoute: HostedExecutionDirectRoute;
  memberId: string;
  routingRecord: HostedMemberRoutingRecord | null;
  verifiedEmailRecord: HostedMemberVerifiedEmailRecord | null;
}

export async function prepareCurrentHostedMemberDirectRoute(input: {
  memberId: string;
  prisma: Parameters<typeof readHostedMemberRoutingRecord>[0]["prisma"];
}): Promise<PreparedHostedMemberDirectRoute | null> {
  const routingRecord = await readHostedMemberRoutingRecord(input);
  const routing = routingRecord
    ? await projectHostedMemberRoutingState(routingRecord, input.prisma)
    : null;
  const messagingRoute = resolveHostedMemberDirectRoute(routing);
  if (messagingRoute) {
    await assertActiveHostedThreadRouteContainerAccess({
      containerMemberId: input.memberId,
      prisma: input.prisma,
    });
    return {
      directRoute: messagingRoute,
      memberId: input.memberId,
      routingRecord,
      verifiedEmailRecord: null,
    };
  }

  const verifiedEmailRecord = await readHostedMemberVerifiedEmailRecord(input);
  const verifiedEmail = verifiedEmailRecord
    ? await projectHostedMemberVerifiedEmailRecord(verifiedEmailRecord, input.prisma)
    : null;
  const emailRoute = resolveHostedMemberDirectRoute(routing, verifiedEmail);
  if (!emailRoute) {
    return null;
  }
  await assertActiveHostedThreadRouteContainerAccess({
    containerMemberId: input.memberId,
    prisma: input.prisma,
  });
  return {
    directRoute: emailRoute,
    memberId: input.memberId,
    routingRecord,
    verifiedEmailRecord,
  };
}

export async function assertPreparedHostedMemberDirectRouteTx(input: {
  message: string;
  prepared: PreparedHostedMemberDirectRoute;
  prisma: Parameters<typeof lockHostedMemberRoutingStateTx>[0]["prisma"];
}): Promise<void> {
  if (input.prepared.directRoute.channel === "email") {
    await lockHostedMemberVerifiedEmailRecordTx({
      memberId: input.prepared.memberId,
      prisma: input.prisma,
    });
  }
  await lockHostedMemberRoutingStateTx({
    memberId: input.prepared.memberId,
    prisma: input.prisma,
  });

  const currentRoutingRecord = await readHostedMemberRoutingRecord({
    memberId: input.prepared.memberId,
    prisma: input.prisma,
  });
  const routingMatches = hostedMemberRoutingRecordsEqual(
    currentRoutingRecord,
    input.prepared.routingRecord,
  );
  const verifiedEmailMatches = input.prepared.directRoute.channel !== "email"
    || hostedMemberVerifiedEmailRecordsEqual(
      await readHostedMemberVerifiedEmailRecord({
        memberId: input.prepared.memberId,
        prisma: input.prisma,
      }),
      input.prepared.verifiedEmailRecord,
    );
  if (routingMatches && verifiedEmailMatches) {
    await assertActiveHostedThreadRouteContainerAccess({
      containerMemberId: input.prepared.memberId,
      prisma: input.prisma,
    });
    return;
  }

  throw hostedOnboardingError({
    code: "MEAL_PHOTO_CAPTURE_DIRECT_ROUTE_REQUIRED",
    httpStatus: 409,
    message: input.message,
    retryable: false,
  });
}

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
