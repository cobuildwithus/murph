import type { PrismaClient } from "@prisma/client";

import type { HostedLinqWebhookEvent } from "./linq";
import {
  lookupHostedMemberRoutingByHomeLinqChatId,
} from "./hosted-member-routing-store";
import {
  resolveHostedRecognizedInboundAccess,
} from "./recognized-inbound-access";
import {
  buildInactiveMemberAccessNoticeResponse,
  buildSignupLinkResponse,
  resolveHostedOnboardingLinqMessageContext,
} from "./webhook-provider-linq-shared";
import type {
  HostedOnboardingLinqDirectPlan,
} from "./webhook-provider-linq-types";

// The canonical planner throws HOSTED_LINQ_HOME_ROUTE_CHANGED to abort its
// transaction: by then it has already reserved a pool home line that must not
// commit for a member who owns a different permanent route. Recovery therefore
// runs after that rollback, on the event the canonical owner already verified
// and parsed, and returns an ordinary plan for the canonical drain path.
export async function planHostedLinqPermanentHomeRouteRecovery(input: {
  event: HostedLinqWebhookEvent;
  prisma: PrismaClient;
}): Promise<HostedOnboardingLinqDirectPlan | null> {
  if (input.event.event_type !== "message.received") {
    return null;
  }

  const context = resolveHostedOnboardingLinqMessageContext(input.event);
  if (
    context.summary.isFromMe
    || context.messageEvent.data.chat?.is_group === true
    || !context.participantContact
  ) {
    return null;
  }

  const homeOwner = await lookupHostedMemberRoutingByHomeLinqChatId({
    linqChatId: context.summary.chatId,
    prisma: input.prisma,
  });
  if (!homeOwner) {
    return null;
  }

  const access = await resolveHostedRecognizedInboundAccess({
    allowSignupFallback: true,
    inviteChannel: "linq",
    member: homeOwner.core,
    noticeSeed: input.event.event_id,
    prisma: input.prisma,
  });
  if (access.kind === "allowed" || access.kind === "silent") {
    return null;
  }

  return access.kind === "access_notice"
    ? buildInactiveMemberAccessNoticeResponse({
        chatId: context.summary.chatId,
        memberId: homeOwner.core.id,
        message: access.message,
        messageId: context.summary.messageId,
        noticeCode: access.noticeCode,
        occurredAt: context.occurredAt,
        sourceEventId: input.event.event_id,
      })
    : buildSignupLinkResponse({
        chatId: context.summary.chatId,
        inviteCode: access.inviteCode,
        inviteId: access.inviteId,
        memberId: homeOwner.core.id,
        messageId: context.summary.messageId,
        occurredAt: context.occurredAt,
        service: context.messageEvent.data.service ?? null,
        sourceEventId: input.event.event_id,
        threadIsDirect: true,
      });
}
