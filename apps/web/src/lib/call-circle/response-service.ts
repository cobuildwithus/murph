import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedCallCirclePreferencesPatch,
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
  markCallCircleMatchOutcome,
} from "./match-store";
import {
  readCallCircleConfirmNotificationAnchor,
  readCallCircleSetupNotificationGroupId,
  type CallCircleConfirmNotificationAnchor,
} from "./notifications";
import {
  canUseActiveCallCircleParticipantPair,
  pauseCallCircleParticipant,
  readCallCircleMatchParticipantTimeZones,
  refreshCallCircleParticipantMemberNameKey,
  resumeCallCircleParticipant,
  writeCallCirclePreferences,
} from "./participant-store";
import {
  CALL_CIRCLE_MINIMUM_WINDOW_MS,
  canScheduleCallCircleConfirmationFlow,
  hasCallCircleBridgeWindowElapsed,
  readCallCircleFinalAskAt,
} from "./time";
import {
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import { getPrisma } from "../prisma";

const CALL_CIRCLE_COUNTER_WINDOW_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const CALL_CIRCLE_REPLY_CONTEXT_MAILBOX_ITEM_LIMIT = 20;

export async function handleCallCircleRespond(input: {
  context?: HostedCallCircleRespondContext | null;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  request: HostedCallCircleRespondRequest;
}): Promise<HostedCallCircleRespondResponse> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  return await prisma.$transaction<HostedCallCircleRespondResponse>(async (tx) => {
    const replyItems = await readCallCircleReplyContextItems({
      memberId: input.memberId,
      prisma: tx,
      replyContext: input.context ?? null,
    });
    const target = await resolveCallCircleResponseTarget({
      memberId: input.memberId,
      now,
      prisma: tx,
      replyItems,
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
    if (authority.participantStatus !== null) {
      await refreshCallCircleParticipantMemberNameKey({
        groupId: target.groupId,
        memberId: input.memberId,
        prisma: tx,
        selfMemberName: input.context?.selfMemberName,
      });
    }

    switch (input.request.kind) {
      case "preferences": {
        if (authority.participantStatus === null) {
          return { status: "unavailable", unavailableReason: "call_circle_not_enrolled" };
        }
        const writeResult = await writeCallCirclePreferences({
          groupId: target.groupId,
          memberId: input.memberId,
          now,
          patch: readCallCirclePreferencesPatch(input.request),
          prisma: tx,
        });
        if (writeResult === "invalid_member_cadences") {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_member_cadences_invalid",
          };
        }
        if (writeResult === "incomplete") {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_preferences_incomplete",
          };
        }
        if (writeResult === "missing") return { status: "ignored" };
        return { status: "ok" };
      }
      case "pause": {
        if (authority.participantStatus === null) {
          return { status: "unavailable", unavailableReason: "call_circle_not_enrolled" };
        }
        await pauseCallCircleParticipant({
          groupId: target.groupId,
          memberId: input.memberId,
          now,
          prisma: tx,
        });
        await cancelOpenCallCircleMatchesForParticipant({
          groupId: target.groupId,
          memberId: input.memberId,
          prisma: tx,
        });
        return { status: "ok" };
      }
      case "resume": {
        if (authority.participantStatus === null) {
          return { status: "unavailable", unavailableReason: "call_circle_not_enrolled" };
        }
        if (authority.participantStatus === "enrolled") return { status: "ok" };
        const changed = await resumeCallCircleParticipant({
          groupId: target.groupId,
          memberId: input.memberId,
          now,
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
          tx,
        })) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        if (
          target.match.status === "both_confirmed"
          || readCallCircleMatchSideResponse(target.match) === "confirmed"
        ) {
          return { status: "ok" };
        }
        const changed = await confirmCallCircleMatchSide({
          expectedAsk: readCallCircleAskSnapshot(target.match),
          groupId: target.groupId,
          matchId: target.match.id,
          memberAId: target.match.memberAId,
          memberBId: target.match.memberBId,
          memberId: input.memberId,
          now,
          prisma: tx,
          side: target.match.side,
        });
        return { status: changed ? "ok" : "ignored" };
      }
      case "decline": {
        const unavailable = readActiveCallCircleUnavailableReason(authority.participantStatus);
        if (unavailable) return { status: "unavailable", unavailableReason: unavailable };
        if (!target.match) return { status: "ignored" };
        if (hasAppliedCallCircleDecline(target.match)) return { status: "ok" };
        if (target.match.expired) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        if (!await ensureActiveCallCircleMatchPair({
          match: target.match,
          tx,
        })) {
          return {
            status: "unavailable",
            unavailableReason: "call_circle_match_unavailable",
          };
        }
        const changed = await declineCallCircleMatchSide({
          expectedAsk: readCallCircleAskSnapshot(target.match),
          groupId: target.groupId,
          matchId: target.match.id,
          memberAId: target.match.memberAId,
          memberBId: target.match.memberBId,
          memberId: input.memberId,
          now,
          prisma: tx,
          side: target.match.side,
        });
        return { status: changed ? "ok" : "ignored" };
      }
      case "counter": {
        const unavailable = readActiveCallCircleUnavailableReason(authority.participantStatus);
        if (unavailable) return { status: "unavailable", unavailableReason: unavailable };
        if (!target.match) {
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
        const timeZones = await readCallCircleMatchParticipantTimeZones({
          groupId: target.match.groupId,
          memberAId: target.match.memberAId,
          memberBId: target.match.memberBId,
          prisma: tx,
        });
        if (!timeZones) {
          return { status: "unavailable", unavailableReason: "counter_window_invalid" };
        }
        if (!canScheduleCallCircleConfirmationFlow({
          memberATimeZone: timeZones.memberATimeZone,
          memberBTimeZone: timeZones.memberBTimeZone,
          now,
          windowStartAt: counterWindow.startAt,
        })) {
          return { status: "unavailable", unavailableReason: "counter_window_invalid" };
        }
        const changed = await counterCallCircleMatchSide({
          expectedAsk: readCallCircleAskSnapshot(target.match),
          groupId: target.groupId,
          matchId: target.match.id,
          memberAId: target.match.memberAId,
          memberBId: target.match.memberBId,
          memberId: input.memberId,
          now,
          prisma: tx,
          side: target.match.side,
          windowEndAt: counterWindow.endAt,
          windowStartAt: counterWindow.startAt,
        });
        if (!changed) return { status: "ignored" };
        return { status: "ok" };
      }
    }
  });
}

function readCallCirclePreferencesPatch(
  request: Extract<HostedCallCircleRespondRequest, { kind: "preferences" }>,
): HostedCallCirclePreferencesPatch {
  const { kind, ...patch } = request;
  if (kind !== "preferences") {
    throw new Error("Expected a Call Circle preference request.");
  }
  return patch;
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

type ResolvedCallCircleResponseMatch = CurrentCallCircleResponseMatch & {
  expired: boolean;
};

async function resolveCallCircleResponseTarget(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  replyItems: readonly CallCircleReplyContextItem[];
  request: HostedCallCircleRespondRequest;
}): Promise<ResolvedCallCircleResponseTarget> {
  const isMatchResponse = isCallCircleMatchResponseKind(input.request.kind);
  const setupContext = isMatchResponse
    ? { status: "none" as const }
    : resolveCallCircleSetupGroupIdFromReplyContext({
        memberId: input.memberId,
        replyItems: input.replyItems,
      });
  const confirmContext = await resolveCurrentCallCircleMatchContext({
    memberId: input.memberId,
    prisma: input.prisma,
    replyItems: input.replyItems,
  });
  if (
    setupContext.status === "ambiguous"
    || confirmContext.status === "ambiguous"
  ) {
    return {
      status: "unavailable",
      unavailableReason: isMatchResponse
        ? "call_circle_match_unavailable"
        : "call_circle_context_unavailable",
    };
  }
  if (isMatchResponse) {
    if (confirmContext.status === "exact") {
      const match = resolveCallCircleResponseMatch({
        match: confirmContext.match,
        now: input.now,
      });
      return { groupId: match.groupId, match, status: "ok" };
    }
    return {
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    };
  }

  const anchoredGroupIds = new Set<string>();
  if (setupContext.status === "exact") {
    anchoredGroupIds.add(setupContext.groupId);
  }
  if (confirmContext.status === "exact") {
    anchoredGroupIds.add(confirmContext.match.groupId);
  }
  if (anchoredGroupIds.size > 1) {
    return {
      status: "unavailable",
      unavailableReason: "call_circle_context_unavailable",
    };
  }
  const [anchoredGroupId] = anchoredGroupIds;
  if (anchoredGroupId) {
    return { groupId: anchoredGroupId, match: null, status: "ok" };
  }

  const groupId = await resolveSingleCallCircleParticipantGroupId({
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

type CallCircleGroupContextResolution =
  | { status: "none" }
  | { status: "ambiguous" }
  | { groupId: string; status: "exact" };

type CallCircleConfirmAnchorResolution =
  | { status: "none" }
  | { status: "ambiguous" }
  | { anchor: CallCircleConfirmNotificationAnchor; status: "exact" };

type CallCircleMatchContextResolution =
  | { status: "none" }
  | { status: "ambiguous" }
  | { match: CurrentCallCircleResponseMatch; status: "exact" };

type CurrentCallCircleResponseMatch = Prisma.HostedCallCircleMatchGetPayload<{
  select: typeof callCircleResponseMatchSelect;
}> & { side: "A" | "B" };

type CallCircleAskSnapshot = Pick<
  CurrentCallCircleResponseMatch,
  "amAskedAt" | "finalAskedAt" | "windowEndAt" | "windowStartAt"
>;

type CallCircleReplyContextItem = Prisma.HostedMailboxItemGetPayload<{
  select: typeof callCircleReplyContextItemSelect;
}>;

function resolveCallCircleSetupGroupIdFromReplyContext(input: {
  memberId: string;
  replyItems: readonly CallCircleReplyContextItem[];
}): CallCircleGroupContextResolution {
  const groupIds: string[] = [];
  for (const item of input.replyItems) {
    if (item.kind !== "assistant.notification.requested") continue;
    const groupId = readCallCircleSetupNotificationGroupId({
      eventId: item.dedupeKey,
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

async function readCallCircleReplyContextItems(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyContext: HostedCallCircleRespondContext | null;
}): Promise<CallCircleReplyContextItem[]> {
  const mailboxItemIds = normalizeReplyContextMailboxItemIds(
    input.replyContext?.inboundMailboxItemIds,
  );
  if (mailboxItemIds.length === 0) return [];
  return await input.prisma.hostedMailboxItem.findMany({
    select: callCircleReplyContextItemSelect,
    take: CALL_CIRCLE_REPLY_CONTEXT_MAILBOX_ITEM_LIMIT,
    where: {
      id: { in: mailboxItemIds },
      userId: input.memberId,
    },
  });
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
    where: {
      group: {
        members: { some: { memberId: input.memberId } },
      },
      memberId: input.memberId,
    },
  });
  return participants.length === 1 ? participants[0]?.groupId ?? null : null;
}

async function resolveCurrentCallCircleMatchContext(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyItems: readonly CallCircleReplyContextItem[];
}): Promise<CallCircleMatchContextResolution> {
  const confirmContext = resolveCallCircleConfirmMatchIdFromReplyContext({
    memberId: input.memberId,
    replyItems: input.replyItems,
  });
  if (confirmContext.status !== "exact") return confirmContext;

  const match = await input.prisma.hostedCallCircleMatch.findUnique({
    select: callCircleResponseMatchSelect,
    where: { id: confirmContext.anchor.matchId },
  });
  if (!match) return { status: "none" };
  const side = match.memberAId === input.memberId
    ? "A"
    : match.memberBId === input.memberId
      ? "B"
      : null;
  if (!side) return { status: "none" };
  if (!isCallCircleConfirmAnchorCurrentForMatch({
    anchor: confirmContext.anchor,
    match,
  })) {
    return { status: "none" };
  }
  if (
    match.status !== "both_confirmed"
    && match.amAskedAt === null
    && match.finalAskedAt === null
  ) {
    return { status: "none" };
  }
  const askAt = readCurrentCallCircleMatchAskAt(match);
  if (!askAt || !hasFreshCallCircleReplyContext({
    askAt,
    replyItems: input.replyItems,
  })) {
    return { status: "none" };
  }
  return {
    match: { ...match, side },
    status: "exact",
  };
}

function resolveCallCircleResponseMatch(input: {
  match: CurrentCallCircleResponseMatch;
  now: Date;
}): ResolvedCallCircleResponseMatch {
  return {
    ...input.match,
    expired: hasCallCircleResponseWindowExpired({
      match: input.match,
      now: input.now,
    }),
  };
}

function hasCallCircleResponseWindowExpired(input: {
  match: {
    finalAskedAt: Date | null;
    windowEndAt: Date;
    windowStartAt: Date;
  };
  now: Date;
}): boolean {
  if (input.match.finalAskedAt) {
    return hasCallCircleBridgeWindowElapsed({
      now: input.now,
      windowEndAt: input.match.windowEndAt,
      windowStartAt: input.match.windowStartAt,
    });
  }
  return input.now >= readCallCircleFinalAskAt(input.match.windowStartAt);
}

function resolveCallCircleConfirmMatchIdFromReplyContext(input: {
  memberId: string;
  replyItems: readonly CallCircleReplyContextItem[];
}): CallCircleConfirmAnchorResolution {
  const anchors: CallCircleConfirmNotificationAnchor[] = [];
  for (const item of input.replyItems) {
    if (item.kind !== "assistant.notification.requested") continue;
    const anchor = readCallCircleConfirmNotificationAnchor({
      eventId: item.dedupeKey,
      memberId: input.memberId,
    });
    if (anchor && !anchors.some((entry) => entry.key === anchor.key)) {
      anchors.push(anchor);
    }
  }
  if (anchors.length === 0) return { status: "none" };
  return anchors.length === 1
    ? { anchor: anchors[0]!, status: "exact" }
    : { status: "ambiguous" };
}

function isCallCircleConfirmAnchorCurrentForMatch(input: {
  anchor: CallCircleConfirmNotificationAnchor;
  match: {
    amAskedAt: Date | null;
    finalAskedAt: Date | null;
    windowStartAt: Date;
  };
}): boolean {
  const currentStage = input.match.finalAskedAt ? "final" : "am";
  return input.anchor.stage === currentStage
    && input.anchor.windowStartAt.getTime() === input.match.windowStartAt.getTime();
}

const callCircleResponseMatchSelect = {
  amAskedAt: true,
  finalAskedAt: true,
  groupId: true,
  id: true,
  memberAId: true,
  memberBId: true,
  outcome: true,
  sideAResponse: true,
  sideBResponse: true,
  status: true,
  windowEndAt: true,
  windowStartAt: true,
} satisfies Prisma.HostedCallCircleMatchSelect;

const callCircleReplyContextItemSelect = {
  dedupeKey: true,
  kind: true,
  occurredAt: true,
} satisfies Prisma.HostedMailboxItemSelect;

function hasFreshCallCircleReplyContext(input: {
  askAt: Date;
  replyItems: readonly CallCircleReplyContextItem[];
}): boolean {
  const replyOccurredAt = readLatestCallCircleReplyOccurredAt(input.replyItems);
  return replyOccurredAt !== null
    && replyOccurredAt.getTime() >= input.askAt.getTime();
}

function readLatestCallCircleReplyOccurredAt(
  replyItems: readonly CallCircleReplyContextItem[],
): Date | null {
  let latest: Date | null = null;
  for (const item of replyItems) {
    if (item.kind === "conversation.message" && (!latest || item.occurredAt > latest)) {
      latest = item.occurredAt;
    }
  }
  return latest;
}

function readCurrentCallCircleMatchAskAt(input: Pick<
  ResolvedCallCircleResponseMatch,
  "amAskedAt" | "finalAskedAt"
>): Date | null {
  return input.finalAskedAt ?? input.amAskedAt;
}

function readCallCircleAskSnapshot(
  match: CallCircleAskSnapshot,
): CallCircleAskSnapshot {
  return {
    amAskedAt: match.amAskedAt,
    finalAskedAt: match.finalAskedAt,
    windowEndAt: match.windowEndAt,
    windowStartAt: match.windowStartAt,
  };
}

function isCallCircleMatchResponseKind(
  kind: HostedCallCircleRespondRequest["kind"],
): boolean {
  return kind === "confirm" || kind === "counter" || kind === "decline";
}

function readCallCircleMatchSideResponse(
  match: Pick<ResolvedCallCircleResponseMatch, "side" | "sideAResponse" | "sideBResponse">,
): string {
  return match.side === "A" ? match.sideAResponse : match.sideBResponse;
}

function hasAppliedCallCircleDecline(
  match: Pick<
    ResolvedCallCircleResponseMatch,
    "outcome" | "side" | "sideAResponse" | "sideBResponse" | "status"
  >,
): boolean {
  return match.status === "dropped"
    && readCallCircleMatchSideResponse(match) === "declined"
    && match.outcome === (match.side === "A" ? "declined_by_a" : "declined_by_b");
}

async function ensureActiveCallCircleMatchPair(input: {
  match: Pick<ResolvedCallCircleResponseMatch, "groupId" | "id" | "memberAId" | "memberBId">;
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

function isValidCounterWindow(input: {
  endAt: Date;
  now: Date;
  startAt: Date;
}): boolean {
  return Number.isFinite(input.startAt.getTime())
    && Number.isFinite(input.endAt.getTime())
    && input.startAt > input.now
    && input.endAt.getTime() - input.startAt.getTime()
      >= CALL_CIRCLE_MINIMUM_WINDOW_MS
    && input.endAt.getTime() <= input.now.getTime() + CALL_CIRCLE_COUNTER_WINDOW_MAX_MS;
}
