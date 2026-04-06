import * as React from 'react'
import { useApp } from 'ink'
import { type AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { resolveCodexDisplayOptions } from '@murphai/assistant-engine/assistant-codex'
import {
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
} from '@murphai/operator-config/operator-config'
import { normalizeNullableString } from '@murphai/assistant-engine/assistant-runtime'
import { type AssistantChatInput } from '../service.js'
import { listAssistantTranscriptEntries } from '../store.js'
import {
  applyInkChatTraceUpdates,
  formatSessionBinding,
  resolveChatMetadataBadges,
  resolveChatSubmitAction,
  shouldClearComposerForSubmitAction,
  type ChatMetadataBadge,
  type InkChatEntry,
  seedChatEntries,
} from './view-model.js'
import {
  mergeComposerDraftWithQueuedPrompts,
  type ComposerSubmitMode,
} from './composer-editor.js'
import {
  createModelSwitcherState,
  dismissModelSwitcher,
  offsetModelSwitcherSelection,
  resolveModelSwitcherSelection,
  type ModelSwitcherState,
} from './model-switcher.js'
import {
  EMPTY_ASSISTANT_PROMPT_QUEUE_STATE,
  IDLE_ASSISTANT_TURN_STATE,
  normalizeAssistantTurnSelection,
  reduceAssistantPromptQueueState,
  reduceAssistantTurnState,
  resolveAssistantQueuedPromptDisposition,
  resolveAssistantSelectionAfterSessionSync,
  type AssistantPromptQueueAction,
  type AssistantPromptQueueState,
  type AssistantQueuedPromptDisposition,
  type AssistantTurnAction,
  type AssistantTurnSelection,
  type AssistantTurnState,
} from './chat-controller-state.js'
import {
  createAssistantTurnTracePrefix,
  finalizeAssistantTurnTraces,
  persistAssistantTurnError,
  resolveAssistantTurnErrorPresentation,
  runAssistantPromptTurn,
  type AssistantChatStatus,
} from './chat-controller-runtime.js'
import {
  persistAssistantModelSelection,
  resolveInitialAssistantSelection,
  useAssistantModelCatalogState,
} from './chat-controller-models.js'
import { useAssistantPauseShortcut } from './chat-controller-pause.js'
export {
  resolveAssistantTurnErrorPresentation,
  runAssistantPromptTurn,
} from './chat-controller-runtime.js'
export type {
  AssistantChatStatus,
  AssistantPromptTurnOutcome,
} from './chat-controller-runtime.js'
export interface UseAssistantChatControllerInput {
  codexDisplay: Awaited<ReturnType<typeof resolveCodexDisplayOptions>>
  defaults: Awaited<ReturnType<typeof resolveAssistantOperatorDefaults>>
  input: AssistantChatInput
  redactedVault: string
  resolvedSession: AssistantSession
  selectedProviderDefaults: ReturnType<typeof resolveAssistantProviderDefaults>
  transcriptEntries: Awaited<ReturnType<typeof listAssistantTranscriptEntries>>
}

export interface AssistantChatController {
  activeModel: string | null
  activeReasoningEffort: string | null
  bindingSummary: string | null
  busy: boolean
  cancelModelSwitcher: () => void
  composerValue: string
  confirmModelSwitcher: () => void
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
  submitPrompt: (rawValue: string, mode: ComposerSubmitMode) => 'clear' | 'keep'
}
export function useAssistantChatController(
  input: UseAssistantChatControllerInput,
): AssistantChatController {
  const { exit } = useApp()
  const [session, setSession] = React.useState(input.resolvedSession)
  const [entries, setEntries] = React.useState(seedChatEntries(input.transcriptEntries))
  const [status, setStatus] = React.useState<AssistantChatStatus | null>(null)
  const [composerValue, setComposerValue] = React.useState('')
  const { initialActiveModel, initialActiveReasoningEffort } =
    resolveInitialAssistantSelection({
      codexDisplay: input.codexDisplay,
      input: input.input,
      resolvedSession: input.resolvedSession,
      selectedProviderDefaults: input.selectedProviderDefaults,
    })
  const [activeModel, setActiveModel] = React.useState<string | null>(
    initialActiveModel,
  )
  const [activeReasoningEffort, setActiveReasoningEffort] = React.useState<string | null>(
    initialActiveReasoningEffort,
  )
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
  const modelCatalog = useAssistantModelCatalogState({
    activeModel,
    activeReasoningEffort,
    session,
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
        turnTracePrefix,
      })

      if ('session' in outcome && outcome.session !== latestSessionRef.current) {
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
          void persistAssistantTurnError({
            errorText: errorPresentation.entry.text,
            sessionId: latestSessionRef.current.sessionId,
            vault: input.input.vault,
          }).catch(() => {})
        }
      }

      if (outcome.kind === 'interrupted' && outcome.recoveredSession) {
        commitSession(outcome.recoveredSession)
      }

      activeTurnAbortControllerRef.current = null
      setEntries((previous: InkChatEntry[]) =>
        finalizeAssistantTurnTraces(previous, turnTracePrefix),
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
        outcome.kind === 'completed' &&
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

      if (outcome.kind === 'completed') {
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
    setModelSwitcherState(
      createModelSwitcherState({
        activeModel,
        activeReasoningEffort,
        models: modelCatalog.models,
        modelOptions: modelCatalog.modelOptions,
      }),
    )
  }

  const moveModelSwitcherSelection = (delta: number) => {
    setModelSwitcherState((previous) =>
      previous
        ? offsetModelSwitcherSelection({
            activeReasoningEffort,
            delta,
            state: previous,
          })
        : previous,
    )
  }

  const cancelModelSwitcher = () => {
    setModelSwitcherState((previous) =>
      previous ? dismissModelSwitcher(previous) : previous,
    )
  }

  const applyModelSwitcherSelection = (selection: ModelSwitcherState) => {
    const { nextModel, nextReasoningEffort, selectedLabel } =
      resolveModelSwitcherSelection({
        activeModel,
        activeReasoningEffort,
        selection,
      })

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
        const updatedSession = await persistAssistantModelSelection({
          defaults: input.defaults,
          nextModel,
          nextReasoningEffort,
          session: latestSessionRef.current,
          vault: input.input.vault,
        })

        commitSession(updatedSession)
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

  useAssistantPauseShortcut({
    activeTurnAbortControllerRef,
    modelSwitcherState,
    promptQueueStateRef,
    setStatus,
    turnState,
    turnStateRef,
    updateTurnState,
  })

  const submitPrompt = (rawValue: string, mode: ComposerSubmitMode): 'clear' | 'keep' => {
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
      baseUrl: session.providerOptions.baseUrl,
      provider: session.provider,
      model: activeModel ?? session.providerOptions.model ?? input.codexDisplay.model,
      reasoningEffort: activeReasoningEffort,
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
