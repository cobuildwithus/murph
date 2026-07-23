import { type Prisma } from "@prisma/client";
import { buildHostedExecutionTelegramConversationMessageWake } from "@murphai/hosted-execution";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { ensureHostedThreadContainerRouteTx } from "../hosted-routing/thread-container-service";
import { readHostedThreadRouteByThreadIdentity } from "../hosted-routing/thread-route-store";
import {
  isHostedMemberSuspended,
} from "./entitlement";
import {
  isHostedOnboardingError,
} from "./errors";
import {
  appendHostedFamilyChatNotificationTx,
  buildHostedFamilyInviteAcceptedNotification,
  acceptHostedFamilyInviteFromTelegramTx,
  resolveHostedFamilyInviteTokenForInbound,
  resolveHostedFamilyChatNotificationRouteTx,
} from "./family-plan";
import { readActiveHostedMemberAccess } from "./member-access";
import {
  buildHostedTelegramMessagePayload,
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import {
  resolveHostedMemberRoutingByTelegramUserId,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-store";
import {
  type HostedWebhookPlan,
  type HostedWebhookWakeHandoff,
} from "./webhook-service-types";
const HOSTED_TELEGRAM_ACCOUNT_LOOKUP_KEY = "telegram:bot";

export type HostedOnboardingTelegramWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  ok: true;
  reason?: string;
};

export async function planHostedOnboardingTelegramWebhook(input: {
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

  const existingMemberLookup = await resolveHostedMemberRoutingByTelegramUserId({
    prisma: input.prisma,
    telegramUserId: summary.senderTelegramUserId,
  });

  if (existingMemberLookup.status === "ambiguous") {
    return buildIgnoredTelegramWebhookPlan("ambiguous-telegram-binding");
  }

  const existingMember = existingMemberLookup.status === "found"
    ? existingMemberLookup.lookup.core
    : null;

  if (!existingMember) {
    return buildIgnoredTelegramWebhookPlan("unlinked-telegram");
  }

  if (isHostedMemberSuspended(existingMember.suspendedAt)) {
    return buildIgnoredTelegramWebhookPlan("suspended-member");
  }

  if (summary.isDirect) {
    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: existingMember.id,
      prisma: input.prisma,
      telegramThreadId: telegramMessage.threadId,
      telegramUserId: summary.senderTelegramUserId,
    });
  }

  if (!await readActiveHostedMemberAccess({
    memberId: existingMember.id,
    prisma: input.prisma,
  })) {
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
        const created = await ensureHostedThreadContainerRouteTx({
          accountLookupKey: HOSTED_TELEGRAM_ACCOUNT_LOOKUP_KEY,
          channel: "telegram",
          occurredAt: new Date(summary.occurredAt),
          ownerMemberId: existingMember.id,
          prisma: input.prisma,
          threadId: telegramMessage.threadId,
        });
        runtimeMemberId = created.containerMemberId;
      } catch (error) {
        if (!isHostedOnboardingError(error) || error.code !== "HOSTED_THREAD_ROUTE_ALREADY_BOUND") {
          throw error;
        }
        // Another first group message may have committed the route while this
        // webhook was in flight. Re-read and converge on that existing owner.
        threadRoute = await readHostedThreadRouteByThreadIdentity({
          channel: "telegram",
          prisma: input.prisma,
          threadId: telegramMessage.threadId,
        });
        if (!threadRoute) {
          return buildIgnoredTelegramWebhookPlan("group-chat-provision-unavailable");
        }
      }
    }
    if (threadRoute) {
      runtimeMemberId = threadRoute.containerMemberId;
    }
  }
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
          }
        : {}),
      telegramMessage,
      userId: runtimeMemberId,
    }),
    tx: input.prisma,
  });

  return {
    desiredSideEffects: [],
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
  "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
  "HOSTED_FAMILY_OWNER_ALREADY_IN_GROUP",
  "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
  "HOSTED_FAMILY_TELEGRAM_IDENTITY_AMBIGUOUS",
]);

function isExpectedHostedTelegramFamilyInviteAcceptanceMiss(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && !error.retryable
    && HOSTED_TELEGRAM_FAMILY_INVITE_ACCEPTANCE_MISS_CODES.has(error.code);
}
