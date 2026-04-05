import type { AssistantSession } from '@murphai/assistant-core/assistant-cli-contracts'
import { normalizeNullableString } from '@murphai/assistant-core/assistant-runtime'

export interface AssistantPromptQueueState {
  prompts: readonly string[]
}

export type AssistantPromptQueueAction =
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

export interface AssistantTurnState {
  pauseRequested: boolean
  phase: 'idle' | 'running'
}

export interface AssistantTurnSelection {
  activeModel: string | null
  activeReasoningEffort: string | null
}

export type AssistantTurnAction =
  | {
      kind: 'finish'
    }
  | {
      kind: 'request-pause'
    }
  | {
      kind: 'start'
    }

export type AssistantPromptTurnOutcomeKind =
  | 'completed'
  | 'failed'
  | 'interrupted'

export type AssistantQueuedPromptDisposition =
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

export const EMPTY_ASSISTANT_PROMPT_QUEUE_STATE: AssistantPromptQueueState = {
  prompts: [],
}

export const IDLE_ASSISTANT_TURN_STATE: AssistantTurnState = {
  pauseRequested: false,
  phase: 'idle',
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

export function resolveAssistantQueuedPromptDisposition(input: {
  pauseRequested: boolean
  queuedPrompts: readonly string[]
  turnOutcome: AssistantPromptTurnOutcomeKind
}): AssistantQueuedPromptDisposition {
  if (
    input.turnOutcome === 'failed' ||
    input.turnOutcome === 'interrupted' ||
    (input.pauseRequested && input.turnOutcome === 'completed')
  ) {
    return {
      kind: 'restore-composer',
      restoredQueuedPromptCount: input.queuedPrompts.length,
    }
  }

  if (input.turnOutcome === 'completed' && input.queuedPrompts.length > 0) {
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

export function normalizeAssistantTurnSelection(
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
