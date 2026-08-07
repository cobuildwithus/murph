import { performance } from 'node:perf_hooks'

export interface AssistantProviderStartCriticalPathContext {
  readonly assistantPhaseStartedAtMonotonicMs?: number
  readonly assistantServiceStartedAtMonotonicMs?: number
  readonly assistantTurnLockAcquiredAtMonotonicMs?: number
  readonly assistantTurnLockWaitStartedAtMonotonicMs?: number
  readonly automationLaneStartedAtMonotonicMs?: number
  readonly codexAppServerProcessTurnStartedAtMonotonicMs?: number
  readonly codexAppServerTurnStartedAtMonotonicMs?: number
  readonly mailboxImportDoneAtMonotonicMs: number
  readonly preProviderSetupDoneAtMonotonicMs?: number
}

export type AssistantProviderStartCriticalPathBoundary =
  | 'assistantPhaseStartedAtMonotonicMs'
  | 'assistantServiceStartedAtMonotonicMs'
  | 'assistantTurnLockAcquiredAtMonotonicMs'
  | 'assistantTurnLockWaitStartedAtMonotonicMs'
  | 'automationLaneStartedAtMonotonicMs'
  | 'codexAppServerProcessTurnStartedAtMonotonicMs'
  | 'codexAppServerTurnStartedAtMonotonicMs'
  | 'preProviderSetupDoneAtMonotonicMs'

export interface AssistantProviderStartCriticalPathTiming {
  assistantServicePreLockMs: number
  automationLaneToAssistantServiceMs: number
  codexAppServerPreProviderMs: number
  codexProcessPreparationMs: number
  mailboxImportDoneToAssistantPhaseMs: number
  preProviderSetupMs: number
  providerPlanAndGateMs: number
  turnLockWaitMs: number
  workspaceAssistantPreAutomationMs: number
}

export function readAssistantProviderStartMonotonicTickMs(): number {
  return Math.floor(performance.now())
}

export function createAssistantProviderStartCriticalPathContext(
  atMonotonicMs = readAssistantProviderStartMonotonicTickMs(),
): AssistantProviderStartCriticalPathContext {
  return {
    mailboxImportDoneAtMonotonicMs: atMonotonicMs,
  }
}

export function stampAssistantProviderStartCriticalPath(
  context: AssistantProviderStartCriticalPathContext | null | undefined,
  boundary: AssistantProviderStartCriticalPathBoundary,
  atMonotonicMs = readAssistantProviderStartMonotonicTickMs(),
): AssistantProviderStartCriticalPathContext | null {
  if (!context) {
    return null
  }

  return {
    ...context,
    [boundary]: atMonotonicMs,
  }
}

export function completeAssistantProviderStartCriticalPath(
  context: AssistantProviderStartCriticalPathContext | null | undefined,
  providerStartedAtMonotonicMs = readAssistantProviderStartMonotonicTickMs(),
): AssistantProviderStartCriticalPathTiming | null {
  if (!context) {
    return null
  }

  const boundaries = [
    context.mailboxImportDoneAtMonotonicMs,
    context.assistantPhaseStartedAtMonotonicMs,
    context.automationLaneStartedAtMonotonicMs,
    context.assistantServiceStartedAtMonotonicMs,
    context.assistantTurnLockWaitStartedAtMonotonicMs,
    context.assistantTurnLockAcquiredAtMonotonicMs,
    context.preProviderSetupDoneAtMonotonicMs,
    context.codexAppServerTurnStartedAtMonotonicMs,
    context.codexAppServerProcessTurnStartedAtMonotonicMs,
    providerStartedAtMonotonicMs,
  ]
  let previousBoundary: number | null = null
  for (const boundary of boundaries) {
    if (
      typeof boundary !== 'number'
      || !Number.isSafeInteger(boundary)
      || boundary < 0
      || (previousBoundary !== null && boundary < previousBoundary)
    ) {
      return null
    }
    previousBoundary = boundary
  }

  const [
    mailboxImportDone,
    assistantPhaseStarted,
    automationLaneStarted,
    assistantServiceStarted,
    turnLockWaitStarted,
    turnLockAcquired,
    preProviderSetupDone,
    codexAppServerTurnStarted,
    codexAppServerProcessTurnStarted,
    providerStarted,
  ] = boundaries as [number, number, number, number, number, number, number, number, number, number]

  return {
    mailboxImportDoneToAssistantPhaseMs:
      assistantPhaseStarted - mailboxImportDone,
    workspaceAssistantPreAutomationMs:
      automationLaneStarted - assistantPhaseStarted,
    automationLaneToAssistantServiceMs:
      assistantServiceStarted - automationLaneStarted,
    assistantServicePreLockMs:
      turnLockWaitStarted - assistantServiceStarted,
    turnLockWaitMs: turnLockAcquired - turnLockWaitStarted,
    preProviderSetupMs: preProviderSetupDone - turnLockAcquired,
    providerPlanAndGateMs:
      codexAppServerTurnStarted - preProviderSetupDone,
    codexProcessPreparationMs:
      codexAppServerProcessTurnStarted - codexAppServerTurnStarted,
    codexAppServerPreProviderMs:
      providerStarted - codexAppServerProcessTurnStarted,
  }
}
