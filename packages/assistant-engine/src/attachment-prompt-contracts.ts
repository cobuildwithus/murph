import * as z from '@murphai/contracts/zod-runtime'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'
import { routingImageEligibilityReasonValues } from './inbox-routing-vision.js'

export const attachmentPromptInputModeValues = ['text-only', 'multimodal'] as const

export const attachmentPromptInputModeSchema = z.enum(attachmentPromptInputModeValues)

export const attachmentPromptRoutingImageSchema = z.object({
  eligible: z.boolean(),
  reason: z.enum(routingImageEligibilityReasonValues),
  mediaType: z.string().min(1).nullable(),
  extension: z.string().min(1).nullable(),
})

export const attachmentPromptTextFragmentSchema = z.object({
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

export const attachmentPromptBundleSchema = z.object({
  attachmentId: z.string().min(1),
  ordinal: z.number().int().positive(),
  kind: z.enum(['image', 'audio', 'video', 'document', 'other']),
  mime: z.string().min(1).nullable(),
  fileName: z.string().min(1).nullable(),
  byteSize: z.number().int().nonnegative().nullable().optional(),
  storedPath: pathSchema.nullable(),
  parseState: z.enum(['pending', 'running', 'succeeded', 'failed', 'unsupported']).nullable(),
  routingImage: attachmentPromptRoutingImageSchema,
  fragments: z.array(attachmentPromptTextFragmentSchema),
  combinedText: z.string(),
})

export type AttachmentPromptBundle = z.infer<
  typeof attachmentPromptBundleSchema
>
export type AttachmentPromptInputMode = z.infer<typeof attachmentPromptInputModeSchema>
