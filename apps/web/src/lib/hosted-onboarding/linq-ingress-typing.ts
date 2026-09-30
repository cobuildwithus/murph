import type { PrismaClient } from "@prisma/client";

import {
  hostedRuntimeUsageMemberSelect,
  resolveHostedRuntimeAiUsageGate,
} from "../hosted-orchestration/runtime-usage-decision";
import { startHostedLinqChatTypingIndicator, stopHostedLinqChatTypingIndicator } from "./linq-client";
import { hasActiveHostedMemberAccess } from "./member-access";
import type { HostedOnboardingLinqDirectPlan } from "./webhook-provider-linq-types";

const TYPING_TIMEOUT_MS = 2_500;
const ADMISSION_BUDGET_MS = 1_000;

export type HostedLinqIngressTypingHint = {
  chatId: string;
  started: Promise<Date | null>;
  cancelPendingStart(): void;
  stop(): Promise<{ ok: boolean; status: number } | null>;
};

/** Feedback for a committed direct input, independent of runtime callback startup. */
export function startHostedLinqIngressTypingHint(input: {
  currentInboundReply: { chatId: string | null } | null;
  eventType: string | null;
  existingHint?: HostedLinqIngressTypingHint | null;
  webOwnsReply?: boolean;
  plan: HostedOnboardingLinqDirectPlan;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): HostedLinqIngressTypingHint | null {
  if (input.existingHint) return input.existingHint;
  const wake = input.plan.wakeHandoffs?.[0];
  const chatId = wake?.linqChatId?.trim();
  if (!wake || wake.source !== "linq" || !chatId
    || chatId !== input.currentInboundReply?.chatId
    || input.webOwnsReply
    || input.eventType !== "message.received"
    || input.plan.response.reason !== "wake-appended-active-member"
    || input.plan.response.duplicate || input.plan.response.ignored
    || wake.acceptedLinqDeliveryId
    || wake.wakeMailboxCheckpoint?.lane !== "conversation"
    || input.signal?.aborted) {
    return null;
  }

  let cancelled = false;
  let requested = false;
  const deadline = Date.now() + ADMISSION_BUDGET_MS;
  const started = (async (): Promise<Date | null> => {
    try {
      const member = await input.prisma.hostedMember.findUnique({
        where: { id: wake.userId },
        select: hostedRuntimeUsageMemberSelect,
      });
      if (!member || member.threadContainer || !hasActiveHostedMemberAccess(member)) return null;
      const usage = await resolveHostedRuntimeAiUsageGate({
        memberState: member,
        mode: "read_only",
        prisma: input.prisma,
        userId: wake.userId,
      });
      // Slow or cancelled admission must not start a late indicator after a reply.
      if (usage.status !== "allowed" || cancelled || input.signal?.aborted
        || Date.now() >= deadline) return null;
      requested = true;
      const result = await startHostedLinqChatTypingIndicator({ chatId, timeoutMs: TYPING_TIMEOUT_MS });
      return result.ok ? new Date() : null;
    } catch {
      // No diagnostic contains the member, chat, provider body, or raw exception.
      console.warn("Hosted Linq ingress typing hint unavailable.");
      return null;
    }
  })();
  return {
    chatId,
    started,
    cancelPendingStart() { cancelled = true; },
    async stop() {
      cancelled = true;
      await started;
      if (!requested) return null;
      try {
        return await stopHostedLinqChatTypingIndicator({ chatId, timeoutMs: TYPING_TIMEOUT_MS });
      } catch {
        console.warn("Hosted Linq ingress typing hint cleanup unavailable.");
        return null;
      }
    },
  };
}
