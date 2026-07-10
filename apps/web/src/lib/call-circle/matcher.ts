import type { HostedCallCirclePreferences } from "@murphai/hosted-execution/call-circle";

import {
  CALL_CIRCLE_MATCH_LOOKBACK_MS,
  findCallCircleAskableWindow,
  listUpcomingCallCircleWindows,
} from "./time";

export interface CallCircleMatcherParticipant {
  memberId: string;
  preferences: HostedCallCirclePreferences;
}

export interface CallCircleRecentMatch {
  createdAt: Date;
  memberAId: string;
  memberBId: string;
}

export interface CallCircleMatchProposal {
  memberAId: string;
  memberBId: string;
  windowEndAt: Date;
  windowStartAt: Date;
}

interface PreparedCallCircleParticipant extends CallCircleMatcherParticipant {
  upcomingWindows: ReturnType<typeof listUpcomingCallCircleWindows>;
}

export function proposeCallCircleMatches(input: {
  now: Date;
  participants: readonly CallCircleMatcherParticipant[];
  recentMatches: readonly CallCircleRecentMatch[];
}): CallCircleMatchProposal[] {
  const cutoff = input.now.getTime() - CALL_CIRCLE_MATCH_LOOKBACK_MS;
  const history = buildParticipantHistory(input.recentMatches);
  const eligible = input.participants
    .filter((participant) =>
      participant.preferences.windows.length > 0
      && (history.get(participant.memberId)?.matchedAt.getTime() ?? 0) < cutoff
    )
    .map((participant) => ({
      ...participant,
      upcomingWindows: listUpcomingCallCircleWindows({
        availability: participant.preferences,
        now: input.now,
      }),
    }))
    .sort((first, second) => compareParticipants(first, second, history));

  const used = new Set<string>();
  const proposals: CallCircleMatchProposal[] = [];
  matchParticipants({
    avoidLastPartner: true,
    eligible,
    history,
    now: input.now,
    proposals,
    used,
  });
  matchParticipants({
    avoidLastPartner: false,
    eligible,
    history,
    now: input.now,
    proposals,
    used,
  });

  return proposals;
}

function matchParticipants(input: {
  avoidLastPartner: boolean;
  eligible: readonly PreparedCallCircleParticipant[];
  history: ReadonlyMap<string, CallCircleParticipantHistory>;
  now: Date;
  proposals: CallCircleMatchProposal[];
  used: Set<string>;
}): void {
  for (const first of input.eligible) {
    if (input.used.has(first.memberId)) continue;
    for (const second of input.eligible) {
      if (first.memberId === second.memberId || input.used.has(second.memberId)) continue;
      if (!canMatchParticipants({
        avoidLastPartner: input.avoidLastPartner,
        first,
        history: input.history,
        second,
      })) continue;
      const window = findCallCircleAskableWindow({
        first: first.upcomingWindows,
        memberATimeZone: first.preferences.timeZone,
        memberBTimeZone: second.preferences.timeZone,
        now: input.now,
        second: second.upcomingWindows,
      });
      if (!window) continue;
      const [memberAId, memberBId] = sortPair(first.memberId, second.memberId);
      input.proposals.push({
        memberAId,
        memberBId,
        windowEndAt: window.endAt,
        windowStartAt: window.startAt,
      });
      input.used.add(first.memberId);
      input.used.add(second.memberId);
      break;
    }
  }
}

function canMatchParticipants(input: {
  avoidLastPartner: boolean;
  first: CallCircleMatcherParticipant;
  history: ReadonlyMap<string, CallCircleParticipantHistory>;
  second: CallCircleMatcherParticipant;
}): boolean {
  const { first, second } = input;
  if (
    input.avoidLastPartner
    && (
      input.history.get(first.memberId)?.partnerMemberId === second.memberId
      || input.history.get(second.memberId)?.partnerMemberId === first.memberId
    )
  ) {
    return false;
  }
  return true;
}

function compareParticipants(
  first: CallCircleMatcherParticipant,
  second: CallCircleMatcherParticipant,
  history: ReadonlyMap<string, CallCircleParticipantHistory>,
): number {
  const firstMatchedAt = history.get(first.memberId)?.matchedAt.getTime() ?? 0;
  const secondMatchedAt = history.get(second.memberId)?.matchedAt.getTime() ?? 0;
  return firstMatchedAt - secondMatchedAt
    || first.memberId.localeCompare(second.memberId);
}

interface CallCircleParticipantHistory {
  matchedAt: Date;
  partnerMemberId: string;
}

function buildParticipantHistory(
  matches: readonly CallCircleRecentMatch[],
): Map<string, CallCircleParticipantHistory> {
  const history = new Map<string, CallCircleParticipantHistory>();
  for (const match of matches) {
    recordParticipantHistory(history, {
      matchedAt: match.createdAt,
      memberId: match.memberAId,
      partnerMemberId: match.memberBId,
    });
    recordParticipantHistory(history, {
      matchedAt: match.createdAt,
      memberId: match.memberBId,
      partnerMemberId: match.memberAId,
    });
  }
  return history;
}

function recordParticipantHistory(
  history: Map<string, CallCircleParticipantHistory>,
  entry: CallCircleParticipantHistory & { memberId: string },
): void {
  const current = history.get(entry.memberId);
  if (!current || current.matchedAt < entry.matchedAt) {
    history.set(entry.memberId, {
      matchedAt: entry.matchedAt,
      partnerMemberId: entry.partnerMemberId,
    });
  }
}

function sortPair(firstMemberId: string, secondMemberId: string): [string, string] {
  return firstMemberId.localeCompare(secondMemberId) <= 0
    ? [firstMemberId, secondMemberId]
    : [secondMemberId, firstMemberId];
}
