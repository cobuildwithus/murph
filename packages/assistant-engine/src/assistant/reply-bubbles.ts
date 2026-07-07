export const ASSISTANT_REPLY_BUBBLE_DELIMITER = '---'
export const MAX_ASSISTANT_REPLY_BUBBLES = 4

export function assistantChannelSupportsReplyBubbles(
  channel: string | null,
): boolean {
  const normalized = channel?.trim().toLowerCase() ?? null
  return (
    normalized === 'linq' ||
    normalized === 'telegram' ||
    normalized === 'whatsapp'
  )
}

export function splitAssistantReplyBubbles(text: string): string[] {
  const lines = text.split(/\r?\n/u)
  if (!lines.some(isAssistantReplyBubbleDelimiterLine)) {
    return [text]
  }

  const bubbles: string[] = []
  let currentLines: string[] = []
  for (const line of lines) {
    if (isAssistantReplyBubbleDelimiterLine(line)) {
      pushAssistantReplyBubble(bubbles, currentLines)
      currentLines = []
      continue
    }
    currentLines.push(line)
  }
  pushAssistantReplyBubble(bubbles, currentLines)

  if (bubbles.length === 0) {
    return [text]
  }

  if (bubbles.length <= MAX_ASSISTANT_REPLY_BUBBLES) {
    return bubbles
  }

  return [
    ...bubbles.slice(0, MAX_ASSISTANT_REPLY_BUBBLES - 1),
    bubbles.slice(MAX_ASSISTANT_REPLY_BUBBLES - 1).join('\n\n'),
  ]
}

export function stripAssistantReplyBubbleDelimiters(text: string): string {
  return splitAssistantReplyBubbles(text).join('\n\n')
}

function isAssistantReplyBubbleDelimiterLine(line: string): boolean {
  return line.trim() === ASSISTANT_REPLY_BUBBLE_DELIMITER
}

function pushAssistantReplyBubble(
  bubbles: string[],
  lines: readonly string[],
): void {
  const bubble = lines.join('\n').trim()
  if (bubble.length > 0) {
    bubbles.push(bubble)
  }
}
