import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
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
  attachmentPromptBundleSchema,
  type AttachmentPromptBundle,
  type AttachmentPromptInputMode,
} from '../attachment-prompt-contracts.js'
import {
  getRoutingImageEligibility,
  type RoutingImageEligibility,
} from '../inbox-routing-vision.js'
import {
  projectAttachmentEvidenceForModel,
  type ModelEvidenceSource,
} from '../inbox-evidence-projection.js'
import {
  normalizeAllowedAssistantAttachmentArtifactPath,
  normalizeAssistantDerivedAttachmentArtifactPath,
  normalizeAssistantRawAttachmentArtifactPath,
} from './attachment-artifact-paths.js'

const parserManifestSchema = z.object({
  schema: z.literal('murph.parser-manifest.v1'),
  paths: z.object({
    plainTextPath: z.string().min(1),
    markdownPath: z.string().min(1),
    tablesPath: z.string().min(1).nullable().optional(),
  }),
})

const MAX_ROUTING_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_ROUTING_IMAGE_TOTAL_BYTES = 200 * 1024 * 1024
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

export type AssistantInputAttachmentPromptBundle = AttachmentPromptBundle

export type AssistantInputAttachmentPromptBundleSource =
  | AssistantInputAttachmentPromptBundle
  | {
      bundle: AssistantInputAttachmentPromptBundle
      inputId: string
    }

interface NormalizedAssistantInputAttachmentPromptBundleSource {
  bundle: AssistantInputAttachmentPromptBundle
  inputId: string | null
}

export interface AssistantInputAttachmentEvidenceReadFailure {
  attachmentOrdinal: number
  details: string
  errorCode: string
  inputId?: string
  kind: 'image' | 'raw' | 'derived'
}

export async function buildAssistantInputAttachmentPromptBundle(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  vaultRoot: string
}): Promise<AssistantInputAttachmentPromptBundle> {
  const rawPath = await resolveAvailableAssistantInputRawArtifactPath({
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
    rawPath: input.attachment.raw?.path ?? null,
    vaultRoot: input.vaultRoot,
  })
  const routingImage = getAttachmentEvidenceRoutingImageEligibility({
    attachment: input.attachment,
    rawPath,
  })
  const useParserOutput = shouldUseAttachmentParserOutput(input.attachment.kind)
  const parseState = useParserOutput
    ? normalizeAttachmentEvidenceParseState(input.attachment.parseState)
    : null
  const evidenceSources = useParserOutput
    ? [
        ...buildInlineTextSources(input.attachment),
        ...(await buildDerivedTextSources({
          attachment: input.attachment,
          materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
          vaultRoot: input.vaultRoot,
        })),
      ]
    : []
  const fragments = [
    buildMetadataFragment(input.attachment, rawPath, routingImage, parseState),
    ...projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: input.attachment.byteSize ?? input.attachment.raw?.byteSize ?? null,
        derivedPath: useParserOutput
          ? input.attachment.derived?.manifestPath ?? null
          : null,
        fileName: input.attachment.fileName,
        mime: input.attachment.mime ?? input.attachment.raw?.mediaType ?? null,
        storedPath: rawPath,
      },
      sources: evidenceSources,
    }),
  ]
  const combinedText = fragments
    .map((fragment) => `[${fragment.label}]\n${fragment.text}`)
    .join('\n\n')

  return attachmentPromptBundleSchema.parse({
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
    parseState,
    routingImage,
    fragments,
    combinedText,
  })
}

export async function buildAssistantInputAttachmentPromptBundles(input: {
  attachments: readonly AssistantInputAttachmentEvidenceItem[]
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  vaultRoot: string
}): Promise<AssistantInputAttachmentPromptBundle[]> {
  return Promise.all(
    input.attachments.map((attachment) =>
      buildAssistantInputAttachmentPromptBundle({
        attachment,
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
        vaultRoot: input.vaultRoot,
      }),
    ),
  )
}

export function inferAssistantInputMultimodalInputMode(
  attachments: readonly AssistantInputAttachmentPromptBundle[],
): AttachmentPromptInputMode {
  return attachments.some((attachment) => attachment.routingImage.eligible)
    ? 'multimodal'
    : 'text-only'
}

export function hasAssistantInputAttachmentEvidenceCandidate(
  attachment: AssistantInputAttachmentEvidenceItem | AssistantInputAttachmentPromptBundle,
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
  attachmentSources: readonly AssistantInputAttachmentPromptBundleSource[]
  fallbackContextLabel?: string
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
  prompt: string
  vaultRoot: string
}): Promise<{
  fallbackError: string | null
  inputMode: AttachmentPromptInputMode
  userMessageContent: AssistantUserMessageContentPart[] | null
}> {
  const attachmentSources = normalizeAttachmentPromptBundleSources(
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
      text: item.fileName
        ? `Attachment image ${item.ordinal} (${item.fileName}).`
        : `Attachment image ${item.ordinal}.`,
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

function normalizeAttachmentPromptBundleSources(
  sources: readonly AssistantInputAttachmentPromptBundleSource[],
): NormalizedAssistantInputAttachmentPromptBundleSource[] {
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
  parseState: AssistantInputAttachmentPromptBundle['parseState'],
) {
  const promptStoredPath = renderPromptStoredPath(rawPath)
  const metadataLines = [
    `ordinal: ${attachment.ordinal}`,
    `kind: ${attachment.kind}`,
    `fileName: ${attachment.fileName ?? 'unknown'}`,
    `mime: ${attachment.mime ?? attachment.raw?.mediaType ?? 'unknown'}`,
    `byteSize: ${attachment.byteSize ?? attachment.raw?.byteSize ?? 'unknown'}`,
    `storedPath: ${promptStoredPath}`,
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
    path: rawPath,
    text,
    truncated: false,
  }
}

function shouldUseAttachmentParserOutput(
  kind: AssistantInputAttachmentEvidenceItem['kind'],
): boolean {
  return kind === 'audio' || kind === 'video'
}

function renderPromptStoredPath(rawPath: string | null): string {
  if (!rawPath) {
    return 'missing'
  }

  return rawPath.startsWith('raw/inbox/')
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
  attachmentSources: readonly NormalizedAssistantInputAttachmentPromptBundleSource[]
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
        fileStats.size > MAX_ROUTING_IMAGE_BYTES ||
        totalImageBytes + fileStats.size > MAX_ROUTING_IMAGE_TOTAL_BYTES
      ) {
        throw new RangeError('Attachment image evidence exceeded the model input budget.')
      }
      const bytes = await readFile(absolutePath)
      if (bytes.byteLength > MAX_ROUTING_IMAGE_BYTES) {
        throw new RangeError('Attachment image evidence exceeded the model input budget.')
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

function normalizeAttachmentEvidenceParseState(
  value: AssistantInputAttachmentEvidenceItem['parseState'],
) {
  return value === 'unsupported' ? 'unsupported' : value ?? null
}

function normalizeAssistantInputRawArtifactPath(
  candidatePath: string | null | undefined,
): string | null {
  return normalizeAssistantRawAttachmentArtifactPath(candidatePath)
}

async function resolveAvailableAssistantInputRawArtifactPath(input: {
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  rawPath: string | null | undefined
  vaultRoot: string
}): Promise<string | null> {
  const rawPath = normalizeAssistantInputRawArtifactPath(input.rawPath)
  if (!rawPath) {
    return null
  }

  try {
    await input.materializeWorkspaceArtifacts?.([rawPath])
    const absolutePath = await resolveAssistantVaultPath(
      input.vaultRoot,
      rawPath,
      'file path',
    )
    const fileStats = await stat(absolutePath)
    return fileStats.isFile() ? rawPath : null
  } catch {
    return null
  }
}

function normalizeAssistantInputDerivedArtifactPath(
  candidatePath: string | null | undefined,
  allowedRoot: string,
): string | null {
  const normalizedRoot = normalizeAssistantDerivedAttachmentArtifactPath(allowedRoot)
  if (!normalizedRoot) {
    return null
  }
  const normalizedCandidate = normalizeAllowedAssistantAttachmentArtifactPath(
    candidatePath,
    [`${normalizedRoot}/`],
  )
  if (!normalizedCandidate) {
    return null
  }
  return normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}/`)
    ? normalizedCandidate
    : null
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
