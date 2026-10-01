import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import type { HostedConversationPoll } from "@prisma/client";
import { CONVERSATION_POLL_VOTER_PAGE_SIZE, conversationPollVoterSchema, type ConversationPollSnapshot, type ConversationPollVoter } from "@murphai/hosted-execution/conversation-polls";
import { getPrisma } from "../prisma";
import { createHostedTelegramUserLookupKey, createHostedTelegramUserLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { openHostedUserSecureBoxStrings, sealHostedUserSecureBoxString } from "../hosted-crypto/secure-box";

const telegramUser = z.object({ id: z.number().int().safe(), first_name: z.string().max(128), last_name: z.string().max(128).optional(), username: z.string().max(64).optional() });
const telegramChat = z.object({ id: z.number().int().safe(), title: z.string().max(256).optional(), username: z.string().max(64).optional() });
export const telegramPollAnswerSchema = z.object({
  poll_id: z.string().min(1).max(200),
  user: telegramUser.optional(), voter_chat: telegramChat.optional(),
  option_ids: z.array(z.number().int().min(0).max(99)).max(100),
}).refine((answer) => Boolean(answer.user) !== Boolean(answer.voter_chat), "Expected one poll voter.");

type PollIdentity = Pick<HostedConversationPoll, "id" | "memberId">;
function voteAad(pollId: string, voterKey: string) {
  return { field: "vote", purpose: "conversation-poll", rowId: `${pollId}:${voterKey}`, table: "hosted_conversation_poll_vote" };
}

export async function recordTelegramPollAnswer(row: HostedConversationPoll, answer: z.infer<typeof telegramPollAnswerSchema>, updateId: number) {
  const actor = answer.user ?? answer.voter_chat!;
  const kind = answer.user ? "telegram_user" : "telegram_chat";
  const identity = `${kind}:${actor.id}`;
  const prisma = getPrisma();
  const existing = await prisma.hostedConversationPollVote.findFirst({
    where: { pollId: row.id, voterKey: { in: createHostedTelegramUserLookupKeyReadCandidates(identity) } },
    select: { voterKey: true, lastUpdateId: true },
  });
  if (existing && existing.lastUpdateId >= BigInt(updateId)) return;
  const voterKey = existing?.voterKey ?? createHostedTelegramUserLookupKey(identity);
  if (!voterKey) throw new TypeError("Invalid poll voter.");
  const displayName = answer.user
    ? [answer.user.first_name, answer.user.last_name].filter(Boolean).join(" ").slice(0, 256)
    : answer.voter_chat?.title;
  const voter: ConversationPollVoter = {
    kind, id: String(actor.id), ...(displayName ? { displayName } : {}),
    ...(actor.username ? { username: actor.username } : {}),
    optionIndexes: [...new Set(answer.option_ids)], observedAt: new Date().toISOString(),
  };
  const voteEncrypted = await sealHostedUserSecureBoxString({
    aad: voteAad(row.id, voterKey), lane: "hosted-member-private-field", prisma,
    scope: "conversation-poll", userId: row.memberId, value: JSON.stringify(voter),
  });
  if (!voteEncrypted) throw new Error("Poll vote encryption failed.");
  const data = { voteEncrypted, lastUpdateId: BigInt(updateId), hasVote: voter.optionIndexes.length > 0 };
  const inserted = await prisma.hostedConversationPollVote.createMany({ data: [{ pollId: row.id, voterKey, ...data }], skipDuplicates: true });
  if (inserted.count === 0) {
    // Each voter has an independent sequence; another voter's newer update must
    // not discard this answer. Retractions keep their sequence as tombstones.
    await prisma.hostedConversationPollVote.updateMany({ where: { pollId: row.id, voterKey, lastUpdateId: { lt: BigInt(updateId) } }, data });
  }
}

export async function withTelegramPollVoters(row: PollIdentity, snapshot: ConversationPollSnapshot, voterCursor?: string): Promise<ConversationPollSnapshot> {
  if (snapshot.anonymous) return { ...snapshot, voters: [], voterSource: "anonymous", nextVoterCursor: null };
  const prisma = getPrisma();
  const rows = await prisma.hostedConversationPollVote.findMany({
    where: { pollId: row.id, hasVote: true, ...(voterCursor ? { voterKey: { gt: voterCursor } } : {}) },
    orderBy: { voterKey: "asc" }, take: CONVERSATION_POLL_VOTER_PAGE_SIZE + 1,
    select: { voterKey: true, voteEncrypted: true },
  });
  const page = rows.slice(0, CONVERSATION_POLL_VOTER_PAGE_SIZE);
  const values = await openHostedUserSecureBoxStrings({
    entries: page.map((vote) => ({ aad: voteAad(row.id, vote.voterKey), scope: "conversation-poll", userId: row.memberId, value: vote.voteEncrypted })),
    lane: "hosted-member-private-field", prisma,
  });
  return {
    ...snapshot, voters: values.map((value) => conversationPollVoterSchema.parse(JSON.parse(value ?? "null"))),
    voterSource: "received_updates",
    nextVoterCursor: rows.length > CONVERSATION_POLL_VOTER_PAGE_SIZE ? page.at(-1)!.voterKey : null,
  };
}
