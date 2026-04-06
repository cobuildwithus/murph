import path from 'node:path'
import type { InboxShowResult } from './inbox-cli-contracts.js'

export const ROUTING_VISION_SUPPORTED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export const routingImageEligibilityReasonValues = [
  'not-image',
  'stored-path-missing',
  'unsupported-format',
  'supported-format',
] as const

export type RoutingImageEligibilityReason =
  typeof routingImageEligibilityReasonValues[number]

export interface RoutingImageEligibility {
  eligible: boolean
  reason: RoutingImageEligibilityReason
  mediaType: string | null
  extension: string | null
}

type InboxAttachment = Partial<
  InboxShowResult['capture']['attachments'][number]
> & {
  mediaType?: string | null
}

const supportedMediaTypes = new Set<string>(ROUTING_VISION_SUPPORTED_MEDIA_TYPES)
const extensionToMediaType = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])

export function getRoutingImageEligibility(
  attachment: InboxAttachment,
): RoutingImageEligibility {
  const normalizedMime = normalizeImageMediaType(
    attachment.mime ?? attachment.mediaType,
  )
  const extension = resolveAttachmentExtension(attachment)

  if (attachment.kind !== 'image') {
    return {
      eligible: false,
      reason: 'not-image',
      mediaType: normalizedMime,
      extension,
    }
  }

  if (!hasStoredPath(attachment.storedPath)) {
    return {
      eligible: false,
      reason: 'stored-path-missing',
      mediaType: normalizedMime,
      extension,
    }
  }

  if (normalizedMime && supportedMediaTypes.has(normalizedMime)) {
    return {
      eligible: true,
      reason: 'supported-format',
      mediaType: normalizedMime,
      extension,
    }
  }

  if (normalizedMime && normalizedMime.startsWith('image/')) {
    return {
      eligible: false,
      reason: 'unsupported-format',
      mediaType: normalizedMime,
      extension,
    }
  }

  const inferredMediaType = inferImageMediaTypeFromExtension(extension)
  if (inferredMediaType) {
    return {
      eligible: true,
      reason: 'supported-format',
      mediaType: inferredMediaType,
      extension,
    }
  }

  return {
    eligible: false,
    reason: 'unsupported-format',
    mediaType: normalizedMime,
    extension,
  }
}

export function shouldBypassParserWaitForRouting(
  attachment: InboxAttachment,
): boolean {
  return getRoutingImageEligibility(attachment).eligible
}

function hasStoredPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeImageMediaType(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) {
    return null
  }

  switch (normalized) {
    case 'image/jpg':
    case 'image/pjpeg':
      return 'image/jpeg'
    case 'image/x-png':
      return 'image/png'
    default:
      return normalized
  }
}

function resolveAttachmentExtension(
  attachment: InboxAttachment,
): string | null {
  const candidates = [attachment.fileName, attachment.storedPath]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue
    }

    const extension = path.posix.extname(candidate).trim().toLowerCase()
    if (extension.length > 0) {
      return extension
    }
  }

  return null
}

function inferImageMediaTypeFromExtension(
  extension: string | null,
): string | null {
  if (!extension) {
    return null
  }

  return extensionToMediaType.get(extension) ?? null
}
