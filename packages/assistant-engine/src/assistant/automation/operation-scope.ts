import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantProviderStartCriticalPathContext } from '../provider-start-critical-path.js'
import type { AssistantTurnEnvironment } from '../service-contracts.js'

export interface AssistantAutomationOperationScope {
  runAutoReplyGroup<T>(input: {
    executionContext: AssistantExecutionContext
    inputIds: readonly string[]
    operation(
      executionContext: AssistantExecutionContext,
      turnEnvironment: AssistantTurnEnvironment | null,
      providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null,
    ): Promise<T>
    providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null
    turnEnvironment: AssistantTurnEnvironment | null
  }): Promise<T>
}
