import type {
  HostedCallCircleCadence,
  HostedCallCirclePreferences,
} from "@murphai/hosted-execution/call-circle";

import {
  findCallCircleAskableWindow,
  listUpcomingCallCircleWindows,
  readCallCircleCadenceLookbackMs,
} from "./time";

export interface CallCircleMatcherParticipant {
  memberId: string;
  preferences: HostedCallCirclePreferences;
}

export interface CallCircleRecentMatch {
  createdAt: Date;
  memberAId: string;
  memberBId: string;
  open?: boolean;
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
  const history = buildParticipantHistory(input.recentMatches);
  const membersWithOpenMatch = buildMembersWithOpenMatch(input.recentMatches);
  const pairHistory = buildPairHistory(input.recentMatches);
  const eligible = input.participants
    .filter((participant) => participant.preferences.windows.length > 0)
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
    membersWithOpenMatch,
    now: input.now,
    pairHistory,
    proposals,
    used,
  });
  matchParticipants({
    avoidLastPartner: false,
    eligible,
    history,
    membersWithOpenMatch,
    now: input.now,
    pairHistory,
    proposals,
    used,
  });

  return proposals;
}

function matchParticipants(input: {
  avoidLastPartner: boolean;
  eligible: readonly PreparedCallCircleParticipant[];
  history: ReadonlyMap<string, CallCircleParticipantHistory>;
  membersWithOpenMatch: ReadonlySet<string>;
  now: Date;
  pairHistory: ReadonlyMap<string, Date>;
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
        membersWithOpenMatch: input.membersWithOpenMatch,
        now: input.now,
        pairHistory: input.pairHistory,
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
  membersWithOpenMatch: ReadonlySet<string>;
  now: Date;
  pairHistory: ReadonlyMap<string, Date>;
  second: CallCircleMatcherParticipant;
}): boolean {
  const { first, second } = input;
  if (!isCallCirclePairCadenceEligible({
    first,
    history: input.history,
    membersWithOpenMatch: input.membersWithOpenMatch,
    now: input.now,
    pairHistory: input.pairHistory,
    second,
  })) {
    return false;
  }
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

export function canMatchCallCircleParticipantPair(input: {
  first: CallCircleMatcherParticipant;
  now: Date;
  recentMatches: readonly CallCircleRecentMatch[];
  second: CallCircleMatcherParticipant;
}): boolean {
  return isCallCirclePairCadenceEligible({
    first: input.first,
    history: buildParticipantHistory(input.recentMatches),
    membersWithOpenMatch: buildMembersWithOpenMatch(input.recentMatches),
    now: input.now,
    pairHistory: buildPairHistory(input.recentMatches),
    second: input.second,
  });
}

function isCallCirclePairCadenceEligible(input: {
  first: CallCircleMatcherParticipant;
  history: ReadonlyMap<string, CallCircleParticipantHistory>;
  membersWithOpenMatch: ReadonlySet<string>;
  now: Date;
  pairHistory: ReadonlyMap<string, Date>;
  second: CallCircleMatcherParticipant;
}): boolean {
  if (
    input.membersWithOpenMatch.has(input.first.memberId)
    || input.membersWithOpenMatch.has(input.second.memberId)
  ) {
    return false;
  }
  const firstCadence = readMemberCadence(input.first, input.second.memberId);
  const secondCadence = readMemberCadence(input.second, input.first.memberId);
  if (firstCadence === "never" || secondCadence === "never") return false;

  const firstLookbackMs = readCallCircleCadenceLookbackMs(firstCadence);
  const secondLookbackMs = readCallCircleCadenceLookbackMs(secondCadence);
  const nowMs = input.now.getTime();
  if (
    (input.history.get(input.first.memberId)?.matchedAt.getTime() ?? 0)
      > nowMs - firstLookbackMs
    || (input.history.get(input.second.memberId)?.matchedAt.getTime() ?? 0)
      > nowMs - secondLookbackMs
  ) {
    return false;
  }

  const pairMatchedAt = input.pairHistory.get(readPairKey(
    input.first.memberId,
    input.second.memberId,
  ));
  return !pairMatchedAt
    || pairMatchedAt.getTime() <= nowMs - Math.max(firstLookbackMs, secondLookbackMs);
}

function buildMembersWithOpenMatch(
  matches: readonly CallCircleRecentMatch[],
): Set<string> {
  const memberIds = new Set<string>();
  for (const match of matches) {
    if (!match.open) continue;
    memberIds.add(match.memberAId);
    memberIds.add(match.memberBId);
  }
  return memberIds;
}

function readMemberCadence(
  participant: CallCircleMatcherParticipant,
  partnerMemberId: string,
): HostedCallCircleCadence | "never" {
  return participant.preferences.memberCadences.find(
    (entry) => entry.memberId === partnerMemberId,
  )?.cadence ?? participant.preferences.cadence;
}

function compareParticipants(
  first: CallCircleMatcherParticipant,
  second: CallCircleMatcherParticipant,
  history: ReadonlyMap<string, CallCircleParticipantHistory>,
): number {
  const firstMatchedAt = history.get(first.memberId)?.matchedAt.getTime() ?? 0;
  const secondMatchedAt = history.get(second.memberId)?.matchedAt.getTime() ?? 0;
  return firstMatchedAt - secondMatchedAt
    || compareIds(first.memberId, second.memberId);
}

function buildPairHistory(
  matches: readonly CallCircleRecentMatch[],
): Map<string, Date> {
  const history = new Map<string, Date>();
  for (const match of matches) {
    const key = readPairKey(match.memberAId, match.memberBId);
    const current = history.get(key);
    if (!current || current < match.createdAt) history.set(key, match.createdAt);
  }
  return history;
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
  return compareIds(firstMemberId, secondMemberId) <= 0
    ? [firstMemberId, secondMemberId]
    : [secondMemberId, firstMemberId];
}

function readPairKey(firstMemberId: string, secondMemberId: string): string {
  return JSON.stringify(sortPair(firstMemberId, secondMemberId));
}

function compareIds(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}
