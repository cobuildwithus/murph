import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

describe('assistant nutrition source grounding', () => {
  it('uses USDA and label facts for nutrient density before visual estimation', async () => {
    const skillsRoot = resolveAssistantSkillsRoot()
    const [foodJournal, automaticMealCapture] = await Promise.all([
      readFile(path.join(skillsRoot, 'food-journal', 'SKILL.md'), 'utf8'),
      readFile(
        path.join(skillsRoot, 'automatic-meal-capture', 'SKILL.md'),
        'utf8',
      ),
    ])
    const food = compact(foodJournal)
    const automatic = compact(automaticMealCapture)

    expect(food).toContain(
      'Treat every calorie or macro estimate as two separate questions:',
    )
    expect(food).toContain('Do not let vision or memory answer both.')
    expect(food).toContain(
      'For every numeric meal estimate—including interactive meal logs, user-sent photos, automatic-meal-capture enrichment, and scheduled closeouts—resolve nutrient density from the hosted food-label database',
    )
    expect(food).toContain(
      'use returned label or USDA facts for calories and macros',
    )
    expect(food).toContain(
      'Because `--generic` applies to the whole batch, split a mixed meal into at most two lookups: one generic USDA batch and one normal branded/menu/package batch.',
    )
    expect(food).toContain(
      'A database serving is not evidence that the user ate exactly one serving.',
    )
    expect(food).toContain(
      'Do not silently assume restaurant or prepared food has no added fat.',
    )
    expect(food).toContain(
      'Only after those fail may you use a clearly marked memory-based estimate',
    )
    expect(automatic).toContain(
      'Read `$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md` before estimating nutrition',
    )
  })

  it('looks up exact supplement products without implying FDA approval', async () => {
    const supplementSkill = compact(
      await readFile(
        path.join(
          resolveAssistantSkillsRoot(),
          'micronutrients-supplements',
          'SKILL.md',
        ),
        'utf8',
      ),
    )

    expect(supplementSkill).toContain(
      'For every named supplement product, brand, exact dose, serving, ingredient-panel question, product image or list, and create or update request',
    )
    expect(supplementSkill).toContain(
      '`vault-cli supplement search-labels-batch` for several before relying on memory or web search',
    )
    expect(supplementSkill).toContain(
      'Batch a multi-product stack instead of looking up each item serially.',
    )
    expect(supplementSkill).toContain(
      'Skip exact-product lookup only for a genuinely generic evidence question',
    )
    expect(supplementSkill).toContain(
      'The hosted corpus can include NIH DSLD, DailyMed, and first-party manufacturer label records.',
    )
    expect(supplementSkill).toContain(
      'Never describe a database match as FDA approval',
    )
    expect(supplementSkill).toContain(
      'If a returned serving, amount, or ingredient field is absent or source-null, do not infer it',
    )
  })
})
