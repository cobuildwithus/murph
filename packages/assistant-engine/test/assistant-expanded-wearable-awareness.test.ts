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

    expect(prompt).toContain('Connected health-data coverage can include body composition')
    expect(prompt).toContain('respiratory readings')
    expect(prompt).toContain('ECG recording summaries')
    expect(prompt).toContain('workout duration, distance, stroke, and heart-rate summaries')
    expect(prompt).toContain("not proof that the member's source supplies one")
    expect(prompt).toContain('report missing coverage as unavailable')
    expect(prompt).toContain(
      'Raw ECG voltage samples and workout stream points are deliberately not stored or exposed',
    )
    expect(prompt).toContain(
      'connected health data can include carbohydrate observations',
    )
    expect(prompt).toContain(
      'neither supplies complete eaten-calorie or meal totals',
    )
  })

  it('routes expanded activity signals through the existing normalized metric surface', async () => {
    const skill = await readSkill('daily-activity')

    expect(skill).toContain('vault-cli wearables metric latest <metric> --format json')
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
    expect(skill).toContain('A missing metric is missing coverage, not zero')
  })

  it('uses connected body metrics as source-aware trends rather than ground truth', async () => {
    const skill = await readSkill('body-composition')

    expect(skill).toContain('vault-cli wearables metric latest <metric> --format json')
    expect(skill).toContain('vault-cli wearables metric trend <metric> --format json')
    for (const metric of [
      'body_mass_index',
      'fat',
      'lean_body_mass',
      'waist_circumference',
    ]) {
      expect(skill).toContain(`\`${metric}\``)
    }
    expect(skill).toMatch(/repeated readings from consistent sources and\s+conditions/u)
    expect(skill).toMatch(/missing coverage rather than no\s+change/u)
  })
})
