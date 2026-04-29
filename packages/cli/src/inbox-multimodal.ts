import { readFile } from 'node:fs/promises'
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

export async function buildInboxModelAttachmentBundle(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  captureId: string
  vaultRoot: string
}): Promise<InboxModelAttachmentBundle> {
  const routingImage = getRoutingImageEligibility(input.attachment)
  const evidenceSources = [
    ...buildInlineTextSources(input.attachment),
    ...(await buildDerivedTextSources({
      attachment: input.attachment,
      captureId: input.captureId,
      vaultRoot: input.vaultRoot,
    })),
  ]
  const fragments = [
    buildMetadataFragment(input.attachment, routingImage),
    ...projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: input.attachment.byteSize ?? null,
        derivedPath: input.attachment.derivedPath ?? null,
        fileName: input.attachment.fileName ?? null,
        mime: input.attachment.mime ?? null,
        storedPath: input.attachment.storedPath ?? null,
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

export function isRoutingPdfFallbackCandidate(
  attachment: InboxModelAttachmentBundle,
): boolean {
  return (
    attachment.kind === 'document' &&
    isPdfAttachment({
      fileName: attachment.fileName,
      mime: attachment.mime,
      storedPath: attachment.storedPath,
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
    `byteSize: ${attachment.byteSize ?? 'unknown'}`,
    `storedPath: ${attachment.storedPath ?? 'missing'}`,
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

function buildInlineTextSources(
  attachment: InboxShowResult['capture']['attachments'][number],
): ModelEvidenceSource[] {
  const sources: ModelEvidenceSource[] = []

  const extracted = normalizeNullableString(attachment.extractedText)
  if (extracted) {
    sources.push({
      kind: 'attachment_extracted_text',
      label: `attachment-${attachment.ordinal}-extracted-text`,
      path: attachment.derivedPath ?? attachment.storedPath ?? null,
      text: extracted,
    })
  }

  const transcript = normalizeNullableString(attachment.transcriptText)
  if (transcript) {
    sources.push({
      kind: 'attachment_transcript',
      label: `attachment-${attachment.ordinal}-transcript`,
      path: attachment.derivedPath ?? attachment.storedPath ?? null,
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
      path: plainTextPath,
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
      path: markdownPath,
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
        path: tablesPath,
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

function isPdfAttachment(input: {
  fileName: string | null
  mime: string | null
  storedPath?: string | null
}): boolean {
  const mime = normalizeNullableString(input.mime)?.toLowerCase() ?? null
  if (mime === 'application/pdf' || mime === 'application/x-pdf') {
    return true
  }

  const candidates = [input.fileName, input.storedPath ?? null]
  return candidates.some((candidate) =>
    normalizeNullableString(candidate)?.toLowerCase().endsWith('.pdf') ?? false,
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
