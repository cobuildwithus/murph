import path from 'node:path'
import type { InboundAttachment, InboundCapture } from '../../contracts/capture.ts'
import type { ChatMessage } from '../chat/message.ts'
import { createInboundCaptureFromChatMessage } from '../chat/message.ts'
import {
  normalizeTextValue,
  relayAbort,
  sanitizeRawMetadata,
  toIsoTimestamp,
} from '../../shared-runtime.ts'
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
  attachmentDownloadTimeoutMs?: number | null
}

export async function normalizeLinqWebhookEvent({
  event,
  source = 'linq',
  defaultAccountId = null,
  downloadDriver = null,
  signal,
  attachmentDownloadTimeoutMs = null,
}: NormalizeLinqWebhookEventInput): Promise<InboundCapture> {
  const messageEvent = parseCanonicalLinqMessageReceivedEvent(event)
  const accountId =
    normalizeTextValue(messageEvent.data.recipient_phone ?? null) ?? defaultAccountId
  const message = await toLinqChatMessage({
    event: messageEvent,
    downloadDriver,
    signal,
    attachmentDownloadTimeoutMs,
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
  attachmentDownloadTimeoutMs?: number | null
}): Promise<ChatMessage> {
  const { event, downloadDriver = null, signal, attachmentDownloadTimeoutMs = null } = input
  const data = event.data
  const receivedAt = normalizeTextValue(data.received_at)
  const createdAt = normalizeTextValue(event.created_at)
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
      isSelf: data.is_from_me,
    },
    occurredAt: toIsoTimestamp(receivedAt ?? createdAt ?? new Date()),
    receivedAt: receivedAt
      ? toIsoTimestamp(receivedAt)
      : createdAt
        ? toIsoTimestamp(createdAt)
        : null,
    text: buildLinqMessageText(data.message.parts),
    attachments: await buildLinqAttachments(
      data.message.parts,
      downloadDriver,
      signal,
      attachmentDownloadTimeoutMs,
    ),
    raw: sanitizeRawLinqEvent(event),
  }
}

export function requireLinqMessageReceivedEvent(
  event: LinqWebhookEvent,
): LinqMessageReceivedEvent {
  if (event.event_type !== 'message.received') {
    throw new TypeError('Linq webhook event does not contain a supported message.received payload.')
  }

  const data = toLinqObjectRecord(event.data, 'Linq message.received data')
  const message = toLinqObjectRecord(data.message, 'Linq message.received message')
  const parts = message.parts

  if (!Array.isArray(parts)) {
    throw new TypeError('Linq message.received message.parts must be an array.')
  }

  const normalizedEvent: LinqMessageReceivedEvent = {
    ...event,
    event_type: 'message.received',
    created_at: normalizeRequiredTimestamp(event.created_at, 'Linq webhook created_at'),
    trace_id: normalizeNullableString(event.trace_id ?? null),
    partner_id: normalizeNullableString(event.partner_id ?? null),
    data: {
      chat_id: normalizeRequiredString(data.chat_id, 'Linq message.received chat_id'),
      from: normalizeRequiredString(data.from, 'Linq message.received from'),
      recipient_phone: normalizeNullableString(data.recipient_phone),
      received_at: normalizeOptionalTimestamp(data.received_at, 'Linq message.received received_at'),
      is_from_me: normalizeRequiredBoolean(data.is_from_me, 'Linq message.received is_from_me'),
      service: normalizeNullableString(data.service),
      message: {
        id: normalizeRequiredString(message.id, 'Linq message.received message.id'),
        parts: parts.map((part, index) => parseLinqMessagePart(part, index)),
        effect: parseOptionalMessageEffect(message.effect),
        reply_to: parseOptionalReplyTo(message.reply_to),
      },
    },
  }

  return normalizedEvent
}

export function parseCanonicalLinqMessageReceivedEvent(
  event: LinqWebhookEvent,
): LinqMessageReceivedEvent {
  return requireLinqMessageReceivedEvent(event)
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
  attachmentDownloadTimeoutMs?: number | null,
): Promise<InboundAttachment[]> {
  const attachments: InboundAttachment[] = []

  for (const [index, part] of (parts ?? []).entries()) {
    if (part.type !== 'media') {
      continue
    }

    const data = await downloadLinqAttachmentInlineBestEffort(
      part,
      downloadDriver,
      signal,
      attachmentDownloadTimeoutMs,
    )
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

async function downloadLinqAttachmentInlineBestEffort(
  part: LinqMediaPart,
  downloadDriver: LinqAttachmentDownloadDriver | null,
  signal?: AbortSignal,
  attachmentDownloadTimeoutMs?: number | null,
): Promise<Uint8Array | null> {
  const url = normalizeTextValue(part.url ?? null)
  if (!downloadDriver || !url) {
    return null
  }

  try {
    const normalizedTimeoutMs = normalizeAttachmentDownloadTimeout(attachmentDownloadTimeoutMs)
    if (normalizedTimeoutMs !== null) {
      return await downloadLinqAttachmentWithTimeout(
        downloadDriver,
        url,
        normalizedTimeoutMs,
        signal,
      )
    }

    return await downloadDriver.downloadUrl(url, signal)
  } catch {
    // Attachment bytes are optional at persistence time, but this download still happens inline
    // on the request path until it succeeds, fails, times out, or is aborted by the watch signal.
    return null
  }
}

async function downloadLinqAttachmentWithTimeout(
  downloadDriver: LinqAttachmentDownloadDriver,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const controller = new AbortController()
  const releaseRelay = signal ? relayAbort(signal, controller) : () => {}

  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        controller.abort()
        resolve(null)
      }, timeoutMs)

      void downloadDriver
        .downloadUrl(url, controller.signal)
        .then((data) => {
          clearTimeout(timeout)
          resolve(data)
        })
        .catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
    })
  } finally {
    releaseRelay()
  }
}

function normalizeAttachmentDownloadTimeout(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.max(0, Math.floor(value))
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

function parseLinqMessagePart(part: unknown, index: number): LinqMessagePart {
  const record = toLinqObjectRecord(part, `Linq message.received message.parts[${index}]`)
  const type = normalizeRequiredString(record.type, `Linq message.received message.parts[${index}] type`)

  if (type === 'text') {
    return {
      type,
      value: normalizeRequiredString(
        record.value,
        `Linq message.received message.parts[${index}] value`,
      ),
    }
  }

  if (type === 'media') {
    return {
      type,
      url: normalizeNullableString(record.url),
      attachment_id: normalizeNullableString(record.attachment_id),
      filename: normalizeNullableString(record.filename),
      mime_type: normalizeNullableString(record.mime_type),
      size: normalizeNullableNumber(record.size),
    }
  }

  throw new TypeError(
    `Linq message.received message.parts[${index}] type must be "text" or "media".`,
  )
}

function parseOptionalMessageEffect(value: unknown): LinqMessageReceivedData['message']['effect'] {
  if (value == null) {
    return null
  }

  const record = toLinqObjectRecord(value, 'Linq message.received message.effect')
  return {
    type: normalizeNullableString(record.type),
    name: normalizeNullableString(record.name),
  }
}

function parseOptionalReplyTo(value: unknown): LinqMessageReceivedData['message']['reply_to'] {
  if (value == null) {
    return null
  }

  const record = toLinqObjectRecord(value, 'Linq message.received message.reply_to')
  return {
    message_id: normalizeNullableString(record.message_id),
    part_index: normalizeNullableNumber(record.part_index),
  }
}

function toLinqObjectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }

  return value as Record<string, unknown>
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new TypeError(`${label} is required.`)
  }

  return normalized
}

function normalizeRequiredTimestamp(value: unknown, label: string): string {
  return normalizeTimestamp(normalizeRequiredString(value, label), label)
}

function normalizeOptionalTimestamp(value: unknown, label: string): string | null {
  const normalized = normalizeNullableString(value)
  return normalized ? normalizeTimestamp(normalized, label) : null
}

function normalizeTimestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${label} must be a valid timestamp.`)
  }

  return value
}

function normalizeRequiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean.`)
  }

  return value
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Linq media size must be a finite number when provided.')
  }

  return Math.floor(value)
}

function normalizeNullableString(value: unknown): string | null {
  return normalizeTextValue(value)
}
