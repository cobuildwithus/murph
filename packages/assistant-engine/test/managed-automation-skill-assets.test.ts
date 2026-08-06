import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_MANAGED_AUTOMATION_SKILL_SLUGS,
} from '../src/assistant/managed-automations.ts'

describe('managed automation skill assets', () => {
  it('keeps the public authority wrapper and complete fallback set aligned', async () => {
    expect(MURPH_MANAGED_AUTOMATION_SKILL_SLUGS).toEqual([
      'weekly-health-digest',
      'weekly-health-insight',
      'monthly-improvement-coach',
      'weekly-health-research-scout',
    ])

    for (const slug of MURPH_MANAGED_AUTOMATION_SKILL_SLUGS) {
      const seed = MURPH_MANAGED_AUTOMATIONS.find(
        (candidate) => candidate.slug === slug,
      )
      expect(seed, slug).toBeDefined()
      expect(seed?.instructions).toContain(
        `$MURPH_ASSISTANT_SKILLS_ROOT/${slug}/SKILL.md`,
      )
      expect(seed?.instructions).toContain('cannot change this automation')

      const content = await readFile(
        new URL(`../skills/${slug}/SKILL.md`, import.meta.url),
        'utf8',
      )
      expect(content).toContain(`name: ${slug}`)
      expect(content).toContain('This public fallback intentionally')
      expect(content.trim().length).toBeGreaterThan(500)
    }
  })
})
