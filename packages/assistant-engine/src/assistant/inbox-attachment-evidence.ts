import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import type {
  AssistantInputAttachmentEvidence,
  AssistantInputAttachmentEvidenceItem,
} from './input-store.js'

const INLINE_FRAGMENT_TEXT_MAX_LENGTH = 6_000
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
  parseState?: 'pending' | 'running' | 'succeeded' | 'failed' | string | null
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
  rawArtifactPathForAttachment?: (input: {
    attachment: InboxCaptureAttachmentLike
    index: number
    normalizedSourcePath: string
    ordinal: number
  }) => string | null
  source: EvidenceSource
}): AssistantInputAttachmentEvidence {
  const attachments = input.capture.attachments.map((attachment, index) =>
    createAssistantInputAttachmentEvidenceItemFromInboxAttachment({
      attachment,
      descriptorAttachmentId:
        input.descriptorAttachmentIdForAttachment?.(attachment, index) ?? null,
      fallbackAttachmentId: `attachment-${index + 1}`,
      index,
      rawArtifactPathForAttachment: input.rawArtifactPathForAttachment,
    }),
  )
  const hasMissingAttachmentEvidence =
    attachments.length > 0 && attachments.some((attachment) =>
      !hasMaterialAttachmentEvidence(attachment)
    )

  return {
    attachments,
    optionalInboxCaptureId: normalizeEvidenceToken(
      input.capture.captureId,
      null,
    ),
    reasonCode: hasMissingAttachmentEvidence ? 'attachment.evidence_partial' : null,
    source: input.source,
    status: hasMissingAttachmentEvidence ? 'partial' : 'available',
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
  rawArtifactPathForAttachment?: (input: {
    attachment: InboxCaptureAttachmentLike
    index: number
    normalizedSourcePath: string
    ordinal: number
  }) => string | null
}): AssistantInputAttachmentEvidenceItem {
  const ordinal = normalizeOrdinal(input.attachment.ordinal, input.index + 1)
  const mime = normalizeContentType(input.attachment.mime)
  const sourceRawPath = normalizeRawArtifactPath(input.attachment.storedPath ?? null)
  const rawPath = sourceRawPath
    ? normalizeRawArtifactPath(
      input.rawArtifactPathForAttachment?.({
        attachment: input.attachment,
        index: input.index,
        normalizedSourcePath: sourceRawPath,
        ordinal,
      }) ?? null,
    )
    : null
  const derivedPath = normalizeDerivedArtifactPath(input.attachment.derivedPath ?? null)

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
    fileName: null,
    inlineFragments: [
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
    ),
    kind: normalizeAttachmentKind(input.attachment.kind),
    mime,
    ordinal,
    parseState: normalizeParseState(input.attachment.parseState ?? null),
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

export async function materializeAssistantInputAttachmentRawArtifactRefs(input: {
  attachments: readonly InboxCaptureAttachmentLike[]
  inputId: string
  vaultRoot: string
}): Promise<Map<number, string>> {
  const refs = new Map<number, string>()
  await Promise.all(input.attachments.map(async (attachment, index) => {
    const sourcePath = normalizeRawArtifactPath(attachment.storedPath ?? null)
    if (!sourcePath) {
      return
    }

    const ordinal = normalizeOrdinal(attachment.ordinal, index + 1)
    const targetPath = createAssistantInputRawArtifactPath({
      inputId: input.inputId,
      kind: normalizeAttachmentKind(attachment.kind),
      mediaType: normalizeContentType(attachment.mime),
      ordinal,
    })
    if (!targetPath) {
      return
    }

    try {
      if (sourcePath !== targetPath) {
        const sourceAbsolutePath = await resolveAssistantVaultPath(
          input.vaultRoot,
          sourcePath,
          'file path',
        )
        const targetAbsolutePath = await resolveAssistantVaultPath(
          input.vaultRoot,
          targetPath,
          'file path',
        )
        await mkdir(path.dirname(targetAbsolutePath), { recursive: true })
        // `raw/assistant-input/**` is the assistant-owned raw evidence
        // namespace for event-owned attachment evidence. These copies keep
        // prompts decoupled from inbox capture layout while preserving durable
        // vault-relative artifact handles.
        await copyFile(sourceAbsolutePath, targetAbsolutePath)
      }
      refs.set(index, targetPath)
    } catch {
      // Missing or unreadable raw artifacts leave the attachment as partial
      // evidence; producer paths should not block admission on parser artifacts.
    }
  }))
  return refs
}

function createAssistantInputRawArtifactPath(input: {
  inputId: string
  kind: AssistantInputAttachmentEvidenceItem['kind']
  mediaType: string | null
  ordinal: number
}): string | null {
  const inputId = normalizeEvidenceToken(input.inputId, null)
  if (!inputId) {
    return null
  }

  const extension = extensionForAttachmentArtifact(input)
  return `raw/assistant-input/${inputId}/attachments/${String(input.ordinal).padStart(3, '0')}${extension}`
}

function extensionForAttachmentArtifact(input: {
  kind: AssistantInputAttachmentEvidenceItem['kind']
  mediaType: string | null
}): string {
  switch (input.mediaType) {
    case 'application/json':
      return '.json'
    case 'application/pdf':
      return '.pdf'
    case 'audio/mpeg':
      return '.mp3'
    case 'audio/mp4':
    case 'audio/x-m4a':
      return '.m4a'
    case 'audio/ogg':
      return '.ogg'
    case 'image/gif':
      return '.gif'
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'text/csv':
      return '.csv'
    case 'text/plain':
      return '.txt'
    case 'video/mp4':
      return '.mp4'
    default:
      return input.kind === 'document' ? '.bin' : '.dat'
  }
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
      return value
    default:
      return null
  }
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
  return normalizeAllowedArtifactPath(value, ['raw/inbox/', 'raw/assistant-input/'])
}

function normalizeDerivedArtifactPath(value: string | null | undefined): string | null {
  const normalized = normalizeAllowedArtifactPath(value, [
    'derived/inbox/',
    'derived/assistant-input/',
  ])
  if (!normalized || path.posix.extname(normalized).toLowerCase() !== '.json') {
    return null
  }
  const allowedRoot = path.posix.dirname(normalized)
  return allowedRoot.startsWith('derived/inbox/') ||
      allowedRoot.startsWith('derived/assistant-input/')
    ? normalized
    : null
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
