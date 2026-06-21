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

const MARKDOWN_DECORATION_TOKENS: readonly MarkdownDecorationToken[] = [
  { marker: '**', style: 'bold' },
  { marker: '~~', style: 'strikethrough' },
  { marker: '_', style: 'italic' },
]

export function renderMarkdownMessageText(value: string): DecoratedMessageText {
  return renderMarkdownMessageSegment(value)
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

function renderMarkdownMessageSegment(value: string): DecoratedMessageText {
  let text = ''
  const decorations: MessageTextDecoration[] = []
  let index = 0

  while (index < value.length) {
    const token = readPairedMarkdownDecorationToken(value, index)

    if (token) {
      const inner = renderMarkdownMessageSegment(
        value.slice(token.contentStart, token.contentEnd),
      )
      const rangeStart = text.length
      text += inner.text
      const rangeEnd = text.length

      for (const decoration of inner.decorations) {
        decorations.push({
          range: [
            rangeStart + decoration.range[0],
            rangeStart + decoration.range[1],
          ],
          style: decoration.style,
        })
      }

      if (rangeEnd > rangeStart) {
        decorations.push({
          range: [rangeStart, rangeEnd],
          style: token.style,
        })
      }

      index = token.endIndex
      continue
    }

    text += value[index]
    index += 1
  }

  return {
    decorations: normalizeMessageTextDecorations(decorations),
    text,
  }
}

function readPairedMarkdownDecorationToken(
  value: string,
  index: number,
): {
  contentEnd: number
  contentStart: number
  endIndex: number
  style: MessageTextDecorationStyle
} | null {
  for (const token of MARKDOWN_DECORATION_TOKENS) {
    if (!value.startsWith(token.marker, index)) {
      continue
    }

    if (!isMarkdownOpeningBoundary(value, index, token.marker)) {
      continue
    }

    const contentStart = index + token.marker.length
    const contentEnd = findClosingMarkdownMarker(value, token.marker, contentStart)

    if (contentEnd === -1) {
      continue
    }

    const content = value.slice(contentStart, contentEnd)

    if (!content || content !== content.trim() || content.includes('\n')) {
      continue
    }

    return {
      contentEnd,
      contentStart,
      endIndex: contentEnd + token.marker.length,
      style: token.style,
    }
  }

  return null
}

function findClosingMarkdownMarker(
  value: string,
  marker: string,
  startIndex: number,
): number {
  let index = startIndex

  while (index < value.length) {
    const candidate = value.indexOf(marker, index)
    if (candidate === -1) {
      return -1
    }

    if (isMarkdownClosingBoundary(value, candidate, marker)) {
      return candidate
    }

    index = candidate + marker.length
  }

  return -1
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

  if (previous === '/' || previous === '\\') {
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

  return !(isWordCharacter(previous) && isWordCharacter(next))
}

function isWhitespace(value: string): boolean {
  return /\s/u.test(value)
}

function isWordCharacter(value: string): boolean {
  return /[A-Za-z0-9]/u.test(value)
}

function normalizeMessageTextDecorations(
  decorations: readonly MessageTextDecoration[],
): MessageTextDecoration[] {
  return decorations
    .filter((decoration) => decoration.range[1] > decoration.range[0])
    .sort((left, right) =>
      left.range[0] - right.range[0] ||
      left.range[1] - right.range[1] ||
      left.style.localeCompare(right.style),
    )
}
