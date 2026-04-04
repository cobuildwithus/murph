/**
 * Owns the assistant chat composer's terminal-editor seam so the top-level Ink
 * view can stay focused on chat layout, model switching, and controller state.
 */

import * as React from 'react'
import { Text, type Key } from 'ink'

import type { AssistantInkTheme } from './theme.js'

export type ComposerSubmitMode = 'enter' | 'tab'

type ComposerTerminalAction =
  | {
      kind: 'edit'
      input: string
      key: Key
    }
  | {
      kind: 'edit-last-queued'
    }
  | {
      mode: ComposerSubmitMode
      kind: 'submit'
    }

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

const COMPOSER_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?"
const MODIFIED_RETURN_SEQUENCE = /^\u001b?\[27;(\d+);13~$/u
const RAW_ARROW_SEQUENCE = /^\u001b?(?:\[(?:(\d+;)?(\d+))?([ABCD])|O([ABCD]))$/u
const MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH = 88

function resolveComposerModifiedReturnAction(
  input: string,
  key: Key,
): ComposerTerminalAction | null {
  const match = MODIFIED_RETURN_SEQUENCE.exec(input)
  if (!match) {
    return null
  }

  const modifier = Math.max(0, Number.parseInt(match[1] ?? '1', 10) - 1)
  const shift = key.shift || (modifier & 1) === 1

  if (!shift) {
    return {
      kind: 'submit',
      mode: 'enter',
    }
  }

  return {
    kind: 'edit',
    input: '\n',
    key: {
      ...key,
      return: false,
      shift: true,
    },
  }
}

export function normalizeAssistantInkArrowKey(input: string, key: Key): Key {
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
    return key
  }

  const match = RAW_ARROW_SEQUENCE.exec(input)
  const direction = match?.[3] ?? match?.[4]

  if (!direction) {
    return key
  }

  const modifier = Math.max(0, Number.parseInt(match?.[2] ?? '1', 10) - 1)

  return {
    ...key,
    ctrl: key.ctrl || (modifier & 4) === 4,
    downArrow: direction === 'B',
    leftArrow: direction === 'D',
    meta: key.meta || (modifier & 2) === 2,
    rightArrow: direction === 'C',
    shift: key.shift || (modifier & 1) === 1,
    upArrow: direction === 'A',
  }
}

export function mergeComposerDraftWithQueuedPrompts(
  draft: string,
  queuedPrompts: readonly string[],
): string {
  return [draft, ...queuedPrompts]
    .filter((value) => value.trim().length > 0)
    .join('\n\n')
}

export function resolveComposerTerminalAction(
  input: string,
  key: Key,
): ComposerTerminalAction {
  const normalizedKey = normalizeAssistantInkArrowKey(input, key)
  const modifiedReturnAction = resolveComposerModifiedReturnAction(input, normalizedKey)
  if (modifiedReturnAction) {
    return modifiedReturnAction
  }

  if (
    (input === '\u007f' || input === '\b') &&
    !normalizedKey.ctrl &&
    !normalizedKey.meta &&
    !normalizedKey.shift &&
    !normalizedKey.super &&
    !normalizedKey.hyper
  ) {
    return {
      kind: 'edit',
      input: '',
      key: {
        ...normalizedKey,
        backspace: true,
        delete: false,
      },
    }
  }

  if (normalizedKey.meta && normalizedKey.upArrow) {
    return {
      kind: 'edit-last-queued',
    }
  }

  if (normalizedKey.tab && !normalizedKey.shift) {
    return {
      kind: 'submit',
      mode: 'tab',
    }
  }

  if (normalizedKey.return) {
    if (!normalizedKey.shift) {
      return {
        kind: 'submit',
        mode: 'enter',
      }
    }

    return {
      kind: 'edit',
      input: '\n',
      key: {
        ...normalizedKey,
        return: false,
      },
    }
  }

  if (normalizedKey.delete) {
    // Many terminals report the primary delete/backspace key as `delete`.
    // Preserve an actual forward-delete path via Ctrl+D inside the editor helpers.
    return {
      kind: 'edit',
      input,
      key: {
        ...normalizedKey,
        backspace: true,
        delete: false,
      },
    }
  }

  return {
    kind: 'edit',
    input,
    key: normalizedKey,
  }
}

export function formatQueuedFollowUpPreview(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/gu, ' ')

  if (normalized.length <= MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH) {
    return normalized
  }

  const truncated = normalized
    .slice(0, MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH - 1)
    .trimEnd()
  const boundary = truncated.lastIndexOf(' ')
  const preview =
    boundary >= Math.floor(MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH / 2)
      ? truncated.slice(0, boundary).trimEnd()
      : truncated

  return `${preview}…`
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
  // Controlled updates that match a queued local value are only acknowledgements
  // from the parent state, so keep the newest local draft visible until the last
  // pending value is observed. Anything else is an external restore/reset and
  // should replace the live draft immediately.
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

function clampComposerCursorOffset(offset: number, valueLength: number): number {
  return Math.max(0, Math.min(offset, valueLength))
}

function isComposerWordSeparator(character: string): boolean {
  return COMPOSER_WORD_SEPARATORS.includes(character)
}

function isComposerWhitespace(character: string): boolean {
  return /\s/u.test(character)
}

function moveComposerCursorLeft(state: ComposerEditingState): ComposerEditingState {
  return {
    ...state,
    cursorOffset: clampComposerCursorOffset(state.cursorOffset - 1, state.value.length),
  }
}

function moveComposerCursorRight(state: ComposerEditingState): ComposerEditingState {
  return {
    ...state,
    cursorOffset: clampComposerCursorOffset(state.cursorOffset + 1, state.value.length),
  }
}

function moveComposerCursorToStart(state: ComposerEditingState): ComposerEditingState {
  return {
    ...state,
    cursorOffset: 0,
  }
}

function moveComposerCursorToEnd(state: ComposerEditingState): ComposerEditingState {
  return {
    ...state,
    cursorOffset: state.value.length,
  }
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

function findComposerPreviousWordStart(value: string, cursorOffset: number): number {
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

function findComposerNextWordEnd(value: string, cursorOffset: number): number {
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

function moveComposerCursorToPreviousWord(
  state: ComposerEditingState,
): ComposerEditingState {
  return {
    ...state,
    cursorOffset: findComposerPreviousWordStart(state.value, state.cursorOffset),
  }
}

function moveComposerCursorToNextWord(state: ComposerEditingState): ComposerEditingState {
  return {
    ...state,
    cursorOffset: findComposerNextWordEnd(state.value, state.cursorOffset),
  }
}

function replaceComposerRange(
  state: ComposerEditingState,
  range: {
    end: number
    start: number
  },
  replacement: string,
): ComposerEditingState {
  const nextValue =
    state.value.slice(0, range.start) + replacement + state.value.slice(range.end)

  return {
    ...state,
    cursorOffset: range.start + replacement.length,
    value: nextValue,
  }
}

function killComposerRange(
  state: ComposerEditingState,
  range: {
    end: number
    start: number
  },
): ComposerEditingState {
  if (range.end <= range.start) {
    return state
  }

  return {
    ...replaceComposerRange(state, range, ''),
    killBuffer: state.value.slice(range.start, range.end),
  }
}

function deleteComposerBackward(state: ComposerEditingState): ComposerEditingState {
  if (state.cursorOffset <= 0) {
    return state
  }

  return replaceComposerRange(
    state,
    {
      end: state.cursorOffset,
      start: state.cursorOffset - 1,
    },
    '',
  )
}

function deleteComposerForward(state: ComposerEditingState): ComposerEditingState {
  if (state.cursorOffset >= state.value.length) {
    return state
  }

  return replaceComposerRange(
    state,
    {
      end: state.cursorOffset + 1,
      start: state.cursorOffset,
    },
    '',
  )
}

function deleteComposerBackwardWord(state: ComposerEditingState): ComposerEditingState {
  return killComposerRange(state, {
    end: state.cursorOffset,
    start: findComposerPreviousWordStart(state.value, state.cursorOffset),
  })
}

function deleteComposerForwardWord(state: ComposerEditingState): ComposerEditingState {
  return killComposerRange(state, {
    end: findComposerNextWordEnd(state.value, state.cursorOffset),
    start: state.cursorOffset,
  })
}

function killComposerToStart(state: ComposerEditingState): ComposerEditingState {
  return killComposerRange(state, {
    end: state.cursorOffset,
    start: 0,
  })
}

function killComposerToEnd(state: ComposerEditingState): ComposerEditingState {
  return killComposerRange(state, {
    end: state.value.length,
    start: state.cursorOffset,
  })
}

function yankComposerKillBuffer(state: ComposerEditingState): ComposerEditingState {
  if (state.killBuffer.length === 0) {
    return state
  }

  return replaceComposerRange(
    state,
    {
      end: state.cursorOffset,
      start: state.cursorOffset,
    },
    state.killBuffer,
  )
}

function finalizeComposerEditingResult(
  next: ComposerEditingState,
): ComposerEditingResult {
  return {
    ...next,
    handled: true,
  }
}

export function applyComposerEditingInput(
  state: ComposerEditingState,
  input: string,
  key: Key,
): ComposerEditingResult {
  const currentState = {
    ...state,
    cursorOffset: clampComposerCursorOffset(state.cursorOffset, state.value.length),
  }

  if (key.home || (key.super && key.leftArrow)) {
    return finalizeComposerEditingResult(moveComposerCursorToStart(currentState))
  }

  if (key.end || (key.super && key.rightArrow)) {
    return finalizeComposerEditingResult(moveComposerCursorToEnd(currentState))
  }

  if (key.leftArrow) {
    return finalizeComposerEditingResult(
      key.meta || key.ctrl
        ? moveComposerCursorToPreviousWord(currentState)
        : moveComposerCursorLeft(currentState),
    )
  }

  if (key.rightArrow) {
    return finalizeComposerEditingResult(
      key.meta || key.ctrl
        ? moveComposerCursorToNextWord(currentState)
        : moveComposerCursorRight(currentState),
    )
  }

  if (key.backspace) {
    return finalizeComposerEditingResult(
      key.super
        ? killComposerToStart(currentState)
        : key.meta
          ? deleteComposerBackwardWord(currentState)
          : deleteComposerBackward(currentState),
    )
  }

  if (key.delete) {
    return finalizeComposerEditingResult(
      key.super
        ? killComposerToEnd(currentState)
        : key.meta
          ? deleteComposerForwardWord(currentState)
          : deleteComposerForward(currentState),
    )
  }

  if (key.ctrl) {
    switch (input) {
      case 'a':
        return finalizeComposerEditingResult(moveComposerCursorToStart(currentState))
      case 'b':
        return finalizeComposerEditingResult(moveComposerCursorLeft(currentState))
      case 'd':
        return finalizeComposerEditingResult(deleteComposerForward(currentState))
      case 'e':
        return finalizeComposerEditingResult(moveComposerCursorToEnd(currentState))
      case 'f':
        return finalizeComposerEditingResult(moveComposerCursorRight(currentState))
      case 'h':
        return finalizeComposerEditingResult(deleteComposerBackward(currentState))
      case 'k':
        return finalizeComposerEditingResult(killComposerToEnd(currentState))
      case 'u':
        return finalizeComposerEditingResult(killComposerToStart(currentState))
      case 'w':
        return finalizeComposerEditingResult(deleteComposerBackwardWord(currentState))
      case 'y':
        return finalizeComposerEditingResult(yankComposerKillBuffer(currentState))
      default:
        break
    }
  }

  if (key.meta) {
    switch (input) {
      case 'b':
        return finalizeComposerEditingResult(moveComposerCursorToPreviousWord(currentState))
      case 'd':
        return finalizeComposerEditingResult(deleteComposerForwardWord(currentState))
      case 'f':
        return finalizeComposerEditingResult(moveComposerCursorToNextWord(currentState))
      default:
        break
    }
  }

  if (input.length === 0) {
    return {
      ...currentState,
      handled: false,
    }
  }

  const insertionText = normalizeComposerInsertedText(input)
  if (insertionText.length === 0) {
    return {
      ...currentState,
      handled: false,
    }
  }

  return finalizeComposerEditingResult(
    replaceComposerRange(
      currentState,
      {
        end: currentState.cursorOffset,
        start: currentState.cursorOffset,
      },
      insertionText,
    ),
  )
}

export function normalizeComposerInsertedText(input: string): string {
  return input.replace(/\r\n?/gu, '\n')
}

function resolveComposerCursorDisplay(input: {
  cursorOffset: number
  value: string
}): {
  afterCursor: string
  beforeCursor: string
  cursorCharacter: string
} {
  const cursorOffset = clampComposerCursorOffset(input.cursorOffset, input.value.length)
  const beforeCursor = input.value.slice(0, cursorOffset)
  const rawCursorCharacter = input.value.slice(cursorOffset, cursorOffset + 1)
  const afterCursor =
    cursorOffset < input.value.length
      ? input.value.slice(cursorOffset + 1)
      : ''

  if (rawCursorCharacter === '\n') {
    return {
      afterCursor: `\n${input.value.slice(cursorOffset + 1)}`,
      beforeCursor,
      cursorCharacter: ' ',
    }
  }

  if (rawCursorCharacter.length === 0) {
    return {
      afterCursor: '',
      beforeCursor,
      cursorCharacter: ' ',
    }
  }

  return {
    afterCursor,
    beforeCursor,
    cursorCharacter: rawCursorCharacter,
  }
}

export function renderComposerValue(input: {
  cursorOffset: number
  disabled: boolean
  placeholder: string
  theme: AssistantInkTheme
  value: string
}): React.ReactElement {
  const createElement = React.createElement

  if (input.value.length === 0) {
    if (input.disabled) {
      return createElement(
        Text,
        {
          color: input.theme.composerPlaceholderColor,
          wrap: 'wrap',
        },
        input.placeholder,
      )
    }

    const cursorCharacter = input.placeholder.slice(0, 1) || ' '
    const remainder = input.placeholder.slice(1)

    return createElement(
      Text,
      {
        color: input.theme.composerPlaceholderColor,
        wrap: 'wrap',
      },
      createElement(
        Text,
        {
          backgroundColor: input.theme.composerCursorBackground,
          color: input.theme.composerCursorTextColor,
        },
        cursorCharacter,
      ),
      remainder,
    )
  }

  const cursorDisplay = resolveComposerCursorDisplay({
    cursorOffset: input.cursorOffset,
    value: input.value,
  })

  if (input.disabled) {
    return createElement(
      Text,
      {
        color: input.theme.composerTextColor,
        wrap: 'wrap',
      },
      input.value,
    )
  }

  return createElement(
    Text,
    {
      color: input.theme.composerTextColor,
      wrap: 'wrap',
    },
    cursorDisplay.beforeCursor,
    createElement(
      Text,
      {
        backgroundColor: input.theme.composerCursorBackground,
        color: input.theme.composerCursorTextColor,
      },
      cursorDisplay.cursorCharacter,
    ),
    cursorDisplay.afterCursor,
  )
}
