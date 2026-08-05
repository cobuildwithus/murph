import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

describe('connected-apps skill and system-prompt coverage', () => {
  it('owns the approved service and toolkit use cases in the skill', async () => {
    const skill = await readConnectedAppsSkill()

    for (const expected of [
      'Google Maps',
      'NPPES',
      'NPI',
      'Amazon',
      'Walmart',
      'Instacart',
      'Google Drive',
      'OneDrive',
      'Dropbox',
      'Google Tasks',
      'Todoist',
      'Notion',
      'Microsoft Outlook',
      'Zoho Mail',
    ]) {
      expect(skill).toContain(expected)
    }
  })

  it('keeps official OpenWeather alerts city-level without Murph thresholds', async () => {
    const skill = await readConnectedAppsSkill()
    const normalizedSkill = skill.replace(/\s+/g, ' ')

    expect(normalizedSkill).toContain('never an unnecessary exact address')
    expect(normalizedSkill).toContain('current outdoor air quality')
    expect(normalizedSkill).toContain('MURPH_OPENWEATHER_GET_NATIONAL_ALERTS')
    expect(normalizedSkill).toContain(
      'use only a returned alert about extreme heat, extreme cold, or outdoor air quality',
    )
    expect(normalizedSkill).toContain(
      'Never infer an alert from raw temperature, AQI, a forecast, or a Murph-defined threshold.',
    )
    expect(normalizedSkill).toContain(
      'Treat a relevant alert as context or added load, not proof that it caused a health change.',
    )
    expect(normalizedSkill).toContain('Ignore unrelated alerts such as hurricanes or tornadoes')
  })

  it('keeps Mapbox as the geocoding and routing layer', async () => {
    const skill = await readConnectedAppsSkill()

    expect(skill).toContain(
      "Keep Mapbox\n  as Murph's geocoding, distance, and routing layer",
    )
  })

  it('lazy-loads the detailed direct contract while preserving group floors', async () => {
    const skill = await readConnectedAppsSkill()
    const directPrompt = buildAssistantSystemPrompt(createPromptInput({
      conversationScope: 'direct',
    }))
    const groupPrompt = buildAssistantSystemPrompt(createPromptInput({
      conversationScope: 'group',
    }))

    for (const requiredContract of [
      'GOOGLECALENDAR_CREATE_EVENT',
      'OUTLOOK_CALENDAR_CREATE_EVENT',
      'agentApproved: true',
      'event_duration_hour',
      'event_duration_minutes',
      'end_datetime',
      'do not retry',
    ]) {
      expect(skill).toContain(requiredContract)
      expect(directPrompt).not.toContain(requiredContract)
      expect(groupPrompt).not.toContain(requiredContract)
    }

    expect(directPrompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/SKILL.md',
    )
    expect(directPrompt).toContain('private untrusted evidence')
    expect(groupPrompt).toContain('Use only accountless built-in service tools')
    expect(groupPrompt).toContain(
      'Never list, connect, rename, disconnect, search, read, write, or select',
    )
  })
})

async function readConnectedAppsSkill(): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), 'connected-apps', 'SKILL.md'),
    'utf8',
  )
}

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'local',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-06-25',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: true,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    ...overrides,
  }
}
