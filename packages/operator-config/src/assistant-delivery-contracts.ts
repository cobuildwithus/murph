import { isIP } from 'node:net'
import * as z from '@murphai/contracts/zod-runtime'
import {
  isAssistantGeneratedDeliveryRef,
  isNormalizedAssistantVaultFileRef,
} from '@murphai/runtime-state/assistant-generated-deliveries'
import {
  gatewayDeliveryTargetKindValues,
  gatewayReplyRouteKindValues,
} from '@murphai/gateway-core'
import { isoTimestampSchema } from './primitive-schemas.js'

// Delivery and response-media primitives shared by hosted runtimes and the
// Cloudflare Worker. Keeping them out of the CLI contract module lets those
// callers avoid evaluating every assistant CLI schema at startup.

export const assistantChannelDeliveryTargetKindValues = gatewayDeliveryTargetKindValues
export const assistantBindingDeliveryKindValues = gatewayReplyRouteKindValues

export const assistantMessageReactionValues = [
  'heart',
  'thumbs_up',
  'laugh',
] as const

export const assistantVaultImageMaxBytes = 10 * 1024 * 1024
export const assistantVaultFileMaxBytes = 100 * 1024 * 1024
export const assistantVoiceMemoSpeechOutputFormat = 'mp3_44100_128' as const
export const assistantVoiceMemoMusicModelId = 'music_v2' as const
export const assistantVoiceMemoMusicOutputFormat = 'mp3_48000_192' as const

export const assistantBindingDeliverySchema = z.object({
  kind: z.enum(assistantBindingDeliveryKindValues),
  target: z.string().min(1),
})

const assistantImageResponseMediaSchema = z
  .object({
    kind: z.literal('image').default('image'),
    url: z
      .string()
      .url()
      .transform((value, context) => {
        try {
          return normalizeAssistantResponseMediaUrl(value)
        } catch {
          context.addIssue({
            code: 'custom',
            message:
              'Assistant response media URLs must be valid public HTTPS image URLs.',
            params: { murphExpectedShape: 'public_https_image_url' },
          })
          return z.NEVER
        }
      }),
    alt: z.string().trim().min(1).max(500).nullable().default(null),
    source: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()

const assistantVaultImageResponseMediaSchema = z
  .object({
    kind: z.literal('vault_image'),
    ref: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine(
        (value) => isNormalizedAssistantVaultFileRef(value),
        'Assistant vault image refs must be normalized vault-relative paths.',
      ),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) => !/[\\/\u0000-\u001F\u007F]/u.test(value),
        'Assistant vault image names must not contain path separators or control characters.',
      ),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sizeBytes: z.number().int().positive().max(assistantVaultImageMaxBytes),
    alt: z.string().trim().min(1).max(500).nullable().default(null),
    source: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()

export const assistantAuthoredResponseMediaSchema = z.preprocess(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !Object.hasOwn(value, 'kind')
      ? { ...value, kind: 'image' }
      : value,
  z.discriminatedUnion('kind', [
    assistantImageResponseMediaSchema,
    assistantVaultImageResponseMediaSchema,
  ]),
)

export const assistantVoiceMemoGenerationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('elevenlabs_speech'),
      modelId: z.string().trim().min(1).max(200),
      outputFormat: z.literal(assistantVoiceMemoSpeechOutputFormat),
      text: z.string().trim().min(1).max(4000),
      voiceId: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      durationMs: z.number().int().min(3_000).max(300_000),
      forceInstrumental: z.boolean(),
      kind: z.literal('elevenlabs_music'),
      modelId: z.literal(assistantVoiceMemoMusicModelId),
      outputFormat: z.literal(assistantVoiceMemoMusicOutputFormat),
      prompt: z.string().trim().min(1).max(4100),
    })
    .strict(),
])

export const assistantVoiceMemoTransportSchema = z.discriminatedUnion('kind', [
  z
    .object({
      attachmentId: z.string().trim().min(1).max(200),
      kind: z.literal('linq_attachment'),
    })
    .strict(),
  z
    .object({
      generation: assistantVoiceMemoGenerationSchema,
      kind: z.literal('telegram_generation'),
    })
    .strict(),
])

const assistantVoiceMemoResponseMediaSchema = z
  .object({
    kind: z.literal('voice_memo'),
    filename: z.string().trim().min(1).max(255),
    transcript: z.string().trim().min(1).max(4000).nullable().default(null),
    transport: assistantVoiceMemoTransportSchema,
  })
  .strict()

const assistantExportPackRetirementReceiptSchema = z
  .object({
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    packId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict()

const assistantVaultFileResponseMediaSchema = z
  .object({
    approvalGeneration: z.string().regex(/^[0-9a-f]{64}$/u).nullable().default(null),
    approvalId: z.string().regex(/^haa_[A-Za-z0-9_-]{32}$/u).nullable().default(null),
    kind: z.literal('vault_file'),
    ref: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine(
        (value) => isNormalizedAssistantVaultFileRef(value),
        'Assistant vault file refs must be normalized vault-relative paths.',
      ),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) => !/[\\/\u0000-\u001F\u007F]/u.test(value),
        'Assistant vault file names must not contain path separators or control characters.',
      ),
    contentType: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u),
    retireExportPacks: z
      .array(assistantExportPackRetirementReceiptSchema)
      .min(1)
      .max(20)
      .optional(),
    sizeBytes: z.number().int().positive().max(assistantVaultFileMaxBytes),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.approvalGeneration === null) !== (value.approvalId === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant vault file approval id and generation must be present together.',
      })
    }
    if (value.retireExportPacks) {
      if (
        value.contentType !== 'application/zip'
        || !isAssistantGeneratedDeliveryRef(value.ref)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Export-pack retirement requires an assistant-generated ZIP.',
          path: ['retireExportPacks'],
        })
      }
      const packIds = value.retireExportPacks.map((receipt) => receipt.packId)
      if (new Set(packIds).size !== packIds.length) {
        context.addIssue({
          code: 'custom',
          message: 'Export-pack retirement receipts must have unique pack ids.',
          path: ['retireExportPacks'],
        })
      }
    }
  })

export const assistantResponseMediaSchema = z.union([
  assistantImageResponseMediaSchema,
  assistantVaultImageResponseMediaSchema,
  assistantVoiceMemoResponseMediaSchema,
  assistantVaultFileResponseMediaSchema,
])

export const assistantMessageReactionSchema = z.enum(assistantMessageReactionValues)

export function normalizeAssistantResponseMediaUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('Assistant response media URLs must be valid URLs.')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Assistant response media URLs must use HTTPS.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Assistant response media URLs must be public image URLs without credentials, query strings, or fragments.')
  }
  if (!isPublicAssistantResponseMediaHost(parsed.hostname)) {
    throw new Error('Assistant response media URLs must use public hosts.')
  }
  if (!hasAssistantResponseMediaImageExtension(parsed.pathname) && !isCloudflareImagesDeliveryUrl(parsed)) {
    throw new Error('Assistant response media URLs must point to image files.')
  }

  return parsed.toString()
}

function hasAssistantResponseMediaImageExtension(pathname: string): boolean {
  return /\.(?:avif|gif|jpe?g|png|webp)$/iu.test(pathname)
}

function isCloudflareImagesDeliveryUrl(url: URL): boolean {
  return url.hostname.toLowerCase().replace(/\.$/u, '') === 'imagedelivery.net'
    && url.pathname.split('/').filter(Boolean).length >= 3
}

function isPublicAssistantResponseMediaHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    return false
  }

  const ipLiteral = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
  if (isIP(ipLiteral) !== 0) {
    return false
  }

  return true
}

const assistantChannelCleanupMessageSchema = z
  .object({
    messageId: z.string().min(1),
    target: z.string().min(1),
  })
  .strict()

export const assistantProviderMessageEffectSchema = z
  .object({
    carriesIntentMedia: z.literal(true).optional(),
    providerMessageId: z.string().min(1),
    message: z.string().min(1).nullable(),
  })
  .strict()

const assistantMessageChannelDeliverySchema = z.object({
  kind: z.literal('message').optional(),
  channel: z.string().min(1),
  idempotencyKey: z.string().min(1).nullable().default(null),
  target: z.string().min(1),
  targetKind: z.enum(assistantChannelDeliveryTargetKindValues),
  sentAt: isoTimestampSchema,
  messageLength: z.number().int().nonnegative(),
  providerMessageId: z.string().min(1).nullable().default(null),
  providerMessageIds: z.array(z.string().min(1)).min(1).optional(),
  providerMessageEffects: z
    .array(assistantProviderMessageEffectSchema)
    .min(1)
    .optional(),
  cleanupMessages: z.array(assistantChannelCleanupMessageSchema).min(1).optional(),
  cleanupTargetAliases: z.array(z.string().min(1)).min(1).optional(),
  providerThreadId: z.string().min(1).nullable().default(null),
})

const assistantMessageReactionChannelDeliverySchema = z
  .object({
    kind: z.literal('message-reaction'),
    channel: z.enum(['linq', 'telegram']),
    idempotencyKey: z.string().min(1).nullable().default(null),
    reaction: assistantMessageReactionSchema,
    sentAt: isoTimestampSchema,
    target: z.string().min(1),
    targetKind: z.enum(assistantChannelDeliveryTargetKindValues),
    targetMessageId: z.string().min(1),
  })
  .strict()

export const assistantChannelDeliverySchema = z.union([
  assistantMessageChannelDeliverySchema,
  assistantMessageReactionChannelDeliverySchema,
])
