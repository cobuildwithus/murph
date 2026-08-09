import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

async function readSkill(slug: string) {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('repeated workout tally guidance', () => {
  it('requires explicit occurrence logs and separates actual from theoretical totals', async () => {
    const experiment = await readSkill('experiment-onboarding')
    const behavior = await readSkill('behavior-followthrough')
    const strength = await readSkill('strength-training')

    expect(experiment).toContain('more than one expected occurrence per date')
    expect(experiment).toContain('rollup.targetCompletions')
    expect(experiment).toContain('in occurrence units, not day units')
    expect(experiment).toContain('Never multiply elapsed days')
    expect(experiment).toContain('current per-occurrence standard')
    expect(experiment).toContain('progress.adherence.sessionEventIds')
    expect(experiment).toContain('theoretical full-compliance total')
    expect(behavior).toContain('more than one expected occurrence per day')
    expect(strength).toContain('actual cumulative repetition total')
    expect(strength).toContain('theoretical full-compliance total')
  })

  it('documents the fail-closed structured workout replacement guard', async () => {
    const trackedTable = await readSkill('tracked-table')

    expect(trackedTable).toContain(
      'refuses a structured replacement that omits a saved exercise or set',
    )
    expect(trackedTable).toContain('Use `--clear-workout` only')
    expect(trackedTable).toContain('remove the entire record')
  })
})
