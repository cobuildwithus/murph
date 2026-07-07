import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedCallCircleRespondContext,
  HostedCallCircleRespondRequest,
  HostedCallCircleRespondResponse,
} from "@murphai/hosted-execution/call-circle";
import type {
  CallCircleParticipantStatus,
} from "./types";

import {
  cancelOpenCallCircleMatchesForParticipant,
  counterCallCircleMatchSide,
  declineCallCircleMatchSide,
  confirmCallCircleMatchSide,
  markCallCircleMatchAmAsked,
  markCallCircleMatchOutcome,
} from "./match-store";
import {
  canUseActiveCallCircleParticipantPair,
  pauseCallCircleParticipant,
  resumeCallCircleParticipant,
  writeCallCirclePreferences,
} from "./participant-store";
import {
  appendCallCircleConfirmNotificationTx,
  type CallCircleNotificationSignal,
  readCallCircleNotificationSignal,
  readCallCircleNotificationPreflightTx,
  signalCallCircleNotificationRuntimesBestEffort,
} from "./notifications";
import {
  canScheduleCallCircleConfirmationFlow,
  isWithinCallCircleQuietHours,
  normalizeCallCircleTimeZone,
} from "./time";
import {
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import { getPrisma } from "../prisma";

const CALL_CIRCLE_COUNTER_WINDOW_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const CALL_CIRCLE_SETUP_NOTIFICATION_DEDUPE_PREFIX =
  "assistant.notification.requested:call-circle:setup:";
const CALL_CIRCLE_REPLY_CONTEXT_MAILBOX_ITEM_LIMIT = 20;

type CallCircleNotificationPreflightOk = Extract<
  Awaited<ReturnType<typeof readCallCircleNotificationPreflightTx>>,
  { status: "ok" }
>;

export async function handleCallCircleRespond(input: {
  context?: HostedCallCircleRespondContext | null;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  request: HostedCallCircleRespondRequest;
}): Promise<HostedCallCircleRespondResponse> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  let counterReaskSignal: CallCircleNotificationSignal | null = null;

  const response = await prisma.$transaction<HostedCallCircleRespondResponse>(async (tx) => {
    const target = await resolveCallCircleResponseTarget({
      memberId: input.memberId,
      now,
      prisma: tx,
      replyContext: input.context ?? null,
      request: input.request,
    });
    if (target.status === "unavailable") {
      return { status: "unavailable", unavailableReason: target.unavailableReason };
    }
    const authority = await readCallCircleResponseAuthority({
      groupId: target.groupId,
      memberId: input.memberId,
      prisma: tx,
    });
    if (!authority.available) {
      return { status: "unavailable", unavailableReason: "member_unavailable" };
    }

    switch (input.request.kind) {
      case "preferences": {
        if (authority.participantStatus === null) {
          return { status: "unavailable", unavailableReason: "call_circle_not_enrolled" };
        }
        const windows = input.request.windows ?? [];
        const changed = await writeCallCirclePreferences({
          groupId: target.groupId,
          memberId: input.memberId,
          preferences: {
            excludeMemberIds: input.request.excludeMemberIds ?? [],
            windows,
          },
          prisma: tx,
        });
        return { status: changed ? "ok" : "ignored" };
      }
      case "pause": {
        if (authority.participantStatus === null) {
          return { status: "unavailable", unavailableReason: "call_circle_not_enrolled" };
        }
        if (authority.participantStatus === "paused") {
          await cancelOpenCallCircleMatchesForParticipant({
            groupId: target.groupId,
            memberId: input.memberId,
            now,
            prisma: tx,
          });
          return { status: "ok" };
        }
        const changed = await pauseCallCircleParticipant({
          groupId: target.groupId,
          memberId: input.memberId,
          prisma: tx,
        });
        if (changed) {
          await cancelOpenCallCircleMatchesForParticipant({
            groupId: target.groupId,
            memberId: input.memberId,
            now,
            prisma: tx,
          });
        }
        return { status: changed ? "ok" : "ignored" };
      }
      case "resume": {
        if (authority.participantStatus === null) {
          return { status: "unavailable", unavailableReason: "call_circle_not_enrolled" };
        }
        if (authority.participantStatus === "enrolled") return { status: "ok" };
        const changed = await resumeCallCircleParticipant({
          groupId: target.groupId,
          memberId: input.memberId,
          prisma: tx,
        });
        return { status: changed ? "ok" : "ignored" };
      }
      case "confirm": {
        const unavailable = readActiveCallCircleUnavailableReason(authority.participantStatus);
        if (unavailable) return { status: "unavailable", unavailableReason: unavailable };
        if (!target.match) return { status: "ignored" };
        if (target.match.expired) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        if (!await ensureActiveCallCircleMatchPair({
          match: target.match,
          now,
          tx,
        })) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        if (target.match.status === "both_confirmed") return { status: "ok" };
        const result = await confirmCallCircleMatchSide({
          groupId: target.groupId,
          matchId: target.match.id,
          memberId: input.memberId,
          now,
          prisma: tx,
          side: target.match.side,
        });
        return { status: result.changed ? "ok" : "ignored" };
      }
      case "decline": {
        const unavailable = readActiveCallCircleUnavailableReason(authority.participantStatus);
        if (unavailable) return { status: "unavailable", unavailableReason: unavailable };
        if (!target.match) return { status: "ignored" };
        if (target.match.expired) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        if (!await ensureActiveCallCircleMatchPair({
          match: target.match,
          now,
          tx,
        })) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        const result = await declineCallCircleMatchSide({
          groupId: target.groupId,
          matchId: target.match.id,
          memberId: input.memberId,
          now,
          prisma: tx,
          side: target.match.side,
        });
        return { status: result.changed ? "ok" : "ignored" };
      }
      case "counter": {
        const unavailable = readActiveCallCircleUnavailableReason(authority.participantStatus);
        if (unavailable) return { status: "unavailable", unavailableReason: unavailable };
        if (!target.match || !input.request.counterWindow) {
          return { status: "ignored" };
        }
        if (target.match.expired) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        if (!await ensureActiveCallCircleMatchPair({
          match: target.match,
          now,
          tx,
        })) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        const counterWindow = {
          endAt: new Date(input.request.counterWindow.endAt),
          startAt: new Date(input.request.counterWindow.startAt),
        };
        if (!isValidCounterWindow({ now, ...counterWindow })) {
          return { status: "unavailable", unavailableReason: "counter_window_invalid" };
        }
        if (!canScheduleCallCircleConfirmationFlow({
          memberATimeZone: target.match.memberATimeZone,
          memberBTimeZone: target.match.memberBTimeZone,
          now,
          windowStartAt: counterWindow.startAt,
        })) {
          return { status: "unavailable", unavailableReason: "counter_window_invalid" };
        }
        const reaskMemberId = target.match.side === "A"
          ? target.match.memberBId
          : target.match.memberAId;
        const reaskTimeZone = target.match.side === "A"
          ? target.match.memberBTimeZone
          : target.match.memberATimeZone;
        const shouldSendReaskNow = isWithinCallCircleQuietHours({
          now,
          timeZone: reaskTimeZone,
        });
        const result = await counterCallCircleMatchSide({
          groupId: target.groupId,
          matchId: target.match.id,
          memberId: input.memberId,
          now,
          prisma: tx,
          side: target.match.side,
          windowEndAt: counterWindow.endAt,
          windowStartAt: counterWindow.startAt,
        });
        if (!result.changed) return { status: "ignored" };
        if (shouldSendReaskNow) {
          const reaskPreflight = await readCallCircleNotificationPreflightTx({
            memberId: reaskMemberId,
            now,
            tx,
          });
          if (reaskPreflight.status !== "ok") {
            await markCallCircleMatchOutcome({
              matchId: target.match.id,
              now,
              outcome: "notification_blocked",
              prisma: tx,
              status: "dropped",
            });
            return { status: "unavailable", unavailableReason: "counter_reask_unavailable" };
          }
          counterReaskSignal = await appendCounterReaskTx({
            matchId: target.match.id,
            now,
            preflight: reaskPreflight,
            side: target.match.side,
            tx,
          });
        }
        return { status: "ok" };
      }
    }
  });
  await signalCallCircleNotificationRuntimesBestEffort([counterReaskSignal]);
  return response;
}

type ResolvedCallCircleResponseTarget =
  | {
      groupId: string;
      match: ResolvedCallCircleResponseMatch | null;
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    };

type ResolvedCallCircleResponseMatch = {
  groupId: string;
  id: string;
  amAskedAt: Date | null;
  expired: boolean;
  finalAskedAt: Date | null;
  memberAId: string;
  memberATimeZone: string;
  memberBId: string;
  memberBTimeZone: string;
  side: "A" | "B";
  status: string;
};

async function resolveCallCircleResponseTarget(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  replyContext: HostedCallCircleRespondContext | null;
  request: HostedCallCircleRespondRequest;
}): Promise<ResolvedCallCircleResponseTarget> {
  if (isCallCircleMatchResponseKind(input.request.kind)) {
    const match = await resolveCallCircleResponseMatch(input);
    if (!match) {
      return {
        status: "unavailable",
        unavailableReason: "call_circle_match_unavailable",
      };
    }
    return { groupId: match.groupId, match, status: "ok" };
  }

  const setupContext = await resolveCallCircleSetupGroupIdFromReplyContext({
    memberId: input.memberId,
    prisma: input.prisma,
    replyContext: input.replyContext,
  });
  if (setupContext.status === "ambiguous") {
    return {
      status: "unavailable",
      unavailableReason: "call_circle_context_unavailable",
    };
  }
  if (setupContext.status === "exact") {
    if (input.request.groupId && input.request.groupId !== setupContext.groupId) {
      return {
        status: "unavailable",
        unavailableReason: "call_circle_context_unavailable",
      };
    }
    return { groupId: setupContext.groupId, match: null, status: "ok" };
  }

  const groupId = input.request.groupId
    ?? await resolveSingleCallCircleParticipantGroupId({
      memberId: input.memberId,
      prisma: input.prisma,
    });
  if (!groupId) {
    return {
      status: "unavailable",
      unavailableReason: "call_circle_context_unavailable",
    };
  }
  return { groupId, match: null, status: "ok" };
}

type CallCircleSetupContextResolution =
  | { status: "none" }
  | { status: "ambiguous" }
  | { groupId: string; status: "exact" };

async function resolveCallCircleSetupGroupIdFromReplyContext(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyContext: HostedCallCircleRespondContext | null;
}): Promise<CallCircleSetupContextResolution> {
  const mailboxItemIds = normalizeReplyContextMailboxItemIds(
    input.replyContext?.inboundMailboxItemIds,
  );
  if (mailboxItemIds.length === 0) return { status: "none" };

  const setupNotifications = await input.prisma.hostedMailboxItem.findMany({
    select: { dedupeKey: true },
    where: {
      dedupeKey: {
        endsWith: `:${input.memberId}`,
        startsWith: CALL_CIRCLE_SETUP_NOTIFICATION_DEDUPE_PREFIX,
      },
      id: { in: mailboxItemIds },
      kind: "assistant.notification.requested",
      userId: input.memberId,
    },
  });

  const groupIds: string[] = [];
  for (const notification of setupNotifications) {
    const groupId = readCallCircleSetupGroupIdFromDedupeKey({
      dedupeKey: notification.dedupeKey,
      memberId: input.memberId,
    });
    if (groupId && !groupIds.includes(groupId)) {
      groupIds.push(groupId);
    }
  }
  if (groupIds.length === 0) return { status: "none" };
  return groupIds.length === 1
    ? { groupId: groupIds[0]!, status: "exact" }
    : { status: "ambiguous" };
}

function normalizeReplyContextMailboxItemIds(
  value: readonly string[] | null | undefined,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value ?? []) {
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= CALL_CIRCLE_REPLY_CONTEXT_MAILBOX_ITEM_LIMIT) break;
  }
  return result;
}

function readCallCircleSetupGroupIdFromDedupeKey(input: {
  dedupeKey: string;
  memberId: string;
}): string | null {
  if (!input.dedupeKey.startsWith(CALL_CIRCLE_SETUP_NOTIFICATION_DEDUPE_PREFIX)) {
    return null;
  }
  const suffix = `:${input.memberId}`;
  if (!input.dedupeKey.endsWith(suffix)) return null;
  const groupId = input.dedupeKey.slice(
    CALL_CIRCLE_SETUP_NOTIFICATION_DEDUPE_PREFIX.length,
    input.dedupeKey.length - suffix.length,
  );
  return groupId.trim() || null;
}

async function resolveSingleCallCircleParticipantGroupId(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<string | null> {
  const participants = await input.prisma.hostedCallCircleParticipant.findMany({
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
    select: { groupId: true },
    take: 2,
    where: { memberId: input.memberId },
  });
  return participants.length === 1 ? participants[0]?.groupId ?? null : null;
}

async function resolveCallCircleResponseMatch(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  replyContext: HostedCallCircleRespondContext | null;
  request: HostedCallCircleRespondRequest;
}): Promise<ResolvedCallCircleResponseMatch | null> {
  const match = input.request.matchId
    ? await input.prisma.hostedCallCircleMatch.findUnique({
      select: callCircleResponseMatchSelect,
      where: { id: input.request.matchId },
    })
    : await resolveSinglePendingCallCircleResponseMatch(input);
  if (!match) return null;
  if (input.request.groupId && input.request.groupId !== match.groupId) return null;
  const side = match.memberAId === input.memberId
    ? "A"
    : match.memberBId === input.memberId
      ? "B"
      : null;
  if (!side) return null;
  if (input.request.side && input.request.side !== side) return null;
  if (
    match.status !== "both_confirmed"
    && match.amAskedAt === null
    && match.finalAskedAt === null
  ) {
    return null;
  }
  const askAt = readCurrentCallCircleMatchAskAt(match);
  if (!askAt || !await hasFreshCallCircleReplyContext({
    askAt,
    memberId: input.memberId,
    prisma: input.prisma,
    replyContext: input.replyContext,
  })) {
    return null;
  }
  return {
    amAskedAt: match.amAskedAt,
    expired: match.windowEndAt.getTime() <= input.now.getTime(),
    finalAskedAt: match.finalAskedAt,
    groupId: match.groupId,
    id: match.id,
    memberAId: match.memberAId,
    memberATimeZone: normalizeCallCircleTimeZone(
      match.memberA.pendingActivationTimeZone,
    ),
    memberBId: match.memberBId,
    memberBTimeZone: normalizeCallCircleTimeZone(
      match.memberB.pendingActivationTimeZone,
    ),
    side,
    status: match.status,
  };
}

const callCircleResponseMatchSelect = {
  amAskedAt: true,
  finalAskedAt: true,
  groupId: true,
  id: true,
  memberA: { select: { pendingActivationTimeZone: true } },
  memberAId: true,
  memberB: { select: { pendingActivationTimeZone: true } },
  memberBId: true,
  status: true,
  windowEndAt: true,
} satisfies Prisma.HostedCallCircleMatchSelect;

async function resolveSinglePendingCallCircleResponseMatch(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  request: HostedCallCircleRespondRequest;
}) {
  const matches = await input.prisma.hostedCallCircleMatch.findMany({
    orderBy: [
      { windowStartAt: "asc" },
      { createdAt: "desc" },
    ],
    select: callCircleResponseMatchSelect,
    take: 2,
    where: {
      ...(input.request.groupId ? { groupId: input.request.groupId } : {}),
      OR: [
        {
          memberAId: input.memberId,
          sideAResponse: "pending",
          status: { in: ["proposed", "asking"] },
        },
        {
          memberBId: input.memberId,
          sideBResponse: "pending",
          status: { in: ["proposed", "asking"] },
        },
        {
          finalAskedAt: { not: null },
          memberAId: input.memberId,
          status: "both_confirmed",
        },
        {
          finalAskedAt: { not: null },
          memberBId: input.memberId,
          status: "both_confirmed",
        },
      ],
      windowEndAt: { gt: input.now },
    },
  });
  return matches.length === 1 ? matches[0] ?? null : null;
}

async function hasFreshCallCircleReplyContext(input: {
  askAt: Date;
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyContext: HostedCallCircleRespondContext | null;
}): Promise<boolean> {
  const replyOccurredAt = await readLatestCallCircleReplyOccurredAt(input);
  return replyOccurredAt !== null
    && replyOccurredAt.getTime() >= input.askAt.getTime();
}

async function readLatestCallCircleReplyOccurredAt(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyContext: HostedCallCircleRespondContext | null;
}): Promise<Date | null> {
  const mailboxItemIds = normalizeReplyContextMailboxItemIds(
    input.replyContext?.inboundMailboxItemIds,
  );
  if (mailboxItemIds.length === 0) return null;

  const inbound = await input.prisma.hostedMailboxItem.findMany({
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
    take: 1,
    where: {
      id: { in: mailboxItemIds },
      userId: input.memberId,
    },
  });
  return inbound[0]?.occurredAt ?? null;
}

function readCurrentCallCircleMatchAskAt(input: Pick<
  ResolvedCallCircleResponseMatch,
  "amAskedAt" | "finalAskedAt"
>): Date | null {
  return input.finalAskedAt ?? input.amAskedAt;
}

function isCallCircleMatchResponseKind(
  kind: HostedCallCircleRespondRequest["kind"],
): boolean {
  return kind === "confirm" || kind === "counter" || kind === "decline";
}

async function ensureActiveCallCircleMatchPair(input: {
  match: Pick<ResolvedCallCircleResponseMatch, "groupId" | "id" | "memberAId" | "memberBId">;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  if (await canUseActiveCallCircleParticipantPair({
    groupId: input.match.groupId,
    memberAId: input.match.memberAId,
    memberBId: input.match.memberBId,
    prisma: input.tx,
  })) {
    return true;
  }
  await markCallCircleMatchOutcome({
    matchId: input.match.id,
    now: input.now,
    outcome: "participant_unavailable",
    prisma: input.tx,
    status: "canceled",
  });
  return false;
}

async function readCallCircleResponseAuthority(input: {
  groupId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<{
  available: boolean;
  participantStatus: CallCircleParticipantStatus | null;
}> {
  const [activeAccess, membership, participant] = await Promise.all([
    readActiveHostedMemberAccess({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    input.prisma.hostedGroupMember.findUnique({
      select: { id: true },
      where: {
        groupId_memberId: {
          groupId: input.groupId,
          memberId: input.memberId,
        },
      },
    }),
    input.prisma.hostedCallCircleParticipant.findUnique({
      select: { status: true },
      where: {
        groupId_memberId: {
          groupId: input.groupId,
          memberId: input.memberId,
        },
      },
    }),
  ]);
  return {
    available: activeAccess && membership !== null,
    participantStatus: participant?.status ?? null,
  };
}

function readActiveCallCircleUnavailableReason(
  participantStatus: CallCircleParticipantStatus | null,
): string | null {
  if (participantStatus === null) return "call_circle_not_enrolled";
  if (participantStatus === "paused") return "call_circle_paused";
  return null;
}

async function appendCounterReaskTx(input: {
  matchId: string;
  now: Date;
  preflight?: CallCircleNotificationPreflightOk;
  side: "A" | "B";
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationSignal | null> {
  const match = await input.tx.hostedCallCircleMatch.findUnique({
    include: {
      memberA: { select: { pendingActivationTimeZone: true } },
      memberB: { select: { pendingActivationTimeZone: true } },
    },
    where: { id: input.matchId },
  });
  if (!match) return null;
  if (!await canUseActiveCallCircleParticipantPair({
    groupId: match.groupId,
    memberAId: match.memberAId,
    memberBId: match.memberBId,
    prisma: input.tx,
  })) {
    await markCallCircleMatchOutcome({
      matchId: match.id,
      now: input.now,
      outcome: "participant_unavailable",
      prisma: input.tx,
      status: "canceled",
    });
    return null;
  }
  const reaskMemberId = input.side === "A" ? match.memberBId : match.memberAId;
  const reaskTimeZone = normalizeCallCircleTimeZone(
    input.side === "A"
      ? match.memberB.pendingActivationTimeZone
      : match.memberA.pendingActivationTimeZone,
  );
  const marked = await markCallCircleMatchAmAsked({
    matchId: match.id,
    now: input.now,
    prisma: input.tx,
  });
  if (!marked) return null;
  const notification = await appendCallCircleConfirmNotificationTx({
    matchId: match.id,
    memberId: reaskMemberId,
    now: input.now,
    otherMemberLabel: null,
    preflight: input.preflight,
    stage: "am",
    tx: input.tx,
    windowLabel: formatCounterWindowLabel({
      startAt: match.windowStartAt,
      timeZone: reaskTimeZone,
    }),
    windowStartAt: match.windowStartAt,
  });
  return readCallCircleNotificationSignal({
    memberId: reaskMemberId,
    notification,
  });
}

function isValidCounterWindow(input: {
  endAt: Date;
  now: Date;
  startAt: Date;
}): boolean {
  return Number.isFinite(input.startAt.getTime())
    && Number.isFinite(input.endAt.getTime())
    && input.startAt > input.now
    && input.endAt > input.startAt
    && input.endAt.getTime() <= input.now.getTime() + CALL_CIRCLE_COUNTER_WINDOW_MAX_MS;
}

function formatCounterWindowLabel(input: {
  startAt: Date;
  timeZone: string;
}): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: input.timeZone,
    weekday: "short",
  }).format(input.startAt);
}
