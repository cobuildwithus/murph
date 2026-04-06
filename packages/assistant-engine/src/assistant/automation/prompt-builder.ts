import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { InboxShowResult } from '../../inbox-cli-contracts.js'
import type { AssistantUserMessageContentPart } from '../../model-harness.js'
import {
  buildInboxModelAttachmentBundles,
  hasInboxMultimodalAttachmentEvidenceCandidate,
  prepareInboxMultimodalUserMessageContent,
} from '../../inbox-multimodal.js'
import type { InboxModelAttachmentBundle } from '../../inbox-model-contracts.js'
import { normalizeNullableString } from '../shared.js'

const MAX_INLINE_ATTACHMENT_TEXT_CHARS = 2000
const MAX_ATTACHMENT_TEXT_EXCERPT_CHARS = 600

export interface TelegramAutoReplyMetadata {
  mediaGroupId: string | null
  messageId: string | null
  replyContext: string | null
}

export interface AssistantAutoReplyPromptCapture {
  capture: InboxShowResult['capture']
  telegramMetadata: TelegramAutoReplyMetadata | null
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
      requiresRichUserMessageContent: boolean
      userMessageContent: AssistantUserMessageContentPart[] | null
    }
  | { kind: 'skip'; reason: string }

export function buildAssistantAutoReplyPrompt(
  captures: readonly AssistantAutoReplyPromptCapture[],
): AssistantAutoReplyPrompt {
  if (hasAssistantAutoReplyPendingAttachments(captures)) {
    return {
      kind: 'defer',
      reason: 'waiting for parser completion',
    }
  }

  const sections = captures
    .map((entry, index) =>
      renderAssistantAutoReplyCaptureSection({
        attachmentSections: entry.capture.attachments
          .map((attachment) => renderAttachmentPromptSection(attachment))
          .filter((section): section is string => section !== null),
        captureText: normalizeNullableString(entry.capture.text),
        index,
        replyContext: entry.telegramMetadata?.replyContext ?? null,
        totalCaptures: captures.length,
      }),
    )
    .filter((section): section is string => section !== null)

  if (sections.length === 0 || captures.length === 0) {
    return {
      kind: 'skip',
      reason: 'capture has no text or parsed attachment content',
    }
  }

  return {
    kind: 'ready',
    prompt: buildAssistantAutoReplyPromptText(captures, sections),
  }
}

export async function prepareAssistantAutoReplyInput(
  captures: readonly AssistantAutoReplyPromptCapture[],
  vaultRoot: string,
): Promise<AssistantAutoReplyPreparedInput> {
  if (hasAssistantAutoReplyPendingAttachments(captures)) {
    return {
      kind: 'defer',
      reason: 'waiting for parser completion',
    }
  }

  const preparedCaptures = await Promise.all(
    captures.map(async (entry) => ({
      ...entry,
      attachmentBundles: await buildInboxModelAttachmentBundles({
        attachments: entry.capture.attachments,
        captureId: entry.capture.captureId,
        vaultRoot,
      }),
    })),
  )
  const textualSections = preparedCaptures
    .map((entry, index) =>
      renderAssistantAutoReplyCaptureSection({
        attachmentSections: entry.attachmentBundles
          .map((attachment) => renderPreparedAttachmentPromptSection(attachment))
          .filter((section): section is string => section !== null),
        captureText: normalizeNullableString(entry.capture.text),
        index,
        replyContext: entry.telegramMetadata?.replyContext ?? null,
        totalCaptures: preparedCaptures.length,
      }),
    )
    .filter((section): section is string => section !== null)

  const hasTextualContent = preparedCaptures.some((entry) =>
    captureHasPreparedTextualContent(entry),
  )
  const nextPrompt = buildAssistantAutoReplyPromptText(captures, textualSections)

  const preparedMultimodalInput =
    await prepareInboxMultimodalUserMessageContent({
      attachmentSources: preparedCaptures.flatMap((entry) =>
        entry.attachmentBundles.map((attachment) => ({
          attachment,
          captureId: entry.capture.captureId,
        })),
      ),
      prompt: nextPrompt,
      vaultRoot,
    })

  if (!hasTextualContent && preparedMultimodalInput.userMessageContent === null) {
    return {
      kind: 'skip',
      reason:
        preparedMultimodalInput.fallbackError ??
        'capture has no text or parsed attachment content',
    }
  }

  return {
    kind: 'ready',
    prompt: nextPrompt,
    requiresRichUserMessageContent:
      !hasTextualContent && preparedMultimodalInput.userMessageContent !== null,
    userMessageContent: preparedMultimodalInput.userMessageContent,
  }
}

export async function loadTelegramAutoReplyMetadata(
  vaultRoot: string,
  envelopePath: string | null,
): Promise<TelegramAutoReplyMetadata | null> {
  const normalizedEnvelopePath = normalizeNullableString(envelopePath)
  if (!normalizedEnvelopePath) {
    return null
  }

  try {
    const absoluteEnvelopePath = path.isAbsolute(normalizedEnvelopePath)
      ? normalizedEnvelopePath
      : path.join(vaultRoot, normalizedEnvelopePath)
    const parsed = JSON.parse(
      await readFile(absoluteEnvelopePath, 'utf8'),
    ) as unknown
    const envelope = asRecord(parsed)
    const input = asRecord(envelope?.input)
    const raw = asRecord(input?.raw)
    const message = extractTelegramRawMessage(raw)

    return {
      mediaGroupId: normalizeNullableString(
        typeof message?.media_group_id === 'string'
          ? message.media_group_id
          : null,
      ),
      messageId: parseTelegramMessageId(message?.message_id),
      replyContext: buildTelegramReplyContext(message),
    }
  } catch {
    return null
  }
}

function hasAssistantAutoReplyPendingAttachments(
  captures: readonly AssistantAutoReplyPromptCapture[],
): boolean {
  return captures.some(({ capture }) =>
    capture.attachments.some(
      (attachment) =>
        attachment.parseState === 'pending' || attachment.parseState === 'running',
    ),
  )
}

function renderAssistantAutoReplyCaptureSection(input: {
  attachmentSections: readonly string[]
  captureText: string | null
  index: number
  replyContext: string | null
  totalCaptures: number
}): string | null {
  const sections: string[] = []
  if (input.replyContext) {
    sections.push(`Reply context:
${input.replyContext}`)
  }
  if (input.captureText) {
    sections.push(`Message text:
${input.captureText}`)
  }
  if (input.attachmentSections.length > 0) {
    sections.push(`Attachment context:
${input.attachmentSections.join('\n\n')}`)
  }

  if (sections.length === 0) {
    return null
  }

  if (input.totalCaptures === 1) {
    return sections.join('\n\n')
  }

  return `Capture ${input.index + 1}:
${sections.join('\n\n')}`
}

function renderAttachmentPromptSection(
  attachment: InboxShowResult['capture']['attachments'][number],
): string | null {
  const transcript = normalizeNullableString(attachment.transcriptText)
  const extractedText = normalizeNullableString(attachment.extractedText)
  const metadataLines = [
    attachment.attachmentId ? `attachmentId: ${attachment.attachmentId}` : null,
    attachment.mime ? `mime: ${attachment.mime}` : null,
    typeof attachment.byteSize === 'number' ? `byteSize: ${attachment.byteSize}` : null,
    attachment.parseState ? `parseState: ${attachment.parseState}` : null,
    attachment.storedPath ? `storedPath: ${attachment.storedPath}` : null,
    attachment.derivedPath ? `derivedPath: ${attachment.derivedPath}` : null,
  ].filter((line): line is string => line !== null)
  const chunks: string[] = []
  const omittedKinds: string[] = []

  if (transcript && transcript.length <= MAX_INLINE_ATTACHMENT_TEXT_CHARS) {
    chunks.push(`Transcript:
${transcript}`)
  } else if (transcript) {
    omittedKinds.push(`transcript (${transcript.length} chars)`)
    chunks.push(`Transcript excerpt:
${buildAttachmentTextExcerpt(transcript)}`)
  }
  if (extractedText && extractedText.length <= MAX_INLINE_ATTACHMENT_TEXT_CHARS) {
    chunks.push(`Extracted text:
${extractedText}`)
  } else if (extractedText) {
    omittedKinds.push(`extracted text (${extractedText.length} chars)`)
    chunks.push(`Extracted text excerpt:
${buildAttachmentTextExcerpt(extractedText)}`)
  }

  if (omittedKinds.length > 0) {
    chunks.push(
      `Large parsed attachment content omitted from prompt to keep context small: ${omittedKinds.join(', ')}.`,
    )
  }

  if (chunks.length === 0) {
    return null
  }

  if (metadataLines.length > 0) {
    chunks.unshift(metadataLines.join('\n'))
  }

  const label = `Attachment ${attachment.ordinal} (${attachment.kind}${attachment.fileName ? `, ${attachment.fileName}` : ''})`
  return `${label}\n${chunks.join('\n\n')}`
}

function buildAssistantAutoReplyContextLines(
  captures: readonly AssistantAutoReplyPromptCapture[],
): Array<string | null> {
  const firstCapture = captures[0]?.capture
  const lastCapture = captures[captures.length - 1]?.capture
  if (!firstCapture || !lastCapture) {
    return []
  }

  const mediaGroupId = captures[0]?.telegramMetadata?.mediaGroupId ?? null
  return [
    `Source: ${firstCapture.source}`,
    `Occurred at: ${
      firstCapture.occurredAt === lastCapture.occurredAt
        ? firstCapture.occurredAt
        : `${firstCapture.occurredAt} -> ${lastCapture.occurredAt}`
    }`,
    `Thread: ${firstCapture.threadId}${firstCapture.threadTitle ? ` (${firstCapture.threadTitle})` : ''}`,
    `Actor: ${firstCapture.actorName ?? firstCapture.actorId ?? 'unknown'} | self=${String(firstCapture.actorIsSelf)}`,
    captures.length > 1 ? `Grouped captures: ${captures.length}` : null,
    mediaGroupId ? `Telegram media group: ${mediaGroupId}` : null,
  ]
}

function buildAssistantAutoReplyPromptText(
  captures: readonly AssistantAutoReplyPromptCapture[],
  sections: readonly string[],
): string {
  const contextLines = buildAssistantAutoReplyContextLines(captures).filter(
    (line): line is string => line !== null,
  )
  return sections.length > 0
    ? [...contextLines, '', ...sections].join('\n')
    : contextLines.join('\n')
}

function captureHasPreparedTextualContent(
  entry: AssistantAutoReplyPromptCapture & {
    attachmentBundles: readonly InboxModelAttachmentBundle[]
  },
): boolean {
  return (
    Boolean(normalizeNullableString(entry.capture.text)) ||
    Boolean(entry.telegramMetadata?.replyContext) ||
    entry.attachmentBundles.some((attachment) =>
      attachment.fragments.some(
        (fragment) => fragment.kind !== 'attachment_metadata',
      ),
    )
  )
}

function renderPreparedAttachmentPromptSection(
  attachment: InboxModelAttachmentBundle,
): string | null {
  const hasTextFragments = attachment.fragments.some(
    (fragment) => fragment.kind !== 'attachment_metadata',
  )
  const richEvidenceCandidate =
    hasInboxMultimodalAttachmentEvidenceCandidate(attachment)
  if (!hasTextFragments && !richEvidenceCandidate) {
    return null
  }

  const sections = attachment.combinedText.length > 0 ? [attachment.combinedText] : []
  if (!hasTextFragments) {
    sections.push(
      'No parsed attachment text is available. Use attached image or PDF evidence if present.',
    )
  }

  const label = `Attachment ${attachment.ordinal} (${attachment.kind}${attachment.fileName ? `, ${attachment.fileName}` : ''})`
  return `${label}\n${sections.join('\n\n')}`
}

function buildAttachmentTextExcerpt(text: string): string {
  if (text.length <= MAX_ATTACHMENT_TEXT_EXCERPT_CHARS) {
    return text
  }

  const omittedChars = text.length - MAX_ATTACHMENT_TEXT_EXCERPT_CHARS
  return `${text.slice(0, MAX_ATTACHMENT_TEXT_EXCERPT_CHARS)}\n\n[truncated ${omittedChars} characters]`
}

function extractTelegramRawMessage(
  raw: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return asRecord(raw?.message) ?? asRecord(raw?.business_message)
}

function parseTelegramMessageId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }

  if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
    return value.trim()
  }

  return null
}

function buildTelegramReplyContext(
  message: Record<string, unknown> | null,
): string | null {
  if (!message) {
    return null
  }

  const replyToMessage = asRecord(message.reply_to_message)
  const quote = asRecord(message.quote)
  const lines: string[] = []

  if (replyToMessage) {
    const actor = buildTelegramRawActorDisplayName(replyToMessage)
    const text = summarizeTelegramRawMessageText(replyToMessage)
    if (actor && text) {
      lines.push(`Replying to ${actor}: ${text}`)
    } else if (text) {
      lines.push(`Replying to: ${text}`)
    } else if (actor) {
      lines.push(`Replying to ${actor}`)
    } else {
      lines.push('Replying to an earlier Telegram message')
    }
  }

  const quoteText =
    typeof quote?.text === 'string' ? normalizeNullableString(quote.text) : null
  if (quoteText) {
    lines.push(`Quoted text: ${summarizeTelegramText(quoteText)}`)
  }

  return lines.length > 0 ? lines.join('\n') : null
}

function summarizeTelegramRawMessageText(
  message: Record<string, unknown>,
): string | null {
  const text =
    stringFromRecord(message, 'text') ??
    stringFromRecord(message, 'caption') ??
    buildTelegramRawContactText(asRecord(message.contact)) ??
    buildTelegramRawVenueText(asRecord(message.venue)) ??
    buildTelegramRawLocationText(asRecord(message.location)) ??
    buildTelegramRawPollText(asRecord(message.poll)) ??
    null

  return text ? summarizeTelegramText(text) : null
}

function buildTelegramRawActorDisplayName(
  message: Record<string, unknown>,
): string | null {
  return (
    buildTelegramRawDisplayName(asRecord(message.from)) ??
    buildTelegramRawDisplayName(asRecord(message.sender_chat)) ??
    buildTelegramRawDisplayName(asRecord(message.chat)) ??
    null
  )
}

function buildTelegramRawDisplayName(
  record: Record<string, unknown> | null,
): string | null {
  if (!record) {
    return null
  }

  const parts = [
    stringFromRecord(record, 'first_name'),
    stringFromRecord(record, 'last_name'),
  ].filter((value): value is string => value !== null)

  if (parts.length > 0) {
    return parts.join(' ')
  }

  const username = stringFromRecord(record, 'username')
  if (username) {
    return username.startsWith('@') ? username : `@${username}`
  }

  return stringFromRecord(record, 'title')
}

function buildTelegramRawContactText(
  contact: Record<string, unknown> | null,
): string | null {
  if (!contact) {
    return null
  }

  const name = [
    stringFromRecord(contact, 'first_name'),
    stringFromRecord(contact, 'last_name'),
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
  const phoneNumber = stringFromRecord(contact, 'phone_number')

  if (!name && !phoneNumber) {
    return null
  }

  return phoneNumber ? `Shared contact ${name || 'unknown'} (${phoneNumber})` : `Shared contact ${name}`
}

function buildTelegramRawLocationText(
  location: Record<string, unknown> | null,
): string | null {
  if (!location) {
    return null
  }

  const latitude =
    typeof location.latitude === 'number' ? location.latitude : null
  const longitude =
    typeof location.longitude === 'number' ? location.longitude : null
  if (latitude === null || longitude === null) {
    return null
  }

  return `Shared location ${latitude}, ${longitude}`
}

function buildTelegramRawVenueText(
  venue: Record<string, unknown> | null,
): string | null {
  if (!venue) {
    return null
  }

  const parts = [
    stringFromRecord(venue, 'title'),
    stringFromRecord(venue, 'address'),
    buildTelegramRawLocationText(asRecord(venue.location)),
  ].filter((value): value is string => value !== null)

  return parts.length > 0 ? `Shared venue ${parts.join(' | ')}` : null
}

function buildTelegramRawPollText(
  poll: Record<string, unknown> | null,
): string | null {
  if (!poll) {
    return null
  }

  const question = stringFromRecord(poll, 'question')
  const options = Array.isArray(poll.options)
    ? poll.options
        .map((option) => stringFromRecord(asRecord(option), 'text'))
        .filter((value): value is string => value !== null)
    : []

  if (!question && options.length === 0) {
    return null
  }

  return `Shared poll ${question ?? 'untitled poll'}${options.length > 0 ? ` [${options.join(' | ')}]` : ''}`
}

function summarizeTelegramText(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized
}

function stringFromRecord(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!record) {
    return null
  }

  return typeof record[key] === 'string'
    ? normalizeNullableString(record[key] as string)
    : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}
