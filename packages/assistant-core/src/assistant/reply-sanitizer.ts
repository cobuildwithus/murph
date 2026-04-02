import { isAssistantUserFacingChannel } from './channel-presentation.js'

const ASSISTANT_MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\n]+)\)/gu
const ASSISTANT_INLINE_SOURCE_REFERENCE_PATTERN =
  /(`[^`\n]+`|file:\/\/[^\s)]+|(?<![:/A-Za-z0-9])\/(?:[^/\s)]+\/)+[^\s)]*|(?:assistant-state|derived|experiments|journal|ledger|raw|research|vault)\/[^\s),;:]+)/giu

export function sanitizeAssistantOutboundReply(
  response: string,
  channel: string | null,
): string {
  if (!isAssistantOutboundReplyChannel(channel)) {
    return response
  }

  const withoutLocalMarkdownLinks = response.replace(
    ASSISTANT_MARKDOWN_LINK_PATTERN,
    (_match, label: string, target: string) =>
      isAssistantSourceReference(target) ? label : `[${label}](${target})`,
  )
  const lines = withoutLocalMarkdownLinks.split(/\r?\n/u)
  const sanitized = lines
    .filter((line) => !looksLikeAssistantSourceReferenceClause(line))
    .map((line) => stripAssistantSourceCalloutPrefix(line))
    .map((line) => stripInlineAssistantSourceReferences(line))

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
  return isAssistantUserFacingChannel(channel)
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

export function stripInlineAssistantSourceReferences(line: string): string {
  const leadingWhitespace = /^\s*/u.exec(line)?.[0] ?? ''
  const trailingWhitespace = /\s*$/u.exec(line)?.[0] ?? ''
  const stripped = line.replace(
    ASSISTANT_INLINE_SOURCE_REFERENCE_PATTERN,
    (match) => (isAssistantSourceReference(match) ? 'that note' : match),
  )

  const compacted = stripped
    .replace(/\bthat note(?:\s+that note)+\b/giu, 'that note')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/\(\s*that note\s*\)/giu, '(that note)')
    .replace(/\s{2,}/gu, ' ')
    .trim()

  return `${leadingWhitespace}${compacted}${trailingWhitespace}`
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
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(normalized) && !normalized.startsWith('file://')) {
    return false
  }
  if (/^\[(?:source|sources)\s*:[^\]]+\]$/iu.test(normalized)) {
    return true
  }
  if (
    /^\/(?:[^/\s]+\/)+[^/\s]+$/u.test(normalized) ||
    normalized.startsWith('file://')
  ) {
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
