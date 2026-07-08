import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  appendCallCircleSetupNotificationTx,
  type CallCircleNotificationSignal,
  readCallCircleNotificationSignal,
  signalCallCircleNotificationRuntimesBestEffort,
  type CallCircleNotificationAppendResult,
} from "../call-circle/notifications";
import {
  canAppendCallCircleSetupNotification,
  enrollCallCircleParticipant,
} from "../call-circle/participant-store";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  normalizeHostedLinqGroupJoinOfferReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import {
  acceptHostedGroupJoinOfferTx,
  type HostedGroupFeatureActivationKind,
} from "./group-store";

type HostedGroupJoinOfferReactionSkipReason =
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

type HostedGroupJoinOfferReactionAcceptanceResult = {
  callCircleSetupSignal: CallCircleNotificationSignal | null;
};

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
  const threadIdentityLookupKeyReadCandidates = createHostedExternalThreadIdentityLookupKeyReadCandidates({
    channel: "linq",
    threadId: input.event.linqChatId,
  });

  let accepted: HostedGroupJoinOfferReactionAcceptanceResult;
  try {
    accepted = await acceptHostedGroupJoinOfferReactionForMember({
      memberId: member.id,
      messageLookupKeyReadCandidates,
      now: input.event.providerCreatedAt,
      prisma: input.prisma,
      threadIdentityLookupKeyReadCandidates,
    });
  } catch (error) {
    const reason = readHostedGroupJoinOfferReactionSkipReason(error);
    if (!reason) {
      throw error;
    }
    if (
      reason === "no_offer_match"
      && await hasUnboundHostedGroupJoinOfferForReactionThread({
        prisma: input.prisma,
        threadIdentityLookupKeyReadCandidates,
      })
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_JOIN_OFFER_BINDING_PENDING",
        httpStatus: 503,
        message: "This group offer is still being bound to the provider message.",
        retryable: true,
      });
    }
    return skipHostedGroupJoinOfferReaction({
      reason,
    });
  }

  if (accepted.callCircleSetupSignal) {
    await signalCallCircleNotificationRuntimesBestEffort([accepted.callCircleSetupSignal]);
  }

  return { status: "accepted", reason: "accepted" };
}

async function acceptHostedGroupJoinOfferReactionForMember(input: {
  memberId: string;
  messageLookupKeyReadCandidates: readonly string[];
  now: Date;
  prisma: PrismaClient;
  threadIdentityLookupKeyReadCandidates: readonly string[];
}): Promise<HostedGroupJoinOfferReactionAcceptanceResult> {
  return await input.prisma.$transaction(async (tx) => {
    const offerAcceptance = await acceptHostedGroupJoinOfferTx({
      memberId: input.memberId,
      messageLookupKeyReadCandidates: input.messageLookupKeyReadCandidates,
      now: input.now,
      threadIdentityLookupKeyReadCandidates: input.threadIdentityLookupKeyReadCandidates,
      tx,
    });
    const callCircleSetupNotification = await applyHostedGroupOfferFeatureActivationsTx({
      featureActivations: offerAcceptance.featureActivations,
      groupId: offerAcceptance.groupId,
      memberId: input.memberId,
      now: input.now,
      tx,
    });
    const callCircleSetupSignal = callCircleSetupNotification
      ? readCallCircleNotificationSignal({
        memberId: input.memberId,
        notification: callCircleSetupNotification,
      })
      : null;
    return { callCircleSetupSignal };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function hasUnboundHostedGroupJoinOfferForReactionThread(input: {
  prisma: PrismaClient;
  threadIdentityLookupKeyReadCandidates: readonly string[];
}): Promise<boolean> {
  const threadIdentityLookupKeyReadCandidates = normalizeLookupKeyCandidates(
    input.threadIdentityLookupKeyReadCandidates,
  );
  if (threadIdentityLookupKeyReadCandidates.length === 0) {
    return false;
  }
  const route = await input.prisma.hostedThreadRoute.findFirst({
    select: { containerMemberId: true },
    where: {
      channel: "linq",
      threadIdentityLookupKey: { in: threadIdentityLookupKeyReadCandidates },
    },
  });
  if (!route) {
    return false;
  }
  const offer = await input.prisma.hostedGroupJoinOffer.findFirst({
    select: { id: true },
    where: {
      group: {
        runtimeMemberId: route.containerMemberId,
      },
      messageLookupKey: null,
      revokedAt: null,
    },
  });
  return offer !== null;
}

async function applyHostedGroupOfferFeatureActivationsTx(input: {
  featureActivations: readonly HostedGroupFeatureActivationKind[];
  groupId: string;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult | null> {
  if (!input.featureActivations.includes("call-circle.enroll.v0")) {
    return null;
  }
  await enrollCallCircleParticipant({
    groupId: input.groupId,
    memberId: input.memberId,
    now: input.now,
    prisma: input.tx,
  });
  if (!await canAppendCallCircleSetupNotification({
    groupId: input.groupId,
    memberId: input.memberId,
    prisma: input.tx,
  })) {
    return null;
  }
  const notification = await appendCallCircleSetupNotificationTx({
    groupId: input.groupId,
    memberId: input.memberId,
    now: input.now,
    tx: input.tx,
  });
  return notification;
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
  if (
    error.code === "HOSTED_ACCESS_REQUIRED"
    || error.code === "HOSTED_GROUP_JOIN_MEMBER_NOT_FOUND"
    || error.code === "HOSTED_MEMBER_NOT_FOUND"
    || error.code === "HOSTED_MEMBER_SUSPENDED"
  ) {
    return "member_inactive";
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
  return { status: "ignored", reason: input.reason };
}
