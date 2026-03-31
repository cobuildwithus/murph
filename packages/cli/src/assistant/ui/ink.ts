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
  type AssistantSession,
} from '@murph/assistant-core/assistant-cli-contracts'
import type { AssistantProviderProgressEvent } from '@murph/assistant-core/chat-provider'
import {
  discoverAssistantProviderModels,
  resolveAssistantCatalogReasoningOptions,
  resolveAssistantModelCatalog,
  type AssistantCatalogModel,
  type AssistantModelDiscoveryResult,
} from '../provider-catalog.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from '@murph/assistant-core/assistant/provider-traces'
import { resolveCodexDisplayOptions } from '@murph/assistant-core/assistant-codex'
import {
  buildAssistantProviderDefaultsPatch,
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
  saveAssistantOperatorDefaultsPatch,
} from '@murph/assistant-core/operator-config'
import {
  openAssistantConversation,
  sendAssistantMessage,
  updateAssistantSessionOptions,
  type AssistantChatInput,
} from '../service.js'
import {
  extractRecoveredAssistantSession,
  isAssistantProviderConnectionLostError,
  isAssistantProviderInterruptedError,
} from '@murph/assistant-core/assistant/provider-turn-recovery'
import {
  appendAssistantTranscriptEntries,
  isAssistantSessionNotFoundError,
  listAssistantTranscriptEntries,
  redactAssistantDisplayPath,
} from '../store.js'
import { normalizeNullableString } from '@murph/assistant-core/assistant/shared'
import { redactAssistantSessionForDisplay } from '@murph/assistant-core/assistant/redaction'
import {
  CHAT_COMPOSER_HINT,
  CHAT_SLASH_COMMANDS,
  CHAT_STARTER_SUGGESTIONS,
  applyProviderProgressEventToEntries,
  finalizePendingInkChatTraces,
  findAssistantModelOptionIndex,
  findAssistantReasoningOptionIndex,
  formatSessionBinding,
  applyInkChatTraceUpdates,
  getMatchingSlashCommands,
  resolveChatMetadataBadges,
  resolveChatSubmitAction,
  shouldShowChatComposerGuidance,
  shouldClearComposerForSubmitAction,
  type AssistantModelOption,
  type AssistantReasoningOption,
  type ChatMetadataBadge,
  type InkChatEntry,
  seedChatEntries,
} from './view-model.js'
import {
  LIGHT_ASSISTANT_INK_THEME,
  captureAssistantInkThemeBaseline,
  resolveAssistantInkThemeForOpenChat,
  type AssistantInkTheme,
} from './theme.js'

type AssistantChatResult = ReturnType<typeof assistantChatResultSchema.parse>

const AssistantInkThemeContext =
  React.createContext<AssistantInkTheme>(LIGHT_ASSISTANT_INK_THEME)
interface ComposerInputProps {
  disabled: boolean
  onChange: (value: string) => void
  onEditLastQueuedPrompt: () => void
  onSubmit: (value: string, mode: ComposerSubmitMode) => ComposerSubmitDisposition
  placeholder: string
  value: string
}

interface ModelSwitcherProps {
  currentModel: string | null
  currentReasoningEffort: string | null
  mode: 'model' | 'reasoning'
  modelIndex: number
  modelOptions: readonly AssistantModelOption[]
  onCancel: () => void
  onConfirm: () => void
  onMove: (delta: number) => void
  reasoningIndex: number
  reasoningOptions: readonly AssistantReasoningOption[]
}

interface ModelSwitcherState {
  models: readonly AssistantCatalogModel[]
  mode: 'model' | 'reasoning'
  modelIndex: number
  reasoningIndex: number
  modelOptions: readonly AssistantModelOption[]
  reasoningOptions: readonly AssistantReasoningOption[]
}

type ComposerSubmitMode = 'enter' | 'tab'

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
  onChange: (value: string) => void
  onEditLastQueuedPrompt: () => void
  onSubmit: (value: string, mode: ComposerSubmitMode) => ComposerSubmitDisposition
  value: string
}

interface ChatFooterProps {
  badges: readonly ChatMetadataBadge[]
}

interface QueuedFollowUpStatusProps {
  latestPrompt: string | null
  queuedPromptCount: number
}

interface ChromePanelProps {
  backgroundColor?: string
  children?: React.ReactNode
  marginBottom?: number
  paddingX?: number
  paddingY?: number
  width?: number | string
}

interface ComposerEditingState {
  cursorOffset: number
  killBuffer: string
  value: string
}

interface ComposerEditingResult extends ComposerEditingState {
  handled: boolean
}

interface ComposerControlledSyncInput {
  cursorOffset: number
  currentValue: string
  nextControlledValue: string
  pendingValues: readonly string[]
  previousControlledValue: string
}

interface ComposerControlledSyncResult {
  cursorOffset: number
  nextValue: string
  pendingValues: string[]
}

interface AssistantTurnErrorPresentation {
  entry: {
    kind: 'error' | 'status'
    text: string
  }
  persistTranscriptError: boolean
  status: {
    kind: 'error' | 'info'
    text: string
  }
}

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

const COMPOSER_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\\\|;:'\\\",.<>/?"
const MODIFIED_RETURN_SEQUENCE = /^\u001b?\[27;(\d+);13~$/u
const RAW_ARROW_SEQUENCE = /^\u001b?(?:\[(?:(\d+;)?(\d+))?([ABCD])|O([ABCD]))$/u
const QUEUED_FOLLOW_UP_SHORTCUT_HINT = '⌥ + ↑ edit last queued message'
const MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH = 88
const ASSISTANT_INK_THEME_REFRESH_INTERVAL_MS = 2_000

function useAssistantInkTheme(): AssistantInkTheme {
  return React.useContext(AssistantInkThemeContext)
}

const BUSY_INDICATOR_CHARACTER = '•'
const ASSISTANT_CHAT_VIEW_PADDING_X = 1
const ASSISTANT_PLAIN_TEXT_WRAP_SLACK = 1
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
  width: number | string
} {
  const boxProps: {
    backgroundColor?: string
    flexDirection: 'column'
    marginBottom: number
    paddingX: number
    paddingY: number
    width: number | string
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
    BUSY_INDICATOR_CHARACTER,
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

function resolveAssistantTerminalColumns(columns: number | null | undefined): number {
  return typeof columns === 'number' && Number.isFinite(columns)
    ? Math.max(1, Math.floor(columns))
    : 80
}

export function resolveAssistantChatViewportWidth(
  columns: number | null | undefined,
): number {
  return Math.max(
    1,
    resolveAssistantTerminalColumns(columns) - ASSISTANT_CHAT_VIEW_PADDING_X * 2,
  )
}

export function resolveAssistantPlainTextWrapColumns(
  columns: number | null | undefined,
): number {
  return Math.max(
    1,
    resolveAssistantChatViewportWidth(columns) - ASSISTANT_PLAIN_TEXT_WRAP_SLACK,
  )
}

const WrappedTextBlock = React.memo(function WrappedTextBlock(input: {
  children?: React.ReactNode
  color?: string
  dimColor?: boolean
}): React.ReactElement {
  return renderWrappedTextBlock(input)
})

export function renderWrappedPlainTextBlock(input: {
  columns: number
  color?: string
  dimColor?: boolean
  text: string
}): React.ReactElement {
  const createElement = React.createElement
  const lines = wrapAssistantPlainText(input.text, input.columns).split('\n')

  return createElement(
    Box,
    {
      flexDirection: 'column',
      width: '100%',
    },
    ...lines.map((line, index) =>
      createElement(
        Text,
        {
          color: input.color,
          dimColor: input.dimColor,
          key: `wrapped-plain-text:${index}`,
        },
        line.length > 0 ? line : ' ',
      ),
    ),
  )
}

export function resolveAssistantTurnErrorPresentation(input: {
  error: unknown
  restoredQueuedPromptCount: number
}): AssistantTurnErrorPresentation {
  const errorText =
    input.error instanceof Error ? input.error.message : String(input.error)
  const canonicalWriteBlocked = isAssistantCanonicalWriteBlockedError(input.error)
  const connectionLost = isAssistantProviderConnectionLostError(input.error)
  const missingSession = isAssistantSessionNotFoundError(input.error)
  const queuedFollowUpSuffix =
    input.restoredQueuedPromptCount > 0
      ? ' Queued follow-ups are back in the composer.'
      : ''

  return {
    entry: {
      kind: canonicalWriteBlocked ? 'status' : 'error',
      text: errorText,
    },
    persistTranscriptError: !missingSession && !canonicalWriteBlocked,
    status: canonicalWriteBlocked
      ? {
          kind: 'info',
          text: `Blocked a direct canonical vault write and kept the live vault unchanged. Retry after using vault-cli or other audited Murph tools.${queuedFollowUpSuffix}`,
        }
      : connectionLost
        ? {
            kind: 'error',
            text: `The assistant lost its provider connection. Restore connectivity, then keep chatting to resume.${queuedFollowUpSuffix}`,
          }
        : missingSession
          ? {
              kind: 'error',
              text: `The local assistant session record is missing. Check the current vault/default vault or start a new chat.${queuedFollowUpSuffix}`,
            }
          : {
              kind: 'error',
              text: `The assistant hit an error. Fix it or keep chatting.${queuedFollowUpSuffix}`,
            },
  }
}

const WrappedPlainTextBlock = React.memo(function WrappedPlainTextBlock(input: {
  columns: number
  color?: string
  dimColor?: boolean
  text: string
}): React.ReactElement {
  return renderWrappedPlainTextBlock(input)
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

function ComposerInput(props: ComposerInputProps): React.ReactElement {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const [displayValue, setDisplayValue] = React.useState(props.value)
  const [cursorOffset, setCursorOffset] = React.useState(props.value.length)
  const valueRef = React.useRef(props.value)
  const cursorOffsetRef = React.useRef(props.value.length)
  const killBufferRef = React.useRef('')
  const preferredColumnRef = React.useRef<number | null>(null)
  const lastPropValueRef = React.useRef(props.value)
  // Keep a queue of locally emitted draft values so older controlled echoes
  // cannot clobber a newer in-flight paste or mid-buffer edit.
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

    if (
      action.kind === 'edit' &&
      (action.key.upArrow || action.key.downArrow)
    ) {
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
        createElement(Text, { bold: true }, 'Murph'),
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
        createElement(Text, { bold: true }, 'Murph'),
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
  const { stdout } = useStdout()
  const rowWidth = resolveAssistantChatViewportWidth(stdout?.columns)

  if (props.entry.kind === 'assistant') {
    return createElement(
      ChromePanel,
      {
        marginBottom: 1,
        width: rowWidth,
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
        width: rowWidth,
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
        width: rowWidth,
      },
      createElement(WrappedPlainTextBlock, {
        columns: Math.max(1, rowWidth - 2),
        dimColor: true,
        text: `${props.entry.pending ? '· ' : '  '}${props.entry.text}`,
      }),
    )
  }

  if (props.entry.kind === 'thinking' || props.entry.kind === 'status') {
    return createElement(
      Box,
      {
        marginBottom: 1,
        width: rowWidth,
      },
      createElement(
        Box,
        {
          flexDirection: 'row',
          width: rowWidth,
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
      width: rowWidth,
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

export function shouldShowBusyStatus(input: {
  busy: boolean
  entries: readonly InkChatEntry[]
}): boolean {
  if (!input.busy) {
    return false
  }

  let lastUserEntryIndex = -1
  for (let index = input.entries.length - 1; index >= 0; index -= 1) {
    if (input.entries[index]?.kind === 'user') {
      lastUserEntryIndex = index
      break
    }
  }

  if (lastUserEntryIndex < 0) {
    return true
  }

  for (let index = lastUserEntryIndex + 1; index < input.entries.length; index += 1) {
    const entry = input.entries[index]
    if (entry?.kind === 'assistant' && normalizeNullableString(entry.text)) {
      return false
    }

    if (entry?.kind === 'error' && normalizeNullableString(entry.text)) {
      return false
    }
  }

  return true
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
              color: busyColor,
            },
            busyLabel,
          ),
          busyDetail
            ? createElement(WrappedPlainTextBlock, {
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

  return createElement(
    ChromePanel,
    {
      backgroundColor: theme.switcherBackground,
      marginBottom: 1,
    },
    createElement(
      Box,
      {
        flexDirection: 'row',
        width: '100%',
      },
      createElement(Text, { color: statusColor }, `${statusIcon} `),
      createElement(
        Box,
        {
          flexDirection: 'column',
          flexGrow: 1,
          flexShrink: 1,
        },
        createElement(WrappedPlainTextBlock, {
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

const ChatComposer = React.memo(function ChatComposer(
  props: ChatComposerProps,
): React.ReactElement {
  const createElement = React.createElement
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
          value: props.value,
          placeholder: 'Type a message',
          onChange: props.onChange,
          onEditLastQueuedPrompt: props.onEditLastQueuedPrompt,
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
              width: '100%',
            },
            createElement(Text, { color: theme.mutedColor }, 'try:'),
            createElement(WrappedPlainTextBlock, {
              color: theme.accentColor,
              columns: Math.max(1, wrapColumns - 2),
              text: `  ${CHAT_STARTER_SUGGESTIONS.join(' · ')}`,
            }),
          )
        : null,
    ),
    createElement(SlashCommandSuggestions, {
      commands: slashSuggestions,
    }),
  )
})

const QueuedFollowUpStatus = React.memo(function QueuedFollowUpStatus(
  props: QueuedFollowUpStatusProps,
): React.ReactElement | null {
  const createElement = React.createElement
  const theme = useAssistantInkTheme()
  const { stdout } = useStdout()

  if (props.queuedPromptCount === 0 || !props.latestPrompt) {
    return null
  }

  const extraQueuedCount = props.queuedPromptCount - 1
  const wrapColumns = resolveAssistantPlainTextWrapColumns(stdout?.columns)

  return createElement(
    Box,
    {
      flexDirection: 'column',
      marginBottom: 1,
      width: '100%',
    },
    createElement(
      Text,
      {
        color: theme.composerTextColor,
        wrap: 'wrap',
      },
      '• Queued follow-up messages',
    ),
    createElement(WrappedPlainTextBlock, {
      color: theme.composerTextColor,
      columns: wrapColumns,
      text: `  ↳ ${formatQueuedFollowUpPreview(props.latestPrompt)}`,
    }),
    extraQueuedCount > 0
      ? createElement(WrappedPlainTextBlock, {
          color: theme.mutedColor,
          columns: wrapColumns,
          text: `    +${extraQueuedCount} more queued`,
        })
      : null,
    createElement(WrappedPlainTextBlock, {
      color: theme.mutedColor,
      columns: wrapColumns,
      text: `    ${QUEUED_FOLLOW_UP_SHORTCUT_HINT}`,
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

function enqueuePendingComposerValue(
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
    const normalizedKey = normalizeAssistantInkArrowKey(input, key)

    if (normalizedKey.escape) {
      onCancelRef.current()
      return
    }

    if (normalizedKey.upArrow || input === 'k') {
      onMoveRef.current(-1)
      return
    }

    if (normalizedKey.downArrow || input === 'j') {
      onMoveRef.current(1)
      return
    }

    if (normalizedKey.return) {
      onConfirmRef.current()
    }
  }, [])

  useInput(handleModelSwitcherInput)

  const selectedModelLabel =
    props.modelOptions[props.modelIndex]?.value ??
    props.currentModel ??
    'the current model'
  const canChooseReasoning = props.reasoningOptions.length > 0
  const title =
    props.mode === 'model'
      ? 'Choose a model'
      : `Choose reasoning for ${selectedModelLabel}`
  const subtitle =
    props.mode === 'model'
      ? canChooseReasoning
        ? 'Step 1 of 2. Enter continues to reasoning depth.'
        : 'Enter confirms the active model.'
      : 'Step 2 of 2. Enter confirms the active reasoning depth.'
  const helpText =
    props.mode === 'model'
      ? canChooseReasoning
        ? '↑/↓ move · Enter next · Esc close'
        : '↑/↓ move · Enter confirm · Esc close'
      : '↑/↓ move · Enter confirm · Esc back'
  const options =
    props.mode === 'model'
      ? props.modelOptions.map((option, index) =>
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
      : props.reasoningOptions.map((option, index) =>
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
      Box,
      {
        flexDirection: 'column',
      },
      createElement(
        Text,
        {
          bold: true,
          color: theme.switcherTextColor,
        },
        title,
      ),
      createElement(
        Text,
        {
          color: theme.switcherMutedColor,
        },
        subtitle,
      ),
      createElement(Box, {
        height: 1,
      }),
      ...options,
      createElement(Box, {
        height: 1,
      }),
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
  const { stdout } = useStdout()

  if (input.commands.length === 0) {
    return null
  }

  const createElement = React.createElement
  const wrapColumns = resolveAssistantPlainTextWrapColumns(stdout?.columns)

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
        Box,
        {
          flexDirection: 'row',
          key: command.command,
          width: '100%',
        },
        createElement(Text, { color: theme.accentColor }, command.command),
        createElement(
          Box,
          {
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
          },
          createElement(WrappedPlainTextBlock, {
            color: theme.mutedColor,
            columns: Math.max(1, wrapColumns - command.command.length - 2),
            text: `  ${command.description}`,
          }),
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

function assistantModelDiscoveryResultsEqual(
  left: AssistantModelDiscoveryResult | null,
  right: AssistantModelDiscoveryResult | null,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return (
    left.status === right.status &&
    (normalizeNullableString(left.message) ?? null) ===
      (normalizeNullableString(right.message) ?? null) &&
    left.models.length === right.models.length &&
    left.models.every((model, index) => model.id === right.models[index]?.id)
  )
}

interface AssistantChatStatus {
  kind: 'error' | 'info' | 'success'
  text: string
}

interface AssistantBlockedTurnFeedback {
  entry: {
    kind: 'status'
    streamKey?: string | null
    text: string
  }
  status: AssistantChatStatus
}

interface AssistantPromptQueueState {
  prompts: readonly string[]
}

type AssistantPromptQueueAction =
  | {
      kind: 'clear'
    }
  | {
      kind: 'dequeue'
    }
  | {
      kind: 'enqueue'
      prompt: string
    }
  | {
      kind: 'pop-last'
    }

interface AssistantTurnState {
  pauseRequested: boolean
  phase: 'idle' | 'running'
}

export interface AssistantTurnSelection {
  activeModel: string | null
  activeReasoningEffort: string | null
}

type AssistantTurnAction =
  | {
      kind: 'finish'
    }
  | {
      kind: 'request-pause'
    }
  | {
      kind: 'start'
    }

type AssistantSendMessageResult = Awaited<
  ReturnType<typeof sendAssistantMessage>
>

type AssistantPromptTurnOutcome =
  | {
      kind: 'blocked'
      message: string
      session: AssistantSession
    }
  | {
      delivery: AssistantSendMessageResult['delivery']
      deliveryError: AssistantSendMessageResult['deliveryError']
      kind: 'completed'
      response: string
      session: AssistantSession
      streamedAssistantEntryKey: string | null
    }
  | {
      error: unknown
      kind: 'failed'
      recoveredSession: AssistantSession | null
    }
  | {
      kind: 'interrupted'
      recoveredSession: AssistantSession | null
    }

type AssistantQueuedPromptDisposition =
  | {
      kind: 'idle'
    }
  | {
      kind: 'replay-next'
      nextQueuedPrompt: string
      remainingQueuedPrompts: readonly string[]
    }
  | {
      kind: 'restore-composer'
      restoredQueuedPromptCount: number
    }

interface RunAssistantPromptTurnInput {
  activeModel: string | null
  activeReasoningEffort: string | null
  input: AssistantChatInput & {
    abortSignal: AbortSignal
  }
  prompt: string
  session: AssistantSession
  setEntries: React.Dispatch<React.SetStateAction<InkChatEntry[]>>
  setStatus: React.Dispatch<React.SetStateAction<AssistantChatStatus | null>>
  transcriptSnapshot: NonNullable<AssistantChatInput['transcriptSnapshot']>
  turnTracePrefix: string
}

interface UseAssistantChatControllerInput {
  codexDisplay: Awaited<ReturnType<typeof resolveCodexDisplayOptions>>
  defaults: Awaited<ReturnType<typeof resolveAssistantOperatorDefaults>>
  input: AssistantChatInput
  redactedVault: string
  resolvedSession: AssistantSession
  selectedProviderDefaults: ReturnType<typeof resolveAssistantProviderDefaults>
  transcriptEntries: Awaited<ReturnType<typeof listAssistantTranscriptEntries>>
}

interface AssistantChatController {
  activeModel: string | null
  activeReasoningEffort: string | null
  bindingSummary: string | null
  busy: boolean
  composerValue: string
  editLastQueuedPrompt: () => void
  entries: readonly InkChatEntry[]
  lastQueuedPrompt: string | null
  latestSessionRef: React.MutableRefObject<AssistantSession>
  latestTurnsRef: React.MutableRefObject<number>
  metadataBadges: readonly ChatMetadataBadge[]
  modelSwitcherState: ModelSwitcherState | null
  moveModelSwitcherSelection: (delta: number) => void
  queuedPromptCount: number
  session: AssistantSession
  setComposerValue: React.Dispatch<React.SetStateAction<string>>
  status: AssistantChatStatus | null
  submitPrompt: (
    rawValue: string,
    mode: ComposerSubmitMode,
  ) => ComposerSubmitDisposition
  cancelModelSwitcher: () => void
  confirmModelSwitcher: () => void
}

const EMPTY_ASSISTANT_PROMPT_QUEUE_STATE: AssistantPromptQueueState = {
  prompts: [],
}

const IDLE_ASSISTANT_TURN_STATE: AssistantTurnState = {
  pauseRequested: false,
  phase: 'idle',
}

export function resolveAssistantBlockedTurnFeedback(
  message: string,
): AssistantBlockedTurnFeedback {
  return {
    entry: {
      kind: 'status' as const,
      text: message,
    },
    status: {
      kind: 'info' as const,
      text: message,
    },
  }
}

export function reduceAssistantPromptQueueState(
  state: AssistantPromptQueueState,
  action: AssistantPromptQueueAction,
): AssistantPromptQueueState {
  switch (action.kind) {
    case 'clear':
      return EMPTY_ASSISTANT_PROMPT_QUEUE_STATE
    case 'dequeue':
      return state.prompts.length > 0
        ? {
            prompts: state.prompts.slice(1),
          }
        : state
    case 'enqueue':
      return {
        prompts: [...state.prompts, action.prompt],
      }
    case 'pop-last':
      return state.prompts.length > 0
        ? {
            prompts: state.prompts.slice(0, -1),
          }
        : state
    default:
      return state
  }
}

export function reduceAssistantTurnState(
  state: AssistantTurnState,
  action: AssistantTurnAction,
): AssistantTurnState {
  switch (action.kind) {
    case 'finish':
      return IDLE_ASSISTANT_TURN_STATE
    case 'request-pause':
      return state.phase === 'running'
        ? {
            ...state,
            pauseRequested: true,
          }
        : state
    case 'start':
      return {
        pauseRequested: false,
        phase: 'running',
      }
    default:
      return state
  }
}

function createAssistantTurnTracePrefix(): string {
  return `turn:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function resolveAssistantQueuedPromptDisposition(input: {
  pauseRequested: boolean
  queuedPrompts: readonly string[]
  turnOutcome: AssistantPromptTurnOutcome['kind']
}): AssistantQueuedPromptDisposition {
  if (
    input.turnOutcome === 'failed' ||
    input.turnOutcome === 'interrupted' ||
    (input.pauseRequested &&
      (input.turnOutcome === 'blocked' || input.turnOutcome === 'completed'))
  ) {
    return {
      kind: 'restore-composer',
      restoredQueuedPromptCount: input.queuedPrompts.length,
    }
  }

  if (
    (input.turnOutcome === 'blocked' || input.turnOutcome === 'completed') &&
    input.queuedPrompts.length > 0
  ) {
    return {
      kind: 'replay-next',
      nextQueuedPrompt: input.queuedPrompts[0] ?? '',
      remainingQueuedPrompts: input.queuedPrompts.slice(1),
    }
  }

  return {
    kind: 'idle',
  }
}

function normalizeAssistantTurnSelection(
  input: AssistantTurnSelection,
): AssistantTurnSelection {
  return {
    activeModel: normalizeNullableString(input.activeModel),
    activeReasoningEffort: normalizeNullableString(input.activeReasoningEffort),
  }
}

function resolveAssistantSessionTurnSelection(
  session: AssistantSession,
): AssistantTurnSelection {
  return normalizeAssistantTurnSelection({
    activeModel: session.providerOptions.model,
    activeReasoningEffort: session.providerOptions.reasoningEffort,
  })
}

function buildAssistantTranscriptSnapshotFromInkEntries(input: {
  entries: readonly InkChatEntry[]
  pendingPrompt: string
}): NonNullable<AssistantChatInput['transcriptSnapshot']> {
  const transcriptEntries = input.entries.flatMap((entry) =>
    entry.kind === 'assistant' || entry.kind === 'error' || entry.kind === 'user'
      ? [{
          kind: entry.kind,
          text: entry.text,
        }]
      : [],
  )
  const lastEntry = transcriptEntries.at(-1)
  if (lastEntry?.kind === 'user' && lastEntry.text === input.pendingPrompt) {
    return transcriptEntries.slice(0, -1)
  }

  return transcriptEntries
}

export function resolveAssistantSelectionAfterSessionSync(input: {
  currentSelection: AssistantTurnSelection
  previousSession: AssistantSession
  nextSession: AssistantSession
}): AssistantTurnSelection {
  const currentSelection = normalizeAssistantTurnSelection(input.currentSelection)
  const previousSessionSelection = resolveAssistantSessionTurnSelection(
    input.previousSession,
  )
  const nextSessionSelection = resolveAssistantSessionTurnSelection(input.nextSession)
  const effectiveSelectionChanged =
    input.previousSession.provider !== input.nextSession.provider ||
    previousSessionSelection.activeModel !== nextSessionSelection.activeModel ||
    previousSessionSelection.activeReasoningEffort !==
      nextSessionSelection.activeReasoningEffort

  return effectiveSelectionChanged ? nextSessionSelection : currentSelection
}

export async function runAssistantPromptTurn(
  input: RunAssistantPromptTurnInput,
): Promise<AssistantPromptTurnOutcome> {
  let streamedAssistantEntryKey: string | null = null

  const handleTraceEvent = (event: AssistantProviderTraceEvent) => {
    const namespacedUpdates = namespaceTurnTraceUpdates(
      event.updates,
      input.turnTracePrefix,
    )
    if (namespacedUpdates.length === 0) {
      return
    }

    for (const update of namespacedUpdates) {
      if (update.kind === 'assistant' && update.streamKey) {
        streamedAssistantEntryKey = streamedAssistantEntryKey ?? update.streamKey
      }
    }

    input.setEntries((previous: InkChatEntry[]) =>
      applyInkChatTraceUpdates(previous, namespacedUpdates),
    )

    const latestStatusUpdate = [...namespacedUpdates]
      .reverse()
      .find((update) => update.kind === 'error' || update.kind === 'status')

    if (latestStatusUpdate) {
      input.setStatus({
        kind: latestStatusUpdate.kind === 'error' ? 'error' : 'info',
        text: latestStatusUpdate.text,
      })
    }
  }

  try {
    const result = await sendAssistantMessage({
      ...input.input,
      abortSignal: input.input.abortSignal,
      conversation: {
        ...(input.input.conversation ?? {}),
        sessionId: input.session.sessionId,
      },
      model: input.activeModel,
      onProviderEvent: (event) => {
        input.setEntries((previous: InkChatEntry[]) =>
          applyProviderProgressEventToEntries({
            entries: previous,
            event: namespaceProviderProgressEvent(event, input.turnTracePrefix),
          }),
        )
      },
      onTraceEvent: handleTraceEvent,
      prompt: input.prompt,
      reasoningEffort: input.activeReasoningEffort,
      sessionSnapshot: input.session,
      transcriptSnapshot: input.transcriptSnapshot,
      showThinkingTraces: true,
    })

    if (result.status === 'blocked') {
      return {
        kind: 'blocked',
        message:
          result.blocked?.message ??
          'Assistant turn was blocked by the canonical write guard.',
        session: result.session,
      }
    }

    return {
      delivery: result.delivery,
      deliveryError: result.deliveryError,
      kind: 'completed',
      response: result.response,
      session: result.session,
      streamedAssistantEntryKey,
    }
  } catch (error) {
    const recoveredSession = extractRecoveredAssistantSession(error)

    if (isAssistantProviderInterruptedError(error)) {
      return {
        kind: 'interrupted',
        recoveredSession,
      }
    }

    return {
      error,
      kind: 'failed',
      recoveredSession,
    }
  }
}

function useAssistantChatController(
  input: UseAssistantChatControllerInput,
): AssistantChatController {
  const { exit } = useApp()
  const [session, setSession] = React.useState(input.resolvedSession)
  const [entries, setEntries] = React.useState(seedChatEntries(input.transcriptEntries))
  const entriesRef = React.useRef(entries)
  const [status, setStatus] = React.useState<AssistantChatStatus | null>(null)
  const [composerValue, setComposerValue] = React.useState('')
  const initialActiveModel =
    normalizeNullableString(input.input.model) ??
    normalizeNullableString(input.selectedProviderDefaults?.model) ??
    normalizeNullableString(input.resolvedSession.providerOptions.model) ??
    normalizeNullableString(input.codexDisplay.model)
  const initialActiveReasoningEffort =
    normalizeNullableString(input.input.reasoningEffort) ??
    normalizeNullableString(input.selectedProviderDefaults?.reasoningEffort) ??
    normalizeNullableString(input.resolvedSession.providerOptions.reasoningEffort) ??
    normalizeNullableString(input.codexDisplay.reasoningEffort)
  const [activeModel, setActiveModel] = React.useState<string | null>(
    initialActiveModel,
  )
  const [activeReasoningEffort, setActiveReasoningEffort] = React.useState<string | null>(
    initialActiveReasoningEffort,
  )
  const [modelDiscovery, setModelDiscovery] =
    React.useState<AssistantModelDiscoveryResult | null>(null)
  const [modelSwitcherState, setModelSwitcherState] =
    React.useState<ModelSwitcherState | null>(null)
  const [promptQueueState, setPromptQueueState] =
    React.useState<AssistantPromptQueueState>(EMPTY_ASSISTANT_PROMPT_QUEUE_STATE)
  const [turnState, setTurnState] =
    React.useState<AssistantTurnState>(IDLE_ASSISTANT_TURN_STATE)
  const latestSessionRef = React.useRef(input.resolvedSession)
  const latestTurnsRef = React.useRef(0)
  const initialPromptRef = React.useRef(normalizeNullableString(input.input.initialPrompt))
  const bootstrappedRef = React.useRef(false)
  const promptQueueStateRef = React.useRef<AssistantPromptQueueState>(
    EMPTY_ASSISTANT_PROMPT_QUEUE_STATE,
  )
  const turnStateRef = React.useRef<AssistantTurnState>(IDLE_ASSISTANT_TURN_STATE)
  const activeTurnAbortControllerRef = React.useRef<AbortController | null>(null)
  const activeSelectionRef = React.useRef<AssistantTurnSelection>({
    activeModel: initialActiveModel,
    activeReasoningEffort: initialActiveReasoningEffort,
  })
  const modelCatalog = resolveAssistantModelCatalog({
    provider: session.provider,
    baseUrl: session.providerOptions.baseUrl,
    currentModel: activeModel,
    currentReasoningEffort: activeReasoningEffort,
    discovery: modelDiscovery,
    headers: session.providerOptions.headers ?? null,
    apiKeyEnv: session.providerOptions.apiKeyEnv,
    oss: session.providerOptions.oss,
    providerName: session.providerOptions.providerName,
  })

  const updatePromptQueue = React.useCallback((action: AssistantPromptQueueAction) => {
    const nextState = reduceAssistantPromptQueueState(promptQueueStateRef.current, action)
    promptQueueStateRef.current = nextState
    setPromptQueueState(nextState)
    return nextState
  }, [])

  const updateTurnState = React.useCallback((action: AssistantTurnAction) => {
    const nextState = reduceAssistantTurnState(turnStateRef.current, action)
    turnStateRef.current = nextState
    setTurnState(nextState)
    return nextState
  }, [])

  React.useEffect(() => {
    latestSessionRef.current = session
  }, [session])

  React.useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  const setActiveSelection = React.useCallback((nextSelection: AssistantTurnSelection) => {
    const normalizedSelection = normalizeAssistantTurnSelection(nextSelection)
    activeSelectionRef.current = normalizedSelection
    setActiveModel(normalizedSelection.activeModel)
    setActiveReasoningEffort(normalizedSelection.activeReasoningEffort)
  }, [])

  const commitSession = React.useCallback(
    (nextSession: AssistantSession) => {
      const previousSession = latestSessionRef.current
      latestSessionRef.current = nextSession
      setSession(nextSession)

      const nextSelection = resolveAssistantSelectionAfterSessionSync({
        currentSelection: activeSelectionRef.current,
        previousSession,
        nextSession,
      })

      if (
        nextSelection.activeModel !== activeSelectionRef.current.activeModel ||
        nextSelection.activeReasoningEffort !==
          activeSelectionRef.current.activeReasoningEffort
      ) {
        setActiveSelection(nextSelection)
      }
    },
    [setActiveSelection],
  )

  React.useEffect(() => {
    let cancelled = false
    const baseUrl = normalizeNullableString(session.providerOptions.baseUrl)

    if (!modelCatalog.capabilities.supportsModelDiscovery || !baseUrl) {
      setModelDiscovery((existing) => (existing === null ? existing : null))
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      const nextDiscovery = await discoverAssistantProviderModels({
        provider: session.provider,
        baseUrl,
        apiKeyEnv: session.providerOptions.apiKeyEnv,
        headers: session.providerOptions.headers ?? null,
        providerName: session.providerOptions.providerName,
      })

      if (cancelled) {
        return
      }

      setModelDiscovery((existing) =>
        assistantModelDiscoveryResultsEqual(existing, nextDiscovery)
          ? existing
          : nextDiscovery,
      )
    })()

    return () => {
      cancelled = true
    }
  }, [
    modelCatalog.capabilities.supportsModelDiscovery,
    session.provider,
    session.providerOptions.apiKeyEnv,
    session.providerOptions.baseUrl,
    session.providerOptions.headers,
    session.providerOptions.providerName,
  ])

  const queuePrompt = (prompt: string) => {
    updatePromptQueue({
      kind: 'enqueue',
      prompt,
    })
  }

  const applyQueuedPromptDisposition = (
    disposition: AssistantQueuedPromptDisposition,
    queuedPrompts: readonly string[],
  ): string | null => {
    if (disposition.kind === 'restore-composer') {
      updatePromptQueue({
        kind: 'clear',
      })
      if (queuedPrompts.length > 0) {
        setComposerValue((previous) =>
          mergeComposerDraftWithQueuedPrompts(previous, queuedPrompts),
        )
      }
      return null
    }

    if (disposition.kind === 'replay-next') {
      promptQueueStateRef.current = {
        prompts: disposition.remainingQueuedPrompts,
      }
      setPromptQueueState(promptQueueStateRef.current)
      return disposition.nextQueuedPrompt
    }

    return null
  }

  const editLastQueuedPrompt = () => {
    const lastQueuedPrompt = promptQueueStateRef.current.prompts.at(-1)

    if (!lastQueuedPrompt) {
      return
    }

    updatePromptQueue({
      kind: 'pop-last',
    })
    setComposerValue((previous) =>
      mergeComposerDraftWithQueuedPrompts(previous, [lastQueuedPrompt]),
    )
  }

  const startPromptTurn = (prompt: string) => {
    const transcriptSnapshot = buildAssistantTranscriptSnapshotFromInkEntries({
      entries: entriesRef.current,
      pendingPrompt: prompt,
    })
    setEntries((previous: InkChatEntry[]) => [
      ...previous,
      {
        kind: 'user',
        text: prompt,
      },
    ])
    setStatus(null)
    updateTurnState({
      kind: 'start',
    })

    const abortController = new AbortController()
    const turnTracePrefix = createAssistantTurnTracePrefix()
    activeTurnAbortControllerRef.current = abortController

    void (async () => {
      const activeSelection = activeSelectionRef.current
      const outcome = await runAssistantPromptTurn({
        activeModel: activeSelection.activeModel,
        activeReasoningEffort: activeSelection.activeReasoningEffort,
        input: {
          ...input.input,
          abortSignal: abortController.signal,
        },
        prompt,
        session: latestSessionRef.current,
        setEntries,
        setStatus,
        transcriptSnapshot,
        turnTracePrefix,
      })

      if (
        'session' in outcome &&
        outcome.session !== latestSessionRef.current
      ) {
        commitSession(outcome.session)
      }

      if (outcome.kind === 'completed') {
        latestTurnsRef.current += 1
        setEntries((previous: InkChatEntry[]) =>
          outcome.streamedAssistantEntryKey
            ? applyInkChatTraceUpdates(previous, [
                {
                  kind: 'assistant',
                  mode: 'replace',
                  streamKey: outcome.streamedAssistantEntryKey,
                  text: outcome.response,
                },
              ])
            : [
                ...previous,
                {
                  kind: 'assistant',
                  text: outcome.response,
                },
              ],
        )
        setStatus(
          outcome.delivery
            ? {
                kind: 'success',
                text: `Delivered over ${outcome.delivery.channel} to ${outcome.delivery.target}.`,
              }
            : outcome.deliveryError
              ? {
                  kind: 'error',
                  text: `Response saved locally, but delivery failed: ${outcome.deliveryError.message}`,
                }
              : null,
        )
      }

      if (outcome.kind === 'blocked') {
        const blockedTurnFeedback = resolveAssistantBlockedTurnFeedback(outcome.message)
        setEntries((previous: InkChatEntry[]) => [
          ...previous,
          blockedTurnFeedback.entry,
        ])
        setStatus(blockedTurnFeedback.status)
      }

      if (outcome.kind === 'failed') {
        if (outcome.recoveredSession) {
          commitSession(outcome.recoveredSession)
        }

        const queuedPrompts = promptQueueStateRef.current.prompts
        const queuedPromptDisposition = resolveAssistantQueuedPromptDisposition({
          pauseRequested: false,
          queuedPrompts,
          turnOutcome: 'failed',
        })
        applyQueuedPromptDisposition(queuedPromptDisposition, queuedPrompts)
        const errorPresentation = resolveAssistantTurnErrorPresentation({
          error: outcome.error,
          restoredQueuedPromptCount:
            queuedPromptDisposition.kind === 'restore-composer'
              ? queuedPromptDisposition.restoredQueuedPromptCount
              : 0,
        })
        setEntries((previous: InkChatEntry[]) => [
          ...previous,
          errorPresentation.entry,
        ])
        setStatus(errorPresentation.status)
        if (errorPresentation.persistTranscriptError) {
          void appendAssistantTranscriptEntries(
            input.input.vault,
            latestSessionRef.current.sessionId,
            [
              {
                kind: 'error',
                text: errorPresentation.entry.text,
              },
            ],
          ).catch(() => {})
        }
      }

      if (outcome.kind === 'interrupted' && outcome.recoveredSession) {
        commitSession(outcome.recoveredSession)
      }

      activeTurnAbortControllerRef.current = null
      setEntries((previous: InkChatEntry[]) =>
        finalizePendingInkChatTraces(previous, turnTracePrefix),
      )
      const pauseRequested = turnStateRef.current.pauseRequested
      updateTurnState({
        kind: 'finish',
      })

      if (outcome.kind === 'interrupted') {
        const queuedPrompts = promptQueueStateRef.current.prompts
        const queuedPromptDisposition = resolveAssistantQueuedPromptDisposition({
          pauseRequested,
          queuedPrompts,
          turnOutcome: 'interrupted',
        })
        applyQueuedPromptDisposition(queuedPromptDisposition, queuedPrompts)
        setStatus({
          kind: 'info',
          text:
            queuedPromptDisposition.kind === 'restore-composer' &&
            queuedPromptDisposition.restoredQueuedPromptCount > 0
              ? 'Paused current turn. Queued follow-ups are back in the composer.'
              : 'Paused current turn.',
        })
        return
      }

      const queuedPrompts = promptQueueStateRef.current.prompts
      const queuedPromptDisposition = resolveAssistantQueuedPromptDisposition({
        pauseRequested,
        queuedPrompts,
        turnOutcome: outcome.kind,
      })

      if (
        queuedPromptDisposition.kind === 'restore-composer' &&
        (outcome.kind === 'completed' || outcome.kind === 'blocked') &&
        pauseRequested
      ) {
        applyQueuedPromptDisposition(queuedPromptDisposition, queuedPrompts)
        setStatus({
          kind: 'info',
          text:
            queuedPromptDisposition.restoredQueuedPromptCount > 0
              ? 'Stopped after the current turn. Queued follow-ups are back in the composer.'
              : 'Stopped after the current turn.',
        })
        return
      }

      if (outcome.kind === 'completed' || outcome.kind === 'blocked') {
        const nextQueuedPrompt = applyQueuedPromptDisposition(
          queuedPromptDisposition,
          queuedPrompts,
        )
        if (nextQueuedPrompt) {
          queueMicrotask(() => {
            startPromptTurn(nextQueuedPrompt)
          })
        }
      }
    })()
  }

  const openModelSwitcher = () => {
    const reasoningOptions = resolveAssistantCatalogReasoningOptions(
      modelCatalog.models[findAssistantModelOptionIndex(activeModel, modelCatalog.modelOptions)],
    )
    setModelSwitcherState({
      models: modelCatalog.models,
      mode: 'model',
      modelIndex: findAssistantModelOptionIndex(
        activeModel,
        modelCatalog.modelOptions,
      ),
      reasoningIndex: findAssistantReasoningOptionIndex(
        activeReasoningEffort,
        reasoningOptions,
      ),
      modelOptions: modelCatalog.modelOptions,
      reasoningOptions,
    })
  }

  const moveModelSwitcherSelection = (delta: number) => {
    setModelSwitcherState((previous) => {
      if (!previous) {
        return previous
      }

      if (previous.mode === 'model') {
        const modelIndex = wrapPickerIndex(
          previous.modelIndex + delta,
          previous.modelOptions.length,
        )
        const reasoningOptions = resolveAssistantCatalogReasoningOptions(
          previous.models[modelIndex],
        )
        return {
          ...previous,
          modelIndex,
          reasoningIndex: findAssistantReasoningOptionIndex(
            activeReasoningEffort,
            reasoningOptions,
          ),
          reasoningOptions,
        }
      }

      return {
        ...previous,
        reasoningIndex: wrapPickerIndex(
          previous.reasoningIndex + delta,
          previous.reasoningOptions.length,
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

  const applyModelSwitcherSelection = (selection: ModelSwitcherState) => {
    const nextModel =
      selection.modelOptions[selection.modelIndex]?.value ??
      activeModel ??
      null
    const nextReasoningEffort =
      selection.reasoningOptions.length > 0
        ? selection.reasoningOptions[selection.reasoningIndex]?.value ??
          activeReasoningEffort ??
          'medium'
        : null
    const selectedLabel = [
      nextModel ?? 'the configured model',
      normalizeNullableString(nextReasoningEffort),
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')

    setActiveSelection({
      activeModel: nextModel,
      activeReasoningEffort: nextReasoningEffort,
    })
    setModelSwitcherState(null)
    setStatus({
      kind: 'info',
      text: `Using ${selectedLabel}.`,
    })

    void (async () => {
      try {
        const updatedSession = await updateAssistantSessionOptions({
          vault: input.input.vault,
          sessionId: latestSessionRef.current.sessionId,
          providerOptions: {
            model: nextModel,
            reasoningEffort: nextReasoningEffort,
          },
        })

        commitSession(updatedSession)

        await saveAssistantOperatorDefaultsPatch(
          buildAssistantProviderDefaultsPatch({
            defaults: input.defaults,
            provider: updatedSession.provider,
            providerConfig: {
              ...updatedSession.providerOptions,
              model: nextModel,
              reasoningEffort: nextReasoningEffort,
            },
          }),
        )
      } catch (error) {
        setStatus({
          kind: 'error',
          text:
            error instanceof Error && error.message.trim().length > 0
              ? `Using ${selectedLabel} for now, but failed to save it for later chats: ${error.message}`
              : `Using ${selectedLabel} for now, but failed to save it for later chats.`,
        })
      }
    })()
  }

  const confirmModelSwitcher = () => {
    if (!modelSwitcherState) {
      return
    }

    if (
      modelSwitcherState.mode === 'model' &&
      modelSwitcherState.reasoningOptions.length > 0
    ) {
      setModelSwitcherState({
        ...modelSwitcherState,
        mode: 'reasoning',
      })
      return
    }

    applyModelSwitcherSelection(modelSwitcherState)
  }

  const requestPause = () => {
    if (
      turnStateRef.current.phase !== 'running' ||
      modelSwitcherState ||
      turnStateRef.current.pauseRequested ||
      !activeTurnAbortControllerRef.current
    ) {
      return
    }

    updateTurnState({
      kind: 'request-pause',
    })
    setStatus({
      kind: 'info',
      text:
        promptQueueStateRef.current.prompts.length > 0
          ? 'Pausing current turn. Queued follow-ups will return to the composer.'
          : 'Pausing current turn...',
    })
    activeTurnAbortControllerRef.current.abort()
  }

  useInput(
    (_input: string, key: Key) => {
      if (!key.escape) {
        return
      }

      requestPause()
    },
    {
      isActive: turnState.phase === 'running' && modelSwitcherState === null,
    },
  )

  const submitPrompt = (
    rawValue: string,
    mode: ComposerSubmitMode,
  ): ComposerSubmitDisposition => {
    const action = resolveChatSubmitAction(rawValue, {
      busy: turnState.phase === 'running',
      trigger: mode,
    })

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

    if (action.kind === 'queue') {
      queuePrompt(action.prompt)
      return 'clear'
    }

    startPromptTurn(action.prompt)
    return shouldClearComposerForSubmitAction(action) ? 'clear' : 'keep'
  }

  React.useEffect(() => {
    if (bootstrappedRef.current) {
      return
    }

    bootstrappedRef.current = true
    if (initialPromptRef.current) {
      submitPrompt(initialPromptRef.current, 'enter')
    }
  }, [])

  const bindingSummary = formatSessionBinding(session)
  const metadataBadges = resolveChatMetadataBadges(
    {
      provider: session.provider,
      model: activeModel ?? session.providerOptions.model ?? input.codexDisplay.model,
      reasoningEffort: activeReasoningEffort ?? input.codexDisplay.reasoningEffort,
    },
    input.redactedVault,
  )

  return {
    activeModel,
    activeReasoningEffort,
    bindingSummary,
    busy: turnState.phase === 'running',
    cancelModelSwitcher,
    composerValue,
    confirmModelSwitcher,
    editLastQueuedPrompt,
    entries,
    lastQueuedPrompt: promptQueueState.prompts.at(-1) ?? null,
    latestSessionRef,
    latestTurnsRef,
    metadataBadges,
    modelSwitcherState,
    moveModelSwitcherSelection,
    queuedPromptCount: promptQueueState.prompts.length,
    session,
    setComposerValue,
    status,
    submitPrompt,
  }
}

export async function runAssistantChatWithInk(
  input: AssistantChatInput,
): Promise<AssistantChatResult> {
  const startedAt = new Date().toISOString()
  const defaults = await resolveAssistantOperatorDefaults()
  const themeBaseline = captureAssistantInkThemeBaseline()
  const resolved = await openAssistantConversation(input)
  const selectedProviderDefaults = resolveAssistantProviderDefaults(
    defaults,
    resolved.session.provider,
  )
  const transcriptEntries = await listAssistantTranscriptEntries(
    input.vault,
    resolved.session.sessionId,
  )
  const redactedVault = redactAssistantDisplayPath(input.vault)
  const codexDisplay = await resolveCodexDisplayOptions({
    model:
      input.model ??
      selectedProviderDefaults?.model ??
      resolved.session.providerOptions.model,
    profile:
      input.profile ??
      selectedProviderDefaults?.profile ??
      resolved.session.providerOptions.profile,
  })
  const inkInput = resolveAssistantInkInputAdapter()

  if (!inkInput.stdin) {
    throw new Error(
      'Murph chat requires interactive terminal input. process.stdin does not support raw mode, and Murph could not open the controlling terminal for Ink input.',
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
      const [theme, setTheme] = React.useState(() => themeBaseline.theme)
      const controller = useAssistantChatController({
        codexDisplay,
        defaults,
        input,
        redactedVault,
        resolvedSession: resolved.session,
        selectedProviderDefaults,
        transcriptEntries,
      })

      React.useEffect(() => {
        if (process.platform !== 'darwin') {
          return undefined
        }

        const refreshTimer = setInterval(() => {
          setTheme((currentTheme) => {
            const nextTheme = resolveAssistantInkThemeForOpenChat({
              currentMode: currentTheme.mode,
              initialAppleInterfaceStyle: themeBaseline.initialAppleInterfaceStyle,
              initialColorFgbg: themeBaseline.initialColorFgbg,
            })

            return nextTheme.mode === currentTheme.mode
              ? currentTheme
              : nextTheme
          })
        }, ASSISTANT_INK_THEME_REFRESH_INTERVAL_MS)

        return () => {
          clearInterval(refreshTimer)
        }
      }, [])

      React.useEffect(
        () => () => {
          resolveOnce(
            assistantChatResultSchema.parse({
              vault: redactedVault,
              startedAt,
              stoppedAt: new Date().toISOString(),
              turns: controller.latestTurnsRef.current,
              session: redactAssistantSessionForDisplay(controller.latestSessionRef.current),
            }),
          )
        },
        [],
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
              paddingX: ASSISTANT_CHAT_VIEW_PADDING_X,
              paddingY: 1,
              width: '100%',
            },
            createElement(ChatTranscriptFeed, {
              bindingSummary: controller.bindingSummary,
              busy: controller.busy,
              entries: controller.entries,
              sessionId: controller.session.sessionId,
            }),
            createElement(
              Box,
              {
                flexDirection: 'column',
                width: '100%',
              },
              createElement(ChatStatus, {
                busy: shouldShowBusyStatus({
                  busy: controller.busy,
                  entries: controller.entries,
                }),
                status: controller.status,
              }),
              createElement(QueuedFollowUpStatus, {
                latestPrompt: controller.lastQueuedPrompt,
                queuedPromptCount: controller.queuedPromptCount,
              }),
              controller.modelSwitcherState
                ? createElement(ModelSwitcher, {
                    currentModel: controller.activeModel,
                    currentReasoningEffort: controller.activeReasoningEffort,
                    mode: controller.modelSwitcherState.mode,
                    modelIndex: controller.modelSwitcherState.modelIndex,
                    modelOptions: controller.modelSwitcherState.modelOptions,
                    onCancel: controller.cancelModelSwitcher,
                    onConfirm: controller.confirmModelSwitcher,
                    onMove: controller.moveModelSwitcherSelection,
                    reasoningIndex: controller.modelSwitcherState.reasoningIndex,
                    reasoningOptions: controller.modelSwitcherState.reasoningOptions,
                  })
                : null,
              createElement(ChatComposer, {
                entryCount: controller.entries.length,
                modelSwitcherActive: controller.modelSwitcherState !== null,
                onChange: controller.setComposerValue,
                onEditLastQueuedPrompt: controller.editLastQueuedPrompt,
                onSubmit: controller.submitPrompt,
                value: controller.composerValue,
              }),
              createElement(ChatFooter, {
                badges: controller.metadataBadges,
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

function isAssistantCanonicalWriteBlockedError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code ===
        'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED',
  )
}
