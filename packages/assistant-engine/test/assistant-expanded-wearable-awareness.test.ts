import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'telegram',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    currentLocalDate: '2026-08-12',
    currentTimeZone: 'America/Chicago',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

async function readSkill(slug: string): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('expanded wearable awareness', () => {
  it('routes normalized facts without promising source support or raw streams', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('Connected health data can include body-composition')
    expect(prompt).toContain('respiratory, metabolic, alert, accessibility, environmental')
    expect(prompt).toContain('ECG-summary, and workout-summary observations')
    expect(prompt).toContain('Read them with bounded `vault-cli measurement entry list`')
    expect(prompt).toContain('Connected insulin is an `intervention_session`')
    expect(prompt).toContain(
      'vault-cli event list --kind intervention_session --from <date> --to <date> --limit 50 --format json',
    )
    expect(prompt).toContain('device-sourced `insulin-injection` events')
    expect(prompt).not.toContain('respiratory, metabolic, treatment, alert')
    expect(prompt).toContain('not `wearables metric`')
    expect(prompt).toContain('missing is unavailable, not zero or proof of absence')
    expect(prompt).toContain(
      'Raw ECG voltage/workout points are not stored',
    )
    expect(prompt).toContain(
      'Burned calories and carbs are not intake; use meal records or say unavailable',
    )
  })

  it('routes expanded activity signals through the lossless global metric surface', async () => {
    const skill = await readSkill('daily-activity')

    expect(skill).toContain(
      'vault-cli measurement entry list --metric <metric> --from <date> --to <date> --limit 50 --format json',
    )
    for (const metric of [
      'calories_basal',
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
    expect(skill).toMatch(/global\s+metric index, not the narrower `wearables metric`/u)
    expect(skill).toMatch(/No returned entries\s+means missing coverage, not zero/u)
    expect(skill).toContain('returned source and event ID as provenance')
    expect(skill).toContain('query-only and unavailable through `vault-cli show`')
  })

  it('uses connected body metrics as source-aware trends rather than ground truth', async () => {
    const skill = await readSkill('body-composition')

    expect(skill).toContain(
      'vault-cli measurement entry list --metric <metric> --from <date> --to <date> --limit 50 --format json',
    )
    for (const metric of [
      'body_mass_index',
      'fat',
      'lean_body_mass',
      'waist_circumference',
    ]) {
      expect(skill).toContain(`\`${metric}\``)
    }
    expect(skill).toMatch(/compare repeated readings for a trend\. Keep sources and measurement\s+conditions consistent/u)
    expect(skill).toMatch(/No returned entries means missing coverage rather than no\s+change/u)
    expect(skill).toContain('returned source and event ID as provenance')
    expect(skill).toMatch(/query-only and unavailable through\s+`vault-cli show`/u)
  })
})
