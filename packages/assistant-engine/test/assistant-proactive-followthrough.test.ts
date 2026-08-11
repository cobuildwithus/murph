import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.js'
import {
  buildOnboardingGoalCheckinSeed,
} from '../src/assistant/onboarding-goal-checkin-automation.js'

describe('assistant proactive follow-through', () => {
  it('proactively offers and activates goal support only in private conversations', () => {
    const direct = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdateMode: 'direct',
    })
    const group = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdateMode: 'group',
    })

    expect(direct).toContain('Direct proactive follow-through:')
    expect(direct).toContain(
      'adopt, continue, restart, extend, or modify a repeated health behavior',
    )
    expect(direct).toContain(
      'current user-chosen goal, accepted plan, or repeatedly described friction',
    )
    expect(direct).toContain(
      'proactively offer one best-fit finite reminder, check-in, or review package',
    )
    expect(direct).toContain('weekly managed goal-support check')
    expect(direct).toContain('Execute those writes now')
    expect(direct).toContain(
      'Do not call the plan set, started, or locked in',
    )
    expect(direct).toContain('stop asking about a topic')
    expect(direct).toContain('preserve unrelated support')
    expect(direct).toContain('pause the weekly managed goal-support check too')
    expect(group).not.toContain('Direct proactive follow-through:')
  })

  it('makes the managed goal-support audit recurring, concrete, and easy to stop', () => {
    const completedAt = '2026-06-01T18:15:00.000Z'
    const seed = buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-02T12:00:00.000Z'),
      onboardingState: {
        completedAt,
        completedReason: 'user_answered',
        createdAt: '2026-06-01T18:00:00.000Z',
        schemaVersion: 'murph.assistant-onboarding.v1',
        status: 'completed',
        updatedAt: completedAt,
      },
      timeZone: 'UTC',
    })

    expect(seed).toMatchObject({
      activeUntil: null,
      schedule: {
        expression: '30 13 * * 2',
        kind: 'cron',
      },
      title: 'Weekly goal support check-in',
    })
    expect(seed?.instructions).toContain('weekly support-gap check')
    expect(seed?.instructions).toContain('one exact finite package')
    expect(seed?.instructions).toContain('meal notes or photos')
    expect(seed?.instructions).toContain('later clear yes')
    expect(seed?.instructions).toContain('stop that topic')
    expect(seed?.instructions).toContain(
      'Missing, sparse, stale, misclassified, messy, or contradictory data is unknown',
    )
    expect(seed?.instructions).toContain(
      'Do not create, update, complete, or archive goals',
    )
  })
})
