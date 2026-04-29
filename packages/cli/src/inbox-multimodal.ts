import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  normalizeOpaquePathSegment,
  normalizeRelativeVaultPath,
} from '@murphai/core'
import {
  projectAttachmentEvidenceForModel,
  type ModelEvidenceSource,
} from '@murphai/assistant-engine/assistant-runtime'
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
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

const parserManifestSchema = z.object({
  schema: z.literal('murph.parser-manifest.v1'),
  paths: z.object({
    plainTextPath: z.string().min(1),
    markdownPath: z.string().min(1),
    tablesPath: z.string().min(1).nullable().optional(),
  }),
})

export const MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES = 20 * 1024 * 1024

type RoutingPdfEligibilityReason =
  | 'declared-too-large'
  | 'eligible'
  | 'missing-stored-path'
  | 'not-pdf'
  | 'stored-file-too-large'
  | 'stored-file-unavailable'
  | 'stored-path-outside-capture'

interface RoutingPdfEligibility {
  byteSize: number | null
  eligible: boolean
  maxBytes: number
  path: string | null
  reason: RoutingPdfEligibilityReason
}

export async function buildInboxModelAttachmentBundle(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  captureId: string
  captureEnvelopePath: string
  vaultRoot: string
}): Promise<InboxModelAttachmentBundle> {
  const routingImage = getRoutingImageEligibility(input.attachment)
  const routingPdf = await getRoutingPdfEligibility({
    attachment: input.attachment,
    captureEnvelopePath: input.captureEnvelopePath,
    vaultRoot: input.vaultRoot,
  })
  const evidenceSources = [
    ...buildInlineTextSources(input.attachment),
    ...(await buildDerivedTextSources({
      attachment: input.attachment,
      captureId: input.captureId,
      vaultRoot: input.vaultRoot,
    })),
  ]
  const fragments = [
    buildMetadataFragment(input.attachment, routingImage, routingPdf),
    ...projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: input.attachment.byteSize ?? null,
        derivedPath: input.attachment.derivedPath ?? null,
        fileName: buildAttachmentDisplayName(input.attachment),
        mime: input.attachment.mime ?? null,
        storedPath: null,
      },
      sources: evidenceSources,
    }),
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
    byteSize: input.attachment.byteSize ?? null,
    storedPath: input.attachment.storedPath ?? null,
    parseState: input.attachment.parseState ?? null,
    routingImage,
    routingPdf,
    fragments,
    combinedText,
  })
}

export async function buildInboxModelAttachmentBundles(input: {
  attachments: readonly InboxShowResult['capture']['attachments'][number][]
  captureId: string
  captureEnvelopePath: string
  vaultRoot: string
}): Promise<InboxModelAttachmentBundle[]> {
  return Promise.all(
    input.attachments.map((attachment) =>
      buildInboxModelAttachmentBundle({
        attachment,
        captureId: input.captureId,
        captureEnvelopePath: input.captureEnvelopePath,
        vaultRoot: input.vaultRoot,
      }),
    ),
  )
}

export function inferInboxMultimodalInputMode(
  attachments: readonly InboxModelAttachmentBundle[],
): InboxModelInputMode {
  return attachments.some(
    (attachment) => attachment.routingImage.eligible,
  )
    ? 'multimodal'
    : 'text-only'
}

export function isRoutingPdfFallbackCandidate(
  attachment: InboxModelAttachmentBundle,
): boolean {
  return Boolean(attachment.routingPdf?.eligible)
}

function buildMetadataFragment(
  attachment: InboxShowResult['capture']['attachments'][number],
  routingImage: RoutingImageEligibility,
  routingPdf: RoutingPdfEligibility,
) {
  const metadataLines = [
    `ordinal: ${attachment.ordinal}`,
    `kind: ${attachment.kind}`,
    `mime: ${attachment.mime ?? 'unknown'}`,
    `displayName: ${buildAttachmentDisplayName(attachment)}`,
    `byteSize: ${attachment.byteSize ?? 'unknown'}`,
    `parseState: ${attachment.parseState ?? 'unknown'}`,
    ...(attachment.kind === 'image'
      ? [
          'automaticImageCodeScan: if inbox parsing succeeds, image attachments are scanned for QR and barcode payloads; treat decoded values as available only when they appear in extracted text fragments',
        ]
      : []),
    `routingImageEligible: ${String(routingImage.eligible)}`,
    `routingImageReason: ${routingImage.reason}`,
    `routingImageMediaType: ${routingImage.mediaType ?? 'unknown'}`,
    `routingImageExtension: ${routingImage.extension ?? 'unknown'}`,
    `routingPdfEligible: ${String(routingPdf.eligible)}`,
    `routingPdfReason: ${routingPdf.reason}`,
    `routingPdfMaxBytes: ${routingPdf.maxBytes}`,
    ...(routingPdf.eligible
      ? [
          `pdfEvidenceByteSize: ${routingPdf.byteSize ?? 'unknown'}`,
        ]
      : []),
  ]
  const text = metadataLines.join('\n')
  return {
    kind: 'attachment_metadata' as const,
    label: `attachment-${attachment.ordinal}-metadata`,
    path: null,
    text,
    truncated: false,
  }
}

function buildInlineTextSources(
  attachment: InboxShowResult['capture']['attachments'][number],
): ModelEvidenceSource[] {
  const sources: ModelEvidenceSource[] = []

  const extracted = normalizeNullableString(attachment.extractedText)
  if (extracted) {
    sources.push({
      kind: 'attachment_extracted_text',
      label: `attachment-${attachment.ordinal}-extracted-text`,
      path: null,
      text: extracted,
    })
  }

  const transcript = normalizeNullableString(attachment.transcriptText)
  if (transcript) {
    sources.push({
      kind: 'attachment_transcript',
      label: `attachment-${attachment.ordinal}-transcript`,
      path: null,
      text: transcript,
    })
  }

  return sources
}

async function buildDerivedTextSources(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  captureId: string
  vaultRoot: string
}): Promise<ModelEvidenceSource[]> {
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

  const sources: ModelEvidenceSource[] = []

  const plainTextPath = normalizeAnchoredVaultRelativePath(
    manifest.paths.plainTextPath,
    allowedDerivedPrefixes,
  )
  const plainText = plainTextPath
    ? await readRelativeTextFile(input.vaultRoot, plainTextPath)
    : null
  if (plainText) {
    sources.push({
      kind: 'derived_plain_text',
      label: 'derived-plain-text',
      path: null,
      text: plainText,
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
    sources.push({
      kind: 'derived_markdown',
      label: 'derived-markdown',
      path: null,
      text: markdown,
    })
  }

  const tablesPath = normalizeAnchoredVaultRelativePath(
    manifest.paths.tablesPath ?? null,
    allowedDerivedPrefixes,
  )
  if (tablesPath) {
    const tables = await readRelativeTextFile(input.vaultRoot, tablesPath)
    if (tables) {
      sources.push({
        kind: 'derived_tables',
        label: 'derived-tables',
        path: null,
        text: tables,
      })
    }
  }

  return sources
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

async function getRoutingPdfEligibility(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  captureEnvelopePath: string
  vaultRoot: string
}): Promise<RoutingPdfEligibility> {
  const inferred = inferRoutingPdfEligibilityWithoutFileCheck(input.attachment)
  if (!inferred.eligible) {
    return inferred
  }

  const storedPath = normalizeCaptureStoredAttachmentPath(
    inferred.path,
    input.captureEnvelopePath,
  )
  if (!storedPath) {
    return buildRoutingPdfEligibility({
      byteSize: inferred.byteSize,
      path: inferred.path,
      reason: 'stored-path-outside-capture',
    })
  }

  try {
    const absolutePath = await resolveAssistantVaultPath(
      input.vaultRoot,
      storedPath,
      'file path',
    )
    const fileStat = await stat(absolutePath)
    if (!fileStat.isFile()) {
      return buildRoutingPdfEligibility({
        byteSize: inferred.byteSize,
        path: storedPath,
        reason: 'stored-file-unavailable',
      })
    }
    if (fileStat.size > MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES) {
      return buildRoutingPdfEligibility({
        byteSize: fileStat.size,
        path: storedPath,
        reason: 'stored-file-too-large',
      })
    }

    return buildRoutingPdfEligibility({
      byteSize: fileStat.size,
      eligible: true,
      path: storedPath,
      reason: 'eligible',
    })
  } catch {
    return buildRoutingPdfEligibility({
      byteSize: inferred.byteSize,
      path: storedPath,
      reason: 'stored-file-unavailable',
    })
  }
}

function inferRoutingPdfEligibilityWithoutFileCheck(
  attachment: InboxShowResult['capture']['attachments'][number],
): RoutingPdfEligibility {
  const storedPath = normalizeNullableString(attachment.storedPath)
  const byteSize = readAttachmentByteSize(attachment)

  if (!isPdfAttachment(attachment)) {
    return buildRoutingPdfEligibility({
      byteSize,
      path: storedPath,
      reason: 'not-pdf',
    })
  }

  if (!storedPath) {
    return buildRoutingPdfEligibility({
      byteSize,
      path: null,
      reason: 'missing-stored-path',
    })
  }

  if (
    byteSize !== null &&
    byteSize > MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES
  ) {
    return buildRoutingPdfEligibility({
      byteSize,
      path: storedPath,
      reason: 'declared-too-large',
    })
  }

  return buildRoutingPdfEligibility({
    byteSize,
    eligible: true,
    path: storedPath,
    reason: 'eligible',
  })
}

function buildRoutingPdfEligibility(input: {
  byteSize: number | null
  eligible?: boolean
  path: string | null
  reason: RoutingPdfEligibilityReason
}): RoutingPdfEligibility {
  return {
    byteSize: input.byteSize,
    eligible: input.eligible ?? false,
    maxBytes: MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
    path: input.path,
    reason: input.reason,
  }
}

function readAttachmentByteSize(
  attachment: InboxShowResult['capture']['attachments'][number],
): number | null {
  return typeof attachment.byteSize === 'number' ? attachment.byteSize : null
}

function isPdfAttachment(
  attachment: InboxShowResult['capture']['attachments'][number],
): boolean {
  const mime = normalizeNullableString(attachment.mime)?.toLowerCase() ?? null
  if (mime === 'application/pdf' || mime === 'application/x-pdf') {
    return true
  }

  const candidates = [attachment.fileName, attachment.storedPath]
  return candidates.some((candidate) =>
    normalizeNullableString(candidate)?.toLowerCase().endsWith('.pdf') ?? false,
  )
}

function buildAttachmentDisplayName(
  attachment: InboxShowResult['capture']['attachments'][number],
): string {
  if (isPdfAttachment(attachment)) {
    return `attachment-${String(attachment.ordinal).padStart(2, '0')}.pdf`
  }

  return `attachment-${String(attachment.ordinal).padStart(2, '0')}`
}

function normalizeCaptureStoredAttachmentPath(
  candidatePath: string | null | undefined,
  captureEnvelopePath: string,
): string | null {
  const normalizedCandidate = normalizeNullableString(candidatePath)
  if (!normalizedCandidate) {
    return null
  }

  try {
    const normalized = normalizeRelativeVaultPath(normalizedCandidate)
    return isCaptureStoredAttachmentPath(normalized, captureEnvelopePath)
      ? normalized
      : null
  } catch {
    return null
  }
}

function isCaptureStoredAttachmentPath(
  normalizedStoredPath: string,
  captureEnvelopePath: string,
): boolean {
  const normalizedEnvelopePath = normalizeRelativeVaultPath(captureEnvelopePath)
  const captureDirectory = path.posix.dirname(normalizedEnvelopePath)
  const attachmentsPrefix = `${captureDirectory}/attachments/`
  return (
    normalizedEnvelopePath.endsWith('/envelope.json') &&
    normalizedStoredPath.startsWith(attachmentsPrefix) &&
    normalizedStoredPath.length > attachmentsPrefix.length
  )
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
