import * as z from "@murphai/contracts/zod-runtime";

const identity = z.string().min(1).max(256);
const source = { action: z.literal("game_chat_bootstrap"), gameId: identity, eventId: identity };
/** Host-only effect control; never a model tool or a caller-selected audience. */
export const hostedGameChatBootstrapRequestSchema = z.discriminatedUnion("operation", [
  z.object({ ...source, operation: z.literal("recover") }).strict(),
  z.object({ ...source, operation: z.literal("send"), text: z.string().trim().min(1).max(10_000) }).strict(),
]);
export const hostedGameChatBootstrapResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("needs_message") }).strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
  z.object({
    status: z.literal("sent"), message: z.string().min(1), deliveryId: identity,
    chatId: identity, accountLookupKey: identity, providerMessageId: identity.nullable(), acceptedAt: z.iso.datetime(),
  }).strict(),
]);
export const hostedGameChatBootstrapResponseSchema = z.object({
  action: z.literal("game_chat_bootstrap"), result: hostedGameChatBootstrapResultSchema,
}).strict();
export type HostedGameChatBootstrapRequest = z.infer<typeof hostedGameChatBootstrapRequestSchema>;
export type HostedGameChatBootstrapResponse = z.infer<typeof hostedGameChatBootstrapResponseSchema>;
export type HostedGameChatBootstrapResult = z.infer<typeof hostedGameChatBootstrapResultSchema>;
