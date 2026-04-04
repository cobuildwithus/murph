import * as React from 'react'
import { useInput, type Key } from 'ink'

import type { ModelSwitcherState } from './model-switcher.js'
import type {
  AssistantTurnAction,
  AssistantTurnState,
  AssistantPromptQueueState,
} from './chat-controller-state.js'
import type { AssistantChatStatus } from './chat-controller-runtime.js'

export function useAssistantPauseShortcut(input: {
  activeTurnAbortControllerRef: React.MutableRefObject<AbortController | null>
  modelSwitcherState: ModelSwitcherState | null
  promptQueueStateRef: React.MutableRefObject<AssistantPromptQueueState>
  setStatus: React.Dispatch<React.SetStateAction<AssistantChatStatus | null>>
  turnState: AssistantTurnState
  turnStateRef: React.MutableRefObject<AssistantTurnState>
  updateTurnState: (action: AssistantTurnAction) => AssistantTurnState
}): void {
  const requestPause = React.useCallback(() => {
    if (
      input.turnStateRef.current.phase !== 'running' ||
      input.modelSwitcherState ||
      input.turnStateRef.current.pauseRequested ||
      !input.activeTurnAbortControllerRef.current
    ) {
      return
    }

    input.updateTurnState({
      kind: 'request-pause',
    })
    input.setStatus({
      kind: 'info',
      text:
        input.promptQueueStateRef.current.prompts.length > 0
          ? 'Pausing current turn. Queued follow-ups will return to the composer.'
          : 'Pausing current turn...',
    })
    input.activeTurnAbortControllerRef.current.abort()
  }, [
    input.activeTurnAbortControllerRef,
    input.modelSwitcherState,
    input.promptQueueStateRef,
    input.setStatus,
    input.turnStateRef,
    input.updateTurnState,
  ])

  useInput(
    (_input: string, key: Key) => {
      if (!key.escape) {
        return
      }

      requestPause()
    },
    {
      isActive: input.turnState.phase === 'running' && input.modelSwitcherState === null,
    },
  )
}
