import "server-only";

import type { Prisma } from "@prisma/client";
import {
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS,
} from "@murphai/hosted-execution/contracts";

import {
  readHostedOwnerAddressBookAdvisoryNames,
} from "../hosted-address-book/projection";
import {
  lookupHostedGroupParticipantMemberByHandle,
} from "../hosted-groups/participant-member";
import {
  appendHostedLinqThreadRouteParticipantContextTx,
  type HostedThreadRouteSnapshot,
} from "../hosted-routing/thread-route-store";
import { readActiveHostedMemberAccess } from "./member-access";
import {
  hasHostedMemberActivationProof,
} from "./member-activation";
import type {
  HostedLinqParticipantChangedEvent,
} from "./linq";
import {
  createHostedLinqParticipantContact,
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";

export async function stageHostedLinqGroupParticipantContextTx(input: {
  event: HostedLinqParticipantChangedEvent;
  prisma: Prisma.TransactionClient;
  route: HostedThreadRouteSnapshot;
}): Promise<boolean> {
  const chatId = input.event.data.chat_id;
  const participant = createHostedLinqParticipantContact({
    kind: input.event.data.participant.handle.includes("@") ? "email" : "phone",
    value: input.event.data.participant.handle,
  });
  if (
    !chatId
    || !participant
    || input.event.data.participant.is_me === true
    || input.route.channel !== "linq"
  ) {
    return false;
  }

  try {
    if (!(await readActiveHostedMemberAccess({
      memberId: input.route.containerMemberId,
      prisma: input.prisma,
    }))) {
      return false;
    }

    const ownerAdvisoryName = await readParticipantOwnerAdvisoryName({
      containerMemberId: input.route.containerMemberId,
      participant,
      prisma: input.prisma,
    });
    const append = await appendHostedLinqThreadRouteParticipantContextTx({
      containerMemberId: input.route.containerMemberId,
      excludedAccountLookupKeys:
        createHostedLinqParticipantContactLookupKeyReadCandidates(participant),
      prisma: input.prisma,
      text: buildHostedLinqGroupParticipantContextText({
        eventType: input.event.event_type,
        ownerAdvisoryName,
        participantHandle: participant.value,
      }),
      threadId: chatId,
    });
    return append === "appended";
  } catch {
    // This is optional, lossy context. The provider-event ledger and the
    // addition fallback bit remain authoritative when identity, crypto, or
    // address-book lookup is unavailable.
    return false;
  }
}

async function readParticipantOwnerAdvisoryName(input: {
  containerMemberId: string;
  participant: HostedLinqParticipantContact;
  prisma: Prisma.TransactionClient;
}): Promise<string | null> {
  if (input.participant.kind !== "phone") {
    return null;
  }

  try {
    const lookup = await lookupHostedGroupParticipantMemberByHandle({
      handle: input.participant.value,
      prisma: input.prisma,
    });
    if (
      lookup
      && await hasHostedMemberActivationProof({
        memberId: lookup.core.id,
        prisma: input.prisma,
      })
    ) {
      return null;
    }
  } catch {
    // Unknown activation state cannot authorize the owner-contact overlay.
    return null;
  }

  try {
    const result = await readHostedOwnerAddressBookAdvisoryNames({
      containerMemberId: input.containerMemberId,
      phoneHandles: [input.participant.value],
      prisma: input.prisma,
    });
    return result.names.get(input.participant.value) ?? null;
  } catch {
    return null;
  }
}

function buildHostedLinqGroupParticipantContextText(input: {
  eventType: HostedLinqParticipantChangedEvent["event_type"];
  ownerAdvisoryName: string | null;
  participantHandle: string;
}): string {
  const label = input.ownerAdvisoryName
    ? ` (unverified owner contact label: ${input.ownerAdvisoryName})`
    : "";
  const action = input.eventType === "participant.added"
    ? "was added to"
    : "was removed from";
  const text = `Participant ${input.participantHandle}${label} ${action} the group.`;
  if (text.length <= HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS) {
    return text;
  }
  return `${text.slice(
    0,
    HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS - 12,
  ).trimEnd()} [truncated]`;
}
