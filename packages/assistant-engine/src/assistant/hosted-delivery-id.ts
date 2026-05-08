import { createHash } from 'node:crypto'

export function createHostedDeliveryId(input: {
  userId: string
  channel: string
  conversationId: string
  inboundMailboxItemIds: readonly string[]
  recipientKey: string
  assistantTurnOrdinal: number | string
}): string {
  return sha256Json({
    assistantTurnOrdinal: input.assistantTurnOrdinal,
    channel: input.channel,
    conversationId: input.conversationId,
    inboundMailboxItemIds: [...input.inboundMailboxItemIds].sort(),
    recipientKey: input.recipientKey,
    schema: 'murph.hosted-delivery-id.v1',
    userId: input.userId,
  })
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')}`
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value))
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item))
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, stableJsonValue(entryValue)]),
    )
  }
  return value
}
