import "server-only";

import type { PrismaClient } from "@prisma/client";

import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  isHostedLinqAffirmativeReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import {
  markHostedLinqGroupJoinOfferHandledTx,
} from "../hosted-onboarding/linq-provider-event-store";
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
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "../hosted-onboarding/shared";

type HostedGroupJoinOfferReactionSkipReason =
  | HostedGroupOfferAffirmationSkipReason
  | "already_group_member"
  | "member_inactive"
  | "member_suspended"
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
    // Only reply-gated outreach is revocable. Active members keep the existing
    // no-op behavior because dropping a tapback does not undo an additive grant;
    // an inactive verified phone member retains the same remove-before-add
    // tombstone as someone who has not created a member identity yet.
    const memberCanOwnOutreach = member
      ? member.phoneIdentityVerified
        && !member.suspendedAt
        && !(await readActiveHostedMemberAccess({
          memberId: member.id,
          prisma: input.prisma,
        }))
      : true;
    const participantPhoneNumber = memberCanOwnOutreach
      ? readHostedGroupJoinOfferReactionParticipantPhone(
          input.event.reactionFromHandle,
        )
      : null;
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
        const revoked = await revokeHostedGroupJoinOutreachForRemovedReactionTx({
          allowMissingRowTombstone: regionSupportedForRemoval,
          now: input.event.providerCreatedAt,
          offerId: offer.offerId,
          participantPhoneNumber,
          tx,
        });
        await markHostedLinqGroupJoinOfferHandledTx({
          eventId: input.event.eventId,
          handledAt: input.event.providerCreatedAt,
          prisma: tx,
        });
        return revoked;
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
          await markHostedLinqGroupJoinOfferHandledTx({
            eventId: input.event.eventId,
            handledAt: input.event.providerCreatedAt,
            prisma: tx,
          });
          return;
        }
        await enqueueHostedGroupJoinOutreachTx({
          offerId: offer.offerId,
          participantPhoneNumber,
          requestedAt: input.event.providerCreatedAt,
          tx,
        });
        await markHostedLinqGroupJoinOfferHandledTx({
          eventId: input.event.eventId,
          handledAt: input.event.providerCreatedAt,
          prisma: tx,
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
  const memberHasActiveAccess = member.suspendedAt
    ? false
    : await readActiveHostedMemberAccess({
        memberId: member.id,
        prisma: input.prisma,
      });
  if (
    member.suspendedAt
    || (!memberHasActiveAccess && member.phoneIdentityVerified)
  ) {
    const outreachResult = await resolveHostedGroupJoinOutreachForMemberReaction({
      eventId: input.event.eventId,
      handledAt: input.event.providerCreatedAt,
      memberId: member.id,
      messageLookupKeyReadCandidates,
      participantPhoneNumber:
        readHostedGroupJoinOfferReactionParticipantPhone(
          input.event.reactionFromHandle,
        ),
      prisma: input.prisma,
      requestedAt: input.event.providerCreatedAt,
      threadIdentityLookupKeyReadCandidates,
    });
    if (outreachResult.status !== "active_member") {
      return outreachResult;
    }
  } else if (!memberHasActiveAccess) {
    return skipHostedGroupJoinOfferReaction({ reason: "member_inactive" });
  }

  const result = await acceptHostedGroupOfferAffirmation({
    affirmationEventId: input.event.eventId,
    channel: "linq",
    kinds,
    memberId: member.id,
    messageLookupKeyReadCandidates,
    now: input.event.providerCreatedAt,
    onAcceptedTx: (tx) => markHostedLinqGroupJoinOfferHandledTx({
      eventId: input.event.eventId,
      handledAt: input.event.providerCreatedAt,
      prisma: tx,
    }),
    prisma: input.prisma,
    ...(input.signal ? { signal: input.signal } : {}),
    threadIdentityLookupKeyReadCandidates,
  });
  return result.status === "accepted"
    ? { status: "accepted", reason: "accepted" }
    : skipHostedGroupJoinOfferReaction({ reason: result.reason });
}

type HostedGroupJoinOutreachMemberReactionResult =
  | HostedGroupJoinOfferReactionResult
  | { status: "active_member" };

async function resolveHostedGroupJoinOutreachForMemberReaction(input: {
  eventId: string;
  handledAt: Date;
  memberId: string;
  messageLookupKeyReadCandidates: readonly string[];
  participantPhoneNumber: string | null;
  prisma: PrismaClient;
  requestedAt: Date;
  threadIdentityLookupKeyReadCandidates: readonly string[];
}): Promise<HostedGroupJoinOutreachMemberReactionResult> {
  try {
    return await input.prisma.$transaction(async (tx) => {
      // The canonical offer lock comes first here, matching direct join.
      const offer = await readHostedGroupJoinOfferTargetTx({
        channel: "linq",
        messageLookupKeyReadCandidates: input.messageLookupKeyReadCandidates,
        threadIdentityLookupKeyReadCandidates:
          input.threadIdentityLookupKeyReadCandidates,
        tx,
      });
      await lockHostedMemberRow(tx, input.memberId);
      await lockHostedMemberSponsoredAccessRows(tx, input.memberId);

      const member = await tx.hostedMember.findUnique({
        select: { suspendedAt: true },
        where: { id: input.memberId },
      });
      if (!member) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_MEMBER_IDENTITY_CHANGED",
          httpStatus: 503,
          message:
            "Hosted member identity changed while resolving the reaction.",
          retryable: true,
        });
      }
      if (member.suspendedAt) {
        await markHostedLinqGroupJoinOfferHandledTx({
          eventId: input.eventId,
          handledAt: input.handledAt,
          prisma: tx,
        });
        return skipHostedGroupJoinOfferReaction({ reason: "member_suspended" });
      }
      if (await readActiveHostedMemberAccess({
        memberId: input.memberId,
        prisma: tx,
      })) {
        return { status: "active_member" };
      }

      const membership = await tx.hostedGroupMember.findUnique({
        select: { id: true },
        where: {
          groupId_memberId: {
            groupId: offer.groupId,
            memberId: input.memberId,
          },
        },
      });
      if (membership) {
        await markHostedLinqGroupJoinOfferHandledTx({
          eventId: input.eventId,
          handledAt: input.handledAt,
          prisma: tx,
        });
        return skipHostedGroupJoinOfferReaction({
          reason: "already_group_member",
        });
      }
      if (!input.participantPhoneNumber) {
        return skipHostedGroupJoinOfferReaction({ reason: "member_inactive" });
      }
      if (!isHostedGroupJoinOutreachSupportedRegion(
        input.participantPhoneNumber,
      )) {
        await markHostedLinqGroupJoinOfferHandledTx({
          eventId: input.eventId,
          handledAt: input.handledAt,
          prisma: tx,
        });
        return skipHostedGroupJoinOfferReaction({
          reason: "recipient_region_unsupported",
        });
      }

      await enqueueHostedGroupJoinOutreachTx({
        offerId: offer.offerId,
        participantPhoneNumber: input.participantPhoneNumber,
        requestedAt: input.requestedAt,
        tx,
      });
      await markHostedLinqGroupJoinOfferHandledTx({
        eventId: input.eventId,
        handledAt: input.handledAt,
        prisma: tx,
      });
      return { status: "accepted", reason: "outreach_enqueued" };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    const reason = readHostedGroupJoinOfferTargetSkipReason(error);
    if (!reason) {
      throw error;
    }
    return skipHostedGroupJoinOfferReaction({ reason });
  }
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
}): Promise<{
  id: string;
  phoneIdentityVerified: boolean;
  suspendedAt: Date | null;
} | null> {
  if (input.handle.includes("@")) {
    const lookup = await lookupHostedMemberByVerifiedEmailAddress({
      address: input.handle,
      prisma: input.prisma,
    });
    return lookup
      ? {
          id: lookup.core.id,
          phoneIdentityVerified: false,
          suspendedAt: lookup.core.suspendedAt,
        }
      : null;
  }

  const phoneNumber = normalizePhoneNumber(input.handle);
  if (!phoneNumber) {
    return null;
  }
  const lookup = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber,
    prisma: input.prisma,
  });
  return lookup
    ? {
        id: lookup.core.id,
        phoneIdentityVerified: lookup.identity.phoneNumberVerifiedAt !== null,
        suspendedAt: lookup.core.suspendedAt,
      }
    : null;
}

function skipHostedGroupJoinOfferReaction(input: {
  reason: HostedGroupJoinOfferReactionSkipReason;
}): HostedGroupJoinOfferReactionResult {
  return { status: "ignored", reason: input.reason };
}
