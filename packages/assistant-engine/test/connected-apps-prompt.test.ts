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

  it('does not turn raw OpenWeather reads into official alerts', async () => {
    const skill = await readConnectedAppsSkill()
    const normalizedSkill = skill.replace(/\s+/g, ' ')

    expect(normalizedSkill).toContain('never an unnecessary exact address')
    expect(normalizedSkill).toContain('current outdoor air quality')
    expect(normalizedSkill).toContain(
      'Raw weather, AQI, and forecast reads do not establish an official alert.',
    )
    expect(normalizedSkill).toContain(
      'unless the current system prompt names a server-authorized fixed route and its exact schema',
    )
    expect(normalizedSkill).not.toContain('MURPH_OPENWEATHER_GET_NATIONAL_ALERTS')
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
    const scheduledPrompt = buildAssistantSystemPrompt(createPromptInput({
      scheduledOccurrenceAt: '2026-06-25T13:00:00.000Z',
      turnTrigger: 'automation-cron',
    }))

    for (const requiredContract of [
      'GOOGLECALENDAR_CREATE_EVENT',
      'OUTLOOK_CALENDAR_CREATE_EVENT',
      'agentApproved: true',
      'event_duration_hour',
      'event_duration_minutes',
      'end_datetime',
    ]) {
      expect(skill).toContain(requiredContract)
      expect(directPrompt).not.toContain(requiredContract)
      expect(groupPrompt).not.toContain(requiredContract)
    }
    expect(skill).toContain('do not retry')

    expect(directPrompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/SKILL.md',
    )
    expect(directPrompt).toContain('private untrusted evidence')
    expect(directPrompt).toContain('OPENWEATHER_API_GET_GEOCODING_DIRECT')
    expect(directPrompt).toContain('MURPH_OPENWEATHER_GET_NATIONAL_ALERTS')
    expect(directPrompt).toContain('without search')
    expect(directPrompt).toContain('never guess coordinates')
    expect(directPrompt).toContain('with numeric `lat`/`lon`')
    expect(directPrompt).toContain('once including retries')
    expect(directPrompt).toContain('Continue on failure')
    expect(scheduledPrompt).toContain('MURPH_OPENWEATHER_GET_NATIONAL_ALERTS')
    expect(groupPrompt).toContain('Use only accountless built-in service tools')
    expect(groupPrompt).toContain(
      'Never list, connect, rename, disconnect, search, read, write, or select',
    )
    expect(`${groupPrompt}\n${skill}`).not.toContain(
      'MURPH_OPENWEATHER_GET_NATIONAL_ALERTS',
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
