import type { AssistantAcceptedTurnInputItemInput } from '../assistant/active-turn-input-journal.js'
import { readAssistantInputEvent } from '../assistant/input-store.js'

const AUTHORIZED_REFERENCE_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export interface AuthorizedReferenceImageEvidence {
  sha256: string
}

export type AuthorizedReferenceImageRefMap = ReadonlyMap<
  string,
  AuthorizedReferenceImageEvidence
>

// Returns the vault-relative raw paths (plus durable sha256 evidence) of the
// supported image attachments that were accepted as part of the current turn's
// input items. The generate_image tool requires every referenceImageRef to be
// in this map AND for the bytes read off disk to hash to the recorded sha256,
// so a same-turn workspace mutation cannot swap authorized bytes between the
// allowlist check and the OpenAI image-edits egress. An attachment with no
// stored sha256 in evidence does not provide durable authority and is omitted
// from the map; the resolver fails closed when a requested ref isn't present.
export async function collectAuthorizedTurnAttachmentImageRefs(input: {
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[] | null | undefined
  vault: string | null | undefined
}): Promise<Map<string, AuthorizedReferenceImageEvidence>> {
  const refs = new Map<string, AuthorizedReferenceImageEvidence>()
  const vault = input.vault?.trim()
  if (!vault) {
    return refs
  }
  for (const item of input.acceptedInputItems ?? []) {
    if (item.source !== 'assistant-input') {
      continue
    }
    const contentRef = item.contentRef
    if (contentRef?.kind !== 'assistant-input-event') {
      continue
    }
    const event = await readAssistantInputEvent({
      inputId: contentRef.refId,
      vault,
    })
    if (!event) {
      continue
    }
    for (const attachment of event.attachmentEvidence?.attachments ?? []) {
      const rawPath = attachment.raw?.path
      if (!rawPath) {
        continue
      }
      const mime = attachment.mime ?? null
      if (!mime || !AUTHORIZED_REFERENCE_IMAGE_MEDIA_TYPES.has(mime)) {
        continue
      }
      const sha256 = attachment.raw?.sha256 ?? null
      if (!sha256) {
        continue
      }
      refs.set(rawPath, { sha256 })
    }
  }
  return refs
}
