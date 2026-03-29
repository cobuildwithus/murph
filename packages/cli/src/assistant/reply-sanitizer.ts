import { normalizeNullableString } from './shared.js'

const ASSISTANT_LOCAL_MARKDOWN_LINK_PATTERN =
  /\[([^\]\n]+)\]\(((?:\/|file:\/\/)[^)]+)\)/gu

export function sanitizeAssistantOutboundReply(
  response: string,
  channel: string | null,
): string {
  if (!isAssistantOutboundReplyChannel(channel)) {
    return response
  }

  const withoutLocalMarkdownLinks = response.replace(
    ASSISTANT_LOCAL_MARKDOWN_LINK_PATTERN,
    '$1',
  )
  const lines = withoutLocalMarkdownLinks.split(/\r?\n/u)
  const sanitized = lines
    .filter((line) => !looksLikeAssistantSourceReferenceClause(line))
    .map((line) => stripAssistantSourceCalloutPrefix(line))

  return sanitized.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

export function buildOutboundReplyFormattingGuidance(channel: string | null): string | null {
  return isAssistantOutboundReplyChannel(channel)
    ? [
        'When composing an outbound reply that Murph may deliver over a messaging or email channel, do not include internal source callouts, inline `[Source: ...]` tags, or vault-file references in the final message body.',
        'Keep the user-facing answer natural and self-contained. Mention uncertainty plainly in the prose instead of appending machine-style evidence labels.',
      ].join('\n\n')
    : null
}

export function isAssistantOutboundReplyChannel(channel: string | null): boolean {
  const normalized = normalizeNullableString(channel)?.toLowerCase() ?? null
  if (!normalized) {
    return false
  }
  return normalized !== 'local' && normalized !== 'null'
}

export function stripAssistantSourceCalloutPrefix(line: string): string {
  const withoutBracketedSourcePrefix = line.replace(
    /^\s*\[(?:source|sources)\s*:[^\]]+\]\s*/iu,
    '',
  )
  const match = /^(\s*(?:[-*]\s+)?)(?:In|From)\s+(.+?):\s+/u.exec(
    withoutBracketedSourcePrefix,
  )
  if (!match) {
    return withoutBracketedSourcePrefix
  }

  const prefix = match[1] ?? ''
  const referenceClause = match[2] ?? ''
  if (!looksLikeAssistantSourceReferenceClause(referenceClause)) {
    return withoutBracketedSourcePrefix
  }

  return `${prefix}${withoutBracketedSourcePrefix.slice(match[0].length)}`
}

export function looksLikeAssistantSourceReferenceClause(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  if (isAssistantSourceReference(trimmed)) {
    return true
  }

  const parts = trimmed
    .split(/\s+(?:and|or)\s+|,\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (parts.length > 0 && parts.every((part) => isAssistantSourceReference(part))) {
    return true
  }

  return /(?:^|\s)source(?:s)?\s*:/iu.test(trimmed) &&
    /(?:assistant-state|ledger|raw|vault|\.md\b)/iu.test(trimmed)
}

export function isAssistantSourceReference(value: string): boolean {
  const normalized = value.trim().replace(/^`|`$/gu, '')
  if (normalized.length === 0) {
    return false
  }
  if (/^\[(?:source|sources)\s*:[^\]]+\]$/iu.test(normalized)) {
    return true
  }
  if (normalized.startsWith('/') || normalized.startsWith('file://')) {
    return true
  }
  if (
    /^(?:assistant-state|derived|experiments|journal|ledger|raw|research|vault)(?:\/|$)/u.test(
      normalized,
    )
  ) {
    return true
  }
  if (
    /(?:^|\/)[A-Za-z0-9._-]+\.(?:csv|json|jsonl|md|txt|ya?ml)(?::\d+(?::\d+)?)?$/u.test(
      normalized,
    )
  ) {
    return true
  }
  return /#l\d+(?:c\d+)?$/iu.test(normalized)
}
