import type { HostedCallCirclePreferences } from "@murphai/hosted-execution/call-circle";

import {
  findCallCircleFinalAskableWindow,
  intersectCallCircleWindows,
  listUpcomingCallCircleWindows,
} from "./time";

export interface CallCircleMatcherParticipant {
  lastMatchedAt: Date | null;
  lastPartnerMemberId?: string | null;
  memberId: string;
  preferences: HostedCallCirclePreferences;
  timeZone: string;
}

export interface CallCircleRecentMatch {
  createdAt: Date;
  memberAId: string;
  memberBId: string;
  status: string;
  windowStartAt: Date;
}

export interface CallCircleMatchProposal {
  memberAId: string;
  memberBId: string;
  windowEndAt: Date;
  windowStartAt: Date;
}

const CALL_CIRCLE_MATCH_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export function proposeCallCircleMatches(input: {
  now: Date;
  participants: readonly CallCircleMatcherParticipant[];
  recentMatches: readonly CallCircleRecentMatch[];
}): CallCircleMatchProposal[] {
  const cutoff = input.now.getTime() - CALL_CIRCLE_MATCH_LOOKBACK_MS;
  const eligible = input.participants
    .filter((participant) =>
      participant.preferences.windows.length > 0
      && (participant.lastMatchedAt === null || participant.lastMatchedAt.getTime() < cutoff)
    )
    .slice()
    .sort(compareParticipants);

  const used = new Set<string>();
  const proposals: CallCircleMatchProposal[] = [];

  for (const first of eligible) {
    if (used.has(first.memberId)) continue;
    for (const second of eligible) {
      if (first.memberId === second.memberId || used.has(second.memberId)) continue;
      if (!canMatchParticipants(first, second, input.recentMatches)) continue;
      const intersection = intersectCallCircleWindows({
        first: listUpcomingCallCircleWindows({
          availability: {
            timeZone: first.timeZone,
            windows: first.preferences.windows,
          },
          now: input.now,
        }),
        second: listUpcomingCallCircleWindows({
          availability: {
            timeZone: second.timeZone,
            windows: second.preferences.windows,
          },
          now: input.now,
        }),
      });
      if (!intersection) continue;
      const window = findCallCircleFinalAskableWindow({
        memberATimeZone: first.timeZone,
        memberBTimeZone: second.timeZone,
        now: input.now,
        window: intersection,
      });
      if (!window) continue;
      const [memberAId, memberBId] = sortPair(first.memberId, second.memberId);
      proposals.push({
        memberAId,
        memberBId,
        windowEndAt: window.endAt,
        windowStartAt: window.startAt,
      });
      used.add(first.memberId);
      used.add(second.memberId);
      break;
    }
  }

  return proposals;
}

function canMatchParticipants(
  first: CallCircleMatcherParticipant,
  second: CallCircleMatcherParticipant,
  recentMatches: readonly CallCircleRecentMatch[],
): boolean {
  if (
    first.preferences.excludeMemberIds.includes(second.memberId)
    || second.preferences.excludeMemberIds.includes(first.memberId)
    || first.lastPartnerMemberId === second.memberId
    || second.lastPartnerMemberId === first.memberId
  ) {
    return false;
  }
  return !recentMatches.some((match) => isSamePair(
    first.memberId,
    second.memberId,
    match.memberAId,
    match.memberBId,
  ));
}

function compareParticipants(
  first: CallCircleMatcherParticipant,
  second: CallCircleMatcherParticipant,
): number {
  const firstMatchedAt = first.lastMatchedAt?.getTime() ?? 0;
  const secondMatchedAt = second.lastMatchedAt?.getTime() ?? 0;
  return firstMatchedAt - secondMatchedAt
    || first.memberId.localeCompare(second.memberId);
}

function sortPair(firstMemberId: string, secondMemberId: string): [string, string] {
  return firstMemberId.localeCompare(secondMemberId) <= 0
    ? [firstMemberId, secondMemberId]
    : [secondMemberId, firstMemberId];
}

function isSamePair(
  firstA: string,
  firstB: string,
  secondA: string,
  secondB: string,
): boolean {
  return (firstA === secondA && firstB === secondB)
    || (firstA === secondB && firstB === secondA);
}
