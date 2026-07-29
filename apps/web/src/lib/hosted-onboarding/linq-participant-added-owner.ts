import type {
  Prisma,
  PrismaClient,
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

export function isHostedLinqGroupOwnerFromAdderRequired(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return source[HOSTED_LINQ_GROUP_OWNER_FROM_ADDER_REQUIRED_ENV] === "1";
}

/**
 * Selects the lock-safe participant path without granting authority. The
 * transaction revalidates the managed line before mutating anything.
 */
export async function hasHostedLinqParticipantAddedOwnerCandidate(input: {
  event: HostedLinqParticipantChangedEvent;
  prisma: PrismaClient;
}): Promise<boolean> {
  const evidence = readHostedLinqParticipantAddedOwnerEvidence(input.event);
  return evidence !== null
    && await hasActiveHostedLinqManagedLine({
      phoneNumberLookupKeys: evidence.accountLookupKeys,
      prisma: input.prisma,
    });
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
}): Promise<void> {
  const evidence = readHostedLinqParticipantAddedOwnerEvidence(input.event);
  if (!evidence) {
    return;
  }

  if (
    !(await hasActiveHostedLinqManagedLine({
      phoneNumberLookupKeys: evidence.accountLookupKeys,
      prisma: input.prisma,
    }))
  ) {
    return;
  }

  const actorContact = createHostedLinqParticipantContact({
    kind: "phone",
    value: evidence.actorHandle.handle,
  }) ?? createHostedLinqParticipantContact({
    kind: "email",
    value: evidence.actorHandle.handle,
  });
  if (!actorContact) {
    return;
  }
  if (
    shouldIgnoreHostedLinqForLocalInboundGuard({
      isFromMe: false,
      participantContact: actorContact,
    })
  ) {
    return;
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
    return;
  }
  if (
    isHostedMemberSuspended(actor.suspendedAt)
    || !(await readHostedRuntimeAiAccessDecision({
      memberId: actor.id,
      prisma: input.prisma,
    })).allowed
  ) {
    return;
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
    if (ensured.created || ensured.ownerCorrected) {
      await bindArmedHostedUsageReferralToNewContainerTx({
        occurredAt,
        ownerMemberId: actor.id,
        targetContainerMemberId: ensured.containerMemberId,
        tx: input.prisma,
      });
    }
  } catch (error) {
    if (!isHostedOnboardingError(error)) {
      throw error;
    }
    if (
      error.code === "HOSTED_THREAD_ROUTE_ALREADY_BOUND"
      || error.code === "HOSTED_THREAD_CONTAINER_OWNER_ACTIVE_ACCESS_REQUIRED"
      || error.code === "HOSTED_THREAD_CONTAINER_OWNER_MUST_NOT_BE_CONTAINER"
    ) {
      return;
    }
    throw error;
  }
}

function readHostedLinqParticipantAddedOwnerEvidence(
  event: HostedLinqParticipantChangedEvent,
): HostedLinqParticipantAddedOwnerEvidence | null {
  if (event.event_type !== "participant.added") {
    return null;
  }

  const actorHandle = event.data.added_by_handle;
  const chatId = event.data.chat_id;
  const linePhoneNumber = normalizePhoneNumber(event.data.participant.handle);
  if (
    !actorHandle
    || actorHandle.is_me === true
    || event.data.participant.is_me === false
    || !chatId
    || !linePhoneNumber
    || normalizePhoneNumber(actorHandle.handle) === linePhoneNumber
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
        actorHandle,
        chatId,
        occurredAt: event.data.added_at ?? event.created_at,
      }
    : null;
}
