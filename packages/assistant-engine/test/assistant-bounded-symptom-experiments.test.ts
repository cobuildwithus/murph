import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

function getSkill(slug: (typeof ASSISTANT_SKILLS)[number]['slug']) {
  const skill = ASSISTANT_SKILLS.find((candidate) => candidate.slug === slug)
  if (!skill) {
    throw new Error(`Missing registered skill: ${slug}`)
  }
  return skill
}

async function readSkill(slug: (typeof ASSISTANT_SKILLS)[number]['slug']) {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('bounded self-management experiment guidance', () => {
  it('routes persistent symptom change requests without requiring experiment language', () => {
    const chronic = getSkill('chronic-illness-support')
    const experiments = getSkill('self-management-experiments')

    expect(chronic.triggerHint).toContain(
      'persistent or recurring symptoms even without a settled diagnosis',
    )
    expect(chronic.triggerHint).toContain(
      'asks what to change or try day to day',
    )
    expect(chronic.triggerHint).toContain(
      'one ranked low-burden trial rather than a generic wellness bundle',
    )
    expect(experiments.triggerHint).toContain(
      'The member does not need to say “experiment”',
    )
    expect(experiments.triggerHint).toContain(
      'what to change or try day to day is experiment intent',
    )
  })

  it('requires one complete symptom-targeted trial with a safety off-ramp', async () => {
    const chronic = await readSkill('chronic-illness-support')

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