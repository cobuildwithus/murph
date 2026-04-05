import fs from 'node:fs'
import tty from 'node:tty'
import * as React from 'react'
import { Box, render } from 'ink'
import {
  assistantChatResultSchema,
} from '@murphai/assistant-core/assistant-cli-contracts'
import { resolveCodexDisplayOptions } from '@murphai/assistant-core/assistant-codex'
import {
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
} from '@murphai/assistant-core/operator-config'
import {
  redactAssistantSessionForDisplay,
} from '@murphai/assistant-core/assistant-runtime'

import {
  openAssistantConversation,
  type AssistantChatInput,
} from '../service.js'
import {
  listAssistantTranscriptEntries,
  redactAssistantDisplayPath,
} from '../store.js'
import {
  ChatComposer,
  ChatFooter,
  ChatStatus,
  QueuedFollowUpStatus,
} from './ink-composer-panel.js'
import {
  ASSISTANT_CHAT_VIEW_PADDING_X,
  AssistantInkThemeContext,
} from './ink-layout.js'
import {
  ChatTranscriptFeed,
  shouldShowBusyStatus,
} from './ink-transcript.js'
import {
  captureAssistantInkThemeBaseline,
  resolveAssistantInkThemeForOpenChat,
} from './theme.js'
import { ModelSwitcher } from './model-switcher.js'
import { useAssistantChatController } from './chat-controller.js'

export {
  applyComposerEditingInput,
  formatQueuedFollowUpPreview,
  mergeComposerDraftWithQueuedPrompts,
  normalizeAssistantInkArrowKey,
  normalizeComposerInsertedText,
  reconcileComposerControlledValue,
  renderComposerValue,
  resolveComposerTerminalAction,
  resolveComposerVerticalCursorMove,
} from './composer-editor.js'
export {
  reduceAssistantPromptQueueState,
  reduceAssistantTurnState,
  resolveAssistantQueuedPromptDisposition,
  resolveAssistantSelectionAfterSessionSync,
} from './chat-controller-state.js'
export {
  resolveAssistantTurnErrorPresentation,
  runAssistantPromptTurn,
} from './chat-controller.js'
export {
  formatFooterBadgeText,
  renderWrappedPlainTextBlock,
  renderWrappedTextBlock,
  resolveAssistantChatViewportWidth,
  resolveAssistantPlainTextWrapColumns,
  resolveChromePanelBoxProps,
  wrapAssistantPlainText,
} from './ink-layout.js'
export {
  formatAssistantTerminalHyperlink,
  renderAssistantMessageText,
  resolveAssistantHyperlinkTarget,
  resolveMessageRoleLabel,
  splitAssistantMarkdownLinks,
  supportsAssistantTerminalHyperlinks,
} from './ink-message-text.js'
export {
  partitionChatTranscriptEntries,
  renderChatTranscriptFeed,
  shouldShowBusyStatus,
} from './ink-transcript.js'
export type { ComposerSubmitMode } from './composer-editor.js'

type AssistantChatResult = ReturnType<typeof assistantChatResultSchema.parse>

const ASSISTANT_INK_THEME_REFRESH_INTERVAL_MS = 2_000
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

      return React.createElement(
        AssistantInkThemeContext.Provider,
        {
          value: theme,
        },
        React.createElement(
          Box,
          {
            flexDirection: 'column',
            paddingX: ASSISTANT_CHAT_VIEW_PADDING_X,
            paddingY: 1,
            width: '100%',
          },
          React.createElement(ChatTranscriptFeed, {
            bindingSummary: controller.bindingSummary,
            busy: controller.busy,
            entries: controller.entries,
            sessionId: controller.session.sessionId,
          }),
          React.createElement(
            Box,
            {
              flexDirection: 'column',
              width: '100%',
            },
            React.createElement(ChatStatus, {
              busy: shouldShowBusyStatus({
                busy: controller.busy,
                entries: controller.entries,
              }),
              status: controller.status,
            }),
            React.createElement(QueuedFollowUpStatus, {
              latestPrompt: controller.lastQueuedPrompt,
              queuedPromptCount: controller.queuedPromptCount,
            }),
            controller.modelSwitcherState
              ? React.createElement(ModelSwitcher, {
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
                  theme,
                })
              : null,
            React.createElement(ChatComposer, {
              entryCount: controller.entries.length,
              modelSwitcherActive: controller.modelSwitcherState !== null,
              onChange: controller.setComposerValue,
              onEditLastQueuedPrompt: controller.editLastQueuedPrompt,
              onSubmit: controller.submitPrompt,
              value: controller.composerValue,
            }),
            React.createElement(ChatFooter, {
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
