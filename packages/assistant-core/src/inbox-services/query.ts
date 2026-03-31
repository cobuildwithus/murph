import {
  type InboxConnectorConfig,
  type InboxPromotionEntry,
  type InboxRuntimeConfig,
} from '../inbox-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import type {
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../inbox-app/types.js'
import { requireConnector } from './state.js'
import { listAllCaptures, runtimeNamespaceAccountId } from './shared.js'

export function hasStoredPath(
  attachment: RuntimeAttachmentRecord,
): attachment is RuntimeAttachmentRecord & { storedPath: string } {
  return typeof attachment.storedPath === 'string' && attachment.storedPath.length > 0
}

export function isStoredImageAttachment(
  attachment: RuntimeAttachmentRecord,
): attachment is RuntimeAttachmentRecord & { kind: 'image'; storedPath: string } {
  return attachment.kind === 'image' && hasStoredPath(attachment)
}

export function isStoredAudioAttachment(
  attachment: RuntimeAttachmentRecord,
): attachment is RuntimeAttachmentRecord & { kind: 'audio'; storedPath: string } {
  return attachment.kind === 'audio' && hasStoredPath(attachment)
}

export function isStoredDocumentAttachment(
  attachment: RuntimeAttachmentRecord,
): attachment is RuntimeAttachmentRecord & { kind: 'document'; storedPath: string } {
  return attachment.kind === 'document' && hasStoredPath(attachment)
}

export function buildCaptureCursor(capture: {
  occurredAt: string
  externalId: string
  receivedAt?: string | null
}): Record<string, unknown> {
  return {
    occurredAt: capture.occurredAt,
    externalId: capture.externalId,
    receivedAt: capture.receivedAt ?? null,
  }
}

export function summarizeCapture(
  capture: RuntimeCaptureRecord,
  promotions: InboxPromotionEntry[],
) {
  return {
    captureId: capture.captureId,
    source: capture.source,
    accountId: capture.accountId ?? null,
    externalId: capture.externalId,
    threadId: capture.thread.id,
    threadTitle: capture.thread.title ?? null,
    actorId: capture.actor.id ?? null,
    actorName: capture.actor.displayName ?? null,
    actorIsSelf: capture.actor.isSelf,
    occurredAt: capture.occurredAt,
    receivedAt: capture.receivedAt ?? null,
    text: capture.text,
    attachmentCount: capture.attachments.length,
    envelopePath: capture.envelopePath,
    eventId: capture.eventId,
    promotions,
  }
}

export function detailCapture(
  capture: RuntimeCaptureRecord,
  promotions: InboxPromotionEntry[],
) {
  return {
    ...summarizeCapture(capture, promotions),
    createdAt: capture.createdAt,
    threadIsDirect: capture.thread.isDirect ?? false,
    attachments: capture.attachments.map(toCliAttachment),
  }
}

export function toCliAttachment(attachment: RuntimeAttachmentRecord) {
  return {
    attachmentId: attachment.attachmentId ?? null,
    ordinal: attachment.ordinal,
    externalId: attachment.externalId ?? null,
    kind: attachment.kind,
    mime: attachment.mime ?? null,
    originalPath: attachment.originalPath ?? null,
    storedPath: attachment.storedPath ?? null,
    fileName: attachment.fileName ?? null,
    byteSize: attachment.byteSize ?? null,
    sha256: attachment.sha256 ?? null,
    extractedText: attachment.extractedText ?? null,
    transcriptText: attachment.transcriptText ?? null,
    derivedPath: attachment.derivedPath ?? null,
    parserProviderId: attachment.parserProviderId ?? null,
    parseState: attachment.parseState ?? null,
  }
}

export function requireCapture(
  runtime: RuntimeStore,
  captureId: string,
): RuntimeCaptureRecord {
  const capture = runtime.getCapture(captureId)
  if (!capture) {
    throw new VaultCliError(
      'INBOX_CAPTURE_NOT_FOUND',
      `Inbox capture "${captureId}" was not found.`,
    )
  }

  return capture
}

export function requireAttachmentRecord(
  runtime: RuntimeStore,
  attachmentId: string,
): {
  capture: RuntimeCaptureRecord
  attachment: RuntimeAttachmentRecord
} {
  for (const capture of listAllCaptures(runtime)) {
    const detailedCapture = runtime.getCapture(capture.captureId) ?? capture
    const attachment = detailedCapture.attachments.find(
      (candidate) => candidate.attachmentId === attachmentId,
    )
    if (attachment) {
      return {
        capture: detailedCapture,
        attachment,
      }
    }
  }

  throw new VaultCliError(
    'INBOX_ATTACHMENT_NOT_FOUND',
    `Inbox attachment "${attachmentId}" was not found.`,
  )
}

export function resolveSourceFilter(
  config: InboxRuntimeConfig,
  sourceId: string | null,
): { source: string; accountId: string | null } | null {
  if (!sourceId) {
    return null
  }

  const connector = requireConnector(config, sourceId)
  return {
    source: connector.source,
    accountId: runtimeNamespaceAccountId(connector),
  }
}
