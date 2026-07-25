import "server-only";

import type { PrismaClient } from "@prisma/client";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  isHostedLinqAffirmativeReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { logHostedOnboardingDiagnostic } from "../hosted-onboarding/logging";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { signalHostedRuntimeMaintenanceRuntime } from "../hosted-orchestration/signal-runtime";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import {
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
} from "./group-newsletter";
import {
  materializePendingHostedGroupJoinConfirmationsBestEffort,
  signalHostedGroupJoinConfirmationRuntimeBestEffort,
} from "./group-join-confirmation";
import {
  acceptHostedGroupDisclosurePermissionReactionTx,
} from "./group-disclosure-store";
import {
  enqueueHostedGroupJoinOutreachTx,
  revokeHostedGroupJoinOutreachForRemovedReactionTx,
} from "./group-join-outreach-store";
import {
  acceptHostedGroupJoinOfferTx,
  readHostedGroupJoinOfferTargetTx,
} from "./group-store";
import {
  createHostedPostCommitDeadline,
  readHostedPostCommitRemainingMs,
  waitForHostedPostCommitOperation,
} from "../hosted-onboarding/bounded-post-commit";

type HostedGroupJoinOfferReactionSkipReason =
  | "disclosure_grant_limit_reached"
  | "launch_consent_missing"
  | "member_inactive"
  | "missing_reaction_context"
  | "no_offer_match"
  | "offer_revoked"
  | "not_a_member"
  | "non_phone_handle"
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
  const isDisclosureConsentReaction = isExactHostedGroupDisclosureLikeReaction(
    input.event,
  );
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
  const threadIdentityLookupKeyReadCandidates = createHostedExternalThreadIdentityLookupKeyReadCandidates({
    channel: "linq",
    threadId: input.event.linqChatId,
  });

  const member = await resolveHostedGroupJoinOfferReactionMember({
    handle: input.event.reactionFromHandle,
    prisma: input.prisma,
  });

  if (input.event.eventType === "reaction.removed") {
    // Only the pre-member outreach this feature owns is revocable. A member's
    // removal keeps its previous no-op behavior: their grants are additive and
    // are not undone by dropping a tapback.
    const participantPhoneNumber = member
      ? null
      : readHostedGroupJoinOfferReactionParticipantPhone(
          input.event.reactionFromHandle,
        );
    if (!participantPhoneNumber) {
      return skipHostedGroupJoinOfferReaction({ reason: "reaction_removed" });
    }

    try {
      const revoked = await input.prisma.$transaction(async (tx) => {
        const offer = await readHostedGroupJoinOfferTargetTx({
          messageLookupKeyReadCandidates,
          threadIdentityLookupKeyReadCandidates,
          tx,
        });
        return revokeHostedGroupJoinOutreachForRemovedReactionTx({
          groupId: offer.groupId,
          now: input.event.providerCreatedAt,
          offerId: offer.offerId,
          participantPhoneNumber,
          tx,
        });
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
      return revoked.kind === "revoked"
        ? { status: "accepted", reason: "outreach_revoked" }
        : skipHostedGroupJoinOfferReaction({ reason: "reaction_removed" });
    } catch (error) {
      if (!readHostedGroupJoinOfferReactionSkipReason(error)) {
        throw error;
      }
      return skipHostedGroupJoinOfferReaction({ reason: "reaction_removed" });
    }
  }

  if (!member) {
    const participantPhoneNumber = readHostedGroupJoinOfferReactionParticipantPhone(
      input.event.reactionFromHandle,
    );
    if (!participantPhoneNumber) {
      return skipHostedGroupJoinOfferReaction({ reason: "non_phone_handle" });
    }

    try {
      await input.prisma.$transaction(async (tx) => {
        const offer = await readHostedGroupJoinOfferTargetTx({
          messageLookupKeyReadCandidates,
          threadIdentityLookupKeyReadCandidates,
          tx,
        });
        await enqueueHostedGroupJoinOutreachTx({
          groupId: offer.groupId,
          offerId: offer.offerId,
          participantPhoneNumber,
          requestedAt: input.event.providerCreatedAt,
          tx,
        });
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    } catch (error) {
      const reason = readHostedGroupJoinOfferReactionSkipReason(error);
      if (!reason) {
        throw error;
      }
      return skipHostedGroupJoinOfferReaction({ reason });
    }
    return { status: "accepted", reason: "outreach_enqueued" };
  }
  if (
    member.suspendedAt
    || !(await readActiveHostedMemberAccess({ memberId: member.id, prisma: input.prisma }))
  ) {
    return skipHostedGroupJoinOfferReaction({
      reason: "member_inactive",
    });
  }

  if (isDisclosureConsentReaction) {
    const disclosureResult = await input.prisma.$transaction(async (tx) =>
      acceptHostedGroupDisclosurePermissionReactionTx({
        memberId: member.id,
        messageLookupKeyReadCandidates,
        now: input.event.providerCreatedAt,
        reactionEventId: input.event.eventId,
        threadIdentityLookupKeyReadCandidates,
        tx,
      }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    if (disclosureResult.kind === "accepted") {
      return { status: "accepted", reason: "accepted" };
    }
    if (disclosureResult.kind === "not_group_member") {
      return skipHostedGroupJoinOfferReaction({ reason: "not_a_member" });
    }
    if (disclosureResult.kind === "wrong_thread") {
      return skipHostedGroupJoinOfferReaction({ reason: "no_offer_match" });
    }
    if (disclosureResult.kind === "limit_reached") {
      return skipHostedGroupJoinOfferReaction({
        reason: "disclosure_grant_limit_reached",
      });
    }
  }

  let result: Awaited<ReturnType<typeof acceptHostedGroupJoinOfferTx>>;
  try {
    result = await input.prisma.$transaction(async (tx) =>
      acceptHostedGroupJoinOfferTx({
        confirmationPublicBaseUrl: resolveHostedPublicBaseUrl(),
        memberId: member.id,
        messageLookupKeyReadCandidates,
        now: input.event.providerCreatedAt,
        threadIdentityLookupKeyReadCandidates,
        tx,
      }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    const reason = readHostedGroupJoinOfferReactionSkipReason(error);
    if (!reason) {
      throw error;
    }
    return skipHostedGroupJoinOfferReaction({
      reason,
    });
  }

  const postCommitDeadlineMs = createHostedPostCommitDeadline(undefined);
  if (result.joinConfirmationSignal) {
    await signalHostedGroupJoinConfirmationRuntimeBestEffort({
      ...result.joinConfirmationSignal,
      prisma: input.prisma,
      ...(input.signal ? { signal: input.signal } : {}),
      timeoutMs: readHostedPostCommitRemainingMs(postCommitDeadlineMs),
    });
  }
  await materializePendingHostedGroupJoinConfirmationsBestEffort({
    memberId: member.id,
    membershipId: result.membershipId,
    prisma: input.prisma,
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: readHostedPostCommitRemainingMs(postCommitDeadlineMs),
  });

  if (result.grantedVaultShareProjectionKinds.length > 0) {
    await runHostedGroupJoinPostCommitBestEffort({
      deadlineMs: postCommitDeadlineMs,
      operation: (abortSignal) => signalHostedRuntimeMaintenanceRuntime({
        abortSignal,
        userId: member.id,
      }),
      signal: input.signal,
    });
  }

  if (result.grantedVaultShareProjectionKinds.includes("group-email.v0")) {
    await runHostedGroupJoinPostCommitBestEffort({
      deadlineMs: postCommitDeadlineMs,
      operation: () => enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
        groupId: result.groupId,
        memberId: member.id,
        prisma: input.prisma,
      }),
      signal: input.signal,
    });
  }
  return { status: "accepted", reason: "accepted" };
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

async function runHostedGroupJoinPostCommitBestEffort(input: {
  deadlineMs: number;
  operation: (signal: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs: input.deadlineMs,
      operation: input.operation,
      signal: input.signal,
    });
  } catch {
    // The durable join, grants, and mailbox items remain available for a later wake.
  }
}

function normalizeLookupKeyCandidates(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0))];
}

function readHostedGroupJoinOfferReactionSkipReason(
  error: unknown,
): HostedGroupJoinOfferReactionSkipReason | null {
  if (!isHostedOnboardingError(error)) {
    return null;
  }
  if (error.code === "HOSTED_CONSENT_REQUIRED") {
    return "launch_consent_missing";
  }
  if (error.code === "HOSTED_GROUP_JOIN_OFFER_REVOKED") {
    return "offer_revoked";
  }
  if (
    error.code === "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND"
    || error.code === "HOSTED_GROUP_NOT_ACTIVE"
    || error.code === "HOSTED_GROUP_RUNTIME_UNSUPPORTED"
  ) {
    return "no_offer_match";
  }
  return null;
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
  logHostedOnboardingDiagnostic("hosted-groups.join-offer-reaction-skip", {
    reason: input.reason,
  });
  return { status: "ignored", reason: input.reason };
}
