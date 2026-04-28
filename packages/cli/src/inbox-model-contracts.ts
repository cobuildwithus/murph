import { z } from 'zod'
import {
  isoTimestampSchema,
  pathSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { routingImageEligibilityReasonValues } from './inbox-routing-vision.js'

export const assistantCapabilityHostKindValues = [
  'cli-backed',
  'native-local',
] as const

export const assistantToolBackendKindValues = [
  'cli-wrapper',
  'local-service',
  'configured-web-read',
  'hosted-api',
  'native-file',
] as const

export const assistantToolSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputExample: z.record(z.string(), z.unknown()).nullable(),
  mutationSemantics: z.enum([
    'read-only',
    'mixed',
    'assistant-runtime-write',
    'canonical-write',
    'outward-side-effect',
  ]),
  riskClass: z.enum(['low', 'medium', 'high']),
  backendKind: z.enum(assistantToolBackendKindValues),
  preferredHostKind: z.enum(assistantCapabilityHostKindValues),
  selectedHostKind: z.enum(assistantCapabilityHostKindValues),
  provenance: z.object({
    origin: z.enum([
      'descriptor-generated',
      'hand-authored-helper',
      'vault-service-backed',
      'cli-backed',
      'configured-web-read',
      'hosted-api-backed',
      'native-local-only',
    ]),
    localOnly: z.boolean(),
    generatedFrom: z.string().min(1).nullable(),
    policyWrappers: z.array(z.enum([
      'command-blocking',
      'default-vault-injection',
      'format-default',
      'stdin-input-materialization',
      'argv-redaction',
      'output-redaction',
    ])),
  }),
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
    'attachment_json_summary',
    'attachment_tabular_summary',
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

export const inboxModelBundleResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  bundlePath: pathSchema,
  bundle: inboxModelBundleSchema.nullable(),
})

export type AssistantToolSpec = z.infer<typeof assistantToolSpecSchema>
export type AssistantToolMutationSemantics = AssistantToolSpec['mutationSemantics']
export type AssistantToolRiskClass = AssistantToolSpec['riskClass']
export type AssistantToolBackendKind = AssistantToolSpec['backendKind']
export type AssistantToolHostKind = AssistantToolSpec['preferredHostKind']
export type AssistantToolProvenance = AssistantToolSpec['provenance']
export type InboxModelAttachmentBundle = z.infer<
  typeof inboxModelAttachmentBundleSchema
>
export type InboxModelBundle = z.infer<typeof inboxModelBundleSchema>
export type InboxModelBundleResult = z.infer<typeof inboxModelBundleResultSchema>
export type InboxModelInputMode = z.infer<typeof inboxModelInputModeSchema>
