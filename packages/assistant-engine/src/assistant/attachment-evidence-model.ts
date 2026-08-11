import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import type { ParserOutput } from '@murphai/parsers'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import type {
  AssistantInputAttachmentEvidenceItem,
} from './input-store.js'
import type {
  AssistantWorkspaceArtifactMaterializer,
} from './execution-context.js'
import {
  type AssistantModelImageDetail,
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
const MAX_DERIVED_TEXT_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_PARSER_MANIFEST_BYTES = 1024 * 1024

export interface AssistantDerivedEvidenceReadBudget {
  remainingBytes: number
}

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
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
  vaultRoot: string
}): Promise<AssistantInputAttachmentPromptBundle> {
  return await buildAssistantInputAttachmentPromptBundleWithBudget({
    ...input,
    derivedEvidenceReadBudget: createAssistantDerivedEvidenceReadBudget(),
  })
}

async function buildAssistantInputAttachmentPromptBundleWithBudget(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  derivedEvidenceReadBudget: AssistantDerivedEvidenceReadBudget
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
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
  const derivedTextSources = useParserOutput
      ? await buildDerivedTextSourcesBestEffort({
        attachment: input.attachment,
        derivedEvidenceReadBudget: input.derivedEvidenceReadBudget,
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
        onEvidenceReadFailure: input.onEvidenceReadFailure,
        vaultRoot: input.vaultRoot,
      })
    : []
  const evidenceSources = useParserOutput
    ? [
        ...buildInlineTextSources(input.attachment),
        ...derivedTextSources,
      ]
    : []
  const fragments = [
    buildMetadataFragment(input.attachment, rawPath, routingImage, parseState),
    ...projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: input.attachment.byteSize ?? input.attachment.raw?.byteSize ?? null,
        derivedPath: useParserOutput
          ? getDerivedArtifactPath(input.attachment.derived)
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
  derivedEvidenceReadBudget?: AssistantDerivedEvidenceReadBudget
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
  vaultRoot: string
}): Promise<AssistantInputAttachmentPromptBundle[]> {
  const derivedEvidenceReadBudget =
    input.derivedEvidenceReadBudget ?? createAssistantDerivedEvidenceReadBudget()
  const bundles: AssistantInputAttachmentPromptBundle[] = []
  for (const attachment of input.attachments) {
    try {
      bundles.push(await buildAssistantInputAttachmentPromptBundleWithBudget({
        attachment,
        derivedEvidenceReadBudget,
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
        onEvidenceReadFailure: input.onEvidenceReadFailure,
        vaultRoot: input.vaultRoot,
      }))
    } catch {
      // Attachment evidence is best effort. Preserve successful bundles and
      // let the caller continue the accepted turn with available context.
    }
  }
  return bundles
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

  // Preserve fine visual evidence for one image without multiplying gallery cost.
  const imageDetail: AssistantModelImageDetail =
    routingEvidence.evidence.length === 1 ? 'original' : 'high'
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
      detail: imageDetail,
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
    path: getDerivedArtifactPath(attachment.derived) ?? attachment.raw?.path ?? null,
    text: fragment.text,
  }))
}

async function buildDerivedTextSourcesBestEffort(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  derivedEvidenceReadBudget: AssistantDerivedEvidenceReadBudget
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  onEvidenceReadFailure?: (failure: AssistantInputAttachmentEvidenceReadFailure) => void
  vaultRoot: string
}): Promise<ModelEvidenceSource[]> {
  try {
    return await buildDerivedTextSources({
      attachment: input.attachment,
      derivedEvidenceReadBudget: input.derivedEvidenceReadBudget,
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      vaultRoot: input.vaultRoot,
    })
  } catch {
    input.onEvidenceReadFailure?.({
      attachmentOrdinal: input.attachment.ordinal,
      details: `attachment ${input.attachment.ordinal} derived evidence unavailable`,
      errorCode: 'derived_read_failed',
      kind: 'derived',
    })
    return []
  }
}

async function buildDerivedTextSources(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  derivedEvidenceReadBudget: AssistantDerivedEvidenceReadBudget
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  vaultRoot: string
}): Promise<ModelEvidenceSource[]> {
  const derived = input.attachment.derived
  if (!derived) {
    return []
  }

  const normalizedArtifactPath = normalizeAssistantInputDerivedArtifactPath(
    getDerivedArtifactPath(derived),
    derived.allowedRoot,
  )
  if (!normalizedArtifactPath) {
    return []
  }

  if (derived.kind === 'parser-result') {
    const result = await readBoundedParserResult({
      budget: input.derivedEvidenceReadBudget,
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      resultPath: normalizedArtifactPath,
      vaultRoot: input.vaultRoot,
    })
    return result ? buildParserResultTextSources(result, normalizedArtifactPath) : []
  }

  const resultPath = normalizeAssistantInputDerivedArtifactPath(
    path.posix.join(path.posix.dirname(normalizedArtifactPath), 'result.json'),
    derived.allowedRoot,
  )
  if (resultPath) {
    const result = await readBoundedParserResult({
      budget: input.derivedEvidenceReadBudget,
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      resultPath,
      vaultRoot: input.vaultRoot,
    })
    if (result) {
      return buildParserResultTextSources(result, resultPath)
    }
  }

  const manifest = await materializeAndReadParserManifest({
    budget: input.derivedEvidenceReadBudget,
    manifestPath: normalizedArtifactPath,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
    vaultRoot: input.vaultRoot,
  })
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
        budget: input.derivedEvidenceReadBudget,
        limitBytes: MAX_DERIVED_TEXT_BYTES,
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
        budget: input.derivedEvidenceReadBudget,
        limitBytes: MAX_DERIVED_TEXT_BYTES,
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
      budget: input.derivedEvidenceReadBudget,
      limitBytes: MAX_DERIVED_TEXT_BYTES,
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

function buildParserResultTextSources(
  result: ParserOutput,
  resultPath: string,
): ModelEvidenceSource[] {
  const sources: ModelEvidenceSource[] = []
  const plainText = normalizeNullableString(result.text)
  if (plainText) {
    sources.push({
      kind: 'derived_plain_text',
      label: 'derived-plain-text',
      path: resultPath,
      text: plainText,
    })
  }

  const markdown = normalizeNullableString(result.markdown)
  if (markdown) {
    sources.push({
      kind: 'derived_markdown',
      label: 'derived-markdown',
      path: resultPath,
      text: markdown,
    })
  }

  if (result.tables.length > 0) {
    sources.push({
      kind: 'derived_tables',
      label: 'derived-tables',
      path: resultPath,
      text: JSON.stringify(result.tables),
    })
  }
  return sources
}

async function materializeAndReadParserManifest(input: {
  budget: AssistantDerivedEvidenceReadBudget
  manifestPath: string
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  vaultRoot: string
}): Promise<z.infer<typeof parserManifestSchema> | null> {
  const raw = await readMaterializedRelativeTextFile({
    budget: input.budget,
    limitBytes: MAX_PARSER_MANIFEST_BYTES,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
    relativePath: input.manifestPath,
    vaultRoot: input.vaultRoot,
  })
  if (!raw) {
    return null
  }
  try {
    return parserManifestSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

async function readBoundedParserResult(input: {
  budget: AssistantDerivedEvidenceReadBudget
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  resultPath: string
  vaultRoot: string
}): Promise<ParserOutput | null> {
  const maxBytes = resolveDerivedEvidenceReadLimit(input.budget, MAX_DERIVED_TEXT_BYTES)
  if (maxBytes === 0) {
    return null
  }
  await input.materializeWorkspaceArtifacts?.([input.resultPath], {
    maxFileBytes: maxBytes,
  })
  try {
    const absolutePath = await resolveAssistantVaultPath(input.vaultRoot, input.resultPath)
    const fileStats = await stat(absolutePath)
    if (!fileStats.isFile() || fileStats.size > maxBytes) {
      return null
    }
    input.budget.remainingBytes -= fileStats.size
    const { readParserResult } = await import('@murphai/parsers/parser-result')
    return await readParserResult({
      maxBytes,
      resultPath: input.resultPath,
      vaultRoot: input.vaultRoot,
    })
  } catch {
    return null
  }
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

function getDerivedArtifactPath(
  derived: AssistantInputAttachmentEvidenceItem['derived'],
): string | null {
  if (!derived) {
    return null
  }
  return derived.kind === 'parser-result'
    ? derived.resultPath
    : derived.manifestPath
}

async function readMaterializedRelativeTextFile(input: {
  budget: AssistantDerivedEvidenceReadBudget
  limitBytes: number
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  relativePath: string
  vaultRoot: string
}): Promise<string | null> {
  const maxBytes = resolveDerivedEvidenceReadLimit(input.budget, input.limitBytes)
  if (maxBytes === 0) {
    return null
  }
  await input.materializeWorkspaceArtifacts?.([input.relativePath], {
    maxFileBytes: maxBytes,
  })
  try {
    const absolutePath = await resolveAssistantVaultPath(input.vaultRoot, input.relativePath)
    const fileStats = await stat(absolutePath)
    if (!fileStats.isFile() || fileStats.size > maxBytes) {
      return null
    }
    input.budget.remainingBytes -= fileStats.size
    return normalizeNullableString(await readFile(absolutePath, 'utf8'))
  } catch {
    return null
  }
}

export function createAssistantDerivedEvidenceReadBudget(): AssistantDerivedEvidenceReadBudget {
  return { remainingBytes: MAX_DERIVED_TEXT_TOTAL_BYTES }
}

function resolveDerivedEvidenceReadLimit(
  budget: AssistantDerivedEvidenceReadBudget,
  perFileLimit: number,
): number {
  return Math.max(0, Math.min(budget.remainingBytes, perFileLimit))
}
