import type { AutomationAssistantTargetOverride } from '@murphai/contracts'
import type { AssistantTurnTrigger } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderServiceTier } from '../providers/types.js'
import type {
  AssistantMessageInput,
  AssistantTurnEnvironment,
} from '../service-contracts.js'
import type { AssistantScheduledTaskAuthority } from '../scheduled-task-authority.js'
import {
  compactAutomationAssistantTargetOverride,
} from './target-override.js'

export type AssistantAutomationTurnEnvelope = Pick<
  AssistantMessageInput,
  | 'abortSignal'
  | 'assistantTargetOverride'
  | 'deliveryDispatchMode'
  | 'executionContext'
  | 'scheduledOccurrenceAt'
  | 'scheduledTaskAuthority'
  | 'serviceTier'
  | 'turnEnvironment'
  | 'turnTrigger'
>

export function buildAssistantAutomationTurnEnvelope(input: {
  assistantTargetOverride?: AutomationAssistantTargetOverride | null
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  scheduledOccurrenceAt?: string | null
  scheduledTaskAuthority?: AssistantScheduledTaskAuthority | null
  serviceTier?: AssistantProviderServiceTier | null
  signal?: AbortSignal
  turnEnvironment?: AssistantTurnEnvironment | null
  turnTrigger: AssistantTurnTrigger
}): AssistantAutomationTurnEnvelope {
  const targetOverride = compactAutomationAssistantTargetOverride(
    input.assistantTargetOverride,
  )

  return {
    abortSignal: input.signal,
    ...(targetOverride ? { assistantTargetOverride: targetOverride } : {}),
    deliveryDispatchMode: input.deliveryDispatchMode,
    executionContext: input.executionContext,
    scheduledOccurrenceAt: input.scheduledOccurrenceAt ?? null,
    scheduledTaskAuthority: input.scheduledTaskAuthority ?? { kind: 'none' },
    serviceTier: input.serviceTier ?? null,
    turnEnvironment: input.turnEnvironment ?? null,
    turnTrigger: input.turnTrigger,
  }
}
