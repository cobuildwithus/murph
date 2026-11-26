import "server-only";

import type { Prisma } from "@prisma/client";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { HEALTH_WIN_TEXT_MAILBOX_PREFIX, parseHealthWinTextKey } from "./nudge-delivery";

const DAY_MS = 86_400_000;
const PAUSE_DAYS = 28;

export async function isHealthWinTextPaused(tx: Prisma.TransactionClient, memberId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - PAUSE_DAYS * DAY_MS);
  // A wake can precede its acceptance by the dispatch window. One extra day
  // covers that edge, even when the member changes time zones. Expired wakes
  // retain their structural keys for 30 days.
  const wakes = await tx.hostedMailboxItem.findMany({
    where: {
      userId: memberId, kind: "assistant.notification.requested", lane: "system",
      dedupeKey: { startsWith: HEALTH_WIN_TEXT_MAILBOX_PREFIX },
      createdAt: { gte: new Date(since.getTime() - DAY_MS), lte: now },
    },
    select: { dedupeKey: true }, orderBy: { createdAt: "desc" }, take: PAUSE_DAYS + 4,
  });
  const keys = wakes.flatMap(({ dedupeKey }) => {
    const key = parseHealthWinTextKey(dedupeKey);
    if (key?.memberId !== memberId || key.mailbox !== dedupeKey) return [];
    const lookupKey = createHostedLinqDeliveryIdempotencyLookupKey(key.base);
    return lookupKey ? [lookupKey] : [];
  });
  if (keys.length < 3) return false;
  // The parent delivery records acceptance for the text and trailing link.
  // A link bubble or its fallback is never a second unanswered win.
  const receipts = await tx.hostedLinqDelivery.findMany({
    where: { idempotencyKey: { in: keys }, acceptedAt: { gte: since, lte: now } },
    select: { acceptedAt: true }, orderBy: { acceptedAt: "desc" }, take: 3,
  });
  const oldest = receipts[2]?.acceptedAt;
  if (!oldest) return false;
  const afterSend = { gte: oldest, lte: now };
  const reply = await tx.hostedMailboxItem.findFirst({
    where: { userId: memberId, kind: "conversation.message", lane: "conversation", occurredAt: afterSend },
    select: { id: true },
  });
  if (reply) return false;
  const post = await tx.healthPost.findFirst({
    where: { authorMemberId: memberId, createdAt: afterSend }, select: { id: true },
  });
  return !post;
}
