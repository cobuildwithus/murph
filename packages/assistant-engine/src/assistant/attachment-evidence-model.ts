import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  normalizeRelativeVaultPath,
} from '@murphai/core'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import type {
  AssistantInputAttachmentEvidenceItem,
} from './input-store.js'
import {
  type AssistantUserMessageContentPart,
} from './content-types.js'
import {
  inboxModelAttachmentBundleSchema,
  type InboxModelAttachmentBundle,
  type InboxModelInputMode,
} from '../inbox-model-contracts.js'
import {
  getRoutingImageEligibility,
  type RoutingImageEligibility,
} from '../inbox-routing-vision.js'
import {
  projectAttachmentEvidenceForModel,
  type ModelEvidenceSource,
} from '../inbox-evidence-projection.js'

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

type PreparedRoutingEvidence = PreparedRoutingImage

export type AssistantInputAttachmentModelBundle = InboxModelAttachmentBundle

export interface AssistantInputAttachmentEvidenceReadFailure {
  attachmentOrdinal: number
  details: string
  errorCode: string
  kind: 'image' | 'raw' | 'derived'
}

export async function buildAssistantInputAttachmentModelBundle(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  vaultRoot: string
}): Promise<AssistantInputAttachmentModelBundle> {
  const rawPath = normalizeAssistantInputRawArtifactPath(input.attachment.raw?.path ?? null)
  const routingImage = getAttachmentEvidenceRoutingImageEligibility({
    attachment: input.attachment,
    rawPath,
  })
  const evidenceSources = [
    ...buildInlineTextSources(input.attachment),
    ...(await buildDerivedTextSources({
      attachment: input.attachment,
      vaultRoot: input.vaultRoot,
    })),
  ]
  const fragments = [
    buildMetadataFragment(input.attachment, rawPath, routingImage),
    ...projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: input.attachment.byteSize ?? input.attachment.raw?.byteSize ?? null,
        derivedPath: input.attachment.derived?.manifestPath ?? null,
        fileName: null,
        mime: input.attachment.mime ?? input.attachment.raw?.mediaType ?? null,
        storedPath: rawPath,
      },
      sources: evidenceSources,
    }),
  ]
  const combinedText = fragments
    .map((fragment) => `[${fragment.label}]\n${fragment.text}`)
    .join('\n\n')

  return inboxModelAttachmentBundleSchema.parse({
    attachmentId:
      input.attachment.sourceAttachmentId ??
      input.attachment.descriptorAttachmentId ??
      `attachment-${input.attachment.ordinal}`,
    ordinal: input.attachment.ordinal,
    kind: input.attachment.kind,
    mime: input.attachment.mime ?? input.attachment.raw?.mediaType ?? null,
    fileName: null,
    byteSize: input.attachment.byteSize ?? input.attachment.raw?.byteSize ?? null,
    storedPath: rawPath,
    parseState: normalizeAttachmentEvidenceParseState(input.attachment.parseState),
    routingImage,
    fragments,
    combinedText,
  })
}

export async function buildAssistantInputAttachmentModelBundles(input: {
  attachments: readonly AssistantInputAttachmentEvidenceItem[]
  vaultRoot: string
}): Promise<AssistantInputAttachmentModelBundle[]> {
  return Promise.all(
    input.attachments.map((attachment) =>
      buildAssistantInputAttachmentModelBundle({
        attachment,
        vaultRoot: input.vaultRoot,
      }),
    ),
  )
}

export function inferAssistantInputMultimodalInputMode(
  attachments: readonly AssistantInputAttachmentModelBundle[],
): InboxModelInputMode {
  return attachments.some((attachment) => attachment.routingImage.eligible)
    ? 'multimodal'
    : 'text-only'
}

export function hasAssistantInputAttachmentEvidenceCandidate(
  attachment: AssistantInputAttachmentEvidenceItem | AssistantInputAttachmentModelBundle,
): boolean {
  if ('routingImage' in attachment) {
    return attachment.routingImage.eligible
  }

  return getAttachmentEvidenceRoutingImageEligibility({
    attachment,
    rawPath: normalizeAssistantInputRawArtifactPath(attachment.raw?.path ?? null),
  }).eligible
}

export async function prepareAssistantInputMultimodalUserMessageContent(input: {
  attachmentSources: readonly AssistantInputAttachmentModelBundle[]
  fallbackContextLabel?: string
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
  prompt: string
  vaultRoot: string
}): Promise<{
  fallbackError: string | null
  inputMode: InboxModelInputMode
  userMessageContent: AssistantUserMessageContentPart[] | null
}> {
  const preparedInputMode = inferAssistantInputMultimodalInputMode(input.attachmentSources)
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
    onEvidenceReadFailure: input.onEvidenceReadFailure,
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
    content.push({
      type: 'text',
      text: `Attachment image ${item.ordinal}.`,
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
  }

  return {
    fallbackError: null,
    inputMode: 'multimodal',
    userMessageContent: content,
  }
}

function buildMetadataFragment(
  attachment: AssistantInputAttachmentEvidenceItem,
  rawPath: string | null,
  routingImage: RoutingImageEligibility,
) {
  const promptStoredPath = renderPromptStoredPath(rawPath)
  const metadataLines = [
    `attachmentId: ${attachment.sourceAttachmentId ?? attachment.descriptorAttachmentId ?? `attachment-${attachment.ordinal}`}`,
    `ordinal: ${attachment.ordinal}`,
    `kind: ${attachment.kind}`,
    `mime: ${attachment.mime ?? attachment.raw?.mediaType ?? 'unknown'}`,
    `byteSize: ${attachment.byteSize ?? attachment.raw?.byteSize ?? 'unknown'}`,
    `storedPath: ${promptStoredPath}`,
    `parseState: ${attachment.parseState ?? 'unknown'}`,
    ...(attachment.kind === 'image'
      ? [
          'automaticImageCodeScan: if parsing succeeds, image attachments are scanned for QR and barcode payloads; treat decoded values as available only when they appear in extracted text fragments',
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
    path: rawPath,
    text,
    truncated: false,
  }
}

function renderPromptStoredPath(rawPath: string | null): string {
  if (!rawPath) {
    return 'missing'
  }
  return rawPath.startsWith('raw/assistant-input/')
    ? rawPath
    : 'available'
}

function buildInlineTextSources(
  attachment: AssistantInputAttachmentEvidenceItem,
): ModelEvidenceSource[] {
  return attachment.inlineFragments.map((fragment) => ({
    kind: fragment.kind,
    label: fragment.label,
    path: attachment.derived?.manifestPath ?? attachment.raw?.path ?? null,
    text: fragment.text,
  }))
}

async function buildDerivedTextSources(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  vaultRoot: string
}): Promise<ModelEvidenceSource[]> {
  const derived = input.attachment.derived
  if (!derived) {
    return []
  }

  const normalizedManifestPath = normalizeAssistantInputDerivedArtifactPath(
    derived.manifestPath,
    derived.allowedRoot,
  )
  if (!normalizedManifestPath) {
    return []
  }

  const manifest = await readParserManifest(input.vaultRoot, normalizedManifestPath)
  if (!manifest) {
    return []
  }

  const sources: ModelEvidenceSource[] = []
  const plainTextPath = normalizeAssistantInputDerivedArtifactPath(
    manifest.paths.plainTextPath,
    derived.allowedRoot,
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

  const markdownPath = normalizeAssistantInputDerivedArtifactPath(
    manifest.paths.markdownPath,
    derived.allowedRoot,
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

  const tablesPath = normalizeAssistantInputDerivedArtifactPath(
    manifest.paths.tablesPath ?? null,
    derived.allowedRoot,
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

async function readPreparedRoutingEvidence(input: {
  attachmentSources: readonly AssistantInputAttachmentModelBundle[]
  fallbackContextLabel?: string
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
  vaultRoot: string
}): Promise<{
  error: string | null
  evidence: PreparedRoutingEvidence[]
}> {
  const evidence: PreparedRoutingEvidence[] = []
  const errors: string[] = []

  for (const attachment of input.attachmentSources) {
    const rawPath = normalizeAssistantInputRawArtifactPath(attachment.storedPath ?? null)
    if (!attachment.routingImage.eligible || !rawPath) {
      continue
    }

    try {
      const absolutePath = await resolveAssistantVaultPath(
        input.vaultRoot,
        rawPath,
        'file path',
      )
      const bytes = await readFile(absolutePath)
      evidence.push({
        kind: 'image',
        ordinal: attachment.ordinal,
            fileName: null,
        mediaType: attachment.routingImage.mediaType ?? null,
        bytes,
      })
    } catch {
      const details = `attachment ${attachment.ordinal} image evidence unavailable`
      errors.push(details)
      input.onEvidenceReadFailure?.({
        attachmentOrdinal: attachment.ordinal,
        details,
        errorCode: 'image_read_failed',
        kind: 'image',
      })
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

function getAttachmentEvidenceRoutingImageEligibility(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  rawPath: string | null
}): RoutingImageEligibility {
  return getRoutingImageEligibility({
    byteSize: input.attachment.byteSize ?? input.attachment.raw?.byteSize ?? null,
    fileName: null,
    kind: input.attachment.kind,
    mediaType: input.attachment.raw?.mediaType ?? null,
    mime: input.attachment.mime ?? input.attachment.raw?.mediaType ?? null,
    storedPath: input.rawPath,
  })
}

function normalizeAttachmentEvidenceParseState(
  value: AssistantInputAttachmentEvidenceItem['parseState'],
) {
  return value === 'unsupported' ? 'unsupported' : value ?? null
}

function normalizeAssistantInputRawArtifactPath(
  candidatePath: string | null | undefined,
): string | null {
  return normalizeAllowedVaultRelativePath(candidatePath, [
    'raw/inbox/',
    'raw/assistant-input/',
  ])
}

function normalizeAssistantInputDerivedArtifactPath(
  candidatePath: string | null | undefined,
  allowedRoot: string,
): string | null {
  const normalizedRoot = normalizeAllowedVaultRelativePath(allowedRoot, [
    'derived/inbox/',
    'derived/assistant-input/',
  ])
  if (!normalizedRoot) {
    return null
  }
  const normalizedCandidate = normalizeAllowedVaultRelativePath(candidatePath, [
    `${normalizedRoot}/`,
  ])
  if (!normalizedCandidate) {
    return null
  }
  return normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}/`)
    ? normalizedCandidate
    : null
}

function normalizeAllowedVaultRelativePath(
  candidatePath: string | null | undefined,
  allowedPrefixes: readonly string[],
): string | null {
  const normalizedCandidate = normalizeNullableString(candidatePath)
  if (!normalizedCandidate) {
    return null
  }
  try {
    if (
      normalizedCandidate.includes('\\') ||
      normalizedCandidate.includes('?') ||
      normalizedCandidate.includes('#')
    ) {
      return null
    }
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
