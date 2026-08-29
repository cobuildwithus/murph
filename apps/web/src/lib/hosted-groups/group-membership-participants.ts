import "server-only";

import type { PrismaClient } from "@prisma/client";
import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  type HostedRuntimeGroupMembershipAvailability,
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

export interface HostedGroupMembershipInventory {
  availabilityByMembershipId: ReadonlyMap<
    string,
    HostedRuntimeGroupMembershipAvailability
  >;
  participantRosterByMembershipId: ReadonlyMap<
    string,
    HostedRuntimeGroupParticipantRoster
  >;
}

export async function readHostedGroupMembershipInventory(input: {
  memberId: string;
  memberships: readonly HostedGroupMembershipParticipantSource[];
  now: Date;
  prisma: PrismaClient;
}): Promise<HostedGroupMembershipInventory> {
  const availabilityByMembershipId = new Map<
    string,
    HostedRuntimeGroupMembershipAvailability
  >(
    input.memberships.map(({ membershipId }) => [
      membershipId,
      unavailableAvailability("membership_unavailable"),
    ]),
  );
  const participantRosterByMembershipId = new Map<
    string,
    HostedRuntimeGroupParticipantRoster
  >(
    input.memberships.map(({ membershipId }) => [
      membershipId,
      unavailableRoster("membership_unavailable"),
    ]),
  );
  const runtimeMemberIds = input.memberships.flatMap(({ runtimeMemberId }) =>
    runtimeMemberId ? [runtimeMemberId] : []
  );
  if (runtimeMemberIds.length === 0) {
    return { availabilityByMembershipId, participantRosterByMembershipId };
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
    return { availabilityByMembershipId, participantRosterByMembershipId };
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
      availabilityByMembershipId.set(
        membership.membershipId,
        availableAvailability(),
      );
      participantRosterByMembershipId.set(
        membership.membershipId,
        unavailableRoster("participant_roster_not_supported"),
      );
      return false;
    }
    if (
      routes.unavailableContainerMemberIds.has(runtimeMemberId)
      || !routes.authorities.has(runtimeMemberId)
    ) {
      availabilityByMembershipId.set(
        membership.membershipId,
        unavailableAvailability("group_route_unavailable"),
      );
      participantRosterByMembershipId.set(
        membership.membershipId,
        unavailableRoster("group_route_unavailable"),
      );
      return false;
    }
    // The durable exact route is usable unless a current provider roster
    // affirmatively shows that its sending account has departed. A transient
    // roster read must not turn an otherwise authorized group into a false
    // negative.
    availabilityByMembershipId.set(
      membership.membershipId,
      availableAvailability(),
    );
    return true;
  });
  if (readableMemberships.length === 0) {
    return { availabilityByMembershipId, participantRosterByMembershipId };
  }

  const contactsByMembership = await readParticipantContacts({
    availabilityByMembershipId,
    memberships: readableMemberships,
    participantRosterByMembershipId,
    routes: routes.authorities,
    signal: providerSignal,
  });
  if (contactsByMembership.length === 0) {
    return { availabilityByMembershipId, participantRosterByMembershipId };
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
      participantRosterByMembershipId.set(
        membershipId,
        unavailableRoster("participant_identity_unavailable"),
      );
    }
    return { availabilityByMembershipId, participantRosterByMembershipId };
  }

  const participantsByMembership = contactsByMembership.flatMap((entry) => {
    if (
      !entry.contacts.some(({ value }) =>
        memberIdsByHandle.get(value) === input.memberId
      )
    ) {
      participantRosterByMembershipId.set(
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
    participantRosterByMembershipId.set(entry.membershipId, {
      participantCount: entry.contacts.length,
      participantLabels: entry.participants.map((participant) =>
        createParticipantLabel({ advisoryNames, participant })
      ),
      status: "available",
    });
  }
  return { availabilityByMembershipId, participantRosterByMembershipId };
}

export async function isHostedGroupConsultRouteAvailable(input: {
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (input.routeAuthority.channel !== "linq") {
    return true;
  }
  try {
    const summary = await getHostedLinqChatSummary({
      chatId: input.routeAuthority.threadId,
      signal: input.signal ?? AbortSignal.timeout(
        HOSTED_GROUP_PARTICIPANT_PROVIDER_DEADLINE_MS,
      ),
    });
    const availability = readCompleteHostedLinqRouteAvailability({
      ...summary,
      accountLookupKey: input.routeAuthority.accountLookupKey,
    });
    return availability?.status !== "unavailable";
  } catch {
    return true;
  }
}

async function readParticipantContacts(input: {
  availabilityByMembershipId: Map<
    string,
    HostedRuntimeGroupMembershipAvailability
  >;
  memberships: readonly HostedGroupMembershipParticipantSource[];
  participantRosterByMembershipId: Map<
    string,
    HostedRuntimeGroupParticipantRoster
  >;
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
        if (!membership || !runtimeMemberId || !route) {
          if (membership) {
            input.availabilityByMembershipId.set(
              membership.membershipId,
              unavailableAvailability("group_route_unavailable"),
            );
            input.participantRosterByMembershipId.set(
              membership.membershipId,
              unavailableRoster("participant_roster_unavailable"),
            );
          }
          continue;
        }
        if (input.signal.aborted) {
          input.participantRosterByMembershipId.set(
            membership.membershipId,
            unavailableRoster("participant_roster_unavailable"),
          );
          continue;
        }
        try {
          const summary = await getHostedLinqChatSummary({
            chatId: route.threadId,
            signal: input.signal,
          });
          const routeAvailability = readCompleteHostedLinqRouteAvailability({
            ...summary,
            accountLookupKey: route.accountLookupKey,
          });
          if (routeAvailability) {
            input.availabilityByMembershipId.set(
              membership.membershipId,
              routeAvailability,
            );
          }
          const contacts = readCompleteParticipantContacts({
            ...summary,
            accountLookupKey: route.accountLookupKey,
          });
          if (!contacts) {
            input.participantRosterByMembershipId.set(
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
          input.participantRosterByMembershipId.set(
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

function readCompleteHostedLinqRouteAvailability(input: {
  accountLookupKey?: string | null;
  handleCount?: number;
  handles: readonly HostedLinqChatHandleSummary[];
  handlesComplete?: boolean;
  isGroup: boolean | null;
}): HostedRuntimeGroupMembershipAvailability | null {
  if (
    input.isGroup !== true
    || input.handlesComplete !== true
    || input.handleCount !== input.handles.length
  ) {
    return null;
  }
  let routeAccountObserved = false;
  let routeAccountIsActive = false;
  for (const handle of input.handles) {
    if (!isHostedLinqRouteAccountHandle({
      accountLookupKey: input.accountLookupKey,
      handle,
    })) {
      continue;
    }
    routeAccountObserved = true;
    routeAccountIsActive ||= isActiveHandle(handle);
  }
  return routeAccountObserved && !routeAccountIsActive
    ? unavailableAvailability("group_route_unavailable")
    : availableAvailability();
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
    if (isHostedLinqRouteAccountHandle({
      accountLookupKey: input.accountLookupKey,
      handle,
    })) {
      return [];
    }
    const contact = createHostedLinqParticipantContact({
      kind: handle.handle.includes("@") ? "email" : "phone",
      value: handle.handle,
    });
    if (!isActiveHandle(handle)) {
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

function isHostedLinqRouteAccountHandle(input: {
  accountLookupKey?: string | null;
  handle: HostedLinqChatHandleSummary;
}): boolean {
  if (input.handle.isMe) {
    return true;
  }
  if (!input.accountLookupKey) {
    return false;
  }
  const contact = createHostedLinqParticipantContact({
    kind: input.handle.handle.includes("@") ? "email" : "phone",
    value: input.handle.handle,
  });
  return contact !== null
    && createHostedLinqParticipantContactLookupKeyReadCandidates(contact)
      .includes(input.accountLookupKey);
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

function availableAvailability(): HostedRuntimeGroupMembershipAvailability {
  return { status: "available" };
}

function unavailableAvailability(
  unavailableReason: string,
): HostedRuntimeGroupMembershipAvailability {
  return { status: "unavailable", unavailableReason };
}
