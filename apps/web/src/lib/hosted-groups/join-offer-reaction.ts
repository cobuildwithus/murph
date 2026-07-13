import "server-only";

import type { PrismaClient } from "@prisma/client";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  getHostedLinqReactionTargetMessage,
} from "../hosted-onboarding/linq-client";
import {
  normalizeHostedLinqGroupJoinOfferReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import {
  signalHostedMailboxAppendRuntime,
  signalHostedRuntimeMaintenanceRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
} from "./group-newsletter";
import {
  acceptHostedGroupJoinOfferTx,
  bindPendingHostedGroupJoinOfferTargetTx,
  createHostedGroupJoinOfferMessageDigest,
  isHostedGroupJoinOfferTarget,
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
  | { status: "owned"; reason: HostedGroupJoinOfferReactionSkipReason }
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

  const messageLookupKeyReadCandidates = normalizeLookupKeyCandidates(
    input.event.messageLookupKeyReadCandidates.length > 0
      ? input.event.messageLookupKeyReadCandidates
      : [input.event.messageLookupKey],
  );
  const threadIdentityLookupKeyReadCandidates = createHostedExternalThreadIdentityLookupKeyReadCandidates({
    channel: "linq",
    threadId: input.event.linqChatId,
  });
  let targetOwned = await isHostedGroupJoinOfferTarget({
    messageLookupKeyReadCandidates,
    prisma: input.prisma,
  });
  if (!targetOwned) {
    targetOwned = await bindPendingHostedGroupJoinOfferTarget({
      chatId: input.event.linqChatId,
      messageId: input.event.linqMessageId,
      partIndex: input.event.reactionPartIndex,
      prisma: input.prisma,
      threadIdentityLookupKeyReadCandidates,
    });
  }
  if (!targetOwned) {
    return skipHostedGroupJoinOfferReaction({
      reason: "no_offer_match",
    });
  }
  const member = await resolveHostedGroupJoinOfferReactionMember({
    handle: input.event.reactionFromHandle,
    prisma: input.prisma,
  });
  if (!member) {
    return ownHostedGroupJoinOfferReaction({
      reason: "not_a_member",
    });
  }
  if (
    member.suspendedAt
    || !(await readActiveHostedMemberAccess({ memberId: member.id, prisma: input.prisma }))
  ) {
    return ownHostedGroupJoinOfferReaction({
      reason: "member_inactive",
    });
  }

  let result: Awaited<ReturnType<typeof acceptHostedGroupJoinOfferTx>>;
  try {
    result = await input.prisma.$transaction(async (tx) =>
      acceptHostedGroupJoinOfferTx({
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
    return ownHostedGroupJoinOfferReaction({
      reason,
    });
  }

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

  await signalVaultShareCleanupRuntimesBestEffort(result.vaultShareCleanupSignals);

  return { status: "accepted", reason: "accepted" };
}

async function signalVaultShareCleanupRuntimesBestEffort(
  signals: readonly { mailboxItemId: string; memberId: string }[],
): Promise<void> {
  await Promise.all(signals.map(async (signal) => {
    try {
      await signalHostedMailboxAppendRuntime({
        expectedUserId: signal.memberId,
        mailboxItemId: signal.mailboxItemId,
      });
    } catch {
      // The revoke mailbox item is durable; the destination runtime will import it on a
      // later wake if this best-effort signal fails.
    }
  }));
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
  return { status: "ignored", reason: input.reason };
}

function ownHostedGroupJoinOfferReaction(input: {
  reason: HostedGroupJoinOfferReactionSkipReason;
}): HostedGroupJoinOfferReactionResult {
  return { status: "owned", reason: input.reason };
}

async function bindPendingHostedGroupJoinOfferTarget(input: {
  chatId: string;
  messageId: string;
  partIndex: number | null;
  prisma: PrismaClient;
  threadIdentityLookupKeyReadCandidates: readonly string[];
}): Promise<boolean> {
  let target: Awaited<ReturnType<typeof getHostedLinqReactionTargetMessage>>;
  try {
    target = await getHostedLinqReactionTargetMessage({
      messageId: input.messageId,
    });
  } catch (error) {
    if (isHostedOnboardingError(error) && !error.retryable) {
      return false;
    }
    throw error;
  }

  if (
    target.id !== input.messageId
    || target.chatId !== input.chatId
    || !target.isFromMe
  ) {
    return false;
  }
  const targetPart = input.partIndex === null
    ? (target.parts.length === 1 ? target.parts[0] : null)
    : (target.parts[input.partIndex] ?? null);
  if (targetPart?.type !== "text") {
    return false;
  }
  return input.prisma.$transaction(async (tx) =>
    bindPendingHostedGroupJoinOfferTargetTx({
      messageDigest: createHostedGroupJoinOfferMessageDigest(targetPart.value),
      messageId: input.messageId,
      threadIdentityLookupKeyReadCandidates: input.threadIdentityLookupKeyReadCandidates,
      tx,
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}
