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
export const assistantReasoningEffortValues = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export const assistantChatProviderValues = ['codex-cli'] as const
export const assistantChannelDeliveryTargetKindValues = [
  'explicit',
  'participant',
  'thread',
] as const
export const assistantBindingDeliveryKindValues = [
  'participant',
  'thread',
] as const
export const assistantTranscriptEntryKindValues = [
  'user',
  'assistant',
  'error',
] as const
export const assistantMemoryRecordKindValues = [
  'long-term',
  'daily',
] as const
export const assistantMemoryQueryScopeValues = [
  'long-term',
  'daily',
  'all',
] as const
export const assistantMemoryWriteScopeValues = [
  'long-term',
  'daily',
  'both',
] as const
export const assistantMemoryLongTermSectionValues = [
  'Identity',
  'Preferences',
  'Standing instructions',
  'Health context',
] as const
export const assistantMemoryVisibleSectionValues = [
  ...assistantMemoryLongTermSectionValues,
  'Notes',
] as const

export const assistantProviderSessionOptionsSchema = z.object({
  model: z.string().min(1).nullable(),
  reasoningEffort: z.string().min(1).nullable().default(null),
  sandbox: z.enum(assistantSandboxValues).nullable(),
  approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
  profile: z.string().min(1).nullable(),
  oss: z.boolean(),
})

export const assistantAliasStoreSchema = z.object({
  version: z.literal(2),
  aliases: z.record(z.string(), z.string().min(1)),
  conversationKeys: z.record(z.string(), z.string().min(1)),
})

export const assistantBindingDeliverySchema = z.object({
  kind: z.enum(assistantBindingDeliveryKindValues),
  target: z.string().min(1),
})

export const assistantSessionBindingSchema = z.object({
  conversationKey: z.string().min(1).nullable(),
  channel: z.string().min(1).nullable(),
  identityId: z.string().min(1).nullable(),
  actorId: z.string().min(1).nullable(),
  threadId: z.string().min(1).nullable(),
  threadIsDirect: z.boolean().nullable(),
  delivery: assistantBindingDeliverySchema.nullable(),
})

export const assistantSessionSchema = z.object({
  schema: z.literal('healthybob.assistant-session.v2'),
  sessionId: z.string().min(1),
  provider: z.enum(assistantChatProviderValues),
  providerSessionId: z.string().min(1).nullable(),
  providerOptions: assistantProviderSessionOptionsSchema,
  alias: z.string().min(1).nullable(),
  binding: assistantSessionBindingSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  lastTurnAt: isoTimestampSchema.nullable(),
  turnCount: z.number().int().nonnegative(),
})

export const assistantTranscriptEntrySchema = z.object({
  schema: z.literal('healthybob.assistant-transcript-entry.v1'),
  kind: z.enum(assistantTranscriptEntryKindValues),
  text: z.string(),
  createdAt: isoTimestampSchema,
})

export const assistantChannelDeliverySchema = z.object({
  channel: z.string().min(1),
  target: z.string().min(1),
  targetKind: z.enum(assistantChannelDeliveryTargetKindValues),
  sentAt: isoTimestampSchema,
  messageLength: z.number().int().nonnegative(),
})

export const assistantDeliveryErrorSchema = z.object({
  code: z.string().min(1).nullable(),
  message: z.string().min(1),
})

export const assistantMemoryRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(assistantMemoryRecordKindValues),
  section: z.enum(assistantMemoryVisibleSectionValues),
  text: z.string().min(1),
  recordedAt: z.string().min(1).nullable(),
  sourcePath: pathSchema,
  sourceLine: z.number().int().positive(),
})

export const assistantMemorySearchHitSchema = assistantMemoryRecordSchema.extend({
  score: z.number().int().nonnegative(),
})

export const assistantAskResultSchema = z.object({
  vault: pathSchema,
  prompt: z.string().min(1),
  response: z.string(),
  session: assistantSessionSchema,
  delivery: assistantChannelDeliverySchema.nullable(),
  deliveryError: assistantDeliveryErrorSchema.nullable(),
})

export const assistantChatResultSchema = z.object({
  vault: pathSchema,
  startedAt: isoTimestampSchema,
  stoppedAt: isoTimestampSchema,
  turns: z.number().int().nonnegative(),
  session: assistantSessionSchema,
})

export const assistantDeliverResultSchema = z.object({
  vault: pathSchema,
  message: z.string().min(1),
  session: assistantSessionSchema,
  delivery: assistantChannelDeliverySchema,
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

export const assistantMemorySearchResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  query: z.string().min(1).nullable(),
  scope: z.enum(assistantMemoryQueryScopeValues),
  section: z.enum(assistantMemoryVisibleSectionValues).nullable(),
  results: z.array(assistantMemorySearchHitSchema),
})

export const assistantMemoryGetResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  memory: assistantMemoryRecordSchema,
})

export const assistantMemoryUpsertResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  scope: z.enum(assistantMemoryWriteScopeValues),
  longTermAdded: z.number().int().nonnegative(),
  dailyAdded: z.number().int().nonnegative(),
  memories: z.array(assistantMemoryRecordSchema),
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
  replyConsidered: z.number().int().nonnegative(),
  replied: z.number().int().nonnegative(),
  replySkipped: z.number().int().nonnegative(),
  replyFailed: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
})

export const assistantAutomationCursorSchema = z.object({
  occurredAt: isoTimestampSchema,
  captureId: z.string().min(1),
})

export const assistantAutomationStateV1Schema = z.object({
  version: z.literal(1),
  inboxScanCursor: assistantAutomationCursorSchema.nullable(),
  updatedAt: isoTimestampSchema,
})

export const assistantAutomationStateSchema = z.object({
  version: z.literal(2),
  inboxScanCursor: assistantAutomationCursorSchema.nullable(),
  autoReplyScanCursor: assistantAutomationCursorSchema.nullable(),
  autoReplyChannels: z.array(z.string().min(1)),
  autoReplyPrimed: z.boolean(),
  updatedAt: isoTimestampSchema,
})

export type AssistantAliasStore = z.infer<typeof assistantAliasStoreSchema>
export type AssistantBindingDelivery = z.infer<
  typeof assistantBindingDeliverySchema
>
export type AssistantSessionBinding = z.infer<
  typeof assistantSessionBindingSchema
>
export type AssistantSession = z.infer<typeof assistantSessionSchema>
export type AssistantTranscriptEntry = z.infer<
  typeof assistantTranscriptEntrySchema
>
export type AssistantChannelDelivery = z.infer<
  typeof assistantChannelDeliverySchema
>
export type AssistantDeliveryError = z.infer<
  typeof assistantDeliveryErrorSchema
>
export type AssistantAskResult = z.infer<typeof assistantAskResultSchema>
export type AssistantChatResult = z.infer<typeof assistantChatResultSchema>
export type AssistantDeliverResult = z.infer<
  typeof assistantDeliverResultSchema
>
export type AssistantSessionListResult = z.infer<
  typeof assistantSessionListResultSchema
>
export type AssistantSessionShowResult = z.infer<
  typeof assistantSessionShowResultSchema
>
export type AssistantMemoryRecord = z.infer<
  typeof assistantMemoryRecordSchema
>
export type AssistantMemorySearchHit = z.infer<
  typeof assistantMemorySearchHitSchema
>
export type AssistantMemorySearchResult = z.infer<
  typeof assistantMemorySearchResultSchema
>
export type AssistantMemoryGetResult = z.infer<
  typeof assistantMemoryGetResultSchema
>
export type AssistantMemoryUpsertResult = z.infer<
  typeof assistantMemoryUpsertResultSchema
>
export type AssistantRunResult = z.infer<typeof assistantRunResultSchema>
export type AssistantAutomationCursor = z.infer<
  typeof assistantAutomationCursorSchema
>
export type AssistantAutomationStateV1 = z.infer<
  typeof assistantAutomationStateV1Schema
>
export type AssistantAutomationState = z.infer<
  typeof assistantAutomationStateSchema
>
export type AssistantSandbox = (typeof assistantSandboxValues)[number]
export type AssistantApprovalPolicy =
  (typeof assistantApprovalPolicyValues)[number]
export type AssistantReasoningEffort =
  (typeof assistantReasoningEffortValues)[number]
export type AssistantChatProvider =
  (typeof assistantChatProviderValues)[number]
export type AssistantChannelDeliveryTargetKind =
  (typeof assistantChannelDeliveryTargetKindValues)[number]
export type AssistantBindingDeliveryKind =
  (typeof assistantBindingDeliveryKindValues)[number]
export type AssistantTranscriptEntryKind =
  (typeof assistantTranscriptEntryKindValues)[number]
export type AssistantMemoryRecordKind =
  (typeof assistantMemoryRecordKindValues)[number]
export type AssistantMemoryQueryScope =
  (typeof assistantMemoryQueryScopeValues)[number]
export type AssistantMemoryWriteScope =
  (typeof assistantMemoryWriteScopeValues)[number]
export type AssistantMemoryLongTermSection =
  (typeof assistantMemoryLongTermSectionValues)[number]
export type AssistantMemoryVisibleSection =
  (typeof assistantMemoryVisibleSectionValues)[number]
export type AssistantProviderSessionOptions = z.infer<
  typeof assistantProviderSessionOptionsSchema
>
