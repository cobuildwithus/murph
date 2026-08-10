import { type Prisma } from "@prisma/client";
import { buildHostedExecutionTelegramConversationMessageWake } from "@murphai/hosted-execution";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import {
  ensureHostedThreadContainerRouteTx,
  refreshHostedThreadContainerDeliveryRouteTx,
  type PreparedHostedThreadContainerCreation,
  type PreparedHostedThreadContainerDeliveryRoute,
} from "../hosted-routing/thread-container-service";
import {
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
} from "../hosted-routing/thread-delivery-route";
import {
  readHostedThreadRouteByThreadIdentity,
  requiresHostedThreadDeliveryRouteRefresh,
} from "../hosted-routing/thread-route-store";
import {
  bindArmedHostedUsageReferralToNewContainerTx,
  observeHostedUsageReferralInboundTx,
} from "../hosted-growth/usage-referral";
import {
  observeHostedThreadContainerParticipantAccessTx,
} from "../hosted-groups/thread-container-participant-access";
import {
  isHostedMemberSuspended,
} from "./entitlement";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  appendHostedFamilyChatNotificationTx,
  buildHostedFamilyInviteAcceptedNotification,
  acceptHostedFamilyInviteFromTelegramTx,
  resolveHostedFamilyInviteTokenForInbound,
  resolveHostedFamilyChatNotificationRouteTx,
} from "./family-plan";
import { readHostedRuntimeAiAccessDecision } from "./member-access";
import {
  buildHostedTelegramMessagePayload,
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import {
  resolveHostedMemberCoreByTelegramUserId,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-store";
import {
  createHostedTelegramMessageLookupKey,
  createHostedTelegramUserLookupKey,
} from "./contact-privacy";
import { lockHostedMemberRow } from "./shared";
import {
  type HostedWebhookPlan,
  type HostedWebhookWakeHandoff,
} from "./webhook-service-types";

export type HostedOnboardingTelegramWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  ok: true;
  reason?: string;
};

export async function planHostedOnboardingTelegramWebhook(input: {
  preparedSenderMemberId?: string;
  preparedThreadContainerCreation?: PreparedHostedThreadContainerCreation;
  preparedThreadDeliveryRoute?: PreparedHostedThreadContainerDeliveryRoute;
  prisma: Prisma.TransactionClient;
  update: ReturnType<typeof parseHostedTelegramWebhookUpdate>;
}): Promise<HostedWebhookPlan<HostedOnboardingTelegramWebhookResponse>> {
  const summary = await summarizeHostedTelegramWebhook(input.update);

  if (!summary) {
    return buildIgnoredTelegramWebhookPlan("unsupported-update");
  }
  const eventId = buildHostedTelegramWebhookEventId(input.update);

  if (summary.isBotMessage) {
    return buildIgnoredTelegramWebhookPlan("own-message");
  }

  if (!summary.senderTelegramUserId) {
    return buildIgnoredTelegramWebhookPlan("missing-sender");
  }

  const telegramMessagePayload = buildHostedTelegramMessagePayload(input.update);
  const telegramMessage = telegramMessagePayload
    ? { ...telegramMessagePayload, threadIsDirect: summary.isDirect }
    : null;
  if (!telegramMessage) {
    return buildIgnoredTelegramWebhookPlan("unsupported-update");
  }

  if (summary.isDirect) {
    const familyInviteTokenPresent = await resolveHostedFamilyInviteTokenForInbound({
      prisma: input.prisma,
      text: telegramMessage.text ?? null,
    }) !== null;
    let familyInviteNotAccepted = false;
    let familyAcceptance: Awaited<ReturnType<typeof acceptHostedFamilyInviteFromTelegramTx>> = null;
    let familyActivationWake: HostedWebhookWakeHandoff | null = null;
    try {
      familyAcceptance = await acceptHostedFamilyInviteFromTelegramTx({
        now: new Date(summary.occurredAt),
        onAcceptedMemberActivated: (activation) => {
          if (activation.hostedExecutionEventId && activation.hostedExecutionMailboxItemId) {
            familyActivationWake = {
              eventId: activation.hostedExecutionEventId,
              mailboxItemId: activation.hostedExecutionMailboxItemId,
              source: "telegram",
              userId: activation.memberId,
            };
          }
        },
        telegramThreadId: telegramMessage.threadId,
        telegramUsername: summary.senderTelegramUsername,
        telegramUserId: summary.senderTelegramUserId,
        text: telegramMessage.text ?? null,
        tx: input.prisma,
      });
    } catch (error) {
      if (!isExpectedHostedTelegramFamilyInviteAcceptanceMiss(error)) {
        throw error;
      }
      familyInviteNotAccepted = true;
    }
    if (familyAcceptance) {
      const route = await resolveHostedFamilyChatNotificationRouteTx({
        fallbackTelegramThreadId: telegramMessage.threadId,
        fallbackTelegramUserId: summary.senderTelegramUserId,
        memberId: familyAcceptance.memberId,
        tx: input.prisma,
      });
      const notification = await appendHostedFamilyChatNotificationTx({
        memberId: familyAcceptance.memberId,
        notification: buildHostedFamilyInviteAcceptedNotification({
          memberId: familyAcceptance.memberId,
        }),
        occurredAt: summary.occurredAt,
        route,
        sourceEventId: eventId,
        tx: input.prisma,
      });
      return {
        desiredSideEffects: [],
        postCommitGroupJoinConfirmationMemberIds: [familyAcceptance.memberId],
        response: {
          ok: true,
          reason: "family-invite-accepted",
        },
        ...(notification.mailboxItemId
          ? {
              wakeHandoffs: [{ eventId, mailboxItemId: notification.mailboxItemId, source: "telegram", userId: familyAcceptance.memberId }],
            }
          : familyActivationWake
            ? { wakeHandoffs: [familyActivationWake] }
            : {}),
      };
    }

    if (familyInviteTokenPresent || familyInviteNotAccepted) {
      return buildIgnoredTelegramWebhookPlan("family-invite-not-accepted");
    }
  }

  const existingMemberLookup = await resolveHostedMemberCoreByTelegramUserId({
    prisma: input.prisma,
    telegramUserId: summary.senderTelegramUserId,
  });

  if (existingMemberLookup.status === "ambiguous") {
    return buildIgnoredTelegramWebhookPlan("ambiguous-telegram-binding");
  }

  let existingMember = existingMemberLookup.status === "found"
    ? existingMemberLookup.core
    : null;

  if (!existingMember) {
    if (input.preparedSenderMemberId) {
      return buildIgnoredTelegramWebhookPlan("telegram-binding-changed");
    }
    if (!summary.isDirect) {
      const route = await readHostedThreadRouteByThreadIdentity({
        channel: "telegram",
        prisma: input.prisma,
        threadId: telegramMessage.threadId,
      });
      const eventKey = createHostedTelegramMessageLookupKey({
        chatId: telegramMessage.threadId,
        messageId: telegramMessage.messageId,
      });
      const senderSubjectKey = createHostedTelegramUserLookupKey(
        summary.senderTelegramUserId,
      );
      if (route && eventKey && senderSubjectKey) {
        const observation = await observeHostedUsageReferralInboundTx({
          containerMemberId: route.containerMemberId,
          eventKey,
          occurredAt: new Date(summary.occurredAt),
          senderMemberId: null,
          senderSubjectKey,
          tx: input.prisma,
        });
        return {
          ...buildIgnoredTelegramWebhookPlan(
            observation.isBoundReferralTarget
              ? "usage-referral-evidence-only"
              : "unlinked-telegram",
          ),
          ...(observation.qualificationCandidateReferralIds.length > 0
            ? {
                postCommitUsageReferralIds:
                  observation.qualificationCandidateReferralIds,
              }
            : {}),
        };
      }
    }
    return buildIgnoredTelegramWebhookPlan("unlinked-telegram");
  }

  await lockHostedMemberRow(input.prisma, existingMember.id);
  const lockedMemberLookup = await resolveHostedMemberCoreByTelegramUserId({
    prisma: input.prisma,
    telegramUserId: summary.senderTelegramUserId,
  });
  if (
    lockedMemberLookup.status !== "found"
    || lockedMemberLookup.core.id !== existingMember.id
  ) {
    return buildIgnoredTelegramWebhookPlan(
      lockedMemberLookup.status === "ambiguous"
        ? "ambiguous-telegram-binding"
        : "telegram-binding-changed",
    );
  }
  existingMember = lockedMemberLookup.core;

  if (isHostedMemberSuspended(existingMember.suspendedAt)) {
    return buildIgnoredTelegramWebhookPlan("suspended-member");
  }

  const accessNow = new Date();
  const accessDecision = await readHostedRuntimeAiAccessDecision({
    memberId: existingMember.id,
    now: accessNow,
    prisma: input.prisma,
  });
  if (
    !accessDecision.allowed
    && accessDecision.reason === "health_data_consent_withdrawn"
  ) {
    return buildIgnoredTelegramWebhookPlan("inactive-member");
  }

  if (summary.isDirect) {
    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: existingMember.id,
      prisma: input.prisma,
      telegramThreadId: telegramMessage.threadId,
      telegramUserId: summary.senderTelegramUserId,
    });
  }

  if (!accessDecision.allowed) {
    return buildIgnoredTelegramWebhookPlan("inactive-member");
  }

  let runtimeMemberId = existingMember.id;
  if (!summary.isDirect) {
    let threadRoute = await readHostedThreadRouteByThreadIdentity({
      channel: "telegram",
      prisma: input.prisma,
      threadId: telegramMessage.threadId,
    });
    if (!threadRoute) {
      try {
        const ensured = await ensureHostedThreadContainerRouteTx({
          accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
          channel: "telegram",
          occurredAt: new Date(summary.occurredAt),
          ownerMemberId: existingMember.id,
          ...(input.preparedThreadContainerCreation
            ? {
                preparedCreation: input.preparedThreadContainerCreation,
              }
            : {}),
          prisma: input.prisma,
          threadId: telegramMessage.threadId,
        });
        if (!ensured.created) {
          // This branch began from an observed-absent route and therefore has
          // only creation material. An existing winner requires its own
          // delivery-route package and mailbox-root prewarm in a fresh attempt.
          throw hostedOnboardingError({
            code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
            httpStatus: 503,
            message: "Hosted thread delivery-route preparation is required.",
            retryable: true,
          });
        }
        runtimeMemberId = ensured.containerMemberId;
        await bindArmedHostedUsageReferralToNewContainerTx({
          occurredAt: new Date(summary.occurredAt),
          ownerMemberId: existingMember.id,
          targetChannel: "telegram",
          targetLinqService: null,
          targetContainerMemberId: ensured.containerMemberId,
          tx: input.prisma,
        });
      } catch (error) {
        if (!isHostedOnboardingError(error) || error.code !== "HOSTED_THREAD_ROUTE_ALREADY_BOUND") {
          throw error;
        }
        // Another first group message may have committed the route while this
        // webhook was in flight. Retry the whole planner so pre-transaction
        // crypto preparation binds to that canonical winner.
        threadRoute = await readHostedThreadRouteByThreadIdentity({
          channel: "telegram",
          prisma: input.prisma,
          threadId: telegramMessage.threadId,
        });
        if (!threadRoute) {
          return buildIgnoredTelegramWebhookPlan("group-chat-provision-unavailable");
        }
        throw hostedOnboardingError({
          code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
          httpStatus: 503,
          message: "Hosted thread delivery-route preparation is required.",
          retryable: true,
        });
      }
    } else {
      if (
        !input.preparedThreadDeliveryRoute
        || input.preparedThreadDeliveryRoute.containerMemberId
          !== threadRoute.containerMemberId
      ) {
        // Existing-route preparation also warms the winner's mailbox ingress
        // root. If the route changed after preflight, retry before appending
        // under a transaction that has no matching warm root.
        throw hostedOnboardingError({
          code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
          httpStatus: 503,
          message: "Hosted thread delivery-route preparation is required.",
          retryable: true,
        });
      }
      if (requiresHostedThreadDeliveryRouteRefresh({
        accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
        route: threadRoute,
        threadId: telegramMessage.threadId,
      })) {
        await refreshHostedThreadContainerDeliveryRouteTx({
          accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
          preparedDeliveryRoute: input.preparedThreadDeliveryRoute,
          prisma: input.prisma,
          route: threadRoute,
          threadId: telegramMessage.threadId,
        });
      }
      runtimeMemberId = threadRoute.containerMemberId;
    }
    if (runtimeMemberId === existingMember.id && threadRoute) {
      runtimeMemberId = threadRoute.containerMemberId;
    }
    const senderHandleLookupKey = createHostedTelegramUserLookupKey(
      summary.senderTelegramUserId,
    );
    if (!senderHandleLookupKey) {
      return buildIgnoredTelegramWebhookPlan(
        "group-chat-provision-unavailable",
      );
    }
    await observeHostedThreadContainerParticipantAccessTx({
      containerMemberId: runtimeMemberId,
      handleLookupKey: senderHandleLookupKey,
      now: accessNow,
      observedAt: new Date(summary.occurredAt),
      participantMemberId: existingMember.id,
      prisma: input.prisma,
    });
    // The exact linked sender's durable observation may be what grants an
    // existing container access after its original owner becomes inactive.
    // Re-read the canonical decision against that same persisted relationship.
    if (!(await readHostedRuntimeAiAccessDecision({
      memberId: runtimeMemberId,
      now: accessNow,
      prisma: input.prisma,
    })).allowed) {
      return buildIgnoredTelegramWebhookPlan(
        "group-chat-provision-unavailable",
      );
    }
  }
  // Group inbound carries the sending participant so the assistant can tell
  // participants apart and bind shared-data reads to the right membership. The
  // sender is authoritative here: it is the webhook-authenticated Telegram user
  // id already resolved, under row lock, to exactly one active linked member.
  // Direct threads have a single known sender and stay attribution-free.
  const groupTelegramMessage = summary.isDirect
    ? telegramMessage
    : {
        ...telegramMessage,
        from: summary.senderTelegramUserId,
        ...(summary.senderTelegramDisplayName
          ? { senderDisplayName: summary.senderTelegramDisplayName }
          : {}),
        ...(summary.senderTelegramDisplayUsername
          ? { senderUsername: summary.senderTelegramDisplayUsername }
          : {}),
      };
  const mailboxAppend = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionTelegramConversationMessageWake({
      eventId,
      occurredAt: summary.occurredAt,
      ...(!summary.isDirect
        ? {
            routeAuthority: {
              channel: "telegram" as const,
              containerMemberId: runtimeMemberId,
              threadId: telegramMessage.threadId,
            },
            senderMemberId: existingMember.id,
          }
        : {}),
      telegramMessage: groupTelegramMessage,
      userId: runtimeMemberId,
    }),
    tx: input.prisma,
  });
  let qualificationCandidateReferralIds: string[] = [];
  if (!summary.isDirect) {
    const eventKey = createHostedTelegramMessageLookupKey({
      chatId: telegramMessage.threadId,
      messageId: telegramMessage.messageId,
    });
    const senderSubjectKey = createHostedTelegramUserLookupKey(
      summary.senderTelegramUserId,
    );
    if (eventKey && senderSubjectKey) {
      qualificationCandidateReferralIds = (
        await observeHostedUsageReferralInboundTx({
          containerMemberId: runtimeMemberId,
          eventKey,
          occurredAt: new Date(summary.occurredAt),
          senderMemberId: existingMember.id,
          senderSubjectKey,
          tx: input.prisma,
        })
      ).qualificationCandidateReferralIds;
    }
  }

  return {
    desiredSideEffects: [],
    ...(qualificationCandidateReferralIds.length > 0
      ? { postCommitUsageReferralIds: qualificationCandidateReferralIds }
      : {}),
    postCommitGroupJoinConfirmationMemberIds: [existingMember.id],
    response: {
      ok: true,
      reason: summary.isDirect
        ? "wake-appended-active-member"
        : "wake-appended-active-group",
    },
    wakeHandoffs: [{
      eventId, mailboxItemId: mailboxAppend.item.id, source: "telegram", userId: runtimeMemberId,
      wakeMailboxCheckpoint: { lane: mailboxAppend.item.lane, laneSeq: mailboxAppend.item.laneSeq },
    }],
  };
}

function buildIgnoredTelegramWebhookPlan(
  reason: string,
): HostedWebhookPlan<HostedOnboardingTelegramWebhookResponse> {
  return {
    desiredSideEffects: [],
    response: {
      ok: true,
      ignored: true,
      reason,
    },
  };
}

const HOSTED_TELEGRAM_FAMILY_INVITE_ACCEPTANCE_MISS_CODES = new Set([
  "HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED",
  "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
  "HOSTED_FAMILY_INVITE_NOT_FOUND",
  "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
  "HOSTED_FAMILY_MEMBER_ALREADY_IN_GROUP",
  "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
  "HOSTED_FAMILY_OWNER_ALREADY_IN_GROUP",
  "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
  "HOSTED_FAMILY_TELEGRAM_IDENTITY_AMBIGUOUS",
]);

export function isExpectedHostedTelegramFamilyInviteAcceptanceMiss(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && !error.retryable
    && HOSTED_TELEGRAM_FAMILY_INVITE_ACCEPTANCE_MISS_CODES.has(error.code);
}
