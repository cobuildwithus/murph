import type { AssistantAcceptedTurnInputItemInput } from '../assistant/active-turn-input-journal.js'
import { readAssistantInputEvent } from '../assistant/input-store.js'

const AUTHORIZED_REFERENCE_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

// Returns the vault-relative raw paths of the supported image attachments that
// were accepted as part of the current turn's input items. The generate_image
// tool requires every referenceImageRef to live in this set so the model cannot
// re-egress an older inbox image (or any other vault file) that survives in the
// hosted workspace from a prior turn. Empty set means "no current-turn image
// attachments authorized for reference," which the resolver treats as
// fail-closed when the model requests any refs.
export async function collectAuthorizedTurnAttachmentImageRefs(input: {
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[] | null | undefined
  vault: string | null | undefined
}): Promise<Set<string>> {
  const refs = new Set<string>()
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
      refs.add(rawPath)
    }
  }
  return refs
}
