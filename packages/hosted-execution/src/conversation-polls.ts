import * as z from "@murphai/contracts/zod-runtime";

const pollRef = z.string().regex(/^poll_[a-f0-9]{32}$/u);
const optionText = z.string().trim().min(1).max(100);
export const conversationPollActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    question: z.string().trim().min(1).max(300),
    options: z.array(optionText).min(2).max(12).refine(
      (values) => new Set(values.map((value) => value.toLocaleLowerCase())).size === values.length,
      "Poll options must be distinct.",
    ),
  }).strict(),
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("read"), pollRef }).strict(),
  z.object({ action: z.literal("close"), pollRef }).strict(),
]);
export type ConversationPollAction = z.infer<typeof conversationPollActionSchema>;
export const conversationPollRequestSchema = z.object({
  assistantInputId: z.string().regex(/^ain_[a-f0-9]{32}$/u),
  request: conversationPollActionSchema,
}).strict();
export type ConversationPollRequest = z.infer<typeof conversationPollRequestSchema>;

export const conversationPollSnapshotSchema = z.object({
  pollRef,
  channel: z.enum(["linq", "telegram"]),
  question: z.string().max(300),
  options: z.array(z.object({
    text: z.string().max(100),
    votes: z.number().int().nonnegative(),
  }).strict()).max(100),
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

