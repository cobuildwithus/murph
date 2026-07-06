import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { HostedVaultShareProjectionKind } from "@murphai/hosted-execution/vault-share";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import { markHostedLinqDeliverySkippedTx } from "../hosted-onboarding/linq-delivery-store";
import {
  normalizeHostedLinqGroupJoinOfferReaction,
  type ParsedHostedLinqProviderEvent,
} from "../hosted-onboarding/linq-provider-events";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
} from "../hosted-onboarding/webhook-transport";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { createHostedExternalThreadIdentityLookupKey } from "../hosted-onboarding/contact-privacy";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { buildHostedGroupJoinUrl } from "./group-links";
import { acceptHostedGroupJoinOfferTx } from "./group-store";
import { projectHostedVaultShareProjectionDisplays } from "./join-policy";

type HostedGroupJoinOfferReactionSkipReason =
  | "join_links_unavailable"
  | "launch_consent_missing"
  | "member_inactive"
  | "missing_reaction_context"
  | "no_offer_match"
  | "not_a_member"
  | "reaction_removed"
  | "unsupported_reaction";

export type HostedGroupJoinOfferReactionResult =
  | { status: "accepted"; reason: "accepted" }
  | { status: "ignored"; reason: HostedGroupJoinOfferReactionSkipReason };

type HostedGroupJoinOfferReactionScheduler = (task: () => Promise<void>) => void;

export async function handleHostedGroupJoinOfferReaction(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  scheduleAfterResponse?: HostedGroupJoinOfferReactionScheduler;
  signal?: AbortSignal;
}): Promise<HostedGroupJoinOfferReactionResult> {
  if (input.event.eventType === "reaction.removed") {
    return await skipHostedGroupJoinOfferReaction({
      event: input.event,
      prisma: input.prisma,
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
    return await skipHostedGroupJoinOfferReaction({
      event: input.event,
      prisma: input.prisma,
      reason: "unsupported_reaction",
    });
  }
  if (
    !input.event.linqChatId
    || !input.event.linqMessageId
    || !input.event.messageLookupKey
    || !input.event.reactionFromHandle
  ) {
    return await skipHostedGroupJoinOfferReaction({
      event: input.event,
      prisma: input.prisma,
      reason: "missing_reaction_context",
    });
  }

  const member = await resolveHostedGroupJoinOfferReactionMember({
    handle: input.event.reactionFromHandle,
    prisma: input.prisma,
  });
  if (!member) {
    return await skipHostedGroupJoinOfferReaction({
      event: input.event,
      prisma: input.prisma,
      reason: "not_a_member",
    });
  }
  if (
    member.suspendedAt
    || !(await readActiveHostedMemberAccess({ memberId: member.id, prisma: input.prisma }))
  ) {
    return await skipHostedGroupJoinOfferReaction({
      event: input.event,
      prisma: input.prisma,
      reason: "member_inactive",
    });
  }

  const publicBaseUrl = resolveHostedPublicBaseUrl();
  if (!publicBaseUrl) {
    return await skipHostedGroupJoinOfferReaction({
      event: input.event,
      prisma: input.prisma,
      reason: "join_links_unavailable",
    });
  }
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: "linq",
    threadId: input.event.linqChatId,
  });

  let accepted: Awaited<ReturnType<typeof acceptHostedGroupJoinOfferTx>>;
  try {
    accepted = await input.prisma.$transaction(async (tx) =>
      acceptHostedGroupJoinOfferTx({
        memberId: member.id,
        messageLookupKey: input.event.messageLookupKey,
        now: input.event.providerCreatedAt,
        threadIdentityLookupKey,
        tx,
      }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    const reason = readHostedGroupJoinOfferReactionSkipReason(error);
    if (!reason) {
      throw error;
    }
    return await skipHostedGroupJoinOfferReaction({
      event: input.event,
      prisma: input.prisma,
      reason,
    });
  }

  const joinUrl = buildHostedGroupJoinUrl({
    joinCode: accepted.joinCode,
    publicBaseUrl,
  });
  if (!joinUrl) {
    return await skipHostedGroupJoinOfferReaction({
      event: input.event,
      prisma: input.prisma,
      reason: "join_links_unavailable",
    });
  }

  await drainHostedLinqSideEffectsDirect({
    currentInboundReply: {
      chatId: input.event.linqChatId,
      messageId: input.event.linqMessageId,
    },
    prisma: input.prisma,
    scheduleAfterResponse: input.scheduleAfterResponse,
    sideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.event.linqChatId,
        message: buildHostedGroupJoinOfferAcceptedReply({
          joinUrl,
          projectionKinds: accepted.selectedVaultShareProjectionKinds,
        }),
        occurredAt: input.event.providerCreatedAt.toISOString(),
        replyToMessageId: input.event.linqMessageId,
        sourceEventId: input.event.eventId,
        template: "group_join_offer_accepted",
      }),
    ],
    signal: input.signal,
  });

  return { status: "accepted", reason: "accepted" };
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

async function skipHostedGroupJoinOfferReaction(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  reason: HostedGroupJoinOfferReactionSkipReason;
}): Promise<HostedGroupJoinOfferReactionResult> {
  const effectId = `group-join-offer-reaction:${input.event.eventId}`;
  await markHostedLinqDeliverySkippedTx({
    failureCode: "HOSTED_GROUP_JOIN_OFFER_REACTION_SKIPPED",
    failureReason: "Hosted group join offer reaction skipped.",
    idempotencyKey: effectId,
    linqChatId: input.event.linqChatId,
    prisma: input.prisma,
    reason: input.reason,
    source: "hosted_group_join_offer_reaction",
    sourceRef: effectId,
    targetKind: "thread",
    template: "group_join_offer_accepted",
  });
  return { status: "ignored", reason: input.reason };
}

export function buildHostedGroupJoinOfferAcceptedReply(input: {
  joinUrl: string;
  projectionKinds: readonly HostedVaultShareProjectionKind[];
}): string {
  return [
    "Added you to this Murph group.",
    renderHostedGroupJoinOfferAcceptedScopeSentence(input.projectionKinds),
    `Manage what you share anytime: ${input.joinUrl}`,
  ].join(" ");
}

function renderHostedGroupJoinOfferAcceptedScopeSentence(
  projectionKinds: readonly HostedVaultShareProjectionKind[],
): string {
  const labels = projectHostedVaultShareProjectionDisplays(projectionKinds)
    .map((display) => display.label.toLowerCase());
  const scope = labels.length > 0
    ? `your Murph profile name and ${formatHumanList(labels)}`
    : "your Murph profile name";
  return `Sharing ${scope} with this group.`;
}

function formatHumanList(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}
