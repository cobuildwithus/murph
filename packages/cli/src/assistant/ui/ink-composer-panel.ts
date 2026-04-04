import * as React from 'react'
import { Box, Text, useInput, useStdout, type Key } from 'ink'
import { normalizeNullableString } from '@murphai/assistant-core/assistant-runtime'

import {
  CHAT_COMPOSER_HINT,
  CHAT_SLASH_COMMANDS,
  CHAT_STARTER_SUGGESTIONS,
  getMatchingSlashCommands,
  shouldShowChatComposerGuidance,
  type ChatMetadataBadge,
} from './view-model.js'
import {
  applyComposerEditingInput,
  enqueuePendingComposerValue,
  formatQueuedFollowUpPreview,
  reconcileComposerControlledValue,
  renderComposerValue,
  resolveComposerTerminalAction,
  resolveComposerVerticalCursorMove,
  type ComposerSubmitMode,
} from './composer-editor.js'
import type { AssistantChatStatus } from './chat-controller.js'
import {
  BusySpinner,
  ChromePanel,
  FooterBadge,
  WrappedPlainTextBlock,
  resolveAssistantPlainTextWrapColumns,
  useAssistantInkTheme,
} from './ink-layout.js'

const QUEUED_FOLLOW_UP_SHORTCUT_HINT = '⌥ + ↑ edit last queued message'

type ComposerSubmitDisposition = 'clear' | 'keep'

interface ComposerInputProps {
  disabled: boolean
  onChange: (value: string) => void
  onEditLastQueuedPrompt: () => void
  onSubmit: (value: string, mode: ComposerSubmitMode) => ComposerSubmitDisposition
  placeholder: string
  value: string
}

interface ChatStatusProps {
  busy: boolean
  status: AssistantChatStatus | null
}

interface ChatComposerProps {
  entryCount: number
  modelSwitcherActive: boolean
  onChange: (value: string) => void
  onEditLastQueuedPrompt: () => void
  onSubmit: (value: string, mode: ComposerSubmitMode) => ComposerSubmitDisposition
  value: string
}

interface QueuedFollowUpStatusProps {
  latestPrompt: string | null
  queuedPromptCount: number
}

interface ChatFooterProps {
  badges: readonly ChatMetadataBadge[]
}

function ComposerInput(props: ComposerInputProps): React.ReactElement {
  const theme = useAssistantInkTheme()
  const [displayValue, setDisplayValue] = React.useState(props.value)
  const [cursorOffset, setCursorOffset] = React.useState(props.value.length)
  const valueRef = React.useRef(props.value)
  const cursorOffsetRef = React.useRef(props.value.length)
  const killBufferRef = React.useRef('')
  const preferredColumnRef = React.useRef<number | null>(null)
  const lastPropValueRef = React.useRef(props.value)
  const pendingControlledValuesRef = React.useRef<string[]>([])
  const onChangeRef = React.useRef(props.onChange)
  const onEditLastQueuedPromptRef = React.useRef(props.onEditLastQueuedPrompt)
  const onSubmitRef = React.useRef(props.onSubmit)
  const disabledRef = React.useRef(props.disabled)

  onChangeRef.current = props.onChange
  onEditLastQueuedPromptRef.current = props.onEditLastQueuedPrompt
  onSubmitRef.current = props.onSubmit
  disabledRef.current = props.disabled

  React.useLayoutEffect(() => {
    const syncResult = reconcileComposerControlledValue({
      cursorOffset: cursorOffsetRef.current,
      currentValue: valueRef.current,
      nextControlledValue: props.value,
      pendingValues: pendingControlledValuesRef.current,
      previousControlledValue: lastPropValueRef.current,
    })

    lastPropValueRef.current = props.value
    pendingControlledValuesRef.current = syncResult.pendingValues
    valueRef.current = syncResult.nextValue
    setDisplayValue((previous) =>
      previous === syncResult.nextValue ? previous : syncResult.nextValue,
    )

    if (syncResult.cursorOffset !== cursorOffsetRef.current) {
      cursorOffsetRef.current = syncResult.cursorOffset
      setCursorOffset(syncResult.cursorOffset)
    }
  }, [props.value])

  const handleComposerInput = React.useCallback((input: string, key: Key) => {
    if (disabledRef.current) {
      return
    }

    if ((key.shift && key.tab) || (key.ctrl && input === 'c')) {
      return
    }

    const currentValue = valueRef.current
    const currentCursorOffset = cursorOffsetRef.current
    const action = resolveComposerTerminalAction(input, key)

    if (action.kind === 'edit-last-queued') {
      onEditLastQueuedPromptRef.current()
      return
    }

    if (action.kind === 'edit' && (action.key.upArrow || action.key.downArrow)) {
      const verticalMovement = resolveComposerVerticalCursorMove({
        cursorOffset: currentCursorOffset,
        direction: action.key.upArrow ? 'up' : 'down',
        preferredColumn: preferredColumnRef.current,
        value: currentValue,
      })

      if (verticalMovement.cursorOffset !== currentCursorOffset) {
        cursorOffsetRef.current = verticalMovement.cursorOffset
        preferredColumnRef.current = verticalMovement.preferredColumn
        setCursorOffset(verticalMovement.cursorOffset)
      }

      return
    }

    if (action.kind === 'submit') {
      if (onSubmitRef.current(currentValue, action.mode) === 'clear') {
        valueRef.current = ''
        pendingControlledValuesRef.current = enqueuePendingComposerValue(
          pendingControlledValuesRef.current,
          '',
        )
        cursorOffsetRef.current = 0
        killBufferRef.current = ''
        preferredColumnRef.current = null
        setDisplayValue('')
        setCursorOffset(0)
        onChangeRef.current('')
      }
      return
    }

    if (action.kind !== 'edit') {
      return
    }

    const editingResult = applyComposerEditingInput(
      {
        cursorOffset: currentCursorOffset,
        killBuffer: killBufferRef.current,
        value: currentValue,
      },
      action.input,
      action.key,
    )

    if (!editingResult.handled) {
      return
    }

    cursorOffsetRef.current = editingResult.cursorOffset
    killBufferRef.current = editingResult.killBuffer
    valueRef.current = editingResult.value
    preferredColumnRef.current = null

    if (editingResult.cursorOffset !== currentCursorOffset) {
      setCursorOffset(editingResult.cursorOffset)
    }

    if (editingResult.value !== currentValue) {
      pendingControlledValuesRef.current = enqueuePendingComposerValue(
        pendingControlledValuesRef.current,
        editingResult.value,
      )
      setDisplayValue(editingResult.value)
      onChangeRef.current(editingResult.value)
    }
  }, [])

  useInput(handleComposerInput, {
    isActive: !props.disabled,
  })

  return React.createElement(
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
      value: displayValue,
    }),
  )
}

function SlashCommandSuggestions(input: {
  commands: readonly (typeof CHAT_SLASH_COMMANDS)[number][]
}): React.ReactElement | null {
  const theme = useAssistantInkTheme()
  const { stdout } = useStdout()

  if (input.commands.length === 0) {
    return null
  }

  const wrapColumns = resolveAssistantPlainTextWrapColumns(stdout?.columns)

  return React.createElement(
    ChromePanel,
    {
      backgroundColor: theme.switcherBackground,
      marginBottom: 1,
    },
    React.createElement(
      Text,
      {
        bold: true,
        color: theme.mutedColor,
      },
      'commands',
    ),
    ...input.commands.map((command) =>
      React.createElement(
        Box,
        {
          flexDirection: 'row',
          key: command.command,
          width: '100%',
        },
        React.createElement(Text, { color: theme.accentColor }, command.command),
        React.createElement(
          Box,
          {
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
          },
          React.createElement(WrappedPlainTextBlock, {
            color: theme.mutedColor,
            columns: Math.max(1, wrapColumns - command.command.length - 2),
            text: `  ${command.description}`,
          }),
        ),
      ),
    ),
  )
}

export const ChatStatus = React.memo(function ChatStatus(
  props: ChatStatusProps,
): React.ReactElement | null {
  const theme = useAssistantInkTheme()
  const { stdout } = useStdout()
  const wrapColumns = resolveAssistantPlainTextWrapColumns(stdout?.columns)

  if (props.busy) {
    const busyColor =
      props.status?.kind === 'error'
        ? theme.errorColor
        : props.status?.kind === 'success'
          ? theme.successColor
          : theme.infoColor
    const busyDetail = normalizeNullableString(props.status?.text)

    return React.createElement(
      ChromePanel,
      {
        marginBottom: 1,
      },
      React.createElement(
        Box,
        {
          flexDirection: 'row',
          width: '100%',
        },
        React.createElement(BusySpinner, {
          color: busyColor,
        }),
        React.createElement(Text, {}, ' '),
        React.createElement(
          Box,
          {
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
          },
          React.createElement(
            Text,
            {
              color: busyColor,
            },
            'Working',
          ),
          busyDetail
            ? React.createElement(WrappedPlainTextBlock, {
                color: theme.mutedColor,
                columns: wrapColumns,
                text: busyDetail,
              })
            : null,
        ),
      ),
    )
  }

  if (!props.status) {
    return null
  }

  const statusColor =
    props.status.kind === 'error'
      ? theme.errorColor
      : props.status.kind === 'success'
        ? theme.successColor
        : theme.infoColor
  const statusIcon =
    props.status.kind === 'error'
      ? '!'
      : props.status.kind === 'success'
        ? '✓'
        : 'ℹ'

  return React.createElement(
    ChromePanel,
    {
      backgroundColor: theme.switcherBackground,
      marginBottom: 1,
    },
    React.createElement(
      Box,
      {
        flexDirection: 'row',
        width: '100%',
      },
      React.createElement(Text, { color: statusColor }, `${statusIcon} `),
      React.createElement(
        Box,
        {
          flexDirection: 'column',
          flexGrow: 1,
          flexShrink: 1,
        },
        React.createElement(WrappedPlainTextBlock, {
          color:
            props.status.kind === 'info'
              ? theme.composerTextColor
              : statusColor,
          columns: Math.max(1, wrapColumns - 2),
          text: props.status.text,
        }),
      ),
    ),
  )
})

export const ChatComposer = React.memo(function ChatComposer(
  props: ChatComposerProps,
): React.ReactElement {
  const theme = useAssistantInkTheme()
  const { stdout } = useStdout()
  const slashSuggestions = props.modelSwitcherActive
    ? []
    : getMatchingSlashCommands(props.value)
  const showComposerGuidance = shouldShowChatComposerGuidance(props.entryCount)
  const showStarterSuggestions =
    showComposerGuidance &&
    !props.modelSwitcherActive &&
    props.value.trim().length === 0
  const wrapColumns = resolveAssistantPlainTextWrapColumns(stdout?.columns)

  return React.createElement(
    React.Fragment,
    {},
    React.createElement(
      ChromePanel,
      {
        backgroundColor: theme.composerBackground,
        marginBottom: slashSuggestions.length > 0 ? 0 : 1,
        paddingY: 1,
      },
      React.createElement(
        Box,
        {
          flexDirection: 'row',
          width: '100%',
        },
        React.createElement(
          Text,
          { color: theme.composerTextColor },
          '› ',
        ),
        React.createElement(ComposerInput, {
          disabled: props.modelSwitcherActive,
          value: props.value,
          placeholder: 'Type a message',
          onChange: props.onChange,
          onEditLastQueuedPrompt: props.onEditLastQueuedPrompt,
          onSubmit: props.onSubmit,
        }),
      ),
      showComposerGuidance
        ? React.createElement(
            Box,
            {
              marginTop: 1,
            },
            React.createElement(
              Text,
              {
                color: theme.mutedColor,
                wrap: 'wrap',
              },
              CHAT_COMPOSER_HINT,
            ),
          )
        : null,
      showStarterSuggestions
        ? React.createElement(
            Box,
            {
              marginTop: 1,
              width: '100%',
            },
            React.createElement(Text, { color: theme.mutedColor }, 'try:'),
            React.createElement(WrappedPlainTextBlock, {
              color: theme.accentColor,
              columns: Math.max(1, wrapColumns - 2),
              text: `  ${CHAT_STARTER_SUGGESTIONS.join(' · ')}`,
            }),
          )
        : null,
    ),
    React.createElement(SlashCommandSuggestions, {
      commands: slashSuggestions,
    }),
  )
})

export const QueuedFollowUpStatus = React.memo(function QueuedFollowUpStatus(
  props: QueuedFollowUpStatusProps,
): React.ReactElement | null {
  const theme = useAssistantInkTheme()
  const { stdout } = useStdout()

  if (props.queuedPromptCount === 0 || !props.latestPrompt) {
    return null
  }

  const extraQueuedCount = props.queuedPromptCount - 1
  const wrapColumns = resolveAssistantPlainTextWrapColumns(stdout?.columns)

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      marginBottom: 1,
      width: '100%',
    },
    React.createElement(
      Text,
      {
        color: theme.composerTextColor,
        wrap: 'wrap',
      },
      '• Queued follow-up messages',
    ),
    React.createElement(WrappedPlainTextBlock, {
      color: theme.composerTextColor,
      columns: wrapColumns,
      text: `  ↳ ${formatQueuedFollowUpPreview(props.latestPrompt)}`,
    }),
    extraQueuedCount > 0
      ? React.createElement(WrappedPlainTextBlock, {
          color: theme.mutedColor,
          columns: wrapColumns,
          text: `    +${extraQueuedCount} more queued`,
        })
      : null,
    React.createElement(WrappedPlainTextBlock, {
      color: theme.mutedColor,
      columns: wrapColumns,
      text: `    ${QUEUED_FOLLOW_UP_SHORTCUT_HINT}`,
    }),
  )
})

export const ChatFooter = React.memo(function ChatFooter(
  props: ChatFooterProps,
): React.ReactElement {
  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: '100%',
    },
    React.createElement(
      Text,
      {
        wrap: 'wrap',
      },
      ...props.badges.flatMap((badge, index) => [
        index > 0 ? ' ' : '',
        React.createElement(FooterBadge, {
          badge,
          key: `badge:${badge.key}`,
        }),
      ]),
    ),
  )
})
