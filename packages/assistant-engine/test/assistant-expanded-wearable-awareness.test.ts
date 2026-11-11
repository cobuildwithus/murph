import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

async function readSkill(slug: string): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('expanded wearable awareness', () => {
  it('routes expanded activity signals through the lossless global metric surface', async () => {
    const skill = await readSkill('daily-activity')

    for (const metric of [
      'daylight_exposure',
      'fall',
      'floors_climbed',
      'handwashing',
      'stand_duration',
      'stand_hour',
      'uv_exposure',
      'wheelchair_push',
      'workout_distance',
      'workout_duration',
      'workout_swimming_stroke',
    ]) {
      expect(skill).toContain(`\`${metric}\``)
    }
  })

  it('uses connected body metrics as source-aware trends rather than ground truth', async () => {
    const skill = await readSkill('body-composition')

    for (const metric of [
      'body_mass_index',
      'fat',
      'lean_body_mass',
      'waist_circumference',
    ]) {
      expect(skill).toContain(`\`${metric}\``)
    }
  })
})
