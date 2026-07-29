import type {
  Prisma,
} from "@prisma/client";

import {
  bindArmedHostedUsageReferralToNewContainerTx,
} from "../hosted-growth/usage-referral";
import {
  ensureHostedLinqThreadContainerRouteFromParticipantAddTx,
} from "../hosted-routing/thread-container-service";
import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import { isHostedMemberSuspended } from "./entitlement";
import { isHostedOnboardingError } from "./errors";
import {
  lookupHostedMemberIdentityByPhoneNumber,
} from "./hosted-member-identity-store";
import {
  lookupHostedMemberByVerifiedEmailAddress,
} from "./hosted-member-store";
import {
  type HostedLinqParticipantChangedEvent,
  shouldIgnoreHostedLinqForLocalInboundGuard,
} from "./linq";
import {
  hasActiveHostedLinqManagedLine,
} from "./linq-line-store";
import {
  createHostedLinqParticipantContact,
} from "./linq-participant-contact";
import {
  readHostedRuntimeAiAccessDecision,
} from "./member-access";
import { normalizePhoneNumber } from "./phone";

export const HOSTED_LINQ_GROUP_OWNER_FROM_ADDER_REQUIRED_ENV =
  "HOSTED_LINQ_GROUP_OWNER_FROM_ADDER_REQUIRED";

type HostedLinqParticipantAddedEvent = Extract<
  HostedLinqParticipantChangedEvent,
  { event_type: "participant.added" }
>;

type HostedLinqParticipantAddedOwnerEvidence = {
  accountLookupKey: string;
  accountLookupKeys: string[];
  actorHandle: NonNullable<
    HostedLinqParticipantAddedEvent["data"]["added_by_handle"]
  >;
  chatId: string;
  occurredAt: string;
};

export interface HostedLinqParticipantAddedOwnerResult {
  managedSelfAdd: boolean;
}

export function isHostedLinqGroupOwnerFromAdderRequired(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return source[HOSTED_LINQ_GROUP_OWNER_FROM_ADDER_REQUIRED_ENV] === "1";
}

/**
 * Selects the only participant shape that can enter route provisioning. This
 * is derived entirely from immutable signed event data so mutable line state
 * cannot promote a chat-first transaction into the route-first path.
 */
export function shouldUseHostedLinqParticipantAddedOwnerLockOrder(
  event: HostedLinqParticipantChangedEvent,
): boolean {
  return readHostedLinqParticipantAddedOwnerEvidence(event) !== null;
}

/**
 * Consumes only the normalized, signature-authenticated participant event.
 * The caller has inserted the unique provider-event ledger row. Managed-line
 * additions intentionally reach this function before the caller takes the
 * chat lock so route provisioning retains its established route-then-chat lock
 * order; the caller takes the chat lock before staging participant context.
 */
export async function provisionHostedLinqParticipantAddedOwnerTx(input: {
  event: HostedLinqParticipantChangedEvent;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqParticipantAddedOwnerResult> {
  const managedSelfAdd = readHostedLinqManagedSelfAdd(input.event);
  if (!managedSelfAdd) {
    return { managedSelfAdd: false };
  }

  if (
    !(await hasActiveHostedLinqManagedLine({
      phoneNumberLookupKeys: managedSelfAdd.accountLookupKeys,
      prisma: input.prisma,
    }))
  ) {
    return {
      managedSelfAdd:
        input.event.event_type === "participant.added"
        && input.event.data.participant.is_me === true,
    };
  }

  const evidence = readHostedLinqParticipantAddedOwnerEvidence(
    input.event,
    managedSelfAdd,
  );
  if (!evidence) {
    return { managedSelfAdd: true };
  }

  const actorContact = createHostedLinqParticipantContact({
    kind: "phone",
    value: evidence.actorHandle.handle,
  }) ?? createHostedLinqParticipantContact({
    kind: "email",
    value: evidence.actorHandle.handle,
  });
  if (!actorContact) {
    return { managedSelfAdd: true };
  }
  if (
    shouldIgnoreHostedLinqForLocalInboundGuard({
      isFromMe: false,
      participantContact: actorContact,
    })
  ) {
    return { managedSelfAdd: true };
  }

  const actorLookup = actorContact.kind === "phone"
    ? await lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber: actorContact.value,
        prisma: input.prisma,
      })
    : await lookupHostedMemberByVerifiedEmailAddress({
        address: actorContact.value,
        prisma: input.prisma,
      });
  const actor = actorLookup?.core ?? null;
  if (!actor) {
    return { managedSelfAdd: true };
  }
  if (
    isHostedMemberSuspended(actor.suspendedAt)
    || !(await readHostedRuntimeAiAccessDecision({
      memberId: actor.id,
      prisma: input.prisma,
    })).allowed
  ) {
    return { managedSelfAdd: true };
  }

  try {
    const occurredAt = new Date(evidence.occurredAt);
    const ensured =
      await ensureHostedLinqThreadContainerRouteFromParticipantAddTx({
        accountLookupKey: evidence.accountLookupKey,
        accountLookupKeys: evidence.accountLookupKeys,
        mailboxDedupeKey: input.event.event_id,
        occurredAt,
        ownerMemberId: actor.id,
        prisma: input.prisma,
        threadId: evidence.chatId,
      });
    await bindArmedHostedUsageReferralToNewContainerTx({
      occurredAt,
      ownerMemberId: actor.id,
      targetContainerMemberId: ensured.containerMemberId,
      tx: input.prisma,
    });
  } catch (error) {
    if (!isHostedOnboardingError(error)) {
      throw error;
    }
    if (
      error.code === "HOSTED_THREAD_ROUTE_ALREADY_BOUND"
      || error.code === "HOSTED_THREAD_CONTAINER_OWNER_ACTIVE_ACCESS_REQUIRED"
      || error.code === "HOSTED_THREAD_CONTAINER_OWNER_MUST_NOT_BE_CONTAINER"
    ) {
      return { managedSelfAdd: true };
    }
    throw error;
  }
  return { managedSelfAdd: true };
}

function readHostedLinqParticipantAddedOwnerEvidence(
  event: HostedLinqParticipantChangedEvent,
  managedSelfAdd = readHostedLinqManagedSelfAdd(event),
): HostedLinqParticipantAddedOwnerEvidence | null {
  if (!managedSelfAdd || event.event_type !== "participant.added") {
    return null;
  }

  const actorHandle = event.data.added_by_handle;
  if (
    !actorHandle
    || actorHandle.is_me === true
    || normalizePhoneNumber(actorHandle.handle) === managedSelfAdd.linePhoneNumber
  ) {
    return null;
  }

  return {
    accountLookupKey: managedSelfAdd.accountLookupKey,
    accountLookupKeys: managedSelfAdd.accountLookupKeys,
    actorHandle,
    chatId: managedSelfAdd.chatId,
    occurredAt: event.data.added_at ?? event.created_at,
  };
}

function readHostedLinqManagedSelfAdd(
  event: HostedLinqParticipantChangedEvent,
): Omit<HostedLinqParticipantAddedOwnerEvidence, "actorHandle" | "occurredAt">
  & { linePhoneNumber: string } | null {
  if (event.event_type !== "participant.added") {
    return null;
  }

  const chatId = event.data.chat_id;
  const linePhoneNumber = normalizePhoneNumber(event.data.participant.handle);
  if (
    event.data.participant.is_me === false
    || !chatId
    || !linePhoneNumber
  ) {
    return null;
  }

  const accountLookupKey = createHostedPhoneLookupKey(linePhoneNumber);
  const accountLookupKeys = createHostedPhoneLookupKeyReadCandidates(
    linePhoneNumber,
  );
  return accountLookupKey && accountLookupKeys.length > 0
    ? {
        accountLookupKey,
        accountLookupKeys,
        chatId,
        linePhoneNumber,
      }
    : null;
}
