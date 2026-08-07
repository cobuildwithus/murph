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
      assistantServicePreLockMs: 5,
      automationLaneToAssistantServiceMs: 30,
      codexAppServerPreProviderMs: 30,
      codexProcessPreparationMs: 10,
      mailboxImportDoneToAssistantPhaseMs: 10,
      preProviderSetupMs: 18,
      providerPlanAndGateMs: 40,
      turnLockWaitMs: 7,
      workspaceAssistantPreAutomationMs: 20,
    })
    expect(Object.values(timing ?? {}).reduce((sum, value) => sum + value, 0))
      .toBe(170)
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
