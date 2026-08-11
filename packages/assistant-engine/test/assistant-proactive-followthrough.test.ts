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
    expect(direct).toContain('post-onboarding support-gap check')
    expect(direct).toContain('Apply the accepted package now')
    expect(direct).toContain(
      'Do not call the plan set, started, or locked in',
    )
    expect(direct).toContain('stop asking about a topic')
    expect(direct).toContain('preserve unrelated support')
    expect(direct).toContain('exact durable support boundary')
    expect(direct).toContain('existing canonical memory or preference surface')
    expect(direct).not.toContain('weekly managed goal-support check')
    expect(group).not.toContain('Direct proactive follow-through:')
  })

  it('keeps the first health read separate from one finite three-day support check', () => {
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
      activeUntil: '2026-06-08T13:30:00.000Z',
      schedule: {
        at: '2026-06-04T13:30:00.000Z',
        kind: 'at',
      },
      title: 'Initial goal support check-in',
    })
    expect(seed?.instructions).toContain('about three days after answered onboarding')
    expect(seed?.instructions).toContain('This is not the first personal health read')
    expect(seed?.instructions).toContain('one exact finite package')
    expect(seed?.instructions).toContain('meal notes or photos')
    expect(seed?.instructions).toContain('later clear yes')
    expect(seed?.instructions).toContain('stop that topic')
    expect(seed?.instructions).toContain('durable support boundaries')
    expect(seed?.instructions).toContain(
      'no-proactive-support boundary vetoes its matching topic',
    )
    expect(seed?.instructions).toContain(
      'Missing, sparse, stale, misclassified, messy, or contradictory data is unknown',
    )
    expect(seed?.instructions).toContain(
      'Do not create, update, complete, or archive goals',
    )
    expect(seed?.instructions).not.toContain('weekly support-gap check')
  })
})
