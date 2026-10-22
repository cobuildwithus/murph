import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

async function readSkills(): Promise<{ nutrition: string }> {
  return { nutrition: await readFile(path.join(resolveAssistantSkillsRoot(), 'nutrition-strategy', 'SKILL.md'), 'utf8') }
}

describe('nutrition safety guidance', () => {
  it('keeps performance numbers bounded and qualified', async () => {
    const { nutrition } = await readSkills()

    expect(nutrition).toMatch(/1\.4-2\.0 g\/kg\/day/)
    expect(nutrition).toMatch(/target near 1\.6 g\/kg\/day/)
    expect(nutrition).toMatch(/up to about 2\.2 g\/kg\/day/)
    expect(nutrition).toMatch(/0\.25-0\.4 g\/kg/)
    expect(nutrition).toMatch(/30-60 g carbohydrate per hour/)
    expect(nutrition).toMatch(/as much as 90 g carbohydrate per hour/)
    expect(nutrition).toContain('do not blindly turn it into a target')
    expect(nutrition).toContain('Sodium does not make overdrinking safe.')
    expect(nutrition).toContain('gain body mass during exercise')
  })

  it('protects under-fueled, eating-disorder-sensitive, and acute contexts', async () => {
    const { nutrition } = await readSkills()

    expect(nutrition).toContain('can occur at any body size')
    expect(nutrition).toContain('one compact safety question')
    expect(nutrition).toContain(
      'do not add a universal medical-history or measurement\npreflight',
    )
    expect(nutrition).toContain(
      'Apply that rule only to the numeric target or guidance the known fact\nmaterially affects.',
    )
    expect(nutrition).toContain(
      'An allergy, intolerance, dietary restriction, or\nclinician-directed diet is not by itself a reason to suppress benign totals or\nan accepted compatible target bundle.',
    )
    expect(nutrition).toContain(
      'A scheduled occurrence with unresolved suitability uses ordinary nonnumeric\ncloseout text and makes no proposal, mutation, question, or card.',
    )
    expect(nutrition).toContain('Do not calculate energy availability or diagnose RED-S')
    expect(nutrition).toContain('little or nothing for about five days')
    expect(nutrition).toContain('refeeding can require medical monitoring')
    expect(nutrition).toContain('supplement dosing, fasting, or personalized fluid/electrolyte plans')
    expect(nutrition).toContain('an older adult with frailty, sarcopenia, or low intake')
    expect(nutrition).toContain(
      'Do not provide a calorie deficit, weight-loss target, compensatory exercise plan, fasting strategy, or detailed macro prescription.',
    )
    expect(nutrition).toContain('A benign food question does not need a repetitive warning.')
    expect(nutrition).toContain('Recommend urgent medical assessment')
    expect(nutrition).toContain(
      'Medical stability, adequate fueling, and eating-disorder recovery outrank appearance, performance, and optimization.',
    )
  })
})
