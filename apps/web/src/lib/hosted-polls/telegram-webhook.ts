import "server-only";
import type { HostedConversationPoll } from "@prisma/client";
import * as z from "@murphai/contracts/zod-runtime";
import { getPrisma } from "../prisma";
import { createHostedTelegramPollLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { telegramPollSchema, telegramPollSnapshot } from "./provider";
import { maybeNotifyPollResult } from "./notification";
import { encryptPoll, readPollResult, type PollResult } from "./store";
import { recordTelegramPollAnswer, telegramPollAnswerSchema } from "./votes";

async function findTelegramPoll(pollId: string) {
  const prisma = getPrisma();
  const where = { channel: "telegram", providerPollKey: { in: createHostedTelegramPollLookupKeyReadCandidates(pollId) } };
  const row = await prisma.hostedConversationPoll.findFirst({ where });
  if (row) return row;
  const pending = await prisma.hostedConversationPoll.findFirst({
    where: { channel: "telegram", resultEncrypted: null, dispatchedAt: { gte: new Date(Date.now() - 120_000) } },
    select: { id: true },
  });
  if (pending) throw hostedOnboardingError({ code: "HOSTED_POLL_BINDING_PENDING", message: "Poll creation is still being recorded.", httpStatus: 503, retryable: true });
  // The receipt can commit between the first lookup and the pending lookup.
  // Recheck its binding before acknowledging an update as unowned.
  return prisma.hostedConversationPoll.findFirst({ where });
}

// Called only after Telegram's webhook secret has been verified.
export async function handleHostedTelegramPollWebhook(rawBody: string): Promise<{ ok: true; ignored?: true } | null> {
  const raw: unknown = JSON.parse(rawBody);
  if (typeof raw !== "object" || raw === null || (!("poll" in raw) && !("poll_answer" in raw))) return null;
  const updateId = z.object({ update_id: z.number().int().nonnegative().safe() }).parse(raw).update_id;
  const answer = "poll_answer" in raw ? telegramPollAnswerSchema.parse(raw.poll_answer) : null;
  const poll = "poll" in raw ? telegramPollSchema.parse(raw.poll) : null;
  const row = await findTelegramPoll(answer ? answer.poll_id : poll!.id);
  if (!row) return { ok: true, ignored: true };
  const previous = await readPollResult(row);
  if (!previous || previous.providerPollId !== (answer ? answer.poll_id : poll!.id)) throw new TypeError("Poll update binding mismatch.");
  if (answer) {
    if (previous.snapshot.anonymous) return { ok: true, ignored: true };
    if (answer.option_ids.some((index) => index >= previous.snapshot.options.length)) throw new TypeError("Poll answer option is out of range.");
    // Answer delivery is independent of tally delivery, including after close.
    await recordTelegramPollAnswer(row, answer, updateId);
    return { ok: true as const };
  }
  return updateTelegramPollTally(row, previous, poll, updateId);
}

async function updateTelegramPollTally(row: HostedConversationPoll, previous: PollResult, poll: unknown, updateId: number) {
  if (row.closedAt || (row.lastUpdateId !== null && row.lastUpdateId >= BigInt(updateId))) {
    await maybeNotifyPollResult(row);
    return { ok: true as const };
  }
  const snapshot = telegramPollSnapshot(poll, row.id, "provider_update");
  const resultEncrypted = await encryptPoll(row, "result", { ...previous, snapshot });
  const updated = await getPrisma().hostedConversationPoll.updateMany({
    where: { id: row.id, closedAt: null, OR: [{ lastUpdateId: null }, { lastUpdateId: { lt: BigInt(updateId) } }] },
    data: { resultEncrypted, lastUpdateId: BigInt(updateId), ...(snapshot.closed ? { closedAt: new Date() } : {}) },
  });
  if (updated.count === 1) await maybeNotifyPollResult({ ...row, resultEncrypted, lastUpdateId: BigInt(updateId), closedAt: snapshot.closed ? new Date() : null });
  return { ok: true as const };
}
