import type { AssistantUserMessageContentPart } from '../content-types.js'
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
  buildAssistantInputAttachmentModelBundles,
  hasAssistantInputAttachmentEvidenceCandidate,
  prepareAssistantInputMultimodalUserMessageContent,
  type AssistantInputAttachmentModelBundle,
  type AssistantInputAttachmentModelBundleSource,
} from '../attachment-evidence-model.js'
import { normalizeNullableString } from '../shared.js'

const MAX_INLINE_ATTACHMENT_TEXT_CHARS = 2000
const MAX_ATTACHMENT_TEXT_EXCERPT_CHARS = 600

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
  attachmentBundles: readonly AssistantInputAttachmentModelBundle[]
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
        descriptorSection: renderAssistantInputAttachmentDescriptorPromptSection({
          descriptors: entry.attachmentDescriptors,
          evidenceReasonCode: entry.attachmentEvidence.reasonCode,
          evidenceStatus: entry.attachmentEvidence.status,
          projectionReasonCode: entry.projection?.reasonCode ?? null,
          projectionStatus: entry.projection?.status ?? null,
        }),
        includeDescriptorSectionWithEvidence:
          entry.attachmentEvidence.status === 'partial',
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
      reason: 'input has no text or parsed attachment content',
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
    onEvent?: (event: AssistantRunEvent) => void
  } = {},
): Promise<AssistantAutoReplyPreparedInput> {
  const preparedInputs = await Promise.all(
    inputs.map(async (entry) => ({
      ...entry,
      attachmentBundles: await buildPromptAttachmentBundlesBestEffort({
        entry,
        onEvent: options.onEvent,
        vaultRoot,
      }),
    })),
  )
  const textualSections = preparedInputs
    .map((entry, index) => {
      const attachmentSections = buildAssistantAutoReplyAttachmentSections({
        descriptorSection: renderAssistantInputAttachmentDescriptorPromptSection({
          descriptors: entry.attachmentDescriptors,
          evidenceReasonCode: entry.attachmentEvidence.reasonCode,
          evidenceStatus: entry.attachmentEvidence.status,
          projectionReasonCode: entry.projection?.reasonCode ?? null,
          projectionStatus: entry.projection?.status ?? null,
        }),
        includeDescriptorSectionWithEvidence:
          entry.attachmentEvidence.status === 'partial',
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
        'input has no text or parsed attachment content',
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
  descriptors: readonly AssistantInputAttachmentDescriptor[]
  evidenceReasonCode?: string | null
  evidenceStatus?: AssistantInputAttachmentEvidence['status'] | null
  projectionReasonCode?: string | null
  projectionStatus?: AssistantInputProjectionStatus | null
}): string | null {
  if (input.descriptors.length === 0) {
    return null
  }

  const kinds = uniqueSortedStrings(
    input.descriptors
      .map(normalizeAttachmentDescriptorPromptKind)
      .filter((value): value is string => value !== null),
  )
  const mimeTypes = uniqueSortedStrings(
    input.descriptors
      .map((descriptor) => normalizeNullableString(descriptor.contentType))
      .filter((value): value is string => value !== null)
      .map((value) => value.toLowerCase()),
  )
  const sizes = input.descriptors
    .map((descriptor) => descriptor.sizeBytes)
    .filter((value): value is number => typeof value === 'number')
  const totalKnownSize = sizes.reduce((total, sizeBytes) => total + sizeBytes, 0)
  const sizeLine = sizes.length > 0
    ? sizes.length === input.descriptors.length
      ? `total size: ${totalKnownSize} bytes`
      : `known total size: ${totalKnownSize} bytes (some sizes unknown)`
    : null

  return [
    `${input.descriptors.length} attachment${input.descriptors.length === 1 ? '' : 's'}`,
    kinds.length > 0 ? `kinds: ${kinds.join(', ')}` : null,
    mimeTypes.length > 0 ? `mime types: ${mimeTypes.join(', ')}` : null,
    sizeLine,
    renderAssistantInputDescriptorEvidenceStatus({
      evidenceReasonCode: input.evidenceReasonCode ?? null,
      evidenceStatus: input.evidenceStatus ?? null,
      projectionReasonCode: input.projectionReasonCode ?? null,
      projectionStatus: input.projectionStatus ?? null,
    }),
  ]
    .filter((line): line is string => line !== null)
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
  descriptorSection: string | null
  includeDescriptorSectionWithEvidence: boolean
  renderedAttachmentSections: readonly string[]
}): string[] {
  if (input.renderedAttachmentSections.length > 0) {
    return input.includeDescriptorSectionWithEvidence && input.descriptorSection
      ? [...input.renderedAttachmentSections, input.descriptorSection]
      : [...input.renderedAttachmentSections]
  }

  return input.descriptorSection ? [input.descriptorSection] : []
}

function renderAttachmentEvidencePromptSection(
  attachment: AssistantInputAttachmentEvidenceItem,
): string | null {
  const storedPathLine = renderAttachmentEvidencePromptStoredPath(attachment)
  const metadataLines = [
    attachment.sourceAttachmentId ? `attachmentId: ${attachment.sourceAttachmentId}` : null,
    attachment.mime ? `mime: ${attachment.mime}` : null,
    typeof attachment.byteSize === 'number' ? `byteSize: ${attachment.byteSize}` : null,
    storedPathLine,
    attachment.parseState ? `parseState: ${attachment.parseState}` : null,
  ].filter((line): line is string => line !== null)
  const chunks: string[] = []
  const omittedKinds: string[] = []

  for (const fragment of attachment.inlineFragments) {
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
      `Large parsed attachment content omitted from prompt to keep context small: ${omittedKinds.join(', ')}.`,
    )
  }

  if (chunks.length === 0) {
    const status = renderAttachmentParserStatus(attachment.parseState ?? null)
    if (status !== null) {
      chunks.push(status)
    } else if (storedPathLine !== null) {
      chunks.push(
        'No parsed PDF text is available. The storedPath above is local attachment metadata; inspect that PDF with local tools only if needed.',
      )
    } else {
      return null
    }
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
  const rawPath = normalizeNullableString(attachment.raw?.path ?? null)
  if (!rawPath || !hasPdfAttachmentEvidencePath(attachment, rawPath)) {
    return null
  }

  return `storedPath: ${rawPath}`
}

function hasPdfAttachmentEvidencePath(
  attachment: AssistantInputAttachmentEvidenceItem,
  rawPath: string,
): boolean {
  const mime = normalizeNullableString(
    attachment.mime ?? attachment.raw?.mediaType ?? null,
  )?.toLowerCase() ?? null
  return mime === 'application/pdf' ||
    mime === 'application/x-pdf' ||
    rawPath.toLowerCase().endsWith('.pdf')
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
  attachment: AssistantInputAttachmentModelBundle,
): string | null {
  const hasTextFragments = attachment.fragments.some(
    (fragment) => fragment.kind !== 'attachment_metadata',
  )
  const richEvidenceCandidate =
    hasAssistantInputAttachmentEvidenceCandidate(attachment)
  const storedPdfMetadata = hasStoredPdfAttachmentPath(attachment)
  const status = renderAttachmentParserStatus(attachment.parseState ?? null)
  if (
    !hasTextFragments &&
    !richEvidenceCandidate &&
    !storedPdfMetadata &&
    status === null
  ) {
    return null
  }

  const sections = attachment.combinedText.length > 0 ? [attachment.combinedText] : []
  if (status && !hasTextFragments) {
    sections.push(status)
  }
  if (richEvidenceCandidate && !hasTextFragments) {
    sections.push(
      'No parsed attachment text is available. If local attachment paths are present in the context, inspect those files with local tools; do not claim a QR or barcode payload was decoded unless it appears in parsed attachment text.',
    )
  }
  if (storedPdfMetadata && !hasTextFragments) {
    sections.push(
      'No parsed PDF text is available. The storedPath above is local attachment metadata; inspect that PDF with local tools only if needed.',
    )
  }

  const label = `Attachment ${attachment.ordinal} (${attachment.kind})`
  return `${label}\n${sections.join('\n\n')}`
}

function buildPreparedAttachmentSources(
  inputs: readonly AssistantAutoReplyPromptInputWithBundles[],
): AssistantInputAttachmentModelBundleSource[] {
  return inputs.flatMap((entry) =>
    entry.attachmentBundles.map((bundle) => ({
      bundle,
      inputId: entry.inputId,
    })),
  )
}

async function buildPromptAttachmentBundlesBestEffort(input: {
  entry: AssistantAutoReplyPromptInput
  onEvent?: (event: AssistantRunEvent) => void
  vaultRoot: string
}): Promise<AssistantInputAttachmentModelBundle[]> {
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
    return await buildAssistantInputAttachmentModelBundles({
      attachments: input.entry.attachmentEvidence.attachments,
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

function normalizeAttachmentDescriptorPromptKind(
  descriptor: AssistantInputAttachmentDescriptor,
): string | null {
  const kind = normalizeNullableString(descriptor.kind)?.toLowerCase() ?? null
  const mimeType =
    normalizeNullableString(descriptor.contentType)?.toLowerCase() ?? null
  if (kind === 'photo' || kind === 'image') {
    return 'image'
  }
  if (kind === 'voice' || kind === 'voice_memo') {
    return 'voice_memo'
  }
  if (kind && kind !== 'media') {
    return kind
  }

  if (mimeType?.startsWith('image/')) {
    return 'image'
  }
  if (mimeType?.startsWith('audio/')) {
    return 'audio'
  }
  if (mimeType?.startsWith('video/')) {
    return 'video'
  }
  if (mimeType === 'application/pdf' || mimeType?.startsWith('text/')) {
    return 'document'
  }
  return kind
}

function renderAssistantInputDescriptorEvidenceStatus(input: {
  evidenceReasonCode: string | null
  evidenceStatus: AssistantInputAttachmentEvidence['status'] | null
  projectionReasonCode: string | null
  projectionStatus: AssistantInputProjectionStatus | null
}): string {
  if (input.evidenceStatus === 'available') {
    return 'attachment evidence: available'
  }
  if (input.evidenceStatus === 'partial') {
    const reason = normalizeNullableString(input.evidenceReasonCode)
    return reason
      ? `attachment evidence: partial (${reason})`
      : 'attachment evidence: partial'
  }
  if (input.evidenceStatus === 'failed') {
    const reason = normalizeNullableString(input.evidenceReasonCode)
    return reason
      ? `attachment evidence: failed (${reason})`
      : 'attachment evidence: failed'
  }

  if (input.projectionStatus === 'succeeded') {
    return 'attachment evidence: unavailable'
  }

  if (input.projectionStatus === 'failed' || input.projectionStatus === 'quarantined') {
    const reason = normalizeNullableString(input.projectionReasonCode)
    return reason
      ? `attachment evidence: unavailable (${reason})`
      : 'attachment evidence: unavailable'
  }

  if (input.projectionStatus === 'not_attempted') {
    return 'attachment evidence: not attempted'
  }

  return 'attachment evidence: pending'
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

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function hasStoredPdfAttachmentPath(attachment: AssistantInputAttachmentModelBundle): boolean {
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

function renderAttachmentParserStatus(parseState: string | null): string | null {
  if (parseState === 'pending' || parseState === 'running') {
    return 'Attachment parser status: parser output is not available yet.'
  }

  if (parseState === 'failed') {
    return 'Attachment parser status: parser failed; parsed attachment text or transcript is unavailable.'
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
