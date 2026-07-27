import "server-only";

import type { PrismaClient } from "@prisma/client";

import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  isHostedLinqAffirmativeReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import {
  acceptHostedGroupOfferAffirmation,
  type HostedGroupOfferAffirmationKind,
  type HostedGroupOfferAffirmationSkipReason,
} from "./group-offer-affirmation";
import {
  enqueueHostedGroupJoinOutreachTx,
  revokeHostedGroupJoinOutreachForRemovedReactionTx,
} from "./group-join-outreach-store";
import { readHostedGroupJoinOfferTargetTx } from "./group-store";
import { isHostedGroupJoinOutreachSupportedRegion } from "./group-join-outreach-window";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";

type HostedGroupJoinOfferReactionSkipReason =
  | HostedGroupOfferAffirmationSkipReason
  | "member_inactive"
  | "missing_reaction_context"
  | "non_phone_handle"
  | "recipient_region_unsupported"
  | "reaction_removed"
  | "unsupported_reaction";

export type HostedGroupJoinOfferReactionResult =
  | {
      status: "accepted";
      reason: "accepted" | "outreach_enqueued" | "outreach_revoked";
    }
  | { status: "ignored"; reason: HostedGroupJoinOfferReactionSkipReason };

export async function handleHostedGroupJoinOfferReaction(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedGroupJoinOfferReactionResult> {
  if (input.event.reactionIsFromMe === true) {
    return skipHostedGroupJoinOfferReaction({
      reason: "unsupported_reaction",
    });
  }
  // A bare like is ambiguous on Linq: the same gesture accepts a join offer or
  // a disclosure request, so it may satisfy either card. Every other
  // affirmative reaction only ever accepts a join offer.
  const kinds: HostedGroupOfferAffirmationKind[] =
    isExactHostedGroupDisclosureLikeReaction(input.event)
      ? ["disclosure", "join"]
      : ["join"];
  if (
    input.event.eventType !== "reaction.removed"
    && !isHostedLinqAffirmativeReaction({
      customEmoji: input.event.reactionCustomEmoji,
      eventType: input.event.eventType,
      reactionType: input.event.reactionType,
    })
  ) {
    return skipHostedGroupJoinOfferReaction({
      reason: "unsupported_reaction",
    });
  }
  if (
    !input.event.linqChatId
    || !input.event.linqMessageId
    || !input.event.messageLookupKey
    || !input.event.reactionFromHandle
  ) {
    return skipHostedGroupJoinOfferReaction({
      reason: "missing_reaction_context",
    });
  }

  const messageLookupKeyReadCandidates = normalizeLookupKeyCandidates(
    input.event.messageLookupKeyReadCandidates.length > 0
      ? input.event.messageLookupKeyReadCandidates
      : [input.event.messageLookupKey],
  );
  const threadIdentityLookupKeyReadCandidates =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.event.linqChatId,
    });

  const member = await resolveHostedGroupJoinOfferReactionMember({
    handle: input.event.reactionFromHandle,
    prisma: input.prisma,
  });

  if (input.event.eventType === "reaction.removed") {
    // Only the pre-member outreach this adapter owns is revocable. A member's
    // removal keeps its previous no-op behavior: their grants are additive and
    // dropping a tapback does not undo them.
    const participantPhoneNumber = member
      ? null
      : readHostedGroupJoinOfferReactionParticipantPhone(
          input.event.reactionFromHandle,
        );
    if (!participantPhoneNumber) {
      return skipHostedGroupJoinOfferReaction({ reason: "reaction_removed" });
    }

    const regionSupportedForRemoval = isHostedGroupJoinOutreachSupportedRegion(
      participantPhoneNumber,
    );
    try {
      const revoked = await input.prisma.$transaction(async (tx) => {
        const offer = await readHostedGroupJoinOfferTargetTx({
          channel: "linq",
          messageLookupKeyReadCandidates,
          threadIdentityLookupKeyReadCandidates,
          tx,
        });
        return revokeHostedGroupJoinOutreachForRemovedReactionTx({
          allowMissingRowTombstone: regionSupportedForRemoval,
          now: input.event.providerCreatedAt,
          offerId: offer.offerId,
          participantPhoneNumber,
          tx,
        });
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
      if (revoked.kind === "revoked") {
        return { status: "accepted", reason: "outreach_revoked" };
      }
      // This owner decided a canonical-offer reaction from a refused region, so
      // the disposition has to be consumable. Reporting a plain
      // `reaction_removed` would let the webhook fall through and stage this
      // participant's phone into group-owned reaction context, which is exactly
      // the group-visible disclosure the feature avoids.
      return skipHostedGroupJoinOfferReaction({
        reason: regionSupportedForRemoval
          ? "reaction_removed"
          : "recipient_region_unsupported",
      });
    } catch (error) {
      if (!readHostedGroupJoinOfferTargetSkipReason(error)) {
        throw error;
      }
      return skipHostedGroupJoinOfferReaction({ reason: "reaction_removed" });
    }
  }

  if (!member) {
    // Someone who does not use Murph yet: record durable intent to text them
    // privately instead of dropping the reaction.
    const participantPhoneNumber = readHostedGroupJoinOfferReactionParticipantPhone(
      input.event.reactionFromHandle,
    );
    if (!participantPhoneNumber) {
      return skipHostedGroupJoinOfferReaction({ reason: "non_phone_handle" });
    }
    let regionSupported = true;
    try {
      await input.prisma.$transaction(async (tx) => {
        // Prove the reaction targeted the canonical join offer before deciding
        // anything: a reaction to an unrelated message must not be consumed just
        // because this reactor's region is unsupported.
        const offer = await readHostedGroupJoinOfferTargetTx({
          channel: "linq",
          messageLookupKeyReadCandidates,
          threadIdentityLookupKeyReadCandidates,
          tx,
        });
        // A region with no derivable safe window can never be sent, so no durable
        // intent is recorded for it.
        regionSupported = isHostedGroupJoinOutreachSupportedRegion(
          participantPhoneNumber,
        );
        if (!regionSupported) {
          return;
        }
        await enqueueHostedGroupJoinOutreachTx({
          offerId: offer.offerId,
          participantPhoneNumber,
          requestedAt: input.event.providerCreatedAt,
          tx,
        });
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    } catch (error) {
      const reason = readHostedGroupJoinOfferTargetSkipReason(error);
      if (!reason) {
        throw error;
      }
      return skipHostedGroupJoinOfferReaction({ reason });
    }
    return regionSupported
      ? { status: "accepted", reason: "outreach_enqueued" }
      : skipHostedGroupJoinOfferReaction({
          reason: "recipient_region_unsupported",
        });
  }
  if (
    member.suspendedAt
    || !(await readActiveHostedMemberAccess({ memberId: member.id, prisma: input.prisma }))
  ) {
    return skipHostedGroupJoinOfferReaction({
      reason: "member_inactive",
    });
  }

  const result = await acceptHostedGroupOfferAffirmation({
    affirmationEventId: input.event.eventId,
    channel: "linq",
    kinds,
    memberId: member.id,
    messageLookupKeyReadCandidates,
    now: input.event.providerCreatedAt,
    prisma: input.prisma,
    ...(input.signal ? { signal: input.signal } : {}),
    threadIdentityLookupKeyReadCandidates,
  });
  return result.status === "accepted"
    ? { status: "accepted", reason: "accepted" }
    : skipHostedGroupJoinOfferReaction({ reason: result.reason });
}

function readHostedGroupJoinOfferTargetSkipReason(
  error: unknown,
): HostedGroupOfferAffirmationSkipReason | null {
  if (!isHostedOnboardingError(error)) {
    return null;
  }
  if (error.code === "HOSTED_GROUP_JOIN_OFFER_REVOKED") {
    return "offer_revoked";
  }
  return error.code === "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND"
    || error.code === "HOSTED_GROUP_NOT_ACTIVE"
    || error.code === "HOSTED_GROUP_RUNTIME_UNSUPPORTED"
      ? "no_offer_match"
      : null;
}

function readHostedGroupJoinOfferReactionParticipantPhone(
  handle: string,
): string | null {
  return handle.includes("@") ? null : normalizePhoneNumber(handle);
}

function isExactHostedGroupDisclosureLikeReaction(
  event: ParsedHostedLinqProviderEvent,
): boolean {
  return event.eventType === "reaction.added"
    && event.reactionType === "like"
    && event.reactionCustomEmoji === null;
}

function normalizeLookupKeyCandidates(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0))];
}

async function resolveHostedGroupJoinOfferReactionMember(input: {
  handle: string;
  prisma: PrismaClient;
}): Promise<{ id: string; suspendedAt: Date | null } | null> {
  const emailAddress = input.handle.includes("@") ? input.handle : null;
  const lookup = emailAddress
    ? await lookupHostedMemberByVerifiedEmailAddress({
        address: emailAddress,
        prisma: input.prisma,
      })
    : await lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber: normalizePhoneNumber(input.handle) ?? "",
        prisma: input.prisma,
      });
  const member = lookup?.core ?? null;
  if (!member) {
    return null;
  }
  return { id: member.id, suspendedAt: member.suspendedAt };
}

function skipHostedGroupJoinOfferReaction(input: {
  reason: HostedGroupJoinOfferReactionSkipReason;
}): HostedGroupJoinOfferReactionResult {
  return { status: "ignored", reason: input.reason };
}
