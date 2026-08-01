import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  isHostedLinqAffirmativeReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import {
  markHostedLinqGroupJoinOfferHandledTx,
} from "../hosted-onboarding/linq-provider-event-store";
import { logHostedOnboardingDiagnostic } from "../hosted-onboarding/logging";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  createHostedLinqParticipantContact,
} from "../hosted-onboarding/linq-participant-contact";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "../hosted-onboarding/bounded-post-commit";
import {
  appendHostedLinqGroupReactionMailboxTx,
  signalHostedLinqGroupReactionMailbox,
  type HostedLinqGroupReactionMailboxAppend,
} from "../hosted-onboarding/webhook-provider-linq-reaction-context";
import {
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
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
      reason:
        | "accepted"
        | "outreach_enqueued"
        | "outreach_revoked"
        | "reaction_recorded";
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
    // Only reply-gated outreach is revocable. Current access controls whether a
    // missing row may become a remove-before-add tombstone, but it must never
    // hide an exact pending row: a later access or suspension transition cannot
    // erase the participant's withdrawal.
    const participantPhoneNumber =
      readHostedGroupJoinOfferReactionParticipantPhone(
        input.event.reactionFromHandle,
      );
    if (!participantPhoneNumber) {
      return skipHostedGroupJoinOfferReaction({ reason: "reaction_removed" });
    }

    const regionSupportedForRemoval = isHostedGroupJoinOutreachSupportedRegion(
      participantPhoneNumber,
    );
    let removalEvidence: {
      actor: string | null;
      expectedContainerMemberId: string;
    } | null = null;
    try {
      // The withdrawal and its terminal provider marker commit together in one
      // small transaction that never performs KMS-backed evidence work: the
      // shared drain fence is held only across fast row operations, so a
      // removal racing dispatch either terminalizes before provider entry or
      // observes the durable opener, and every commit that creates or revokes
      // contact state carries the marker — account deletion can never be
      // followed by replay recreating state a commit had created. Room
      // evidence for the decided removal is appended best-effort after commit;
      // its availability must not gate or roll back the user's withdrawal.
      const revoked = await input.prisma.$transaction(async (tx) => {
        const offer = await readHostedGroupJoinOfferTargetTx({
          channel: "linq",
          messageLookupKeyReadCandidates,
          threadIdentityLookupKeyReadCandidates,
          tx,
        });
        let allowMissingRowTombstone = !member;
        if (member) {
          await lockHostedMemberRow(tx, member.id);
          await lockHostedMemberSponsoredAccessRows(tx, member.id);
          const currentMember = await tx.hostedMember.findUnique({
            select: { suspendedAt: true },
            where: { id: member.id },
          });
          const membership = currentMember
            ? await tx.hostedGroupMember.findUnique({
                select: { id: true },
                where: {
                  groupId_memberId: {
                    groupId: offer.groupId,
                    memberId: member.id,
                  },
                },
              })
            : null;
          allowMissingRowTombstone = Boolean(
            currentMember
              && member.phoneIdentityVerified
              && !currentMember.suspendedAt
              && !membership
              && !(await readActiveHostedMemberAccess({
                memberId: member.id,
                prisma: tx,
              })),
          );
        }
        const revoked = await revokeHostedGroupJoinOutreachForRemovedReactionTx({
          allowMissingRowTombstone:
            regionSupportedForRemoval && allowMissingRowTombstone,
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
        removalEvidence = {
          actor: member ? input.event.reactionFromHandle : null,
          expectedContainerMemberId: offer.runtimeMemberId,
        };
        return revoked;
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
      await appendHostedGroupOfferRemovalEvidenceBestEffort({
        evidence: removalEvidence,
        event: input.event,
        prisma: input.prisma,
      });
      if (revoked.kind === "revoked") {
        return { status: "accepted", reason: "outreach_revoked" };
      }
      if (member || regionSupportedForRemoval) {
        // The canonical owner already retained this removal as durable room
        // evidence. Make that decision terminal so the shared webhook cannot
        // append a second actor-attributed envelope under the same provider
        // event id.
        return { status: "accepted", reason: "reaction_recorded" };
      }
      // This owner decided a canonical-offer reaction from a refused region, so
      // the disposition has to be consumable. Its durable room evidence is
      // anonymous: no pre-member phone enters the group model.
      return skipHostedGroupJoinOfferReaction({
        reason: "recipient_region_unsupported",
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
    // privately instead of dropping the reaction. The same transaction records
    // an anonymous room-evidence row, so the group model retains the reaction
    // without receiving the pre-member phone number.
    const participantPhoneNumber = readHostedGroupJoinOfferReactionParticipantPhone(
      input.event.reactionFromHandle,
    );
    if (!participantPhoneNumber) {
      return skipHostedGroupJoinOfferReaction({ reason: "non_phone_handle" });
    }
    let regionSupported = true;
    let reactionMailboxAppend: HostedLinqGroupReactionMailboxAppend | null = null;
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
        reactionMailboxAppend = await appendHostedGroupOfferReactionRoomEvidenceTx({
          actor: null,
          event: input.event,
          expectedContainerMemberId: offer.runtimeMemberId,
          tx,
        });
        // A region with no derivable safe window can never be sent, so no durable
        // outreach intent is recorded for it. The anonymous reaction evidence
        // remains valid because the exact canonical offer was proven above.
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
    await signalHostedGroupOfferReactionBestEffort({
      append: reactionMailboxAppend,
      prisma: input.prisma,
    });
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
      event: input.event,
      memberId: member.id,
      messageLookupKeyReadCandidates,
      participantPhoneNumber:
        readHostedGroupJoinOfferReactionParticipantPhone(
          input.event.reactionFromHandle,
        ),
      prisma: input.prisma,
      threadIdentityLookupKeyReadCandidates,
    });
    if (outreachResult.status !== "active_member") {
      return outreachResult;
    }
  } else if (!memberHasActiveAccess) {
    return skipHostedGroupJoinOfferReaction({ reason: "member_inactive" });
  }

  let reactionMailboxAppend: HostedLinqGroupReactionMailboxAppend | null = null;
  const result = await acceptHostedGroupOfferAffirmation({
    affirmationEventId: input.event.eventId,
    channel: "linq",
    kinds,
    memberId: member.id,
    messageLookupKeyReadCandidates,
    now: input.event.providerCreatedAt,
    onAcceptedTx: async (tx) => {
      reactionMailboxAppend = await appendHostedGroupOfferReactionRoomEvidenceTx({
        actor: null,
        event: input.event,
        tx,
      });
      await markHostedLinqGroupJoinOfferHandledTx({
        eventId: input.event.eventId,
        handledAt: input.event.providerCreatedAt,
        prisma: tx,
      });
    },
    prisma: input.prisma,
    ...(input.signal ? { signal: input.signal } : {}),
    threadIdentityLookupKeyReadCandidates,
  });
  if (result.status === "accepted") {
    await signalHostedGroupOfferReactionBestEffort({
      append: reactionMailboxAppend,
      prisma: input.prisma,
    });
    return { status: "accepted", reason: "accepted" };
  }
  return skipHostedGroupJoinOfferReaction({ reason: result.reason });
}

async function appendHostedGroupOfferReactionRoomEvidenceTx(input: {
  // Pre-member handles must stay `null` so no pre-member phone enters
  // group-visible room evidence; a member's handle is already group-known and
  // may attribute the retained reaction.
  actor: string | null;
  event: ParsedHostedLinqProviderEvent;
  expectedContainerMemberId?: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedLinqGroupReactionMailboxAppend> {
  // Normalize exactly like the shared webhook staging path: both owners write
  // under one idempotency key per provider event, so the attributed actor must
  // stay byte-identical across whichever owner appends first.
  const actor = input.actor === null
    ? null
    : createHostedLinqParticipantContact({
        kind: input.actor.includes("@") ? "email" : "phone",
        value: input.actor,
      })?.value ?? null;
  const threadId = input.event.linqChatId;
  if (!threadId) {
    throw new TypeError("Hosted group offer reaction thread is missing.");
  }
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.tx,
    threadId,
  });
  if (
    !route
    || (
      input.expectedContainerMemberId
      && route.containerMemberId !== input.expectedContainerMemberId
    )
  ) {
    throw new Error("Hosted group offer reaction route could not be resolved.");
  }
  return appendHostedLinqGroupReactionMailboxTx({
    actor,
    event: input.event,
    route,
    tx: input.tx,
  });
}

/**
 * Retains a decided removal's consumed room evidence after the withdrawal and
 * terminal marker have committed. The KMS-backed append is deliberately not
 * part of that decision: an evidence outage may cost this one removal's room
 * context, but it can never delay, roll back, or replay the withdrawal. The
 * append reuses the event-keyed idempotent envelope, so a duplicate provider
 * delivery retries it harmlessly while the marker keeps the decision terminal.
 */
async function appendHostedGroupOfferRemovalEvidenceBestEffort(input: {
  evidence: { actor: string | null; expectedContainerMemberId: string } | null;
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
}): Promise<void> {
  const evidence = input.evidence;
  if (!evidence) {
    return;
  }
  try {
    const append = await input.prisma.$transaction(
      (tx) => appendHostedGroupOfferReactionRoomEvidenceTx({
        actor: evidence.actor,
        event: input.event,
        expectedContainerMemberId: evidence.expectedContainerMemberId,
        tx,
      }),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    await signalHostedGroupOfferReactionBestEffort({
      append,
      prisma: input.prisma,
    });
  } catch (error) {
    logHostedOnboardingDiagnostic(
      "hosted-onboarding.group-offer-reaction-evidence-failed",
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    );
  }
}

async function signalHostedGroupOfferReactionBestEffort(input: {
  append: HostedLinqGroupReactionMailboxAppend | null;
  prisma: PrismaClient;
}): Promise<void> {
  const append = input.append;
  if (!append) {
    return;
  }
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs: createHostedPostCommitDeadline(undefined),
      operation: (signal) => signalHostedLinqGroupReactionMailbox({
        abortSignal: signal,
        append,
        prisma: input.prisma,
      }),
    });
  } catch (error) {
    // The reaction row committed atomically with the offer decision. A later
    // mailbox-wide wake imports it; do not turn an already-applied join,
    // disclosure grant, or outreach decision into a provider-visible failure.
    logHostedOnboardingDiagnostic(
      "hosted-onboarding.group-offer-reaction-signal-failed",
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    );
  }
}

type HostedGroupJoinOutreachMemberReactionResult =
  | HostedGroupJoinOfferReactionResult
  | { status: "active_member" };

async function resolveHostedGroupJoinOutreachForMemberReaction(input: {
  event: ParsedHostedLinqProviderEvent;
  memberId: string;
  messageLookupKeyReadCandidates: readonly string[];
  participantPhoneNumber: string | null;
  prisma: PrismaClient;
  threadIdentityLookupKeyReadCandidates: readonly string[];
}): Promise<HostedGroupJoinOutreachMemberReactionResult> {
  let reactionMailboxAppend: HostedLinqGroupReactionMailboxAppend | null = null;
  const markHandledTx = (tx: Prisma.TransactionClient) =>
    markHostedLinqGroupJoinOfferHandledTx({
      eventId: input.event.eventId,
      handledAt: input.event.providerCreatedAt,
      prisma: tx,
    });
  try {
    const resolved = await input.prisma.$transaction(async (
      tx,
    ): Promise<HostedGroupJoinOutreachMemberReactionResult> => {
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
      // Every terminal decision below marks the provider event handled, and a
      // handled event is never replayed into the reaction projection. The
      // durable room-evidence row therefore commits in this same transaction,
      // attributed because a member's handle is already group-known.
      const retainReactionEvidenceTx = async () => {
        reactionMailboxAppend = await appendHostedGroupOfferReactionRoomEvidenceTx({
          actor: input.event.reactionFromHandle,
          event: input.event,
          expectedContainerMemberId: offer.runtimeMemberId,
          tx,
        });
      };

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
        await retainReactionEvidenceTx();
        await markHandledTx(tx);
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
        await retainReactionEvidenceTx();
        await markHandledTx(tx);
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
        await retainReactionEvidenceTx();
        await markHandledTx(tx);
        return skipHostedGroupJoinOfferReaction({
          reason: "recipient_region_unsupported",
        });
      }

      await enqueueHostedGroupJoinOutreachTx({
        offerId: offer.offerId,
        participantPhoneNumber: input.participantPhoneNumber,
        requestedAt: input.event.providerCreatedAt,
        tx,
      });
      await retainReactionEvidenceTx();
      await markHandledTx(tx);
      return { status: "accepted", reason: "outreach_enqueued" };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    await signalHostedGroupOfferReactionBestEffort({
      append: reactionMailboxAppend,
      prisma: input.prisma,
    });
    return resolved;
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
