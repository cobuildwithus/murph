import {
  INBOX_IMAGE_RETENTION_WINDOW_MS,
  INBOX_VIDEO_RETENTION_WINDOW_MS,
} from '@murphai/contracts'
import type {
  AssistantInputAttachmentEvidenceItem,
  AssistantInputEventRecord,
} from './input-store.js'

export function assistantInputMediaExpiresAt(
  event: Pick<AssistantInputEventRecord, 'receivedAt' | 'occurredAt'>,
  attachment: AssistantInputAttachmentEvidenceItem,
): number | null {
  if (!attachment.raw || (attachment.kind !== 'image' && attachment.kind !== 'video')) return null
  const receivedAt = Date.parse(event.receivedAt ?? event.occurredAt)
  if (!Number.isFinite(receivedAt)) return null
  return receivedAt + (attachment.kind === 'image'
    ? INBOX_IMAGE_RETENTION_WINDOW_MS : INBOX_VIDEO_RETENTION_WINDOW_MS)
}

export function hasRetainedAssistantInputMedia(
  event: AssistantInputEventRecord,
  now: number,
): boolean {
  return event.attachmentEvidence.attachments.some((attachment) =>
    (assistantInputMediaExpiresAt(event, attachment) ?? 0) > now,
  )
}
