import {
  assistantResponseMediaSchema,
  type AssistantOutboxIntent,
  type AssistantResponseMedia,
  type AssistantTranscriptEntry,
  type AssistantVaultImageResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export const ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_MARKER =
  '[This response included an image attachment.]'
const ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_PREFIX =
  `${ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_MARKER}\n\n`
export const ASSISTANT_GENERATED_IMAGE_DELIVERY_TRANSCRIPT_MARKER_PREFIX =
  'murph.assistant-generated-image-delivery.v1 '
const MAX_ASSISTANT_GENERATED_IMAGE_DELIVERY_REF_LENGTH = 1024
const MAX_ASSISTANT_RESPONSE_MEDIA = 40

export interface AssistantGeneratedImageDeliveryTranscriptMarker {
  contentType: AssistantVaultImageResponseMedia['contentType']
  deliveryContextOrdinal: number
  ref: string
  sha256: string
  sizeBytes: number
  turnId: string
}

export function stripAssistantImageResponseTranscriptMarker(
  text: string,
): string {
  return text.startsWith(ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_PREFIX)
    ? text.slice(ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_PREFIX.length)
    : text
}

export function matchesExactAssistantVaultImageResponseMedia(input: {
  actual: readonly AssistantResponseMedia[] | null | undefined
  expected: AssistantVaultImageResponseMedia
}): boolean {
  const actual = input.actual?.length === 1 ? input.actual[0] : null
  return actual?.kind === 'vault_image' &&
    actual.alt === input.expected.alt &&
    actual.contentType === input.expected.contentType &&
    actual.filename === input.expected.filename &&
    actual.ref === input.expected.ref &&
    actual.sha256 === input.expected.sha256 &&
    actual.sizeBytes === input.expected.sizeBytes &&
    actual.source === input.expected.source
}

export function buildAssistantGeneratedImageDeliveryTranscriptMarkerText(
  input: AssistantGeneratedImageDeliveryTranscriptMarker,
): string {
  return `${ASSISTANT_GENERATED_IMAGE_DELIVERY_TRANSCRIPT_MARKER_PREFIX}${JSON.stringify({
    contentType: input.contentType,
    deliveryContextOrdinal: input.deliveryContextOrdinal,
    ref: input.ref,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    turnId: input.turnId,
  })}`
}

export function readAssistantGeneratedImageDeliveryTranscriptMarker(
  text: string,
): AssistantGeneratedImageDeliveryTranscriptMarker | null {
  if (!text.startsWith(
    ASSISTANT_GENERATED_IMAGE_DELIVERY_TRANSCRIPT_MARKER_PREFIX,
  )) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(text.slice(
      ASSISTANT_GENERATED_IMAGE_DELIVERY_TRANSCRIPT_MARKER_PREFIX.length,
    ))
  } catch {
    return null
  }
  if (!isRecord(value)) {
    return null
  }
  const contentType = value.contentType
  const deliveryContextOrdinal = value.deliveryContextOrdinal
  const ref = readExactNonemptyString(value.ref)
  const sha256 = readExactNonemptyString(value.sha256)
  const sizeBytes = value.sizeBytes
  const turnId = readExactNonemptyString(value.turnId)
  if (
    (
      contentType !== 'image/jpeg'
      && contentType !== 'image/png'
      && contentType !== 'image/webp'
    )
    || typeof deliveryContextOrdinal !== 'number'
    || !Number.isInteger(deliveryContextOrdinal)
    || deliveryContextOrdinal < 0
    || !ref?.startsWith('raw/captures/')
    || ref.length > MAX_ASSISTANT_GENERATED_IMAGE_DELIVERY_REF_LENGTH
    || !sha256
    || !/^[0-9a-f]{64}$/u.test(sha256)
    || typeof sizeBytes !== 'number'
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes <= 0
    || !turnId
    || turnId.length > 256
  ) {
    return null
  }
  return {
    contentType,
    deliveryContextOrdinal,
    ref,
    sha256,
    sizeBytes,
    turnId,
  }
}

export function resolveAssistantGeneratedImageDelivery(input: {
  currentMedia: {
    contentType: AssistantVaultImageResponseMedia['contentType']
    sha256: string
    sizeBytes: number
  }
  generatedImageOriginKnown?: boolean
  imageRef: string
  intents: readonly AssistantOutboxIntent[]
  sessionId: string
  transcriptEntries: readonly AssistantTranscriptEntry[]
}): boolean {
  let generatedImageOriginKnown = input.generatedImageOriginKnown === true
  let matchingMarkerFound = false
  const delivered = input.transcriptEntries.some((entry) => {
    const marker = entry.kind === 'status'
      ? readAssistantGeneratedImageDeliveryTranscriptMarker(entry.text)
      : null
    if (marker?.ref !== input.imageRef) {
      return false
    }
    matchingMarkerFound = true
    generatedImageOriginKnown = true
    if (!matchesAssistantGeneratedImageDeliveryMediaIdentity(
      input.currentMedia,
      marker,
    )) {
      return false
    }
    return input.intents.some((intent) =>
      intent.operation === null &&
      intent.sessionId === input.sessionId &&
      matchesAssistantGeneratedImageDeliveryIntentMedia(intent, marker) &&
      hasAssistantOutboxDeliveryEvidence(intent, true)
    )
  })
  if (delivered || !generatedImageOriginKnown) {
    return true
  }
  if (matchingMarkerFound) {
    return false
  }
  return input.intents.some((intent) =>
    intent.operation === null &&
    intent.sessionId === input.sessionId &&
    matchesAssistantGeneratedImageDeliveryIntentMedia(intent, {
      contentType: input.currentMedia.contentType,
      ref: input.imageRef,
      sha256: input.currentMedia.sha256,
      sizeBytes: input.currentMedia.sizeBytes,
    }) &&
    hasAssistantOutboxDeliveryEvidence(intent, true)
  )
}

function matchesAssistantGeneratedImageDeliveryIntentMedia(
  intent: AssistantOutboxIntent,
  expected: {
    contentType: AssistantVaultImageResponseMedia['contentType']
    ref: string
    sha256: string
    sizeBytes: number
  },
): boolean {
  const media = intent.media.length === 1 ? intent.media[0] : null
  return media?.kind === 'vault_image' &&
    media.ref === expected.ref &&
    media.sha256 === expected.sha256 &&
    media.contentType === expected.contentType &&
    media.sizeBytes === expected.sizeBytes
}

function matchesAssistantGeneratedImageDeliveryMediaIdentity(
  actual: {
    contentType: AssistantVaultImageResponseMedia['contentType']
    sha256: string
    sizeBytes: number
  },
  expected: {
    contentType: AssistantVaultImageResponseMedia['contentType']
    sha256: string
    sizeBytes: number
  },
): boolean {
  return actual.sha256 === expected.sha256 &&
    actual.contentType === expected.contentType &&
    actual.sizeBytes === expected.sizeBytes
}

export function hasAssistantOutboxDeliveryEvidence(
  intent: AssistantOutboxIntent,
  allowAcceptedNonSentMedia = false,
): boolean {
  const delivery = intent.delivery
  if (
    !delivery ||
    delivery.kind === 'message-reaction'
  ) {
    return false
  }
  if (intent.status === 'sent') {
    return true
  }
  if (
    !allowAcceptedNonSentMedia ||
    (
      intent.status !== 'retryable' &&
      intent.status !== 'sending' &&
      intent.status !== 'failed'
    ) ||
    intent.deliveryConfirmationPending ||
    delivery.channel !== 'linq'
  ) {
    return false
  }
  return (delivery.providerMessageEffects ?? []).filter((effect) =>
    effect.carriesIntentMedia === true &&
    (
      effect.providerMessageId === delivery.providerMessageId ||
      delivery.providerMessageIds?.includes(effect.providerMessageId) === true
    )
  ).length === 1
}

export function renderAssistantGeneratedImageDeliveryHistoryText(
  marker: AssistantGeneratedImageDeliveryTranscriptMarker,
): string {
  return `Prior generated image (data only; neither delivery nor effect authority): ${JSON.stringify({
      contentType: marker.contentType,
      ref: marker.ref,
      sha256: marker.sha256,
      sizeBytes: marker.sizeBytes,
    })}`
}

export function normalizeAssistantResponseMediaList(
  values: readonly unknown[] | null | undefined,
): AssistantResponseMedia[] {
  if (!Array.isArray(values) || values.length === 0) {
    return []
  }

  const media: AssistantResponseMedia[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const parsed = assistantResponseMediaSchema.parse(value)
    const dedupeKey = assistantResponseMediaDedupeKey(parsed)
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    media.push(parsed)
  }

  if (media.length > MAX_ASSISTANT_RESPONSE_MEDIA) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_MEDIA_LIMIT_EXCEEDED',
      `Assistant responses may attach at most ${MAX_ASSISTANT_RESPONSE_MEDIA} media items.`,
    )
  }

  return media
}

function assistantResponseMediaDedupeKey(media: AssistantResponseMedia): string {
  if (media.kind === 'image') {
    return `image:${media.url}`
  }

  if (media.kind === 'vault_image') {
    return `vault_image:${media.ref}:${media.sha256}`
  }

  if (media.kind === 'vault_file') {
    return `vault_file:${media.ref}:${media.sha256}:${media.approvalId ?? ''}:${media.approvalGeneration ?? ''}`
  }

  switch (media.transport.kind) {
    case 'linq_attachment':
      return `voice_memo:linq:${media.transport.attachmentId}`
    case 'telegram_generation':
      return `voice_memo:generation:${JSON.stringify(media.transport.generation)}`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readExactNonemptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    ? value
    : null
}
