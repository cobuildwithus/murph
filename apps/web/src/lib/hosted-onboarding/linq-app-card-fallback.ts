export const HOSTED_LINQ_APP_CARD_FALLBACK_IDEMPOTENCY_SUFFIX = ":fallback";
export const HOSTED_LINQ_STALE_CHAT_APP_CARD_FALLBACK_IDEMPOTENCY_SUFFIX =
  ":stale-chat-fallback";

export type HostedLinqAppCardFallbackIdentity = {
  kind: "ordinary" | "stale_chat";
  predecessorIdempotencyKey: string;
};

export function parseHostedLinqAppCardFallbackIdentity(
  value: string | null | undefined,
): HostedLinqAppCardFallbackIdentity | null {
  const idempotencyKey = value?.trim() ?? "";
  for (const candidate of [
    {
      kind: "stale_chat" as const,
      suffix: HOSTED_LINQ_STALE_CHAT_APP_CARD_FALLBACK_IDEMPOTENCY_SUFFIX,
    },
    {
      kind: "ordinary" as const,
      suffix: HOSTED_LINQ_APP_CARD_FALLBACK_IDEMPOTENCY_SUFFIX,
    },
  ]) {
    if (
      idempotencyKey.length > candidate.suffix.length
      && idempotencyKey.endsWith(candidate.suffix)
    ) {
      return {
        kind: candidate.kind,
        predecessorIdempotencyKey: idempotencyKey.slice(
          0,
          -candidate.suffix.length,
        ),
      };
    }
  }
  return null;
}

export function isHostedLinqStaleChatAppCardFallbackIdempotencyKey(
  value: string | null | undefined,
): boolean {
  return parseHostedLinqAppCardFallbackIdentity(value)?.kind === "stale_chat";
}
