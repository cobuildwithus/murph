import * as React from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import {
  assistantChatResultSchema,
} from '../../assistant-cli-contracts.js'
import { resolveCodexDisplayOptions } from '../../assistant-codex.js'
import type { AssistantChatInput } from '../service.js'
import { sendAssistantMessage } from '../service.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantSession,
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

type AssistantChatResult = ReturnType<typeof assistantChatResultSchema.parse>

const COMPOSER_BACKGROUND = '#f3f4f6'
const COMPOSER_CURSOR_BACKGROUND = '#1d4ed8'
const COMPOSER_PLACEHOLDER_COLOR = '#6b7280'
const COMPOSER_TEXT_COLOR = '#111827'
const SWITCHER_ACCENT_COLOR = '#0f766e'
const SWITCHER_BACKGROUND = '#f8fafc'
const SWITCHER_MUTED_COLOR = '#6b7280'
const SWITCHER_TEXT_COLOR = '#111827'
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

function ComposerInput(props: ComposerInputProps): React.ReactElement {
  const createElement = React.createElement
  const [cursorOffset, setCursorOffset] = React.useState(props.value.length)

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

      if (key.return) {
        if (props.onSubmit(props.value) === 'clear') {
          props.onChange('')
        }
        return
      }

      if (key.leftArrow) {
        setCursorOffset((previous) =>
          clampComposerCursorOffset(previous - 1, props.value.length),
        )
        return
      }

      if (key.rightArrow) {
        setCursorOffset((previous) =>
          clampComposerCursorOffset(previous + 1, props.value.length),
        )
        return
      }

      if (key.backspace || key.delete) {
        if (cursorOffset <= 0) {
          return
        }

        const nextValue =
          props.value.slice(0, cursorOffset - 1) + props.value.slice(cursorOffset)
        setCursorOffset(cursorOffset - 1)
        props.onChange(nextValue)
        return
      }

      if (input.length === 0) {
        return
      }

      const nextValue =
        props.value.slice(0, cursorOffset) + input + props.value.slice(cursorOffset)
      const nextCursorOffset = cursorOffset + input.length
      setCursorOffset(nextCursorOffset)
      props.onChange(nextValue)
    },
    {
      isActive: !props.disabled,
    },
  )

  return createElement(
    Box,
    {
      flexDirection: 'row',
    },
    ...renderComposerValue({
      cursorOffset,
      disabled: props.disabled,
      placeholder: props.placeholder,
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

const ChatHistory = React.memo(function ChatHistory(
  props: ChatHistoryProps,
): React.ReactElement {
  const createElement = React.createElement
  const history = props.entries.slice(-16)

  return createElement(
    Box,
    {
      flexDirection: 'column',
    },
    history.length > 0
      ? history.map((entry: InkChatEntry, index: number) => {
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
                  color: 'red',
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
              marginBottom: 1,
              width: '100%',
            },
            createElement(
              Box,
              {
                backgroundColor: COMPOSER_BACKGROUND,
                flexDirection: 'row',
                paddingX: 2,
                paddingY: 1,
                width: '100%',
              },
              createElement(
                Text,
                { color: COMPOSER_TEXT_COLOR },
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
                    color: COMPOSER_TEXT_COLOR,
                    wrap: 'wrap',
                  },
                  entry.text,
                ),
              ),
            ),
          )
        })
      : null,
  )
})

const ChatStatus = React.memo(function ChatStatus(
  props: ChatStatusProps,
): React.ReactElement | null {
  const createElement = React.createElement

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
        ? { color: 'red' }
        : props.status.kind === 'success'
          ? { color: 'green' }
          : { dimColor: true },
      props.status.text,
    ),
  )
})

const ChatComposer = React.memo(function ChatComposer(
  props: ChatComposerProps,
): React.ReactElement {
  const createElement = React.createElement
  const [value, setValue] = React.useState('')
  const slashSuggestions =
    props.modelSwitcherActive ? [] : getMatchingSlashCommands(value)

  return createElement(
    React.Fragment,
    {},
    createElement(
      Box,
      {
        backgroundColor: COMPOSER_BACKGROUND,
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
          { color: COMPOSER_TEXT_COLOR },
          '› ',
        ),
        createElement(ComposerInput, {
          disabled: props.busy || props.modelSwitcherActive,
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

function renderComposerValue(input: {
  cursorOffset: number
  disabled: boolean
  placeholder: string
  value: string
}): React.ReactElement[] {
  const createElement = React.createElement

  if (input.value.length === 0) {
    if (input.disabled) {
      return [
        createElement(
          Text,
          {
            key: 'placeholder',
            color: COMPOSER_PLACEHOLDER_COLOR,
          },
          input.placeholder,
        ),
      ]
    }

    const cursorCharacter = input.placeholder.slice(0, 1) || ' '
    const remainder = input.placeholder.slice(1)

    return [
      createElement(
        Text,
        {
          key: 'cursor',
          backgroundColor: COMPOSER_CURSOR_BACKGROUND,
          color: 'white',
        },
        cursorCharacter,
      ),
      createElement(
        Text,
        {
          key: 'placeholder',
          color: COMPOSER_PLACEHOLDER_COLOR,
        },
        remainder,
      ),
    ]
  }

  const cursorOffset = clampComposerCursorOffset(input.cursorOffset, input.value.length)
  const beforeCursor = input.value.slice(0, cursorOffset)
  const cursorCharacter = input.value.slice(cursorOffset, cursorOffset + 1) || ' '
  const afterCursor =
    cursorOffset < input.value.length
      ? input.value.slice(cursorOffset + 1)
      : ''

  const segments: React.ReactElement[] = []

  if (beforeCursor.length > 0) {
    segments.push(
      createElement(
        Text,
        {
          key: 'before',
          color: COMPOSER_TEXT_COLOR,
        },
        beforeCursor,
      ),
    )
  }

  if (input.disabled) {
    segments.push(
      createElement(
        Text,
        {
          key: 'after-disabled',
          color: COMPOSER_TEXT_COLOR,
        },
        cursorCharacter + afterCursor,
      ),
    )
    return segments
  }

  segments.push(
    createElement(
      Text,
      {
        key: 'cursor',
        backgroundColor: COMPOSER_CURSOR_BACKGROUND,
        color: 'white',
      },
      cursorCharacter,
    ),
  )

  if (afterCursor.length > 0) {
    segments.push(
      createElement(
        Text,
        {
          key: 'after',
          color: COMPOSER_TEXT_COLOR,
        },
        afterCursor,
      ),
    )
  }

  return segments
}

function ModelSwitcher(props: ModelSwitcherProps): React.ReactElement {
  const createElement = React.createElement

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
              color: SWITCHER_TEXT_COLOR,
            },
            'Select Model and Effort',
          ),
          createElement(
            Text,
            {
              color: SWITCHER_MUTED_COLOR,
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
              color: SWITCHER_TEXT_COLOR,
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
                color: SWITCHER_MUTED_COLOR,
              },
              'Press enter to confirm or esc to go back',
            ),
          ),
        )

  return createElement(
    Box,
    {
      backgroundColor: SWITCHER_BACKGROUND,
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
            color: SWITCHER_ACCENT_COLOR,
          },
          command.command,
        ),
        createElement(Text, {}, '  '),
        createElement(
          Text,
          {
            color: SWITCHER_ACCENT_COLOR,
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
}): React.ReactElement {
  const createElement = React.createElement
  const color = input.selected ? SWITCHER_ACCENT_COLOR : SWITCHER_TEXT_COLOR
  const descriptionColor = input.selected
    ? SWITCHER_ACCENT_COLOR
    : SWITCHER_MUTED_COLOR
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
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    actorId: input.actorId ?? input.participantId,
    threadId: input.threadId ?? input.sourceThreadId,
    threadIsDirect: input.threadIsDirect,
    provider: input.provider,
    model: input.model,
    sandbox: input.sandbox ?? 'read-only',
    approvalPolicy: input.approvalPolicy ?? 'never',
    oss: input.oss ?? false,
    profile: input.profile,
  })
  const redactedVault = redactAssistantDisplayPath(input.vault)
  const codexDisplay = await resolveCodexDisplayOptions({
    model: input.model ?? resolved.session.providerOptions.model,
    profile: input.profile ?? resolved.session.providerOptions.profile,
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
      const [entries, setEntries] = React.useState(seedChatEntries(resolved.session))
      const [busy, setBusy] = React.useState(false)
      const [status, setStatus] = React.useState<{
        kind: 'error' | 'info' | 'success'
        text: string
      } | null>(null)
      const [busyStartedAt, setBusyStartedAt] = React.useState<number | null>(null)
      const [busySeconds, setBusySeconds] = React.useState(0)
      const [activeModel, setActiveModel] = React.useState<string | null>(
        normalizeNullableString(input.model) ??
          normalizeNullableString(resolved.session.providerOptions.model) ??
          normalizeNullableString(codexDisplay.model),
      )
      const [activeReasoningEffort, setActiveReasoningEffort] = React.useState<string | null>(
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
            setEntries((previous: InkChatEntry[]) => [
              ...previous,
              {
                kind: 'error',
                text: error instanceof Error ? error.message : String(error),
              },
            ])
            setStatus({
              kind: 'error',
              text: 'The assistant hit an error. Fix it or keep chatting.',
            })
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
        Box,
        {
          flexDirection: 'column',
          paddingX: 1,
          paddingY: 1,
        },
        createElement(ChatHeader, {
          bindingSummary,
          sessionId: session.sessionId,
        }),
        createElement(
          Box,
          {
            marginBottom: 1,
          },
          createElement(Text, { dimColor: true }, CHAT_BANNER),
        ),
        createElement(ChatHistory, {
          entries,
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
