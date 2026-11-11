import "server-only";
import type { RecapTranscriptPage } from "@murphai/contracts/recap-material";
import { isHostedLinqConversationMessageWake, isHostedTelegramConversationMessageWake } from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { HOSTED_MAILBOX_RETENTION_MS } from "../hosted-mailbox/projection";
import { buildHostedMailboxLiveItemWhere, decodeHostedMailboxStoredPayloads } from "../hosted-mailbox/store";
import { resolveHostedGroupMessageSenderMemberId } from "../hosted-groups/group-message-sender";
import { getPrisma } from "../prisma";

/** Called only after the bound recap's room, generation and player authority. */
export async function readRecapTranscriptPage(input: {
  containerMemberId: string; gameId: string; eventId: string;
  players: readonly { memberId: string; name: string }[];
  since: Date; until: Date; after?: string;
}): Promise<RecapTranscriptPage> {
  const db = getPrisma();
  const now = new Date();
  const retainedSince = new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  // One structural GameEvent owns the settlement watermark across pages/retries.
  const through = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
    const key = `${input.eventId}:transcript`;
    const prior = await tx.gameEvent.findUnique({ where: { commandKey: key }, select: { payload: true } });
    if (prior) {
      const value = prior.payload;
      if (value && typeof value === "object" && !Array.isArray(value) && typeof value.through === "string" && /^\d+$/u.test(value.through)) return value.through;
      throw new TypeError("Invalid recap transcript watermark.");
    }
    const last = await tx.hostedMailboxItem.findFirst({
      where: { userId: input.containerMemberId, lane: "conversation", kind: "conversation.message", occurredAt: { lte: input.until } },
      orderBy: { laneSeq: "desc" }, select: { laneSeq: true },
    });
    const value = (last?.laneSeq ?? 0n).toString();
    await tx.gameEvent.create({ data: { gameId: input.gameId, actor: "system", type: "recap_transcript", commandKey: key, payload: { v: 1, through: value } } });
    return value;
  });
  const rows = await db.hostedMailboxItem.findMany({
    where: { ...buildHostedMailboxLiveItemWhere(now), userId: input.containerMemberId,
      kind: "conversation.message", lane: "conversation",
      laneSeq: { gt: BigInt(input.after ?? "0"), lte: BigInt(through) },
      occurredAt: { gte: input.since, lte: input.until } },
    orderBy: { laneSeq: "asc" }, take: 200,
    select: { id: true, userId: true, dedupeKey: true, kind: true, lane: true, laneSeq: true, occurredAt: true,
      payloadInlineCiphertext: true, payloadSchema: true, payload: { select: { payloadCiphertext: true } } },
  });
  const decoded = await decodeHostedMailboxStoredPayloads({ prisma: db, entries: rows.map(row => ({
    dedupeKey: row.dedupeKey, kind: row.kind, lane: row.lane, laneSeq: row.laneSeq,
    mailboxItemId: row.id, occurredAt: row.occurredAt.toISOString(),
    payloadCiphertext: row.payload?.payloadCiphertext, payloadInlineCiphertext: row.payloadInlineCiphertext,
    payloadSchema: row.payloadSchema, userId: row.userId,
  })) });
  const names = new Map(input.players.map(player => [player.memberId, player.name]));
  const senders = new Map<string, string | null>();
  const messages: RecapTranscriptPage["messages"] = [];
  let incomplete = input.since < retainedSince;
  for (const [index, payload] of decoded.entries()) {
    if (!payload) { incomplete = true; continue; }
    const wake = parseHostedExecutionWake(payload);
    if (wake.kind !== "conversation.message") continue;
    const route = wake.message.routeAuthority;
    if (!route || route.containerMemberId !== input.containerMemberId) continue;
    let sender: string;
    let text: string;
    if (isHostedLinqConversationMessageWake(wake)) {
      if (wake.message.linqMessage.isFromMe || wake.message.linqMessage.threadIsDirect || route.channel !== "linq" || route.threadId !== wake.message.linqMessage.chatId) continue;
      sender = `linq:${wake.message.linqMessage.from}`;
      text = wake.message.linqMessage.parts.flatMap(part => part.type === "text" ? [part.value] : []).join("\n");
    } else if (isHostedTelegramConversationMessageWake(wake)) {
      if (wake.message.telegramMessage.threadIsDirect || route.channel !== "telegram" || route.threadId !== wake.message.telegramMessage.threadId) continue;
      sender = `telegram:${wake.message.telegramMessage.from ?? ""}`;
      text = wake.message.telegramMessage.text?.trim() ?? "";
    } else continue;
    // Bounded by the authorized room's senders; resolve sequentially, never one transaction per message.
    if (!senders.has(sender)) senders.set(sender, await resolveHostedGroupMessageSenderMemberId({ prisma: db, routeAuthority: route, wake }));
    const member = senders.get(sender);
    const playerName = member ? names.get(member) : undefined;
    const row = rows[index]!;
    if (playerName && text) messages.push({ id: row.id, source: "player", playerName, text, at: row.occurredAt.toISOString(), laneSeq: row.laneSeq.toString() });
  }
  return { messages, next: rows.length === 200 ? rows.at(-1)!.laneSeq.toString() : null,
    through, since: input.since.toISOString(), until: input.until.toISOString(), retainedSince: retainedSince.toISOString(), incomplete };
}

/** Quote validation reads the same canonical pages; local exports grant no evidence. */
export async function readRecapTranscriptForValidation(input: Omit<Parameters<typeof readRecapTranscriptPage>[0], "after">) {
  const messages: RecapTranscriptPage["messages"] = [];
  let after: string | undefined;
  for (let page = 0; page < 500; page += 1) {
    const result = await readRecapTranscriptPage({ ...input, after });
    messages.push(...result.messages);
    if (result.next === null) return messages;
    after = result.next;
  }
  throw new RangeError("Recap transcript exceeds the bounded export; use canonical posts without chat quotes.");
}
