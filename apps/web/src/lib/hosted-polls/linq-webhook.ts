import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import type { HostedLinqWebhookEvent } from "../hosted-onboarding/linq-webhook";
import { createHostedLinqMessageLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import { callLinqPoll } from "./provider";
import { encryptPoll, readPollDefinition, readPollResult } from "./store";
import { maybeNotifyPollResult, recoverPollResultWake } from "./notification";

const voteEvent = z.object({ message_id: z.string().uuid(), chat: z.object({ id: z.string().uuid() }), service: z.literal("iMessage") });

// The caller verifies Linq's webhook signature before reaching this boundary.
export async function handleHostedLinqPollWebhook(event: HostedLinqWebhookEvent): Promise<boolean> {
  if (event.event_type !== "poll.vote.added" && event.event_type !== "poll.vote.removed") return false;
  const data = voteEvent.parse(event.data);
  const prisma = getPrisma();
  const where = { channel: "linq", providerPollKey: { in: createHostedLinqMessageLookupKeyReadCandidates(data.message_id) } };
  let row = await prisma.hostedConversationPoll.findFirst({ where });
  if (!row) {
    const pending = await prisma.hostedConversationPoll.findFirst({ where: { channel: "linq", resultEncrypted: null, dispatchedAt: { gte: new Date(Date.now() - 120_000) } }, select: { id: true } });
    if (pending) throw hostedOnboardingError({ code: "HOSTED_POLL_BINDING_PENDING", message: "Poll creation is still being recorded.", httpStatus: 503, retryable: true });
    row = await prisma.hostedConversationPoll.findFirst({ where });
  }
  if (!row) return true;
  const definition = await readPollDefinition(row);
  const previous = await readPollResult(row);
  if (definition.target !== data.chat.id || previous?.messageId !== data.message_id) throw new TypeError("Poll event binding mismatch.");
  if (row.resultNotifiedAt) { await recoverPollResultWake(row); return true; }
  // Fetch current truth rather than replaying potentially reordered vote deltas.
  const fresh = await callLinqPoll({ action: "read", chatId: definition.target, messageId: previous.messageId, pollRef: row.id, question: definition.question });
  const resultEncrypted = await encryptPoll(row, "result", { ...previous, snapshot: fresh.snapshot });
  const updated = await prisma.hostedConversationPoll.updateMany({ where: { id: row.id, resultEncrypted: row.resultEncrypted, resultNotifiedAt: null }, data: { resultEncrypted } });
  if (updated.count !== 1) throw hostedOnboardingError({ code: "HOSTED_POLL_UPDATE_RETRY", message: "Poll results changed during processing.", httpStatus: 503, retryable: true });
  await maybeNotifyPollResult({ ...row, resultEncrypted }, fresh.voterHandlesByOption);
  return true;
}
