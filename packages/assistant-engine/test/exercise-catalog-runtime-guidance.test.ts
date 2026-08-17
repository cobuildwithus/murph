import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

describe('exercise catalog runtime guidance', () => {
  it('keeps exercise images optional, useful, and source-ordered', async () => {
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
      'Exercise images are optional, but use them when available and helpful, especially for unfamiliar or technique-sensitive movements.',
    )
    expect(compact).toContain(
      'Choose the smallest useful set and keep the complete response at eight images or fewer.',
    )
    expect(compact).toContain(
      '`exercise_catalog:<returned-item-id>:<1-based-position-in-images[]>` and keep the returned order.',
    )
    expect(compact).toContain(
      'For Linq/iMessage, use the existing response-media path when images improve the instruction.',
    )
    expect(compact).toContain(
      "On Telegram, follow the routine-card tool's per-movement mapping and bounded validation-repair guidance.",
    )
    expect(compact).toContain(
      'Keep catalog images inside that card and never use separate response media as its fallback.',
    )
    expect(compact).toContain(
      'If the card still cannot attach, use one complete generic Rich Message without images.',
    )
    expect(compact).toContain(
      'If an important movement has no useful image, keep the written cue clear and never imply that an image was attached.',
    )
  })
})
