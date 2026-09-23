import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import "server-only";
import { createHash } from "node:crypto";
import type { HostedConversationPoll } from "@prisma/client";
import type { ConversationPollRequest, ConversationPollResponse } from "@murphai/hosted-execution/conversation-polls";
import { getPrisma } from "../prisma";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedTelegramPollLookupKey,
  createHostedLinqMessageLookupKey,
} from "../hosted-onboarding/contact-privacy";
import { sendHostedLinqChatMessage } from "../hosted-onboarding/linq-client";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { authorizePollConversation, type PollRoute } from "./authority";
import { withTelegramPollVoters } from "./votes";
import { callLinqPoll, callTelegramPoll } from "./provider";
import { encryptPoll, readPollDefinition, readPollResult, type PollResult } from "./store";

export async function handleHostedConversationPollTool(input: {
  memberId: string;
  runtimeIdentity: HostedRuntimeIdentity | null;
  request: ConversationPollRequest;
}): Promise<ConversationPollResponse> {
  const route = await authorizePollConversation(input);
  const prisma = getPrisma();
  const action = input.request.request;
  if (action.action === "create") return createPoll(input, route);
  const conversationKeys = createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: route.channel, threadId: route.target });
  const rows = await prisma.hostedConversationPoll.findMany({
    where: { memberId: input.memberId, channel: route.channel, conversationKey: { in: conversationKeys },
      ...(action.action === "list" ? {} : { id: action.pollRef }) },
    orderBy: { createdAt: "desc" }, take: action.action === "list" ? 10 : 1,
  });
  if (action.action === "list") {
    const polls = [];
    for (const row of rows) {
      const result = await readPollResult(row);
      if (result) polls.push(result.snapshot);
    }
    return { status: "listed", polls };
  }
  const row = rows[0];
  if (!row) throw new TypeError("Poll not found in this conversation. Use list to find its pollRef.");
  const definition = await readPollDefinition(row);
  if (definition.target !== route.target) throw new TypeError("Poll conversation changed.");
  const result = await readPollResult(row);
  if (!result) return { status: "unknown", polls: [] };
  if (action.action === "close") {
    if (route.channel !== "telegram") throw new TypeError("iMessage does not support closing polls.");
    if (result.snapshot.closed) return { status: "closed", polls: [result.snapshot] };
    await authorizePollConversation(input);
    const closed = await callTelegramPoll({ action: "close", target: route.target, pollRef: row.id, messageId: result.messageId });
    if (closed.providerPollId !== result.providerPollId || !closed.snapshot.closed) throw new TypeError("Poll close result mismatch.");
    const next = { ...result, snapshot: closed.snapshot };
    const encrypted = await encryptPoll(row, "result", next);
    await prisma.hostedConversationPoll.update({ where: { id: row.id }, data: { resultEncrypted: encrypted, closedAt: new Date() } });
    return { status: "closed", polls: [closed.snapshot] };
  }
  if (action.action === "vote") return voteInPoll(input, route, { pollRef: row.id, question: definition.question, messageId: result.messageId });
  if (route.channel === "telegram") return { status: "results", polls: [await withTelegramPollVoters(row, result.snapshot, action.voterCursor)] };
  const fresh = await callLinqPoll({ action: "read", chatId: route.target, pollRef: row.id, question: definition.question, messageId: result.messageId, voterCursor: action.voterCursor });
  return { status: "results", polls: [fresh.snapshot] };
}

async function voteInPoll(input: Parameters<typeof handleHostedConversationPollTool>[0], route: PollRoute, poll: { pollRef: string; question: string; messageId: string }): Promise<ConversationPollResponse> {
  const action = input.request.request;
  if (action.action !== "vote") throw new TypeError("Expected poll vote.");
  if (route.channel !== "linq") throw new TypeError("Telegram bots cannot vote. State a pick in text without changing the tally.");
  const fresh = await callLinqPoll({ action: "read", chatId: route.target, ...poll });
  const optionId = fresh.optionIds[action.optionIndex];
  if (!optionId) throw new TypeError("Poll option is unavailable. Read the current poll before voting.");
  const currentRoute = await authorizePollConversation(input);
  if (currentRoute.channel !== route.channel || currentRoute.target !== route.target) throw new TypeError("Poll conversation changed.");
  const submitted = await callLinqPoll({ action: "vote", chatId: route.target, ...poll, optionId, operation: action.operation });
  return { status: "vote_submitted", polls: [submitted.snapshot] };
}

async function createPoll(input: { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: ConversationPollRequest }, route: PollRoute): Promise<ConversationPollResponse> {
  const action = input.request.request;
  if (action.action !== "create") throw new TypeError("Expected poll creation.");
  if (route.channel === "linq" && action.anonymous === true) throw new TypeError("iMessage polls cannot be anonymous.");
  const prisma = getPrisma();
  // One logical creation per accepted input, including retries with reworded arguments.
  const id = "poll_" + createHash("sha256").update(JSON.stringify([input.memberId, input.request.assistantInputId])).digest("hex").slice(0, 32);
  const definition = { schema: "murph.conversation-poll.v1" as const, target: route.target, question: action.question, options: action.options, anonymous: route.channel === "telegram" ? action.anonymous ?? true : false };
  const encrypted = await encryptPoll({ id, memberId: input.memberId }, "definition", definition);
  const conversationKey = createHostedExternalThreadIdentityLookupKey({ channel: route.channel, threadId: route.target });
  if (!conversationKey) throw new TypeError("Invalid poll conversation.");
  const row = await prisma.$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
    return tx.hostedConversationPoll.upsert({
      where: { id }, update: {}, create: {
        id, memberId: input.memberId, channel: route.channel, conversationKey, definitionEncrypted: encrypted,
      },
    });
  });
  const original = await readPollDefinition(row);
  if (row.channel !== route.channel || JSON.stringify(original) !== JSON.stringify(definition)) throw new TypeError("This input already created a different poll. Do not send another.");
  const existing = await readPollResult(row);
  if (existing) return { status: "sent", polls: [existing.snapshot] };
  await authorizePollConversation(input);
  const claim = await prisma.$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
    return tx.hostedConversationPoll.updateMany({ where: { id, dispatchedAt: null }, data: { dispatchedAt: new Date() } });
  });
  if (claim.count !== 1) return { status: "unknown", polls: [] };
  return dispatchPoll(row, definition, route);
}

async function dispatchPoll(row: HostedConversationPoll, definition: { question: string; options: string[]; anonymous: boolean }, route: PollRoute): Promise<ConversationPollResponse> {
  let result: PollResult;
  let providerPollKey: string | null = null;
  try {
    if (route.channel === "linq") {
      await sendHostedLinqChatMessage({ chatId: route.target, message: definition.question, idempotencyKey: row.id + ":question" });
      const created = await callLinqPoll({ action: "create", chatId: route.target, pollRef: row.id, ...definition });
      result = { schema: "murph.conversation-poll-result.v1", messageId: created.messageId, providerPollId: null, snapshot: created.snapshot };
      providerPollKey = createHostedLinqMessageLookupKey(created.messageId);
    } else {
      const created = await callTelegramPoll({ action: "create", target: route.target, pollRef: row.id, ...definition });
      providerPollKey = createHostedTelegramPollLookupKey(created.providerPollId);
      result = { schema: "murph.conversation-poll-result.v1", messageId: created.messageId, providerPollId: created.providerPollId, snapshot: created.snapshot };
    }
    const resultEncrypted = await encryptPoll(row, "result", result);
    await getPrisma().hostedConversationPoll.update({ where: { id: row.id }, data: { resultEncrypted, providerPollKey } });
    return { status: "sent", polls: [result.snapshot] };
  } catch {
    // The claim is retained even when acknowledgement/persistence fails.
    return { status: "unknown", polls: [] };
  }
}
