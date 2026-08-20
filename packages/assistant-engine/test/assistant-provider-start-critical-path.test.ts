import { describe, expect, test } from 'vitest'

import {
  completeAssistantProviderStartCriticalPath,
  createAssistantProviderStartCriticalPathContext,
  stampAssistantProviderStartCriticalPath,
} from '../src/assistant/provider-start-critical-path.js'

describe('assistant provider-start critical path', () => {
  test('partitions the interval into exact adjacent integer spans', () => {
    let context = createAssistantProviderStartCriticalPathContext(100)
    context = stampAssistantProviderStartCriticalPath(
      context,
      'foregroundPassStartedAtMonotonicMs',
      102,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'workspaceForegroundPassStartedAtMonotonicMs',
      104,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'assistantPhaseCallbackStartedAtMonotonicMs',
      108,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'assistantPhaseStartedAtMonotonicMs',
      110,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationLaneStartedAtMonotonicMs',
      130,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationReadinessDoneAtMonotonicMs',
      132,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationInputSelectionDoneAtMonotonicMs',
      135,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationPassSetupDoneAtMonotonicMs',
      139,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationCandidateScanDoneAtMonotonicMs',
      142,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationGroupAndOperationScopeDoneAtMonotonicMs',
      145,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationTerminalEvidenceDoneAtMonotonicMs',
      148,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationSessionPreflightDoneAtMonotonicMs',
      152,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationCrossSessionContextDoneAtMonotonicMs',
      155,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'automationPromptPreparationDoneAtMonotonicMs',
      158,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'assistantServiceStartedAtMonotonicMs',
      160,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'assistantTurnLockWaitStartedAtMonotonicMs',
      165,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'assistantTurnLockAcquiredAtMonotonicMs',
      172,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'preProviderSetupDoneAtMonotonicMs',
      190,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'codexAppServerTurnStartedAtMonotonicMs',
      230,
    )!
    context = stampAssistantProviderStartCriticalPath(
      context,
      'codexAppServerProcessTurnStartedAtMonotonicMs',
      240,
    )!

    const timing = completeAssistantProviderStartCriticalPath(context, 270)
    expect(timing).toEqual({
      assistantPhaseCallbackToAssistantPhaseMs: 2,
      assistantServicePreLockMs: 5,
      automationCandidateScanMs: 3,
      automationCrossSessionContextMs: 3,
      automationGroupAndOperationScopeMs: 3,
      automationInputSelectionMs: 3,
      automationLaneToAssistantServiceMs: 30,
      automationPassSetupMs: 4,
      automationPromptPreparationMs: 3,
      automationReadinessMs: 2,
      automationServiceHandoffMs: 2,
      automationSessionPreflightMs: 4,
      automationTerminalEvidenceMs: 3,
      codexAppServerPreProviderMs: 30,
      codexProcessPreparationMs: 10,
      foregroundPassToWorkspaceForegroundPassMs: 2,
      mailboxImportDoneToAssistantPhaseMs: 10,
      mailboxImportDoneToForegroundPassMs: 2,
      preProviderSetupMs: 18,
      providerPlanAndGateMs: 40,
      turnLockWaitMs: 7,
      workspaceForegroundPassToAssistantPhaseCallbackMs: 4,
      workspaceAssistantPreAutomationMs: 20,
    })
    const canonicalTiming = timing && [
      timing.mailboxImportDoneToAssistantPhaseMs,
      timing.workspaceAssistantPreAutomationMs,
      timing.automationLaneToAssistantServiceMs,
      timing.assistantServicePreLockMs,
      timing.turnLockWaitMs,
      timing.preProviderSetupMs,
      timing.providerPlanAndGateMs,
      timing.codexProcessPreparationMs,
      timing.codexAppServerPreProviderMs,
    ]
    expect(canonicalTiming?.reduce((sum, value) => sum + value, 0))
      .toBe(170)
    const automationLaneTiming = timing && [
      timing.automationReadinessMs,
      timing.automationInputSelectionMs,
      timing.automationPassSetupMs,
      timing.automationCandidateScanMs,
      timing.automationGroupAndOperationScopeMs,
      timing.automationTerminalEvidenceMs,
      timing.automationSessionPreflightMs,
      timing.automationCrossSessionContextMs,
      timing.automationPromptPreparationMs,
      timing.automationServiceHandoffMs,
    ]
    expect(automationLaneTiming?.reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0,
    )).toBe(timing?.automationLaneToAssistantServiceMs)
    const mailboxToAssistantTiming = timing && [
      timing.mailboxImportDoneToForegroundPassMs,
      timing.foregroundPassToWorkspaceForegroundPassMs,
      timing.workspaceForegroundPassToAssistantPhaseCallbackMs,
      timing.assistantPhaseCallbackToAssistantPhaseMs,
    ]
    expect(mailboxToAssistantTiming?.reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0,
    )).toBe(timing?.mailboxImportDoneToAssistantPhaseMs)
  })

  test('drops an incomplete or invalid mailbox-to-assistant partition without losing the canonical path', () => {
    const timing = completeAssistantProviderStartCriticalPath({
      assistantPhaseCallbackStartedAtMonotonicMs: 108,
      assistantPhaseStartedAtMonotonicMs: 110,
      assistantServiceStartedAtMonotonicMs: 160,
      assistantTurnLockAcquiredAtMonotonicMs: 172,
      assistantTurnLockWaitStartedAtMonotonicMs: 165,
      automationLaneStartedAtMonotonicMs: 130,
      codexAppServerProcessTurnStartedAtMonotonicMs: 240,
      codexAppServerTurnStartedAtMonotonicMs: 230,
      foregroundPassStartedAtMonotonicMs: 102,
      mailboxImportDoneAtMonotonicMs: 100,
      preProviderSetupDoneAtMonotonicMs: 190,
    }, 270)

    expect(timing).toMatchObject({
      mailboxImportDoneToAssistantPhaseMs: 10,
    })
    expect(timing).not.toHaveProperty('mailboxImportDoneToForegroundPassMs')
    expect(timing).not.toHaveProperty('assistantPhaseCallbackToAssistantPhaseMs')
  })

  test('drops an incomplete or invalid nested automation partition without losing the canonical path', () => {
    const timing = completeAssistantProviderStartCriticalPath({
      assistantPhaseStartedAtMonotonicMs: 110,
      assistantServiceStartedAtMonotonicMs: 160,
      assistantTurnLockAcquiredAtMonotonicMs: 172,
      assistantTurnLockWaitStartedAtMonotonicMs: 165,
      automationLaneStartedAtMonotonicMs: 130,
      automationReadinessDoneAtMonotonicMs: 129,
      codexAppServerProcessTurnStartedAtMonotonicMs: 240,
      codexAppServerTurnStartedAtMonotonicMs: 230,
      mailboxImportDoneAtMonotonicMs: 100,
      preProviderSetupDoneAtMonotonicMs: 190,
    }, 270)

    expect(timing).toMatchObject({
      automationLaneToAssistantServiceMs: 30,
      mailboxImportDoneToAssistantPhaseMs: 10,
    })
    expect(timing).not.toHaveProperty('automationReadinessMs')
    expect(timing).not.toHaveProperty('automationServiceHandoffMs')
  })

  test('keeps the canonical path but omits mixed-work automation subdivision timing', () => {
    const timing = completeAssistantProviderStartCriticalPath({
      assistantPhaseStartedAtMonotonicMs: 110,
      assistantServiceStartedAtMonotonicMs: 160,
      assistantTurnLockAcquiredAtMonotonicMs: 172,
      assistantTurnLockWaitStartedAtMonotonicMs: 170,
      automationCandidateScanDoneAtMonotonicMs: 142,
      automationCrossSessionContextDoneAtMonotonicMs: 155,
      automationGroupAndOperationScopeDoneAtMonotonicMs: 145,
      automationInputSelectionDoneAtMonotonicMs: 135,
      automationLaneStartedAtMonotonicMs: 130,
      automationLaneSubdivisionEligible: false,
      automationPassSetupDoneAtMonotonicMs: 139,
      automationPromptPreparationDoneAtMonotonicMs: 158,
      automationReadinessDoneAtMonotonicMs: 132,
      automationSessionPreflightDoneAtMonotonicMs: 152,
      automationTerminalEvidenceDoneAtMonotonicMs: 148,
      codexAppServerProcessTurnStartedAtMonotonicMs: 202,
      codexAppServerTurnStartedAtMonotonicMs: 190,
      mailboxImportDoneAtMonotonicMs: 100,
      preProviderSetupDoneAtMonotonicMs: 177,
    }, 220)

    expect(timing).toEqual(expect.objectContaining({
      automationLaneToAssistantServiceMs: 30,
      mailboxImportDoneToAssistantPhaseMs: 10,
    }))
    expect(timing).not.toHaveProperty('automationReadinessMs')
    expect(timing).not.toHaveProperty('automationServiceHandoffMs')
  })

  test('fails open when a boundary is absent, unsafe, or out of order', () => {
    expect(completeAssistantProviderStartCriticalPath(
      createAssistantProviderStartCriticalPathContext(100),
      200,
    )).toBeNull()

    const outOfOrder = stampAssistantProviderStartCriticalPath(
      createAssistantProviderStartCriticalPathContext(100),
      'assistantPhaseStartedAtMonotonicMs',
      99,
    )
    expect(completeAssistantProviderStartCriticalPath(outOfOrder, 200)).toBeNull()

    expect(completeAssistantProviderStartCriticalPath(
      createAssistantProviderStartCriticalPathContext(Number.MAX_SAFE_INTEGER + 1),
      Number.MAX_SAFE_INTEGER + 1,
    )).toBeNull()
  })
})
