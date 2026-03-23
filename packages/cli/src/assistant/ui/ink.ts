import fs from 'node:fs'
import path from 'node:path'
import tty from 'node:tty'
import { pathToFileURL } from 'node:url'
import * as React from 'react'
import {
  Box,
  Static,
  Text,
  render,
  useApp,
  useInput,
  useStdout,
  type Key,
  type StaticProps,
} from 'ink'
import {
  assistantChatResultSchema,
} from '../../assistant-cli-contracts.js'
import type { AssistantProviderProgressEvent } from '../../chat-provider.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from '../provider-traces.js'
import { resolveCodexDisplayOptions } from '../../assistant-codex.js'
import {
  resolveAssistantOperatorDefaults,
  saveAssistantOperatorDefaultsPatch,
} from '../../operator-config.js'
import {
  openAssistantConversation,
  sendAssistantMessage,
  updateAssistantSessionOptions,
  type AssistantChatInput,
} from '../service.js'
import {
  extractRecoveredAssistantSession,
  isAssistantProviderConnectionLostError,
} from '../provider-turn-recovery.js'
import {
  appendAssistantTranscriptEntries,
  isAssistantSessionNotFoundError,
  listAssistantTranscriptEntries,
  redactAssistantDisplayPath,
} from '../store.js'
import { normalizeNullableString } from '../shared.js'
import {
  CHAT_COMPOSER_HINT,
  CHAT_MODEL_OPTIONS,
  CHAT_REASONING_OPTIONS,
  CHAT_SLASH_COMMANDS,
  CHAT_STARTER_SUGGESTIONS,
  applyProviderProgressEventToEntries,
  findAssistantModelOptionIndex,
  findAssistantReasoningOptionIndex,
  formatSessionBinding,
  applyInkChatTraceUpdates,
  getMatchingSlashCommands,
  resolveChatMetadataBadges,
  resolveChatSubmitAction,
  shouldShowChatComposerGuidance,
  shouldClearComposerForSubmitAction,
  type ChatMetadataBadge,
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
}

interface ChatEntryRowProps {
  entry: InkChatEntry
}

interface StaticTranscriptRowHeader {
  kind: 'header'
  bindingSummary: string | null
  sessionId: string
}

interface StaticTranscriptRowEntry {
  kind: 'entry'
  entry: InkChatEntry
}

type StaticTranscriptRow = StaticTranscriptRowHeader | StaticTranscriptRowEntry

const StaticTranscript = Static as React.ComponentType<
  StaticProps<StaticTranscriptRow>
>

interface AssistantMessageTextProps {
  text: string
}

interface ChatStatusProps {
  busy: boolean
  status: {
    kind: 'error' | 'info' | 'success'
    text: string
  } | null
}

interface ChatComposerProps {
  entryCount: number
  modelSwitcherActive: boolean
  onSubmit: (value: string) => ComposerSubmitDisposition
}

interface ChatFooterProps {
  badges: readonly ChatMetadataBadge[]
}

interface ChromePanelProps {
  backgroundColor?: string
  children?: React.ReactNode
  marginBottom?: number
  paddingX?: number
  paddingY?: number
  width?: string
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

const BUSY_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const ASSISTANT_PLAIN_TEXT_WRAP_SLACK = 4
const ASSISTANT_INK_TTY_PATH =
  process.platform === 'win32' ? 'CONIN$' : '/dev/tty'

type AssistantInkInputStream = NodeJS.ReadStream & {
  destroy?: () => void
  isTTY?: boolean
  setRawMode?: (mode: boolean) => void
}

interface AssistantInkInputAdapter {
  close: () => void
  source: 'stdin' | 'tty' | 'unsupported'
  stdin: AssistantInkInputStream | null
}

interface ResolveAssistantInkInputAdapterInput {
  createTtyReadStream?: (fd: number) => AssistantInkInputStream
  openTtyFd?: (path: string, flags: string) => number
  stdin?: AssistantInkInputStream
  ttyPath?: string
}

export function resolveChromePanelBoxProps(
  props: ChromePanelProps,
): {
  backgroundColor?: string
  flexDirection: 'column'
  marginBottom: number
  paddingX: number
  paddingY: number
  width: string
} {
  const boxProps: {
    backgroundColor?: string
    flexDirection: 'column'
    marginBottom: number
    paddingX: number
    paddingY: number
    width: string
  } = {
    flexDirection: 'column',
    marginBottom: props.marginBottom ?? 1,
    paddingX:
      props.paddingX ??
      (typeof props.backgroundColor === 'string' && props.backgroundColor.length > 0
        ? 1
        : 0),
    paddingY: props.paddingY ?? 0,
    width: props.width ?? '100%',
  }

  if (typeof props.backgroundColor === 'string' && props.backgroundColor.length > 0) {
    boxProps.backgroundColor = props.backgroundColor
  }

  return boxProps
}

export function supportsAssistantInkRawMode(
  stdin: AssistantInkInputStream | null | undefined,
): boolean {
  return Boolean(stdin?.isTTY && typeof stdin.setRawMode === 'function')
}

export function resolveAssistantInkInputAdapter(
  input: ResolveAssistantInkInputAdapterInput = {},
): AssistantInkInputAdapter {
  const stdin =
    input.stdin ?? (process.stdin as AssistantInkInputStream)

  if (supportsAssistantInkRawMode(stdin)) {
    return {
      close: () => {},
      source: 'stdin',
      stdin,
    }
  }

  const ttyPath = input.ttyPath ?? ASSISTANT_INK_TTY_PATH
  const openTtyFd =
    input.openTtyFd ??
    ((pathToOpen: string, flags: string) => fs.openSync(pathToOpen, flags))
  const createTtyReadStream =
    input.createTtyReadStream ??
    ((fd: number) => new tty.ReadStream(fd) as AssistantInkInputStream)

  let fd: number | null = null
  let closed = false

  const closeFallbackFd = () => {
    if (fd === null || closed) {
      return
    }

    closed = true
    try {
      fs.closeSync(fd)
    } catch {}
  }

  try {
    fd = openTtyFd(ttyPath, 'r')
    const ttyInput = createTtyReadStream(fd)

    if (!supportsAssistantInkRawMode(ttyInput)) {
      ttyInput.destroy?.()
      closeFallbackFd()
      return {
        close: () => {},
        source: 'unsupported',
        stdin: null,
      }
    }

    return {
      close: () => {
        ttyInput.destroy?.()
        closeFallbackFd()
      },
      source: 'tty',
      stdin: ttyInput,
    }
  } catch {
    closeFallbackFd()

    return {
      close: () => {},
      source: 'unsupported',
      stdin: null,
    }
  }
}

const ChromePanel = React.memo(function ChromePanel(
  props: ChromePanelProps,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    resolveChromePanelBoxProps(props),
    props.children,
  )
})

const BusySpinner = React.memo(function BusySpinner(input: {
  color?: string
}): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()

  return createElement(
    Text,
    {
      color: input.color ?? theme.accentColor,
    },
    BUSY_SPINNER_FRAMES[0],
  )
})

export function resolveMessageRoleLabel(
  kind: InkChatEntry['kind'],
): string | null {
  if (kind === 'error') {
    return 'error'
  }

  return null
}

const MessageRoleLabel = React.memo(function MessageRoleLabel(input: {
  kind: InkChatEntry['kind']
}): React.ReactElement | null {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const label = resolveMessageRoleLabel(input.kind)
  if (!label) {
    return null
  }

  return createElement(
    Box,
    {
      marginBottom: 1,
    },
    createElement(
      Text,
      {
        bold: true,
        color: theme.errorColor,
      },
      label,
    ),
  )
})

export function renderWrappedTextBlock(input: {
  children?: React.ReactNode
  color?: string
  dimColor?: boolean
}): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      width: '100%',
    },
    createElement(
      Text,
      {
        color: input.color,
        dimColor: input.dimColor,
        wrap: 'wrap',
      },
      input.children,
    ),
  )
}

export function wrapAssistantPlainText(input: string, columns: number): string {
  return input
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => wrapAssistantPlainTextLine(line, columns))
    .join('\n')
}

function wrapAssistantPlainTextLine(input: string, columns: number): string {
  if (input.length === 0 || columns <= 0) {
    return input
  }

  const leadingWhitespace = input.match(/^\s*/u)?.[0] ?? ''
  const content = input.slice(leadingWhitespace.length)

  if (content.length === 0) {
    return input
  }

  const tokens = content.match(/\S+|\s+/gu) ?? [content]
  const lines: string[] = []
  let currentLine = leadingWhitespace
  let currentWidth = leadingWhitespace.length
  let pendingWhitespace = ''

  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      pendingWhitespace += token
      continue
    }

    const spacer =
      currentWidth > leadingWhitespace.length
        ? pendingWhitespace.length > 0
          ? pendingWhitespace
          : ' '
        : ''
    const candidateWidth = currentWidth + spacer.length + token.length

    if (currentWidth > leadingWhitespace.length && candidateWidth > columns) {
      lines.push(currentLine)
      currentLine = `${leadingWhitespace}${token}`
      currentWidth = leadingWhitespace.length + token.length
      pendingWhitespace = ''
      continue
    }

    if (spacer.length > 0) {
      currentLine += spacer
      currentWidth += spacer.length
    }

    currentLine += token
    currentWidth += token.length
    pendingWhitespace = ''
  }

  lines.push(currentLine)

  return lines.join('\n')
}

function resolveAssistantPlainTextWrapColumns(columns: number | null | undefined): number {
  const normalizedColumns =
    typeof columns === 'number' && Number.isFinite(columns)
      ? Math.max(1, Math.floor(columns))
      : 80

  return Math.max(20, normalizedColumns - ASSISTANT_PLAIN_TEXT_WRAP_SLACK)
}

const WrappedTextBlock = React.memo(function WrappedTextBlock(input: {
  children?: React.ReactNode
  color?: string
  dimColor?: boolean
}): React.ReactElement {
  return renderWrappedTextBlock(input)
})

const FooterBadge = React.memo(function FooterBadge(input: {
  badge: ChatMetadataBadge
}): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const backgroundColor =
    input.badge.key === 'model' ? theme.accentColor : theme.footerBadgeBackground
  const color =
    input.badge.key === 'model'
      ? theme.composerCursorTextColor
      : input.badge.key === 'vault'
        ? theme.mutedColor
        : theme.footerBadgeTextColor

  return createElement(
    Text,
    {
      backgroundColor,
      color,
    },
    formatFooterBadgeText(input.badge),
  )
})

export function formatFooterBadgeText(badge: ChatMetadataBadge): string {
  if (badge.key === 'model' || badge.key === 'reasoning') {
    return ` ${badge.value} `
  }

  return ` ${badge.label}: ${badge.value} `
}

export function splitAssistantMarkdownLinks(input: string): Array<
  | {
      kind: 'link'
      label: string
      target: string
    }
  | {
      kind: 'text'
      text: string
    }
> {
  const segments: Array<
    | {
        kind: 'link'
        label: string
        target: string
      }
    | {
        kind: 'text'
        text: string
      }
  > = []
  const markdownLinkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/gu
  let lastIndex = 0

  for (const match of input.matchAll(markdownLinkPattern)) {
    const matchedText = match[0]
    const label = match[1]
    const target = match[2]
    const start = match.index ?? -1

    if (
      typeof matchedText !== 'string' ||
      typeof label !== 'string' ||
      typeof target !== 'string' ||
      start < 0
    ) {
      continue
    }

    if (start > lastIndex) {
      segments.push({
        kind: 'text',
        text: input.slice(lastIndex, start),
      })
    }

    segments.push({
      kind: 'link',
      label,
      target,
    })
    lastIndex = start + matchedText.length
  }

  if (lastIndex < input.length) {
    segments.push({
      kind: 'text',
      text: input.slice(lastIndex),
    })
  }

  return segments.length > 0
    ? segments
    : [
        {
          kind: 'text',
          text: input,
        },
      ]
}

export function resolveAssistantHyperlinkTarget(target: string): string | null {
  if (/^(https?|mailto):/iu.test(target)) {
    return target
  }

  const fragmentIndex = target.indexOf('#')
  const pathPart =
    fragmentIndex >= 0
      ? target.slice(0, fragmentIndex)
      : target
  const fragment =
    fragmentIndex >= 0
      ? target.slice(fragmentIndex)
      : ''

  if (!path.isAbsolute(pathPart)) {
    return null
  }

  return `${pathToFileURL(pathPart).href}${fragment}`
}

export function formatAssistantTerminalHyperlink(
  label: string,
  target: string,
): string {
  return `\u001B]8;;${target}\u0007${label}\u001B]8;;\u0007`
}

export function supportsAssistantTerminalHyperlinks(input: {
  env?: NodeJS.ProcessEnv
  isTTY?: boolean
} = {}): boolean {
  const env = input.env ?? process.env
  const isTTY = input.isTTY ?? process.stderr.isTTY ?? false

  if (!isTTY || env.CI === 'true') {
    return false
  }

  if (env.FORCE_HYPERLINK === '1') {
    return true
  }

  return Boolean(
    env.KITTY_WINDOW_ID ||
      env.ITERM_SESSION_ID ||
      env.WT_SESSION ||
      env.WEZTERM_PANE ||
      env.VSCODE_INJECTION ||
      env.TERM_PROGRAM === 'Apple_Terminal' ||
      env.TERM_PROGRAM === 'WarpTerminal' ||
      env.TERM_PROGRAM === 'vscode',
  )
}

export function renderAssistantMessageText(
  input: AssistantMessageTextProps,
): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const { stdout } = useStdout()
  const enableHyperlinks = supportsAssistantTerminalHyperlinks()
  const segments = splitAssistantMarkdownLinks(input.text)
  const plainTextOnly = segments.every((segment) => segment.kind === 'text')

  if (plainTextOnly) {
    return createElement(
      WrappedTextBlock,
      {},
      wrapAssistantPlainText(
        input.text,
        resolveAssistantPlainTextWrapColumns(stdout?.columns),
      ),
    )
  }

  return createElement(
    WrappedTextBlock,
    {},
    ...segments.map((segment, index) => {
      if (segment.kind === 'text') {
        return segment.text
      }

      const hyperlinkTarget = resolveAssistantHyperlinkTarget(segment.target)
      const displayedLabel =
        hyperlinkTarget && enableHyperlinks
          ? formatAssistantTerminalHyperlink(segment.label, hyperlinkTarget)
          : segment.label

      return createElement(
        Text,
        {
          color: theme.accentColor,
          key: `link:${index}:${segment.label}`,
          underline: true,
        },
        displayedLabel,
      )
    }),
  )
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

  if (
    (input === '\u007f' || input === '\b') &&
    !key.ctrl &&
    !key.meta &&
    !key.shift &&
    !key.super &&
    !key.hyper
  ) {
    return {
      kind: 'edit',
      input: '',
      key: {
        ...key,
        backspace: true,
        delete: false,
      },
    }
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
  const valueRef = React.useRef(props.value)
  const cursorOffsetRef = React.useRef(props.value.length)
  const killBufferRef = React.useRef('')
  const preferredColumnRef = React.useRef<number | null>(null)
  const onChangeRef = React.useRef(props.onChange)
  const onSubmitRef = React.useRef(props.onSubmit)
  const disabledRef = React.useRef(props.disabled)

  onChangeRef.current = props.onChange
  onSubmitRef.current = props.onSubmit
  disabledRef.current = props.disabled

  React.useEffect(() => {
    valueRef.current = props.value

    const clampedCursorOffset = clampComposerCursorOffset(
      cursorOffsetRef.current,
      props.value.length,
    )

    if (clampedCursorOffset !== cursorOffsetRef.current) {
      cursorOffsetRef.current = clampedCursorOffset
    }

    setCursorOffset(clampedCursorOffset)
  }, [props.value])

  const handleComposerInput = React.useCallback((input: string, key: Key) => {
    if (disabledRef.current) {
      return
    }

    if (key.tab || (key.shift && key.tab) || (key.ctrl && input === 'c')) {
      return
    }

    const currentValue = valueRef.current
    const currentCursorOffset = cursorOffsetRef.current

    if (key.upArrow || key.downArrow) {
      const verticalMovement = resolveComposerVerticalCursorMove({
        cursorOffset: currentCursorOffset,
        direction: key.upArrow ? 'up' : 'down',
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

    const action = resolveComposerTerminalAction(input, key)

    if (action.kind === 'submit') {
      if (onSubmitRef.current(currentValue) === 'clear') {
        valueRef.current = ''
        cursorOffsetRef.current = 0
        killBufferRef.current = ''
        preferredColumnRef.current = null
        setCursorOffset(0)
        onChangeRef.current('')
      }
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
      onChangeRef.current(editingResult.value)
    }
  }, [])

  useInput(handleComposerInput, {
    isActive: !props.disabled,
  })

  const displayValue =
    props.value.length < valueRef.current.length &&
    valueRef.current.startsWith(props.value)
      ? valueRef.current
      : props.value

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
      value: displayValue,
    }),
  )
}

const ChatHeader = React.memo(function ChatHeader(
  props: ChatHeaderProps,
): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const terminalColumns = process.stderr.columns ?? 80
  const terminalRows = process.stderr.rows ?? 24
  const compactHeader = terminalColumns < 72 || terminalRows < 18

  if (compactHeader) {
    return createElement(
      ChromePanel,
      {
        backgroundColor: theme.switcherBackground,
        marginBottom: 1,
      },
      createElement(
        Text,
        {
          wrap: 'wrap',
        },
        createElement(Text, { color: theme.accentColor }, '●'),
        ' ',
        createElement(Text, { bold: true }, 'Healthy Bob'),
      ),
      props.bindingSummary
        ? createElement(
            Text,
            {
              color: theme.mutedColor,
              wrap: 'wrap',
            },
            props.bindingSummary,
          )
        : null,
    )
  }

  return createElement(
    Box,
    {
      flexDirection: 'column',
      marginBottom: 1,
      width: '100%',
    },
    createElement(
      ChromePanel,
      {
        backgroundColor: theme.switcherBackground,
        marginBottom: 1,
      },
      createElement(
        Text,
        {
          wrap: 'wrap',
        },
        createElement(Text, { color: theme.accentColor }, '●'),
        ' ',
        createElement(Text, { bold: true }, 'Healthy Bob'),
        ' ',
        createElement(Text, { color: theme.mutedColor }, 'interactive chat'),
      ),
    ),
    createElement(
      ChromePanel,
      {
        backgroundColor: theme.switcherBackground,
        marginBottom: 0,
      },
      createElement(
        Text,
        {
          color: theme.mutedColor,
          wrap: 'wrap',
        },
        createElement(Text, { color: theme.accentColor }, '↳'),
        ` ${props.bindingSummary ?? 'local transcript-backed session'}`,
      ),
    ),
  )
})

const ChatEntryRow = React.memo(function ChatEntryRow(
  props: ChatEntryRowProps,
): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()

  if (props.entry.kind === 'assistant') {
    return createElement(
      ChromePanel,
      {
        marginBottom: 1,
      },
      createElement(AssistantMessageText, { text: props.entry.text }),
    )
  }

  if (props.entry.kind === 'error') {
    return createElement(
      ChromePanel,
      {
        backgroundColor: theme.switcherBackground,
        marginBottom: 1,
      },
      createElement(MessageRoleLabel, {
        kind: 'error',
      }),
      createElement(WrappedTextBlock, {
        color: theme.errorColor,
      },
        props.entry.text,
      ),
    )
  }

  if (props.entry.kind === 'trace') {
    return createElement(
      Box,
      {
        marginBottom: 1,
        paddingLeft: 2,
        width: '100%',
      },
      createElement(
        Text,
        {
          dimColor: true,
          wrap: 'wrap',
        },
        `${props.entry.pending ? '· ' : '  '}${props.entry.text}`,
      ),
    )
  }

  if (props.entry.kind === 'thinking' || props.entry.kind === 'status') {
    return createElement(
      Box,
      {
        marginBottom: 1,
        width: '100%',
      },
      createElement(
        Box,
        {
          flexDirection: 'row',
          width: '100%',
        },
        createElement(
          Text,
          { dimColor: true },
          props.entry.kind === 'thinking' ? '· ' : '↻ ',
        ),
        createElement(
          Box,
          {
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
          },
          createElement(
            WrappedTextBlock,
            {
              dimColor: true,
            },
            props.entry.text,
          ),
        ),
      ),
    )
  }

  return createElement(
    ChromePanel,
    {
      backgroundColor: theme.composerBackground,
      marginBottom: 1,
      paddingY: 1,
    },
    createElement(
      Box,
      {
        flexDirection: 'row',
        width: '100%',
      },
      createElement(
        Text,
        {
          color: theme.composerTextColor,
        },
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
          props.entry.text,
        ),
      ),
    ),
  )
})

const AssistantMessageText = React.memo(function AssistantMessageText(
  props: AssistantMessageTextProps,
): React.ReactElement {
  return renderAssistantMessageText(props)
})

export function renderChatTranscriptFeed(input: {
  bindingSummary: string | null
  busy: boolean
  entries: readonly InkChatEntry[]
  sessionId: string
}): React.ReactElement {
  const createElement = React.createElement
  const { liveEntries, staticEntries } = partitionChatTranscriptEntries({
    busy: input.busy,
    entries: input.entries,
  })
  const staticRows: StaticTranscriptRow[] = [
    {
      kind: 'header',
      bindingSummary: input.bindingSummary,
      sessionId: input.sessionId,
    },
    ...staticEntries.map((entry) => ({
      kind: 'entry' as const,
      entry,
    })),
  ]

  return createElement(
    React.Fragment,
    {},
    createElement(StaticTranscript, {
      items: staticRows,
      children: renderStaticTranscriptRow,
    }),
    createElement(
      Box,
      {
        flexDirection: 'column',
        width: '100%',
      },
      ...liveEntries.map((entry, index) =>
        createElement(ChatEntryRow, {
          key: `live-entry:${staticEntries.length + index}`,
          entry,
        }),
      ),
    ),
  )
}

export function partitionChatTranscriptEntries(input: {
  busy: boolean
  entries: readonly InkChatEntry[]
}): {
  liveEntries: readonly InkChatEntry[]
  staticEntries: readonly InkChatEntry[]
} {
  if (input.entries.length === 0) {
    return {
      liveEntries: [],
      staticEntries: [],
    }
  }

  if (!input.busy) {
    return {
      liveEntries: [],
      staticEntries: [...input.entries],
    }
  }

  let lastUserEntryIndex = -1
  for (let index = input.entries.length - 1; index >= 0; index -= 1) {
    const entry = input.entries[index]
    if (entry?.kind === 'user') {
      lastUserEntryIndex = index
      break
    }
  }

  if (lastUserEntryIndex < 0) {
    return {
      liveEntries: [...input.entries],
      staticEntries: [],
    }
  }

  return {
    liveEntries: input.entries.slice(lastUserEntryIndex + 1),
    staticEntries: input.entries.slice(0, lastUserEntryIndex + 1),
  }
}

function renderStaticTranscriptRow(
  item: StaticTranscriptRow,
  index: number,
): React.ReactElement {
  const createElement = React.createElement

  if (item.kind === 'header') {
    return createElement(ChatHeader, {
      key: `static-header:${item.sessionId}`,
      bindingSummary: item.bindingSummary,
    })
  }

  return createElement(ChatEntryRow, {
    key: `static-entry:${index}`,
    entry: item.entry,
  })
}

const ChatTranscriptFeed = React.memo(function ChatTranscriptFeed(input: {
  bindingSummary: string | null
  busy: boolean
  entries: readonly InkChatEntry[]
  sessionId: string
}): React.ReactElement {
  return renderChatTranscriptFeed(input)
})

const ChatStatus = React.memo(function ChatStatus(
  props: ChatStatusProps,
): React.ReactElement | null {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()

  if (props.busy) {
    const busyColor =
      props.status?.kind === 'error'
        ? theme.errorColor
        : props.status?.kind === 'success'
          ? theme.successColor
          : theme.infoColor
    const busyDetail = normalizeNullableString(props.status?.text)
    const busyLabel = 'Working'

    return createElement(
      ChromePanel,
      {
        marginBottom: 1,
      },
      createElement(
        Box,
        {
          flexDirection: 'row',
          width: '100%',
        },
        createElement(BusySpinner, {
          color: busyColor,
        }),
        createElement(Text, {}, ' '),
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
              wrap: 'wrap',
            },
            createElement(
              Text,
              {
                color: busyColor,
              },
              busyLabel,
            ),
            busyDetail
              ? createElement(
                  Text,
                  {
                    color: theme.mutedColor,
                  },
                  ` · ${busyDetail}`,
                )
              : null,
          ),
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

  return createElement(
    ChromePanel,
    {
      backgroundColor: theme.switcherBackground,
      marginBottom: 1,
    },
    createElement(
      Text,
      {
        wrap: 'wrap',
      },
      createElement(Text, { color: statusColor }, statusIcon),
      ' ',
      createElement(
        Text,
        {
          color:
            props.status.kind === 'info'
              ? theme.composerTextColor
              : statusColor,
        },
        props.status.text,
      ),
    ),
  )
})

const ChatComposer = React.memo(function ChatComposer(
  props: ChatComposerProps,
): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const [value, setValue] = React.useState('')
  const slashSuggestions = props.modelSwitcherActive
    ? []
    : getMatchingSlashCommands(value)
  const showComposerGuidance = shouldShowChatComposerGuidance(props.entryCount)
  const showStarterSuggestions =
    showComposerGuidance &&
    !props.modelSwitcherActive &&
    value.trim().length === 0

  return createElement(
    React.Fragment,
    {},
    createElement(
      ChromePanel,
      {
        backgroundColor: theme.composerBackground,
        marginBottom: slashSuggestions.length > 0 ? 0 : 1,
        paddingY: 1,
      },
      createElement(
        Box,
        {
          flexDirection: 'row',
          width: '100%',
        },
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
      showComposerGuidance
        ? createElement(
            Box,
            {
              marginTop: 1,
            },
            createElement(
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
        ? createElement(
            Box,
            {
              marginTop: 1,
            },
            createElement(
              Text,
              {
                color: theme.accentColor,
                wrap: 'wrap',
              },
              createElement(Text, { color: theme.mutedColor }, 'try: '),
              ...CHAT_STARTER_SUGGESTIONS.flatMap((suggestion, index) => [
                index > 0
                  ? createElement(
                      Text,
                      {
                        color: theme.mutedColor,
                        key: `starter-separator:${index}`,
                      },
                      ' · ',
                    )
                  : null,
                createElement(
                  Text,
                  {
                    key: `starter:${suggestion}`,
                  },
                  suggestion,
                ),
              ]),
            ),
          )
        : null,
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
      width: '100%',
    },
    createElement(
      Text,
      {
        wrap: 'wrap',
      },
      ...props.badges.flatMap((badge, index) => [
        index > 0 ? ' ' : '',
        createElement(FooterBadge, {
          badge,
          key: `badge:${badge.key}`,
        }),
      ]),
    ),
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

function ModelSwitcher(props: ModelSwitcherProps): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const onCancelRef = React.useRef(props.onCancel)
  const onConfirmRef = React.useRef(props.onConfirm)
  const onMoveRef = React.useRef(props.onMove)

  onCancelRef.current = props.onCancel
  onConfirmRef.current = props.onConfirm
  onMoveRef.current = props.onMove

  const handleModelSwitcherInput = React.useCallback((input: string, key: Key) => {
    if (key.escape) {
      onCancelRef.current()
      return
    }

    if (key.upArrow || input === 'k') {
      onMoveRef.current(-1)
      return
    }

    if (key.downArrow || input === 'j') {
      onMoveRef.current(1)
      return
    }

    if (key.return) {
      onConfirmRef.current()
    }
  }, [])

  useInput(handleModelSwitcherInput)

  const title =
    props.mode === 'model'
      ? 'Choose a model'
      : `Choose reasoning for ${CHAT_MODEL_OPTIONS[props.modelIndex]?.value ?? 'the current model'}`
  const subtitle =
    props.mode === 'model'
      ? 'Step 1 of 2. Enter continues to reasoning depth.'
      : 'Step 2 of 2. Enter confirms the active reasoning depth.'
  const helpText =
    props.mode === 'model'
      ? '↑/↓ move · Enter next · Esc close'
      : '↑/↓ move · Enter confirm · Esc back'
  const options =
    props.mode === 'model'
      ? CHAT_MODEL_OPTIONS.map((option, index) =>
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
        )
      : CHAT_REASONING_OPTIONS.map((option, index) =>
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
        )

  return createElement(
    ChromePanel,
    {
      backgroundColor: theme.switcherBackground,
      marginBottom: 1,
    },
    createElement(
      Text,
      {
        color: theme.switcherMutedColor,
      },
      props.mode === 'model' ? 'step 1/2' : 'step 2/2',
    ),
    createElement(
      Text,
      {
        bold: true,
        color: theme.switcherTextColor,
        wrap: 'wrap',
      },
      title,
    ),
    createElement(
      Text,
      {
        color: theme.switcherMutedColor,
        wrap: 'wrap',
      },
      subtitle,
    ),
    createElement(
      Box,
      {
        flexDirection: 'column',
        marginTop: 1,
        width: '100%',
      },
      ...options,
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
        helpText,
      ),
    ),
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
    ChromePanel,
    {
      backgroundColor: theme.switcherBackground,
      marginBottom: 1,
    },
    createElement(
      Text,
      {
        bold: true,
        color: theme.mutedColor,
      },
      'commands',
    ),
    ...input.commands.map((command) =>
      createElement(
        Text,
        {
          key: command.command,
          wrap: 'wrap',
        },
        createElement(
          Text,
          {
            color: theme.accentColor,
          },
          command.command,
        ),
        createElement(
          Text,
          {
            color: theme.mutedColor,
          },
          `  ${command.description}`,
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
  const textColor = input.selected
    ? input.theme.switcherSelectionTextColor
    : input.theme.switcherTextColor
  const descriptionColor = input.selected
    ? input.theme.switcherSelectionTextColor
    : input.theme.switcherMutedColor

  return createElement(
    Box,
    {
      backgroundColor: input.selected
        ? input.theme.switcherSelectionBackground
        : undefined,
      key: `${input.label}:${input.index}`,
      flexDirection: 'column',
      marginBottom: 1,
      paddingX: 1,
      width: '100%',
    },
    createElement(
      Text,
      {
        color: textColor,
      },
      createElement(Text, { color: textColor }, input.selected ? '●' : '○'),
      ` ${input.index + 1}. ${input.label}`,
      input.current
        ? createElement(
            Text,
            {
              color: input.selected ? textColor : input.theme.accentColor,
            },
            ' · current',
          )
        : null,
    ),
    createElement(
      Text,
      {
        color: descriptionColor,
        wrap: 'wrap',
      },
      input.description,
    ),
  )
}

function namespaceTurnTraceUpdates(
  updates: readonly AssistantProviderTraceUpdate[],
  turnTracePrefix: string,
): AssistantProviderTraceUpdate[] {
  return updates.map((update) => ({
    ...update,
    streamKey: update.streamKey
      ? `${turnTracePrefix}:${update.streamKey}`
      : update.streamKey,
  }))
}

function namespaceProviderProgressEvent(
  event: AssistantProviderProgressEvent,
  turnTracePrefix: string,
): AssistantProviderProgressEvent {
  return {
    ...event,
    id: event.id ? `${turnTracePrefix}:${event.id}` : `${turnTracePrefix}:trace`,
  }
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
  const resolved = await openAssistantConversation(input)
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
  const inkInput = resolveAssistantInkInputAdapter()

  if (!inkInput.stdin) {
    throw new Error(
      'Healthy Bob chat requires interactive terminal input. process.stdin does not support raw mode, and Healthy Bob could not open the controlling terminal for Ink input.',
    )
  }
  const inkStdin = inkInput.stdin

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
      inkInput.close()
      resolve(result)
    }

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      inkInput.close()
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
            const updatedSession = await updateAssistantSessionOptions({
              vault: input.vault,
              sessionId: latestSessionRef.current.sessionId,
              providerOptions: {
                model: nextModel,
                reasoningEffort: nextReasoningEffort,
              },
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
        setStatus(null)

        const turnTracePrefix = `turn:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`

        void (async () => {
          let streamedAssistantEntryKey: string | null = null

          const handleTraceEvent = (event: AssistantProviderTraceEvent) => {
            const namespacedUpdates = namespaceTurnTraceUpdates(
              event.updates,
              turnTracePrefix,
            )
            if (namespacedUpdates.length === 0) {
              return
            }

            for (const update of namespacedUpdates) {
              if (update.kind === 'assistant' && update.streamKey) {
                streamedAssistantEntryKey = streamedAssistantEntryKey ?? update.streamKey
              }
            }

            setEntries((previous: InkChatEntry[]) =>
              applyInkChatTraceUpdates(previous, namespacedUpdates),
            )

            const latestStatusUpdate = [...namespacedUpdates]
              .reverse()
              .find((update) => update.kind === 'error' || update.kind === 'status')

            if (latestStatusUpdate) {
              setStatus({
                kind: latestStatusUpdate.kind === 'error' ? 'error' : 'info',
                text: latestStatusUpdate.text,
              })
            }
          }

          try {
            const result = await sendAssistantMessage({
              ...input,
              conversation: {
                ...(input.conversation ?? {}),
                sessionId: latestSessionRef.current.sessionId,
              },
              model: activeModel,
              onProviderEvent: (event) => {
                setEntries((previous: InkChatEntry[]) =>
                  applyProviderProgressEventToEntries({
                    entries: previous,
                    event: namespaceProviderProgressEvent(event, turnTracePrefix),
                  }),
                )
              },
              onTraceEvent: handleTraceEvent,
              prompt: action.prompt,
              reasoningEffort: activeReasoningEffort,
              sessionSnapshot: latestSessionRef.current,
              showThinkingTraces: true,
            })

            latestSessionRef.current = result.session
            setSession(result.session)
            setTurns((previous: number) => previous + 1)
            setEntries((previous: InkChatEntry[]) =>
              streamedAssistantEntryKey
                ? applyInkChatTraceUpdates(previous, [
                    {
                      kind: 'assistant',
                      mode: 'replace',
                      streamKey: streamedAssistantEntryKey,
                      text: result.response,
                    },
                  ])
                : [
                    ...previous,
                    {
                      kind: 'assistant',
                      text: result.response,
                    },
                  ],
            )
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
            const recoveredSession = extractRecoveredAssistantSession(error)
            if (recoveredSession) {
              latestSessionRef.current = recoveredSession
              setSession(recoveredSession)
            }

            const errorText = error instanceof Error ? error.message : String(error)
            const connectionLost = isAssistantProviderConnectionLostError(error)
            const missingSession = isAssistantSessionNotFoundError(error)
            setEntries((previous: InkChatEntry[]) => [
              ...previous,
              {
                kind: 'error',
                text: errorText,
              },
            ])
            setStatus(
              connectionLost
                ? {
                    kind: 'error',
                    text: 'The assistant lost its provider connection. Restore connectivity, then keep chatting to resume.',
                  }
                : missingSession
                  ? {
                      kind: 'error',
                      text: 'The local assistant session record is missing. Check the current vault/default vault or start a new chat.',
                    }
                : {
                    kind: 'error',
                    text: 'The assistant hit an error. Fix it or keep chatting.',
                  },
            )
            if (!missingSession) {
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
            }
          } finally {
            setBusy(false)
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
      const metadataBadges = resolveChatMetadataBadges(
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
            width: '100%',
          },
          createElement(ChatTranscriptFeed, {
            bindingSummary,
            busy,
            entries,
            sessionId: session.sessionId,
          }),
          createElement(
            Box,
            {
              flexDirection: 'column',
              width: '100%',
            },
            createElement(ChatStatus, {
              busy,
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
              entryCount: entries.length,
              modelSwitcherActive: modelSwitcherState !== null,
              onSubmit: submitPrompt,
            }),
            createElement(ChatFooter, {
              badges: metadataBadges,
            }),
          ),
        ),
      )
    }

    try {
      instance = render(React.createElement(App), {
        stderr: process.stderr,
        stdin: inkStdin,
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
