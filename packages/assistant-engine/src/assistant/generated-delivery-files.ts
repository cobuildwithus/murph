import { createHash } from 'node:crypto'
import path from 'node:path'

import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
  isAssistantGeneratedDeliveryRef,
} from '@murphai/runtime-state/assistant-generated-deliveries'

export {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
  isAssistantGeneratedDeliveryRef,
}

const ASSISTANT_VAULT_FILE_CONTENT_TYPES = new Map<string, string>([
  ['.csv', 'text/csv'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.ics', 'text/calendar'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.pdf', 'application/pdf'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.rtf', 'text/rtf'],
  ['.txt', 'text/plain'],
  ['.vcf', 'text/vcard'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.zip', 'application/zip'],
])

export function resolveSupportedAssistantVaultFileContentType(
  filename: string,
): string | null {
  const extension = path.posix.extname(filename).toLowerCase()
  return ASSISTANT_VAULT_FILE_CONTENT_TYPES.get(extension) ?? null
}

// The model chooses a friendly staging name; the runtime owns the persisted
// identity. A stable per-send basename lets an interrupted retry recover the
// same owned bytes, while distinct tool calls remain collision-free even when
// they reuse the same friendly name.
export function buildAssistantGeneratedDeliveryOwnedRef(input: {
  displayFilename: string
  ref: string
  sessionId: string
  toolCallId: string | null
  turnId: string
}): string {
  const extension = path.posix.extname(input.displayFilename).toLowerCase()
  const stem = path.posix
    .basename(
      input.displayFilename,
      path.posix.extname(input.displayFilename),
    )
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[.-]+/u, '')
    .slice(0, 64)
  const ownedId = createHash('sha256')
    .update(JSON.stringify([
      'murph.assistant-generated-delivery-owned-ref.v1',
      input.sessionId,
      input.turnId,
      input.toolCallId,
      input.ref,
    ]))
    .digest('hex')
  const ownedFilename = `${stem.length > 0 ? `${stem}-` : ''}${ownedId}${extension}`
  const ownedRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/${ownedFilename}`
  if (!isAssistantGeneratedDeliveryRef(ownedRef)) {
    throw new Error(
      'The generated delivery owned ref failed flat-shape validation.',
    )
  }
  return ownedRef
}
