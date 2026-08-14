import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

type BoundedExperimentSkillSlug =
  | 'chronic-illness-support'
  | 'self-management-experiments'

async function readSkill(slug: BoundedExperimentSkillSlug) {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

function buildPrompt(input: { conversationScope?: 'group' } = {}): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'imessage',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    currentLocalDate: '2026-08-14',
    currentTimeZone: 'America/Chicago',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
    ...(input.conversationScope
      ? { conversationScope: input.conversationScope }
      : {}),
  })
}

describe('bounded self-management experiment guidance', () => {
  it('puts the symptom-experiment correction in the resident direct prompt', () => {
    const prompt = buildPrompt()
    const groupPrompt = buildPrompt({ conversationScope: 'group' })
    const legacyGate =
      'Suggest experiments only when asked to try, test, track, or set one up.'
    const intentCorrection =
      'For this case, the request for a daily-life change itself satisfies experiment intent and overrides narrower experiment-intent shorthand elsewhere in the resident prompt'
    const correctionIndex = prompt.indexOf(intentCorrection)
    const legacyGateIndex = prompt.indexOf(legacyGate)

    expect(prompt).toContain('Persistent-symptom next steps:')
    expect(groupPrompt).not.toContain('Persistent-symptom next steps:')
    expect(prompt).toContain(
      'treat that as experiment intent even if they do not use the word "experiment"',
    )
    expect(correctionIndex).toBeGreaterThan(-1)
    if (legacyGateIndex >= 0) {
      expect(correctionIndex).toBeGreaterThan(legacyGateIndex)
    }
    expect(prompt).toContain(
      'do not require the member also to say try, test, track, experiment, or set one up',
    )
    expect(prompt).toContain(
      'recommend one ranked symptom-targeted trial, not a bundle of generic wellness tips',
    )
    expect(prompt).toContain('a bounded duration or observation window')
    expect(prompt).toContain('Urgent evaluation or a condition-specific owner still wins.')
  })

  it('requires one complete symptom-targeted trial with a safety off-ramp', async () => {
    const chronic = await readSkill('chronic-illness-support')

    expect(chronic).toContain(
      'a persistent or recurring symptom pattern even without a settled diagnosis',
    )
    expect(chronic).toContain(
      'Choose one symptom-targeted first lever rather than a bundle of generic wellness factors.',
    )
    expect(chronic).toContain('the exact technique or dose')
    expect(chronic).toContain('a bounded observation window')
    expect(chronic).toContain('one burden or adverse-effect check')
    expect(chronic).toContain('stop rules')
    expect(chronic).toContain('a review and decision rule')
    expect(chronic).toContain(
      'Do not use a trial when urgent evaluation or a condition-specific owner should come first.',
    )
    expect(chronic).toContain(
      'answers a persistent-symptom change request with generic wellness factors instead of one ranked, symptom-targeted trial',
    )
  })

  it('keeps the experiment owner decisive, bounded, and low burden', async () => {
    const experiments = await readSkill('self-management-experiments')

    expect(experiments).toContain(
      'A request framed as “what should I change or try day to day?” counts as experiment intent',
    )
    expect(experiments).toContain(
      'return one complete bounded trial instead of a generic wellness list',
    )
    expect(experiments).toContain('one primary measure and at most two supporting measures')
    expect(experiments).toContain('Never increase notification frequency after nonresponse.')
    expect(experiments).toContain(
      'offers a generic wellness list or a menu but never recommends the best first test',
    )
  })
})
