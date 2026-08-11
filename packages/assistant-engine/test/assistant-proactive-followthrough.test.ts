import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.js'
import {
  buildOnboardingGoalCheckinSeed,
} from '../src/assistant/onboarding-goal-checkin-automation.js'

describe('assistant proactive follow-through', () => {
  it('makes repeated-plan decisions plan-and-support turns only in private conversations', () => {
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
      'one specific finite reminder/check-in/review package',
    )
    expect(direct).toContain(
      'Do not call the plan set, started, or locked in',
    )
    expect(direct).toContain('stop asking about a topic')
    expect(direct).toContain('preserve unrelated support')
    expect(group).not.toContain('Direct proactive follow-through:')
  })

  it('makes the managed post-onboarding check-in concrete, evidence-aware, and easy to stop', () => {
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

    expect(seed?.instructions).toContain(
      'one concrete, reply-oriented day-to-day health support bid',
    )
    expect(seed?.instructions).toContain('one exact finite support package')
    expect(seed?.instructions).toContain('meal note or photo')
    expect(seed?.instructions).toContain('stop asking about that topic')
    expect(seed?.instructions).toContain(
      'Missing, sparse, stale, misclassified, messy, or contradictory data is unknown',
    )
    expect(seed?.instructions).toContain(
      'Do not create, update, complete, or archive goals',
    )
  })
})
