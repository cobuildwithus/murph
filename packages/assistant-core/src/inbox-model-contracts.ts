import { z } from 'incur'
import {
  isoTimestampSchema,
  pathSchema,
} from './vault-cli-contracts.js'
import { routingImageEligibilityReasonValues } from './inbox-routing-vision.js'

export const assistantToolSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputExample: z.record(z.string(), z.unknown()).nullable(),
})

export const assistantToolCallSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
})

export const assistantToolExecutionResultSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(['previewed', 'succeeded', 'failed', 'skipped']),
  result: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().min(1).nullable(),
  errorMessage: z.string().min(1).nullable(),
})

export const inboxModelInputModeValues = ['text-only', 'multimodal'] as const

export const inboxModelInputModeSchema = z.enum(inboxModelInputModeValues)

export const inboxModelRoutingImageSchema = z.object({
  eligible: z.boolean(),
  reason: z.enum(routingImageEligibilityReasonValues),
  mediaType: z.string().min(1).nullable(),
  extension: z.string().min(1).nullable(),
})

export const inboxModelTextFragmentSchema = z.object({
  kind: z.enum([
    'capture_text',
    'attachment_metadata',
    'attachment_extracted_text',
    'attachment_transcript',
    'derived_plain_text',
    'derived_markdown',
    'derived_tables',
  ]),
  label: z.string().min(1),
  path: pathSchema.nullable(),
  text: z.string().min(1),
  truncated: z.boolean(),
})

export const inboxModelAttachmentBundleSchema = z.object({
  attachmentId: z.string().min(1),
  ordinal: z.number().int().positive(),
  kind: z.enum(['image', 'audio', 'video', 'document', 'other']),
  mime: z.string().min(1).nullable(),
  fileName: z.string().min(1).nullable(),
  storedPath: pathSchema.nullable(),
  parseState: z.enum(['pending', 'running', 'succeeded', 'failed']).nullable(),
  routingImage: inboxModelRoutingImageSchema,
  fragments: z.array(inboxModelTextFragmentSchema),
  combinedText: z.string(),
})

export const inboxModelBundleSchema = z.object({
  schema: z.literal('murph.inbox-model-bundle.v1'),
  captureId: z.string().min(1),
  eventId: z.string().min(1),
  source: z.string().min(1),
  accountId: z.string().min(1).nullable(),
  threadId: z.string().min(1),
  threadTitle: z.string().min(1).nullable(),
  actorId: z.string().min(1).nullable(),
  actorName: z.string().min(1).nullable(),
  actorIsSelf: z.boolean(),
  occurredAt: isoTimestampSchema,
  receivedAt: isoTimestampSchema.nullable(),
  envelopePath: pathSchema,
  captureText: z.string().nullable(),
  attachments: z.array(inboxModelAttachmentBundleSchema),
  tools: z.array(assistantToolSpecSchema),
  preparedInputMode: inboxModelInputModeSchema,
  routingText: z.string().min(1),
})

export const assistantExecutionPlanSchema = z.object({
  schema: z.literal('murph.assistant-plan.v1'),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  actions: z.array(assistantToolCallSchema).max(4),
})

export const inboxModelBundleResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  bundlePath: pathSchema,
  bundle: inboxModelBundleSchema,
})

export const inboxModelRouteResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  apply: z.boolean(),
  bundlePath: pathSchema,
  planPath: pathSchema,
  resultPath: pathSchema.nullable(),
  preparedInputMode: inboxModelInputModeSchema,
  inputMode: inboxModelInputModeSchema,
  fallbackError: z.string().min(1).nullable(),
  model: z.object({
    model: z.string().min(1),
    providerMode: z.enum(['gateway', 'openai-compatible']),
    baseUrl: z.string().min(1).nullable(),
    providerName: z.string().min(1).nullable(),
  }),
  plan: assistantExecutionPlanSchema,
  results: z.array(assistantToolExecutionResultSchema),
})

export type AssistantToolSpec = z.infer<typeof assistantToolSpecSchema>
export type AssistantToolCall = z.infer<typeof assistantToolCallSchema>
export type AssistantToolExecutionResult = z.infer<
  typeof assistantToolExecutionResultSchema
>
export type InboxModelAttachmentBundle = z.infer<
  typeof inboxModelAttachmentBundleSchema
>
export type InboxModelBundle = z.infer<typeof inboxModelBundleSchema>
export type InboxModelBundleResult = z.infer<typeof inboxModelBundleResultSchema>
export type InboxModelInputMode = z.infer<typeof inboxModelInputModeSchema>
export type InboxModelRouteResult = z.infer<typeof inboxModelRouteResultSchema>
export type AssistantExecutionPlan = z.infer<typeof assistantExecutionPlanSchema>
