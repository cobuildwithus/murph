export type MessageTextDecorationStyle =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'underline'

export interface MessageTextDecoration {
  range: [number, number]
  style: MessageTextDecorationStyle
}

export interface DecoratedMessageText {
  decorations: MessageTextDecoration[]
  text: string
}

type MarkdownDecorationToken = {
  marker: string
  style: MessageTextDecorationStyle
}

type OpenMarkdownDecoration = MarkdownDecorationToken & {
  content: string
}

// Keep longer markers before their prefixes so `**bold**` is not read as `*italic*`.
const MARKDOWN_DECORATION_TOKENS: readonly MarkdownDecorationToken[] = [
  { marker: '**', style: 'bold' },
  { marker: '~~', style: 'strikethrough' },
  { marker: '++', style: 'underline' },
  { marker: '_', style: 'italic' },
  { marker: '*', style: 'italic' },
]

export function renderMarkdownMessageText(value: string): DecoratedMessageText {
  let text = ''
  const decorations: MessageTextDecoration[] = []
  let index = 0
  let openDecoration: OpenMarkdownDecoration | null = null

  while (index < value.length) {
    if (openDecoration) {
      if (
        value.startsWith(openDecoration.marker, index) &&
        isMarkdownClosingBoundary(value, index, openDecoration.marker)
      ) {
        const rangeStart = text.length
        const content = openDecoration.content
        if (isValidDecorationContent(content, openDecoration.marker)) {
          text += content
          if (text.length > rangeStart) {
            decorations.push({
              range: [rangeStart, text.length],
              style: openDecoration.style,
            })
          }
        } else {
          text += `${openDecoration.marker}${content}${openDecoration.marker}`
        }

        index += openDecoration.marker.length
        openDecoration = null
        continue
      }

      openDecoration.content += value[index]
      index += 1
      continue
    }

    const token = readOpeningMarkdownDecorationToken(value, index)
    if (token) {
      openDecoration = {
        content: '',
        marker: token.marker,
        style: token.style,
      }
      index += token.marker.length
      continue
    }

    text += value[index]
    index += 1
  }

  if (openDecoration) {
    text += `${openDecoration.marker}${openDecoration.content}`
  }

  return {
    decorations,
    text,
  }
}

export function splitDecoratedMessageText(
  value: DecoratedMessageText,
  maxCodePoints: number,
): DecoratedMessageText[] {
  const integerLimit = Number.isFinite(maxCodePoints)
    ? Math.trunc(maxCodePoints)
    : 1
  const normalizedLimit = Math.max(1, integerLimit)
  const codePoints = Array.from(value.text)

  if (codePoints.length <= normalizedLimit) {
    return [value]
  }

  const chunks: DecoratedMessageText[] = []
  let codePointStart = 0
  let utf16Start = 0

  while (codePointStart < codePoints.length) {
    const codePointEnd = Math.min(codePointStart + normalizedLimit, codePoints.length)
    const text = codePoints.slice(codePointStart, codePointEnd).join('')
    const utf16End = utf16Start + text.length

    chunks.push({
      decorations: value.decorations
        .map((decoration) => clampDecorationToUtf16Range(decoration, utf16Start, utf16End))
        .filter((decoration): decoration is MessageTextDecoration => decoration !== null),
      text,
    })

    codePointStart = codePointEnd
    utf16Start = utf16End
  }

  return chunks
}

function clampDecorationToUtf16Range(
  decoration: MessageTextDecoration,
  rangeStart: number,
  rangeEnd: number,
): MessageTextDecoration | null {
  const start = Math.max(decoration.range[0], rangeStart)
  const end = Math.min(decoration.range[1], rangeEnd)

  if (end <= start) {
    return null
  }

  return {
    range: [start - rangeStart, end - rangeStart],
    style: decoration.style,
  }
}

function readOpeningMarkdownDecorationToken(
  value: string,
  index: number,
): MarkdownDecorationToken | null {
  for (const token of MARKDOWN_DECORATION_TOKENS) {
    if (!value.startsWith(token.marker, index)) {
      continue
    }

    if (!isMarkdownOpeningBoundary(value, index, token.marker)) {
      continue
    }

    return token
  }

  return null
}

function isValidDecorationContent(
  content: string,
  marker: string,
): boolean {
  if (!content || content !== content.trim() || content.includes('\n')) {
    return false
  }

  if (content.length > 160) {
    return false
  }

  return marker !== '_' || isWhitespaceSeparatedPhrase(content)
}

function isMarkdownOpeningBoundary(
  value: string,
  index: number,
  marker: string,
): boolean {
  const previous = value[index - 1] ?? ''
  const next = value[index + marker.length] ?? ''

  if (!next || isWhitespace(next) || next === '/' || next === '\\') {
    return false
  }

  if (
    previous &&
    !isWhitespace(previous) &&
    !isOpeningPunctuation(previous)
  ) {
    return false
  }

  return !(isWordCharacter(previous) && isWordCharacter(next))
}

function isMarkdownClosingBoundary(
  value: string,
  index: number,
  marker: string,
): boolean {
  const previous = value[index - 1] ?? ''
  const next = value[index + marker.length] ?? ''

  if (!previous || isWhitespace(previous) || previous === '/' || previous === '\\') {
    return false
  }

  if (next && !isWhitespace(next) && !isClosingPunctuation(next)) {
    return false
  }

  return !(isWordCharacter(previous) && isWordCharacter(next))
}

function isOpeningPunctuation(value: string): boolean {
  return /[(\[{'"“‘]/u.test(value)
}

function isClosingPunctuation(value: string): boolean {
  return /[.,!?;:)\]}'"”’]/u.test(value)
}

function isWhitespace(value: string): boolean {
  return /\s/u.test(value)
}

function isWhitespaceSeparatedPhrase(value: string): boolean {
  return /\s/u.test(value)
}

function isWordCharacter(value: string): boolean {
  return value ? /[\p{L}\p{N}_]/u.test(value) : false
}
