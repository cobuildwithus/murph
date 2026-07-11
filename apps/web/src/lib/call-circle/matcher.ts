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

interface CallCircleCandidateEdge {
  avoidsLastPartner: boolean;
  firstIndex: number;
  proposal: CallCircleMatchProposal;
  secondIndex: number;
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

  const candidates = buildCandidateEdges({
    eligible,
    history,
    membersWithOpenMatch,
    now: input.now,
    pairHistory,
  });
  return selectMaximumCardinalityEdges(eligible.length, candidates)
    .sort(compareSelectedCandidateEdges)
    .map((candidate) => candidate.proposal);
}

function buildCandidateEdges(input: {
  eligible: readonly PreparedCallCircleParticipant[];
  history: ReadonlyMap<string, CallCircleParticipantHistory>;
  membersWithOpenMatch: ReadonlySet<string>;
  now: Date;
  pairHistory: ReadonlyMap<string, Date>;
}): CallCircleCandidateEdge[] {
  const candidates: CallCircleCandidateEdge[] = [];
  for (let firstIndex = 0; firstIndex < input.eligible.length; firstIndex += 1) {
    const first = input.eligible[firstIndex];
    if (!first) continue;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < input.eligible.length;
      secondIndex += 1
    ) {
      const second = input.eligible[secondIndex];
      if (!second) continue;
      if (!isCallCirclePairCadenceEligible({
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
      candidates.push({
        avoidsLastPartner: !isLastPartnerPair(first, second, input.history),
        firstIndex,
        proposal: {
          memberAId,
          memberBId,
          windowEndAt: window.endAt,
          windowStartAt: window.startAt,
        },
        secondIndex,
      });
    }
  }
  return candidates.sort(compareCandidateEdges);
}

/**
 * Finds a maximum-cardinality matching in the general candidate graph. Among
 * maximum-cardinality solutions, edges that avoid both members' latest partner
 * are considered first, followed by least-recent participant rank and opaque-id
 * order. An edge is selected only when an unweighted Edmonds feasibility check
 * proves that the remaining graph can still complete the maximum pair count.
 */
function selectMaximumCardinalityEdges(
  vertexCount: number,
  candidates: readonly CallCircleCandidateEdge[],
): CallCircleCandidateEdge[] {
  const targetSize = maximumMatchingSize(vertexCount, candidates);
  const selected: CallCircleCandidateEdge[] = [];
  const used = new Set<number>();

  for (const candidate of candidates) {
    if (selected.length === targetSize) break;
    if (used.has(candidate.firstIndex) || used.has(candidate.secondIndex)) continue;
    const excluded = new Set([...used, candidate.firstIndex, candidate.secondIndex]);
    const residual = candidates.filter((edge) =>
      !excluded.has(edge.firstIndex) && !excluded.has(edge.secondIndex)
    );
    const remainingTarget = targetSize - selected.length - 1;
    if (maximumMatchingSize(vertexCount, residual) < remainingTarget) continue;

    selected.push(candidate);
    used.add(candidate.firstIndex);
    used.add(candidate.secondIndex);
  }

  return selected;
}

/** Deterministic O(V^3) Edmonds blossom maximum matching for a general graph. */
function maximumMatchingSize(
  vertexCount: number,
  edges: readonly Pick<CallCircleCandidateEdge, "firstIndex" | "secondIndex">[],
): number {
  const graph = Array.from({ length: vertexCount }, () => [] as number[]);
  for (const edge of edges) {
    graph[edge.firstIndex]?.push(edge.secondIndex);
    graph[edge.secondIndex]?.push(edge.firstIndex);
  }
  for (const neighbors of graph) neighbors.sort((first, second) => first - second);

  const match = Array<number>(vertexCount).fill(-1);
  const parent = Array<number>(vertexCount).fill(-1);
  const base = Array.from({ length: vertexCount }, (_value, index) => index);
  const used = Array<boolean>(vertexCount).fill(false);
  const blossom = Array<boolean>(vertexCount).fill(false);

  const findCommonBase = (firstVertex: number, secondVertex: number): number => {
    const path = Array<boolean>(vertexCount).fill(false);
    let first = firstVertex;
    while (true) {
      first = base[first] ?? first;
      path[first] = true;
      const matched = match[first] ?? -1;
      if (matched === -1) break;
      first = parent[matched] ?? -1;
    }
    let second = secondVertex;
    while (true) {
      second = base[second] ?? second;
      if (path[second]) return second;
      const matched = match[second] ?? -1;
      if (matched === -1) break;
      second = parent[matched] ?? -1;
    }
    throw new Error("Call Circle matching could not find a blossom base.");
  };

  const markBlossomPath = (
    startVertex: number,
    commonBase: number,
    initialChild: number,
  ): void => {
    let vertex = startVertex;
    let child = initialChild;
    while ((base[vertex] ?? vertex) !== commonBase) {
      const matched = match[vertex] ?? -1;
      if (matched < 0) {
        throw new Error("Call Circle matching found an invalid blossom path.");
      }
      blossom[base[vertex] ?? vertex] = true;
      blossom[base[matched] ?? matched] = true;
      parent[vertex] = child;
      child = matched;
      vertex = parent[matched] ?? -1;
      if (vertex < 0) {
        throw new Error("Call Circle matching found an incomplete blossom path.");
      }
    }
  };

  const findAugmentingPath = (root: number): number => {
    used.fill(false);
    parent.fill(-1);
    for (let index = 0; index < vertexCount; index += 1) base[index] = index;
    const queue: number[] = [root];
    used[root] = true;

    for (let head = 0; head < queue.length; head += 1) {
      const vertex = queue[head];
      if (vertex === undefined) continue;
      for (const next of graph[vertex] ?? []) {
        if ((base[vertex] ?? vertex) === (base[next] ?? next) || match[vertex] === next) {
          continue;
        }
        if (
          next === root
          || ((match[next] ?? -1) !== -1 && parent[match[next] ?? -1] !== -1)
        ) {
          const commonBase = findCommonBase(vertex, next);
          blossom.fill(false);
          markBlossomPath(vertex, commonBase, next);
          markBlossomPath(next, commonBase, vertex);
          for (let index = 0; index < vertexCount; index += 1) {
            if (!blossom[base[index] ?? index]) continue;
            base[index] = commonBase;
            if (!used[index]) {
              used[index] = true;
              queue.push(index);
            }
          }
        } else if (parent[next] === -1) {
          parent[next] = vertex;
          const matched = match[next] ?? -1;
          if (matched === -1) return next;
          if (!used[matched]) {
            used[matched] = true;
            queue.push(matched);
          }
        }
      }
    }
    return -1;
  };

  for (let root = 0; root < vertexCount; root += 1) {
    if (match[root] !== -1) continue;
    let vertex = findAugmentingPath(root);
    while (vertex !== -1) {
      const previous = parent[vertex] ?? -1;
      if (previous === -1) break;
      const next = match[previous] ?? -1;
      match[vertex] = previous;
      match[previous] = vertex;
      vertex = next;
    }
  }

  return match.filter((partner) => partner !== -1).length / 2;
}

function isLastPartnerPair(
  first: CallCircleMatcherParticipant,
  second: CallCircleMatcherParticipant,
  history: ReadonlyMap<string, CallCircleParticipantHistory>,
): boolean {
  return history.get(first.memberId)?.partnerMemberId === second.memberId
    || history.get(second.memberId)?.partnerMemberId === first.memberId;
}

function compareCandidateEdges(
  first: CallCircleCandidateEdge,
  second: CallCircleCandidateEdge,
): number {
  return Number(second.avoidsLastPartner) - Number(first.avoidsLastPartner)
    || compareSelectedCandidateEdges(first, second);
}

function compareSelectedCandidateEdges(
  first: CallCircleCandidateEdge,
  second: CallCircleCandidateEdge,
): number {
  return first.firstIndex - second.firstIndex
    || first.secondIndex - second.secondIndex
    || compareIds(first.proposal.memberAId, second.proposal.memberAId)
    || compareIds(first.proposal.memberBId, second.proposal.memberBId);
}

export function proposeCallCircleParticipantPair(input: {
  first: CallCircleMatcherParticipant;
  now: Date;
  recentMatches: readonly CallCircleRecentMatch[];
  second: CallCircleMatcherParticipant;
}): CallCircleMatchProposal | null {
  const history = buildParticipantHistory(input.recentMatches);
  const membersWithOpenMatch = buildMembersWithOpenMatch(input.recentMatches);
  const pairHistory = buildPairHistory(input.recentMatches);
  if (!isCallCirclePairCadenceEligible({
    first: input.first,
    history,
    membersWithOpenMatch,
    now: input.now,
    pairHistory,
    second: input.second,
  })) {
    return null;
  }
  const window = findCallCircleAskableWindow({
    first: listUpcomingCallCircleWindows({
      availability: input.first.preferences,
      now: input.now,
    }),
    memberATimeZone: input.first.preferences.timeZone,
    memberBTimeZone: input.second.preferences.timeZone,
    now: input.now,
    second: listUpcomingCallCircleWindows({
      availability: input.second.preferences,
      now: input.now,
    }),
  });
  if (!window) return null;
  const [memberAId, memberBId] = sortPair(input.first.memberId, input.second.memberId);
  return {
    memberAId,
    memberBId,
    windowEndAt: window.endAt,
    windowStartAt: window.startAt,
  };
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
