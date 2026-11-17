import "server-only";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import type { HostedLeaveGroupRequest, HostedLeaveGroupResponse } from "@murphai/hosted-execution/runtime-control";
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates, createHostedExternalThreadLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { leaveHostedLinqGroupTx, prepareHostedLinqGroupLeave, readHostedLinqGroupLeave, requestHostedLinqGroupLeaveAfterCommit } from "../hosted-routing/linq-group-leave";
import { acquireHostedLinqChatOwnershipLockTx } from "../hosted-routing/linq-chat-ownership-lock";
import { getPrisma } from "../prisma";

function incomingRoute(wake: HostedExecutionConversationMessageWake | null, memberId: string) {
  if (!wake || wake.userId !== memberId || wake.message.channel !== "linq") return null;
  const { routeAuthority: route, linqMessage: message } = wake.message;
  return route?.channel === "linq" && route.containerMemberId === memberId
    && message.isFromMe === false && message.threadIsDirect === false && route.threadId === message.chatId ? route : null;
}

/** The persisted participant input supplies the room; membership is not required. */
export async function handleHostedLinqGroupLeaveTool(input: {
  memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: HostedLeaveGroupRequest;
}): Promise<HostedLeaveGroupResponse> {
  const prisma = getPrisma();
  const unavailable = (reason: Extract<HostedLeaveGroupResponse["result"], { status: "unavailable" }>["reason"]): HostedLeaveGroupResponse =>
    ({ action: "leave_group", result: { status: "unavailable", reason } });
  // Decode outside the mutation transaction. The callback is fenced again at commit.
  await prisma.$transaction(tx => requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity));
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.request.origin.assistantInputId, memberId: input.memberId, prisma,
  });
  const route = incomingRoute(wake, input.memberId);
  if (!route) return unavailable("source_unavailable");
  const prepared = prepareHostedLinqGroupLeave(route.threadId, "assistant");
  const result = await prisma.$transaction(async tx => {
    // Match webhook admission: chat before member/runtime and route locks.
    await acquireHostedLinqChatOwnershipLockTx({ chatId: route.threadId, tx });
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    if (!await tx.hostedThreadContainer.findUnique({ where: { memberId: input.memberId }, select: { memberId: true } })) return { status: "unavailable" as const, reason: "source_unavailable" as const };
    // A validated source remains replayable after its route has been deleted.
    if (await readHostedLinqGroupLeave({ chatId: route.threadId, prisma: tx })) return { status: "already_left" as const };
    const expected = await tx.hostedThreadRoute.findFirst({ where: { channel: "linq", containerMemberId: input.memberId,
      threadIdentityLookupKey: { in: createHostedExternalThreadIdentityLookupKeyReadCandidates(route) },
      threadLookupKey: { in: createHostedExternalThreadLookupKeyReadCandidates({ ...route, accountLookupKey: route.accountLookupKey }) },
    } });
    if (!expected) return { status: "unavailable" as const, reason: "route_changed" as const };
    return leaveHostedLinqGroupTx({ expected, prepared, prisma: tx });
  });
  const departureReason = input.request.reason;
  console.info("Hosted assistant group departure outcome.", { reason: departureReason, status: result.status });
  if (result.status === "left") await requestHostedLinqGroupLeaveAfterCommit(result.postCommitLinqGroupLeave);
  if (result.status === "unavailable") return unavailable(result.reason === "active_game" ? "game_bound" : result.reason);
  return { action: "leave_group", result: { status: result.status } };
}
