import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantTurnEnvironment } from '../service-contracts.js'

export interface AssistantAutomationOperationScope {
  runAutoReplyGroup<T>(input: {
    executionContext: AssistantExecutionContext
    inputIds: readonly string[]
    operation(
      executionContext: AssistantExecutionContext,
      turnEnvironment: AssistantTurnEnvironment | null,
    ): Promise<T>
    turnEnvironment: AssistantTurnEnvironment | null
  }): Promise<T>
}
