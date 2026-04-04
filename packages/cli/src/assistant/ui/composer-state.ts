const COMPOSER_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?"

export interface ComposerEditingState {
  cursorOffset: number
  killBuffer: string
  value: string
}

export interface ComposerEditingResult extends ComposerEditingState {
  handled: boolean
}

export interface ComposerControlledSyncInput {
  cursorOffset: number
  currentValue: string
  nextControlledValue: string
  pendingValues: readonly string[]
  previousControlledValue: string
}

export interface ComposerControlledSyncResult {
  cursorOffset: number
  nextValue: string
  pendingValues: string[]
}

export function clampComposerCursorOffset(
  offset: number,
  valueLength: number,
): number {
  return Math.max(0, Math.min(offset, valueLength))
}

export function enqueuePendingComposerValue(
  pendingValues: readonly string[],
  nextValue: string,
): string[] {
  return pendingValues[pendingValues.length - 1] === nextValue
    ? [...pendingValues]
    : [...pendingValues, nextValue]
}

export function reconcileComposerControlledValue(
  input: ComposerControlledSyncInput,
): ComposerControlledSyncResult {
  const nextControlledValue = input.nextControlledValue
  const currentValue = input.currentValue
  const clampedCursorOffset = clampComposerCursorOffset(
    input.cursorOffset,
    currentValue.length,
  )

  if (nextControlledValue === input.previousControlledValue) {
    return {
      cursorOffset: clampedCursorOffset,
      nextValue: currentValue,
      pendingValues: [...input.pendingValues],
    }
  }

  const matchedPendingIndex = input.pendingValues.indexOf(nextControlledValue)
  if (matchedPendingIndex >= 0) {
    const remainingPendingValues = input.pendingValues.slice(matchedPendingIndex + 1)
    const nextValue =
      remainingPendingValues.length === 0 ? nextControlledValue : currentValue

    return {
      cursorOffset: clampComposerCursorOffset(clampedCursorOffset, nextValue.length),
      nextValue,
      pendingValues: remainingPendingValues,
    }
  }

  return {
    cursorOffset: nextControlledValue.length,
    nextValue: nextControlledValue,
    pendingValues: [],
  }
}

function isComposerWordSeparator(character: string): boolean {
  return COMPOSER_WORD_SEPARATORS.includes(character)
}

function isComposerWhitespace(character: string): boolean {
  return /\s/u.test(character)
}

function resolveComposerLineRanges(value: string): Array<{
  end: number
  start: number
}> {
  const ranges: Array<{
    end: number
    start: number
  }> = []
  let lineStart = 0

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\n') {
      continue
    }

    ranges.push({
      end: index,
      start: lineStart,
    })
    lineStart = index + 1
  }

  ranges.push({
    end: value.length,
    start: lineStart,
  })

  return ranges
}

function resolveComposerCursorLocation(
  value: string,
  cursorOffset: number,
): {
  column: number
  lineIndex: number
} {
  const clampedCursorOffset = clampComposerCursorOffset(cursorOffset, value.length)
  let lineIndex = 0
  let lineStart = 0

  for (let index = 0; index < clampedCursorOffset; index += 1) {
    if (value[index] !== '\n') {
      continue
    }

    lineIndex += 1
    lineStart = index + 1
  }

  return {
    column: clampedCursorOffset - lineStart,
    lineIndex,
  }
}

export function resolveComposerVerticalCursorMove(input: {
  cursorOffset: number
  direction: 'down' | 'up'
  preferredColumn: number | null
  value: string
}): {
  cursorOffset: number
  preferredColumn: number | null
} {
  const clampedCursorOffset = clampComposerCursorOffset(
    input.cursorOffset,
    input.value.length,
  )
  const lineRanges = resolveComposerLineRanges(input.value)
  const currentLocation = resolveComposerCursorLocation(
    input.value,
    clampedCursorOffset,
  )
  const targetLineIndex =
    input.direction === 'up'
      ? currentLocation.lineIndex - 1
      : currentLocation.lineIndex + 1

  if (targetLineIndex < 0 || targetLineIndex >= lineRanges.length) {
    return {
      cursorOffset: clampedCursorOffset,
      preferredColumn: input.preferredColumn,
    }
  }

  const desiredColumn = input.preferredColumn ?? currentLocation.column
  const targetLine = lineRanges[targetLineIndex]

  if (!targetLine) {
    return {
      cursorOffset: clampedCursorOffset,
      preferredColumn: input.preferredColumn,
    }
  }

  return {
    cursorOffset:
      targetLine.start + Math.min(desiredColumn, targetLine.end - targetLine.start),
    preferredColumn: desiredColumn,
  }
}

export function findComposerPreviousWordStart(
  value: string,
  cursorOffset: number,
): number {
  let index = clampComposerCursorOffset(cursorOffset, value.length)

  while (index > 0) {
    const previousCharacter = value.slice(index - 1, index)
    if (!isComposerWhitespace(previousCharacter)) {
      break
    }

    index -= 1
  }

  if (index === 0) {
    return 0
  }

  const previousCharacter = value.slice(index - 1, index)
  const separator = isComposerWordSeparator(previousCharacter)

  while (index > 0) {
    const character = value.slice(index - 1, index)
    if (
      isComposerWhitespace(character) ||
      isComposerWordSeparator(character) !== separator
    ) {
      break
    }

    index -= 1
  }

  return index
}

export function findComposerNextWordEnd(
  value: string,
  cursorOffset: number,
): number {
  let index = clampComposerCursorOffset(cursorOffset, value.length)

  while (index < value.length) {
    const character = value.slice(index, index + 1)
    if (!isComposerWhitespace(character)) {
      break
    }

    index += 1
  }

  if (index >= value.length) {
    return value.length
  }

  const separator = isComposerWordSeparator(value.slice(index, index + 1))

  while (index < value.length) {
    const character = value.slice(index, index + 1)
    if (
      isComposerWhitespace(character) ||
      isComposerWordSeparator(character) !== separator
    ) {
      break
    }

    index += 1
  }

  return index
}
