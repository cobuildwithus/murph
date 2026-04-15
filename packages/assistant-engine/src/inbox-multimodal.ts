import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  normalizeOpaquePathSegment,
  normalizeRelativeVaultPath,
} from '@murphai/core'
import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import {
  inboxModelAttachmentBundleSchema,
  type InboxModelAttachmentBundle,
  type InboxModelInputMode,
} from './inbox-model-contracts.js'
import {
  getRoutingImageEligibility,
  type RoutingImageEligibility,
} from './inbox-routing-vision.js'
import {
  type AssistantUserMessageContentPart,
} from './model-harness.js'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'

const DEFAULT_MAX_FRAGMENT_CHARS = 6000

const parserManifestSchema = z.object({
  schema: z.literal('murph.parser-manifest.v1'),
  paths: z.object({
    plainTextPath: z.string().min(1),
    markdownPath: z.string().min(1),
    tablesPath: z.string().min(1).nullable().optional(),
  }),
})

interface PreparedRoutingImage {
  kind: 'image'
  ordinal: number
  fileName: string | null
  mediaType: string | null
  bytes: Buffer
}

interface PreparedRoutingPdf {
  kind: 'pdf'
  ordinal: number
  fileName: string | null
  bytes: Buffer
}

type PreparedRoutingEvidence = PreparedRoutingImage | PreparedRoutingPdf

export interface InboxMultimodalAttachmentSource {
  attachment: InboxModelAttachmentBundle
  captureId: string
}

export async function buildInboxModelAttachmentBundle(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  captureId: string
  vaultRoot: string
}): Promise<InboxModelAttachmentBundle> {
  const routingImage = getRoutingImageEligibility(input.attachment)
  const fragments = [
    buildMetadataFragment(input.attachment, routingImage),
    ...buildInlineTextFragments(input.attachment),
    ...(await buildDerivedTextFragments({
      attachment: input.attachment,
      captureId: input.captureId,
      vaultRoot: input.vaultRoot,
    })),
  ]
  const combinedText = fragments
    .map((fragment) => `[${fragment.label}]\n${fragment.text}`)
    .join('\n\n')

  return inboxModelAttachmentBundleSchema.parse({
    attachmentId:
      input.attachment.attachmentId ?? `attachment-${input.attachment.ordinal}`,
    ordinal: input.attachment.ordinal,
    kind: input.attachment.kind,
    mime: input.attachment.mime ?? null,
    fileName: input.attachment.fileName ?? null,
    storedPath: input.attachment.storedPath ?? null,
    parseState: input.attachment.parseState ?? null,
    routingImage,
    fragments,
    combinedText,
  })
}

export async function buildInboxModelAttachmentBundles(input: {
  attachments: readonly InboxShowResult['capture']['attachments'][number][]
  captureId: string
  vaultRoot: string
}): Promise<InboxModelAttachmentBundle[]> {
  return Promise.all(
    input.attachments.map((attachment) =>
      buildInboxModelAttachmentBundle({
        attachment,
        captureId: input.captureId,
        vaultRoot: input.vaultRoot,
      }),
    ),
  )
}

export function inferInboxMultimodalInputMode(
  attachments: readonly InboxModelAttachmentBundle[],
): InboxModelInputMode {
  return attachments.some(
    (attachment) =>
      attachment.routingImage.eligible || isRoutingPdfFallbackCandidate(attachment),
  )
    ? 'multimodal'
    : 'text-only'
}

export function hasInboxMultimodalAttachmentEvidenceCandidate(
  attachment:
    | InboxShowResult['capture']['attachments'][number]
    | InboxModelAttachmentBundle,
): boolean {
  const storedPath = normalizeNullableString(attachment.storedPath)
  if (!storedPath) {
    return false
  }

  const routingImage =
    'routingImage' in attachment
      ? attachment.routingImage
      : getRoutingImageEligibility(attachment)

  return (
    routingImage.eligible ||
    isPdfAttachment({
      fileName: attachment.fileName ?? null,
      mime: attachment.mime ?? null,
    })
  )
}

export async function prepareInboxMultimodalUserMessageContent(input: {
  attachmentSources: readonly InboxMultimodalAttachmentSource[]
  fallbackContextLabel?: string
  prompt: string
  vaultRoot: string
}): Promise<{
  fallbackError: string | null
  inputMode: InboxModelInputMode
  userMessageContent: AssistantUserMessageContentPart[] | null
}> {
  const preparedInputMode = inferInboxMultimodalInputMode(
    input.attachmentSources.map((source) => source.attachment),
  )
  if (preparedInputMode === 'text-only') {
    return {
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    }
  }

  const routingEvidence = await readPreparedRoutingEvidence({
    attachmentSources: input.attachmentSources,
    fallbackContextLabel: input.fallbackContextLabel,
    vaultRoot: input.vaultRoot,
  })

  if (routingEvidence.evidence.length === 0) {
    return {
      fallbackError:
        routingEvidence.error ??
        'Falling back to text-only input because rich evidence could not be loaded.',
      inputMode: 'text-only',
      userMessageContent: null,
    }
  }

  const content: AssistantUserMessageContentPart[] = [
    {
      type: 'text',
      text: input.prompt,
    },
  ]

  for (const item of routingEvidence.evidence) {
    if (item.kind === 'image') {
      content.push({
        type: 'text',
        text: `Attachment image ${item.ordinal}${item.fileName ? ` (${item.fileName})` : ''}.`,
      })
      content.push({
        type: 'image',
        image: item.bytes,
        ...(item.mediaType
          ? {
              mediaType: item.mediaType,
              mimeType: item.mediaType,
            }
          : {}),
      })
      continue
    }

    content.push({
      type: 'text',
      text: `Attachment PDF ${item.ordinal}${item.fileName ? ` (${item.fileName})` : ''}.`,
    })
    content.push({
      type: 'file',
      data: item.bytes,
      mediaType: 'application/pdf',
      ...(item.fileName ? { filename: item.fileName } : {}),
    })
  }

  return {
    fallbackError: null,
    inputMode: 'multimodal',
    userMessageContent: content,
  }
}

export function isRoutingPdfFallbackCandidate(
  attachment: InboxModelAttachmentBundle,
): boolean {
  return (
    attachment.kind === 'document' &&
    isPdfAttachment({
      fileName: attachment.fileName,
      mime: attachment.mime,
    }) &&
    typeof attachment.storedPath === 'string' &&
    attachment.storedPath.length > 0 &&
    attachment.parseState !== 'pending' &&
    attachment.parseState !== 'running' &&
    !attachment.fragments.some((fragment) => fragment.kind !== 'attachment_metadata')
  )
}

function buildMetadataFragment(
  attachment: InboxShowResult['capture']['attachments'][number],
  routingImage: RoutingImageEligibility,
) {
  const metadataLines = [
    `attachmentId: ${attachment.attachmentId ?? `attachment-${attachment.ordinal}`}`,
    `ordinal: ${attachment.ordinal}`,
    `kind: ${attachment.kind}`,
    `mime: ${attachment.mime ?? 'unknown'}`,
    `fileName: ${attachment.fileName ?? 'unknown'}`,
    `storedPath: ${attachment.storedPath ?? 'missing'}`,
    `parseState: ${attachment.parseState ?? 'unknown'}`,
    `routingImageEligible: ${String(routingImage.eligible)}`,
    `routingImageReason: ${routingImage.reason}`,
    `routingImageMediaType: ${routingImage.mediaType ?? 'unknown'}`,
    `routingImageExtension: ${routingImage.extension ?? 'unknown'}`,
  ]
  const text = metadataLines.join('\n')
  return {
    kind: 'attachment_metadata' as const,
    label: `attachment-${attachment.ordinal}-metadata`,
    path: attachment.storedPath ?? null,
    text,
    truncated: false,
  }
}

function buildInlineTextFragments(
  attachment: InboxShowResult['capture']['attachments'][number],
) {
  const fragments: Array<{
    kind: 'attachment_extracted_text' | 'attachment_transcript'
    label: string
    path: string | null
    text: string
    truncated: boolean
  }> = []

  const extracted = normalizeNullableString(attachment.extractedText)
  if (extracted) {
    const clamped = clampText(extracted, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'attachment_extracted_text',
      label: `attachment-${attachment.ordinal}-extracted-text`,
      path: attachment.derivedPath ?? attachment.storedPath ?? null,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  const transcript = normalizeNullableString(attachment.transcriptText)
  if (transcript) {
    const clamped = clampText(transcript, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'attachment_transcript',
      label: `attachment-${attachment.ordinal}-transcript`,
      path: attachment.derivedPath ?? attachment.storedPath ?? null,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  return fragments
}

async function buildDerivedTextFragments(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  captureId: string
  vaultRoot: string
}) {
  const allowedDerivedPrefixes = buildAllowedDerivedPrefixes(
    input.captureId,
    input.attachment,
  )
  const normalizedManifestPath = normalizeAnchoredVaultRelativePath(
    input.attachment.derivedPath,
    allowedDerivedPrefixes,
  )
  if (!normalizedManifestPath) {
    return []
  }

  const manifest = await readParserManifest(input.vaultRoot, normalizedManifestPath)
  if (!manifest) {
    return []
  }

  const fragments: Array<{
    kind: 'derived_plain_text' | 'derived_markdown' | 'derived_tables'
    label: string
    path: string | null
    text: string
    truncated: boolean
  }> = []

  const plainTextPath = normalizeAnchoredVaultRelativePath(
    manifest.paths.plainTextPath,
    allowedDerivedPrefixes,
  )
  const plainText = plainTextPath
    ? await readRelativeTextFile(input.vaultRoot, plainTextPath)
    : null
  if (plainText) {
    const clamped = clampText(plainText, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'derived_plain_text',
      label: 'derived-plain-text',
      path: plainTextPath,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  const markdownPath = normalizeAnchoredVaultRelativePath(
    manifest.paths.markdownPath,
    allowedDerivedPrefixes,
  )
  const markdown = markdownPath
    ? await readRelativeTextFile(input.vaultRoot, markdownPath)
    : null
  if (markdown) {
    const clamped = clampText(markdown, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'derived_markdown',
      label: 'derived-markdown',
      path: markdownPath,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  const tablesPath = normalizeAnchoredVaultRelativePath(
    manifest.paths.tablesPath ?? null,
    allowedDerivedPrefixes,
  )
  if (tablesPath) {
    const tables = await readRelativeTextFile(input.vaultRoot, tablesPath)
    if (tables) {
      const clamped = clampText(tables, DEFAULT_MAX_FRAGMENT_CHARS)
      fragments.push({
        kind: 'derived_tables',
        label: 'derived-tables',
        path: tablesPath,
        text: clamped.text,
        truncated: clamped.truncated,
      })
    }
  }

  return fragments
}

async function readPreparedRoutingEvidence(input: {
  attachmentSources: readonly InboxMultimodalAttachmentSource[]
  fallbackContextLabel?: string
  vaultRoot: string
}): Promise<{
  error: string | null
  evidence: PreparedRoutingEvidence[]
}> {
  const evidence: PreparedRoutingEvidence[] = []
  const errors: string[] = []

  for (const source of input.attachmentSources) {
    const { attachment } = source
    const storedPath = normalizeCaptureStoredAttachmentPath(
      attachment.storedPath ?? null,
      source.captureId,
    )
    const shouldLoadImage = attachment.routingImage.eligible
    const shouldLoadPdf = isRoutingPdfFallbackCandidate(attachment)
    if ((!shouldLoadImage && !shouldLoadPdf) || !attachment.storedPath) {
      continue
    }

    try {
      if (!storedPath) {
        throw new Error('attachment stored path is outside the capture attachment subtree')
      }
      const absolutePath = await resolveAssistantVaultPath(
        input.vaultRoot,
        storedPath,
        'file path',
      )
      const bytes = await readFile(absolutePath)

      if (shouldLoadImage) {
        evidence.push({
          kind: 'image',
          ordinal: attachment.ordinal,
          fileName: attachment.fileName ?? null,
          mediaType: attachment.routingImage.mediaType ?? null,
          bytes,
        })
      } else {
        evidence.push({
          kind: 'pdf',
          ordinal: attachment.ordinal,
          fileName: attachment.fileName ?? null,
          bytes,
        })
      }
    } catch (error) {
      errors.push(
        `attachment ${attachment.ordinal} (${shouldLoadPdf ? 'pdf' : 'image'}): ${errorMessage(error)}`,
      )
    }
  }

  return {
    evidence,
    error:
      evidence.length === 0 && errors.length > 0
        ? `Falling back to text-only ${input.fallbackContextLabel ?? 'input'} because rich evidence could not be loaded (${errors.join('; ')}).`
        : null,
  }
}

function buildAllowedDerivedPrefixes(
  captureId: string,
  attachment: InboxShowResult['capture']['attachments'][number],
): string[] {
  const normalizedCaptureId = normalizeOpaquePathSegment(captureId, 'Capture id')
  const prefixes = [
    normalizeRelativeVaultPath(
      path.posix.join(
        'derived',
        'inbox',
        normalizedCaptureId,
        `attachment-${attachment.ordinal}`,
      ),
    ),
  ]
  const attachmentId = normalizeNullableString(attachment.attachmentId)
  if (attachmentId) {
    prefixes.push(
      normalizeRelativeVaultPath(
        path.posix.join(
          'derived',
          'inbox',
          normalizedCaptureId,
          'attachments',
          normalizeOpaquePathSegment(attachmentId, 'Attachment id'),
        ),
      ),
    )
  }
  return prefixes.map((prefix) => `${prefix}/`)
}

function normalizeCaptureStoredAttachmentPath(
  candidatePath: string | null | undefined,
  captureId: string,
): string | null {
  const normalizedCandidate = normalizeNullableString(candidatePath)
  if (!normalizedCandidate) {
    return null
  }

  try {
    const normalized = normalizeRelativeVaultPath(normalizedCandidate)
    return isCaptureStoredAttachmentPath(normalized, captureId) ? normalized : null
  } catch {
    return null
  }
}

function isCaptureStoredAttachmentPath(
  normalizedStoredPath: string,
  captureId: string,
): boolean {
  const normalizedCaptureId = normalizeOpaquePathSegment(captureId, 'Capture id')
  const segments = normalizedStoredPath.split('/')
  const attachmentsIndex = segments.indexOf('attachments')
  return (
    segments[0] === 'raw' &&
    segments[1] === 'inbox' &&
    attachmentsIndex >= 3 &&
    attachmentsIndex < segments.length - 1 &&
    segments[attachmentsIndex - 1] === normalizedCaptureId
  )
}

function normalizeAnchoredVaultRelativePath(
  candidatePath: string | null | undefined,
  allowedPrefixes: readonly string[],
): string | null {
  const normalizedCandidate = normalizeNullableString(candidatePath)
  if (!normalizedCandidate) {
    return null
  }

  try {
    const normalized = normalizeRelativeVaultPath(normalizedCandidate)
    return allowedPrefixes.some((prefix) => normalized.startsWith(prefix))
      ? normalized
      : null
  } catch {
    return null
  }
}

function isPdfAttachment(input: {
  fileName: string | null
  mime: string | null
}): boolean {
  const fileName = input.fileName?.toLowerCase() ?? ''
  const mime = input.mime?.toLowerCase() ?? ''
  return fileName.endsWith('.pdf') || mime === 'application/pdf'
}

async function readParserManifest(
  vaultRoot: string,
  relativePath: string,
): Promise<z.infer<typeof parserManifestSchema> | null> {
  try {
    const raw = await readFile(
      await resolveAssistantVaultPath(vaultRoot, relativePath),
      'utf8',
    )
    return parserManifestSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

async function readRelativeTextFile(
  vaultRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return normalizeNullableString(
      await readFile(
        await resolveAssistantVaultPath(vaultRoot, relativePath),
        'utf8',
      ),
    )
  } catch {
    return null
  }
}

function clampText(
  value: string,
  limit: number,
): {
  text: string
  truncated: boolean
} {
  const normalized = value.trim()
  if (normalized.length <= limit) {
    return {
      text: normalized,
      truncated: false,
    }
  }

  const suffix = `\n\n[truncated ${normalized.length - limit} characters]`
  const safeLimit = Math.max(0, limit - suffix.length)
  return {
    text: `${normalized.slice(0, safeLimit)}${suffix}`,
    truncated: true,
  }
}
