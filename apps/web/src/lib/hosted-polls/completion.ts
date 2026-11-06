import type { ConversationPollSnapshot } from "@murphai/hosted-execution/conversation-polls";
import { parseTelegramThreadTarget } from "@murphai/messaging-ingress/telegram-webhook";
import * as z from "@murphai/contracts/zod-runtime";
import { getHostedLinqChatSummary } from "../hosted-onboarding/linq-client";
import { callHostedTelegramApi } from "../hosted-onboarding/telegram-client";

export type PollCompletion = { reason: "majority" | "all_voted" | "closed"; eligibleCount: number | null };

export function classifyPollCompletion(input: {
  closed: boolean;
  eligibleCount: number | null;
  totalVoters: number;
  votes: readonly number[];
}): PollCompletion | null {
  if (input.totalVoters === 0) return null;
  if (input.closed) return { reason: "closed", eligibleCount: input.eligibleCount };
  const count = input.eligibleCount;
  if (count === null || count < 1 || input.totalVoters > count) return null;
  const leaders = input.votes.filter((votes) => votes > count / 2);
  if (leaders.length === 1) return { reason: "majority", eligibleCount: count };
  return input.totalVoters === count ? { reason: "all_voted", eligibleCount: count } : null;
}

export async function readPollCompletion(input: {
  target: string;
  snapshot: ConversationPollSnapshot;
  voterHandlesByOption?: readonly (readonly string[])[];
}): Promise<PollCompletion | null> {
  const { snapshot } = input;
  if (snapshot.closed) return classifyPollCompletion({ closed: true, eligibleCount: null, totalVoters: snapshot.totalVoters, votes: [] });
  if (snapshot.totalVoters === 0) return null;
  if (snapshot.channel === "linq") {
    if (!input.voterHandlesByOption) return null;
    const chat = await getHostedLinqChatSummary({ chatId: input.target, timeoutMs: 8_000 });
    if (chat.handlesComplete !== true) return null;
    const eligible = new Set(chat.handles.filter((h) => !h.isMe && (h.status === null || h.status.toLowerCase() === "active")).map((h) => h.handle.toLowerCase()));
    const votes = input.voterHandlesByOption.map((handles) => new Set(handles.map((h) => h.toLowerCase()).filter((h) => eligible.has(h))));
    return classifyPollCompletion({ closed: false, eligibleCount: eligible.size, totalVoters: new Set(votes.flatMap((v) => [...v])).size, votes: votes.map((v) => v.size) });
  }
  const target = parseTelegramThreadTarget(input.target);
  if (!target) throw new TypeError("Invalid Telegram poll target.");
  const response = z.object({ ok: z.literal(true), result: z.number().int().positive().safe() }).parse(
    await callHostedTelegramApi({ method: "getChatMemberCount", body: { chat_id: target.chatId }, readJson: true }),
  );
  // Telegram cannot enumerate every member. Other bots make this conservative.
  return classifyPollCompletion({ closed: false, eligibleCount: response.result - 1, totalVoters: snapshot.totalVoters, votes: snapshot.options.map((o) => o.votes) });
}
