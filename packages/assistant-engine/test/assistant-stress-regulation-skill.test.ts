import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

const MODE_HEADINGS = [
  'acute downshift',
  'overload and occupational burnout support',
  'stress-aware habit support',
  'pain or symptom alarm support',
  'sleep-adjacent regulation',
  'escalation-aware safety routing',
]

const OWNER_SLUGS = [
  'behavior-followthrough',
  'experiment-onboarding',
  'self-management-experiments',
  'chronic-pain-support',
  'chronic-illness-support',
  'physical-therapy',
  'food-journal',
]

describe('assistant stress regulation skill', () => {
  it('registers one bounded stress-support route', () => {
    const matches = ASSISTANT_SKILLS.filter(
      ({ slug }) => slug === 'stress-regulation',
    )

    expect(matches).toHaveLength(1)
    expect(matches[0]?.name).toBe('stress-regulation')
    expect(matches[0]?.triggerHint).toMatch(
      /stress or overload.+immediate bottleneck/i,
    )
    expect(matches[0]?.triggerHint).toMatch(
      /one brief state- or load-shifting action/i,
    )
    expect(matches[0]?.triggerHint).toMatch(/hand off recurring.+crisis work/i)
  })

  it('keeps six reusable modes and one ownership boundary', async () => {
    const raw = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'stress-regulation', 'SKILL.md'),
      'utf8',
    )

    expect(raw).toContain('Safety → bottleneck → one move → handoff')

    const modeHeadings = [...raw.matchAll(/^## Mode \d+: (.+)$/gm)].map(
      ([, heading]) => heading,
    )
    expect(modeHeadings).toEqual(MODE_HEADINGS)

    for (const slug of OWNER_SLUGS) {
      expect(raw).toContain(`\`${slug}\``)
    }

    expect(raw).toContain('This is a brief support and routing layer')
    expect(raw).toContain('Do not duplicate another owner')
    expect(raw).toContain('Own only **today’s adjustment**')
    expect(raw).toContain('Own one transition step, not insomnia treatment')
  })

  it('preserves high-risk safety invariants', async () => {
    const raw = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'stress-regulation', 'SKILL.md'),
      'utf8',
    )

    for (const required of [
      'Breathing is optional, not the default',
      'Do not invent a safety threshold',
      'no compensation',
      'usual or clinician-directed eating plan',
      'call or text **988**',
      'never conditional on completing a regulation exercise',
      'Ask the minimum direct safety questions needed to route',
      'Do not store inferred anxiety',
    ]) {
      expect(raw).toContain(required)
    }
  })

  it('does not regress into a therapy catalog or duplicate habit engine', async () => {
    const raw = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'stress-regulation', 'SKILL.md'),
      'utf8',
    )

    for (const forbidden of [
      'Settle → Reduce → Act → Learn',
      'standard, tiny, and fallback',
      'Capability:',
      'Murph can reset your vagus nerve',
      '4-7-8',
      'box breathing',
      'physiological sigh',
    ]) {
      expect(raw).not.toContain(forbidden)
    }
  })
})
