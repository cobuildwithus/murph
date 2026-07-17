import { randomUUID } from 'node:crypto'
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
// identity. A per-send collision-free basename keeps a later turn's reuse of
// the same friendly name from overwriting bytes an earlier still-active
// delivery already staged.
export function buildAssistantGeneratedDeliveryOwnedRef(
  displayFilename: string,
): string {
  const extension = path.posix.extname(displayFilename).toLowerCase()
  const stem = path.posix
    .basename(displayFilename, path.posix.extname(displayFilename))
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[.-]+/u, '')
    .slice(0, 64)
  const ownedFilename = `${stem.length > 0 ? `${stem}-` : ''}${randomUUID()}${extension}`
  const ownedRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/${ownedFilename}`
  if (!isAssistantGeneratedDeliveryRef(ownedRef)) {
    throw new Error(
      'The generated delivery owned ref failed flat-shape validation.',
    )
  }
  return ownedRef
}
