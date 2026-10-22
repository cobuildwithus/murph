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
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.mpeg', 'video/mpeg'],
  ['.mpg', 'video/mpeg'],
  ['.m2v', 'video/mpeg2'],
  ['.m4v', 'video/x-m4v'],
  ['.avi', 'video/x-msvideo'],
  ['.3gp', 'video/3gpp'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/x-m4a'],
  ['.caf', 'audio/x-caf'],
  ['.wav', 'audio/x-wav'],
  ['.aif', 'audio/x-aiff'],
  ['.aiff', 'audio/x-aiff'],
  ['.aac', 'audio/aac'],
  ['.mid', 'audio/midi'],
  ['.midi', 'audio/midi'],
  ['.amr', 'audio/amr'],
  ['.csv', 'text/csv'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.epub', 'application/epub+zip'],
  ['.htm', 'text/html'],
  ['.html', 'text/html'],
  ['.ics', 'text/calendar'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.pages', 'application/x-iwork-pages-sffpages'],
  ['.numbers', 'application/x-iwork-numbers-sffnumbers'],
  ['.key', 'application/x-iwork-keynote-sffkey'],
  ['.pdf', 'application/pdf'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.rtf', 'text/rtf'],
  ['.txt', 'text/plain'],
  ['.vcf', 'text/vcard'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xml', 'text/xml'],
  ['.zip', 'application/zip'],
  ['.gz', 'application/x-gzip'],
  ['.gzip', 'application/x-gzip'],
])

export function resolveSupportedAssistantVaultFileContentType(
  filename: string,
): string | null {
  const extension = path.posix.extname(filename).toLowerCase()
  return ASSISTANT_VAULT_FILE_CONTENT_TYPES.get(extension) ?? null
}

// The model chooses a friendly staging name; the runtime owns the persisted
// identity. A stable per-tool-call basename lets an exact call re-delivery
// recover the same owned bytes, while distinct calls remain collision-free
// even when they reuse the same friendly name.
export function buildAssistantGeneratedDeliveryOwnedRef(input: {
  displayFilename: string
  ref: string
  sessionId: string
  toolCallId: string
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
