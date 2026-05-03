import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { AssistantUserMessageContentPart } from '../content-types.js'
import type { AssistantConversationCaptureRef } from '../conversation-ref.js'
import type {
  AssistantInputAttachmentDescriptor,
  AssistantInputProjectionStatus,
  AssistantInputReplyTarget,
  AssistantInputSourceMetadata,
} from '../input-store.js'
import type { AssistantRunEvent } from './shared.js'
import {
  buildInboxModelAttachmentBundles,
  hasInboxMultimodalAttachmentEvidenceCandidate,
  prepareInboxMultimodalUserMessageContent,
} from '../../inbox-multimodal.js'
import type { InboxModelAttachmentBundle } from '../../inbox-model-contracts.js'
import { normalizeNullableString } from '../shared.js'

const MAX_INLINE_ATTACHMENT_TEXT_CHARS = 2000
const MAX_ATTACHMENT_TEXT_EXCERPT_CHARS = 600

export type InboxPromptAttachment = InboxShowResult['capture']['attachments'][number]

export interface TelegramAutoReplyMetadata {
  mediaGroupId: string | null
  messageId: string | null
  replyContext: string | null
}

export interface AssistantAutoReplyPromptProjection {
  inboxCaptureId: string | null
  reasonCode: string | null
  status: AssistantInputProjectionStatus
}

export interface AssistantAutoReplyPromptEnrichment {
  attachments: readonly InboxPromptAttachment[]
  inboxCaptureId: string
}

export interface AssistantAutoReplyPromptInput {
  actorIsSelf: boolean
  attachmentDescriptors: readonly AssistantInputAttachmentDescriptor[]
  conversation: AssistantConversationCaptureRef
  enrichment: AssistantAutoReplyPromptEnrichment | null
  inputId: string
  occurredAt: string
  projection: AssistantAutoReplyPromptProjection | null
  receivedAt: string | null
  replyTarget: AssistantInputReplyTarget | null
  source: string
  sourceMetadata?: AssistantInputSourceMetadata | null
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

export function buildAssistantAutoReplyPrompt(
  inputs: readonly AssistantAutoReplyPromptInput[],
): AssistantAutoReplyPrompt {
  const sections = inputs
    .map((entry, index) =>
      renderAssistantAutoReplyInputSection({
        attachmentSections: buildAssistantAutoReplyAttachmentSections({
          descriptorSection: renderAssistantInputAttachmentDescriptorPromptSection({
            descriptors: entry.attachmentDescriptors,
            enrichmentAvailable: entry.enrichment !== null,
            projectionReasonCode: entry.projection?.reasonCode ?? null,
            projectionStatus: entry.projection?.status ?? null,
          }),
          renderedAttachmentSections: (entry.enrichment?.attachments ?? [])
            .map((attachment) => renderAttachmentPromptSection(attachment))
            .filter((section): section is string => section !== null),
        }),
        enrichmentAvailable: entry.enrichment !== null,
        inputText: normalizeNullableString(entry.text),
        index,
        promptUnavailableNote: renderAssistantInputPromptUnavailableNote(entry),
        projectionReasonCode: entry.projection?.reasonCode ?? null,
        projectionStatus: entry.projection?.status ?? null,
        replyContext: entry.telegramMetadata?.replyContext ?? null,
        totalInputs: inputs.length,
      }),
    )
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
    .map((entry, index) =>
      renderAssistantAutoReplyInputSection({
        attachmentSections: buildAssistantAutoReplyAttachmentSections({
          descriptorSection: renderAssistantInputAttachmentDescriptorPromptSection({
            descriptors: entry.attachmentDescriptors,
            enrichmentAvailable: entry.enrichment !== null,
            projectionReasonCode: entry.projection?.reasonCode ?? null,
            projectionStatus: entry.projection?.status ?? null,
          }),
          renderedAttachmentSections: entry.attachmentBundles
            .map((attachment) => renderPreparedAttachmentPromptSection(attachment))
            .filter((section): section is string => section !== null),
        }),
        enrichmentAvailable: entry.enrichment !== null,
        inputText: normalizeNullableString(entry.text),
        index,
        promptUnavailableNote: renderAssistantInputPromptUnavailableNote(entry),
        projectionReasonCode: entry.projection?.reasonCode ?? null,
        projectionStatus: entry.projection?.status ?? null,
        replyContext: entry.telegramMetadata?.replyContext ?? null,
        totalInputs: preparedInputs.length,
      }),
    )
    .filter((section): section is string => section !== null)

  const hasTextualContent = textualSections.length > 0
  const nextPrompt = buildAssistantAutoReplyPromptText(inputs, textualSections)

  const preparedMultimodalInput =
    await prepareInboxMultimodalUserMessageContent({
      attachmentSources: preparedInputs.flatMap((entry) => {
        const enrichment = entry.enrichment
        return enrichment
          ? entry.attachmentBundles.map((attachment) => ({
              attachment,
              captureId: enrichment.inboxCaptureId,
            }))
          : []
      }),
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
  enrichmentAvailable?: boolean
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
    renderAssistantInputDescriptorEnrichmentStatus({
      enrichmentAvailable: input.enrichmentAvailable ?? false,
      reasonCode: input.projectionReasonCode ?? null,
      status: input.projectionStatus ?? null,
    }),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function renderAssistantAutoReplyInputSection(input: {
  attachmentSections: readonly string[]
  enrichmentAvailable: boolean
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
  const projectionNote = input.attachmentSections.length === 0
    ? renderAssistantInputProjectionPromptNote({
        enrichmentAvailable: input.enrichmentAvailable,
        reasonCode: input.projectionReasonCode ?? null,
        status: input.projectionStatus ?? null,
      })
    : null
  if (projectionNote) {
    sections.push(`Message enrichment:\n${projectionNote}`)
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

function buildAssistantAutoReplyAttachmentSections(input: {
  descriptorSection: string | null
  renderedAttachmentSections: readonly string[]
}): string[] {
  if (input.renderedAttachmentSections.length > 0) {
    return [...input.renderedAttachmentSections]
  }

  return input.descriptorSection ? [input.descriptorSection] : []
}

function renderAttachmentPromptSection(
  attachment: InboxPromptAttachment,
): string | null {
  const transcript = normalizeNullableString(attachment.transcriptText)
  const extractedText = normalizeNullableString(attachment.extractedText)
  const metadataLines = [
    attachment.attachmentId ? `attachmentId: ${attachment.attachmentId}` : null,
    attachment.mime ? `mime: ${attachment.mime}` : null,
    typeof attachment.byteSize === 'number' ? `byteSize: ${attachment.byteSize}` : null,
    attachment.parseState ? `parseState: ${attachment.parseState}` : null,
  ].filter((line): line is string => line !== null)
  const chunks: string[] = []
  const omittedKinds: string[] = []

  if (transcript && transcript.length <= MAX_INLINE_ATTACHMENT_TEXT_CHARS) {
    chunks.push(`Transcript:\n${transcript}`)
  } else if (transcript) {
    omittedKinds.push(`transcript (${transcript.length} chars)`)
    chunks.push(`Transcript excerpt:\n${buildAttachmentTextExcerpt(transcript)}`)
  }
  if (extractedText && extractedText.length <= MAX_INLINE_ATTACHMENT_TEXT_CHARS) {
    chunks.push(`Extracted text:\n${extractedText}`)
  } else if (extractedText) {
    omittedKinds.push(`extracted text (${extractedText.length} chars)`)
    chunks.push(`Extracted text excerpt:\n${buildAttachmentTextExcerpt(extractedText)}`)
  }

  if (omittedKinds.length > 0) {
    chunks.push(
      `Large parsed attachment content omitted from prompt to keep context small: ${omittedKinds.join(', ')}.`,
    )
  }

  if (chunks.length === 0) {
    const status = renderAttachmentParserStatus(attachment.parseState ?? null)
    if (status === null) {
      return null
    }
    chunks.push(status)
  }

  if (metadataLines.length > 0) {
    chunks.unshift(metadataLines.join('\n'))
  }

  const label = `Attachment ${attachment.ordinal} (${attachment.kind}${attachment.fileName ? `, ${attachment.fileName}` : ''})`
  return `${label}\n${chunks.join('\n\n')}`
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
  attachment: InboxModelAttachmentBundle,
): string | null {
  const hasTextFragments = attachment.fragments.some(
    (fragment) => fragment.kind !== 'attachment_metadata',
  )
  const richEvidenceCandidate =
    hasInboxMultimodalAttachmentEvidenceCandidate(attachment)
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

  const label = `Attachment ${attachment.ordinal} (${attachment.kind}${attachment.fileName ? `, ${attachment.fileName}` : ''})`
  return `${label}\n${sections.join('\n\n')}`
}

async function buildPromptAttachmentBundlesBestEffort(input: {
  entry: AssistantAutoReplyPromptInput
  onEvent?: (event: AssistantRunEvent) => void
  vaultRoot: string
}): Promise<InboxModelAttachmentBundle[]> {
  if (!input.entry.enrichment) {
    return []
  }

  try {
    return await buildInboxModelAttachmentBundles({
      attachments: input.entry.enrichment.attachments,
      captureId: input.entry.enrichment.inboxCaptureId,
      vaultRoot: input.vaultRoot,
    })
  } catch {
    input.onEvent?.({
      type: 'input.reply-progress',
      inputId: input.entry.inputId,
      details: 'nonblocking inbox attachment bundle preparation failed',
      safeDetails: 'inbox_attachment_bundle_preparation_failed_nonblocking',
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

function renderAssistantInputDescriptorEnrichmentStatus(input: {
  enrichmentAvailable: boolean
  reasonCode: string | null
  status: AssistantInputProjectionStatus | null
}): string {
  if (input.status === 'succeeded') {
    return input.enrichmentAvailable
      ? 'parser/search enrichment: succeeded'
      : 'parser/search enrichment: unavailable'
  }

  if (input.status === 'failed' || input.status === 'quarantined') {
    const reason = normalizeNullableString(input.reasonCode)
    return reason
      ? `parser/search enrichment: failed (${reason})`
      : 'parser/search enrichment: failed'
  }

  return 'parser/search enrichment: pending'
}

function renderAssistantInputProjectionPromptNote(input: {
  enrichmentAvailable: boolean
  reasonCode: string | null
  status: AssistantInputProjectionStatus | null
}): string | null {
  if (input.status === 'succeeded' && !input.enrichmentAvailable) {
    return 'inbox/parser enrichment is unavailable; use the staged message text and available metadata only.'
  }

  if (input.status === 'failed' || input.status === 'quarantined') {
    const reason = normalizeNullableString(input.reasonCode)
    return reason
      ? `inbox/parser enrichment failed (${reason}); use the staged message text and available metadata only.`
      : 'inbox/parser enrichment failed; use the staged message text and available metadata only.'
  }

  if (input.status === 'pending') {
    return 'inbox/parser enrichment is pending; use the staged message text and available metadata only.'
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

function hasStoredPdfAttachmentPath(attachment: InboxModelAttachmentBundle): boolean {
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
