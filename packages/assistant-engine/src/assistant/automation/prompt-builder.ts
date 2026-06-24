import type { AssistantUserMessageContentPart } from '../content-types.js'
import type {
  AssistantWorkspaceArtifactMaterializer,
} from '../execution-context.js'
import type {
  AssistantInputAttachmentEvidence,
  AssistantInputAttachmentEvidenceItem,
  AssistantInputAttachmentDescriptor,
  AssistantInputConversationRef,
  AssistantInputProjectionStatus,
  AssistantInputReplyTarget,
  AssistantInputSourceMetadata,
} from '../input-store.js'
import type { AssistantRunEvent } from './shared.js'
import {
  buildAssistantInputAttachmentPromptBundles,
  hasAssistantInputAttachmentEvidenceCandidate,
  prepareAssistantInputMultimodalUserMessageContent,
  type AssistantInputAttachmentPromptBundle,
  type AssistantInputAttachmentPromptBundleSource,
} from '../attachment-evidence-model.js'
import { normalizeAssistantRawAttachmentArtifactPath } from '../attachment-artifact-paths.js'
import { normalizeNullableString } from '../shared.js'

const MAX_INLINE_ATTACHMENT_TEXT_CHARS = 2000
const MAX_ATTACHMENT_TEXT_EXCERPT_CHARS = 600
const RAW_ATTACHMENT_FILE_INSTRUCTION =
  'Raw attachment file is available at the storedPath above. Inspect the local file with tools when needed; do not claim file contents unless you have inspected the file or the contents are otherwise present in this turn.'
const PDF_ATTACHMENT_FILE_INSTRUCTION =
  'For PDFs, inspect the storedPath with local PDF tools when needed.'

export interface TelegramAutoReplyMetadata {
  mediaGroupId: string | null
  messageId: string | null
  replyContext: string | null
}

export interface AssistantAutoReplyPromptProjection {
  optionalInboxCaptureId: string | null
  reasonCode: string | null
  status: AssistantInputProjectionStatus
}

export interface AssistantAutoReplyPromptInput {
  actorIsSelf: boolean
  attachmentDescriptors: readonly AssistantInputAttachmentDescriptor[]
  attachmentEvidence: AssistantInputAttachmentEvidence
  conversation: AssistantInputConversationRef
  inputId: string
  occurredAt: string
  projection: AssistantAutoReplyPromptProjection | null
  receivedAt: string | null
  replyTarget: AssistantInputReplyTarget | null
  source: string
  sourceMetadata: AssistantInputSourceMetadata | null
  telegramMetadata: TelegramAutoReplyMetadata | null
  text: string | null
}

export type AssistantAutoReplyPrompt =
  | { kind: 'defer'; reason: string }
  | { kind: 'ready'; prompt: string }
  | { kind: 'skip'; reason: string }

export type AssistantAutoReplyPreparedInput =
  | { kind: 'defer'; reason: string }
  | {
      kind: 'ready'
      prompt: string
      userMessageContent: AssistantUserMessageContentPart[] | null
    }
  | { kind: 'skip'; reason: string }

type AssistantAutoReplyPromptInputWithBundles = AssistantAutoReplyPromptInput & {
  attachmentBundles: readonly AssistantInputAttachmentPromptBundle[]
}

/**
 * Synchronous renderer for tests and diagnostics. Production auto-reply
 * execution should use prepareAssistantAutoReplyInput() so derived manifests and
 * file-backed attachment bundles are materialized before prompt construction.
 */
export function buildAssistantAutoReplyPrompt(
  inputs: readonly AssistantAutoReplyPromptInput[],
): AssistantAutoReplyPrompt {
  const sections = inputs
    .map((entry, index) => {
      const attachmentSections = buildAssistantAutoReplyAttachmentSections({
        lifecycleSection: renderAssistantInputAttachmentDescriptorPromptSection({
          attachments: entry.attachmentEvidence.attachments,
          descriptors: entry.attachmentDescriptors,
          evidenceReasonCode: entry.attachmentEvidence.reasonCode,
          evidenceStatus: entry.attachmentEvidence.status,
          projectionReasonCode: entry.projection?.reasonCode ?? null,
          projectionStatus: entry.projection?.status ?? null,
        }),
        renderedAttachmentSections: entry.attachmentEvidence.attachments
          .map((attachment) => renderAttachmentEvidencePromptSection(attachment))
          .filter((section): section is string => section !== null),
      })
      return renderAssistantAutoReplyInputSection({
        attachmentSections,
        evidenceReasonCode: entry.attachmentEvidence.reasonCode,
        evidenceStatus: entry.attachmentEvidence.status,
        hasAttachmentContext: hasAssistantInputAttachmentContext(entry),
        inputText: normalizeNullableString(entry.text),
        index,
        promptUnavailableNote: renderAssistantInputPromptUnavailableNote(entry),
        projectionReasonCode: entry.projection?.reasonCode ?? null,
        projectionStatus: entry.projection?.status ?? null,
        replyContext: entry.telegramMetadata?.replyContext ?? null,
        totalInputs: inputs.length,
      })
    })
    .filter((section): section is string => section !== null)

  if (sections.length === 0 || inputs.length === 0) {
    return {
      kind: 'skip',
      reason: 'input has no text or attachment context',
    }
  }

  return {
    kind: 'ready',
    prompt: buildAssistantAutoReplyPromptText(inputs, sections),
  }
}

export async function prepareAssistantAutoReplyInput(
  inputs: readonly AssistantAutoReplyPromptInput[],
  vaultRoot: string,
  options: {
    materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
    onEvent?: (event: AssistantRunEvent) => void
  } = {},
): Promise<AssistantAutoReplyPreparedInput> {
  const preparedInputs = await Promise.all(
    inputs.map(async (entry) => ({
      ...entry,
      attachmentBundles: await buildPromptAttachmentBundlesBestEffort({
        entry,
        materializeWorkspaceArtifacts: options.materializeWorkspaceArtifacts,
        onEvent: options.onEvent,
        vaultRoot,
      }),
    })),
  )
  const textualSections = preparedInputs
    .map((entry, index) => {
      const attachmentSections = buildAssistantAutoReplyAttachmentSections({
        lifecycleSection: renderAssistantInputAttachmentDescriptorPromptSection({
          attachmentBundles: entry.attachmentBundles,
          attachments: entry.attachmentEvidence.attachments,
          descriptors: entry.attachmentDescriptors,
          evidenceReasonCode: entry.attachmentEvidence.reasonCode,
          evidenceStatus: entry.attachmentEvidence.status,
          projectionReasonCode: entry.projection?.reasonCode ?? null,
          projectionStatus: entry.projection?.status ?? null,
        }),
        renderedAttachmentSections: entry.attachmentBundles
          .map((attachment) => renderPreparedAttachmentPromptSection(attachment))
          .filter((section): section is string => section !== null),
      })
      return renderAssistantAutoReplyInputSection({
        attachmentSections,
        evidenceReasonCode: entry.attachmentEvidence.reasonCode,
        evidenceStatus: entry.attachmentEvidence.status,
        hasAttachmentContext: hasAssistantInputAttachmentContext(entry),
        inputText: normalizeNullableString(entry.text),
        index,
        promptUnavailableNote: renderAssistantInputPromptUnavailableNote(entry),
        projectionReasonCode: entry.projection?.reasonCode ?? null,
        projectionStatus: entry.projection?.status ?? null,
        replyContext: entry.telegramMetadata?.replyContext ?? null,
        totalInputs: preparedInputs.length,
      })
    })
    .filter((section): section is string => section !== null)

  const hasTextualContent = textualSections.length > 0
  const nextPrompt = buildAssistantAutoReplyPromptText(inputs, textualSections)
  const attachmentSources = buildPreparedAttachmentSources(preparedInputs)

  const preparedMultimodalInput =
    await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources,
      materializeWorkspaceArtifacts: options.materializeWorkspaceArtifacts,
      onEvidenceReadFailure(failure) {
        options.onEvent?.({
          type: 'input.reply-progress',
          inputId: failure.inputId ?? inputs[0]?.inputId,
          details: 'nonblocking attachment evidence read failed',
          errorCode: failure.errorCode,
          failureContext: {
            attachmentOrdinal: failure.attachmentOrdinal,
          },
          safeDetails: 'attachment_evidence_read_failed_nonblocking',
          providerKind: 'status',
          providerState: 'completed',
        })
      },
      prompt: nextPrompt,
      vaultRoot,
    })

  if (!hasTextualContent && preparedMultimodalInput.userMessageContent === null) {
    return {
      kind: 'skip',
      reason:
        preparedMultimodalInput.fallbackError ??
        'input has no text or attachment context',
    }
  }

  return {
    kind: 'ready',
    prompt: nextPrompt,
    userMessageContent: preparedMultimodalInput.userMessageContent,
  }
}

export function readTelegramAutoReplyMetadataFromAssistantInput(input: {
  replyTarget?: AssistantInputReplyTarget | null
  sourceMetadata?: AssistantInputSourceMetadata | null
}): TelegramAutoReplyMetadata | null {
  const metadata = input.sourceMetadata
  if (metadata?.kind !== 'telegram') {
    return null
  }

  const messageId =
    normalizeNullableString(input.replyTarget?.channel) === 'telegram'
      ? normalizeNullableString(input.replyTarget?.messageId)
      : null
  const result: TelegramAutoReplyMetadata = {
    mediaGroupId: normalizeNullableString(metadata.mediaGroupId),
    messageId,
    replyContext: normalizeNullableString(metadata.replyContext),
  }

  return result.mediaGroupId || result.messageId || result.replyContext
    ? result
    : null
}

export function renderAssistantInputAttachmentDescriptorPromptSection(input: {
  attachmentBundles?: readonly AssistantInputAttachmentPromptBundle[]
  attachments?: readonly AssistantInputAttachmentEvidenceItem[]
  descriptors: readonly AssistantInputAttachmentDescriptor[]
  evidenceReasonCode?: string | null
  evidenceStatus?: AssistantInputAttachmentEvidence['status'] | null
  projectionReasonCode?: string | null
  projectionStatus?: AssistantInputProjectionStatus | null
}): string | null {
  const attachments = input.attachments ?? []
  const rawPathByOrdinal = buildLifecycleRawPathByOrdinal(input.attachmentBundles)
  if (input.descriptors.length === 0 && attachments.length === 0) {
    return null
  }

  return [
    'Attachment evidence:',
    `- provider descriptors: ${input.descriptors.length}`,
    `- inbox projection: ${renderAssistantInputProjectionLifecycleStatus({
      projectionReasonCode: input.projectionReasonCode ?? null,
      projectionStatus: input.projectionStatus ?? null,
    })}`,
    `- raw evidence: ${renderAssistantInputRawEvidenceLifecycleStatus({
      attachments,
      evidenceStatus: input.evidenceStatus ?? null,
      rawPathByOrdinal,
    })}`,
    renderAssistantInputAttachmentLifecycleDetails({
      attachments,
      descriptors: input.descriptors,
      rawPathByOrdinal,
    }),
  ]
    .filter((line): line is string => line !== null && line.length > 0)
    .join('\n')
}

function renderAssistantAutoReplyInputSection(input: {
  attachmentSections: readonly string[]
  evidenceReasonCode: string | null
  evidenceStatus: AssistantInputAttachmentEvidence['status']
  hasAttachmentContext: boolean
  inputText: string | null
  index: number
  promptUnavailableNote: string | null
  projectionReasonCode?: string | null
  projectionStatus?: AssistantInputProjectionStatus | null
  replyContext: string | null
  totalInputs: number
}): string | null {
  const sections: string[] = []
  if (input.replyContext) {
    sections.push(`Reply context:\n${input.replyContext}`)
  }
  const projectionNote = input.hasAttachmentContext && input.attachmentSections.length === 0
    ? renderAssistantInputProjectionPromptNote({
        evidenceReasonCode: input.evidenceReasonCode,
        evidenceStatus: input.evidenceStatus,
        projectionReasonCode: input.projectionReasonCode ?? null,
        projectionStatus: input.projectionStatus ?? null,
      })
    : null
  if (projectionNote) {
    sections.push(`Message evidence:\n${projectionNote}`)
  }
  if (input.promptUnavailableNote) {
    sections.push(`Message availability:\n${input.promptUnavailableNote}`)
  }
  if (input.inputText) {
    sections.push(`Message text:\n${input.inputText}`)
  }
  if (input.attachmentSections.length > 0) {
    sections.push(`Attachment context:\n${input.attachmentSections.join('\n\n')}`)
  }

  if (sections.length === 0) {
    return null
  }

  if (input.totalInputs === 1) {
    return sections.join('\n\n')
  }

  return `Input ${input.index + 1}:\n${sections.join('\n\n')}`
}

function hasAssistantInputAttachmentContext(input: AssistantAutoReplyPromptInput): boolean {
  return input.attachmentDescriptors.length > 0 || input.attachmentEvidence.attachments.length > 0
}

function buildAssistantAutoReplyAttachmentSections(input: {
  lifecycleSection: string | null
  renderedAttachmentSections: readonly string[]
}): string[] {
  if (input.lifecycleSection) {
    return [input.lifecycleSection, ...input.renderedAttachmentSections]
  }

  return [...input.renderedAttachmentSections]
}

function renderAttachmentEvidencePromptSection(
  attachment: AssistantInputAttachmentEvidenceItem,
): string | null {
  const includeParserEvidence = shouldRenderAttachmentParserEvidence(attachment.kind)
  const storedPathLine = renderAttachmentEvidencePromptStoredPath(attachment)
  const derivedManifestPath = includeParserEvidence
    ? normalizeNullableString(attachment.derived?.manifestPath ?? null)
    : null
  const metadataLines = [
    attachment.fileName ? `fileName: ${attachment.fileName}` : null,
    attachment.mime ? `mime: ${attachment.mime}` : null,
    typeof attachment.byteSize === 'number' ? `byteSize: ${attachment.byteSize}` : null,
    storedPathLine,
    derivedManifestPath ? `derivedManifestPath: ${derivedManifestPath}` : null,
    includeParserEvidence && attachment.parseState
      ? `parseState: ${attachment.parseState}`
      : null,
  ].filter((line): line is string => line !== null)
  const chunks: string[] = []
  const omittedKinds: string[] = []
  const inlineFragments = includeParserEvidence ? attachment.inlineFragments : []

  for (const fragment of inlineFragments) {
    const title = renderInlineAttachmentFragmentTitle(fragment.kind)
    if (fragment.text.length <= MAX_INLINE_ATTACHMENT_TEXT_CHARS) {
      chunks.push(`${title}:\n${fragment.text}`)
    } else {
      omittedKinds.push(`${title.toLowerCase()} (${fragment.text.length} chars)`)
      chunks.push(`${title} excerpt:\n${buildAttachmentTextExcerpt(fragment.text)}`)
    }
  }

  if (omittedKinds.length > 0) {
    chunks.push(
      `Large audio/video attachment transcript content omitted from prompt to keep context small: ${omittedKinds.join(', ')}.`,
    )
  }

  if (inlineFragments.length === 0) {
    const status = includeParserEvidence
      ? renderAttachmentParserStatus(attachment.parseState ?? null)
      : null
    if (status !== null) {
      chunks.push(status)
    }
    if (storedPathLine !== null) {
      chunks.push(RAW_ATTACHMENT_FILE_INSTRUCTION)
      if (hasPdfAttachmentEvidencePath(attachment)) {
        chunks.push(PDF_ATTACHMENT_FILE_INSTRUCTION)
      }
    }
    if (derivedManifestPath !== null) {
      chunks.push(
        'Derived attachment evidence is available in the derived manifest path above.',
      )
    }
  }

  if (chunks.length === 0) {
    return null
  }

  if (metadataLines.length > 0) {
    chunks.unshift(metadataLines.join('\n'))
  }

  const label = `Attachment ${attachment.ordinal} (${attachment.kind})`
  return `${label}\n${chunks.join('\n\n')}`
}

function renderAttachmentEvidencePromptStoredPath(
  attachment: AssistantInputAttachmentEvidenceItem,
): string | null {
  const rawPath = normalizePromptRawAttachmentPath(attachment.raw?.path ?? null)
  if (!rawPath) {
    return null
  }

  return `storedPath: ${rawPath}`
}

function normalizePromptRawAttachmentPath(
  value: string | null | undefined,
): string | null {
  return normalizeAssistantRawAttachmentArtifactPath(value)
}

function hasPdfAttachmentEvidencePath(
  attachment: AssistantInputAttachmentEvidenceItem,
): boolean {
  const rawPath = normalizePromptRawAttachmentPath(attachment.raw?.path ?? null)
  const mime = normalizeNullableString(
    attachment.mime ?? attachment.raw?.mediaType ?? null,
  )?.toLowerCase() ?? null
  return mime === 'application/pdf' ||
    mime === 'application/x-pdf' ||
    (rawPath?.toLowerCase().endsWith('.pdf') ?? false)
}

function renderInlineAttachmentFragmentTitle(
  kind: AssistantInputAttachmentEvidenceItem['inlineFragments'][number]['kind'],
): string {
  switch (kind) {
    case 'attachment_transcript':
      return 'Transcript'
    case 'attachment_extracted_text':
      return 'Extracted text'
    default:
      return 'Attachment text'
  }
}

function buildAssistantAutoReplyContextLines(
  inputs: readonly AssistantAutoReplyPromptInput[],
): Array<string | null> {
  const firstInput = inputs[0]
  const lastInput = inputs[inputs.length - 1]
  if (!firstInput || !lastInput) {
    return []
  }

  const mediaGroupId = resolveGroupedTelegramMediaGroupId(inputs)
  return [
    `Source: ${firstInput.source}`,
    `Occurred at: ${
      firstInput.occurredAt === lastInput.occurredAt
        ? firstInput.occurredAt
        : `${firstInput.occurredAt} -> ${lastInput.occurredAt}`
    }`,
    `Thread: ${firstInput.conversation.threadId ?? 'unknown'}`,
    `Actor: ${firstInput.conversation.actorId ?? 'unknown'} | self=${String(firstInput.actorIsSelf)}`,
    inputs.length > 1 ? `Grouped inputs: ${inputs.length}` : null,
    mediaGroupId ? 'Telegram media group: present' : null,
  ]
}

function resolveGroupedTelegramMediaGroupId(
  inputs: readonly AssistantAutoReplyPromptInput[],
): string | null {
  const mediaGroupIds = inputs
    .map((input) => input.telegramMetadata?.mediaGroupId ?? null)
    .filter((mediaGroupId): mediaGroupId is string => mediaGroupId !== null)
  const firstMediaGroupId = mediaGroupIds[0] ?? null
  if (!firstMediaGroupId) {
    return null
  }

  return mediaGroupIds.every((mediaGroupId) => mediaGroupId === firstMediaGroupId)
    ? firstMediaGroupId
    : null
}

function buildAssistantAutoReplyPromptText(
  inputs: readonly AssistantAutoReplyPromptInput[],
  sections: readonly string[],
): string {
  const contextLines = buildAssistantAutoReplyContextLines(inputs).filter(
    (line): line is string => line !== null,
  )
  return sections.length > 0
    ? [...contextLines, '', ...sections].join('\n')
    : contextLines.join('\n')
}

function renderPreparedAttachmentPromptSection(
  attachment: AssistantInputAttachmentPromptBundle,
): string | null {
  const includeParserEvidence = shouldRenderAttachmentParserEvidence(attachment.kind)
  const textFragments = includeParserEvidence
    ? attachment.fragments.filter((fragment) => fragment.kind !== 'attachment_metadata')
    : []
  const hasTextFragments = textFragments.length > 0
  const richEvidenceCandidate =
    hasAssistantInputAttachmentEvidenceCandidate(attachment)
  const hasRawStoredPath = hasRawAttachmentStoredPath(attachment.storedPath)
  const storedPdfMetadata = hasStoredPdfAttachmentPath(attachment)
  const status = includeParserEvidence
    ? renderAttachmentParserStatus(attachment.parseState ?? null)
    : null
  const metadataLines = renderPreparedAttachmentMetadataLines({
    attachment,
    includeParserEvidence,
  })
  if (
    metadataLines.length === 0 &&
    !hasTextFragments &&
    !hasRawStoredPath &&
    !richEvidenceCandidate &&
    !storedPdfMetadata &&
    status === null
  ) {
    return null
  }

  const sections = metadataLines.length > 0 ? [metadataLines.join('\n')] : []
  for (const fragment of textFragments) {
    sections.push(`[${fragment.label}]\n${fragment.text}`)
  }
  if (status && !hasTextFragments) {
    sections.push(status)
  }
  if (hasRawStoredPath && !hasTextFragments) {
    sections.push(RAW_ATTACHMENT_FILE_INSTRUCTION)
  }
  if (richEvidenceCandidate && !hasTextFragments) {
    sections.push(
      'No decoded attachment text is available. Inspect local attachment paths with tools when needed; do not claim a QR or barcode payload was decoded unless it appears in explicit text evidence.',
    )
  }
  if (storedPdfMetadata && hasRawStoredPath && !hasTextFragments) {
    sections.push(PDF_ATTACHMENT_FILE_INSTRUCTION)
  }

  const label = `Attachment ${attachment.ordinal} (${attachment.kind})`
  return `${label}\n${sections.join('\n\n')}`
}

function renderPreparedAttachmentMetadataLines(input: {
  attachment: AssistantInputAttachmentPromptBundle
  includeParserEvidence: boolean
}): string[] {
  const attachment = input.attachment
  const storedPath = normalizePromptRawAttachmentPath(attachment.storedPath)
  return [
    `ordinal: ${attachment.ordinal}`,
    `kind: ${attachment.kind}`,
    `fileName: ${attachment.fileName ?? 'unknown'}`,
    `mime: ${attachment.mime ?? 'unknown'}`,
    `byteSize: ${typeof attachment.byteSize === 'number' ? attachment.byteSize : 'unknown'}`,
    `storedPath: ${storedPath ?? 'missing'}`,
    input.includeParserEvidence && attachment.parseState
      ? `parseState: ${attachment.parseState}`
      : null,
    `routingImageEligible: ${String(attachment.routingImage.eligible)}`,
    `routingImageReason: ${attachment.routingImage.reason}`,
  ].filter((line): line is string => line !== null)
}

function buildPreparedAttachmentSources(
  inputs: readonly AssistantAutoReplyPromptInputWithBundles[],
): AssistantInputAttachmentPromptBundleSource[] {
  return inputs.flatMap((entry) =>
    entry.attachmentBundles.map((bundle) => ({
      bundle,
      inputId: entry.inputId,
    })),
  )
}

async function buildPromptAttachmentBundlesBestEffort(input: {
  entry: AssistantAutoReplyPromptInput
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  onEvent?: (event: AssistantRunEvent) => void
  vaultRoot: string
}): Promise<AssistantInputAttachmentPromptBundle[]> {
  if (
    input.entry.attachmentEvidence.status !== 'available' &&
    input.entry.attachmentEvidence.status !== 'partial'
  ) {
    return []
  }
  if (input.entry.attachmentEvidence.attachments.length === 0) {
    return []
  }

  try {
    return await buildAssistantInputAttachmentPromptBundles({
      attachments: input.entry.attachmentEvidence.attachments,
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      vaultRoot: input.vaultRoot,
    })
  } catch {
    input.onEvent?.({
      type: 'input.reply-progress',
      inputId: input.entry.inputId,
      details: 'nonblocking attachment evidence bundle preparation failed',
      safeDetails: 'attachment_evidence_bundle_preparation_failed_nonblocking',
      providerKind: 'status',
      providerState: 'completed',
    })
    return []
  }
}

function renderAssistantInputProjectionLifecycleStatus(input: {
  projectionReasonCode: string | null
  projectionStatus: AssistantInputProjectionStatus | null
}): string {
  if (input.projectionStatus === 'failed' || input.projectionStatus === 'quarantined') {
    const reason = normalizeNullableString(input.projectionReasonCode)
    const status = input.projectionStatus
    return reason ? `${status}(${reason})` : status
  }

  if (
    input.projectionStatus === 'pending' ||
    input.projectionStatus === 'succeeded' ||
    input.projectionStatus === 'not_attempted'
  ) {
    return input.projectionStatus
  }

  return 'unknown'
}

function renderAssistantInputRawEvidenceLifecycleStatus(input: {
  attachments: readonly AssistantInputAttachmentEvidenceItem[]
  evidenceStatus: AssistantInputAttachmentEvidence['status'] | null
  rawPathByOrdinal: ReadonlyMap<number, string | null> | null
}): string {
  if (input.evidenceStatus === 'failed') {
    return 'failed'
  }

  if (input.evidenceStatus === 'partial') {
    return 'partial'
  }

  if (input.evidenceStatus === 'available') {
    if (input.attachments.length === 0) {
      return 'not_attempted'
    }
    return input.attachments.every((attachment) =>
      hasRawAttachmentStoredPath(
        resolveLifecycleRawAttachmentPath({
          attachment,
          rawPathByOrdinal: input.rawPathByOrdinal,
        }),
      ),
    )
      ? 'available'
      : 'partial'
  }

  return 'not_attempted'
}

function renderAssistantInputAttachmentLifecycleDetails(input: {
  attachments: readonly AssistantInputAttachmentEvidenceItem[]
  descriptors: readonly AssistantInputAttachmentDescriptor[]
  rawPathByOrdinal: ReadonlyMap<number, string | null> | null
}): string | null {
  const ordinals = new Set<number>()
  input.descriptors.forEach((_, index) => ordinals.add(index + 1))
  input.attachments.forEach((attachment) => ordinals.add(attachment.ordinal))
  const sortedOrdinals = [...ordinals].sort((left, right) => left - right)
  if (sortedOrdinals.length === 0) {
    return null
  }

  const attachmentByOrdinal = new Map(
    input.attachments.map((attachment) => [attachment.ordinal, attachment]),
  )
  const lines = sortedOrdinals.flatMap((ordinal) =>
    renderAssistantInputAttachmentLifecycleDetail({
      attachment: attachmentByOrdinal.get(ordinal) ?? null,
      descriptor: input.descriptors[ordinal - 1] ?? null,
      ordinal,
      rawPathByOrdinal: input.rawPathByOrdinal,
    }),
  )

  return lines.join('\n')
}

function renderAssistantInputAttachmentLifecycleDetail(input: {
  attachment: AssistantInputAttachmentEvidenceItem | null
  descriptor: AssistantInputAttachmentDescriptor | null
  ordinal: number
  rawPathByOrdinal: ReadonlyMap<number, string | null> | null
}): string[] {
  if (input.attachment) {
    const rawPath = resolveLifecycleRawAttachmentPath({
      attachment: input.attachment,
      rawPathByOrdinal: input.rawPathByOrdinal,
    })
    return [
      '',
      `Attachment ${input.ordinal}`,
      `fileName: ${normalizeNullableString(input.attachment.fileName) ?? 'unknown'}`,
      `kind: ${input.attachment.kind}`,
      `mime: ${normalizeNullableString(input.attachment.mime) ?? 'unknown'}`,
      `byteSize: ${typeof input.attachment.byteSize === 'number' ? input.attachment.byteSize : 'unknown'}`,
      `rawPath: ${rawPath ?? 'missing'}`,
      ...(shouldRenderAttachmentParserEvidence(input.attachment.kind)
        ? [`parseState: ${input.attachment.parseState ?? 'unknown'}`]
        : []),
    ]
  }

  const descriptor = input.descriptor
  return [
    '',
    `Attachment ${input.ordinal}`,
    `fileName: ${normalizeNullableString(descriptor?.fileName ?? null) ?? 'unknown'}`,
    `kind: ${normalizeAttachmentLifecycleDescriptorKind(descriptor)}`,
    `mime: ${normalizeNullableString(descriptor?.contentType ?? null) ?? 'unknown'}`,
    `byteSize: ${typeof descriptor?.sizeBytes === 'number' ? descriptor.sizeBytes : 'unknown'}`,
    'rawPath: missing',
  ]
}

function buildLifecycleRawPathByOrdinal(
  attachmentBundles: readonly AssistantInputAttachmentPromptBundle[] | undefined,
): ReadonlyMap<number, string | null> | null {
  if (!attachmentBundles) {
    return null
  }

  return new Map(
    attachmentBundles.map((bundle) => [
      bundle.ordinal,
      normalizePromptRawAttachmentPath(bundle.storedPath),
    ]),
  )
}

function resolveLifecycleRawAttachmentPath(input: {
  attachment: AssistantInputAttachmentEvidenceItem
  rawPathByOrdinal: ReadonlyMap<number, string | null> | null
}): string | null {
  if (input.rawPathByOrdinal?.has(input.attachment.ordinal)) {
    return input.rawPathByOrdinal.get(input.attachment.ordinal) ?? null
  }

  return normalizePromptRawAttachmentPath(input.attachment.raw?.path ?? null)
}

function normalizeAttachmentLifecycleDescriptorKind(
  descriptor: AssistantInputAttachmentDescriptor | null,
): string {
  const kind = normalizeNullableString(descriptor?.kind ?? null)?.toLowerCase() ?? null
  if (kind === 'photo') {
    return 'image'
  }
  if (kind === 'voice') {
    return 'voice_memo'
  }
  return kind ?? 'unknown'
}

function renderAssistantInputProjectionPromptNote(input: {
  evidenceReasonCode: string | null
  evidenceStatus: AssistantInputAttachmentEvidence['status']
  projectionReasonCode: string | null
  projectionStatus: AssistantInputProjectionStatus | null
}): string | null {
  if (input.evidenceStatus === 'failed') {
    const reason = normalizeNullableString(input.evidenceReasonCode)
    return reason
      ? `attachment evidence failed (${reason}); use the staged message text and available metadata only.`
      : 'attachment evidence failed; use the staged message text and available metadata only.'
  }

  if (input.projectionStatus === 'succeeded' && input.evidenceStatus === 'not_attempted') {
    return 'attachment evidence is unavailable; use the staged message text and available metadata only.'
  }

  if (input.projectionStatus === 'failed' || input.projectionStatus === 'quarantined') {
    const reason = normalizeNullableString(input.projectionReasonCode)
    return reason
      ? `attachment evidence is unavailable (${reason}); use the staged message text and available metadata only.`
      : 'attachment evidence is unavailable; use the staged message text and available metadata only.'
  }

  if (input.projectionStatus === 'pending') {
    return 'attachment evidence is pending; use the staged message text and available metadata only.'
  }

  if (input.projectionStatus === 'not_attempted') {
    return 'attachment evidence was not attempted; use the staged message text and available metadata only.'
  }

  return null
}

function renderAssistantInputPromptUnavailableNote(
  input: AssistantAutoReplyPromptInput,
): string | null {
  const metadata = input.sourceMetadata
  if (
    input.source === 'email' &&
    metadata?.kind === 'email' &&
    metadata.promptReady === false &&
    metadata.promptUnavailableReason === 'email.body_unavailable'
  ) {
    return [
      'Email body unavailable.',
      'Use only the available sender, recipient, subject, and thread metadata.',
      'Do not assume missing body content.',
    ].join('\n')
  }

  return null
}

function hasStoredPdfAttachmentPath(attachment: AssistantInputAttachmentPromptBundle): boolean {
  const storedPath = normalizeNullableString(attachment.storedPath)
  if (!storedPath) {
    return false
  }

  const mime = normalizeNullableString(attachment.mime)?.toLowerCase() ?? null
  if (mime === 'application/pdf' || mime === 'application/x-pdf') {
    return true
  }

  return [attachment.fileName, storedPath].some((candidate) =>
    normalizeNullableString(candidate)?.toLowerCase().endsWith('.pdf') ?? false,
  )
}

function hasRawAttachmentStoredPath(storedPath: string | null): boolean {
  return normalizeAssistantRawAttachmentArtifactPath(storedPath) !== null
}

function shouldRenderAttachmentParserEvidence(
  kind: AssistantInputAttachmentEvidenceItem['kind'] | AssistantInputAttachmentPromptBundle['kind'],
): boolean {
  return kind === 'audio' || kind === 'video'
}

function renderAttachmentParserStatus(parseState: string | null): string | null {
  if (parseState === 'pending' || parseState === 'running') {
    return 'Attachment parser status: audio/video transcript is not available yet.'
  }

  if (parseState === 'failed') {
    return 'Attachment parser status: parser failed; audio/video transcript is unavailable.'
  }

  if (parseState === 'unsupported') {
    return 'Attachment parser status: no parser output is available for this attachment type.'
  }

  return null
}

function buildAttachmentTextExcerpt(text: string): string {
  if (text.length <= MAX_ATTACHMENT_TEXT_EXCERPT_CHARS) {
    return text
  }

  const omittedChars = text.length - MAX_ATTACHMENT_TEXT_EXCERPT_CHARS
  return `${text.slice(0, MAX_ATTACHMENT_TEXT_EXCERPT_CHARS)}\n\n[truncated ${omittedChars} characters]`
}
