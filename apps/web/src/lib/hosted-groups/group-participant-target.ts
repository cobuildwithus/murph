import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
  type HostedRuntimeGroupAskResult,
  type HostedRuntimeGroupParticipantTarget,
  type HostedRuntimeGroupParticipantTargetCue,
} from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_ADDRESS_BOOK_MAX_CONTACTS,
  readHostedMemberAddressBookAdvisoryNames,
} from "../hosted-address-book/projection";
import {
  getHostedLinqChatSummary,
  type HostedLinqChatHandleSummary,
} from "../hosted-onboarding/linq-client";
import {
  createHostedLinqParticipantContact,
  type HostedLinqParticipantContact,
} from "../hosted-onboarding/linq-participant-contact";
import {
  readHostedRuntimeAiAllowedMemberIds,
} from "../hosted-onboarding/member-access";
import {
  readHostedThreadContainerLinqRouteAuthorities,
} from "../hosted-routing/assistant-notification-destination";
import {
  lookupHostedGroupParticipantMemberIdsByHandles,
} from "./participant-member";
import {
  normalizeHostedPersistedGroupTargetSelector,
  sanitizeHostedGroupTargetDisplayLabel,
} from "./group-target-description";

const HOSTED_GROUP_PARTICIPANT_PROVIDER_DEADLINE_MS = 5_000;
const HOSTED_GROUP_PARTICIPANT_PROVIDER_CONCURRENCY = 4;
/**
 * Complete live-provider scan budget. This is independent of the smaller
 * model-response group-list budget and always fails closed instead of
 * truncating the requester's eligible membership set.
 */
const HOSTED_GROUP_PARTICIPANT_TARGET_MEMBERSHIPS_MAX = 100;
const HOSTED_GROUP_PARTICIPANT_TARGET_DIGEST_NAMESPACE =
  "murph.group-participant-target.v1";
const EMAIL_ADDRESS_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u;
const PHONE_ADDRESS_PATTERN = /(?:^|\D)\+?\d[\d\s().-]{6,}\d(?:\D|$)/u;

interface HostedGroupParticipantMembership {
  group: {
    displayName: string | null;
    runtimeMemberId: string | null;
  };
  id: string;
}

interface HostedGroupParticipant {
  contact: HostedLinqParticipantContact;
  displayName: string | null;
}

interface HostedGroupParticipantCandidate {
  membership: HostedGroupParticipantMembership;
  participants: readonly HostedGroupParticipant[];
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
}

export type HostedGroupParticipantTargetSelection =
  | {
      participantTargetDigest: string;
      result: HostedRuntimeGroupAskResult;
      status: "result";
    }
  | {
      membershipId: string;
      participantTargetDigest: string;
      routeAuthority: HostedExecutionExternalThreadRouteAuthority;
      status: "selected";
      targetLabel: string;
      targetRuntimeMemberId: string;
    };

export function createHostedGroupParticipantTargetDigest(
  target: HostedRuntimeGroupParticipantTarget,
): string {
  const participants = (target.participants ?? [])
    .map((cue) => ({
      ...(cue.displayName === undefined
        ? {}
        : { displayName: normalizeParticipantName(cue.displayName) }),
      ...(cue.emailParticipant === true ? { emailParticipant: true } : {}),
      ...(cue.phoneHint === undefined
        ? {}
        : {
            phoneHint: {
              ...(cue.phoneHint.areaCode === undefined
                ? {}
                : { areaCode: cue.phoneHint.areaCode }),
              ...(cue.phoneHint.lastFour === undefined
                ? {}
                : { lastFour: cue.phoneHint.lastFour }),
            },
          }),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256")
    .update(HOSTED_GROUP_PARTICIPANT_TARGET_DIGEST_NAMESPACE)
    .update("\0")
    .update(JSON.stringify({
      ...(target.participantCount === undefined
        ? {}
        : { participantCount: target.participantCount }),
      ...(participants.length === 0 ? {} : { participants }),
    }))
    .digest("hex");
}

export async function selectHostedGroupByParticipants(input: {
  memberId: string;
  now: Date;
  participantTarget: HostedRuntimeGroupParticipantTarget;
  prisma: PrismaClient;
  requestedLabel: string | null;
}): Promise<HostedGroupParticipantTargetSelection> {
  const participantTargetDigest = createHostedGroupParticipantTargetDigest(
    input.participantTarget,
  );
  const memberships = await readParticipantTargetMemberships({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (memberships.length === 0) {
    return selectionResult(participantTargetDigest, { status: "no_groups" });
  }
  if (
    memberships.length
    > HOSTED_GROUP_PARTICIPANT_TARGET_MEMBERSHIPS_MAX
  ) {
    return selectionUnavailable(participantTargetDigest, "too_many_groups");
  }

  const runtimeMemberIds = memberships.flatMap(({ group }) =>
    group.runtimeMemberId ? [group.runtimeMemberId] : []
  );
  const allowedRuntimeMemberIds = await readHostedRuntimeAiAllowedMemberIds({
    memberIds: runtimeMemberIds,
    now: input.now,
    prisma: input.prisma,
  });
  const activeMemberships = memberships.filter(({ group }) =>
    group.runtimeMemberId !== null
    && allowedRuntimeMemberIds.has(group.runtimeMemberId)
  );
  if (activeMemberships.length === 0) {
    return selectionUnavailable(participantTargetDigest, "membership_unavailable");
  }

  const providerSignal = AbortSignal.timeout(
    HOSTED_GROUP_PARTICIPANT_PROVIDER_DEADLINE_MS,
  );
  const routes = await readHostedThreadContainerLinqRouteAuthorities({
    containerMemberIds: activeMemberships.flatMap(({ group }) =>
      group.runtimeMemberId ? [group.runtimeMemberId] : []
    ),
    prisma: input.prisma,
    signal: providerSignal,
  });
  const linqMemberships = activeMemberships.filter(({ group }) =>
    group.runtimeMemberId !== null
    && !routes.nonLinqContainerMemberIds.has(group.runtimeMemberId)
  );
  if (
    linqMemberships.some(({ group }) =>
      group.runtimeMemberId === null
      || routes.unavailableContainerMemberIds.has(group.runtimeMemberId)
      || !routes.authorities.has(group.runtimeMemberId)
    )
  ) {
    return selectionUnavailable(
      participantTargetDigest,
      "participant_evidence_unavailable",
    );
  }
  if (linqMemberships.length === 0) {
    return selectionUnavailable(participantTargetDigest, "group_route_unavailable");
  }

  const candidates = await readParticipantCandidates({
    memberId: input.memberId,
    memberships: linqMemberships,
    prisma: input.prisma,
    routes: routes.authorities,
    signal: providerSignal,
  });
  if (!candidates) {
    return selectionUnavailable(
      participantTargetDigest,
      "participant_evidence_unavailable",
    );
  }

  const matches = candidates.filter((candidate) =>
    (input.requestedLabel === null
      || normalizeHostedPersistedGroupTargetSelector(
        candidate.membership.group.displayName,
      ) === input.requestedLabel)
    && participantTargetMatches({
      participants: candidate.participants,
      target: input.participantTarget,
    })
  );
  if (matches.length === 1) {
    const selected = matches[0]!;
    const targetRuntimeMemberId = selected.membership.group.runtimeMemberId;
    if (!targetRuntimeMemberId) {
      return selectionUnavailable(participantTargetDigest, "membership_unavailable");
    }
    return {
      membershipId: selected.membership.id,
      participantTargetDigest,
      routeAuthority: selected.routeAuthority,
      status: "selected",
      targetLabel: describeParticipantCandidate(selected),
      targetRuntimeMemberId,
    };
  }

  const clarificationCandidates = matches.length > 1 ? matches : candidates;
  const labels = readUniqueCandidateDescriptions(clarificationCandidates);
  return labels.length > 0 && labels.length <= HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX
    ? selectionResult(participantTargetDigest, {
        groupLabels: labels,
        status: "clarification_required",
      })
    : selectionUnavailable(
        participantTargetDigest,
        matches.length > 1
          ? "ambiguous_participant_target"
          : "participant_target_unavailable",
      );
}

async function readParticipantTargetMemberships(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<HostedGroupParticipantMembership[]> {
  return input.prisma.hostedGroupMember.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      group: { select: { displayName: true, runtimeMemberId: true } },
      id: true,
    },
    take: HOSTED_GROUP_PARTICIPANT_TARGET_MEMBERSHIPS_MAX + 1,
    where: { memberId: input.memberId },
  });
}

async function readParticipantCandidates(input: {
  memberId: string;
  memberships: readonly HostedGroupParticipantMembership[];
  prisma: PrismaClient;
  routes: ReadonlyMap<string, HostedExecutionExternalThreadRouteAuthority>;
  signal: AbortSignal;
}): Promise<HostedGroupParticipantCandidate[] | null> {
  const summaries = new Map<string, Awaited<ReturnType<typeof getHostedLinqChatSummary>>>();
  let nextIndex = 0;
  let providerFailed = false;
  const workers = Array.from(
    {
      length: Math.min(
        HOSTED_GROUP_PARTICIPANT_PROVIDER_CONCURRENCY,
        input.memberships.length,
      ),
    },
    async () => {
      while (nextIndex < input.memberships.length) {
        const membership = input.memberships[nextIndex++];
        const runtimeMemberId = membership?.group.runtimeMemberId;
        const route = runtimeMemberId ? input.routes.get(runtimeMemberId) : null;
        if (!membership || !runtimeMemberId || !route || input.signal.aborted) {
          providerFailed = true;
          continue;
        }
        try {
          summaries.set(runtimeMemberId, await getHostedLinqChatSummary({
            chatId: route.threadId,
            signal: input.signal,
          }));
        } catch {
          providerFailed = true;
        }
      }
    },
  );
  await Promise.all(workers);
  if (providerFailed || summaries.size !== input.memberships.length) {
    return null;
  }

  const contactsByRuntimeMemberId = new Map<
    string,
    HostedLinqParticipantContact[]
  >();
  const allHandles: string[] = [];
  for (const membership of input.memberships) {
    const runtimeMemberId = membership.group.runtimeMemberId;
    const summary = runtimeMemberId ? summaries.get(runtimeMemberId) : null;
    if (!runtimeMemberId || !summary || !isCompleteGroupSummary(summary)) {
      return null;
    }
    const contacts = summary.handles
      .filter(isActiveNonProviderHandle)
      .map((handle) => createHostedLinqParticipantContact({
        kind: handle.handle.includes("@") ? "email" : "phone",
        value: handle.handle,
      }));
    if (contacts.some((contact) => contact === null)) {
      return null;
    }
    const completeContacts = contacts.filter(
      (contact): contact is HostedLinqParticipantContact => contact !== null,
    );
    contactsByRuntimeMemberId.set(runtimeMemberId, completeContacts);
    allHandles.push(...completeContacts.map(({ value }) => value));
  }

  const memberIdsByHandle = await lookupHostedGroupParticipantMemberIdsByHandles({
    handles: allHandles,
    prisma: input.prisma,
  });
  const participantContactsByRuntimeMemberId = new Map<
    string,
    HostedLinqParticipantContact[]
  >();
  for (const membership of input.memberships) {
    const runtimeMemberId = membership.group.runtimeMemberId!;
    const contacts = contactsByRuntimeMemberId.get(runtimeMemberId) ?? [];
    if (!contacts.some(({ value }) => memberIdsByHandle.get(value) === input.memberId)) {
      return null;
    }
    const participants = contacts.filter(
      ({ value }) => memberIdsByHandle.get(value) !== input.memberId,
    );
    if (
      participants.length === 0
      || participants.length > HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX
    ) {
      return null;
    }
    participantContactsByRuntimeMemberId.set(runtimeMemberId, participants);
  }

  const phoneHandles = [...new Set(
    [...participantContactsByRuntimeMemberId.values()]
      .flat()
      .filter(({ kind }) => kind === "phone")
      .map(({ value }) => value),
  )];
  if (phoneHandles.length > HOSTED_ADDRESS_BOOK_MAX_CONTACTS) {
    return null;
  }
  const advisoryNames = await readHostedMemberAddressBookAdvisoryNames({
    maxHandles: HOSTED_ADDRESS_BOOK_MAX_CONTACTS,
    memberId: input.memberId,
    phoneHandles,
    prisma: input.prisma,
  });

  return input.memberships.map((membership) => {
    const runtimeMemberId = membership.group.runtimeMemberId!;
    return {
      membership,
      participants: (participantContactsByRuntimeMemberId.get(runtimeMemberId) ?? [])
        .map((contact) => ({
          contact,
          displayName: contact.kind === "phone"
            ? advisoryNames.names.get(contact.value) ?? null
            : null,
        })),
      routeAuthority: input.routes.get(runtimeMemberId)!,
    };
  });
}

function isCompleteGroupSummary(input: {
  handleCount?: number;
  handles: readonly HostedLinqChatHandleSummary[];
  handlesComplete?: boolean;
  isGroup: boolean | null;
}): boolean {
  return input.isGroup === true
    && input.handlesComplete === true
    && input.handleCount === input.handles.length
    && input.handles.length > 0;
}

function isActiveNonProviderHandle(handle: HostedLinqChatHandleSummary): boolean {
  const status = handle.status?.trim().toLocaleLowerCase("und") ?? null;
  return !handle.isMe && (status === null || status === "active");
}

export function participantTargetMatches(input: {
  participants: readonly HostedGroupParticipant[];
  target: HostedRuntimeGroupParticipantTarget;
}): boolean {
  if (
    input.target.participantCount !== undefined
    && input.participants.length !== input.target.participantCount
  ) {
    return false;
  }
  const cues = input.target.participants ?? [];
  if (cues.length > input.participants.length) {
    return false;
  }
  const cueByParticipantIndex = new Map<number, number>();
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
    if (!assignParticipantCue({
      cueByParticipantIndex,
      cueIndex,
      cues,
      participants: input.participants,
      visitedParticipantIndexes: new Set<number>(),
    })) {
      return false;
    }
  }
  return true;
}

function assignParticipantCue(input: {
  cueByParticipantIndex: Map<number, number>;
  cueIndex: number;
  cues: readonly HostedRuntimeGroupParticipantTargetCue[];
  participants: readonly HostedGroupParticipant[];
  visitedParticipantIndexes: Set<number>;
}): boolean {
  const cue = input.cues[input.cueIndex]!;
  for (let index = 0; index < input.participants.length; index += 1) {
    if (
      input.visitedParticipantIndexes.has(index)
      || !participantMatchesCue(input.participants[index]!, cue)
    ) {
      continue;
    }
    input.visitedParticipantIndexes.add(index);
    const assignedCueIndex = input.cueByParticipantIndex.get(index);
    if (
      assignedCueIndex === undefined
      || assignParticipantCue({
        ...input,
        cueIndex: assignedCueIndex,
      })
    ) {
      input.cueByParticipantIndex.set(index, input.cueIndex);
      return true;
    }
  }
  return false;
}

function participantMatchesCue(
  participant: HostedGroupParticipant,
  cue: HostedRuntimeGroupParticipantTargetCue,
): boolean {
  if (cue.emailParticipant === true && participant.contact.kind !== "email") {
    return false;
  }
  if (cue.displayName !== undefined) {
    const aliases = participant.displayName?.split(" / ") ?? [];
    const requestedName = normalizeParticipantName(cue.displayName);
    if (!aliases.some((name) => normalizeParticipantName(name) === requestedName)) {
      return false;
    }
  }
  if (cue.phoneHint !== undefined) {
    if (participant.contact.kind !== "phone") {
      return false;
    }
    const hint = createPhoneHint(participant.contact.value);
    if (
      (cue.phoneHint.areaCode !== undefined
        && cue.phoneHint.areaCode !== hint.areaCode)
      || (cue.phoneHint.lastFour !== undefined
        && cue.phoneHint.lastFour !== hint.lastFour)
    ) {
      return false;
    }
  }
  return true;
}

function normalizeParticipantName(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("und");
}

function describeParticipantCandidate(
  candidate: HostedGroupParticipantCandidate,
): string {
  const safeTitle = readSafePersistedTitle(candidate.membership.group.displayName);
  const participantLabels = candidate.participants.map((participant) => {
    if (participant.displayName) {
      return participant.displayName;
    }
    if (participant.contact.kind === "email") {
      return "email participant";
    }
    const hint = createPhoneHint(participant.contact.value);
    return hint.areaCode
      ? `area code ${hint.areaCode}, ending ${hint.lastFour}`
      : `number ending ${hint.lastFour}`;
  });
  const roster = participantLabels.join(", ");
  const description = safeTitle
    ? `${safeTitle} — ${participantLabels.length} ${pluralizePeople(participantLabels.length)}: ${roster}`
    : `${participantLabels.length} ${pluralizePeople(participantLabels.length)}: ${roster}`;
  return [...description]
    .slice(0, HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS)
    .join("");
}

function readUniqueCandidateDescriptions(
  candidates: readonly HostedGroupParticipantCandidate[],
): string[] {
  const labels = candidates.map(describeParticipantCandidate);
  return new Set(labels).size === labels.length ? labels : [];
}

function readSafePersistedTitle(value: string | null): string | null {
  const title = sanitizeHostedGroupTargetDisplayLabel(value);
  return title
    && !EMAIL_ADDRESS_PATTERN.test(title)
    && !PHONE_ADDRESS_PATTERN.test(title)
    ? title
    : null;
}

function createPhoneHint(phoneNumber: string): {
  areaCode?: string;
  lastFour: string;
} {
  const digits = phoneNumber.replace(/\D/gu, "");
  const lastFour = digits.slice(-4);
  return phoneNumber.startsWith("+1") && digits.length === 11
    ? { areaCode: digits.slice(1, 4), lastFour }
    : { lastFour };
}

function pluralizePeople(count: number): string {
  return count === 1 ? "person" : "people";
}

function selectionResult(
  participantTargetDigest: string,
  result: HostedRuntimeGroupAskResult,
): HostedGroupParticipantTargetSelection {
  return { participantTargetDigest, result, status: "result" };
}

function selectionUnavailable(
  participantTargetDigest: string,
  unavailableReason: string,
): HostedGroupParticipantTargetSelection {
  return selectionResult(participantTargetDigest, {
    status: "unavailable",
    unavailableReason,
  });
}
