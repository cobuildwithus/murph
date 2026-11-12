import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { readHostedLinqGroupLeave, requestHostedLinqGroupLeaveAfterCommit, type HostedLinqGroupLeaveTarget } from "../hosted-routing/linq-group-leave";
import type { HostedLinqWebhookEvent } from "./linq-webhook";
import type { HostedOnboardingLinqWebhookResponse } from "./webhook-provider-linq-types";

export async function readHostedLinqGroupLeftWebhookResponse(event: HostedLinqWebhookEvent, prisma?: PrismaClient): Promise<HostedOnboardingLinqWebhookResponse | null> {
  const data = event.data;
  if (!data || typeof data !== "object") return null;
  const chat = "chat" in data ? data.chat : null;
  // Only groups are ever left. A verified 1:1 flag already decides the
  // audience elsewhere, so direct replies skip this read.
  if (chat && typeof chat === "object" && "is_group" in chat && chat.is_group === false) return null;
  const chatId = chat && typeof chat === "object" && "id" in chat ? chat.id
    : "chat_id" in data ? data.chat_id : null;
  if (typeof chatId !== "string" || !chatId.trim()) return null;
  return await readHostedLinqGroupLeave({ chatId, prisma: prisma ?? getPrisma() })
    ? { ok: true, ignored: true, reason: "group-left" } : null;
}

export function scheduleHostedLinqGroupLeaveAfterCommit(input: {
  target?: HostedLinqGroupLeaveTarget;
  scheduleAfterResponse?: (task: () => Promise<void>) => void;
}): void {
  const target = input.target;
  if (!target) return;
  const task = async () => { await requestHostedLinqGroupLeaveAfterCommit(target); };
  if (input.scheduleAfterResponse) input.scheduleAfterResponse(task);
  else void task();
}
