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
  it('advertises normalized coverage without promising source support or raw streams', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('Connected health data can include body-composition')
    expect(prompt).toContain('respiratory, metabolic, treatment, alert, accessibility, environmental')
    expect(prompt).toContain('ECG-summary, and workout-summary observations')
    expect(prompt).toContain('Read these signals with bounded `vault-cli measurement entry list`')
    expect(prompt).toContain('reserve `wearables metric` for catalog aliases')
    expect(prompt).toContain('not proof a source supplied it')
    expect(prompt).toContain('missing means unavailable, not zero')
    expect(prompt).toContain(
      'Raw ECG voltages and workout stream points are not stored or exposed',
    )
    expect(prompt).toContain(
      'burned calories, carbohydrate observations, and complete meal intake distinct',
    )
    expect(prompt).toContain(
      'use meal totals or meal records for eaten calories',
    )
  })

  it('routes expanded activity signals through the lossless global metric surface', async () => {
    const skill = await readSkill('daily-activity')

    expect(skill).toContain(
      'vault-cli measurement entry list --metric <metric> --from <date> --to <date> --limit 50 --format json',
    )
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
