import path from 'node:path'
import type { InboundAttachment, InboundCapture } from '../../contracts/capture.ts'
import type { ChatMessage } from '../chat/message.ts'
import { createInboundCaptureFromChatMessage } from '../chat/message.ts'
import { normalizeTextValue, sanitizeRawMetadata, toIsoTimestamp } from '../../shared.ts'
import type {
  LinqMediaPart,
  LinqMessagePart,
  LinqMessageReceivedData,
  LinqMessageReceivedEvent,
  LinqWebhookEvent,
} from './types.ts'

export interface LinqAttachmentDownloadDriver {
  downloadUrl(url: string, signal?: AbortSignal): Promise<Uint8Array | null>
}

export interface NormalizeLinqWebhookEventInput {
  event: LinqWebhookEvent
  source?: string
  defaultAccountId?: string | null
  downloadDriver?: LinqAttachmentDownloadDriver | null
  signal?: AbortSignal
}

export async function normalizeLinqWebhookEvent({
  event,
  source = 'linq',
  defaultAccountId = null,
  downloadDriver = null,
  signal,
}: NormalizeLinqWebhookEventInput): Promise<InboundCapture> {
  const messageEvent = requireLinqMessageReceivedEvent(event)
  const accountId =
    normalizeTextValue(messageEvent.data.recipient_phone ?? null) ?? defaultAccountId
  const message = await toLinqChatMessage({
    event: messageEvent,
    downloadDriver,
    signal,
  })

  return createInboundCaptureFromChatMessage({
    source,
    accountId,
    message,
  })
}

export async function toLinqChatMessage(input: {
  event: LinqMessageReceivedEvent
  downloadDriver?: LinqAttachmentDownloadDriver | null
  signal?: AbortSignal
}): Promise<ChatMessage> {
  const { event, downloadDriver = null, signal } = input
  const data = event.data
  const messageId = normalizeTextValue(data.message.id)
  if (!messageId) {
    throw new TypeError('Linq message.received event is missing a stable message id.')
  }

  const chatId = normalizeTextValue(data.chat_id)
  if (!chatId) {
    throw new TypeError('Linq message.received event is missing a stable chat id.')
  }

  return {
    externalId: `linq:${messageId}`,
    thread: {
      id: chatId,
      title: buildLinqThreadTitle(data),
      isDirect: true,
    },
    actor: {
      id: normalizeTextValue(data.from),
      displayName: null,
      isSelf: Boolean(data.is_from_me),
    },
    occurredAt: toIsoTimestamp(
      normalizeTextValue(data.received_at) ?? normalizeTextValue(event.created_at) ?? new Date(),
    ),
    receivedAt: normalizeTextValue(data.received_at)
      ? toIsoTimestamp(data.received_at)
      : normalizeTextValue(event.created_at)
        ? toIsoTimestamp(event.created_at)
        : null,
    text: buildLinqMessageText(data.message.parts),
    attachments: await buildLinqAttachments(data.message.parts, downloadDriver, signal),
    raw: sanitizeRawLinqEvent(event),
  }
}

export function requireLinqMessageReceivedEvent(
  event: LinqWebhookEvent,
): LinqMessageReceivedEvent {
  if (event.event_type !== 'message.received' || !event.data || typeof event.data !== 'object') {
    throw new TypeError('Linq webhook event does not contain a supported message.received payload.')
  }

  return event as LinqMessageReceivedEvent
}

export function buildLinqMessageText(
  parts: ReadonlyArray<LinqMessagePart> | null | undefined,
): string | null {
  const values = (parts ?? [])
    .filter((part): part is Extract<LinqMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => normalizeTextValue(part.value))
    .filter((value): value is string => value !== null)

  return values.length > 0 ? values.join('\n') : null
}

async function buildLinqAttachments(
  parts: ReadonlyArray<LinqMessagePart> | null | undefined,
  downloadDriver: LinqAttachmentDownloadDriver | null,
  signal?: AbortSignal,
): Promise<InboundAttachment[]> {
  const attachments: InboundAttachment[] = []

  for (const [index, part] of (parts ?? []).entries()) {
    if (part.type !== 'media') {
      continue
    }

    const data = await downloadLinqAttachmentBestEffort(part, downloadDriver, signal)
    const fileName = normalizeTextValue(part.filename ?? null) ?? inferAttachmentFileName(part)
    const mime = normalizeTextValue(part.mime_type ?? null)

    attachments.push({
      externalId: normalizeTextValue(part.attachment_id ?? null) ?? `part:${index + 1}`,
      kind: inferLinqAttachmentKind(mime, fileName),
      mime,
      fileName,
      byteSize: normalizeAttachmentByteSize(part.size, data),
      data,
    })
  }

  return attachments
}

async function downloadLinqAttachmentBestEffort(
  part: LinqMediaPart,
  downloadDriver: LinqAttachmentDownloadDriver | null,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const url = normalizeTextValue(part.url ?? null)
  if (!downloadDriver || !url) {
    return null
  }

  try {
    return await downloadDriver.downloadUrl(url, signal)
  } catch {
    // Keep webhook acceptance tied to capture persistence, not best-effort media fetches.
    return null
  }
}

function buildLinqThreadTitle(data: LinqMessageReceivedData): string | null {
  const from = normalizeTextValue(data.from)
  const recipient = normalizeTextValue(data.recipient_phone ?? null)
  const service = normalizeTextValue(data.service ?? null)
  const participants = [from, recipient].filter((value): value is string => value !== null)
  if (participants.length === 0 && !service) {
    return null
  }

  const base = participants.join(' ↔ ')
  return service ? (base ? `${base} (${service})` : service) : base
}

function inferAttachmentFileName(part: LinqMediaPart): string | null {
  const url = normalizeTextValue(part.url ?? null)
  if (!url) {
    return null
  }

  try {
    const pathname = new URL(url).pathname
    const base = path.posix.basename(pathname)
    return normalizeTextValue(base)
  } catch {
    return null
  }
}

function inferLinqAttachmentKind(
  mime: string | null,
  fileName: string | null,
): InboundAttachment['kind'] {
  const lowerMime = String(mime ?? '').toLowerCase()
  const lowerName = String(fileName ?? '').toLowerCase()

  if (lowerMime.startsWith('image/') || /\.(gif|heic|heif|jpe?g|png|webp)$/u.test(lowerName)) {
    return 'image'
  }
  if (lowerMime.startsWith('audio/') || /\.(aac|m4a|mp3|ogg|wav)$/u.test(lowerName)) {
    return 'audio'
  }
  if (lowerMime.startsWith('video/') || /\.(m4v|mov|mp4|webm)$/u.test(lowerName)) {
    return 'video'
  }
  if (
    lowerMime === 'application/pdf' ||
    /\.(csv|docx?|pdf|rtf|txt|xls|xlsx)$/u.test(lowerName)
  ) {
    return 'document'
  }

  return 'other'
}

function normalizeAttachmentByteSize(
  value: number | null | undefined,
  data: Uint8Array | null,
): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }

  return data?.byteLength ?? null
}

function sanitizeRawLinqEvent(event: LinqWebhookEvent): Record<string, unknown> {
  const messageEvent =
    event.event_type === 'message.received' && event.data && typeof event.data === 'object'
      ? (event as LinqMessageReceivedEvent)
      : null

  return sanitizeRawMetadata(
    compactRecord({
      api_version: event.api_version,
      event_id: event.event_id,
      event_type: event.event_type,
      created_at: event.created_at,
      trace_id: event.trace_id,
      partner_id: event.partner_id,
      data: messageEvent ? pickLinqMessageReceivedData(messageEvent.data) : event.data,
    }),
  ) as Record<string, unknown>
}

function pickLinqMessageReceivedData(data: LinqMessageReceivedData): Record<string, unknown> {
  return compactRecord({
    chat_id: data.chat_id,
    from: data.from,
    recipient_phone: data.recipient_phone,
    received_at: data.received_at,
    is_from_me: data.is_from_me,
    service: data.service,
    message: compactRecord({
      id: data.message.id,
      parts: data.message.parts.map((part) => pickLinqMessagePart(part)),
      effect: data.message.effect ?? undefined,
      reply_to: data.message.reply_to ?? undefined,
    }),
  })
}

function pickLinqMessagePart(part: LinqMessagePart): Record<string, unknown> {
  if (part.type === 'text') {
    return compactRecord({
      type: part.type,
      value: part.value,
    })
  }

  return compactRecord({
    type: part.type,
    url: part.url,
    attachment_id: part.attachment_id,
    filename: part.filename,
    mime_type: part.mime_type,
    size: part.size,
  })
}

function compactRecord(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}
