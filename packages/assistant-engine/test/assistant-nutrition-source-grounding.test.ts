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
      'reuse applicable label or USDA facts already verified in the conversation or saved record.',
    )
    expect(food).toContain(
      'use returned label or USDA facts for calories and macros',
    )
    expect(food).toContain(
      'Because `--generic` applies to the whole batch, split a mixed meal into at most two lookups: one generic USDA batch and one normal branded/menu/package batch.',
    )
    expect(food).toContain(
      'The default returns one compact nutrition match per component with serving, calories, protein, carbohydrate, fat, fiber, and a bounded exact-product contaminant summary.',
    )
    expect(food).toContain(
      'Read `contaminantSummary` by default: `no_known_product_tests` means evidence is unknown',
    )
    expect(food).toContain(
      'When an alert includes `screeningPolicy`, use its exposure and ratio to interpret unlike result/threshold units',
    )
    expect(food).toContain(
      'that context is not a personalized safety verdict.',
    )
    expect(food).toContain(
      '`murphConcernLevel` is the strongest threshold-screening result among the linked tests, not product safety or personal risk.',
    )
    expect(food).toContain(
      '`none` means no represented comparable observation triggered an alert, not that no contaminants were measured.',
    )
    expect(food).toContain(
      'Alerts are a subset of observations; never add their counts together.',
    )
    expect(food).toContain(
      'For a routine meal log, inspect the summary silently and mention it only when the user asks or a material exact-product alert warrants a brief, source-specific screening caveat.',
    )
    expect(food).toContain(
      "For a material alert, attribute the measured result to `source`, and attribute the concern level, exposure, and ratio to Murph's comparison against the named `threshold.authority` and threshold.",
    )
    expect(food).toContain(
      'Never say the source reported a concern level unless the evidence explicitly states that.',
    )
    expect(food).toContain(
      'Do not inject unknown or `none` results into every acknowledgment.',
    )
    expect(food).toContain(
      'use `--full-label` whenever the user needs a fact outside that compact response.',
    )
    expect(food).toContain(
      'complete contaminant observation, sample, source, and threshold details.',
    )
    expect(food).toContain(
      'A database serving is not evidence that the user ate exactly one serving.',
    )
    expect(food).toContain(
      'Do not silently assume restaurant or prepared food has no added fat.',
    )
    expect(food).toContain(
      'If that bounded source pass is unavailable or still inconclusive, finish with a clearly marked estimate or range',
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

  it('bounds routine research while preserving safety-critical verification and correction provenance', async () => {
    const food = compact(await readFile(
      path.join(resolveAssistantSkillsRoot(), 'food-journal', 'SKILL.md'),
      'utf8',
    ))

    expect(food).toContain('one initial database pass for unresolved components')
    expect(food).toContain('make one targeted web search for the unresolved facts')
    expect(food).toContain('Remove excluded items without researching them')
    expect(food).toContain('rescale unchanged verified facts')
    expect(food).toContain('not allergen safety, supplement dosing, clinical nutrient limits, or an explicit request for exact verification')
    expect(food).toContain('verify the result before saying it is saved')
    expect(food).toContain('an answer-only request does not itself authorize a new meal record')
  })
})
