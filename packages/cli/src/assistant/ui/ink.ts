import * as React from 'react'
import { Box, Static, Text, render, useApp, useInput, type Key } from 'ink'
import {
  assistantChatResultSchema,
} from '../../assistant-cli-contracts.js'
import { resolveCodexDisplayOptions } from '../../assistant-codex.js'
import {
  resolveAssistantOperatorDefaults,
  saveAssistantOperatorDefaultsPatch,
} from '../../operator-config.js'
import type { AssistantChatInput } from '../service.js'
import { sendAssistantMessage } from '../service.js'
import {
  appendAssistantTranscriptEntries,
  listAssistantTranscriptEntries,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from '../store.js'
import { normalizeNullableString } from '../shared.js'
import {
  CHAT_BANNER,
  CHAT_MODEL_OPTIONS,
  CHAT_REASONING_OPTIONS,
  CHAT_SLASH_COMMANDS,
  findAssistantModelOptionIndex,
  findAssistantReasoningOptionIndex,
  formatBusyStatus,
  formatChatMetadata,
  formatSessionBinding,
  getMatchingSlashCommands,
  resolveChatSubmitAction,
  shouldClearComposerForSubmitAction,
  type InkChatEntry,
  seedChatEntries,
} from './view-model.js'
import {
  LIGHT_ASSISTANT_INK_THEME,
  resolveAssistantInkTheme,
  type AssistantInkTheme,
} from './theme.js'

type AssistantChatResult = ReturnType<typeof assistantChatResultSchema.parse>

const AssistantInkThemeContext =
  React.createContext<AssistantInkTheme>(LIGHT_ASSISTANT_INK_THEME)
interface ComposerInputProps {
  disabled: boolean
  onChange: (value: string) => void
  onSubmit: (value: string) => ComposerSubmitDisposition
  placeholder: string
  value: string
}

interface ModelSwitcherProps {
  currentModel: string | null
  currentReasoningEffort: string | null
  mode: 'model' | 'reasoning'
  modelIndex: number
  onCancel: () => void
  onConfirm: () => void
  onMove: (delta: number) => void
  reasoningIndex: number
}

interface ModelSwitcherState {
  mode: 'model' | 'reasoning'
  modelIndex: number
  reasoningIndex: number
}

type ComposerSubmitDisposition = 'clear' | 'keep'

interface ChatHeaderProps {
  bindingSummary: string | null
  sessionId: string
}

interface ChatHistoryProps {
  entries: readonly InkChatEntry[]
}

type ChatStaticItem =
  | {
      kind: 'banner'
    }
  | {
      kind: 'entry'
      entry: InkChatEntry
    }
  | {
      bindingSummary: string | null
      kind: 'header'
      sessionId: string
    }

interface ChatStatusProps {
  busy: boolean
  busySeconds: number
  status: {
    kind: 'error' | 'info' | 'success'
    text: string
  } | null
}

interface ChatComposerProps {
  busy: boolean
  modelSwitcherActive: boolean
  onSubmit: (value: string) => ComposerSubmitDisposition
}

interface ChatFooterProps {
  metadataLine: string
}

interface ComposerEditingState {
  cursorOffset: number
  killBuffer: string
  value: string
}

interface ComposerEditingResult extends ComposerEditingState {
  handled: boolean
}

type ComposerTerminalAction =
  | {
      kind: 'edit'
      input: string
      key: Key
    }
  | {
      kind: 'submit'
    }

const COMPOSER_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\\\|;:'\\\",.<>/?"
const MODIFIED_RETURN_SEQUENCE = /^\u001b?\[27;(\d+);13~$/u

function useAssistantInkTheme(): AssistantInkTheme {
  return React.useContext(AssistantInkThemeContext)
}

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

export function resolveComposerTerminalAction(
  input: string,
  key: Key,
): ComposerTerminalAction {
  const modifiedReturnAction = resolveComposerModifiedReturnAction(input, key)
  if (modifiedReturnAction) {
    return modifiedReturnAction
  }

  if (key.return) {
    if (!key.shift) {
      return {
        kind: 'submit',
      }
    }

    return {
      kind: 'edit',
      input: '\n',
      key: {
        ...key,
        return: false,
      },
    }
  }

  if (key.delete) {
    // Many terminals report the primary delete/backspace key as `delete`.
    // Preserve an actual forward-delete path via Ctrl+D inside the editor helpers.
    return {
      kind: 'edit',
      input,
      key: {
        ...key,
        backspace: true,
        delete: false,
      },
    }
  }

  return {
    kind: 'edit',
    input,
    key,
  }
}

function ComposerInput(props: ComposerInputProps): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const [cursorOffset, setCursorOffset] = React.useState(props.value.length)
  const [killBuffer, setKillBuffer] = React.useState('')

  React.useEffect(() => {
    setCursorOffset((previous) =>
      clampComposerCursorOffset(previous, props.value.length),
    )
  }, [props.value])

  useInput(
    (input, key) => {
      if (props.disabled) {
        return
      }

      if (
        key.upArrow ||
        key.downArrow ||
        key.tab ||
        (key.shift && key.tab) ||
        (key.ctrl && input === 'c')
      ) {
        return
      }

      const action = resolveComposerTerminalAction(input, key)

      if (action.kind === 'submit') {
        if (props.onSubmit(props.value) === 'clear') {
          props.onChange('')
        }
        return
      }

      const editingResult = applyComposerEditingInput(
        {
          cursorOffset,
          killBuffer,
          value: props.value,
        },
        action.input,
        action.key,
      )

      if (editingResult.handled) {
        if (editingResult.cursorOffset !== cursorOffset) {
          setCursorOffset(editingResult.cursorOffset)
        }

        if (editingResult.killBuffer !== killBuffer) {
          setKillBuffer(editingResult.killBuffer)
        }

        if (editingResult.value !== props.value) {
          props.onChange(editingResult.value)
        }

        return
      }
    },
    {
      isActive: !props.disabled,
    },
  )

  return createElement(
    Box,
    {
      flexDirection: 'column',
      flexGrow: 1,
      flexShrink: 1,
    },
    renderComposerValue({
      cursorOffset,
      disabled: props.disabled,
      placeholder: props.placeholder,
      theme,
      value: props.value,
    }),
  )
}

const ChatHeader = React.memo(function ChatHeader(
  props: ChatHeaderProps,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      marginBottom: 1,
    },
    createElement(Text, {}, 'Healthy Bob'),
    createElement(Text, { dimColor: true }, `session ${props.sessionId}`),
    props.bindingSummary
      ? createElement(Text, { dimColor: true }, props.bindingSummary)
      : null,
  )
})

const ChatTranscriptRow = React.memo(function ChatTranscriptRow(
  props: ChatHistoryProps,
): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()

  return createElement(
    Box,
    {
      flexDirection: 'column',
    },
    props.entries.map((entry: InkChatEntry, index: number) => {
      const key = `${entry.kind}:${index}:${entry.text.slice(0, 24)}`

      if (entry.kind === 'assistant') {
        return createElement(
          Box,
          {
            key,
            marginBottom: 1,
            width: '100%',
          },
          createElement(Text, { wrap: 'wrap' }, entry.text),
        )
      }

      if (entry.kind === 'error') {
        return createElement(
          Box,
          {
            key,
            marginBottom: 1,
            width: '100%',
          },
          createElement(
            Text,
            {
              color: theme.errorColor,
              wrap: 'wrap',
            },
            `Error: ${entry.text}`,
          ),
        )
      }

      return createElement(
        Box,
        {
          key,
          backgroundColor: theme.composerBackground,
          flexDirection: 'column',
          marginBottom: 1,
          width: '100%',
        },
        createElement(Text, {}, ' '),
        createElement(
          Box,
          {
            flexDirection: 'row',
            paddingX: 2,
          },
          createElement(
            Text,
            { color: theme.composerTextColor },
            '› ',
          ),
          createElement(
            Box,
            {
              flexDirection: 'column',
              flexGrow: 1,
              flexShrink: 1,
            },
            createElement(
              Text,
              {
                color: theme.composerTextColor,
                wrap: 'wrap',
              },
              entry.text,
            ),
          ),
        ),
        createElement(Text, {}, ' '),
      )
    }),
  )
})

const ChatStaticFeed = React.memo(function ChatStaticFeed(input: {
  bindingSummary: string | null
  entries: readonly InkChatEntry[]
  sessionId: string
}): React.ReactElement {
  const ChatStatic = Static as React.ComponentType<{
    children: (item: ChatStaticItem, index: number) => React.ReactNode
    items: ChatStaticItem[]
  }>
  // Keep the non-editing chat surface on Ink static output so old turns do not
  // participate in future keystroke renders.
  const staticItems: ChatStaticItem[] = [
    {
      kind: 'header',
      bindingSummary: input.bindingSummary,
      sessionId: input.sessionId,
    },
    {
      kind: 'banner',
    },
    ...input.entries.map((entry) => ({
      kind: 'entry' as const,
      entry,
    })),
  ]

  return React.createElement(
    ChatStatic,
    {
      items: staticItems,
      children: (item: ChatStaticItem, index: number) => {
        if (item.kind === 'header') {
          return React.createElement(ChatHeader, {
            key: `header:${item.sessionId}`,
            bindingSummary: item.bindingSummary,
            sessionId: item.sessionId,
          })
        }

        if (item.kind === 'banner') {
          return React.createElement(
            Box,
            {
              key: `banner:${index}`,
              marginBottom: 1,
            },
            React.createElement(Text, { dimColor: true }, CHAT_BANNER),
          )
        }

        return React.createElement(ChatTranscriptRow, {
          key: `entry:${index}:${item.entry.kind}:${item.entry.text.slice(0, 24)}`,
          entries: [item.entry],
        })
      },
    },
  )
})

const ChatStatus = React.memo(function ChatStatus(
  props: ChatStatusProps,
): React.ReactElement | null {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()

  if (props.busy) {
    return createElement(
      Box,
      {
        marginBottom: 1,
      },
      createElement(Text, { dimColor: true }, formatBusyStatus(props.busySeconds)),
    )
  }

  if (!props.status) {
    return null
  }

  return createElement(
    Box,
    {
      marginBottom: 1,
    },
    createElement(
      Text,
      props.status.kind === 'error'
        ? { color: theme.errorColor }
        : props.status.kind === 'success'
          ? { color: theme.successColor }
          : { dimColor: true },
      props.status.text,
    ),
  )
})

const ChatComposer = React.memo(function ChatComposer(
  props: ChatComposerProps,
): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const [value, setValue] = React.useState('')
  const slashSuggestions =
    props.modelSwitcherActive ? [] : getMatchingSlashCommands(value)

  return createElement(
    React.Fragment,
    {},
    createElement(
      Box,
      {
        backgroundColor: theme.composerBackground,
        flexDirection: 'row',
        marginBottom: slashSuggestions.length > 0 ? 0 : 1,
        paddingX: 2,
        paddingY: 1,
        width: '100%',
      },
      createElement(
        React.Fragment,
        {},
        createElement(
          Text,
          { color: theme.composerTextColor },
          '› ',
        ),
        createElement(ComposerInput, {
          disabled: props.modelSwitcherActive,
          value,
          placeholder: 'Type a message',
          onChange: setValue,
          onSubmit: props.onSubmit,
        }),
      ),
    ),
    createElement(SlashCommandSuggestions, {
      commands: slashSuggestions,
    }),
  )
})

const ChatFooter = React.memo(function ChatFooter(
  props: ChatFooterProps,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
    },
    createElement(Text, { dimColor: true }, props.metadataLine),
  )
})

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
    }
  }

  if (rawCursorCharacter.length === 0) {
    return {
      afterCursor: '',
      beforeCursor,
    }
  }

  return {
    afterCursor: `${rawCursorCharacter}${afterCursor}`,
    beforeCursor,
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
        ' ',
      ),
      cursorCharacter + remainder,
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
      ' ',
    ),
    cursorDisplay.afterCursor,
  )
}

function ModelSwitcher(props: ModelSwitcherProps): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel()
      return
    }

    if (key.upArrow || input === 'k') {
      props.onMove(-1)
      return
    }

    if (key.downArrow || input === 'j') {
      props.onMove(1)
      return
    }

    if (key.return) {
      props.onConfirm()
    }
  })

  const content =
    props.mode === 'model'
      ? createElement(
          React.Fragment,
          {},
          createElement(
            Text,
            {
              color: theme.switcherTextColor,
            },
            'Select Model and Effort',
          ),
          createElement(
            Text,
            {
              color: theme.switcherMutedColor,
            },
            'Access legacy models by running codex -m <model_name> or in your config.toml',
          ),
          createElement(
            Box,
            {
              flexDirection: 'column',
              marginTop: 1,
            },
            CHAT_MODEL_OPTIONS.map((option, index) =>
              renderSwitcherRow({
                current:
                  normalizeNullableString(option.value) ===
                  normalizeNullableString(props.currentModel),
                description: option.description,
                index,
                label: option.value,
                selected: index === props.modelIndex,
                theme,
              }),
            ),
          ),
        )
      : createElement(
          React.Fragment,
          {},
          createElement(
            Text,
            {
              color: theme.switcherTextColor,
            },
            `Select Reasoning Level for ${CHAT_MODEL_OPTIONS[props.modelIndex]?.value ?? 'the current model'}`,
          ),
          createElement(
            Box,
            {
              flexDirection: 'column',
              marginTop: 1,
            },
            CHAT_REASONING_OPTIONS.map((option, index) =>
              renderSwitcherRow({
                current: isCurrentReasoningOption(option.value, props.currentReasoningEffort),
                description: option.description,
                index,
                label:
                  option.value === 'medium'
                    ? `${option.label} (default)`
                    : option.label,
                selected: index === props.reasoningIndex,
                theme,
              }),
            ),
          ),
          createElement(
            Box,
            {
              marginTop: 1,
            },
            createElement(
              Text,
              {
                color: theme.switcherMutedColor,
              },
              'Press enter to confirm or esc to go back',
            ),
          ),
        )

  return createElement(
    Box,
    {
      backgroundColor: theme.switcherBackground,
      flexDirection: 'column',
      marginBottom: 1,
      paddingX: 1,
      paddingY: 1,
      width: '100%',
    },
    content,
  )
}

function SlashCommandSuggestions(input: {
  commands: readonly (typeof CHAT_SLASH_COMMANDS)[number][]
}): React.ReactElement | null {
  const theme = useAssistantInkTheme()

  if (input.commands.length === 0) {
    return null
  }

  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      marginBottom: 1,
      paddingX: 1,
      width: '100%',
    },
    input.commands.map((command) =>
      createElement(
        Box,
        {
          key: command.command,
          flexDirection: 'row',
        },
        createElement(
          Text,
          {
            color: theme.accentColor,
          },
          command.command,
        ),
        createElement(Text, {}, '  '),
        createElement(
          Text,
          {
            color: theme.accentColor,
          },
          command.description,
        ),
      ),
    ),
  )
}

function renderSwitcherRow(input: {
  current: boolean
  description: string
  index: number
  label: string
  selected: boolean
  theme: AssistantInkTheme
}): React.ReactElement {
  const createElement = React.createElement
  const color = input.selected ? input.theme.accentColor : input.theme.switcherTextColor
  const descriptionColor = input.selected
    ? input.theme.accentColor
    : input.theme.switcherMutedColor
  const prefix = input.selected ? '›' : ' '
  const currentLabel = input.current ? ' (current)' : ''

  return createElement(
    Box,
    {
      key: `${input.label}:${input.index}`,
      flexDirection: 'row',
    },
    createElement(
      Text,
      {
        color,
      },
      `${prefix} ${input.index + 1}. ${input.label}${currentLabel}`,
    ),
    createElement(Text, {}, '  '),
    createElement(
      Text,
      {
        color: descriptionColor,
      },
      input.description,
    ),
  )
}

function isCurrentReasoningOption(
  option: string,
  currentReasoningEffort: string | null,
): boolean {
  const normalizedCurrent = normalizeNullableString(currentReasoningEffort) ?? 'medium'
  return normalizeNullableString(option) === normalizedCurrent
}

function wrapPickerIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0
  }

  return ((index % count) + count) % count
}

export async function runAssistantChatWithInk(
  input: AssistantChatInput,
): Promise<AssistantChatResult> {
  const startedAt = new Date().toISOString()
  const defaults = await resolveAssistantOperatorDefaults()
  const theme = resolveAssistantInkTheme()
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId ?? defaults?.identityId ?? null,
    actorId: input.actorId ?? input.participantId,
    threadId: input.threadId ?? input.sourceThreadId,
    threadIsDirect: input.threadIsDirect,
    provider: input.provider ?? defaults?.provider ?? undefined,
    model: input.model ?? defaults?.model ?? null,
    sandbox: input.sandbox ?? defaults?.sandbox ?? 'read-only',
    approvalPolicy:
      input.approvalPolicy ?? defaults?.approvalPolicy ?? 'never',
    oss: input.oss ?? defaults?.oss ?? false,
    profile: input.profile ?? defaults?.profile ?? null,
    reasoningEffort: input.reasoningEffort ?? defaults?.reasoningEffort ?? null,
  })
  const transcriptEntries = await listAssistantTranscriptEntries(
    input.vault,
    resolved.session.sessionId,
  )
  const redactedVault = redactAssistantDisplayPath(input.vault)
  const codexDisplay = await resolveCodexDisplayOptions({
    model:
      input.model ??
      defaults?.model ??
      resolved.session.providerOptions.model,
    profile:
      input.profile ??
      defaults?.profile ??
      resolved.session.providerOptions.profile,
  })

  return await new Promise<AssistantChatResult>((resolve, reject) => {
    let settled = false
    let instance: {
      cleanup?: () => void
      unmount: () => void
      waitUntilExit: () => Promise<unknown>
    } | null = null

    const resolveOnce = (result: AssistantChatResult) => {
      if (settled) {
        return
      }

      settled = true
      resolve(result)
    }

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      reject(error)
    }

    const App = (): React.ReactElement => {
      const createElement = React.createElement
      const { exit } = useApp()
      const [session, setSession] = React.useState(resolved.session)
      const [turns, setTurns] = React.useState(0)
      const [entries, setEntries] = React.useState(seedChatEntries(transcriptEntries))
      const [busy, setBusy] = React.useState(false)
      const [status, setStatus] = React.useState<{
        kind: 'error' | 'info' | 'success'
        text: string
      } | null>(null)
      const [busyStartedAt, setBusyStartedAt] = React.useState<number | null>(null)
      const [busySeconds, setBusySeconds] = React.useState(0)
      const [activeModel, setActiveModel] = React.useState<string | null>(
        normalizeNullableString(input.model) ??
          normalizeNullableString(defaults?.model) ??
          normalizeNullableString(resolved.session.providerOptions.model) ??
          normalizeNullableString(codexDisplay.model),
      )
      const [activeReasoningEffort, setActiveReasoningEffort] = React.useState<string | null>(
        normalizeNullableString(input.reasoningEffort) ??
          normalizeNullableString(defaults?.reasoningEffort) ??
          normalizeNullableString(resolved.session.providerOptions.reasoningEffort) ??
        normalizeNullableString(codexDisplay.reasoningEffort),
      )
      const [modelSwitcherState, setModelSwitcherState] =
        React.useState<ModelSwitcherState | null>(null)
      const latestSessionRef = React.useRef(resolved.session)
      const latestTurnsRef = React.useRef(0)
      const initialPromptRef = React.useRef(normalizeNullableString(input.initialPrompt))
      const bootstrappedRef = React.useRef(false)

      React.useEffect(() => {
        latestSessionRef.current = session
      }, [session])

      React.useEffect(() => {
        latestTurnsRef.current = turns
      }, [turns])

      React.useEffect(
        () => () => {
          resolveOnce(
            assistantChatResultSchema.parse({
              vault: redactedVault,
              startedAt,
              stoppedAt: new Date().toISOString(),
              turns: latestTurnsRef.current,
              session: latestSessionRef.current,
            }),
          )
        },
        [],
      )

      React.useEffect(() => {
        if (!busy || busyStartedAt === null) {
          setBusySeconds(0)
          return
        }

        setBusySeconds(Math.max(0, Math.floor((Date.now() - busyStartedAt) / 1000)))
        const timer = setInterval(() => {
          setBusySeconds(Math.max(0, Math.floor((Date.now() - busyStartedAt) / 1000)))
        }, 1000)

        return () => clearInterval(timer)
      }, [busy, busyStartedAt])

      const openModelSwitcher = () => {
        setModelSwitcherState({
          mode: 'model',
          modelIndex: findAssistantModelOptionIndex(activeModel),
          reasoningIndex: findAssistantReasoningOptionIndex(activeReasoningEffort),
        })
      }

      const moveModelSwitcherSelection = (delta: number) => {
        setModelSwitcherState((previous) => {
          if (!previous) {
            return previous
          }

          if (previous.mode === 'model') {
            return {
              ...previous,
              modelIndex: wrapPickerIndex(
                previous.modelIndex + delta,
                CHAT_MODEL_OPTIONS.length,
              ),
            }
          }

          return {
            ...previous,
            reasoningIndex: wrapPickerIndex(
              previous.reasoningIndex + delta,
              CHAT_REASONING_OPTIONS.length,
            ),
          }
        })
      }

      const cancelModelSwitcher = () => {
        setModelSwitcherState((previous) => {
          if (!previous) {
            return previous
          }

          if (previous.mode === 'reasoning') {
            return {
              ...previous,
              mode: 'model',
            }
          }

          return null
        })
      }

      const confirmModelSwitcher = () => {
        if (!modelSwitcherState) {
          return
        }

        if (modelSwitcherState.mode === 'model') {
          setModelSwitcherState({
            ...modelSwitcherState,
            mode: 'reasoning',
          })
          return
        }

        const nextModel =
          CHAT_MODEL_OPTIONS[modelSwitcherState.modelIndex]?.value ??
          activeModel ??
          null
        const nextReasoningEffort =
          CHAT_REASONING_OPTIONS[modelSwitcherState.reasoningIndex]?.value ??
          activeReasoningEffort ??
          'medium'

        setActiveModel(nextModel)
        setActiveReasoningEffort(nextReasoningEffort)
        setModelSwitcherState(null)
        setStatus({
          kind: 'info',
          text: `Using ${nextModel ?? 'the configured model'} ${nextReasoningEffort}.`,
        })

        void (async () => {
          try {
            const updatedSession = await saveAssistantSession(input.vault, {
              ...latestSessionRef.current,
              providerOptions: {
                ...latestSessionRef.current.providerOptions,
                model: nextModel,
                reasoningEffort: nextReasoningEffort,
              },
              updatedAt: new Date().toISOString(),
            })

            latestSessionRef.current = updatedSession
            setSession(updatedSession)

            await saveAssistantOperatorDefaultsPatch({
              model: nextModel,
              reasoningEffort: nextReasoningEffort,
            })
          } catch (error) {
            setStatus({
              kind: 'error',
              text:
                error instanceof Error && error.message.trim().length > 0
                  ? `Using ${nextModel ?? 'the configured model'} ${nextReasoningEffort} for now, but failed to save it for later chats: ${error.message}`
                  : `Using ${nextModel ?? 'the configured model'} ${nextReasoningEffort} for now, but failed to save it for later chats.`,
            })
          }
        })()
      }

      const submitPrompt = (rawValue: string): ComposerSubmitDisposition => {
        const action = resolveChatSubmitAction(rawValue, busy)

        if (action.kind === 'ignore') {
          return 'keep'
        }

        if (action.kind === 'exit') {
          exit()
          return 'keep'
        }

        if (action.kind === 'session') {
          setStatus({
            kind: 'info',
            text: `session ${latestSessionRef.current.sessionId}`,
          })
          return 'keep'
        }

        if (action.kind === 'model') {
          setStatus(null)
          openModelSwitcher()
          return 'clear'
        }

        setEntries((previous: InkChatEntry[]) => [
          ...previous,
          {
            kind: 'user',
            text: action.prompt,
          },
        ])
        setBusy(true)
        setBusyStartedAt(Date.now())
        setStatus(null)

        void (async () => {
          try {
            const result = await sendAssistantMessage({
              ...input,
              model: activeModel,
              prompt: action.prompt,
              reasoningEffort: activeReasoningEffort,
              sessionId: latestSessionRef.current.sessionId,
            })

            latestSessionRef.current = result.session
            setSession(result.session)
            setTurns((previous: number) => previous + 1)
            setEntries((previous: InkChatEntry[]) => [
              ...previous,
              {
                kind: 'assistant',
                text: result.response,
              },
            ])
            setStatus(
              result.delivery
                ? {
                    kind: 'success',
                    text: `Delivered over ${result.delivery.channel} to ${result.delivery.target}.`,
                  }
                : result.deliveryError
                  ? {
                      kind: 'error',
                      text: `Response saved locally, but delivery failed: ${result.deliveryError.message}`,
                    }
                  : null,
            )
          } catch (error) {
            const errorText = error instanceof Error ? error.message : String(error)
            setEntries((previous: InkChatEntry[]) => [
              ...previous,
              {
                kind: 'error',
                text: errorText,
              },
            ])
            setStatus({
              kind: 'error',
              text: 'The assistant hit an error. Fix it or keep chatting.',
            })
            void appendAssistantTranscriptEntries(
              input.vault,
              latestSessionRef.current.sessionId,
              [
                {
                  kind: 'error',
                  text: errorText,
                },
              ],
            ).catch(() => {})
          } finally {
            setBusy(false)
            setBusyStartedAt(null)
          }
        })()

        return shouldClearComposerForSubmitAction(action) ? 'clear' : 'keep'
      }

      React.useEffect(() => {
        if (bootstrappedRef.current) {
          return
        }

        bootstrappedRef.current = true
        if (initialPromptRef.current) {
          submitPrompt(initialPromptRef.current)
        }
      }, [])

      const bindingSummary = formatSessionBinding(session)
      const metadataLine = formatChatMetadata(
        {
          provider: session.provider,
          model: activeModel ?? session.providerOptions.model ?? codexDisplay.model,
          reasoningEffort: activeReasoningEffort ?? codexDisplay.reasoningEffort,
        },
        redactedVault,
      )

      return createElement(
        AssistantInkThemeContext.Provider,
        {
          value: theme,
        },
        createElement(
          Box,
          {
            flexDirection: 'column',
            paddingX: 1,
            paddingY: 1,
          },
          createElement(ChatStaticFeed, {
            bindingSummary,
            entries,
            sessionId: session.sessionId,
          }),
          createElement(
            Box,
            {
              flexDirection: 'column',
            },
            createElement(ChatStatus, {
              busy,
              busySeconds,
              status,
            }),
            modelSwitcherState
              ? createElement(ModelSwitcher, {
                  currentModel: activeModel,
                  currentReasoningEffort: activeReasoningEffort,
                  mode: modelSwitcherState.mode,
                  modelIndex: modelSwitcherState.modelIndex,
                  onCancel: cancelModelSwitcher,
                  onConfirm: confirmModelSwitcher,
                  onMove: moveModelSwitcherSelection,
                  reasoningIndex: modelSwitcherState.reasoningIndex,
                })
              : null,
            createElement(ChatComposer, {
              busy,
              modelSwitcherActive: modelSwitcherState !== null,
              onSubmit: submitPrompt,
            }),
            createElement(ChatFooter, {
              metadataLine,
            }),
          ),
        ),
      )
    }

    try {
      instance = render(React.createElement(App), {
        stderr: process.stderr,
        stdout: process.stderr,
        patchConsole: false,
      })
      void instance.waitUntilExit().catch(rejectOnce)
    } catch (error) {
      rejectOnce(error)
      return
    }

    if (!instance) {
      rejectOnce(new Error('Ink chat failed to initialize.'))
    }
  })
}
