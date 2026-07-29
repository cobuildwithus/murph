import type { Prisma } from "@prisma/client";

import {
  bindArmedHostedUsageReferralToNewContainerTx,
} from "../hosted-growth/usage-referral";
import {
  ensureHostedThreadContainerRouteTx,
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
import type {
  HostedLinqParticipantAddedOwnerEvidence,
} from "./linq-provider-events";

export type HostedLinqParticipantAddedOwnerProvisionOutcome =
  | "actor_inactive"
  | "actor_ineligible"
  | "actor_unresolved"
  | "line_unmanaged"
  | "local_inbound_not_allowlisted"
  | "owner_bound"
  | "route_already_bound";

/**
 * Binds a new Linq group route to the human who added Murph when the provider
 * supplies explicit actor evidence. Missing actor evidence is handled by the
 * caller by doing nothing; this function never guesses from roster order or a
 * later speaker.
 */
export async function provisionHostedLinqParticipantAddedOwnerTx(input: {
  chatId: string;
  evidence: HostedLinqParticipantAddedOwnerEvidence;
  eventId: string;
  occurredAt: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqParticipantAddedOwnerProvisionOutcome> {
  const accountLookupKey = createHostedPhoneLookupKey(
    input.evidence.linePhoneNumber,
  );
  const accountLookupKeys = createHostedPhoneLookupKeyReadCandidates(
    input.evidence.linePhoneNumber,
  );
  if (
    !accountLookupKey
    || accountLookupKeys.length === 0
    || !(await hasActiveHostedLinqManagedLine({
      phoneNumberLookupKeys: accountLookupKeys,
      prisma: input.prisma,
    }))
  ) {
    return "line_unmanaged";
  }

  const actorContact = createHostedLinqParticipantContact({
    kind: "phone",
    value: input.evidence.addedByHandle,
  }) ?? createHostedLinqParticipantContact({
    kind: "email",
    value: input.evidence.addedByHandle,
  });
  if (!actorContact) {
    return "actor_unresolved";
  }
  if (
    shouldIgnoreHostedLinqForLocalInboundGuard({
      isFromMe: false,
      participantContact: actorContact,
    })
  ) {
    return "local_inbound_not_allowlisted";
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
    return "actor_unresolved";
  }
  if (
    isHostedMemberSuspended(actor.suspendedAt)
    || !(await readHostedRuntimeAiAccessDecision({
      memberId: actor.id,
      prisma: input.prisma,
    })).allowed
  ) {
    return "actor_inactive";
  }

  try {
    const ensured = await ensureHostedThreadContainerRouteTx({
      accountLookupKey,
      accountLookupKeys,
      channel: "linq",
      mailboxDedupeKey: input.eventId,
      occurredAt: input.occurredAt,
      ownerMemberId: actor.id,
      prisma: input.prisma,
      threadId: input.chatId,
    });
    if (ensured.created) {
      await bindArmedHostedUsageReferralToNewContainerTx({
        occurredAt: input.occurredAt,
        ownerMemberId: actor.id,
        targetContainerMemberId: ensured.containerMemberId,
        tx: input.prisma,
      });
    }
    return "owner_bound";
  } catch (error) {
    if (!isHostedOnboardingError(error)) {
      throw error;
    }
    if (error.code === "HOSTED_THREAD_ROUTE_ALREADY_BOUND") {
      return "route_already_bound";
    }
    if (error.code === "HOSTED_THREAD_CONTAINER_OWNER_ACTIVE_ACCESS_REQUIRED") {
      return "actor_inactive";
    }
    if (error.code === "HOSTED_THREAD_CONTAINER_OWNER_MUST_NOT_BE_CONTAINER") {
      return "actor_ineligible";
    }
    throw error;
  }
}
