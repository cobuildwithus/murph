import { performance } from 'node:perf_hooks'

export interface AssistantProviderStartCriticalPathContext {
  readonly assistantPhaseCallbackStartedAtMonotonicMs?: number
  readonly assistantPhaseStartedAtMonotonicMs?: number
  readonly assistantServiceStartedAtMonotonicMs?: number
  readonly assistantTurnLockAcquiredAtMonotonicMs?: number
  readonly assistantTurnLockWaitStartedAtMonotonicMs?: number
  readonly automationLaneSubdivisionEligible?: false
  readonly automationCandidateScanDoneAtMonotonicMs?: number
  readonly automationCrossSessionContextDoneAtMonotonicMs?: number
  readonly automationGroupAndOperationScopeDoneAtMonotonicMs?: number
  readonly automationInputSelectionDoneAtMonotonicMs?: number
  readonly automationLaneStartedAtMonotonicMs?: number
  readonly automationPassSetupDoneAtMonotonicMs?: number
  readonly automationPromptPreparationDoneAtMonotonicMs?: number
  readonly automationReadinessDoneAtMonotonicMs?: number
  readonly automationSessionPreflightDoneAtMonotonicMs?: number
  readonly automationTerminalEvidenceDoneAtMonotonicMs?: number
  readonly codexAppServerProcessTurnStartedAtMonotonicMs?: number
  readonly codexAppServerTurnStartedAtMonotonicMs?: number
  readonly foregroundPassStartedAtMonotonicMs?: number
  readonly mailboxImportDoneAtMonotonicMs: number
  readonly preProviderSetupDoneAtMonotonicMs?: number
  readonly workspaceForegroundPassStartedAtMonotonicMs?: number
}

export type AssistantProviderStartCriticalPathBoundary =
  | 'assistantPhaseCallbackStartedAtMonotonicMs'
  | 'assistantPhaseStartedAtMonotonicMs'
  | 'assistantServiceStartedAtMonotonicMs'
  | 'assistantTurnLockAcquiredAtMonotonicMs'
  | 'assistantTurnLockWaitStartedAtMonotonicMs'
  | 'automationCandidateScanDoneAtMonotonicMs'
  | 'automationCrossSessionContextDoneAtMonotonicMs'
  | 'automationGroupAndOperationScopeDoneAtMonotonicMs'
  | 'automationInputSelectionDoneAtMonotonicMs'
  | 'automationLaneStartedAtMonotonicMs'
  | 'automationPassSetupDoneAtMonotonicMs'
  | 'automationPromptPreparationDoneAtMonotonicMs'
  | 'automationReadinessDoneAtMonotonicMs'
  | 'automationSessionPreflightDoneAtMonotonicMs'
  | 'automationTerminalEvidenceDoneAtMonotonicMs'
  | 'codexAppServerProcessTurnStartedAtMonotonicMs'
  | 'codexAppServerTurnStartedAtMonotonicMs'
  | 'foregroundPassStartedAtMonotonicMs'
  | 'preProviderSetupDoneAtMonotonicMs'
  | 'workspaceForegroundPassStartedAtMonotonicMs'

export interface AssistantProviderStartCriticalPathTiming {
  assistantServicePreLockMs: number
  automationCandidateScanMs?: number
  automationCrossSessionContextMs?: number
  automationGroupAndOperationScopeMs?: number
  automationInputSelectionMs?: number
  automationLaneToAssistantServiceMs: number
  automationPassSetupMs?: number
  automationPromptPreparationMs?: number
  automationReadinessMs?: number
  automationServiceHandoffMs?: number
  automationSessionPreflightMs?: number
  automationTerminalEvidenceMs?: number
  assistantPhaseCallbackToAssistantPhaseMs?: number
  codexAppServerPreProviderMs: number
  codexProcessPreparationMs: number
  foregroundPassToWorkspaceForegroundPassMs?: number
  mailboxImportDoneToForegroundPassMs?: number
  mailboxImportDoneToAssistantPhaseMs: number
  preProviderSetupMs: number
  providerPlanAndGateMs: number
  turnLockWaitMs: number
  workspaceForegroundPassToAssistantPhaseCallbackMs?: number
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

  const automationLaneTiming = completeAssistantAutomationLaneTiming(context)
  const mailboxImportDoneToAssistantPhaseTiming =
    completeMailboxImportDoneToAssistantPhaseTiming(context)

  return {
    mailboxImportDoneToAssistantPhaseMs:
      assistantPhaseStarted - mailboxImportDone,
    ...(mailboxImportDoneToAssistantPhaseTiming ?? {}),
    workspaceAssistantPreAutomationMs:
      automationLaneStarted - assistantPhaseStarted,
    automationLaneToAssistantServiceMs:
      assistantServiceStarted - automationLaneStarted,
    ...(automationLaneTiming ?? {}),
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

function completeMailboxImportDoneToAssistantPhaseTiming(
  context: AssistantProviderStartCriticalPathContext,
): Pick<
  AssistantProviderStartCriticalPathTiming,
  | 'assistantPhaseCallbackToAssistantPhaseMs'
  | 'foregroundPassToWorkspaceForegroundPassMs'
  | 'mailboxImportDoneToForegroundPassMs'
  | 'workspaceForegroundPassToAssistantPhaseCallbackMs'
> | null {
  const boundaries = [
    context.mailboxImportDoneAtMonotonicMs,
    context.foregroundPassStartedAtMonotonicMs,
    context.workspaceForegroundPassStartedAtMonotonicMs,
    context.assistantPhaseCallbackStartedAtMonotonicMs,
    context.assistantPhaseStartedAtMonotonicMs,
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
    foregroundPassStarted,
    workspaceForegroundPassStarted,
    assistantPhaseCallbackStarted,
    assistantPhaseStarted,
  ] = boundaries as [number, number, number, number, number]

  return {
    mailboxImportDoneToForegroundPassMs:
      foregroundPassStarted - mailboxImportDone,
    foregroundPassToWorkspaceForegroundPassMs:
      workspaceForegroundPassStarted - foregroundPassStarted,
    workspaceForegroundPassToAssistantPhaseCallbackMs:
      assistantPhaseCallbackStarted - workspaceForegroundPassStarted,
    assistantPhaseCallbackToAssistantPhaseMs:
      assistantPhaseStarted - assistantPhaseCallbackStarted,
  }
}

function completeAssistantAutomationLaneTiming(
  context: AssistantProviderStartCriticalPathContext,
): Pick<
  AssistantProviderStartCriticalPathTiming,
  | 'automationCandidateScanMs'
  | 'automationCrossSessionContextMs'
  | 'automationGroupAndOperationScopeMs'
  | 'automationInputSelectionMs'
  | 'automationPassSetupMs'
  | 'automationPromptPreparationMs'
  | 'automationReadinessMs'
  | 'automationServiceHandoffMs'
  | 'automationSessionPreflightMs'
  | 'automationTerminalEvidenceMs'
> | null {
  if (context.automationLaneSubdivisionEligible === false) {
    return null
  }
  const boundaries = [
    context.automationLaneStartedAtMonotonicMs,
    context.automationReadinessDoneAtMonotonicMs,
    context.automationInputSelectionDoneAtMonotonicMs,
    context.automationPassSetupDoneAtMonotonicMs,
    context.automationCandidateScanDoneAtMonotonicMs,
    context.automationGroupAndOperationScopeDoneAtMonotonicMs,
    context.automationTerminalEvidenceDoneAtMonotonicMs,
    context.automationSessionPreflightDoneAtMonotonicMs,
    context.automationCrossSessionContextDoneAtMonotonicMs,
    context.automationPromptPreparationDoneAtMonotonicMs,
    context.assistantServiceStartedAtMonotonicMs,
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
    automationLaneStarted,
    automationReadinessDone,
    automationInputSelectionDone,
    automationPassSetupDone,
    automationCandidateScanDone,
    automationGroupAndOperationScopeDone,
    automationTerminalEvidenceDone,
    automationSessionPreflightDone,
    automationCrossSessionContextDone,
    automationPromptPreparationDone,
    assistantServiceStarted,
  ] = boundaries as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]

  return {
    automationReadinessMs:
      automationReadinessDone - automationLaneStarted,
    automationInputSelectionMs:
      automationInputSelectionDone - automationReadinessDone,
    automationPassSetupMs:
      automationPassSetupDone - automationInputSelectionDone,
    automationCandidateScanMs:
      automationCandidateScanDone - automationPassSetupDone,
    automationGroupAndOperationScopeMs:
      automationGroupAndOperationScopeDone - automationCandidateScanDone,
    automationTerminalEvidenceMs:
      automationTerminalEvidenceDone - automationGroupAndOperationScopeDone,
    automationSessionPreflightMs:
      automationSessionPreflightDone - automationTerminalEvidenceDone,
    automationCrossSessionContextMs:
      automationCrossSessionContextDone - automationSessionPreflightDone,
    automationPromptPreparationMs:
      automationPromptPreparationDone - automationCrossSessionContextDone,
    automationServiceHandoffMs:
      assistantServiceStarted - automationPromptPreparationDone,
  }
}
