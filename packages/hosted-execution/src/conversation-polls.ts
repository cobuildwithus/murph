import * as z from "@murphai/contracts/zod-runtime";

const pollRef = z.string().regex(/^poll_[a-f0-9]{32}$/u);
const optionText = z.string().trim().min(1).max(100);
export const conversationPollActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    question: z.string().trim().min(1).max(300),
    anonymous: z.boolean().optional(),
    options: z.array(optionText).min(2).max(12).refine(
      (values) => new Set(values.map((value) => value.toLocaleLowerCase())).size === values.length,
      "Poll options must be distinct.",
    ),
  }).strict(),
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("read"), pollRef, voterCursor: z.string().min(1).max(256).optional() }).strict(),
  z.object({ action: z.literal("close"), pollRef }).strict(),
]);
export type ConversationPollAction = z.infer<typeof conversationPollActionSchema>;
export const conversationPollRequestSchema = z.object({
  assistantInputId: z.string().regex(/^ain_[a-f0-9]{32}$/u),
  request: conversationPollActionSchema,
}).strict();
export type ConversationPollRequest = z.infer<typeof conversationPollRequestSchema>;

export const conversationPollVoterSchema = z.object({
  kind: z.enum(["imessage_handle", "telegram_user", "telegram_chat"]),
  id: z.string().min(1).max(320),
  displayName: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  optionIndexes: z.array(z.number().int().min(0).max(99)).max(100),
  observedAt: z.string().datetime(),
}).strict();
export type ConversationPollVoter = z.infer<typeof conversationPollVoterSchema>;
export const CONVERSATION_POLL_VOTER_PAGE_SIZE = 50;

export const conversationPollSnapshotSchema = z.object({
  pollRef,
  channel: z.enum(["linq", "telegram"]),
  question: z.string().max(300),
  options: z.array(z.object({
    text: z.string().max(100),
    votes: z.number().int().nonnegative(),
  }).strict()).max(100),
  voters: z.array(conversationPollVoterSchema).max(CONVERSATION_POLL_VOTER_PAGE_SIZE).optional(),
  voterSource: z.enum(["provider_read", "received_updates", "anonymous"]).optional(),
  nextVoterCursor: z.string().max(256).nullable().optional(),
  totalVoters: z.number().int().nonnegative(),
  anonymous: z.boolean(),
  multipleAnswers: z.boolean(),
  closed: z.boolean(),
  observedAt: z.string().datetime(),
  freshness: z.enum(["provider_read", "provider_update", "creation"]),
}).strict();
export type ConversationPollSnapshot = z.infer<typeof conversationPollSnapshotSchema>;
export const conversationPollResponseSchema = z.object({
  status: z.enum(["sent", "results", "listed", "closed", "unknown"]),
  polls: z.array(conversationPollSnapshotSchema).max(10),
}).strict();
export type ConversationPollResponse = z.infer<typeof conversationPollResponseSchema>;
export interface ConversationPollTool {
  request(request: ConversationPollRequest): Promise<ConversationPollResponse>;
}

