import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  normalizeOpaquePathSegment,
  normalizeRelativeVaultPath,
} from '@murphai/core'
import {
  normalizeAssistantRawAttachmentArtifactPath,
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
  const storedAttachmentPath = normalizeAssistantRawAttachmentArtifactPath(
    input.attachment.storedPath ?? null,
  )
  const routingImage = getRoutingImageEligibility({
    ...input.attachment,
    storedPath: storedAttachmentPath,
  })
  const useParserOutput = shouldUseInboxAttachmentParserOutput(
    input.attachment.kind,
  )
  const parseState = useParserOutput ? input.attachment.parseState ?? null : null
  const inlineDerivedPath = useParserOutput
    ? normalizeAnchoredVaultRelativePath(
        input.attachment.derivedPath ?? null,
        buildAllowedDerivedPrefixes(input.captureId, input.attachment),
      )
    : null
  const evidenceSources = useParserOutput
    ? [
        ...buildInlineTextSources({
          attachment: input.attachment,
          derivedPath: inlineDerivedPath,
          storedPath: storedAttachmentPath,
        }),
        ...(await buildDerivedTextSources({
          attachment: input.attachment,
          captureId: input.captureId,
          vaultRoot: input.vaultRoot,
        })),
      ]
    : []
  const fragments = [
    buildMetadataFragment(
      input.attachment,
      routingImage,
      storedAttachmentPath,
      parseState,
    ),
    ...projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: input.attachment.byteSize ?? null,
        derivedPath: inlineDerivedPath,
        fileName: input.attachment.fileName ?? null,
        mime: input.attachment.mime ?? null,
        storedPath: storedAttachmentPath,
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
    storedPath: storedAttachmentPath,
    parseState,
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
  return attachments.some((attachment) => attachment.routingImage.eligible)
    ? 'multimodal'
    : 'text-only'
}

function buildMetadataFragment(
  attachment: InboxShowResult['capture']['attachments'][number],
  routingImage: RoutingImageEligibility,
  storedAttachmentPath: string | null,
  parseState: InboxModelAttachmentBundle['parseState'],
) {
  const metadataLines = [
    `attachmentId: ${attachment.attachmentId ?? `attachment-${attachment.ordinal}`}`,
    `ordinal: ${attachment.ordinal}`,
    `kind: ${attachment.kind}`,
    `mime: ${attachment.mime ?? 'unknown'}`,
    `fileName: ${attachment.fileName ?? 'unknown'}`,
    `byteSize: ${attachment.byteSize ?? 'unknown'}`,
    `storedPath: ${storedAttachmentPath ?? 'missing'}`,
    parseState ? `parseState: ${parseState}` : null,
    `routingImageEligible: ${String(routingImage.eligible)}`,
    `routingImageReason: ${routingImage.reason}`,
    `routingImageMediaType: ${routingImage.mediaType ?? 'unknown'}`,
    `routingImageExtension: ${routingImage.extension ?? 'unknown'}`,
  ].filter((line): line is string => line !== null)
  const text = metadataLines.join('\n')
  return {
    kind: 'attachment_metadata' as const,
    label: `attachment-${attachment.ordinal}-metadata`,
    path: storedAttachmentPath,
    text,
    truncated: false,
  }
}

function shouldUseInboxAttachmentParserOutput(
  kind: InboxShowResult['capture']['attachments'][number]['kind'],
): boolean {
  return kind === 'audio' || kind === 'video'
}

function buildInlineTextSources(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  derivedPath: string | null
  storedPath: string | null
}): ModelEvidenceSource[] {
  const { attachment } = input
  const sources: ModelEvidenceSource[] = []

  const extracted = normalizeNullableString(attachment.extractedText)
  if (extracted) {
    sources.push({
      kind: 'attachment_extracted_text',
      label: `attachment-${attachment.ordinal}-extracted-text`,
      path: input.derivedPath ?? input.storedPath,
      text: extracted,
    })
  }

  const transcript = normalizeNullableString(attachment.transcriptText)
  if (transcript) {
    sources.push({
      kind: 'attachment_transcript',
      label: `attachment-${attachment.ordinal}-transcript`,
      path: input.derivedPath ?? input.storedPath,
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
