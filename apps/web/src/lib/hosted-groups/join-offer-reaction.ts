import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  appendCallCircleSetupNotificationTx,
  readCallCircleNotificationSignal,
} from "../call-circle/notifications";
import {
  signalHostedAssistantNotificationsBestEffort,
  type HostedAssistantNotificationSignal,
} from "../hosted-execution/assistant-notifications";
import {
  acceptCallCircleOfferEnrollment,
} from "../call-circle/participant-store";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  normalizeHostedLinqGroupJoinOfferReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import {
  signalHostedMailboxAppendsBestEffort,
  signalHostedRuntimeMaintenanceRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
} from "./group-newsletter";
import { acceptHostedGroupJoinOfferTx } from "./group-store";

type HostedGroupJoinOfferReactionSkipReason =
  | "call_circle_full"
  | "launch_consent_missing"
  | "member_inactive"
  | "missing_reaction_context"
  | "no_offer_match"
  | "offer_revoked"
  | "not_a_member"
  | "reaction_removed"
  | "unsupported_reaction";

export type HostedGroupJoinOfferReactionResult =
  | { status: "accepted"; reason: "accepted" }
  | { status: "ignored"; reason: HostedGroupJoinOfferReactionSkipReason };

export async function handleHostedGroupJoinOfferReaction(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
}): Promise<HostedGroupJoinOfferReactionResult> {
  if (input.event.eventType === "reaction.removed") {
    return skipHostedGroupJoinOfferReaction({
      reason: "reaction_removed",
    });
  }
  if (
    normalizeHostedLinqGroupJoinOfferReaction({
      customEmoji: input.event.reactionCustomEmoji,
      eventType: input.event.eventType,
      reactionType: input.event.reactionType,
    }) !== "accept"
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

  const member = await resolveHostedGroupJoinOfferReactionMember({
    handle: input.event.reactionFromHandle,
    prisma: input.prisma,
  });
  if (!member) {
    return skipHostedGroupJoinOfferReaction({
      reason: "not_a_member",
    });
  }
  const messageLookupKeyReadCandidates =
    input.event.messageLookupKeyReadCandidates.length > 0
      ? input.event.messageLookupKeyReadCandidates
      : [input.event.messageLookupKey];
  const threadIdentityLookupKeyReadCandidates = createHostedExternalThreadIdentityLookupKeyReadCandidates({
    channel: "linq",
    threadId: input.event.linqChatId,
  });

  let accepted: {
    callCircleSetupSignal: HostedAssistantNotificationSignal | null;
    offer: Awaited<ReturnType<typeof acceptHostedGroupJoinOfferTx>>;
  };
  const receivedAt = new Date();
  try {
    accepted = await input.prisma.$transaction(async (tx) => {
      const offer = await acceptHostedGroupJoinOfferTx({
        bindingPendingAt: receivedAt,
        memberId: member.id,
        messageLookupKeyReadCandidates,
        now: input.event.providerCreatedAt,
        threadIdentityLookupKeyReadCandidates,
        tx,
      });
      const callCircleSetupSignal = await applyHostedGroupJoinOfferActivationTx({
        activation: offer.activation,
        groupId: offer.groupId,
        memberId: member.id,
        now: input.event.providerCreatedAt,
        offerPostedAt: offer.offerPostedAt,
        tx,
      });
      return { callCircleSetupSignal, offer };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    const reason = readHostedGroupJoinOfferReactionSkipReason(error);
    if (!reason) {
      throw error;
    }
    return skipHostedGroupJoinOfferReaction({
      reason,
    });
  }
  const result = accepted.offer;

  if (result.grantedVaultShareProjectionKinds.includes("group-email.v0")) {
    await enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
      groupId: result.groupId,
      memberId: member.id,
      prisma: input.prisma,
    });
  }

  if (result.grantedVaultShareProjectionKinds.length > 0) {
    try {
      await signalHostedRuntimeMaintenanceRuntime({ userId: member.id });
    } catch {
      // Durable join/grants already committed; the runtime will offer projections later.
    }
  }

  await signalHostedMailboxAppendsBestEffort(result.vaultShareCleanupSignals);
  await signalHostedAssistantNotificationsBestEffort([
    accepted.callCircleSetupSignal,
  ]);

  return { status: "accepted", reason: "accepted" };
}

async function applyHostedGroupJoinOfferActivationTx(input: {
  activation: Awaited<ReturnType<typeof acceptHostedGroupJoinOfferTx>>["activation"];
  groupId: string;
  memberId: string;
  now: Date;
  offerPostedAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedAssistantNotificationSignal | null> {
  if (
    input.activation !== "call-circle.enroll.v0"
  ) {
    return null;
  }
  const participant = await acceptCallCircleOfferEnrollment({
    groupId: input.groupId,
    memberId: input.memberId,
    now: input.now,
    offerPostedAt: input.offerPostedAt,
    prisma: input.tx,
  });
  const notification = await appendCallCircleSetupNotificationTx({
    enrollmentGeneration: participant.enrollmentGeneration,
    groupId: input.groupId,
    memberId: input.memberId,
    now: input.now,
    tx: input.tx,
  });
  return notification ? readCallCircleNotificationSignal({
    memberId: input.memberId,
    notification,
  }) : null;
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
  if (
    error.code === "HOSTED_ACCESS_REQUIRED"
    || error.code === "HOSTED_MEMBER_SUSPENDED"
  ) {
    return "member_inactive";
  }
  if (error.code === "HOSTED_GROUP_JOIN_OFFER_REVOKED") {
    return "offer_revoked";
  }
  if (error.code === "HOSTED_CALL_CIRCLE_PARTICIPANT_LIMIT_REACHED") {
    return "call_circle_full";
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
}): Promise<{ id: string } | null> {
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
  return { id: member.id };
}

function skipHostedGroupJoinOfferReaction(input: {
  reason: HostedGroupJoinOfferReactionSkipReason;
}): HostedGroupJoinOfferReactionResult {
  return { status: "ignored", reason: input.reason };
}
