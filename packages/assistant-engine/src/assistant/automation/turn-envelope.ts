import type { AssistantTurnTrigger } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type {
  AssistantMessageInput,
  AssistantTurnEnvironment,
} from '../service-contracts.js'

export type AssistantAutomationTurnEnvelope = Pick<
  AssistantMessageInput,
  | 'abortSignal'
  | 'deliveryDispatchMode'
  | 'executionContext'
  | 'turnEnvironment'
  | 'turnTrigger'
>

export function buildAssistantAutomationTurnEnvelope(input: {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  signal?: AbortSignal
  turnEnvironment?: AssistantTurnEnvironment | null
  turnTrigger: AssistantTurnTrigger
}): AssistantAutomationTurnEnvelope {
  return {
    abortSignal: input.signal,
    deliveryDispatchMode: input.deliveryDispatchMode,
    executionContext: input.executionContext,
    turnEnvironment: input.turnEnvironment ?? null,
    turnTrigger: input.turnTrigger,
  }
}
