import type { HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { requireHostedRuntimeCallbackTx } from "../hosted-execution/runtime-owner";
import "server-only";
import type { ConversationPollRequest } from "@murphai/hosted-execution/conversation-polls";
import { isHostedLinqConversationMessageWake, isHostedTelegramConversationMessageWake } from "@murphai/hosted-execution";
import { readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { assertHostedLinqRecentInboundEngagementForRuntime, resolveHostedLinqEgressPolicyForRuntime } from "../hosted-onboarding/linq-egress-engagement";
import { readHostedMemberRoutingState } from "../hosted-onboarding/hosted-member-routing-store";
import { assertHostedThreadRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";

export type PollRoute = { channel: "linq" | "telegram"; target: string };

export async function authorizePollConversation(input: {
  memberId: string;
  runtimeIdentity: HostedRuntimeIdentity | null;
  request: ConversationPollRequest;
}): Promise<PollRoute> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  });
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.request.assistantInputId, memberId: input.memberId, prisma,
  });
  if (wake && isHostedLinqConversationMessageWake(wake)) {
    const message = wake.message.linqMessage;
    if (message.isFromMe || message.service?.toLowerCase() !== "imessage") throw new TypeError("Native polls require an incoming iMessage.");
    const assertion = await assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: true, memberId: input.memberId, prisma, target: message.chatId,
    });
    if (assertion.resolvedRoute.target !== message.chatId) throw new TypeError("Poll conversation changed.");
    if (input.request.request.action === "create" || input.request.request.action === "vote") {
      const { policy } = await resolveHostedLinqEgressPolicyForRuntime({
        prisma, target: message.chatId, fromPhoneNumber: assertion.resolvedRoute.fromPhoneNumber,
        linePhoneNumberLookupKey: assertion.linePhoneNumberLookupKey, targetKind: "thread",
      });
      if (policy.kind === "block") throw new TypeError("Poll delivery is blocked for this conversation.");
    }
    return { channel: "linq", target: message.chatId };
  }
  if (wake && isHostedTelegramConversationMessageWake(wake)) {
    const message = wake.message.telegramMessage;
    if (message.threadIsDirect === true) {
      const routing = await readHostedMemberRoutingState({ memberId: input.memberId, prisma });
      if (routing?.telegramThreadId !== message.threadId) throw new TypeError("Poll conversation changed.");
    } else {
      if (!wake.message.routeAuthority || wake.message.routeAuthority.containerMemberId !== input.memberId) {
        throw new TypeError("Poll conversation is not authorized.");
      }
      await assertHostedThreadRouteEgressAuthority({ authority: wake.message.routeAuthority, prisma });
      if (wake.message.routeAuthority.threadId !== message.threadId) throw new TypeError("Poll conversation changed.");
    }
    return { channel: "telegram", target: message.threadId };
  }
  throw hostedOnboardingError({ code: "HOSTED_POLL_UNSUPPORTED", message: "Native polls require current iMessage or Telegram conversation input.", httpStatus: 400, retryable: false });
}
