import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import { getPrisma } from "../prisma";
import { createHostedTelegramPollLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { telegramPollSchema, telegramPollSnapshot } from "./provider";
import { encryptPoll, readPollResult } from "./store";

// Called only after Telegram's webhook secret has been verified.
export async function handleHostedTelegramPollWebhook(rawBody: string): Promise<{ ok: true; ignored?: true } | null> {
  const raw: unknown = JSON.parse(rawBody);
  if (typeof raw !== "object" || raw === null || !("poll" in raw)) return null;
  const update = z.object({ update_id: z.number().int().nonnegative(), poll: telegramPollSchema }).parse(raw);
  const prisma = getPrisma();
  const row = await prisma.hostedConversationPoll.findFirst({
    where: { channel: "telegram", providerPollKey: { in: createHostedTelegramPollLookupKeyReadCandidates(update.poll.id) } },
  });
  if (!row) {
    // A vote can arrive before sendPoll's response is persisted. Ask Telegram
    // to retry while a recent creation could still bind this poll.
    const pending = await prisma.hostedConversationPoll.findFirst({
      where: { channel: "telegram", resultEncrypted: null, dispatchedAt: { gte: new Date(Date.now() - 120_000) } },
      select: { id: true },
    });
    if (pending) throw hostedOnboardingError({ code: "HOSTED_POLL_BINDING_PENDING", message: "Poll creation is still being recorded.", httpStatus: 503, retryable: true });
    return { ok: true, ignored: true };
  }
  if (row.closedAt || (row.lastUpdateId !== null && row.lastUpdateId >= BigInt(update.update_id))) return { ok: true };
  const previous = await readPollResult(row);
  if (!previous || previous.providerPollId !== update.poll.id) throw new TypeError("Poll update binding mismatch.");
  const snapshot = telegramPollSnapshot(update.poll, row.id, "provider_update");
  const resultEncrypted = await encryptPoll(row, "result", { ...previous, snapshot });
  await prisma.hostedConversationPoll.updateMany({
    where: { id: row.id, closedAt: null, OR: [{ lastUpdateId: null }, { lastUpdateId: { lt: BigInt(update.update_id) } }] },
    data: { resultEncrypted, lastUpdateId: BigInt(update.update_id), ...(snapshot.closed ? { closedAt: new Date() } : {}) },
  });
  return { ok: true };
}

