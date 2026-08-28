import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  type HostedRuntimeGroupParticipantLabel,
  type HostedRuntimeGroupParticipantRoster,
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
  createHostedLinqParticipantContactLookupKeyReadCandidates,
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

const HOSTED_GROUP_PARTICIPANT_PROVIDER_DEADLINE_MS = 5_000;
const HOSTED_GROUP_PARTICIPANT_PROVIDER_CONCURRENCY = 4;

interface HostedGroupMembershipParticipantSource {
  membershipId: string;
  runtimeMemberId: string | null;
}

interface HostedGroupMembershipParticipantContacts {
  contacts: readonly HostedLinqParticipantContact[];
  membershipId: string;
}

export async function readHostedGroupMembershipParticipantRosters(input: {
  memberId: string;
  memberships: readonly HostedGroupMembershipParticipantSource[];
  now: Date;
  prisma: PrismaClient;
}): Promise<ReadonlyMap<string, HostedRuntimeGroupParticipantRoster>> {
  const rosters = new Map<string, HostedRuntimeGroupParticipantRoster>(
    input.memberships.map(({ membershipId }) => [
      membershipId,
      unavailableRoster("membership_unavailable"),
    ]),
  );
  const runtimeMemberIds = input.memberships.flatMap(({ runtimeMemberId }) =>
    runtimeMemberId ? [runtimeMemberId] : []
  );
  if (runtimeMemberIds.length === 0) {
    return rosters;
  }

  const allowedRuntimeMemberIds = await readHostedRuntimeAiAllowedMemberIds({
    memberIds: runtimeMemberIds,
    now: input.now,
    prisma: input.prisma,
  });
  const activeMemberships = input.memberships.filter(({ runtimeMemberId }) =>
    runtimeMemberId !== null && allowedRuntimeMemberIds.has(runtimeMemberId)
  );
  if (activeMemberships.length === 0) {
    return rosters;
  }

  const providerSignal = AbortSignal.timeout(
    HOSTED_GROUP_PARTICIPANT_PROVIDER_DEADLINE_MS,
  );
  const routes = await readHostedThreadContainerLinqRouteAuthorities({
    containerMemberIds: activeMemberships.flatMap(({ runtimeMemberId }) =>
      runtimeMemberId ? [runtimeMemberId] : []
    ),
    prisma: input.prisma,
    signal: providerSignal,
  });
  const readableMemberships = activeMemberships.filter((membership) => {
    const runtimeMemberId = membership.runtimeMemberId;
    if (!runtimeMemberId) {
      return false;
    }
    if (routes.nonLinqContainerMemberIds.has(runtimeMemberId)) {
      rosters.set(
        membership.membershipId,
        unavailableRoster("participant_roster_not_supported"),
      );
      return false;
    }
    if (
      routes.unavailableContainerMemberIds.has(runtimeMemberId)
      || !routes.authorities.has(runtimeMemberId)
    ) {
      rosters.set(
        membership.membershipId,
        unavailableRoster("group_route_unavailable"),
      );
      return false;
    }
    return true;
  });
  if (readableMemberships.length === 0) {
    return rosters;
  }

  const contactsByMembership = await readParticipantContacts({
    memberships: readableMemberships,
    rosters,
    routes: routes.authorities,
    signal: providerSignal,
  });
  if (contactsByMembership.length === 0) {
    return rosters;
  }

  let memberIdsByHandle: ReadonlyMap<string, string | null>;
  try {
    memberIdsByHandle = await lookupHostedGroupParticipantMemberIdsByHandles({
      ambiguityPolicy: "unresolved",
      handles: contactsByMembership.flatMap(({ contacts }) =>
        contacts.map(({ value }) => value)
      ),
      prisma: input.prisma,
    });
  } catch {
    for (const { membershipId } of contactsByMembership) {
      rosters.set(
        membershipId,
        unavailableRoster("participant_identity_unavailable"),
      );
    }
    return rosters;
  }

  const participantsByMembership = contactsByMembership.flatMap((entry) => {
    if (
      !entry.contacts.some(({ value }) =>
        memberIdsByHandle.get(value) === input.memberId
      )
    ) {
      rosters.set(
        entry.membershipId,
        unavailableRoster("requester_not_in_roster"),
      );
      return [];
    }
    return [{
      ...entry,
      participants: entry.contacts.filter(({ value }) =>
        memberIdsByHandle.get(value) !== input.memberId
      ),
    }];
  });

  const phoneHandles = [...new Set(
    participantsByMembership.flatMap(({ participants }) =>
      participants
        .filter(({ kind }) => kind === "phone")
        .map(({ value }) => value)
    ),
  )];
  let advisoryNames: ReadonlyMap<string, string> = new Map();
  if (phoneHandles.length <= HOSTED_ADDRESS_BOOK_MAX_CONTACTS) {
    try {
      advisoryNames = (await readHostedMemberAddressBookAdvisoryNames({
        maxHandles: HOSTED_ADDRESS_BOOK_MAX_CONTACTS,
        memberId: input.memberId,
        phoneHandles,
        prisma: input.prisma,
      })).names;
    } catch {
      // Advisory names are an optional overlay. Masked hints remain truthful.
    }
  }

  for (const entry of participantsByMembership) {
    rosters.set(entry.membershipId, {
      participantCount: entry.contacts.length,
      participantLabels: entry.participants.map((participant) =>
        createParticipantLabel({ advisoryNames, participant })
      ),
      status: "available",
    });
  }
  return rosters;
}

async function readParticipantContacts(input: {
  memberships: readonly HostedGroupMembershipParticipantSource[];
  rosters: Map<string, HostedRuntimeGroupParticipantRoster>;
  routes: ReadonlyMap<string, {
    accountLookupKey?: string | null;
    threadId: string;
  }>;
  signal: AbortSignal;
}): Promise<HostedGroupMembershipParticipantContacts[]> {
  const contactsByMembership = new Map<
    string,
    HostedGroupMembershipParticipantContacts
  >();
  let nextIndex = 0;
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
        const runtimeMemberId = membership?.runtimeMemberId;
        const route = runtimeMemberId ? input.routes.get(runtimeMemberId) : null;
        if (!membership || !runtimeMemberId || !route || input.signal.aborted) {
          if (membership) {
            input.rosters.set(
              membership.membershipId,
              unavailableRoster("participant_roster_unavailable"),
            );
          }
          continue;
        }
        try {
          const summary = await getHostedLinqChatSummary({
            chatId: route.threadId,
            signal: input.signal,
          });
          const contacts = readCompleteParticipantContacts({
            ...summary,
            accountLookupKey: route.accountLookupKey,
          });
          if (!contacts) {
            input.rosters.set(
              membership.membershipId,
              unavailableRoster("participant_roster_unavailable"),
            );
            continue;
          }
          contactsByMembership.set(membership.membershipId, {
            contacts,
            membershipId: membership.membershipId,
          });
        } catch {
          input.rosters.set(
            membership.membershipId,
            unavailableRoster("participant_roster_unavailable"),
          );
        }
      }
    },
  );
  await Promise.all(workers);
  return input.memberships.flatMap(({ membershipId }) => {
    const contacts = contactsByMembership.get(membershipId);
    return contacts ? [contacts] : [];
  });
}

function readCompleteParticipantContacts(input: {
  accountLookupKey?: string | null;
  handleCount?: number;
  handles: readonly HostedLinqChatHandleSummary[];
  handlesComplete?: boolean;
  isGroup: boolean | null;
}): HostedLinqParticipantContact[] | null {
  if (
    input.isGroup !== true
    || input.handlesComplete !== true
    || input.handleCount !== input.handles.length
  ) {
    return null;
  }
  const contacts = input.handles.flatMap((handle) => {
    if (!isActiveHandle(handle) || handle.isMe) {
      return [];
    }
    const contact = createHostedLinqParticipantContact({
      kind: handle.handle.includes("@") ? "email" : "phone",
      value: handle.handle,
    });
    if (
      contact
      && input.accountLookupKey
      && createHostedLinqParticipantContactLookupKeyReadCandidates(contact)
        .includes(input.accountLookupKey)
    ) {
      return [];
    }
    return [contact];
  });
  if (
    contacts.some((contact) => contact === null)
    || contacts.length === 0
    || contacts.length > HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX
  ) {
    return null;
  }
  return contacts.filter(
    (contact): contact is HostedLinqParticipantContact => contact !== null,
  );
}

function isActiveHandle(handle: HostedLinqChatHandleSummary): boolean {
  const status = handle.status?.trim().toLocaleLowerCase("und") ?? null;
  return status === null || status === "active";
}

function createParticipantLabel(input: {
  advisoryNames: ReadonlyMap<string, string>;
  participant: HostedLinqParticipantContact;
}): HostedRuntimeGroupParticipantLabel {
  if (input.participant.kind === "email") {
    return { emailParticipant: true };
  }
  const displayName = input.advisoryNames.get(input.participant.value);
  if (displayName) {
    return { displayName };
  }
  const digits = input.participant.value.replace(/\D/gu, "");
  return {
    phoneHint: {
      ...(input.participant.value.startsWith("+1") && digits.length === 11
        ? { areaCode: digits.slice(1, 4) }
        : {}),
      lastFour: digits.slice(-4),
    },
  };
}

function unavailableRoster(
  unavailableReason: string,
): HostedRuntimeGroupParticipantRoster {
  return { status: "unavailable", unavailableReason };
}
