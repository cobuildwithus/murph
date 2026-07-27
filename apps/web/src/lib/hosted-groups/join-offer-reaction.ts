import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  isHostedLinqAffirmativeReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqChatLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import {
  acceptHostedGroupOfferAffirmation,
  type HostedGroupOfferAffirmationKind,
  type HostedGroupOfferAffirmationSkipReason,
} from "./group-offer-affirmation";
import {
  prepareHostedLinqGroupJoinApplicationClaimTx,
} from "./group-store";
import { assertHostedGroupSharingAuthorityAvailable } from "./sharing-authority-maintenance";
import type {
  HostedLinqGroupJoinApplicationClaim,
} from "../hosted-onboarding/linq-provider-event-store";

type HostedGroupJoinOfferReactionSkipReason =
  | HostedGroupOfferAffirmationSkipReason
  | "member_inactive"
  | "missing_reaction_context"
  | "reaction_removed"
  | "unsupported_reaction";

export type HostedGroupJoinOfferReactionResult =
  | { status: "accepted"; reason: "accepted" }
  | { status: "ignored"; reason: HostedGroupJoinOfferReactionSkipReason };

/**
 * Binds the durable provider receipt to the exact authority visible when the
 * event is first accepted. Returning null records the provider event without a
 * retryable join application.
 */
export async function prepareHostedGroupJoinOfferReactionApplicationClaimTx(input: {
  event: ParsedHostedLinqProviderEvent;
  tx: Prisma.TransactionClient;
}): Promise<HostedLinqGroupJoinApplicationClaim | null> {
  if (
    input.event.eventType !== "reaction.added"
    || input.event.reactionIsFromMe === true
    || !isHostedLinqAffirmativeReaction({
      customEmoji: input.event.reactionCustomEmoji,
      eventType: input.event.eventType,
      reactionType: input.event.reactionType,
    })
    || !input.event.linqChatId
    || !input.event.messageLookupKey
    || !input.event.payloadHash
    || !input.event.reactionFromHandle
  ) {
    return null;
  }

  const member = await resolveHostedGroupJoinOfferReactionMember({
    handle: input.event.reactionFromHandle,
    prisma: input.tx,
  });
  if (
    !member
    || member.suspendedAt
    || !(await readActiveHostedMemberAccess({ memberId: member.id, prisma: input.tx }))
  ) {
    return null;
  }

  const claim = await prepareHostedLinqGroupJoinApplicationClaimTx({
    memberId: member.id,
    messageLookupKeyReadCandidates: normalizeLookupKeyCandidates(
      input.event.messageLookupKeyReadCandidates.length > 0
        ? input.event.messageLookupKeyReadCandidates
        : [input.event.messageLookupKey],
    ),
    threadIdentityLookupKeyReadCandidates:
      createHostedExternalThreadIdentityLookupKeyReadCandidates({
        channel: "linq",
        threadId: input.event.linqChatId,
    }),
    tx: input.tx,
  });
  if (claim) {
    // This hook runs inside provider-event persistence. Throwing here rolls
    // back the pending:v2 receipt, so no current-bundle retry authority can be
    // admitted while a prior-bundle permission writer is still draining.
    assertHostedGroupSharingAuthorityAvailable();
  }
  return claim;
}

export async function handleHostedGroupJoinOfferReaction(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedGroupJoinOfferReactionResult> {
  if (input.event.eventType === "reaction.removed") {
    return skipHostedGroupJoinOfferReaction({
      reason: "reaction_removed",
    });
  }
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
    !isHostedLinqAffirmativeReaction({
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
    || !input.event.payloadHash
    || !input.event.reactionFromHandle
  ) {
    return skipHostedGroupJoinOfferReaction({
      reason: "missing_reaction_context",
    });
  }

  const member = await resolveHostedGroupJoinOfferReactionMember({
    handle: input.event.reactionFromHandle,
    prisma: input.prisma,
  });
  if (!member) {
    return skipHostedGroupJoinOfferReaction({
      reason: "not_a_member",
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

  const messageLookupKeyReadCandidates = normalizeLookupKeyCandidates(
    input.event.messageLookupKeyReadCandidates.length > 0
      ? input.event.messageLookupKeyReadCandidates
      : [input.event.messageLookupKey],
  );
  const result = await acceptHostedGroupOfferAffirmation({
    affirmationEventId: input.event.eventId,
    channel: "linq",
    kinds,
    linqApplicationContext: {
      linqChatLookupKeyReadCandidates:
        createHostedLinqChatLookupKeyReadCandidates(input.event.linqChatId),
      payloadHash: input.event.payloadHash,
    },
    memberId: member.id,
    messageLookupKeyReadCandidates,
    now: input.event.providerCreatedAt,
    prisma: input.prisma,
    ...(input.signal ? { signal: input.signal } : {}),
    threadIdentityLookupKeyReadCandidates:
      createHostedExternalThreadIdentityLookupKeyReadCandidates({
        channel: "linq",
        threadId: input.event.linqChatId,
      }),
  });
  return result.status === "accepted"
    ? { status: "accepted", reason: "accepted" }
    : skipHostedGroupJoinOfferReaction({ reason: result.reason });
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
  prisma: PrismaClient | Prisma.TransactionClient;
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
