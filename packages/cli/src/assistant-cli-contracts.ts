import { z } from 'incur'
import { isoTimestampSchema, pathSchema } from './vault-cli-contracts.js'

export const assistantSandboxValues = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const

export const assistantApprovalPolicyValues = [
  'untrusted',
  'on-request',
  'never',
] as const

export const assistantChatProviderValues = ['codex-cli'] as const

export const assistantProviderSessionOptionsSchema = z.object({
  model: z.string().min(1).nullable(),
  sandbox: z.enum(assistantSandboxValues).nullable(),
  approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
  profile: z.string().min(1).nullable(),
  oss: z.boolean(),
})

export const assistantAliasStoreSchema = z.object({
  version: z.literal(1),
  aliases: z.record(z.string(), z.string().min(1)),
})

export const assistantSessionSchema = z.object({
  schema: z.literal('healthybob.assistant-session.v1'),
  sessionId: z.string().min(1),
  provider: z.enum(assistantChatProviderValues),
  providerSessionId: z.string().min(1).nullable(),
  providerOptions: assistantProviderSessionOptionsSchema,
  alias: z.string().min(1).nullable(),
  channel: z.string().min(1).nullable(),
  identityId: z.string().min(1).nullable(),
  participantId: z.string().min(1).nullable(),
  sourceThreadId: z.string().min(1).nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  lastTurnAt: isoTimestampSchema.nullable(),
  turnCount: z.number().int().nonnegative(),
  lastUserMessage: z.string().nullable(),
  lastAssistantMessage: z.string().nullable(),
})

export const assistantAskResultSchema = z.object({
  vault: pathSchema,
  prompt: z.string().min(1),
  response: z.string(),
  session: assistantSessionSchema,
})

export const assistantChatResultSchema = z.object({
  vault: pathSchema,
  startedAt: isoTimestampSchema,
  stoppedAt: isoTimestampSchema,
  turns: z.number().int().nonnegative(),
  session: assistantSessionSchema,
})

export const assistantSessionListResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  sessions: z.array(assistantSessionSchema),
})

export const assistantSessionShowResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  session: assistantSessionSchema,
})

export const assistantRunResultSchema = z.object({
  vault: pathSchema,
  startedAt: isoTimestampSchema,
  stoppedAt: isoTimestampSchema,
  reason: z.enum(['completed', 'signal', 'error']),
  daemonStarted: z.boolean(),
  scans: z.number().int().nonnegative(),
  considered: z.number().int().nonnegative(),
  routed: z.number().int().nonnegative(),
  noAction: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
})

export type AssistantAliasStore = z.infer<typeof assistantAliasStoreSchema>
export type AssistantSession = z.infer<typeof assistantSessionSchema>
export type AssistantAskResult = z.infer<typeof assistantAskResultSchema>
export type AssistantChatResult = z.infer<typeof assistantChatResultSchema>
export type AssistantSessionListResult = z.infer<
  typeof assistantSessionListResultSchema
>
export type AssistantSessionShowResult = z.infer<
  typeof assistantSessionShowResultSchema
>
export type AssistantRunResult = z.infer<typeof assistantRunResultSchema>
export type AssistantSandbox = (typeof assistantSandboxValues)[number]
export type AssistantApprovalPolicy =
  (typeof assistantApprovalPolicyValues)[number]
export type AssistantChatProvider =
  (typeof assistantChatProviderValues)[number]
export type AssistantProviderSessionOptions = z.infer<
  typeof assistantProviderSessionOptionsSchema
>
