import { z } from 'zod'
import {
  pathSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { routingImageEligibilityReasonValues } from './inbox-routing-vision.js'

export const inboxModelInputModeValues = ['text-only', 'multimodal'] as const

export const inboxModelInputModeSchema = z.enum(inboxModelInputModeValues)

export const inboxModelRoutingImageSchema = z.object({
  eligible: z.boolean(),
  reason: z.enum(routingImageEligibilityReasonValues),
  mediaType: z.string().min(1).nullable(),
  extension: z.string().min(1).nullable(),
})

export const inboxModelRoutingPdfSchema = z.object({
  byteSize: z.number().int().nonnegative().nullable(),
  eligible: z.boolean(),
  maxBytes: z.number().int().positive(),
  path: pathSchema.nullable(),
  reason: z.enum([
    'declared-too-large',
    'eligible',
    'missing-stored-path',
    'not-pdf',
    'stored-file-too-large',
    'stored-file-unavailable',
    'stored-path-outside-capture',
  ]),
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
  byteSize: z.number().int().nonnegative().nullable().optional(),
  storedPath: pathSchema.nullable(),
  parseState: z.enum(['pending', 'running', 'succeeded', 'failed']).nullable(),
  routingImage: inboxModelRoutingImageSchema,
  routingPdf: inboxModelRoutingPdfSchema.optional(),
  fragments: z.array(inboxModelTextFragmentSchema),
  combinedText: z.string(),
})

export type InboxModelAttachmentBundle = z.infer<
  typeof inboxModelAttachmentBundleSchema
>
export type InboxModelInputMode = z.infer<typeof inboxModelInputModeSchema>
