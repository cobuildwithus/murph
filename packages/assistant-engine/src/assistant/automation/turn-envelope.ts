import type { AutomationAssistantTargetOverride } from '@murphai/contracts'
import type { AssistantTurnTrigger } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderServiceTier } from '../providers/types.js'
import type {
  AssistantMessageInput,
  AssistantTurnEnvironment,
} from '../service-contracts.js'
import {
  compactAutomationAssistantTargetOverride,
} from './target-override.js'

export type AssistantAutomationTurnEnvelope = Omit<
  Pick<
    AssistantMessageInput,
    | 'abortSignal'
    | 'assistantTargetOverride'
    | 'deliveryDispatchMode'
    | 'executionContext'
    | 'scheduledAutomationAuthority'
    | 'scheduledInvocationAuthority'
    | 'scheduledOccurrenceAt'
    | 'serviceTier'
    | 'turnEnvironment'
    | 'turnTrigger'
  >,
  'executionContext'
> & {
  executionContext: AssistantExecutionContext
}

export function buildAssistantAutomationTurnEnvelope(input: {
  assistantTargetOverride?: AutomationAssistantTargetOverride | null
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  scheduledAutomationAuthority?: AssistantMessageInput['scheduledAutomationAuthority']
  scheduledInvocationAuthority?: AssistantMessageInput['scheduledInvocationAuthority']
  scheduledOccurrenceAt?: string | null
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
    executionContext: input.executionContext ?? { hosted: null },
    scheduledAutomationAuthority: input.scheduledAutomationAuthority ?? null,
    scheduledInvocationAuthority: input.scheduledInvocationAuthority ?? null,
    scheduledOccurrenceAt: input.scheduledOccurrenceAt ?? null,
    serviceTier: input.serviceTier ?? null,
    turnEnvironment: input.turnEnvironment ?? null,
    turnTrigger: input.turnTrigger,
  }
}
