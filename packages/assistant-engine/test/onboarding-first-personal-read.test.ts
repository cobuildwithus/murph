import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

async function readOnboardingSkill(): Promise<string> {
  const skillsRoot = resolveAssistantSkillsRoot()
  const raw = await readFile(
    path.join(skillsRoot, 'murph-onboarding', 'SKILL.md'),
    'utf8',
  )
  return raw.replace(/\s+/gu, ' ')
}

describe('onboarding first personal read', () => {
  it('arms one route-bound high-reasoning read before answered completion', async () => {
    const onboarding = await readOnboardingSkill()
    const firstReadIndex = onboarding.indexOf(
      'slug: "onboarding-first-personal-read"',
    )
    const completionIndex = onboarding.indexOf(
      'vault-cli assistant onboarding complete --reason user_answered',
    )

    expect(firstReadIndex).toBeGreaterThan(-1)
    expect(completionIndex).toBeGreaterThan(firstReadIndex)
    expect(
      onboarding.match(/slug: "onboarding-first-personal-read"/gu),
    ).toHaveLength(1)
    expect(onboarding).toContain(
      'schedule the occurrence for two minutes later and set `activeUntil` to sixty-two minutes later',
    )
    expect(onboarding).toContain('continuityPolicy: "fresh"')
    expect(onboarding).toContain('"model": "gpt-5.6-sol"')
    expect(onboarding).toContain('"reasoningEffort": "high"')
    expect(onboarding).toContain(
      'Never arm it from the finite scheduled recovery occurrence',
    )
    expect(onboarding).toContain('or for `user_declined`')
    expect(onboarding).toContain(
      'do not retry, block completion, or mention the failure',
    )
    expect(onboarding).toContain(
      'When the first-personal-read save succeeded',
    )
  })

  it('keeps the delayed result grounded, contextual, and action-optional', async () => {
    const onboarding = await readOnboardingSkill()

    expect(onboarding).toContain(
      'the currently available canonical evidence that could materially change the user\'s named open threads',
    )
    expect(onboarding).toContain(
      'read `vault-cli wearables sources list` before relying on wearable trends',
    )
    expect(onboarding).toContain(
      'Missing, stale, sparse, misclassified, contradictory, or still-importing data is not evidence',
    )
    expect(onboarding).toContain(
      'do not spawn a child; this scheduled turn owns the complete read, selection, and delivery',
    )
    expect(onboarding).toContain(
      'Read the newest committed conversation again immediately before composing',
    )
    expect(onboarding).toContain(
      'return skip rather than interrupting it',
    )
    expect(onboarding).toContain(
      'I took the deeper look I mentioned.',
    )
    expect(onboarding).toContain(
      'at most one optional low-burden next action or question',
    )
    expect(onboarding).toContain(
      'Do not diagnose, prescribe, dump metrics, stack findings, create a habit, plan, experiment, reminder, or other action',
    )
    expect(onboarding).toContain(
      'do not fabricate one and do not send a sync or process note',
    )
    expect(onboarding).toContain(
      'You can keep texting me normally in the meantime.',
    )
  })
})
