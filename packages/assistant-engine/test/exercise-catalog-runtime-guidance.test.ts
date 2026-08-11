import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

describe('exercise catalog runtime guidance', () => {
  it('uses ordered multi-frame media for unfamiliar movements', async () => {
    const raw = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'shared',
        'exercise-catalog-runtime.md',
      ),
      'utf8',
    )
    const compact = raw.replace(/\s+/gu, ' ')

    expect(compact).toContain(
      'Count useful frames per unfamiliar movement, not only across the whole response.',
    )
    expect(compact).toContain(
      'attach the available frames in exercise order so each illustrated movement shows its setup, important transitions or side changes, and endpoint across the full range of motion.',
    )
    expect(compact).toContain(
      'Use at least two frames for a simple start/end motion and three or more when an intermediate phase is needed to make the path clear.',
    )
    expect(compact).toContain(
      'Do not satisfy this rule with one static frame for each of several unfamiliar movements.',
    )
    expect(compact).toContain(
      'teach fewer movements at a time rather than sacrificing sequence clarity.',
    )
    expect(compact).toContain(
      'If only one useful catalog frame exists for a movement, say the catalog does not yet show the full motion',
    )
  })
})
