import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import type { HostedConversationPoll } from "@prisma/client";
import { conversationPollSnapshotSchema } from "@murphai/hosted-execution/conversation-polls";
import { openHostedUserSecureBoxString, sealHostedUserSecureBoxString } from "../hosted-crypto/secure-box";
import { getPrisma } from "../prisma";

export const pollDefinitionSchema = z.object({
  schema: z.literal("murph.conversation-poll.v1"),
  target: z.string().min(1),
  question: z.string(),
  options: z.array(z.string()),
}).strict();
export const pollResultSchema = z.object({
  schema: z.literal("murph.conversation-poll-result.v1"),
  messageId: z.string().min(1),
  providerPollId: z.string().nullable(),
  snapshot: conversationPollSnapshotSchema,
}).strict();
export type PollDefinition = z.infer<typeof pollDefinitionSchema>;
export type PollResult = z.infer<typeof pollResultSchema>;
type PollIdentity = Pick<HostedConversationPoll, "id" | "memberId">;

function codecInput(row: PollIdentity, field: "definition" | "result") {
  return {
    aad: { field, purpose: "conversation-poll", rowId: row.id, table: "hosted_conversation_poll" },
    lane: "hosted-member-private-field" as const,
    prisma: getPrisma(),
    scope: "conversation-poll",
    userId: row.memberId,
  };
}
export async function encryptPoll(row: PollIdentity, field: "definition" | "result", value: PollDefinition | PollResult) {
  const encrypted = await sealHostedUserSecureBoxString({ ...codecInput(row, field), value: JSON.stringify(value) });
  if (!encrypted) throw new Error("Poll encryption failed.");
  return encrypted;
}
export async function readPollDefinition(row: HostedConversationPoll): Promise<PollDefinition> {
  const text = await openHostedUserSecureBoxString({ ...codecInput(row, "definition"), value: row.definitionEncrypted });
  return pollDefinitionSchema.parse(JSON.parse(text ?? "null"));
}
export async function readPollResult(row: HostedConversationPoll): Promise<PollResult | null> {
  if (!row.resultEncrypted) return null;
  const text = await openHostedUserSecureBoxString({ ...codecInput(row, "result"), value: row.resultEncrypted });
  return pollResultSchema.parse(JSON.parse(text ?? "null"));
}

