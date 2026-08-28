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
      'For a setup-only workout activation or logging turn, member-supplied exercise names are authoritative log input, not catalog selections.',
    )
    expect(compact).toContain(
      'Preserve every distinct supplied name and follow the canonical workout owner without running `exercise list` or `exercise show`.',
    )
    expect(compact).toContain(
      'A missing catalog match must never block, rename, merge, omit, or substitute a member-supplied exercise in the workout.',
    )
    expect(compact).toContain(
      'Exercise images are optional generally, but use them when available and helpful, especially for unfamiliar or technique-sensitive movements.',
    )
    expect(compact).toContain(
      'a just-in-time scheduled movement instruction or an explicit request to see the exercise must attach the smallest useful returned catalog image set with `murph.attach_response_media` when one exists.',
    )
    expect(compact).toContain(
      'A request for a missing exercise picture is a presentation repair. Look up the exercise and use returned catalog media when available.',
    )
    expect(compact).toContain(
      'Do not call `murph.generate_image` as a substitute for useful catalog media.',
    )
    expect(compact).toContain(
      'If the exercise has no useful catalog image, generate an instructional image when it would help; also generate one when the user explicitly asks for a new or custom image.',
    )
    expect(compact).toContain(
      'In the generation prompt and visible reply, use the natural exercise name rather than a catalog id or slug.',
    )
    expect(compact).toContain(
      'never append a catalog id in parentheses or expose a source token.',
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
      'If the card still cannot attach, use one complete generic Rich Message without images and name every movement separately.',
    )
    expect(compact).toContain(
      'If an important movement has no useful image, keep the written cue clear and never imply that an image was attached.',
    )
    expect(compact).not.toContain('Complete that repair in the current turn')
    expect(compact).not.toContain('Distinguish that specific delivered image')
    expect(compact).not.toContain('provenance of an earlier image')
  })
})
