export const ASSISTANT_LINQ_APP_CARD_FALLBACK_SUFFIX = ':fallback'
export const ASSISTANT_LINQ_STALE_CHAT_APP_CARD_FALLBACK_SUFFIX =
  ':stale-chat-fallback'

export function buildAssistantLinqAppCardFallbackIdempotencyKey(input: {
  idempotencyKey: string
  staleChat: boolean
}): string {
  return `${input.idempotencyKey}${
    input.staleChat
      ? ASSISTANT_LINQ_STALE_CHAT_APP_CARD_FALLBACK_SUFFIX
      : ASSISTANT_LINQ_APP_CARD_FALLBACK_SUFFIX
  }`
}

export function isAssistantLinqStaleChatAppCardFallbackIdempotencyKey(
  value: string | null | undefined,
): boolean {
  const idempotencyKey = value?.trim() ?? ''
  return idempotencyKey.length
      > ASSISTANT_LINQ_STALE_CHAT_APP_CARD_FALLBACK_SUFFIX.length
    && idempotencyKey.endsWith(
      ASSISTANT_LINQ_STALE_CHAT_APP_CARD_FALLBACK_SUFFIX,
    )
}

export function isAssistantLinqAppCardFallbackIdempotencyKey(
  value: string | null | undefined,
): boolean {
  const idempotencyKey = value?.trim() ?? ''
  return [
    ASSISTANT_LINQ_STALE_CHAT_APP_CARD_FALLBACK_SUFFIX,
    ASSISTANT_LINQ_APP_CARD_FALLBACK_SUFFIX,
  ].some((suffix) => (
    idempotencyKey.length > suffix.length
    && idempotencyKey.endsWith(suffix)
  ))
}
