import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.js'
import {
  buildOnboardingGoalCheckinSeed,
} from '../src/assistant/onboarding-goal-checkin-automation.js'

const behaviorFollowthroughSkillPath = path.join(
  resolveAssistantSkillsRoot(),
  'behavior-followthrough',
  'SKILL.md',
)

describe('assistant proactive follow-through', () => {
  it('keeps exact-package acceptance and narrow support boundaries in the owning skill', async () => {
    const direct = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdateMode: 'direct',
    })
    const group = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdateMode: 'group',
    })
    const skill = await readFile(behaviorFollowthroughSkillPath, 'utf8')
    const normalizedSkill = skill.replace(/\s+/g, ' ')

    expect(ASSISTANT_SKILLS.find(({ slug }) =>
      slug === 'behavior-followthrough'
    )).toBeDefined()
    expect(direct).not.toContain('Direct proactive follow-through:')
    expect(group).not.toContain('Direct proactive follow-through:')
    expect(normalizedSkill).toContain('one exact finite support package')
    expect(normalizedSkill).toContain(
      'A clear yes authorizes only the named plan and support writes',
    )
    expect(normalizedSkill).toContain('without a second confirmation')
    expect(normalizedSkill).toContain('only in a private member conversation')
    expect(normalizedSkill).toContain("Never use a group participant's message")
    expect(normalizedSkill).toContain(
      'private automation, memory, preference, plan, goal, or health context',
    )
    expect(normalizedSkill).toContain('room-owned support')
    expect(normalizedSkill).toContain('stop asking about a topic')
    expect(normalizedSkill).toContain(
      'pause or archive the narrowest matching automation',
    )
    expect(normalizedSkill).toContain('preserving unrelated support')
    expect(normalizedSkill).toContain(
      'topic-specific no-proactive-support boundary',
    )
    expect(normalizedSkill).toContain('canonical memory or preference surface')
    expect(normalizedSkill).toContain(
      'For every accepted non-experiment repeated-action plan, including `habit_plan` and `training_plan`',
    )
    expect(normalizedSkill).toContain(
      'Save the concrete plan into exactly one `kind=habit` regimen linked to the Goal',
    )
    expect(normalizedSkill).toContain(
      "Also include the user's reason in their own words and the practical constraints that materially shaped the accepted loop.",
    )
    expect(normalizedSkill).toContain(
      'Do not save inferred motives or a generic reason manufactured from the goal title.',
    )
    expect(normalizedSkill).toContain(
      '`vault-cli automation list --support-series-id habit:<regimenId> --compact --limit 200`',
    )
    expect(normalizedSkill).toContain(
      'Every automation owned by a non-experiment repeated-action plan, including a training plan, must set `supportSeriesId: "habit:<regimenId>"`',
    )
    expect(normalizedSkill).toContain(
      'An exact redelivery of an already-persisted package performs no write.',
    )
    expect(normalizedSkill).toContain(
      'Follow every returned `nextCursor` with `--cursor` until it is null',
    )
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
      stableKey: 'vault-3',
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
