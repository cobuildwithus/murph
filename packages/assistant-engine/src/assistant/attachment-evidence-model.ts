import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import {
  normalizeRelativeVaultPath,
} from '@murphai/core'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import type {
  AssistantInputAttachmentEvidenceItem,
} from './input-store.js'
import type {
  AssistantWorkspaceArtifactMaterializer,
} from './execution-context.js'
import {
  type AssistantUserMessageContentPart,
} from './content-types.js'
import {
  inboxModelAttachmentBundleSchema,
  type InboxModelAttachmentBundle,
  type InboxModelInputMode,
} from '../inbox-model-contracts.js'
import {
  MAX_NATIVE_ROUTING_IMAGE_BYTES,
  MAX_NATIVE_ROUTING_IMAGE_TOTAL_BYTES,
  getRoutingImageEligibility,
  renderNativeRoutingImageSizeBucket,
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

const MAX_DERIVED_TEXT_BYTES = 16 * 1024 * 1024
const MAX_PARSER_MANIFEST_BYTES = 1024 * 1024

interface PreparedRoutingImage {
  kind: 'image'
  ordinal: number
  fileName: string | null
  mediaType: string | null
  bytes: Buffer
}

type PreparedRoutingEvidence = PreparedRoutingImage

export type AssistantInputAttachmentModelBundle = InboxModelAttachmentBundle

export type AssistantInputAttachmentModelBundleSource =
  | AssistantInputAttachmentModelBundle
  | {
      bundle: AssistantInputAttachmentModelBundle
      inputId: string
    }

interface NormalizedAssistantInputAttachmentModelBundleSource {
  bundle: AssistantInputAttachmentModelBundle
  inputId: string | null
}

export interface AssistantInputAttachmentEvidenceReadFailure {
  attachmentOrdinal: number
  details: string
  errorCode: string
  inputId?: string
  kind: 'image' | 'raw' | 'derived'
}

export async function buildAssistantInputAttachmentModelBundle(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  vaultRoot: string
}): Promise<AssistantInputAttachmentModelBundle> {
  const rawPath = normalizeAssistantInputRawArtifactPath(input.attachment.raw?.path ?? null)
  const routingImage = getAttachmentEvidenceRoutingImageEligibility({
    attachment: input.attachment,
    rawPath,
  })
  const shouldRedactImageReference = shouldRedactNativeImageReference({
    kind: input.attachment.kind,
    routingImage,
  })
  const evidenceSources = [
    ...buildInlineTextSources(input.attachment),
    ...(await buildDerivedTextSources({
      attachment: input.attachment,
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      vaultRoot: input.vaultRoot,
    })),
  ]
  const modelEvidenceSources = shouldRedactImageReference
    ? redactModelEvidenceSourcePaths(evidenceSources)
    : evidenceSources
  const fragments = [
    buildMetadataFragment(input.attachment, rawPath, routingImage),
    ...projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: shouldRedactImageReference
          ? null
          : input.attachment.byteSize ?? input.attachment.raw?.byteSize ?? null,
        derivedPath: input.attachment.derived?.manifestPath ?? null,
        fileName: shouldRedactImageReference ? null : input.attachment.fileName,
        mime: input.attachment.mime ?? input.attachment.raw?.mediaType ?? null,
        storedPath: shouldRedactImageReference ? null : rawPath,
      },
      sources: modelEvidenceSources,
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
    fileName: input.attachment.fileName,
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
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  vaultRoot: string
}): Promise<AssistantInputAttachmentModelBundle[]> {
  return Promise.all(
    input.attachments.map((attachment) =>
      buildAssistantInputAttachmentModelBundle({
        attachment,
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
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
  attachmentSources: readonly AssistantInputAttachmentModelBundleSource[]
  fallbackContextLabel?: string
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
  prompt: string
  vaultRoot: string
}): Promise<{
  fallbackError: string | null
  inputMode: InboxModelInputMode
  userMessageContent: AssistantUserMessageContentPart[] | null
}> {
  const attachmentSources = normalizeAttachmentModelBundleSources(
    input.attachmentSources,
  )
  const preparedInputMode = inferAssistantInputMultimodalInputMode(
    attachmentSources.map((source) => source.bundle),
  )
  if (preparedInputMode === 'text-only') {
    return {
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    }
  }

  const routingEvidence = await readPreparedRoutingEvidence({
    attachmentSources,
    fallbackContextLabel: input.fallbackContextLabel,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
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

  if (routingEvidence.unavailableImageCount > 0) {
    content.push({
      type: 'text',
      text: 'Some image attachments could not be loaded; only available image evidence was attached.',
    })
  }

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

function normalizeAttachmentModelBundleSources(
  sources: readonly AssistantInputAttachmentModelBundleSource[],
): NormalizedAssistantInputAttachmentModelBundleSource[] {
  return sources.map((source) => {
    if ('bundle' in source) {
      return {
        bundle: source.bundle,
        inputId: normalizeNullableString(source.inputId),
      }
    }

    return {
      bundle: source,
      inputId: null,
    }
  })
}

function buildMetadataFragment(
  attachment: AssistantInputAttachmentEvidenceItem,
  rawPath: string | null,
  routingImage: RoutingImageEligibility,
) {
  const shouldRedactImageReference = shouldRedactNativeImageReference({
    kind: attachment.kind,
    routingImage,
  })
  const promptStoredPath = shouldRedactImageReference
    ? null
    : renderPromptStoredPath(rawPath)
  const byteSize = attachment.byteSize ?? attachment.raw?.byteSize ?? null
  const metadataLines = [
    `ordinal: ${attachment.ordinal}`,
    `kind: ${attachment.kind}`,
    shouldRedactImageReference
      ? null
      : `fileName: ${attachment.fileName ?? 'unknown'}`,
    `mime: ${attachment.mime ?? attachment.raw?.mediaType ?? 'unknown'}`,
    shouldRedactImageReference
      ? `byteSizeBucket: ${renderNativeRoutingImageSizeBucket(byteSize)}`
      : `byteSize: ${byteSize ?? 'unknown'}`,
    promptStoredPath ? `storedPath: ${promptStoredPath}` : null,
    `parseState: ${attachment.parseState ?? 'unknown'}`,
    ...(attachment.kind === 'image'
      ? [
          'automaticImageCodeScan: if parsing succeeds, image attachments are scanned for QR and barcode payloads; treat decoded values as available only when they appear in extracted text fragments',
        ]
      : []),
    shouldRedactImageReference
      ? 'nativeImageEvidence: omitted_non_addressable'
      : null,
    `routingImageEligible: ${String(routingImage.eligible)}`,
    `routingImageReason: ${routingImage.reason}`,
    `routingImageMediaType: ${routingImage.mediaType ?? 'unknown'}`,
    `routingImageExtension: ${routingImage.extension ?? 'unknown'}`,
  ].filter((line): line is string => line !== null)
  const text = metadataLines.join('\n')
  return {
    kind: 'attachment_metadata' as const,
    label: `attachment-${attachment.ordinal}-metadata`,
    path: shouldRedactImageReference ? null : rawPath,
    text,
    truncated: false,
  }
}

function renderPromptStoredPath(rawPath: string | null): string {
  if (!rawPath) {
    return 'missing'
  }

  return rawPath.startsWith('raw/assistant-input/') ||
    rawPath.startsWith('raw/inbox/')
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
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
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

  await input.materializeWorkspaceArtifacts?.([normalizedManifestPath])
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
    ? await readMaterializedRelativeTextFile({
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
        relativePath: plainTextPath,
        vaultRoot: input.vaultRoot,
      })
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
    ? await readMaterializedRelativeTextFile({
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
        relativePath: markdownPath,
        vaultRoot: input.vaultRoot,
      })
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
    const tables = await readMaterializedRelativeTextFile({
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      relativePath: tablesPath,
      vaultRoot: input.vaultRoot,
    })
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
  attachmentSources: readonly NormalizedAssistantInputAttachmentModelBundleSource[]
  fallbackContextLabel?: string
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
  vaultRoot: string
}): Promise<{
  error: string | null
  evidence: PreparedRoutingEvidence[]
  unavailableImageCount: number
}> {
  const evidence: PreparedRoutingEvidence[] = []
  const errors: string[] = []
  let totalImageBytes = 0

  for (const source of input.attachmentSources) {
    const attachment = source.bundle
    const rawPath = normalizeAssistantInputRawArtifactPath(attachment.storedPath ?? null)
    if (!attachment.routingImage.eligible || !rawPath) {
      continue
    }

    try {
      await input.materializeWorkspaceArtifacts?.([rawPath])
      const absolutePath = await resolveAssistantVaultPath(
        input.vaultRoot,
        rawPath,
        'file path',
      )
      const fileStats = await stat(absolutePath)
      if (!fileStats.isFile()) {
        throw new TypeError('Attachment image evidence path is not a file.')
      }
      if (
        fileStats.size > MAX_NATIVE_ROUTING_IMAGE_BYTES ||
        totalImageBytes + fileStats.size > MAX_NATIVE_ROUTING_IMAGE_TOTAL_BYTES
      ) {
        throw new RangeError('Attachment image evidence exceeded the native image input budget.')
      }
      const bytes = await readFile(absolutePath)
      if (bytes.byteLength > MAX_NATIVE_ROUTING_IMAGE_BYTES) {
        throw new RangeError('Attachment image evidence exceeded the native image input budget.')
      }
      totalImageBytes += bytes.byteLength
      evidence.push({
        kind: 'image',
        ordinal: attachment.ordinal,
        fileName: attachment.fileName,
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
        ...(source.inputId ? { inputId: source.inputId } : {}),
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
    unavailableImageCount: errors.length,
  }
}

function getAttachmentEvidenceRoutingImageEligibility(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  rawPath: string | null
}): RoutingImageEligibility {
  return getRoutingImageEligibility({
    byteSize: input.attachment.byteSize ?? input.attachment.raw?.byteSize ?? null,
    fileName: input.attachment.fileName,
    kind: input.attachment.kind,
    mediaType: input.attachment.raw?.mediaType ?? null,
    mime: input.attachment.mime ?? input.attachment.raw?.mediaType ?? null,
    storedPath: input.rawPath,
  })
}

function shouldRedactNativeImageReference(input: {
  kind: AssistantInputAttachmentEvidenceItem['kind']
  routingImage: RoutingImageEligibility
}): boolean {
  return input.kind === 'image'
}

function redactModelEvidenceSourcePaths(
  sources: readonly ModelEvidenceSource[],
): ModelEvidenceSource[] {
  return sources.map((source) => ({
    ...source,
    path: null,
  }))
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
    const raw = await readBoundedRelativeTextFile({
      limitBytes: MAX_PARSER_MANIFEST_BYTES,
      relativePath,
      vaultRoot,
    })
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
      await readBoundedRelativeTextFile({
        limitBytes: MAX_DERIVED_TEXT_BYTES,
        relativePath,
        vaultRoot,
      }),
    )
  } catch {
    return null
  }
}

async function readMaterializedRelativeTextFile(input: {
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  relativePath: string
  vaultRoot: string
}): Promise<string | null> {
  await input.materializeWorkspaceArtifacts?.([input.relativePath])
  return await readRelativeTextFile(input.vaultRoot, input.relativePath)
}

async function readBoundedRelativeTextFile(input: {
  limitBytes: number
  relativePath: string
  vaultRoot: string
}): Promise<string> {
  const absolutePath = await resolveAssistantVaultPath(input.vaultRoot, input.relativePath)
  const fileStats = await stat(absolutePath)
  if (!fileStats.isFile()) {
    throw new TypeError('Attachment evidence path is not a file.')
  }
  if (fileStats.size > input.limitBytes) {
    throw new RangeError('Attachment evidence exceeded the text read budget.')
  }

  return await readFile(absolutePath, 'utf8')
}
