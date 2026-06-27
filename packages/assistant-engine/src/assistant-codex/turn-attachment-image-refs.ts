import type { AssistantAcceptedTurnInputItemInput } from '../assistant/active-turn-input-journal.js'
import type {
  AssistantInputAttachmentEvidenceItem,
} from '../assistant/automation.js'
import { readAssistantInputEvent } from '../assistant/input-store.js'
import { getRoutingImageEligibility } from '../inbox-routing-vision.js'

// generate_image edits ship JPEG/PNG/WebP bytes. GIF is reachable through the
// shared routing-vision eligibility surface but is not a supported OpenAI
// images.edits input format, so we narrow the eligibility result to the three
// formats the resolver actually sends.
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
      const authorized = authorizeReferenceImageEvidence(attachment)
      if (!authorized) {
        continue
      }
      refs.set(authorized.rawPath, { sha256: authorized.sha256 })
    }
  }
  return refs
}

// Pure projection: takes one attachment evidence row and returns the (path,
// sha256) authority tuple iff the attachment is a JPEG/PNG/WebP image-edits
// candidate the upstream pipeline would already route through the vision lane.
// Exported so the eligibility surface stays unit-testable without the input
// store round-trip.
export function authorizeReferenceImageEvidence(
  attachment: AssistantInputAttachmentEvidenceItem,
): { rawPath: string; sha256: string } | null {
  const rawPath = attachment.raw?.path
  if (!rawPath) {
    return null
  }
  const eligibility = getRoutingImageEligibility({
    fileName: attachment.fileName,
    kind: attachment.kind,
    mediaType: attachment.raw?.mediaType ?? null,
    mime: attachment.mime,
    storedPath: rawPath,
  })
  if (
    !eligibility.eligible ||
    !eligibility.mediaType ||
    !AUTHORIZED_REFERENCE_IMAGE_MEDIA_TYPES.has(eligibility.mediaType)
  ) {
    return null
  }
  const sha256 = attachment.raw?.sha256 ?? null
  if (!sha256) {
    return null
  }
  return { rawPath, sha256 }
}
