import type { AssistantCronTarget } from '@murphai/operator-config/assistant-cli-contracts'
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
  runCronJob<T>(input: {
    executionContext: AssistantExecutionContext
    operation(
      executionContext: AssistantExecutionContext,
      turnEnvironment: AssistantTurnEnvironment | null,
    ): Promise<T>
    target: AssistantCronTarget
    turnEnvironment: AssistantTurnEnvironment | null
  }): Promise<T>
}
