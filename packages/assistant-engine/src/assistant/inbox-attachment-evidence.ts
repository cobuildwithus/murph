import path from 'node:path'
import type {
  AssistantInputAttachmentEvidence,
  AssistantInputAttachmentEvidenceItem,
} from './input-store.js'
import { ASSISTANT_INPUT_EVENT_ATTACHMENT_DESCRIPTOR_MAX_COUNT } from './input-store.js'
import { normalizeAssistantInputFileName } from './attachment-file-name.js'

const INLINE_FRAGMENT_TEXT_MAX_LENGTH = 6_000
const ATTACHMENT_EVIDENCE_MAX_COUNT =
  ASSISTANT_INPUT_EVENT_ATTACHMENT_DESCRIPTOR_MAX_COUNT
const ATTACHMENT_EVIDENCE_PARTIAL_REASON_CODE = 'attachment.evidence_partial'
const ATTACHMENT_EVIDENCE_OVERFLOW_REASON_CODE =
  'attachment.evidence_partial.attachment_limit'
const SAFE_EVIDENCE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,190}$/u
const SAFE_CONTENT_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,126}$/u
const SAFE_SHA256_PATTERN = /^[0-9a-f]{64}$/u
type EvidenceSource = NonNullable<AssistantInputAttachmentEvidence['source']>

export interface InboxCaptureAttachmentLike {
  attachmentId?: string | null
  byteSize?: number | null
  derivedPath?: string | null
  externalId?: string | null
  extractedText?: string | null
  fileName?: string | null
  kind?: 'image' | 'audio' | 'video' | 'document' | 'other' | string | null
  mime?: string | null
  ordinal?: number | null
  originalPath?: string | null
  parseState?: 'pending' | 'running' | 'succeeded' | 'failed' | 'unsupported' | string | null
  parserProviderId?: string | null
  sha256?: string | null
  storedPath?: string | null
  transcriptText?: string | null
}

export function createAssistantInputAttachmentEvidenceFromInboxCapture(input: {
  capture: {
    attachments: readonly InboxCaptureAttachmentLike[]
    captureId: string
  }
  descriptorAttachmentIdForAttachment?: (
    attachment: InboxCaptureAttachmentLike,
    index: number,
  ) => string | null
  now?: string | null
  source: EvidenceSource
}): AssistantInputAttachmentEvidence {
  const attachments = input.capture.attachments
    .slice(0, ATTACHMENT_EVIDENCE_MAX_COUNT)
    .map((attachment, index) =>
      createAssistantInputAttachmentEvidenceItemFromInboxAttachment({
        attachment,
        descriptorAttachmentId:
          input.descriptorAttachmentIdForAttachment?.(attachment, index) ?? null,
        fallbackAttachmentId: `attachment-${index + 1}`,
        index,
      }),
    )
  const hasOmittedAttachmentEvidence =
    input.capture.attachments.length > attachments.length
  const hasMissingAttachmentEvidence =
    attachments.length > 0 && attachments.some((attachment) =>
      !hasMaterialAttachmentEvidence(attachment)
    )
  const hasPartialAttachmentEvidence =
    hasMissingAttachmentEvidence || hasOmittedAttachmentEvidence

  return {
    attachments,
    optionalInboxCaptureId: normalizeEvidenceToken(
      input.capture.captureId,
      null,
    ),
    reasonCode: hasOmittedAttachmentEvidence
      ? ATTACHMENT_EVIDENCE_OVERFLOW_REASON_CODE
      : hasMissingAttachmentEvidence
        ? ATTACHMENT_EVIDENCE_PARTIAL_REASON_CODE
        : null,
    source: input.source,
    status: hasPartialAttachmentEvidence ? 'partial' : 'available',
    updatedAt: input.now ?? null,
  }
}

function hasMaterialAttachmentEvidence(
  attachment: AssistantInputAttachmentEvidenceItem,
): boolean {
  return attachment.raw !== null ||
    attachment.derived !== null ||
    attachment.inlineFragments.length > 0
}

function createAssistantInputAttachmentEvidenceItemFromInboxAttachment(input: {
  attachment: InboxCaptureAttachmentLike
  descriptorAttachmentId: string | null
  fallbackAttachmentId: string
  index: number
}): AssistantInputAttachmentEvidenceItem {
  const ordinal = normalizeOrdinal(input.attachment.ordinal, input.index + 1)
  const mime = normalizeContentType(input.attachment.mime)
  const rawPath = normalizeRawArtifactPath(input.attachment.storedPath ?? null)
  const kind = normalizeAttachmentKind(input.attachment.kind)
  const useParserOutput = shouldUseAttachmentParserOutput(kind)
  const derivedPath = useParserOutput
    ? normalizeDerivedArtifactPath(input.attachment.derivedPath ?? null)
    : null

  return {
    byteSize: normalizeByteSize(input.attachment.byteSize),
    derived: derivedPath
      ? {
          allowedRoot: path.posix.dirname(derivedPath),
          kind: 'parser-manifest',
          manifestPath: derivedPath,
        }
      : null,
    descriptorAttachmentId: normalizeEvidenceToken(
      input.descriptorAttachmentId,
      normalizeEvidenceToken(input.attachment.attachmentId, input.fallbackAttachmentId),
    ),
    fileName: normalizeFileName(input.attachment.fileName),
    inlineFragments: useParserOutput
      ? [
          createInlineFragment({
            kind: 'attachment_extracted_text',
            label: `attachment-${ordinal}-extracted-text`,
            text: input.attachment.extractedText ?? null,
          }),
          createInlineFragment({
            kind: 'attachment_transcript',
            label: `attachment-${ordinal}-transcript`,
            text: input.attachment.transcriptText ?? null,
          }),
        ].filter((fragment): fragment is AssistantInputAttachmentEvidenceItem['inlineFragments'][number] =>
          fragment !== null,
        )
      : [],
    kind,
    mime,
    ordinal,
    parseState: normalizeParseStateForAttachment(input.attachment, kind),
    raw: rawPath
      ? {
          byteSize: normalizeByteSize(input.attachment.byteSize),
          kind: 'vault-relative-file',
          mediaType: mime,
          path: rawPath,
          sha256: normalizeSha256(input.attachment.sha256 ?? null),
        }
      : null,
    sourceAttachmentId: normalizeEvidenceToken(
      input.attachment.attachmentId,
      input.fallbackAttachmentId,
    ),
  }
}

function normalizeFileName(value: unknown): string | null {
  return normalizeAssistantInputFileName(value)
}

function createInlineFragment(input: {
  kind: AssistantInputAttachmentEvidenceItem['inlineFragments'][number]['kind']
  label: string
  text: string | null
}): AssistantInputAttachmentEvidenceItem['inlineFragments'][number] | null {
  const normalized = normalizeInlineEvidenceText(input.text)
  if (!normalized) {
    return null
  }

  return {
    kind: input.kind,
    label: input.label,
    text: normalized.text,
    truncated: normalized.truncated,
  }
}

function normalizeInlineEvidenceText(
  value: string | null | undefined,
): { text: string; truncated: boolean } | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed || isUnsafeInlineEvidenceText(trimmed)) {
    return null
  }

  return trimmed.length > INLINE_FRAGMENT_TEXT_MAX_LENGTH
    ? {
        text: trimmed.slice(0, INLINE_FRAGMENT_TEXT_MAX_LENGTH),
        truncated: true,
      }
    : {
        text: trimmed,
        truncated: false,
      }
}

function isUnsafeInlineEvidenceText(value: string): boolean {
  return (
    /(^|\n)\s*(authorization|cookie|set-cookie|x-api-key)\s*:/iu.test(value) ||
    /\bhttps?:\/\//iu.test(value) ||
    /\bfile:\/\//iu.test(value) ||
    /(^|[\s("'=])(?:[A-Za-z]:[\\/]|\/[^\s"'<>]+|~\/|\.\.\/|\.\.\\)/u.test(value) ||
    /^\s*[{[]/u.test(value)
  )
}

function normalizeAttachmentKind(
  value: InboxCaptureAttachmentLike['kind'],
): AssistantInputAttachmentEvidenceItem['kind'] {
  switch (value) {
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'other':
      return value
    default:
      return 'other'
  }
}

function normalizeParseState(
  value: InboxCaptureAttachmentLike['parseState'] | null,
): AssistantInputAttachmentEvidenceItem['parseState'] {
  switch (value) {
    case 'pending':
    case 'running':
    case 'succeeded':
    case 'failed':
    case 'unsupported':
      return value
    default:
      return null
  }
}

function normalizeParseStateForAttachment(
  attachment: InboxCaptureAttachmentLike,
  kind: AssistantInputAttachmentEvidenceItem['kind'],
): AssistantInputAttachmentEvidenceItem['parseState'] {
  if (!shouldUseAttachmentParserOutput(kind)) {
    return kind === 'other' ? 'unsupported' : null
  }

  const explicit = normalizeParseState(attachment.parseState ?? null)
  if (explicit) {
    return explicit
  }

  return null
}

function shouldUseAttachmentParserOutput(
  kind: AssistantInputAttachmentEvidenceItem['kind'],
): kind is 'audio' | 'video' {
  return kind === 'audio' || kind === 'video'
}

function normalizeEvidenceToken(
  value: string | null | undefined,
  fallback: string | null,
): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized && SAFE_EVIDENCE_TOKEN_PATTERN.test(normalized)) {
    return normalized
  }
  return fallback
}

function normalizeContentType(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return normalized && SAFE_CONTENT_TYPE_PATTERN.test(normalized)
    ? normalized
    : null
}

function normalizeByteSize(value: number | null | undefined): number | null {
  return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : null
}

function normalizeOrdinal(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value > 0
    ? value
    : fallback
}

function normalizeSha256(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SAFE_SHA256_PATTERN.test(normalized) ? normalized : null
}

function normalizeRawArtifactPath(value: string | null | undefined): string | null {
  return normalizeAllowedArtifactPath(value, ['raw/inbox/'])
}

function normalizeDerivedArtifactPath(value: string | null | undefined): string | null {
  const normalized = normalizeAllowedArtifactPath(value, ['derived/inbox/'])
  if (!normalized || path.posix.extname(normalized).toLowerCase() !== '.json') {
    return null
  }
  const allowedRoot = path.posix.dirname(normalized)
  return allowedRoot.startsWith('derived/inbox/') ? normalized : null
}

function normalizeAllowedArtifactPath(
  value: string | null | undefined,
  allowedPrefixes: readonly string[],
): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (
    !trimmed ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/u.test(trimmed) ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ||
    /[{}"'<>]/u.test(trimmed) ||
    /[a-z][a-z0-9+.-]*:/iu.test(trimmed)
  ) {
    return null
  }

  const normalized = trimmed
    .replace(/\/+/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/+$/u, '')
  const segments = normalized.split('/')
  if (
    normalized !== trimmed ||
    segments.some((segment) =>
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment === 'tmp' ||
      segment === 'temp' ||
      isUnsafeArtifactPathSegmentMarker(segment.toLowerCase())
    )
  ) {
    return null
  }

  return allowedPrefixes.some((prefix) => normalized.startsWith(prefix))
    ? normalized
    : null
}

function isUnsafeArtifactPathSegmentMarker(segment: string): boolean {
  return /(?:^|[-_.])(?:authorization|bearer|token|access[-_]?token|refresh[-_]?token|id[-_]?token|api[-_]?key|x[-_]?api[-_]?key|set[-_]?cookie|signed[-_]?url)(?:$|[-_.])/u.test(
    segment,
  )
}
